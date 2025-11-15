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
  const params = new URLSearchParams(event.body);
  const formData = Object.fromEntries(params.entries());

  const { "full-name": fullName, email, message, laboratory, "Traitement Urgent": urgent, subject: formSubject, fonction, adresse } = formData;
  const subject = formData.subject || 'Nouvelle demande depuis le site';

  try {
    console.log('Form data received:', formData);

    // --- ÉTAPE 1: Enregistrer la demande dans Supabase ---
    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseServiceKey = process.env.SUPABASE_SERVICE_KEY; // On utilise la clé service pour écrire
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Générer un identifiant de suivi unique
    const tracking_id = `ANA-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;

    const { error: supabaseError } = await supabase
      .from('demandes_clients')
      .insert({
        tracking_id: tracking_id,
        nom_client: laboratory, // Le nom du client est maintenant le laboratoire
        representant: fullName, // Le nom du contact est le représentant
        email_client: email,
        message: message,
        fonction: fonction,
        adresse: adresse,
        type_demande: formSubject.includes('essai') ? 'Essai gratuit' : 'Devis',
        treatment_details: null, // Ce champ n'est plus utilisé
        is_urgent: urgent && urgent.startsWith('Oui'), // Sera true si la case est cochée
        // Le statut 'Reçue' est la valeur par défaut dans la DB, pas besoin de le spécifier
      });

    if (supabaseError) {
      console.error('Supabase insert error:', supabaseError);
      // Si l'écriture dans la base de données échoue, on arrête tout.
      throw new Error(`Erreur lors de l'enregistrement dans la base de données : ${supabaseError.message}`);
    } else {
      console.log(`Request ${tracking_id} saved to Supabase.`);
    }


    // --- ÉTAPE 2: Envoyer les emails de notification ---

    // On prépare les deux emails à envoyer
    const notificationEmail = {
      from: 'AnaByo <onboarding@resend.dev>', // TODO: Remplacer une fois le domaine vérifié
      to: ['anabyopro@gmail.com'],
      subject: `[NOTIFICATION] ${subject}`,
      html: `
        <h1>${subject}</h1>
        <p><strong>Nom :</strong> ${fullName}</p>
        <p><strong>Laboratoire :</strong> ${laboratory || 'Non spécifié'}</p>
        <p><strong>Email :</strong> ${email}</p>
        <p><strong>Fonction :</strong> ${fonction || 'Non spécifié'}</p>
        <p><strong>Urgent :</strong> ${urgent || 'Non'}</p>
        <hr>
        <h3>Message :</h3>
        <p>${message.replace(/\n/g, '<br>')}</p>
      `,
    };

    const confirmationEmail = {
      from: 'AnaByo <onboarding@resend.dev>', // TODO: Remplacer une fois le domaine vérifié
      to: [email],
      subject: 'Confirmation de votre demande chez AnaByo',
      html: `<p>Bonjour ${fullName},</p><p>Merci de nous avoir contactés !</p><p>Nous avons bien reçu votre demande et nous vous répondrons sous 24 heures ouvrées.</p><p>Votre numéro de suivi est le : <strong>${tracking_id}</strong>.</p><p>Vous pouvez suivre l'avancement de votre demande à tout moment en cliquant sur le lien ci-dessous et en y indiquant votre numéro de suivi:</p><p><a href="${process.env.URL}/suivi.html" style="font-weight: bold;">Suivre ma demande</a></p><p>À très bientôt,<br>L'équipe AnaByo</p>`,

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

    console.log('Redirecting to /remerciement.html');
    // 3. Redirection vers une page de remerciement après succès
    // Assurez-vous d'avoir une page "remerciement.html" sur votre site
    return {
      statusCode: 302,
      headers: {
        Location: '/remerciement.html', // Vous pouvez créer cette page
      },
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
