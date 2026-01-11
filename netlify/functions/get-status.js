const { createClient } = require('@supabase/supabase-js');

exports.handler = async function(event) {
    // Cette fonction est publique, pas de vérification de mot de passe.

    // On récupère l'ID depuis les paramètres de l'URL (?id=...)
    const trackingId = event.queryStringParameters.id;

    if (!trackingId) {
        return {
            statusCode: 400, // Bad Request
            body: JSON.stringify({ error: "Un identifiant de suivi est requis." }),
        };
    }

    // Connexion à Supabase avec la clé publique (anon)
    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_KEY;
    const supabase = createClient(supabaseUrl, supabaseKey);

    try {
        const { data, error } = await supabase
            .from('demandes_clients')
            // On effectue une jointure pour récupérer le nom du client et on utilise la bonne colonne de date
            .select(`
                statut, 
                created_at,
                clients_identite ( nom_complet )
            `)
            .eq('tracking_id', trackingId)
            .single();

        if (error || !data) {
            // Si .single() ne trouve rien, il renvoie une erreur.
            console.warn(`Demande non trouvée pour l'ID: ${trackingId}`, error);
            return {
                statusCode: 404, // Not Found
                body: JSON.stringify({ error: "Demande non trouvée." }),
            };
        }

        // On "aplatit" les données pour simplifier leur utilisation côté client.
        const formattedData = {
            statut: data.statut,
            // On renomme created_at en date_creation pour la cohérence, et on récupère le nom du client.
            date_creation: data.created_at,
            nom_client: data.clients_identite ? data.clients_identite.nom_complet : 'Client'
        };

        return {
            statusCode: 200,
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(formattedData),
        };
    } catch (error) {
        console.error("Erreur d'accès à la base de données:", error);
        return {
            statusCode: 500,
            body: JSON.stringify({ error: "Impossible de récupérer le statut de la demande." }),
        };
    }
};