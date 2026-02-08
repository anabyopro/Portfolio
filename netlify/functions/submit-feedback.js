const { createClient } = require('@supabase/supabase-js');

exports.handler = async function(event) {
    if (event.httpMethod !== 'POST') {
        return { statusCode: 405, body: 'Method Not Allowed' };
    }

    const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

    try {
        const data = JSON.parse(event.body);
        const { missionId, rating, comment, consent } = data;

        if (!missionId || !rating) {
            return { statusCode: 400, body: JSON.stringify({ error: "Données manquantes." }) };
        }

        // 1. Vérifier si un avis existe déjà pour cette mission
        // On utilise select() sans single() pour récupérer un tableau et éviter les erreurs si 0 ou >1 résultats
        const { data: existing } = await supabase
            .from('client_feedback')
            .select('id')
            .eq('request_id', missionId);

        if (existing && existing.length > 0) {
            return { 
                statusCode: 409, 
                body: JSON.stringify({ error: "Un avis a déjà été enregistré pour cette mission." }) 
            };
        }

        // 2. Insertion
        const { error: insertError } = await supabase
            .from('client_feedback')
            .insert({
                request_id: missionId,
                rating: parseInt(rating),
                comment: comment,
                is_anonymous: consent,
                is_published: false // Modération par défaut
            });

        if (insertError) throw insertError;

        return { statusCode: 200, body: JSON.stringify({ message: "Avis enregistré." }) };

    } catch (error) {
        console.error("Erreur submit-feedback:", error);
        // Gestion du cas où la contrainte unique de la BDD est déclenchée (race condition)
        if (error.code === '23505') {
             return { statusCode: 409, body: JSON.stringify({ error: "Un avis a déjà été enregistré." }) };
        }
        return { statusCode: 500, body: JSON.stringify({ error: "Erreur serveur." }) };
    }
};