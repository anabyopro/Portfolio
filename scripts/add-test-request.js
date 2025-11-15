// Fichier : scripts/add-test-request.js

const path = require('path');
// Charge les variables du fichier .env
// On construit un chemin absolu vers le fichier .env qui est à la racine du projet site_web
require('dotenv').config({ path: path.resolve(__dirname, '..', '.env') }); 
const { createClient } = require('@supabase/supabase-js');
const crypto = require('crypto');

// Les données de notre fausse demande
const testRequest = {
    nom_client: 'Dr. Marie Curie',
    email_client: 'marie.curie@institut-radium.fr',
    message: 'Ceci est une demande de test générée par un script.',
    type_demande: 'Essai gratuit',
};

async function addTestRequest() {
    console.log('Tentative de connexion à Supabase...');

    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseServiceKey = process.env.SUPABASE_SERVICE_KEY;

    if (!supabaseUrl || !supabaseServiceKey) {
        console.error('Erreur: Les variables SUPABASE_URL et SUPABASE_SERVICE_KEY doivent être définies dans le fichier .env');
        return;
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey);
    const tracking_id = `ANA-TEST-${crypto.randomBytes(2).toString('hex').toUpperCase()}`;

    console.log(`Ajout de la demande de test avec l'ID: ${tracking_id}`);

    const { data, error } = await supabase
        .from('demandes_clients')
        .insert({
            ...testRequest,
            tracking_id: tracking_id,
        })
        .select();

    if (error) {
        console.error('Erreur lors de l\'insertion dans Supabase:', error.message);
    } else {
        console.log('✅ Succès ! La demande suivante a été ajoutée :');
        console.log(data[0]);
    }
}

// On lance la fonction
addTestRequest();
