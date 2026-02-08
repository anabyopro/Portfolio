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

// 3. Calculs et Dates
        const dateEmission = new Date();
        const dateEcheance = new Date();
        dateEcheance.setDate(dateEmission.getDate() + 30); // Calcul de l'échéance à J+30

        // On prépare les formats "texte" pour l'affichage
        const dateEmissionStr = dateEmission.toLocaleDateString('fr-FR');
        const dateEcheanceStr = dateEcheance.toLocaleDateString('fr-FR');

        let totalHT = 0;
        const lignesFacture = articles.map(item => {
            const total = item.quantite * item.prix_unitaire;
            totalHT += total;
            return { ...item, total };
        });

        if (mission.is_urgent) {
            const majoration = totalHT * 0.50;
            lignesFacture.push({ 
                description: 'Majoration Urgence (+50%)', 
                quantite: 1, 
                prix_unitaire: majoration, 
                total: majoration 
            });
            totalHT += majoration;
        }

        // 4. HTML (Appel du Template externe)
        const htmlContent = getInvoiceTemplate({
            numero: numeroFacture,
            date: dateEmissionStr,
            dateEcheance: dateEcheanceStr,
            client: mission.clients_identite,
            lignes: lignesFacture,
            totalHT: totalHT,
            ref_devis: mission.tracking_id,
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

        // Ajout de l'événement dans le journal pour qu'il apparaisse dans le rapport PDF
        await supabase.from('mission_events').insert({
            request_id: missionId,
            event_type: 'Changement de statut',
            description: 'Statut passé à : Facture envoyée'
        });

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
                <div style="font-family: sans-serif; color: #333; line-height: 1.6;">
                    <p>Bonjour ${clientName},</p>
                    
                    <p>J'espère que vous allez bien.</p>
                    
                    <p>Vous trouverez en pièce jointe la facture <b>${numeroFacture}</b> concernant notre intervention sur la mission <b>${mission.tracking_id}</b>.</p>
                    
                    <p>Pour faciliter votre gestion, ce document est également archivé et reste accessible à tout moment depuis votre espace sécurisé :</p>
                    
                    <p style="margin: 20px 0;">
                        <a href="${portalUrl}" style="color: #0253e0; font-weight: bold; text-decoration: underline;">
                            👉 Accéder à mon Espace Client
                        </a>
                    </p>
                    
                    <p>Nous restons bien entendu à votre entière disposition si vous avez la moindre question concernant ce document.</p>
                    
                    <p>Bien cordialement,<br>
                    L'équipe AnaByo</p>
                </div>
            `,
            attachments: [{
                filename: `${numeroFacture}.pdf`,
                content: Buffer.from(pdfBuffer)
            }]
        });

        return { statusCode: 200, body: JSON.stringify({ message: "Facture générée !", numero: numeroFacture }) };

    } catch (error) {
        console.error("Erreur Facture:", error);
        return { statusCode: 500, body: JSON.stringify({ error: error.message }) };
    } finally {
        if (browser) await browser.close();
    }
};