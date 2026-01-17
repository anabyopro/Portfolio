const { createClient } = require('@supabase/supabase-js');
const { Resend } = require('resend');
const { schedule } = require('@netlify/functions');

const handler = async function(event, context) {
    const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
    const resend = new Resend(process.env.RESEND_API_KEY);
    
    // On normalise la date d'aujourd'hui à minuit pour un calcul de jours précis
    const now = new Date();
    now.setHours(0, 0, 0, 0);

    console.log(`⏰ CRON [${now.toLocaleDateString()}] : Vérification des relances...`);

    try {
        // 1. Récupérer les dossiers en attente avec les infos clients
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
        if (!dossiersRaw || dossiersRaw.length === 0) {
            console.log("Ménage terminé : aucun dossier à relancer aujourd'hui.");
            return { statusCode: 200 };
        }

        const dossiers = dossiersRaw.map(d => ({
            ...d,
            email_client: d.clients_identite?.email,
            nom_client: d.clients_identite?.nom_complet
        }));

        // 2. Traitement de chaque dossier
        for (const dossier of dossiers) {
            try {
                if (!dossier.email_client) continue;

                // On normalise la date de mise à jour du dossier à minuit
                const dateMaj = new Date(dossier.date_mise_a_jour);
                dateMaj.setHours(0, 0, 0, 0);
                
                // Calcul des jours écoulés (différence nette)
                const joursEcoules = Math.round((now - dateMaj) / (1000 * 60 * 60 * 24)); 

                console.log(`📂 Dossier ${dossier.tracking_id} : ${joursEcoules} jours d'inactivité (Statut: ${dossier.statut})`);

                // --- LOGIQUE RELANCES DEVIS ---
                if (dossier.statut === 'Devis envoyé') {
                    if (joursEcoules >= 3 && joursEcoules < 7) {
                        await traiterRelance(supabase, resend, dossier, 'Relance Devis J+3', 
                            `Suivi de votre demande - Dossier ${dossier.tracking_id}`,
                            `<p>Je me permets de revenir vers vous pour m'assurer que vous avez bien reçu le devis envoyé il y a quelques jours.</p>
                             <p>Avez-vous pu l'ouvrir sans difficulté ?</p>`);
                    } 
                    else if (joursEcoules >= 7 && joursEcoules < 14) {
                        await traiterRelance(supabase, resend, dossier, 'Relance Devis J+7', 
                            `Concernant notre proposition - Dossier ${dossier.tracking_id}`,
                            `<p>Avez-vous eu l'occasion de parcourir notre proposition commerciale ?</p>
                             <p>Si certains points vous semblent flous, je suis à votre entière disposition pour en discuter.</p>`);
                    }
                    else if (joursEcoules >= 14) {
                        await traiterRelance(supabase, resend, dossier, 'Relance Devis J+14', 
                            `Planification de votre projet ${dossier.tracking_id}`,
                            `<p>Je finalise mon planning pour les semaines à venir.</p>
                             <p>Souhaitez-vous que je maintienne une option pour votre projet ?</p>`);
                    }
                }

                // --- LOGIQUE RELANCES FACTURES ---
                if (dossier.statut === 'Facture envoyée') {
                    if (joursEcoules >= 23 && joursEcoules < 30) {
                        await traiterRelance(supabase, resend, dossier, 'Relance Facture J-7', 
                            `Rappel d'échéance à venir - Facture ${dossier.tracking_id}`,
                            `<p>Ceci est un message automatique pour vous rappeler que la facture concernant la mission <strong>${dossier.tracking_id}</strong> arrivera à échéance dans une semaine.</p>`);
                    } 
                    else if (joursEcoules >= 31 && joursEcoules < 37) {
                        await traiterRelance(supabase, resend, dossier, 'Relance Facture J+1', 
                            `Facture en attente de règlement - Dossier ${dossier.tracking_id}`,
                            `<p>Sauf erreur de notre part, nous n'avons pas encore reçu le règlement de votre facture qui était due hier.</p>
                             <p>S'agit-il d'un simple oubli ? Merci de faire le nécessaire.</p>`);
                    }
                    else if (joursEcoules >= 37) {
                        await traiterRelance(supabase, resend, dossier, 'Relance Facture J+7', 
                            `Rappel : Facture impayée - Dossier ${dossier.tracking_id}`,
                            `<p>La facture accuse maintenant un retard d'une semaine.</p>
                             <p>Merci de procéder à la régularisation immédiate.</p>`);
                    }
                }
            } catch (dossierError) {
                // Si un dossier plante, on log et on passe au suivant sans arrêter le script
                console.error(`❌ Erreur sur le dossier ${dossier.tracking_id}:`, dossierError.message);
            }
        }

        return { statusCode: 200 };

    } catch (err) {
        console.error("💥 Erreur critique CRON:", err);
        return { statusCode: 500 };
    }
};

async function traiterRelance(supabase, resend, dossier, type, sujet, htmlContent) {
    // 1. Vérifier si cette relance spécifique a déjà été envoyée (Anti-doublon)
    const { data: existe } = await supabase.from('mission_events')
        .select('id')
        .eq('request_id', dossier.id)
        .eq('event_type', type)
        .maybeSingle();

    if (existe) return; 

    // 2. Envoi de l'email
    await resend.emails.send({
        from: 'AnaByo <contact@anabyo.com>',
        to: dossier.email_client,
        subject: `AnaByo | ${sujet}`,
        html: `
            <div style="font-family: sans-serif; color: #333;">
                <p>Bonjour ${dossier.nom_client || 'Madame, Monsieur'},</p>
                ${htmlContent}
                <p>Vous pouvez retrouver tous les détails de votre dossier sur votre 
                <a href="https://anabyo.com/espace-client.html" style="color: #0284c7; font-weight: bold;">Espace Client</a>.</p>
                <p>Cordialement,<br><strong>L'équipe AnaByo</strong></p>
                <hr style="border: none; border-top: 1px solid #eee; margin-top: 20px;">
                <small style="color: #999;">Ceci est un message automatique de suivi.</small>
            </div>
        `
    });

    // 3. Tracer l'envoi dans la base de données
    await supabase.from('mission_events').insert({ 
        request_id: dossier.id, 
        event_type: type, 
        description: `Relance automatique ${type} envoyée à ${dossier.email_client}.` 
    });

    console.log(`✅ Email envoyé : ${type} pour le dossier ${dossier.tracking_id}`);
}

// Commentez la ligne du schedule
// module.exports.handler = schedule('0 9 * * *', handler);

// Et remplacez-la par un export classique
module.exports.handler = handler;