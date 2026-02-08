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

        // 0. Récupérer l'UUID interne de la mission à partir du tracking_id (ex: ANA-XXXX)
        const { data: missionData, error: lookupError } = await supabase
            .from('demandes_clients')
            .select('id')
            .eq('tracking_id', missionId)
            .single();

        if (lookupError || !missionData) {
            console.error("Erreur résolution mission (tracking_id invalide):", missionId);
            return { statusCode: 400, body: JSON.stringify({ error: "Référence de mission inconnue." }) };
        }

        const missionUuid = missionData.id;

        // 1. Vérifier si un avis existe déjà pour cette mission
        const { data: existing, error: checkError } = await supabase
            .from('client_feedback')
            .select('id')
            .eq('request_id', missionUuid);

        if (checkError) {
            console.error("Erreur vérification doublon:", checkError);
            return { statusCode: 500, body: JSON.stringify({ error: "Erreur technique lors de la vérification." }) };
        }

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
                request_id: missionUuid,
                rating: parseInt(rating),
                comment: comment,
                is_anonymous: consent,
                is_published: true // Publication directe (mettre à false pour modération)
            });

        if (insertError) throw insertError;

        return { statusCode: 200, body: JSON.stringify({ message: "Avis enregistré." }) };

    } catch (error) {
        console.error("Erreur submit-feedback:", error);
        // Gestion du cas où la contrainte unique de la BDD est déclenchée (race condition)
        if (error.code === '23505') {
             return { statusCode: 409, body: JSON.stringify({ error: "Un avis a déjà été enregistré." }) };
        }
        if (error.code === '23503') { // Violation de clé étrangère (missionId n'existe pas dans demandes_clients)
             return { statusCode: 400, body: JSON.stringify({ error: "Référence de mission inconnue ou invalide." }) };
        }
        return { statusCode: 500, body: JSON.stringify({ error: "Erreur serveur: " + error.message }) };
    }
};