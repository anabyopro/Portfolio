const { createClient } = require('@supabase/supabase-js');
const { Resend } = require('resend');

exports.handler = async function(event) {
    // On accepte uniquement les requêtes POST
    if (event.httpMethod !== 'POST') {
        return { statusCode: 405, body: 'Method Not Allowed' };
    }

    // 1. Authentification (comme pour la lecture)
    const correctPassword = process.env.ADMIN_PASSWORD;
    const providedPassword = event.headers['x-admin-password'];

    if (!providedPassword || providedPassword !== correctPassword) {
        return {
            statusCode: 401,
            body: JSON.stringify({ error: "Accès non autorisé." }),
        };
    }

    // 2. Connexion à Supabase avec la clé de service (qui a les droits d'écriture)
    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseServiceKey = process.env.SUPABASE_SERVICE_KEY;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    try {
        // 3. Récupération des informations envoyées par la page admin
        const { id, newStatus, bluefilesLink } = JSON.parse(event.body);

        if (!id || !newStatus) {
            return { statusCode: 400, body: JSON.stringify({ error: "ID de la demande ou nouveau statut manquant." }) };
        }

        // Si l'action est "Ajouter au .json"
        if (newStatus === 'json') {
            const { data: requestData, error: fetchError } = await supabase
                .from('demandes_clients')
                .select('*')
                .eq('id', id)
                .single();

            if (fetchError) throw fetchError;

            // Construire l'objet JSON pour le devis
            const configUpdate = {
                client: {
                    nom_complet: requestData.nom_client, // Nom du laboratoire
                    representant: requestData.representant, // Nom du contact
                    fonction: requestData.fonction,
                    adresse: requestData.adresse,
                    email: requestData.email_client
                },
                devis: {
                    taches: (requestData.treatment_details || []).map(t => ({
                        description: t.type,
                        quantite: t.count,
                        prix_unitaire: 30.0 // Prix par défaut, à ajuster manuellement
                    })),
                    notes: "Devis valable 30 jours. Paiement à 30 jours nets.",
                    _priority: requestData.is_urgent ? "1" : "0"
                }
            };

            return { statusCode: 200, body: JSON.stringify(configUpdate) };
        }

        // Si la demande est refusée, on envoie un email et on supprime la ligne
        if (newStatus === 'Refusée') {
            // D'abord, récupérer les infos du client pour lui envoyer un email
            const { data: requestData, error: fetchError } = await supabase
                .from('demandes_clients')
                .select('nom_client, email_client, tracking_id')
                .eq('id', id)
                .single();

            if (fetchError) throw fetchError;

            // Envoyer l'email de refus
            const resend = new Resend(process.env.RESEND_API_KEY);
            await resend.emails.send({
                from: 'AnaByo <onboarding@resend.dev>',
                to: [requestData.email_client],
                subject: 'Concernant votre demande chez AnaByo',
                html: `
                    <p>Bonjour ${requestData.nom_client},</p>
                    <p>Après examen de votre demande (ID: ${requestData.tracking_id}), nous vous informons qu'elle ne pourra malheureusement pas être traitée car elle ne correspond pas aux services proposés. Si vous pensez qu'il s'agit d'une erreur de notre part, merci de créer une nouvelle demande.</p>
                    <p>Nous vous remercions de votre compréhension.</p>
                    <p>Cordialement,<br>L'équipe AnaByo</p>
                `,
            });

            // Ensuite, supprimer la demande
            const { error: deleteError } = await supabase.from('demandes_clients').delete().eq('id', id);
            if (deleteError) throw deleteError;
            return {
                statusCode: 200,
                body: JSON.stringify({ message: "Demande refusée et supprimée avec succès." }),
            };
        }

        // 4. Exécution de la mise à jour dans la base de données
        const { data, error } = await supabase
            .from('demandes_clients')
            .update({ statut: newStatus })
            .eq('id', id) // On met à jour la ligne avec le bon ID
            .select('*') // On sélectionne tout pour avoir toutes les infos pour l'email
            .single(); // On s'attend à une seule ligne

        if (error) {
            // Si une erreur survient, on la lance pour qu'elle soit capturée par le bloc catch
            throw error;
        }

        // 5. Si le nouveau statut est "Acceptée", on envoie un email au client avec le lien BlueFiles
        if (newStatus === 'Acceptée' && data) {
            const resend = new Resend(process.env.RESEND_API_KEY);
            await resend.emails.send({
                from: 'AnaByo <onboarding@resend.dev>',
                to: [data.email_client],
                subject: 'Votre demande a été acceptée !',
                html: ` 
                    <p>Bonjour ${data.nom_client},</p>
                    <p>Bonne nouvelle ! Votre demande (ID: <strong>${data.tracking_id}</strong>) a été acceptée.</p>
                    <p>Pour que je puisse établir un devis précis, je vous invite à déposer vos fichiers de manière sécurisée via le lien ci-dessous. Une fois que j'aurai pu les examiner, je vous enverrai une proposition chiffrée.</p>
                    <p><a href="${bluefilesLink || '#'}" style="font-weight: bold;">Déposer mes fichiers sur BlueFiles</a></p>
                    <p>Vous pouvez continuer à suivre l'état de votre demande sur notre page de suivi.</p>
                    <p>À très bientôt,<br>L'équipe AnaByo</p>
                `,
            });
            console.log(`Email d'acceptation envoyé à ${data.email_client}`);
        }

        // 6. Si le nouveau statut est "Terminée", on envoie un email de finalisation
        if (newStatus === 'Terminée' && data) {
            const resend = new Resend(process.env.RESEND_API_KEY);
            await resend.emails.send({
                from: 'AnaByo <onboarding@resend.dev>',
                to: [data.email_client],
                subject: 'Votre mission est terminée !',
                html: ` 
                    <p>Bonjour ${data.nom_client},</p>
                    <p>Votre mission (ID: <strong>${data.tracking_id}</strong>) est maintenant terminée.</p>
                    <p>Vous pouvez récupérer vos fichiers traités via le lien BlueFiles que nous avons utilisé. La facture correspondante vous parviendra prochainement.</p>
                    <p>Merci pour votre confiance.</p>
                    <p>Cordialement,<br>L'équipe AnaByo</p>
                `,
            });
            console.log(`Email de finalisation envoyé à ${data.email_client}`);
        }

        // 5. Succès : on renvoie la ligne qui a été mise à jour
        return {
            statusCode: 200,
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(data),
        };

    } catch (error) {
        console.error("Erreur lors de la mise à jour du statut:", error);
        return {
            statusCode: 500,
            body: JSON.stringify({ error: "Impossible de mettre à jour la demande." }),
        };
    }
};