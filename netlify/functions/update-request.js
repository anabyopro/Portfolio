const { createClient } = require('@supabase/supabase-js');
const { Resend } = require('resend');

exports.handler = async function(event) {
    if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method Not Allowed' };

    // 1. Authentification Admin
    const correctPassword = process.env.ADMIN_PASSWORD;
    const providedPassword = event.headers['x-admin-password'];
    if (!providedPassword || providedPassword !== correctPassword) {
        return { statusCode: 401, body: JSON.stringify({ error: "Accès non autorisé." }) };
    }

    // 2. Initialisation des Clients (Une seule fois ici pour tout le script)
    const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
    const resend = new Resend(process.env.RESEND_API_KEY);

    try {
        const { id, newStatus, bluefilesLink, rejectionReason } = JSON.parse(event.body);
        if (!id || !newStatus) return { statusCode: 400, body: JSON.stringify({ error: "Données manquantes." }) };

        // --- FONCTION UTILITAIRE : RÉCUPÉRER LES INFOS ---
        const fetchFullRequest = async (requestId) => {
            const { data, error } = await supabase
                .from('demandes_clients')
                .select('*, clients_identite(*)')
                .eq('id', requestId)
                .single();
            
            if (error || !data) throw new Error("Demande introuvable.");
            
            return {
                ...data,
                email_client: data.clients_identite?.email,
                nom_client: data.clients_identite?.nom_complet,
                representant: data.clients_identite?.representant,
                fonction: data.clients_identite?.fonction,
                adresse: data.clients_identite?.adresse
            };
        };

        // --- CAS 1 : RELANCE MANUELLE (⚡) ---
        if (newStatus === 'Relance') {
            const currentData = await fetchFullRequest(id);
            
            let subject = "Rappel concernant votre dossier";
            let htmlContent = "";
            
            if (currentData.statut === 'Devis envoyé') {
                subject = "Rappel : Votre devis est en attente";
                htmlContent = `<p>Je me permets de vous relancer concernant le devis envoyé récemment. Avez-vous des questions ?</p>`;
            } else if (currentData.statut === 'Facture envoyée') {
                subject = "Rappel : Facture en attente";
                htmlContent = `<p>Sauf erreur, le règlement de la facture pour ce dossier n'est pas encore parvenu. Merci de vérifier.</p>`;
            }

            await resend.emails.send({
                from: 'AnaByo <contact@anabyo.com>',
                to: [currentData.email_client],
                subject: `AnaByo | ${subject}`,
                html: `<p>Bonjour ${currentData.nom_client},</p>${htmlContent}<p>Cordialement,<br>L'équipe AnaByo</p>`
            });

            await supabase.from('mission_events').insert({ 
                request_id: id, 
                event_type: 'Relance Manuelle', 
                description: "Relance manuelle envoyée." 
            });
            
            return { statusCode: 200, body: JSON.stringify({ message: "Relance envoyée !" }) };
        }

        // --- CAS 2 : GÉNÉRATION JSON ---
        if (newStatus === 'json') {
            const requestData = await fetchFullRequest(id);
            return { 
                statusCode: 200, 
                body: JSON.stringify({
                    client: {
                        nom_complet: requestData.nom_client,
                        representant: requestData.representant,
                        fonction: requestData.fonction,
                        adresse: requestData.adresse,
                        email: requestData.email_client
                    },
                    devis: { taches: [], notes: "Validité 30 jours.", _priority: requestData.is_urgent ? "1" : "0" }
                }) 
            };
        }

        // --- CAS 3 : REFUS / SUPPRESSION ---
        if (newStatus === 'Refusée' || newStatus === 'Devis refusé') {
            const requestData = await fetchFullRequest(id);
            
            const motifHtml = rejectionReason 
                ? `<div style="margin: 20px 0; padding: 15px; border-left: 4px solid #e11d48; background-color: #fff1f2; color: #9f1239;">
                    <strong>Précisions sur le refus :</strong><br>
                    <em>${rejectionReason.replace(/\n/g, '<br>')}</em>
                   </div>`
                : `<p>Votre demande ne pourra malheureusement pas être traitée par nos services actuellement.</p>`;

            await resend.emails.send({
                from: 'AnaByo <contact@anabyo.com>',
                to: [requestData.email_client],
                subject: 'Concernant votre demande chez AnaByo',
                html: `
                    <div style="font-family: sans-serif; line-height: 1.6; color: #333;">
                        <p>Bonjour ${requestData.nom_client || 'Madame, Monsieur'},</p>
                        <p>Nous avons bien étudié votre demande mais nous ne pourrons pas y donner suite.</p>
                        ${motifHtml}
                        <p>Nous vous remercions de l'intérêt porté à nos services. Si vous pensez qu'il s'agit d'une erreur, n'hésitez pas à redéposer une demande.</p>
                        <p>Cordialement,<br><strong>L'équipe AnaByo</strong></p>
                    </div>`
            });

            await supabase.from('mission_events').insert({ 
                request_id: id, 
                event_type: 'Refus', 
                description: rejectionReason ? `Refusée : ${rejectionReason}` : "Demande refusée." 
            });
            
            await supabase.from('demandes_clients').delete().eq('id', id);
            return { statusCode: 200, body: JSON.stringify({ message: "Demande clôturée." }) };
        }

        // --- CAS 4 : MISE À JOUR DE STATUT STANDARD ---
        const oldRequest = await fetchFullRequest(id);

        const { data: updatedRaw, error: upErr } = await supabase
            .from('demandes_clients')
            .update({ 
                statut: newStatus,
                date_mise_a_jour: new Date().toISOString(),
                bluefiles_link: bluefilesLink || oldRequest.bluefiles_link
            })
            .eq('id', id)
            .select('*, clients_identite(*)')
            .single();

        if (upErr) throw upErr;

        const finalData = {
            ...updatedRaw,
            email_client: updatedRaw.clients_identite?.email,
            nom_client: updatedRaw.clients_identite?.nom_complet
        };

        // --- ENVOIS AUTOMATIQUES SELON LE NOUVEAU STATUT ---
        if (newStatus === 'Acceptée') {
            await resend.emails.send({
                from: 'AnaByo <contact@anabyo.com>',
                to: [finalData.email_client],
                subject: 'Votre demande a été acceptée !',
                html: `<p>Bonjour ${finalData.nom_client},</p>
                       <p>Bonne nouvelle, votre demande est acceptée. Déposez vos fichiers ici : <a href="${bluefilesLink}">Lien Bluefiles</a></p>
                       <p>Suivez votre dossier sur l' <a href="https://anabyo.com/espace-client.html">Espace Client</a>.</p>`
            });
        }

        if (newStatus === 'Terminée') {
            const feedbackLink = `https://anabyo.com/feedback.html?mission=${finalData.tracking_id}`;
            await resend.emails.send({
                from: 'AnaByo <contact@anabyo.com>',
                to: [finalData.email_client],
                subject: `Clôture de collaboration - ${finalData.tracking_id}`,
                html: `<p>Bonjour ${finalData.nom_client},</p>
                       <p>La mission est terminée. Merci de votre confiance.</p>
                       <p><a href="${feedbackLink}">Donner mon avis sur la prestation</a></p>`
            });
        }

        return { statusCode: 200, body: JSON.stringify(finalData) };

    } catch (error) {
        console.error("Erreur:", error.message);
        return { statusCode: 500, body: JSON.stringify({ error: error.message }) };
    }
};