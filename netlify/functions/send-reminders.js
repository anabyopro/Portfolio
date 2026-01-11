const { createClient } = require('@supabase/supabase-js');
const { Resend } = require('resend');
const { schedule } = require('@netlify/functions');

const handler = async function(event, context) {
    
    const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
    const resend = new Resend(process.env.RESEND_API_KEY);
    const now = new Date();

    console.log("⏰ CRON : Vérification quotidienne des relances...");

    try {
        // 1. Récupérer les dossiers en cours AVEC LES INFOS CLIENTS (Jointure)
        const { data: dossiersRaw, error } = await supabase
            .from('demandes_clients')
            .select(`
                *,
                clients_identite (
                    nom_complet,
                    email
                )
            `)
            .in('statut', ['Devis envoyé', 'Facture envoyée']);

        if (error) throw error;
        if (!dossiersRaw || dossiersRaw.length === 0) return { statusCode: 200 };

        // On simplifie pour que le reste du code soit plus lisible
        const dossiers = dossiersRaw.map(d => ({
            ...d,
            email_client: d.clients_identite?.email, // On récupère l'email au bon endroit
            nom_client: d.clients_identite?.nom_complet
        }));

        // 2. Vérifier chaque dossier
        for (const dossier of dossiers) {
            if (!dossier.email_client) {
                console.warn(`Pas d'email pour le dossier ${dossier.tracking_id}, ignoré.`);
                continue;
            }

            const dateMaj = new Date(dossier.date_mise_a_jour);
            
            // CALCUL : Jours écoulés
            const diffTime = Math.abs(now - dateMaj);
            const joursEcoules = Math.floor(diffTime / (1000 * 60 * 60 * 24)); 

            console.log(`📂 ${dossier.tracking_id} (${dossier.statut}) : En cours depuis ${joursEcoules} jours.`);

            // =================================================================
            // PARTIE 1 : RELANCES DEVIS
            // =================================================================
            if (dossier.statut === 'Devis envoyé') {
                
                // J+3 : Vérification de réception
                if (joursEcoules === 3) {
                    await traiterRelance(supabase, resend, dossier, 'Relance Devis J+3', 
                        `Suivi de votre demande - Dossier ${dossier.tracking_id}`,
                        `<p>Je me permets de revenir vers vous pour m'assurer que vous avez bien reçu le devis envoyé il y a quelques jours.</p>
                         <p>Avez-vous pu l'ouvrir sans difficulté ?</p>`);
                }
                
                // J+7 : Proactivité
                else if (joursEcoules === 7) {
                    await traiterRelance(supabase, resend, dossier, 'Relance Devis J+7', 
                        `Concernant notre proposition - Dossier ${dossier.tracking_id}`,
                        `<p>Avez-vous eu l'occasion de parcourir notre proposition commerciale ?</p>
                         <p>Si certains points vous semblent flous, je suis à votre entière disposition pour en discuter.</p>`);
                }

                // J+14 : Planification
                else if (joursEcoules === 14) {
                    await traiterRelance(supabase, resend, dossier, 'Relance Devis J+14', 
                        `Planification de votre projet ${dossier.tracking_id}`,
                        `<p>Je finalise mon planning pour les semaines à venir. Souhaitez-vous que je maintienne une option pour votre projet ?</p>`);
                }
            }

            // =================================================================
            // PARTIE 2 : RELANCES FACTURES (Basé sur échéance 30j)
            // =================================================================
            if (dossier.statut === 'Facture envoyée') {
                
                // J-7 avant échéance (Jour 23) : Prévenance
                if (joursEcoules === 23) {
                    await traiterRelance(supabase, resend, dossier, 'Relance Facture J-7', 
                        `Rappel d'échéance à venir - Facture ${dossier.tracking_id}`,
                        `<p>Ceci est un message automatique pour vous rappeler que la facture concernant la mission <strong>${dossier.tracking_id}</strong> arrivera à échéance dans une semaine.</p>
                         <p>Si le virement est déjà programmé, vous pouvez ignorer ce message.</p>`);
                }

                // J+1 après échéance (Jour 31) : L'oubli
                else if (joursEcoules === 31) {
                    await traiterRelance(supabase, resend, dossier, 'Relance Facture J+1', 
                        `Facture en attente de règlement - Dossier ${dossier.tracking_id}`,
                        `<p>Sauf erreur de notre part, nous n'avons pas encore vu passer le règlement de la facture qui était due hier.</p>
                         <p>S'agit-il d'un simple oubli de votre part ? Merci de faire le nécessaire dès que possible.</p>`);
                }

                // J+7 après échéance (Jour 37) : Retard
                else if (joursEcoules === 37) {
                    await traiterRelance(supabase, resend, dossier, 'Relance Facture J+7', 
                        `Rappel : Facture impayée - Dossier ${dossier.tracking_id}`,
                        `<p>La facture accuse maintenant un retard d'une semaine.</p>
                         <p>Merci de procéder à la régularisation immédiate afin d'éviter toute procédure de recouvrement.</p>`);
                }
            }
        }

        return { statusCode: 200 };

    } catch (err) {
        console.error("Erreur CRON:", err);
        return { statusCode: 500 };
    }
};

// --- FONCTIONS UTILITAIRES ---

async function traiterRelance(supabase, resend, dossier, type, sujet, html) {
    // Anti-spam : On vérifie si déjà fait
    const { data: existe } = await supabase.from('mission_events')
        .select('id')
        .eq('request_id', dossier.id)
        .eq('event_type', type)
        .single();

    if (existe) return; 

    // Envoi
    await resend.emails.send({
        from: 'AnaByo <contact@anabyo.com>',
        to: [dossier.email_client], // Variable corrigée grâce au map au début
        subject: `AnaByo | ${sujet}`,
        html: `<p>Bonjour ${dossier.nom_client},</p>${html}<p>Cordialement,<br>L'équipe AnaByo</p>`
    });

    // Log
    await supabase.from('mission_events').insert({ 
        request_id: dossier.id, 
        event_type: type, 
        description: "Relance automatique envoyée." 
    });
    console.log(`✅ Email envoyé : ${type} -> ${dossier.tracking_id}`);
}

// PLANIFICATION : Tous les jours à 9h00 du matin
module.exports.handler = schedule('0 9 * * *', handler);