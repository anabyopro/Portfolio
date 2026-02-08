// Fichier : netlify/functions/get-feedbacks.js
const { createClient } = require('@supabase/supabase-js');

exports.handler = async function(event, context) {
    if (event.httpMethod !== 'GET') {
        return { statusCode: 405, body: 'Method Not Allowed' };
    }

    // On utilise la clé SERVICE pour pouvoir faire la jointure avec 'demandes_clients'
    // (qui est souvent protégée) afin de récupérer le nom du client.
    const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

    try {
        const { data, error } = await supabase
            .from('client_feedback')
            .select(`
                rating, 
                comment, 
                created_at, 
                is_anonymous,
                demandes_clients (
                    nom_client,
                    contact
                )
            `)
            .eq('is_published', true) // On ne récupère que les avis publiés
            .order('created_at', { ascending: false }); // Les plus récents en premier

        if (error) throw error;

        // On formate les données pour le frontend
        const formattedData = data.map(item => {
            // Si l'avis est anonyme, on ne renvoie PAS les infos personnelles (Sécurité)
            if (item.is_anonymous) {
                return { ...item, nom_client: null, contact: null };
            }
            // Sinon, on "aplatit" l'objet pour que le HTML puisse lire 'item.nom_client' directement
            return {
                ...item,
                nom_client: item.demandes_clients?.nom_client,
                contact: item.demandes_clients?.contact
            };
        });

        return {
            statusCode: 200,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(formattedData)
        };

    } catch (error) {
        console.error("Erreur lors de la récupération des avis:", error);
        return { statusCode: 500, body: JSON.stringify({ error: 'Erreur interne du serveur.' }) };
    }
};
