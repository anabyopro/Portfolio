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
        let { data: client } = await supabase.from('clients_identite').select('id').eq('email', data.email).single();

        if (!client) {
            const { data: newClient, error: err } = await supabase
                .from('clients_identite')
                .insert({
                    email: data.email,
                    nom_complet: data.nom,
                    representant: data.contact,
                    fonction: data.fonction,
                    adresse: data.adresse,
                    telephone: data.telephone
                })
                .select('id').single();
            if (err) throw err;
            client = newClient;
        } else {
            await supabase
                .from('clients_identite')
                .update({
                    nom_complet: data.nom,
                    representant: data.contact,
                    fonction: data.fonction,
                    adresse: data.adresse,
                    telephone: data.telephone
                })
                .eq('id', client.id);
        }

        // 2. Création Mission (Usine)
        const { data: mission, error: errMission } = await supabase
            .from('demandes_clients')
            .insert({
                tracking_id: trackingId,
                type_demande: data.type_projet || 'Non spécifié',
                message: data.message,
                is_urgent: data.urgent === true,
                created_at: new Date().toISOString(),
                statut: 'Reçue',
                client_id: client.id,
                // AJOUT : On sauvegarde les infos directement dans la demande (Snapshot)
                nom_client: data.nom,
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

        // 4. ENVOI DES EMAILS (Double envoi)
        
        // --- Mail 1 : NOTIFICATION POUR VOUS (Admin) ---
        console.log("📧 Tentative d'envoi NOTIFICATION à : contact@anabyo.com");
        try {
            await resend.emails.send({
                from: 'AnaByo <contact@anabyo.com>',
                to: 'contact@anabyo.com',
                subject: `[ALERTE] Nouveau dossier ${trackingId} - ${data.type_projet}`,
                html: `
                    <h2>Nouvelle demande de projet</h2>
                    <p><strong>Client :</strong> ${data.nom} (${data.contact})</p>
                    <p><strong>Email :</strong> ${data.email}</p>
                    <p><strong>Urgent :</strong> ${data.urgent ? 'OUI' : 'Non'}</p>
                    <p><strong>Message :</strong></p>
                    <p>${data.message.replace(/\n/g, '<br>')}</p>
                `
            });
            console.log("✅ Notification Admin envoyée.");
        } catch (e) {
            console.error("❌ Erreur Notification Admin :", e.message);
        }

        // --- Mail 2 : CONFIRMATION POUR LE CLIENT ---
        console.log("📧 Tentative d'envoi CONFIRMATION à :", data.email);
        try {
            await resend.emails.send({
                from: 'AnaByo <contact@anabyo.com>',
                to: data.email,
                subject: `Confirmation de réception - Dossier ${trackingId}`,
                html: `
                    <p>Bonjour ${data.contact || data.nom},</p>
                    <p>Nous accusons réception de votre demande <strong>${data.type_projet}</strong>.</p>
                    <p>Votre numéro de dossier est : <strong>${trackingId}</strong></p>
                    <p>Nous revenons vers vous sous 24h ouvrées.</p>
                    <p>Cordialement,<br>L'équipe AnaByo</p>
                `
            });
            console.log("✅ Confirmation Client envoyée.");
        } catch (e) {
            console.error("❌ Erreur Confirmation Client :", e.message);
        }

        return { statusCode: 200, body: JSON.stringify({ message: "Succès", tracking_id: trackingId }) };

    } catch (error) {
        console.error("ERREUR SERVEUR:", error);
        return { statusCode: 500, body: JSON.stringify({ error: error.message }) };
    }
};