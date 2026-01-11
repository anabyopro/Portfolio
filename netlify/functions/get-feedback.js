// Fichier : netlify/functions/get-feedbacks.js
const { createClient } = require('@supabase/supabase-js');

exports.handler = async function(event, context) {
    // Ce endpoint est public, pas besoin d'authentification admin.
    if (event.httpMethod !== 'GET') {
        return { statusCode: 405, body: 'Method Not Allowed' };
    }

    // On utilise la clé publique (anon key) car c'est une lecture de données publiques.
    const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

    try {
        const { data, error } = await supabase
            .from('client_feedback')
            .select('rating, comment, created_at')
            .eq('is_published', true) // On ne récupère que les avis publiés
            .order('created_at', { ascending: false }); // Les plus récents en premier

        if (error) {
            throw error;
        }

        return {
            statusCode: 200,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data)
        };

    } catch (error) {
        console.error("Erreur lors de la récupération des avis:", error);
        return { statusCode: 500, body: JSON.stringify({ error: 'Erreur interne du serveur.' }) };
    }
};
