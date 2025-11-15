const { createClient } = require('@supabase/supabase-js');

exports.handler = async function(event) {
    // On récupère le mot de passe depuis les variables d'environnement de Netlify
    const correctPassword = process.env.ADMIN_PASSWORD;
    const providedPassword = event.headers['x-admin-password'];

    if (!providedPassword || providedPassword !== correctPassword) {
        return {
            statusCode: 401, // 401 Unauthorized
            body: JSON.stringify({ error: "Accès non autorisé." }),
        };
    }

    // Connexion à Supabase avec les variables d'environnement
    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_KEY;
    const supabase = createClient(supabaseUrl, supabaseKey);

    try {
        // Récupération des données depuis la table 'demandes_clients'
        const { data: requests, error } = await supabase
            .from('demandes_clients')
            .select('*')
            .order('date_creation', { ascending: false });

        if (error) {
            throw error;
        }

        return {
            statusCode: 200,
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(requests),
        };
    } catch (error) {
        return {
            statusCode: 500,
            body: JSON.stringify({ error: "Impossible de récupérer les demandes." }),
        };
    }
};
