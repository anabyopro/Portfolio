// Fichier : netlify/functions/generate-invoice.js
const { createClient } = require('@supabase/supabase-js');
const { Resend } = require('resend');
const puppeteer = require('puppeteer-core');
const chromium = require('@sparticuz/chromium');

// --- C'EST CETTE LIGNE QUI FAIT LA CONNEXION AVEC VOTRE NOUVEAU DESIGN ---
const { getInvoiceTemplate } = require('../shared/templates/invoice'); 

chromium.setHeadlessMode = true;
chromium.setGraphicsMode = false;

exports.handler = async function(event) {
    if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method Not Allowed' };

    const correctPassword = process.env.ADMIN_PASSWORD;
    const providedPassword = event.headers['x-admin-password'];
    if (!providedPassword || providedPassword !== correctPassword) {
        return { statusCode: 401, body: JSON.stringify({ error: "Accès non autorisé." }) };
    }

    const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
    const resend = new Resend(process.env.RESEND_API_KEY);
    let browser = null;

    try {
        const { missionId, articles } = JSON.parse(event.body);

        // 1. Récupérer les infos
        const { data: mission, error: errMission } = await supabase
            .from('demandes_clients')
            .select('*, clients_identite(*)')
            .eq('id', missionId)
            .single();
        
        if (errMission) throw new Error("Mission introuvable.");

        // 2. Numéro de facture
        const annee = new Date().getFullYear();
        const { count } = await supabase
            .from('finance_recettes')
            .select('*', { count: 'exact', head: true })
            .ilike('numero_facture', `FAC-${annee}-%`);
        
        const sequence = (count || 0) + 1;
        const numeroFacture = `FAC-${annee}-${String(sequence).padStart(3, '0')}`;

        // 3. Calculs
        let totalHT = 0;
        const lignesFacture = articles.map(item => {
            const total = item.quantite * item.prix_unitaire;
            totalHT += total;
            return { ...item, total };
        });

        if (mission.is_urgent) {
            const majoration = totalHT * 0.50;
            lignesFacture.push({ description: 'Majoration Urgence (+50%)', quantite: 1, prix_unitaire: majoration, total: majoration });
            totalHT += majoration;
        }

        // 4. HTML (Appel du Template externe)
        const htmlContent = getInvoiceTemplate({
            numero: numeroFacture,
            date: new Date().toLocaleDateString('fr-FR'),
            client: mission.clients_identite,
            lignes: lignesFacture,
            totalHT: totalHT,
            ref_devis: mission.tracking_id,
            // Vos infos bancaires sont maintenant directement dans le template invoice.js
        });

        // 5. PDF
        const isLocalDev = process.env.NETLIFY_DEV === 'true';
        const launchOptions = isLocalDev 
            ? { args: ['--no-sandbox'], executablePath: '/usr/bin/google-chrome', headless: "new" }
            : { args: chromium.args, defaultViewport: chromium.defaultViewport, executablePath: await chromium.executablePath(), headless: chromium.headless, ignoreHTTPSErrors: true };

        browser = await puppeteer.launch(launchOptions);
        const page = await browser.newPage();
        await page.setContent(htmlContent, { waitUntil: 'networkidle0' });
        const pdfBuffer = await page.pdf({ format: 'A4', printBackground: true });

        // 6. Upload
        const fileName = `factures/${numeroFacture}_${mission.tracking_id}.pdf`;
        const { error: uploadError } = await supabase.storage
            .from('documents')
            .upload(fileName, pdfBuffer, { contentType: 'application/pdf', upsert: true });
            
        if (uploadError) throw new Error("Erreur upload: " + uploadError.message);

        // 7. Mise à jour BDD
        await supabase.from('demandes_clients').update({
            statut: 'Facture envoyée',
            facture_url: fileName,
            date_mise_a_jour: new Date().toISOString()
        }).eq('id', missionId);

        await supabase.from('finance_recettes').insert({
            numero_facture: numeroFacture,
            client_nom: mission.clients_identite.nom_complet,
            montant_ht: totalHT,
            date_emission: new Date().toISOString(),
            mission_id: missionId,
            statut_paiement: 'En attente'
        });

        // 8. Envoyer l'email de notification au client
        const clientEmail = mission.clients_identite.email;
        const clientName = mission.clients_identite.representant || mission.clients_identite.nom_complet;
        const portalUrl = `https://anabyo.com/espace-client.html`;

        await resend.emails.send({
            from: 'AnaByo <contact@anabyo.com>',
            to: [clientEmail],
            subject: `Votre facture N° ${numeroFacture} est disponible`,
            html: `
                <p>Bonjour ${clientName},</p>
                <p>Nous vous informons que la facture <strong>${numeroFacture}</strong>, relative à la mission <strong>${mission.tracking_id}</strong>, est maintenant disponible.</p>
                <p>Vous pouvez la consulter et la télécharger à tout moment depuis votre espace client sécurisé.</p>
                <p><a href="${portalUrl}" style="font-weight: bold;">Accéder à mon Espace Client</a></p>
                <p>Nous restons à votre disposition pour toute question.</p>
                <p>Cordialement,<br>L'équipe AnaByo</p>
            `
        });

        return { statusCode: 200, body: JSON.stringify({ message: "Facture générée !", numero: numeroFacture }) };

    } catch (error) {
        console.error("Erreur Facture:", error);
        return { statusCode: 500, body: JSON.stringify({ error: error.message }) };
    } finally {
        if (browser) await browser.close();
    }
};