// Fichier : netlify/functions/auth-verify.js
const { createClient } = require('@supabase/supabase-js');

const MAX_ATTEMPTS = 5; 

exports.handler = async function(event) {
    if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method Not Allowed' };

    const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

    try {
        const { email, code } = JSON.parse(event.body);

        const { data: client } = await supabase
            .from('clients_identite')
            .select('id, auth_code, auth_code_expires, nom_complet, adresse, fonction, failed_auth_attempts') 
            .ilike('email', email)
            .single();

        if (!client) {
            return { statusCode: 401, body: JSON.stringify({ error: "Code invalide." }) };
        }

        const currentAttempts = client.failed_auth_attempts || 0;
        
        // Blocage total
        if (currentAttempts >= MAX_ATTEMPTS) {
            return { statusCode: 403, body: JSON.stringify({ error: `Trop de tentatives. Veuillez demander un nouveau code.` }) };
        }
        
        // Logique d'erreur avec compteur
        if (client.auth_code !== code || new Date(client.auth_code_expires) < new Date()) {
            
            const newAttempts = currentAttempts + 1;
            const remaining = MAX_ATTEMPTS - newAttempts;
            
            await supabase.from('clients_identite').update({ failed_auth_attempts: newAttempts }).eq('id', client.id);
            
            return { 
                statusCode: 401, 
                body: JSON.stringify({ 
                    error: "Code incorrect.",
                    remainingAttempts: remaining 
                }) 
            };
        }

        await supabase.from('clients_identite').update({ auth_code: null, auth_code_expires: null, failed_auth_attempts: 0 }).eq('id', client.id);

        // 3. Récupération des missions
        // On récupère le "path" (chemin) stocké dans facture_url
        const { data: missions } = await supabase
            .from('demandes_clients')
            .select('tracking_id, statut, type_demande, created_at, is_urgent, facture_url, pvd_url')
            .eq('client_id', client.id)
            .order('created_at', { ascending: false });

        // 4. GÉNÉRATION DES URLS SIGNÉES (SÉCURITÉ)
        // On transforme les chemins de fichiers en liens temporaires valables 1h (3600s)
        
        const missionsWithLinks = await Promise.all(missions.map(async (m) => {
            let signedUrl = null;
            let signedPvdUrl = null;

            // URL signée pour la facture
            if (m.facture_url) {
                // On demande à Supabase une URL temporaire pour ce fichier privé
                const { data: signedData, error: signError } = await supabase
                    .storage
                    .from('documents') // Nom de votre bucket privé
                    .createSignedUrl(m.facture_url, 3600); // Lien valide 1 heure
                if (signedData) {
                    signedUrl = signedData.signedUrl;
                }
            }

             // URL signée pour le PVD (basée sur la colonne BDD)
            if (m.pvd_url) {
                const { data: signedPvdData } = await supabase
                    .storage
                    .from('documents')
                    .createSignedUrl(m.pvd_url, 3600);
                
                const signedPvdUrl = signedPvdData ? signedPvdData.signedUrl : null;
                return { ...m, facture_url: signedUrl,
                pvd_url: signedPvdUrl // Ajout du lien PVD
            };
        }));

        return { 
            statusCode: 200, 
            body: JSON.stringify({ 
               clientName: client.nom_complet,
                clientAddress: client.adresse, 
                clientFunction: client.fonction,
                missions: missionsWithLinks // On renvoie la liste avec les liens sécurisés
            }) 
        };

    } catch (error) {
        console.error("Erreur:", error.message);
        return { statusCode: 500, body: JSON.stringify({ error: "Erreur serveur." }) };
    }
};