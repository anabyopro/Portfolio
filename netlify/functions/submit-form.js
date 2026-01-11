// Fichier : netlify/functions/submit-form.js

const { createClient } = require('@supabase/supabase-js');
const crypto = require('crypto');
// On importe la librairie Resend pour envoyer les emails
const { Resend } = require('resend');

// La fonction principale qui sera exécutée par Netlify
exports.handler = async function (event, context) {
  // On ne traite que les requêtes POST venant du formulaire
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  // Vérification cruciale : la clé API est-elle disponible ?
  if (!process.env.RESEND_API_KEY) {
    console.error('Resend API Key is not set in environment variables.');
    return { statusCode: 500, body: 'Server configuration error: Missing API Key.' };
  }

  // Initialisation de Resend avec la clé API stockée dans les variables d'environnement de Netlify
  const resend = new Resend(process.env.RESEND_API_KEY);

  // On parse les données du formulaire envoyées
  let formData;
  try {
      // On essaie de parser du JSON (cas du nouveau formulaire)
      formData = JSON.parse(event.body);
  } catch (e) {
      // Fallback pour les anciens formulaires classiques
      const params = new URLSearchParams(event.body);
      formData = Object.fromEntries(params.entries());
  }

  // Mapping des champs envoyés par index.html (JSON) vers les variables du script
  const { nom, contact, email, message, fonction, adresse, telephone, urgent, type_projet } = formData;
  
  // Variables normalisées
  const fullName = contact || nom || 'Client';
  const laboratory = nom || 'Non spécifié';
  const subject = type_projet || 'Nouvelle demande';

  try {
    console.log('Form data received:', formData);

    // --- ÉTAPE 1: Enregistrer la demande dans Supabase ---
    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseServiceKey = process.env.SUPABASE_SERVICE_KEY; // On utilise la clé service pour écrire
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // 1. Gestion de l'identité client (comme dans submit-request.js)
    let { data: client } = await supabase.from('clients_identite').select('id').eq('email', email).single();

    if (!client) {
        const { data: newClient, error: clientError } = await supabase
            .from('clients_identite')
            .insert({
                email: email,
                nom_complet: laboratory, // Le nom du labo est le nom du client
                representant: fullName, // Le nom du contact est le représentant
                fonction: fonction,
                adresse: adresse,
                telephone: telephone
            })
            .select('id').single();
        
        if (clientError) throw clientError;
        client = newClient;
    }

    // Générer un identifiant de suivi unique
    const tracking_id = `ANA-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;

    // 2. Création de la mission avec la bonne structure
    const { data: newRequest, error: supabaseError } = await supabase
      .from('demandes_clients')
      .insert({
        tracking_id: tracking_id,
        message: message,
        type_demande: subject,
        is_urgent: Boolean(urgent), // Conversion explicite en booléen
        created_at: new Date().toISOString(), // On garantit un format de date standard
        statut: 'Reçue',
        client_id: client.id, // On lie la demande à l'identité du client
        // On sauvegarde aussi les infos snapshot dans la demande
        nom_client: laboratory,
        contact: fullName,
        fonction: fonction,
        adresse: adresse,
        telephone: telephone
      })
      .select() // On demande à Supabase de retourner la ligne créée
      .single(); // On s'attend à un seul résultat

    if (supabaseError) {
      console.error('Supabase insert error:', supabaseError);
      // Si l'écriture dans la base de données échoue, on arrête tout.
      throw new Error(`Erreur lors de l'enregistrement dans la base de données : ${supabaseError.message}`);
    } else if (newRequest) {
      // Log l'événement de création dans la nouvelle table mission_events
      await supabase.from('mission_events').insert({
        request_id: newRequest.id,
        event_type: 'Création',
        description: `La demande a été créée par le client via le formulaire.`,
        metadata: {
          source: 'formulaire-contact',
          subject: subject
        }
      });
      console.log(`Event 'Création' logged for request ${newRequest.id}`);
    } else {
      console.log(`Request ${tracking_id} saved to Supabase.`);
    }


    // --- ÉTAPE 2: Envoyer les emails de notification ---

    // On prépare les deux emails à envoyer
    const notificationEmail = {
      from: 'AnaByo <contact@anabyo.com>',
      to: ['anabyopro@gmail.com'],
      subject: `[NOTIFICATION] ${subject}`,
      html: `
        <h1>${subject}</h1>
        <p><strong>Nom :</strong> ${fullName}</p>
        <p><strong>Laboratoire :</strong> ${laboratory || 'Non spécifié'}</p>
        <p><strong>Email :</strong> ${email}</p>
        <p><strong>Fonction :</strong> ${fonction || 'Non spécifié'}</p>
        <p><strong>Téléphone :</strong> ${telephone || 'Non spécifié'}</p>
        <p><strong>Urgent :</strong> ${urgent ? 'OUI' : 'Non'}</p>
        <hr>
        <h3>Message :</h3>
        <p>${message.replace(/\n/g, '<br>')}</p>
      `,
    };

    const confirmationEmail = {
      from: 'AnaByo <contact@anabyo.com>',
      to: [email],
      subject: 'Confirmation de votre demande chez AnaByo',
      html: `<p>Bonjour ${fullName},</p><p>Merci de nous avoir contactés !</p><p>Nous avons bien reçu votre demande et nous vous répondrons sous 24 heures ouvrées.</p><p>Votre numéro de suivi est le : <strong>${tracking_id}</strong>.</p><p>Vous pouvez suivre l'avancement de votre demande et consulter l'historique de vos dossiers à tout moment en vous connectant à votre espace client :</p><p><a href="https://anabyo.com/espace-client.html" style="font-weight: bold;">Accéder à mon Espace Client</a></p><p>À très bientôt,<br>L'équipe AnaByo</p>`,

    };

    // On envoie les deux emails en parallèle pour plus d'efficacité
    const emailPromises = [
      resend.emails.send(notificationEmail)
    ];

    // On ajoute l'email de confirmation à envoyer au client
    emailPromises.push(resend.emails.send(confirmationEmail));
    // Promise.allSettled attend que toutes les promesses soient terminées (succès ou échec)
    const results = await Promise.allSettled(emailPromises);

    // On vérifie le résultat de chaque envoi
    results.forEach((result, index) => {
      const emailType = index === 0 ? 'Notification' : 'Confirmation';
      if (result.status === 'fulfilled') {
        console.log({ level: 'info', message: `Resend ${emailType} email success`, data: result.value });
      } else {
        console.error({ level: 'error', message: `Resend ${emailType} email failed`, error: result.reason });
      }
    });

    // 3. Réponse JSON succès (le front-end gère la redirection)
    return {
      statusCode: 200,
      body: JSON.stringify({ message: 'Demande envoyée avec succès', tracking_id }),
    };

  } catch (error) {
    // En cas d'erreur, on affiche l'erreur dans les logs de Netlify
    // et on retourne une erreur
    console.error({ error });
    return {
      statusCode: 500,
      body: `Oops, une erreur est survenue: ${error.message}.`,
    };
  }
};
