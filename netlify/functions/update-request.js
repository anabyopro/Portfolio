// Fichier : netlify/functions/update-request.js
const { createClient } = require('@supabase/supabase-js');
const { Resend } = require('resend');

exports.handler = async function(event) {
    if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method Not Allowed' };

    // Authentification
    const correctPassword = process.env.ADMIN_PASSWORD;
    const providedPassword = event.headers['x-admin-password'];
    if (!providedPassword || providedPassword !== correctPassword) {
        return { statusCode: 401, body: JSON.stringify({ error: "Accès non autorisé." }) };
    }

    const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

    try {
        const { id, newStatus, bluefilesLink } = JSON.parse(event.body);
        if (!id || !newStatus) return { statusCode: 400, body: JSON.stringify({ error: "Données manquantes." }) };

        // --- FONCTION UTILITAIRE POUR RÉCUPÉRER LES INFOS COMPLÈTES ---
        // On récupère la demande ET les infos du client lié (email, nom) en une seule fois
        const fetchFullRequest = async (requestId) => {
            const { data, error } = await supabase
                .from('demandes_clients')
                .select(`
                    *,
                    clients_identite (
                        email,
                        nom_complet,
                        representant,
                        fonction,
                        adresse
                    )
                `)
                .eq('id', requestId)
                .single();
            
            if (error || !data) throw new Error("Demande introuvable.");
            
            // On simplifie l'objet pour le reste du code
            return {
                ...data,
                email_client: data.clients_identite?.email,
                nom_client: data.clients_identite?.nom_complet,
                representant: data.clients_identite?.representant,
                fonction: data.clients_identite?.fonction,
                adresse: data.clients_identite?.adresse
            };
        };

        // --- CAS SPÉCIAL : BOUTON "RELANCE" MANUELLE (⚡) ---
        if (newStatus === 'Relance') {
            const currentData = await fetchFullRequest(id);
            const resend = new Resend(process.env.RESEND_API_KEY);
            
            let subject = "Rappel concernant votre dossier";
            let html = "<p>Bonjour,</p>";
            
            if (currentData.statut === 'Devis envoyé') {
                subject = "Rappel : Votre devis est en attente";
                html = `<p>Bonjour ${currentData.nom_client},</p><p>Je me permets de vous relancer concernant le devis envoyé récemment. Avez-vous des questions ?</p>`;
            } else if (currentData.statut === 'Facture envoyée') {
                subject = "Rappel : Facture en attente";
                html = `<p>Bonjour ${currentData.nom_client},</p><p>Sauf erreur, la facture pour ce dossier n'est pas encore réglée. Merci de vérifier.</p>`;
            }

            await resend.emails.send({
                from: 'AnaByo <contact@anabyo.com>',
                to: [currentData.email_client],
                subject: `AnaByo | ${subject}`,
                html: html + "<p>Cordialement,<br>L'équipe AnaByo</p>"
            });

            await supabase.from('mission_events').insert({ request_id: id, event_type: 'Relance Manuelle', description: "Relance manuelle envoyée." });
            return { statusCode: 200, body: JSON.stringify({ message: "Relance envoyée !" }) };
        }

        // --- CAS SPÉCIAL : GÉNÉRATION JSON ---
        if (newStatus === 'json') {
            const requestData = await fetchFullRequest(id);
            const configUpdate = {
                client: {
                    nom_complet: requestData.nom_client,
                    representant: requestData.representant,
                    fonction: requestData.fonction,
                    adresse: requestData.adresse,
                    email: requestData.email_client
                },
                devis: { taches: [], notes: "Validité 30 jours.", _priority: requestData.is_urgent ? "1" : "0" }
            };
            return { statusCode: 200, body: JSON.stringify(configUpdate) };
        }

        // --- CAS SPÉCIAL : REFUS / SUPPRESSION ---
        if (newStatus === 'Refusée' || newStatus === 'Devis refusé') {
            const requestData = await fetchFullRequest(id);
            
            if (newStatus === 'Refusée') {
                const resend = new Resend(process.env.RESEND_API_KEY);
                await resend.emails.send({
                    from: 'AnaByo <contact@anabyo.com>',
                    to: [requestData.email_client],
                    subject: 'Concernant votre demande chez AnaByo',
                    html: `<p>Bonjour ${requestData.nom_client},</p><p>Votre demande ne pourra malheureusement pas être traitée.</p><p>Cordialement,<br>L'équipe AnaByo</p>`
                });
            }

            await supabase.from('mission_events').insert({ request_id: id, event_type: 'Refus', description: `Demande passée en '${newStatus}' et supprimée.` });
            await supabase.from('demandes_clients').delete().eq('id', id);
            return { statusCode: 200, body: JSON.stringify({ message: "Demande refusée et supprimée." }) };
        }

        // --- MISE À JOUR STANDARD (Le Clic sur le bouton statut) ---
        
        // 1. On récupère l'ancien statut (avec la nouvelle méthode sécurisée)
        const oldRequest = await fetchFullRequest(id);

        // 2. On met à jour la base
        const updatePayload = { 
            statut: newStatus,
            date_mise_a_jour: new Date().toISOString()
        };
        if (bluefilesLink) updatePayload.bluefiles_link = bluefilesLink;

        const { data: updatedRaw, error } = await supabase
            .from('demandes_clients')
            .update(updatePayload)
            .eq('id', id)
            .select('*, clients_identite(*)') // On demande aussi les infos clients mises à jour
            .single();

        if (error) throw error;

        // On reformate pour avoir un objet propre
        const finalData = {
            ...updatedRaw,
            email_client: updatedRaw.clients_identite?.email,
            nom_client: updatedRaw.clients_identite?.nom_complet
        };

        // 3. Log
        if (oldRequest.statut !== newStatus) {
            await supabase.from('mission_events').insert({
                request_id: id,
                event_type: 'Changement de statut',
                description: `Statut changé de '${oldRequest.statut}' à '${newStatus}'.`,
                metadata: {
                    from: oldRequest.statut,
                    to: newStatus
                }
            });
        }

        // --- GESTION DES EMAILS AUTOMATIQUES ---
        const resend = new Resend(process.env.RESEND_API_KEY);

        // A. ACCEPTÉE
        if (newStatus === 'Acceptée') {
            await resend.emails.send({
                from: 'AnaByo <contact@anabyo.com>',
                to: [finalData.email_client],
                subject: 'Votre demande a été acceptée !',
                html: `<p>Bonjour ${finalData.nom_client},</p>
                       <p>Bonne nouvelle, votre demande a été acceptée !</p>
                       <p>Pour démarrer, merci de déposer vos fichiers en toute sécurité via ce lien : <a href="${bluefilesLink}">Déposer mes fichiers</a>.</p>
                       <p>Une fois les fichiers reçus, nous vous enverrons le devis correspondant.</p>
                       <p>Vous pouvez suivre l'avancement de votre dossier à tout moment depuis votre <a href="${process.env.URL}/espace-client.html" style="font-weight: bold;">Espace Client</a>.</p>
                       <p>Cordialement,<br>L'équipe AnaByo</p>`
            });
        }

        // B. DEVIS ENVOYÉ & C. FACTURE ENVOYÉE -> Silencieux (log console uniquement)
        if (newStatus === 'Devis envoyé') console.log("Statut passé à Devis Envoyé.");
        if (newStatus === 'Facture envoyée') console.log("Statut passé à Facture Envoyée.");

        // D. TERMINÉE
        if (newStatus === 'Terminée') {
            // On génère le lien unique pour la demande d'avis
            const feedbackLink = `${process.env.URL}/feedback.html?mission=${finalData.tracking_id}`;

            const subject = `Clôture de notre collaboration - Dossier ${finalData.tracking_id}`;
            const htmlBody = `
                <p>Bonjour ${finalData.nom_client},</p>
                <p>Notre collaboration concernant la mission <strong>${finalData.tracking_id}</strong> est maintenant terminée. Nous vous confirmons la bonne réception de votre règlement et nous vous remercions pour votre confiance.</p>
                <p><strong>Votre avis est précieux !</strong></p>
                <p>Pour nous aider à nous améliorer, pourriez-vous prendre une minute pour partager votre expérience ?</p>
                <p><a href="${feedbackLink}" style="display: inline-block; padding: 12px 20px; background-color: #2563eb; color: white; text-decoration: none; border-radius: 6px; font-weight: bold;">Donner mon avis</a></p>
                <p>Nous restons à votre disposition pour toute future analyse.</p>
                <p>Cordialement,<br>L'équipe AnaByo</p>
            `;
            await resend.emails.send({
                from: 'AnaByo <contact@anabyo.com>',
                to: [finalData.email_client],
                subject: `AnaByo | ${subject}`,
                html: htmlBody
            });
        }

        return { statusCode: 200, body: JSON.stringify(finalData) };

    } catch (error) {
        console.error("Erreur:", error);
        return { statusCode: 500, body: JSON.stringify({ error: "Erreur serveur." }) };
    }
};