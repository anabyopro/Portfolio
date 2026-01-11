const { createClient } = require('@supabase/supabase-js');
const { Resend } = require('resend'); // IMPORTANT

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
            // Si le client existe déjà, on met à jour ses infos avec celles du formulaire actuel
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
                type_demande: data.type_projet, // Doit correspondre au name="type_projet" du HTML
                message: data.message,
                is_urgent: data.urgent === true,
                created_at: new Date().toISOString(), // On garantit un format de date standard
                statut: 'Reçue',
                client_id: client.id
            })
            .select().single();

        if (errMission) throw errMission;

        // 3. Log
        await supabase.from('mission_events').insert({
            request_id: mission.id,
            event_type: 'Création',
            description: 'Demande reçue via le formulaire web.'
        });

        // 4. ENVOI EMAIL CONFIRMATION (Le retour !)
        console.log("📧 Tentative d'envoi email à :", data.email);
        try {
            await resend.emails.send({
                from: 'AnaByo <contact@anabyo.com>',
                to: [data.email],
                subject: `Confirmation de réception - Dossier ${trackingId}`,
                html: `
                    <p>Bonjour ${data.contact || data.nom},</p>
                    <p>Nous accusons réception de votre demande de projet <strong>${data.type_projet}</strong>.</p>
                    <p>Votre numéro de dossier est : <strong>${trackingId}</strong></p>
                    <p>Nous allons étudier vos éléments et revenir vers vous sous 24h ouvrées.</p>
                    <p>Cordialement,<br>L'équipe AnaByo</p>
                `
            });
            console.log("✅ Email envoyé avec succès.");
        } catch (emailError) {
            console.error("❌ Erreur envoi email :", emailError);
            // On ne bloque pas le succès de la demande si le mail échoue (ex: quota dépassé)
        }

        return { statusCode: 200, body: JSON.stringify({ message: "Succès", tracking_id: trackingId }) };

    } catch (error) {
        console.error("ERREUR SERVEUR:", error);
        return { statusCode: 500, body: JSON.stringify({ error: "Erreur serveur lors de l'enregistrement." }) };
    }
};