const { createClient } = require('@supabase/supabase-js');
const { Resend } = require('resend');

exports.handler = async function(event) {
    if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method Not Allowed' };

    const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
    const resend = new Resend(process.env.RESEND_API_KEY);
    
    try {
        const data = JSON.parse(event.body);
        const trackingId = 'ANA-' + Math.random().toString(36).substr(2, 8).toUpperCase();

        console.log(`📝 Nouvelle demande reçue pour : ${data.email}`);

        // 1. Gestion Identité (Coffre-fort)
        // On cherche si le client existe déjà via son email
        let { data: client } = await supabase.from('clients_identite').select('*').eq('email', data.email).single();
        const clientPayload = {
            email: data.email,
            nom_complet: data.nom,
            representant: data.contact,
            fonction: data.fonction,
            adresse: data.adresse,
            telephone: data.telephone,
        };
        
        if (data.siren) clientPayload.siren = data.siren;

        // Si la TVA est fournie manuellement, on l'utilise. Sinon, on tente le calcul via SIREN.
        if (data.tva) {
            clientPayload.tva_intracom = data.tva;
        } else if (data.siren) {
            const s = data.siren.replace(/\s/g, '');
            if (s.length === 9) {
                const key = (12 + 3 * (parseInt(s) % 97)) % 97;
                clientPayload.tva_intracom = `FR${key}${s}`;
            }
        }

        if (client) {
            // Si le client existe, on met à jour les infos de contact 
            // mais le SIREN reste celui de la base si le champ formulaire est vide
            await supabase.from('clients_identite').update(clientPayload).eq('id', client.id);
        } else {
            // Si c'est un nouveau client, on crée tout
            const { data: newClient } = await supabase.from('clients_identite').insert([clientPayload]).select().single();
            client = newClient;
        }
        if (!client) {
            // Nouveau client : on l'insère
            const { data: newClient, error: err } = await supabase
                .from('clients_identite')
                .insert(clientPayload)
                .select('id').single();
            if (err) throw err;
            client = newClient;
            console.log("🆕 Nouveau client créé ID:", client.id);
        } else {
            // Client existant : on met à jour ses infos (SIREN, Adresse...)
            const { error: errUpdate } = await supabase
                .from('clients_identite')
                .update(clientPayload)
                .eq('id', client.id);
            if (errUpdate) throw errUpdate;
            console.log("🔄 Infos client mises à jour ID:", client.id);
        }

        // 2. Création Mission (Usine)
        const { data: mission, error: errMission } = await supabase
            .from('demandes_clients')
            .insert({
                tracking_id: trackingId,
                type_demande: data.type_projet || 'Non spécifié',
                message: data.message,
                is_urgent: data.urgent === true,
                date_mise_a_jour: new Date().toISOString(), // Utilisation de date_mise_a_jour pour ton CRON
                statut: 'Reçue',
                client_id: client.id,
                
                // Snapshot des infos pour la future facture
                nom_client: data.nom,
                contact: data.contact,
                fonction: data.fonction,
                adresse: data.adresse,
                telephone: data.telephone,
                siren: clientPayload.siren,
                tva_intracom: clientPayload.tva_intracom
            })
            .select().single();

        if (errMission) throw errMission;

        // 3. Log d'événement
        await supabase.from('mission_events').insert({
            request_id: mission.id,
            event_type: 'Création',
            description: 'Demande reçue via le formulaire web.'
        });

        // 4. ENVOI DES EMAILS
        
        // --- Mail 1 : NOTIFICATION ADMIN ---
        try {
            await resend.emails.send({
                from: 'AnaByo <contact@anabyo.com>',
                to: 'contact@anabyo.com',
                subject: `[ALERTE] Nouveau dossier ${trackingId} - ${data.nom}`,
                html: `
                    <h2>Nouvelle demande de projet</h2>
                    <p><strong>Structure :</strong> ${data.nom}</p>
                    <p><strong>SIREN :</strong> ${data.siren || 'Non renseigné'}</p>
                    <p><strong>TVA :</strong> ${data.tva || 'Non renseigné'}</p>
                    <p><strong>Contact :</strong> ${data.contact}</p>
                    <p><strong>Email :</strong> ${data.email}</p>
                    <p><strong>Urgent :</strong> ${data.urgent ? 'OUI' : 'Non'}</p>
                    <p><strong>Message :</strong></p>
                    <p>${data.message.replace(/\n/g, '<br>')}</p>
                `
            });
        } catch (e) { console.error("❌ Erreur Mail Admin :", e.message); }

        // --- Mail 2 : CONFIRMATION CLIENT ---
        try {
            await resend.emails.send({
                from: 'AnaByo <contact@anabyo.com>',
                to: data.email,
                subject: `Confirmation de réception - Dossier ${trackingId}`,
                html: `
                    <div style="font-family: sans-serif; color: #333; line-height: 1.6;">
                    <p>Bonjour ${data.contact || data.nom},</p>
                    
                    <p>C'est confirmé : nous avons bien reçu votre demande pour votre projet de <b>${data.type_projet}</b>. Merci de nous avoir sollicités !</p>
                    
                    <p>Notre équipe examine vos éléments avec attention. Vous recevrez une réponse de notre part <b>sous 24h ouvrées</b> pour la suite des opérations.</p>
                    
                    <div style="background-color: #f9f9f9; padding: 15px; border-left: 4px solid #000; margin: 20px 0;">
                        <strong>Référence de dossier :</strong> ${trackingId}<br>
                        Vous pouvez suivre l'avancement de votre demande en temps réel sur votre 
                        <a href="https://anabyo.com/espace-client.html" style="color: #000; font-weight: bold;">Espace Client</a>.
                    </div>
                    
                    <p>À très bientôt,</p>
                    <p>L'équipe AnaByo</p>
                </div>
                `
            });
        } catch (e) { console.error("❌ Erreur Mail Client :", e.message); }

        return { 
            statusCode: 200, 
            body: JSON.stringify({ message: "Succès", tracking_id: trackingId }) 
        };

    } catch (error) {
        console.error("ERREUR SERVEUR:", error);
        return { statusCode: 500, body: JSON.stringify({ error: error.message }) };
    }
};