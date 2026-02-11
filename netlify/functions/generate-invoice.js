// Fichier : netlify/functions/generate-invoice.js
const { createClient } = require('@supabase/supabase-js');
const { Resend } = require('resend');
const puppeteer = require('puppeteer-core');
const chromium = require('@sparticuz/chromium');
const fs = require('fs');
const path = require('path');

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

        // 5b. Génération du PVD (Procès-Verbal de Destruction) pour l'envoyer MAINTENANT
        let pvdBuffer = null;
       try {
            // On prépare les données pour le PVD
            const pvdData = {
                nom_client: mission.clients_identite.nom_complet,
                tracking_id: mission.tracking_id,
                type_demande: mission.type_demande
            };
            const pvdHtml = getPvdHtml(pvdData);
            // OPTIMISATION : 'domcontentloaded' est beaucoup plus rapide pour du contenu statique (base64)
            await page.setContent(pvdHtml, { waitUntil: 'domcontentloaded', timeout: 30000 });
            // Ajout d'options pour optimiser la génération du PDF
            pvdBuffer = await page.pdf({ format: 'A4', printBackground: true, margin: { top: '40px', bottom: '40px', left: '40px', right: '40px' }, preferCSSPageSize: true });
            console.log("✅ PVD généré avec la facture");
        } catch (e) { console.error("⚠️ Erreur PVD:", e); }

        // 6. Upload
        const fileName = `factures/${numeroFacture}_${mission.tracking_id}.pdf`;
        const { error: uploadError } = await supabase.storage
            .from('documents')
            .upload(fileName, pdfBuffer, { contentType: 'application/pdf', upsert: true });
            
        if (uploadError) throw new Error("Erreur upload: " + uploadError.message);

        // Upload du PVD aussi pour archivage
        if (pvdBuffer) {
            const { error: pvdUploadError } = await supabase.storage
                .from('documents')
                .upload(`pvd/PVD_AnaByo_${mission.tracking_id}.pdf`, pvdBuffer, { contentType: 'application/pdf', upsert: true });
            
            if (pvdUploadError) console.error("⚠️ Erreur upload PVD:", pvdUploadError);
            else console.log("✅ PVD archivé dans Supabase");
        }

        // 7. Mise à jour BDD
        const updateData = { //create an object
            statut: 'Facture envoyée',
            facture_url: fileName,
            date_mise_a_jour: new Date().toISOString()
        }; //add all keys into this object and then push it at once

        if (pvdBuffer) {
            updateData.pvd_url = `pvd/PVD_AnaByo_${mission.tracking_id}.pdf`;
        }

        await supabase.from('demandes_clients').update(updateData).eq('id', missionId);

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

        const attachments = [{ filename: `${numeroFacture}.pdf`, content: Buffer.from(pdfBuffer) }];
        if (pvdBuffer) {
            attachments.push({ filename: `PVD_AnaByo_${mission.tracking_id}.pdf`, content: Buffer.from(pvdBuffer) });
        }

        await resend.emails.send({
            from: 'AnaByo <contact@anabyo.com>',
            to: [clientEmail],
            subject: `Votre facture N° ${numeroFacture} est disponible`,
            html: `
                <div style="font-family: sans-serif; color: #333; line-height: 1.6;">
                    <p>Bonjour ${clientName},</p>
                    
                    <p>J'espère que vous allez bien.</p>
                    
                    <p>Vous trouverez en pièce jointe la facture <b>${numeroFacture}</b> relative à notre intervention sur la mission <b>${mission.tracking_id}</b>.</p>

                    <p>🛡️ <b>Confidentialité & Sécurité :</b><br>
                    Conformément à nos engagements, nous vous confirmons que vos données ont été traitées avec la plus grande rigueur. Vous trouverez également ci-joint le <b>Procès-Verbal de Destruction (PVD)</b> attestant de la suppression définitive et sécurisée de vos fichiers sur nos serveurs de travail.</p>
                    
                    <p>Pour faciliter votre gestion, ces documents sont également archivés et restent accessibles à tout moment depuis votre espace sécurisé :</p>
                    
                    <p style="margin: 20px 0;">
                        <a href="${portalUrl}" style="color: #0253e0; font-weight: bold; text-decoration: underline;">
                            👉 Accéder à mon Espace Client
                        </a>
                    </p>
                    
                    <p>Nous restons bien entendu à votre entière disposition si vous avez la moindre question concernant ces éléments.</p>
                    
                    <p>Bien cordialement,<br>
                    L'équipe AnaByo</p>
                </div>
            `,
            attachments: attachments
        });

        return { statusCode: 200, body: JSON.stringify({ message: "Facture générée !", numero: numeroFacture }) };

    } catch (error) {
        console.error("Erreur Facture:", error);
        return { statusCode: 500, body: JSON.stringify({ error: error.message }) };
    } finally {
        if (browser) await browser.close();
    }
};


// --- FONCTION UTILITAIRE : GÉNÉRATION HTML DU PVD (Dupliquée pour l'indépendance) ---
function getPvdHtml(data) {
    const date = new Date().toLocaleDateString('fr-FR');
    
    // Chargement du logo
    let logoHtml = '';
    try {
        const logoPaths = [
            path.resolve(__dirname, '../../assets/logo_anabyo.png'),
            path.join(process.cwd(), 'assets/logo_anabyo.png'),
            path.join(process.cwd(), 'site_web/assets/logo_anabyo.png')
        ];
        const logoPath = logoPaths.find(p => fs.existsSync(p));
        if (logoPath) {
            const base64Logo = fs.readFileSync(logoPath).toString('base64');
            logoHtml = `<img src="data:image/png;base64,${base64Logo}" style="height: 120px; width: auto;" alt="AnaByo" />`;
        }
    } catch (e) { console.log("Logo load error", e); }

    // Chargement signature
    let signatureHtml = '';
    try {
        const possiblePaths = [
            path.resolve(__dirname, '../../NDA/signature_tom_bourachot.png'),
            path.join(process.cwd(), 'NDA/signature_tom_bourachot.png'),
            path.join(process.cwd(), 'signature_tom_bourachot.png')
        ];
        const sigPath = possiblePaths.find(p => fs.existsSync(p));
        if (sigPath) {
            const base64Img = fs.readFileSync(sigPath).toString('base64');
            signatureHtml = `<img src="data:image/png;base64,${base64Img}" style="max-height: 80px; display: block; margin-top: 10px;" alt="Signature" />`;
        }
    } catch (e) { }

    return `
    <!DOCTYPE html>
    <html lang="fr">
    <head>
        <meta charset="UTF-8">
        <style>
            body { font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif; font-size: 14px; line-height: 1.6; color: #333; margin: 0; padding: 40px; }
            .header-table { width: 100%; margin-bottom: 40px; border-bottom: 2px solid #0369a1; padding-bottom: 20px; }
            .header-left { text-align: left; vertical-align: middle; }
            .header-right { text-align: right; vertical-align: middle; font-size: 12px; color: #555; line-height: 1.4; }
            h1 { font-size: 22px; text-align: center; margin: 40px 0; text-transform: uppercase; color: #0369a1; letter-spacing: 1px; }
            .content { margin-top: 20px; padding: 0 10px; }
            .details-box { background-color: #f8fafc; border: 1px solid #e2e8f0; border-radius: 6px; padding: 20px; margin: 30px 0; font-size: 14px; }
            .details-row { margin-bottom: 8px; }
            .label { font-weight: bold; color: #0f172a; width: 180px; display: inline-block; white-space: nowrap; }
            .text-sm { font-size: 12px; }
            .signature-section { margin-top: 60px; text-align: right; padding-right: 20px; }
            .signature-box { display: inline-block; text-align: left; min-width: 200px; }
            .footer { position: fixed; bottom: 20px; left: 40px; right: 40px; text-align: center; font-size: 10px; color: #9ca3af; border-top: 1px solid #e5e7eb; padding-top: 10px; }
        </style>
    </head>
    <body>
        <table class="header-table">
            <tr>
                <td class="header-left">${logoHtml}</td>
                <td class="header-right"><strong>AnaByo</strong><br>41 rue Charles Floquet<br>33400 Talence<br>SIRET : 99998298600013</td>
            </tr>
        </table>
        <h1>Procès-Verbal de Destruction de Données</h1>
        <div class="content">
            <p class="text-sm">Je soussigné, <strong>Tom Bourachot</strong>, agissant en qualité de Gérant de la société <strong>AnaByo</strong>, certifie par la présente avoir procédé à la suppression définitive, sécurisée et irréversible de l'ensemble des données confidentielles relatives à la mission citée ci-dessous.</p>
            <div class="details-box">
                <div class="details-row"><span class="label">Client :</span> ${data.nom_client || 'Client'}</div>
                <div class="details-row"><span class="label">Référence Dossier :</span> ${data.tracking_id}</div>
                <div class="details-row"><span class="label">Type de mission :</span> ${data.type_demande || 'Analyse de données'}</div>
                <div class="details-row"><span class="label">Date de suppression :</span> ${date}</div>
                <div class="details-row"><span class="label">Méthode :</span> Purge sécurisée de l'environnement chiffré.</div>
            </div>
            <p class="text-sm">Conformément à nos engagements en matière de protection des données (RGPD) et à notre politique de confidentialité, nous attestons qu'aucune copie, partielle ou totale, n'a été conservée sur les infrastructures d'AnaByo.</p>
            <p class="text-sm" style="margin-top: 30px;">Fait à Talence, pour valoir ce que de droit, le ${date}.</p>
        </div>
        <div class="signature-section">
            <div class="signature-box"><div style="margin-bottom: 5px; font-weight: bold;">Pour AnaByo,</div><div>Tom Bourachot</div><div style="font-size: 12px; color: #666; font-style: italic;">Gérant</div>${signatureHtml}</div>
        </div>
        <div class="footer">AnaByo - Micro-entreprise - SIRET 99998298600013<br>Document généré automatiquement le ${date}</div>
    </body>
    </html>
    `;
}