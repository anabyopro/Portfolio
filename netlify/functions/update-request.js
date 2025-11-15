const { createClient } = require('@supabase/supabase-js');

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
        const { id, newStatus } = JSON.parse(event.body);

        if (!id || !newStatus) {
            return { statusCode: 400, body: JSON.stringify({ error: "ID de la demande ou nouveau statut manquant." }) };
        }

        // 4. Exécution de la mise à jour dans la base de données
        const { data, error } = await supabase
            .from('demandes_clients')
            .update({ statut: newStatus })
            .eq('id', id)
            .select(); // .select() pour que Supabase retourne la ligne mise à jour

        if (error) {
            // Si une erreur survient, on la lance pour qu'elle soit capturée par le bloc catch
            throw error;
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