// Fichier : netlify/functions/submit-feedback.js
const { createClient } = require('@supabase/supabase-js');

exports.handler = async function(event, context) {
    // 1. Vérifier la méthode et parser les données
    if (event.httpMethod !== 'POST') {
        return { statusCode: 405, body: 'Method Not Allowed' };
    }

    let data;
    try {
        data = JSON.parse(event.body);
    } catch (error) {
        return { statusCode: 400, body: JSON.stringify({ error: 'Corps de la requête invalide.' }) };
    }

    const { missionId, rating, comment, consent } = data;

    // 2. Valider les données essentielles
    if (!missionId || !rating) {
        return { statusCode: 400, body: JSON.stringify({ error: 'ID de mission ou note manquante.' }) };
    }

    const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

    try {
        // 3. Trouver la mission correspondante via son tracking_id
        const { data: mission, error: missionError } = await supabase
            .from('demandes_clients')
            .select('id') // On a juste besoin de l'ID interne pour la liaison
            .eq('tracking_id', missionId)
            .single();

        if (missionError || !mission) {
            console.error("Erreur ou mission non trouvée pour le tracking_id:", missionId, missionError);
            return { statusCode: 404, body: JSON.stringify({ error: 'Mission introuvable.' }) };
        }

        // 4. Préparer les données pour l'insertion
        const feedbackData = {
            request_id: mission.id, // Clé étrangère liant l'avis à la mission
            tracking_id: missionId, // Pour référence facile
            rating: parseInt(rating, 10),
            comment: comment || null, // S'assurer que c'est null si vide
            is_published: consent === true // Le client a donné son accord
        };

        // 5. Insérer l'avis dans la table 'client_feedback'
        const { error: insertError } = await supabase
            .from('client_feedback')
            .insert(feedbackData);

        if (insertError) {
            throw insertError;
        }

        // 6. Succès !
        return { statusCode: 200, body: JSON.stringify({ message: 'Avis enregistré avec succès.' }) };

    } catch (error) {
        console.error("Erreur lors de l'enregistrement de l'avis:", error);
        return { statusCode: 500, body: JSON.stringify({ error: 'Erreur interne du serveur.' }) };
    }
};