// Fichier : netlify/functions/submit-form.js

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

  const { "full-name": fullName, email, message, laboratory, "Traitement Urgent": urgent } = formData;
  const subject = formData.subject || 'Nouvelle demande depuis le site';

  try {
    console.log('Form data received:', formData);

    // 1. Envoi de l'email de notification à vous-même
    const { data: notifData, error: notifError } = await resend.emails.send({
      from: 'AnaByo <onboarding@resend.dev>',
      to: ['anabyopro@gmail.com'],
      subject: `[NOTIFICATION] ${subject}`, // On ajoute un préfixe pour le différencier
      html: `
        <h1>${subject}</h1>
        <p><strong>Nom :</strong> ${fullName}</p>
        <p><strong>Email :</strong> ${email}</p>
        <p><strong>Laboratoire :</strong> ${laboratory || 'Non spécifié'}</p>
        <p><strong>Urgent :</strong> ${urgent || 'Non'}</p>
        <hr>
        <p><strong>Message :</strong></p>
        <p>${message.replace(/\n/g, '<br>')}</p>
      `,
    });

    if (notifError) {
      console.error({ level: 'error', message: 'Resend notification email failed', error: notifError });
    } else {
      console.log({ level: 'info', message: 'Resend notification email success', data: notifData });
    }

    // 2. Envoi de l'email de confirmation au client
    const { data: confirmData, error: confirmError } = await resend.emails.send({
      from: 'AnaByo <onboarding@resend.dev>',
      to: [email],
      subject: 'Confirmation de votre demande chez AnaByo',
      html: `
        <p>Bonjour ${fullName},</p>
        <p>Merci de nous avoir contactés !</p>
        <p>Nous avons bien reçu votre demande et nous vous répondrons sous 24 heures ouvrées.</p>
        <p>À très bientôt,<br>L'équipe AnaByo</p>
      `,
    });

    if (confirmError) {
      console.error({ level: 'error', message: 'Resend confirmation email failed', error: confirmError });
    } else {
      console.log({ level: 'info', message: 'Resend confirmation email success', data: confirmData });
    }

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
