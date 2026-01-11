const { createClient } = require('@supabase/supabase-js');

// Configuration de la connexion Supabase
const supabaseUrl = process.env.SUPABASE_URL;
// CORRECTION : On utilise SUPABASE_KEY en secours si SUPABASE_SERVICE_ROLE_KEY est absent
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY;

// On passe une chaîne vide par défaut pour éviter le crash immédiat au démarrage si aucune clé n'est trouvée
const supabase = createClient(supabaseUrl, supabaseKey || 'fallback-key');

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;

exports.handler = async (event, context) => {
  // 1. Vérifier la méthode HTTP
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  // 2. Vérifier le mot de passe admin
  const headers = event.headers;
  if (headers['x-admin-password'] !== ADMIN_PASSWORD) {
    return { statusCode: 401, body: JSON.stringify({ error: 'Unauthorized' }) };
  }

  // Vérification de sécurité explicite
  if (!supabaseKey) {
    console.error("Erreur : Aucune clé Supabase trouvée (ni SERVICE_ROLE_KEY ni SUPABASE_KEY).");
    return { statusCode: 500, body: JSON.stringify({ error: 'Erreur configuration serveur : Clé API manquante.' }) };
  }

  try {
    // 3. Récupérer les données envoyées par le formulaire
    const data = JSON.parse(event.body);
    
    // Extraction des champs (y compris ceux ajoutés récemment)
    const { id, nom, email, contact, fonction, adresse, telephone, type_projet, message, urgent } = data;

    if (!id) {
      return { statusCode: 400, body: JSON.stringify({ error: 'ID manquant' }) };
    }

    // 4. Mise à jour dans la base de données
    const { error } = await supabase
      .from('demandes_clients')
      .update({
        nom_client: nom,
        email: email,
        contact: contact,
        fonction: fonction,
        adresse: adresse,
        telephone: telephone,
        type_projet: type_projet,
        message: message,
        is_urgent: urgent
      })
      .eq('id', id);

    if (error) throw error;

    return { statusCode: 200, body: JSON.stringify({ message: 'Informations mises à jour avec succès' }) };

  } catch (error) {
    console.error('Erreur update:', error);
    return { statusCode: 500, body: JSON.stringify({ error: 'Erreur serveur lors de la mise à jour: ' + error.message }) };
  }
};