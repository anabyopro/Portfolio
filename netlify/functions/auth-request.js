// Fichier : netlify/functions/auth-request.js
const { createClient } = require('@supabase/supabase-js');
const { Resend } = require('resend');

exports.handler = async function(event) {
    if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method Not Allowed' };

    const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
    const resend = new Resend(process.env.RESEND_API_KEY);

    try {
        const { email } = JSON.parse(event.body);
        if (!email) return { statusCode: 400, body: JSON.stringify({ error: "Email manquant." }) };

        // 1. Vérifier si le client existe (en utilisant l'email en minuscules pour la robustesse)
        const { data: client, error: selectError } = await supabase
            .from('clients_identite')
            .select('id, nom_complet')
            .ilike('email', email) // Utilisation de ilike pour trouver l'email peu importe les majuscules
            .single();

        // On gère l'erreur de recherche (si ce n'est pas "ligne non trouvée")
        if (selectError && selectError.code !== 'PGRST116') { // PGRST116 = "ligne non trouvée" (normal)
             console.error("Erreur Supabase SELECT:", selectError);
             throw new Error("Erreur base de données.");
        }
        
        // --- Si le client n'existe pas ou la requête a échoué ---
        if (!client) {
            console.warn(`Tentative d'auth pour email inconnu: ${email}`);
            // On renvoie un succès de façade pour ne pas révéler si le compte existe (sécurité)
            return { statusCode: 200, body: JSON.stringify({ message: "Code envoyé si le compte existe." }) };
        }

        // 2. Générer et Sauvegarder le code temporaire
        const code = Math.floor(100000 + Math.random() * 900000).toString();
        const expiresAt = new Date(Date.now() + 15 * 60 * 1000).toISOString();

        const { error: updateError } = await supabase
            .from('clients_identite')
            .update({ auth_code: code, auth_code_expires: expiresAt, failed_auth_attempts: 0 })
            .eq('id', client.id);
        
        if (updateError) throw new Error("Erreur base de données (sauvegarde code).");


        // 3. Envoyer le mail via Resend
        await resend.emails.send({
            from: 'AnaByo <contact@anabyo.com>',
            to: [email],
            subject: 'Votre code de connexion à l\'Espace Client AnaByo',
            html: `
                <p>Bonjour ${client.nom_complet || 'Cher Client'},</p>
                <p>Voici votre code pour accéder à votre espace client :</p>
                <h2 style="letter-spacing: 5px; color: #0369a1; font-size: 24px;">${code}</h2>
                <p>Ce code est valable 15 minutes.</p>
            `
        });

        return { statusCode: 200, body: JSON.stringify({ message: "Code envoyé." }) };

    } catch (error) {
        // Log l'erreur exacte dans le terminal pour le débogage
        console.error("ERREUR CRITIQUE AUTH-REQUEST:", error.message);
        return { statusCode: 500, body: JSON.stringify({ error: "Erreur interne du serveur. Veuillez réessayer." }) };
    }
};