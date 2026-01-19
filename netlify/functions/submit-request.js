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
        let { data: client } = await supabase.from('clients_identite').select('id').eq('email', data.email).single();

        const clientPayload = {
            email: data.email,
            nom_complet: data.nom,       // Le nom du Laboratoire/Société
            representant: data.contact,  // Le nom de la personne
            fonction: data.fonction,
            adresse: data.adresse,       // L'adresse (auto-remplie ou manuelle)
            telephone: data.telephone,
            siren: data.siren            // LE SIREN (issu du champ caché)
        };

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
                description: data.message, // Changé 'message' en 'description' selon structure habituelle
                is_urgent: data.urgent === true,
                date_mise_a_jour: new Date().toISOString(), // Utilisation de date_mise_a_jour pour ton CRON
                statut: 'En attente',
                client_id: client.id,
                
                // Snapshot des infos pour la future facture
                nom_client: data.nom,
                siren: data.siren,
                contact: data.contact,
                fonction: data.fonction,
                adresse: data.adresse,
                telephone: data.telephone
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
                    <p>Bonjour ${data.contact || data.nom},</p>
                    <p>Nous avons bien reçu votre demande concernant : <strong>${data.type_projet}</strong>.</p>
                    <p>Votre numéro de dossier est le : <strong>${trackingId}</strong></p>
                    <p>Nous analysons votre demande et reviendrons vers vous sous 24h ouvrées.</p>
                    <br>
                    <p>Cordialement,<br>L'équipe AnaByo</p>
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