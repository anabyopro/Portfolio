// Fichier : netlify/functions/generate-pdf-report.js
const { createClient } = require('@supabase/supabase-js');
const puppeteer = require('puppeteer-core');
const chromium = require('@sparticuz/chromium');

chromium.setHeadlessMode = true;
chromium.setGraphicsMode = false;

exports.handler = async function(event) {
    if (event.httpMethod !== 'GET') return { statusCode: 405, body: 'Method Not Allowed' };

    const correctPassword = process.env.ADMIN_PASSWORD;
    const providedPassword = event.queryStringParameters.password;
    if (!providedPassword || providedPassword !== correctPassword) {
        return { statusCode: 401, body: JSON.stringify({ error: "Accès non autorisé." }) };
    }

    const requestId = event.queryStringParameters.id;
    const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
    let browser = null;

    try {
        console.log(`📄 Génération PDF pour : ${requestId}`);

        const { data: request, error } = await supabase
            .from('demandes_clients')
            .select(`
                *,
                created_at,
                mission_events (
                    created_at, 
                    event_type, 
                    description
                ),
                clients_identite (
                    nom_complet,
                    representant,
                    email
                )
            `)
            .eq('id', requestId)
            .single();

        if (error || !request) throw new Error("Demande introuvable");

        // On remonte les infos pour simplifier l'accès
        request.nom_client = request.clients_identite?.nom_complet || 'Client Inconnu';
        request.representant = request.clients_identite?.representant || '';
        request.email_client = request.clients_identite?.email || 'Email inconnu';

        const events = request.mission_events || [];
        events.sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
        request.mission_events = events;

        const htmlContent = generateHtml(request);

        const isLocalDev = process.env.NETLIFY_DEV === 'true';
        const launchOptions = isLocalDev 
            ? { args: ['--no-sandbox'], executablePath: '/usr/bin/google-chrome', headless: "new" }
            : { args: chromium.args, defaultViewport: chromium.defaultViewport, executablePath: await chromium.executablePath(), headless: chromium.headless, ignoreHTTPSErrors: true };

        browser = await puppeteer.launch(launchOptions);
        const page = await browser.newPage();
        await page.setContent(htmlContent, { waitUntil: 'networkidle0' });
        
        // Marges réduites
        const pdfBuffer = await page.pdf({ format: 'A4', printBackground: true, margin: { top: '20px', bottom: '20px', left: '20px', right: '20px' } });

        return {
            statusCode: 200,
            headers: { 'Content-Type': 'application/pdf', 'Content-Disposition': `attachment; filename="Journal-${request.tracking_id}.pdf"` },
            body: Buffer.from(pdfBuffer).toString('base64'),
            isBase64Encoded: true
        };

    } catch (error) {
        console.error("ERREUR PDF:", error);
        return { statusCode: 500, body: JSON.stringify({ error: error.message }) };
    } finally {
        if (browser) await browser.close();
    }
};

// --- FONCTIONS UTILITAIRES (Celles qui manquaient !) ---
function formatDateSafe(rawDate) {
    if (!rawDate) return "Date inconnue";
    const d = new Date(rawDate);
    return isNaN(d.getTime()) ? "Date inconnue" : d.toLocaleDateString('fr-FR', { year: 'numeric', month: 'long', day: 'numeric' });
}

function formatTimeSafe(rawDate) {
    if (!rawDate) return "";
    const d = new Date(rawDate);
    return isNaN(d.getTime()) ? "" : d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
}

function generateHtml(request) {
    // Date de création (priorité à created_at de la DB)
    const creationDate = formatDateSafe(request.created_at);
    
    // Affichage Client
    const clientDisplay = request.representant 
        ? `<strong>${request.nom_client}</strong><br><span style="font-size:11px; color:#666;">Contact : ${request.representant}</span>` 
        : `<strong>${request.nom_client}</strong>`;

    // --- LOGIQUE TEXTES PERSONNALISÉS ---
    const rawEvents = (request.mission_events || []).map(event => {
        const day = formatDateSafe(event.created_at);
        const hour = formatTimeSafe(event.created_at);
        let desc = event.description || "";
        const descLow = desc.toLowerCase();
        const type = event.event_type;

        // Personnalisation avec ID et Email
        if (type === 'Création' || descLow.includes('soumise') || descLow.includes('reçue via le formulaire')) {
            desc = `Réception de votre demande de <strong>${request.representant || request.nom_client}</strong>. Le dossier a été ouvert sous la référence <strong>${request.tracking_id}</strong>.`;
        } 
        else if (type === 'Changement de statut') {
            if (descLow.includes('acceptée')) desc = `Analyse de faisabilité technique validée. Votre dossier <strong>${request.tracking_id}</strong> a été accepté.`;
            else if (descLow.includes('devis envoyé')) desc = `Le devis détaillé vous a été transmis à <strong>${request.representant}</strong> à l'adresse <strong>${request.email_client}</strong>.`;
            else if (descLow.includes('en cours')) desc = `Démarrage effectif des analyses et traitements bio-informatiques pour votre dossier <strong>${request.tracking_id}</strong>.`;
            else if (descLow.includes('facture envoyée')) desc = `Mission terminée et livrée. La facture correspondante vous a été envoyée à <strong>${request.email_client}</strong>.`;
            else if (descLow.includes('terminée')) desc = `Le règlement a été reçu. Votre dossier <strong>${request.tracking_id}</strong> est maintenant administrativement clos. Merci pour votre confiance.`;
        }
        else if (type === 'Email envoyé') {
            if (descLow.includes('bluefiles')) desc = `Lien sécurisé (BlueFiles) envoyé à <strong>${request.email_client}</strong> pour le dépôt des fichiers.`;
            else if (descLow.includes('finalisation')) desc = `Rapport final et résultats envoyés à <strong>${request.email_client}</strong>.`;
        }
        
        if (type.includes('Relance')) return null;

        return { day, hour, desc };
    }).filter(e => e !== null);

    // Filtrage des doublons consécutifs (même description) pour éviter les répétitions
    const eventsWithDate = rawEvents.filter((event, index, array) => {
        if (index === 0) return true;
        return event.desc !== array[index - 1].desc;
    });

    // Regroupement
    const stages = {
        reception: { title: '1. Initialisation', icon: '📥', events: [] },
        devis: { title: '2. Phase Administrative', icon: '📄', events: [] },
        traitement: { title: '3. Phase Technique', icon: '⚙️', events: [] },
        finalisation: { title: '4. Clôture', icon: '✅', events: [] },
    };

    eventsWithDate.forEach(e => {
        const html = `
            <div class="event-row">
                <div class="event-time">${e.day}<br><small>${e.hour}</small></div>
                <div class="event-desc">${e.desc}</div>
            </div>`;
            
        const t = e.desc.toLowerCase();
        if (t.includes('réception') || t.includes('validée') || t.includes('lien')) {
            stages.reception.events.push(html);
        } else if (t.includes('devis')) {
            stages.devis.events.push(html);
        } else if (t.includes('démarrage') || t.includes('analyses') || t.includes('livrés')) {
            stages.traitement.events.push(html);
        } else {
            stages.finalisation.events.push(html);
        }
    });

    const stagesHtml = Object.values(stages).map(s => {
        if (s.events.length === 0) return '';
        return `
            <div class="stage-block">
                <div class="stage-header">
                    <span class="stage-icon">${s.icon}</span>
                    <h3>${s.title}</h3>
                </div>
                <div class="stage-content">
                    ${s.events.join('')}
                </div>
            </div>
        `;
    }).join('');

    return `
        <!DOCTYPE html>
        <html lang="fr">
        <head>
            <meta charset="UTF-8">
            <style>
                body { font-family: 'Helvetica Neue', Arial, sans-serif; color: #333; line-height: 1.4; padding: 0; max-width: 100%; margin: 0; font-size: 13px; }
                
                /* En-tête */
                .header { display: flex; justify-content: space-between; align-items: center; border-bottom: 2px solid #0f172a; padding-bottom: 10px; margin-bottom: 20px; }
                .logo { font-size: 20px; font-weight: bold; color: #0f172a; }
                .doc-title { text-align: right; }
                .doc-title h1 { margin: 0; font-size: 18px; color: #0369a1; text-transform: uppercase; letter-spacing: 1px; }
                .doc-title p { margin: 0; font-size: 11px; color: #64748b; }

                /* Info Box */
                .info-grid { display: flex; gap: 15px; margin-bottom: 20px; background: #f8fafc; border: 1px solid #e2e8f0; padding: 15px; border-radius: 6px; }
                .info-col { flex: 1; }
                .label { font-size: 9px; text-transform: uppercase; color: #64748b; font-weight: bold; display: block; margin-bottom: 1px; }
                .value { font-size: 13px; color: #0f172a; display: block; margin-bottom: 8px; }
                .value:last-child { margin-bottom: 0; }

                /* Timeline */
                .stage-block { margin-bottom: 15px; break-inside: avoid; }
                .stage-header { display: flex; align-items: center; background: #f1f5f9; padding: 6px 12px; border-radius: 4px 4px 0 0; border-left: 3px solid #0369a1; }
                .stage-icon { margin-right: 8px; font-size: 16px; }
                .stage-header h3 { margin: 0; font-size: 14px; color: #0f172a; font-weight: 700; }
                
                .stage-content { border: 1px solid #f1f5f9; border-top: none; border-radius: 0 0 4px 4px; padding: 10px; }
                
                .event-row { display: flex; margin-bottom: 8px; padding-bottom: 8px; border-bottom: 1px dashed #e2e8f0; }
                .event-row:last-child { margin-bottom: 0; padding-bottom: 0; border-bottom: none; }
                
                .event-time { width: 90px; font-size: 11px; color: #64748b; font-weight: 600; flex-shrink: 0; }
                .event-time small { font-weight: 400; color: #94a3b8; font-size: 10px; }
                .event-desc { font-size: 12px; color: #334155; }
                .event-desc strong { color: #0369a1; font-weight: 600; }

                /* Footer */
                .footer { margin-top: 30px; padding-top: 15px; border-top: 1px solid #e2e8f0; text-align: center; font-size: 9px; color: #94a3b8; }
            </style>
        </head>
        <body>
            <div class="header">
                <div class="logo">AnaByo</div>
                <div class="doc-title">
                    <h1>Journal de Projet</h1>
                    <p>Réf: ${request.tracking_id}</p>
                </div>
            </div>

            <div class="info-grid">
                <div class="info-col">
                    <span class="label">Client</span>
                    <span class="value">${clientDisplay}</span>
                    <span class="label">Email contact</span>
                    <span class="value">${request.email_client}</span>
                </div>
                <div class="info-col">
                    <span class="label">Date de la demande</span>
                    <span class="value">${creationDate}</span>
                    <span class="label">Type de mission</span>
                    <span class="value">${request.type_demande || 'Standard'}</span>
                </div>
                <div class="info-col">
                    <span class="label">Niveau d'urgence</span>
                    <span class="value" style="color:${request.is_urgent ? '#dc2626' : '#0f172a'}">${request.is_urgent ? 'Prioritaire' : 'Standard'}</span>
                    <span class="label">Date édition</span>
                    <span class="value">${new Date().toLocaleDateString('fr-FR')}</span>
                </div>
            </div>

            ${stagesHtml || '<div style="text-align:center; padding:20px; color:#94a3b8;">Aucun événement enregistré.</div>'}

            <div class="footer">
                <p>AnaByo - Analyse BioInformatique | Données confidentielles et pseudonymisées.</p>
                <p>Ce document retrace l'historique immuable des actions réalisées sur votre dossier.</p>
            </div>
        </body>
        </html>
    `;
}