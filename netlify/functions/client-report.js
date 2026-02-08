const { createClient } = require('@supabase/supabase-js');
// Utiliser 'puppeteer-core' pour le code qui tourne
const puppeteer = require('puppeteer-core'); 
const chromium = require('@sparticuz/chromium'); 
// Ne pas utiliser @netlify/puppeteer car il est déprécié ou cause des conflits de compilation

chromium.setHeadlessMode = true;
chromium.setGraphicsMode = false;

// --- FONCTIONS UTILITAIRES (DOIVENT ÊTRE DANS CE FICHIER) ---

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

// --- FONCTION generateHtml (À COMPLÉTER) ---
function generateHtml(request) {
    // Date de création
    const creationDate = formatDateSafe(request.created_at);
    
    // Affichage Client
    const clientDisplay = request.representant 
        ? `<strong>${request.nom_client}</strong><br><span style="font-size:11px; color:#666;">Contact : ${request.representant}</span>` 
        : `<strong>${request.nom_client}</strong>`;

    // --- LOGIQUE TEXTES ---
    const eventsWithDate = (request.mission_events || []).map(event => {
        const day = formatDateSafe(event.created_at);
        const hour = formatTimeSafe(event.created_at);
        let desc = event.description || "";
        const descLow = desc.toLowerCase();
        const type = event.event_type;

        if (type === 'Création' || descLow.includes('soumise') || descLow.includes('reçue via le formulaire')) {
            desc = `Réception de votre demande. Dossier ouvert sous la référence <strong>${request.tracking_id}</strong>.`;
        } 
        else if (type === 'Changement de statut') {
            if (descLow.includes('acceptée')) desc = `Analyse de faisabilité validée. Dossier <strong>${request.tracking_id}</strong> accepté.`;
            else if (descLow.includes('devis envoyé')) desc = `Le devis détaillé vous a été transmis à l'adresse <strong>${request.email_client}</strong>.`;
            else if (descLow.includes('en cours')) desc = `Démarrage effectif des analyses bio-informatiques.`;
            else if (descLow.includes('facture envoyée')) desc = `Mission terminée. La facture a été envoyée à <strong>${request.email_client}</strong>.`;
            else if (descLow.includes('terminée')) desc = `Réception du paiement. Le dossier est administrativement clos.`;
        }
        else if (type === 'Email envoyé') {
            if (descLow.includes('bluefiles')) desc = `Lien sécurisé (BlueFiles) envoyé à <strong>${request.email_client}</strong>.`;
            else if (descLow.includes('finalisation')) desc = `Rapport final et résultats envoyés à <strong>${request.email_client}</strong>.`;
        }
        
        if (type.includes('Relance')) return null;

        return { day, hour, desc };
    }).filter(e => e !== null);

    // Regroupement
    const stages = {
        reception: { title: '1. Initialisation', icon: '📥', events: [] },
        devis: { title: '2. Validation & Admin.', icon: '📄', events: [] }, // Titre raccourci
        traitement: { title: '3. Technique', icon: '⚙️', events: [] }, // Titre raccourci
        finalisation: { title: '4. Clôture', icon: '✅', events: [] },
    };

    eventsWithDate.forEach(e => {
        const html = `
            <div class="event-row">
                <div class="event-time">${e.day}<br><small>${e.hour}</small></div>
                <div class="event-desc">${e.desc}</div>
            </div>`;
            
        const t = e.desc.toLowerCase();
        if (t.includes('réception') || t.includes('lien')) {
            stages.reception.events.push(html);
        } else if (t.includes('devis') || t.includes('validée')) {
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
                /* --- MODIFICATION TAILLE 2 : CSS Compact --- */
                body { font-family: 'Helvetica Neue', Arial, sans-serif; color: #333; line-height: 1.4; padding: 0 0 50px 0; max-width: 100%; margin: 0; font-size: 13px; }
                
                /* En-tête plus compact */
                .header { display: flex; justify-content: space-between; align-items: center; border-bottom: 2px solid #0f172a; padding-bottom: 10px; margin-bottom: 20px; }
                .logo { font-size: 20px; font-weight: bold; color: #0f172a; }
                .doc-title { text-align: right; }
                .doc-title h1 { margin: 0; font-size: 18px; color: #0369a1; text-transform: uppercase; letter-spacing: 1px; }
                .doc-title p { margin: 0; font-size: 11px; color: #64748b; }

                /* Info Box plus compacte */
                .info-grid { display: flex; gap: 15px; margin-bottom: 20px; background: #f8fafc; border: 1px solid #e2e8f0; padding: 15px; border-radius: 6px; }
                .info-col { flex: 1; }
                .label { font-size: 9px; text-transform: uppercase; color: #64748b; font-weight: bold; display: block; margin-bottom: 1px; }
                .value { font-size: 13px; color: #0f172a; display: block; margin-bottom: 8px; }
                .value:last-child { margin-bottom: 0; }

                /* Timeline optimisée */
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

                /* Footer remonté */
                .footer { position: fixed; bottom: 0; left: 0; right: 0; padding: 15px 0; border-top: 1px solid #e2e8f0; text-align: center; font-size: 9px; color: #94a3b8; background: white; }
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
                <p>AnaByo - Ce document retrace l'historique des actions réalisées sur votre dossier.</p>
            </div>
        </body>
        </html>
    `;
}

// --- DÉBUT DU HANDLER PRINCIPAL ---
exports.handler = async function(event) {
    if (event.httpMethod !== 'GET') return { statusCode: 405, body: 'Method Not Allowed' };

    const { trackingId, email } = event.queryStringParameters;
    if (!trackingId || !email) {
        return { statusCode: 400, body: JSON.stringify({ error: "Identifiants manquants." }) };
    }

    const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
    let browser = null;

    try {
        // 1. VÉRIFICATION DE SÉCURITÉ : Le client doit être le propriétaire du dossier
        const { data: request, error } = await supabase
            .from('demandes_clients')
            .select(`
                *,
                created_at,
                mission_events (created_at, event_type, description),
                clients_identite (nom_complet, representant, email, id)
            `)
            .eq('tracking_id', trackingId)
            .single();

        // 2. Erreur si la mission n'existe pas ou si l'email ne correspond pas
        if (error || !request || request.clients_identite.email.toLowerCase() !== email.toLowerCase()) {
            return { statusCode: 403, body: JSON.stringify({ error: "Accès refusé ou dossier introuvable." }) };
        }

        // Préparation des données pour la génération HTML
        const fullRequest = {
            ...request,
            nom_client: request.clients_identite.nom_complet,
            representant: request.clients_identite.representant,
            email_client: request.clients_identite.email,
            date_creation: request.created_at || new Date().toISOString()
        };
        const events = request.mission_events || [];
        events.sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
        fullRequest.mission_events = events;

        // 3. GÉNÉRATION DU PDF
        const htmlContent = generateHtml(fullRequest); 

        browser = await puppeteer.launch({ 
            args: chromium.args, 
            defaultViewport: chromium.defaultViewport, 
            executablePath: await chromium.executablePath(), 
            headless: chromium.headless 
        });
        const page = await browser.newPage();
        await page.setContent(htmlContent, { waitUntil: 'networkidle0' });
        const pdfBuffer = await page.pdf({ 
            format: 'A4', 
            printBackground: true, 
            margin: { top: '20px', bottom: '20px', left: '20px', right: '20px' } 
        });

        // 4. Renvoyer le PDF (inline = affichage direct, pas téléchargement forcé)
        return {
            statusCode: 200,
            headers: {
                'Content-Type': 'application/pdf',
                'Content-Disposition': `inline; filename="Journal-Projet-${fullRequest.tracking_id}.pdf"`
            },
            body: Buffer.from(pdfBuffer).toString('base64'),
            isBase64Encoded: true
        };

    } catch (error) {
        console.error("ERREUR CRITIQUE PUBLIC REPORT:", error);
        return { statusCode: 500, body: JSON.stringify({ error: "Erreur serveur lors de la génération du rapport." }) };
    } finally {
        if (browser) await browser.close();
    }
};