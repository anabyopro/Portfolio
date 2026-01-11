// Fichier : netlify/functions/get-request-history.js

const { createClient } = require('@supabase/supabase-js');

exports.handler = async function(event) {
    // On accepte uniquement les requêtes GET
    if (event.httpMethod !== 'GET') {
        return { statusCode: 405, body: 'Method Not Allowed' };
    }

    // 1. Authentification
    const correctPassword = process.env.ADMIN_PASSWORD;
    const providedPassword = event.headers['x-admin-password'];

    if (!providedPassword || providedPassword !== correctPassword) {
        return { statusCode: 401, body: JSON.stringify({ error: "Accès non autorisé." }) };
    }

    // 2. Récupération de l'ID de la demande depuis les paramètres de l'URL
    const requestId = event.queryStringParameters.id;
    if (!requestId) {
        return { statusCode: 400, body: JSON.stringify({ error: "ID de la demande manquant." }) };
    }

    // 3. Connexion à Supabase
    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseServiceKey = process.env.SUPABASE_SERVICE_KEY;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    try {
        // 4. Récupérer tous les événements pour cette demande, triés du plus récent au plus ancien
        const { data, error } = await supabase
            .from('mission_events')
            .select('created_at, event_type, description')
            .eq('request_id', requestId)
            .order('created_at', { ascending: false });

        if (error) throw error;

        return { statusCode: 200, headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) };
    } catch (error) {
        console.error("Erreur lors de la récupération de l'historique:", error);
        return { statusCode: 500, body: JSON.stringify({ error: "Impossible de récupérer l'historique." }) };
    }
};