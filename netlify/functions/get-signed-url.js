// Fichier : netlify/functions/get-signed-url.js
const { createClient } = require('@supabase/supabase-js');

exports.handler = async function(event) {
    if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method Not Allowed' };

    const { id } = JSON.parse(event.body);
    const password = event.headers['x-admin-password'];

    // Vérification de sécurité (comme pour les autres fonctions admin)
    if (process.env.ADMIN_PASSWORD && password !== process.env.ADMIN_PASSWORD) {
         return { statusCode: 401, body: JSON.stringify({ error: "Accès refusé" }) };
    }

    const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

    try {
        // 1. Récupérer le chemin du fichier
        const { data: req, error } = await supabase
            .from('demandes_clients')
            .select('facture_url')
            .eq('id', id)
            .single();

        if (error || !req || !req.facture_url) {
            return { statusCode: 404, body: JSON.stringify({ error: "Fichier introuvable" }) };
        }

        // 2. Générer l'URL signée (valide 1 heure)
        const { data, error: signError } = await supabase
            .storage
            .from('documents') // Assurez-vous que c'est bien le nom de votre bucket
            .createSignedUrl(req.facture_url, 3600);

        if (signError) throw signError;

        return { statusCode: 200, body: JSON.stringify({ url: data.signedUrl }) };
    } catch (e) {
        console.error(e);
        return { statusCode: 500, body: JSON.stringify({ error: e.message }) };
    }
};
