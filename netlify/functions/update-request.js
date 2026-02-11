const { createClient } = require('@supabase/supabase-js');
const { Resend } = require('resend');
const puppeteer = require('puppeteer-core');
const chromium = require('@sparticuz/chromium');
const fs = require('fs');
const path = require('path');

chromium.setHeadlessMode = true;
chromium.setGraphicsMode = false;

exports.handler = async function(event) {
    if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method Not Allowed' };

    // 1. Authentification Admin
    const correctPassword = process.env.ADMIN_PASSWORD;
    const providedPassword = event.headers['x-admin-password'];
    if (!providedPassword || providedPassword !== correctPassword) {
        return { statusCode: 401, body: JSON.stringify({ error: "Accès non autorisé." }) };
    }

    // 2. Initialisation des Clients (Une seule fois ici pour tout le script)
    const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
    const resend = new Resend(process.env.RESEND_API_KEY);

    try {
        const { id, newStatus, bluefilesLink, rejectionReason } = JSON.parse(event.body);
        if (!id || !newStatus) return { statusCode: 400, body: JSON.stringify({ error: "Données manquantes." }) };

        // --- FONCTION UTILITAIRE : RÉCUPÉRER LES INFOS ---
        const fetchFullRequest = async (requestId) => {
            const { data, error } = await supabase
                .from('demandes_clients')
                .select('*, clients_identite(*)')
                .eq('id', requestId)
                .single();
            
            if (error || !data) throw new Error("Demande introuvable.");
            
            return {
                ...data,
                email_client: data.clients_identite?.email,
                nom_client: data.clients_identite?.nom_complet,
                representant: data.clients_identite?.representant,
                fonction: data.clients_identite?.fonction,
                adresse: data.clients_identite?.adresse
            };
        };

        // --- CAS 1 : RELANCE MANUELLE (⚡) ---
        if (newStatus === 'Relance') {
            const currentData = await fetchFullRequest(id);
            
            let subject = "Rappel concernant votre dossier";
            let htmlContent = "";
            
            if (currentData.statut === 'Devis envoyé') {
                subject = "Rappel : Votre devis est en attente";
                htmlContent = `<p>Je me permets de vous relancer concernant le devis envoyé récemment. Avez-vous des questions ?</p>`;
            } else if (currentData.statut === 'Facture envoyée') {
                subject = "Rappel : Facture en attente";
                htmlContent = `<p>Sauf erreur, le règlement de la facture pour ce dossier n'est pas encore parvenu. Merci de vérifier.</p>`;
            }

            await resend.emails.send({
                from: 'AnaByo <contact@anabyo.com>',
                to: [currentData.email_client],
                subject: `AnaByo | ${subject}`,
                html: `<p>Bonjour ${currentData.nom_client},</p>${htmlContent}<p>Cordialement,<br>L'équipe AnaByo</p>`
            });

            await supabase.from('mission_events').insert({ 
                request_id: id, 
                event_type: 'Relance Manuelle', 
                description: "Relance manuelle envoyée." 
            });
            
            return { statusCode: 200, body: JSON.stringify({ message: "Relance envoyée !" }) };
        }

        // --- CAS 2 : GÉNÉRATION JSON ---
        if (newStatus === 'json') {
            const requestData = await fetchFullRequest(id);
            return { 
                statusCode: 200, 
                body: JSON.stringify({
                    client: {
                        nom_complet: requestData.nom_client,
                        representant: requestData.representant,
                        fonction: requestData.fonction,
                        adresse: requestData.adresse,
                        email: requestData.email_client,
                        siren: requestData.siren || "Non renseigné",
                        tva_intracom: requestData.tva_intracom || ""
                    },
                    devis: { taches: [], notes: "Validité 30 jours.", _priority: requestData.is_urgent ? "1" : "0" }
                }) 
            };
        }

        // --- CAS 3 : REFUS (Mise à jour statut + Mail) ---
        if (newStatus === 'Refusée' || newStatus === 'Devis refusé') {
            const requestData = await fetchFullRequest(id);
            
            const motifHtml = rejectionReason 
                ? `<div style="margin: 20px 0; padding: 15px; border-left: 4px solid #e11d48; background-color: #fff1f2; color: #9f1239;">
                    <strong>Précisions sur le refus :</strong><br>
                    <em>${rejectionReason.replace(/\n/g, '<br>')}</em>
                   </div>`
                : `<p>Votre demande ne pourra malheureusement pas être traitée par nos services actuellement.</p>`;

            await resend.emails.send({
                from: 'AnaByo <contact@anabyo.com>',
                to: [requestData.email_client],
                subject: 'Concernant votre demande chez AnaByo',
                html: `
                    <div style="font-family: sans-serif; line-height: 1.6; color: #333;">
                        <p>Bonjour ${requestData.nom_client || 'Madame, Monsieur'},</p>
                        
                        <p>Nous vous remercions de l'intérêt porté à nos services et de la confiance témoignée lors de votre demande.</p>
                        
                        <p>Après une étude attentive de vos éléments, nous ne serons malheureusement pas en mesure de donner suite à votre projet pour la raison suivante :</p>
                        
                        <div style="background-color: #fdf2f2; border-left: 4px solid #d9534f; padding: 12px; margin: 20px 0; font-style: italic;">
                            ${motifHtml}
                        </div>
                        
                        <p>Si vous pensez qu'une précision de votre part pourrait nous permettre de réévaluer votre dossier, n'hésitez pas à nous répondre directement par mail en apportant les compléments nécessaires.</p>
                        
                        <p>Nous vous souhaitons une excellente réussite dans vos projets et restons à votre disposition pour de futures sollicitations.</p>
                        
                        <p>Bien cordialement,<br>
                        <strong>L'équipe AnaByo</strong></p>
                    </div>
                `
            });

            await supabase.from('mission_events').insert({ 
                request_id: id, 
                event_type: 'Refus', 
                description: rejectionReason ? `Refusée : ${rejectionReason}` : "Demande refusée." 
            });
            
            // MODIFICATION : On ne supprime plus, on met à jour le statut
            await supabase.from('demandes_clients').update({ statut: newStatus }).eq('id', id);
            return { statusCode: 200, body: JSON.stringify({ message: "Demande refusée (archivée)." }) };
        }

        // --- CAS 3-bis : SUPPRESSION DÉFINITIVE ---
        if (newStatus === 'Suppression') {
            await supabase.from('demandes_clients').delete().eq('id', id);
            return { statusCode: 200, body: JSON.stringify({ message: "Demande supprimée définitivement." }) };
        }

        // --- CAS : SAV (Service Après-Vente / Vérification) ---
        if (newStatus === 'SAV') {
            await supabase.from('demandes_clients').update({ 
                statut: 'SAV',
                date_mise_a_jour: new Date().toISOString()
            }).eq('id', id);

            await supabase.from('mission_events').insert({
                request_id: id,
                event_type: 'SAV',
                description: 'Dossier en attente de validation de conformité (SAV).'
            });

            return { statusCode: 200, body: JSON.stringify({ message: "Passé en SAV" }) };
        }

        // --- CAS 4 : MISE À JOUR DE STATUT STANDARD ---
        const oldRequest = await fetchFullRequest(id);

        const { data: updatedRaw, error: upErr } = await supabase
            .from('demandes_clients')
            .update({ 
                statut: newStatus,
                date_mise_a_jour: new Date().toISOString()
            })
            .eq('id', id)
            .select('*, clients_identite(*)')
            .single();

        if (upErr) throw upErr;

        // --- AJOUT : JOURNALISATION DE L'ÉVÉNEMENT ---
        await supabase.from('mission_events').insert({
            request_id: id,
            event_type: 'Changement de statut',
            description: `Statut passé à : ${newStatus}`
        });

        // --- MISE À JOUR AUTOMATIQUE FINANCE ---
        // Si le statut passe à "Payée" ou "Terminée", on enregistre la date de paiement
        if (newStatus === 'Payée' || newStatus === 'Terminée') {
            await supabase.from('finance_recettes')
                .update({ 
                    statut_paiement: 'Payé',
                    date_paiement: new Date().toISOString()
                })
                .eq('mission_id', id);
        }

        const finalData = {
            ...updatedRaw,
            email_client: updatedRaw.clients_identite?.email,
            // On privilégie les infos du formulaire (snapshot) si elles existent, sinon le profil
            nom_client: updatedRaw.nom_client || updatedRaw.clients_identite?.nom_complet
        };

        // --- ENVOIS AUTOMATIQUES SELON LE NOUVEAU STATUT ---
        if (newStatus === 'Acceptée') {
            // 1. Génération du NDA PDF à la volée
            let pdfBuffer = null;
            let signedUrl = null;
            let browser = null;
            try {
                console.log("📄 Début génération NDA...");
                const ndaHtml = getNdaHtml(finalData);
                
                // Configuration compatible Local / Production (identique à generate-invoice.js)
                const isLocalDev = process.env.NETLIFY_DEV === 'true';
                const launchOptions = isLocalDev 
                    ? { args: ['--no-sandbox'], executablePath: '/usr/bin/google-chrome', headless: "new" }
                    : { args: chromium.args, defaultViewport: chromium.defaultViewport, executablePath: await chromium.executablePath(), headless: chromium.headless, ignoreHTTPSErrors: true };

                browser = await puppeteer.launch(launchOptions);
                const page = await browser.newPage();
                await page.setContent(ndaHtml, { waitUntil: 'networkidle0' });
                pdfBuffer = await page.pdf({ 
                    format: 'A4', 
                    printBackground: true,
                    displayHeaderFooter: true,
                    margin: { top: '70px', bottom: '70px', left: '40px', right: '40px' },
                    headerTemplate: `<div style="font-family: Helvetica, Arial, sans-serif; font-size: 9px; color: #94a3b8; width: 100%; text-align: center; border-bottom: 1px solid #e2e8f0; padding-bottom: 5px; margin: 0 40px;">
                        ACCORD DE CONFIDENTIALITÉ - ANABYO
                    </div>`,
                    footerTemplate: `<div style="font-family: Helvetica, Arial, sans-serif; font-size: 9px; color: #94a3b8; width: 100%; display: flex; justify-content: space-between; border-top: 1px solid #e2e8f0; padding-top: 5px; margin: 0 40px;">
                        <span>Document confidentiel</span>
                        <span>Page <span class="pageNumber"></span> / <span class="totalPages"></span></span>
                    </div>`
                });
                console.log("✅ PDF généré en mémoire (" + pdfBuffer.length + " bytes)");

                // 2. Sauvegarde ("Création") du NDA dans le stockage
                const fileName = `nda/NDA_AnaByo_${finalData.tracking_id}.pdf`;
                console.log("uploading to Supabase:", fileName);
                
                const { error: uploadError } = await supabase.storage
                    .from('documents')
                    .upload(fileName, pdfBuffer, { contentType: 'application/pdf', upsert: true });
                
                if (uploadError) {
                    console.error("⚠️ Erreur sauvegarde NDA Supabase:", uploadError);
                } else {
                    console.log("✅ NDA sauvegardé dans Supabase !");
                    // Mise à jour de la référence dans la base de données (si la colonne nda_url existe)
                    await supabase.from('demandes_clients')
                        .update({ nda_url: fileName }).eq('id', id);
                    
                    // Génération d'un lien de téléchargement de secours (valide 7 jours)
                    const { data: urlData } = await supabase.storage
                        .from('documents')
                        .createSignedUrl(fileName, 60 * 60 * 24 * 7);
                    
                    if (urlData) signedUrl = urlData.signedUrl;
                }

            } catch (e) {
                console.error("⚠️ Erreur génération/sauvegarde NDA:", e);
            } finally {
                if (browser) await browser.close();
            }

            console.log("📧 Envoi email avec pièce jointe :", pdfBuffer ? "OUI" : "NON");

            await resend.emails.send({
                from: 'AnaByo <contact@anabyo.com>',
                to: [finalData.email_client],
                subject: `Votre demande a été acceptée (Réf : ${finalData.tracking_id}) !`,
                html: `
                    <div style="font-family: sans-serif; color: #333; line-height: 1.6;">
                        <p>Bonjour ${finalData.nom_client},</p>
                        
                        <p>C'est un plaisir de vous confirmer que nous allons vous accompagner sur ce projet ! Après étude de vos éléments, nous sommes prêts à démarrer.</p>
                        
                        <p>Pour protéger nos échanges et garantir la confidentialité de vos données, vous trouverez ci-joint notre <b>Accord de Confidentialité (NDA)</b>.</p>
                        
                        <p><b>Prochaine étape :</b><br>
                        Il vous suffit de nous retourner ce document signé, accompagné de vos fichiers de travail, sur le lien sécurisé ci-dessous:<br>
                        👉 <a href="${finalData.bluefiles_link}" style="font-weight: bold; color: #007bff;">Déposer mes documents sur Bluefiles</a></p>
                        
                        <p>Nous avons hâte de commencer à travailler avec vous.</p>
                        
                        L'équipe AnaByo</p>
                    </div>
                `,
                attachments: pdfBuffer ? [{ filename: `NDA_AnaByo_${finalData.tracking_id}.pdf`, content: Buffer.from(pdfBuffer) }] : []
            });
        }

        if (newStatus === 'Terminée') {
            const feedbackLink = `https://anabyo.com/feedback.html?mission=${finalData.tracking_id}`;
            
            await resend.emails.send({
                from: 'AnaByo <contact@anabyo.com>',
                to: [finalData.email_client],
                subject: `Clôture de collaboration - ${finalData.tracking_id}`,
                html: `
                    <div style="font-family: sans-serif; color: #333; line-height: 1.6;">
                        <p>Bonjour ${finalData.nom_client},</p>
                        
                        <p>C'est un plaisir de vous confirmer que notre mission est désormais terminée. <b>Un grand merci pour votre confiance</b> tout au long de ce projet.</p>
                        
                        <p>Le dossier est désormais administrativement clos.</p>

                        <p>Votre avis nous est précieux : pourriez-vous nous accorder un court instant pour partager votre retour d'expérience ? Votre regard nous aide à faire évoluer nos services :</p>
                        
                        <p style="margin: 25px 0;">
                            <a href="${feedbackLink}" style="color: #0253e0; font-weight: bold; text-decoration: underline; font-size: 110%;">
                                👉 Laisser mon avis sur la prestation
                            </a>
                        </p>
                        
                        <p>Au plaisir de vous accompagner à nouveau sur de futurs projets,</p>
                        
                        <p>Bien cordialement,<br>
                        L'équipe AnaByo</p>
                    </div>
                `
            });
        }

        return { statusCode: 200, body: JSON.stringify(finalData) };

    } catch (error) {
        console.error("Erreur:", error.message);
        return { statusCode: 500, body: JSON.stringify({ error: error.message }) };
    }
};

// --- FONCTION UTILITAIRE : GÉNÉRATION HTML DU NDA ---
function getNdaHtml(data) {
    // Récupération prioritaire des données du formulaire (snapshot)
    const clientName = data.nom_client || data.clients_identite?.nom_complet || 'Client';
    const clientSiren = data.siren || data.clients_identite?.siren || 'Non renseigné';
    const clientAddress = data.adresse || data.clients_identite?.adresse || 'Non renseignée';
    const clientRep = data.contact || data.representant || data.clients_identite?.representant || 'Non renseigné';
    const date = new Date().toLocaleDateString('fr-FR');
    
    // Tentative de chargement de la signature (si le fichier est accessible/bundlé)
    let signatureHtml = '';
    try {
        // Recherche plus robuste du fichier image (Local vs Netlify)
        const possiblePaths = [
            path.resolve(__dirname, '../../NDA/signature_tom_bourachot.png'),
            path.join(process.cwd(), 'NDA/signature_tom_bourachot.png'),
            path.join(process.cwd(), 'signature_tom_bourachot.png')
        ];
        
        const sigPath = possiblePaths.find(p => fs.existsSync(p));
        if (sigPath) {
            const base64Img = fs.readFileSync(sigPath).toString('base64');
            signatureHtml = `<img src="data:image/png;base64,${base64Img}" style="max-height: 90px; display: block; margin: 10px 0;" alt="Signature" />`;
        } else {
            console.log("⚠️ Signature introuvable. Chemins testés:", possiblePaths);
        }
    } catch (e) { console.log("Info: Erreur chargement signature", e.message); }

    return `
    <!DOCTYPE html>
    <html lang="fr">
    <head>
        <meta charset="UTF-8">
        <style>
            body { font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif; font-size: 12px; line-height: 1.5; color: #333; margin: 0; }
            h1 { font-size: 18px; text-align: center; margin-bottom: 30px; text-transform: uppercase; color: #0369a1; border-bottom: 2px solid #0369a1; padding-bottom: 10px; }
            h2 { font-size: 14px; margin-top: 50px; margin-bottom: 15px; color: #0f172a; border-bottom: 1px solid #e2e8f0; padding-bottom: 5px; }
            p { margin-bottom: 10px; text-align: justify; }
            ul, ol { margin-bottom: 10px; padding-left: 25px; }
            li { margin-bottom: 5px; }
            .parties { background: #f8fafc; padding: 20px; border: 1px solid #e2e8f0; margin-bottom: 25px; border-radius: 6px; }
            .party-block { margin-bottom: 15px; }
            .party-block:last-child { margin-bottom: 0; }
            .party-title { font-weight: bold; color: #0369a1; margin-bottom: 5px; }
            .signature-section { margin-top: 50px; display: flex; justify-content: space-between; page-break-inside: avoid; }
            .signature-box { width: 45%; border: 1px solid #e2e8f0; padding: 15px; border-radius: 6px; background: #fff; min-height: 150px; display: flex; flex-direction: column; justify-content: space-between; }
            .signature-title { font-weight: bold; margin-bottom: 10px; color: #0369a1; }
            .signature-line { margin-top: 10px; border-top: 1px solid #ccc; padding-top: 5px; font-style: italic; font-size: 10px; color: #666; }
        </style>
    </head>
    <body>
        <h1>Accord de Non-Divulgation (NDA) Unilatéral</h1>
        
        <div class="parties">
            <div class="party-block">
                <div class="party-title">1. Le "Divulgateur" :</div>
                <strong>${clientName}</strong><br>
                SIREN : ${clientSiren}<br>
                Adresse : ${clientAddress}<br>
                Représenté par : ${clientRep}
            </div>
            <div class="party-block" style="margin-top: 15px; border-top: 1px dashed #cbd5e1; padding-top: 15px;">
                <div class="party-title">2. Le "Receveur" : AnaByo</div>
                Représenté par : Tom Bourachot (Entrepreneur Individuel)<br>
                Siège social : 41 rue Charles Floquet, 33400 Talence<br>
                SIRET : 99998298600013<br>
                Email : contact@anabyo.com
            </div>
        </div>

        <h2>PRÉAMBULE</h2>
        <p>Dans le cadre de la prestation de services de traitement et d'analyse de données bio-informatiques (ci-après la "Mission"), le Divulgateur est amené à communiquer au Receveur des informations confidentielles. Le présent accord a pour objet de définir les obligations de confidentialité du Receveur.</p>

        <h2>Article 1 : Définition des Informations Confidentielles</h2>
        <p>Sont considérées comme "Informations Confidentielles" toutes les données, documents, ou informations, quels que soient leur forme ou leur support (oral, écrit, électronique, etc.), transmis par le Divulgateur au Receveur pour l'exécution de la Mission.</p>
        <p>Cela inclut explicitement, mais sans s'y limiter :</p>
        <ul>
            <li>Les données brutes initiales fournies par le Divulgateur ;</li>
            <li>Les données traitées, les livrables intermédiaires et les résultats finaux produits par le Receveur ;</li>
            <li>Les protocoles, ébauches de publication, ou toute information non publique liée au projet de recherche du Divulgateur.</li>
        </ul>

        <h2>Article 2 : Obligations de Confidentialité et Sécurité</h2>
        <p>Le Receveur (AnaByo) s'engage à :</p>
        <ol>
            <li>Protéger les Informations Confidentielles avec le plus grand soin. À ce titre, le Receveur confirme que les supports de stockage utilisés pour conserver les Informations Confidentielles sont protégés par une technologie de chiffrement (ex: Bitlocker).</li>
            <li>Utiliser les Informations Confidentielles uniquement dans le but strict d'accomplir la Mission convenue.</li>
            <li>Ne pas divulguer les Informations Confidentielles à aucun tiers, sous aucun prétexte.</li>
            <li>Limiter l'accès aux Informations Confidentielles à sa seule personne (Tom Bourachot).</li>
            <li>N'utiliser que des canaux de transfert sécurisés et chiffrés (ex: protocole HTTPS, solution BlueFiles ou équivalent) pour tout échange d'Informations Confidentielles.</li>
            <li><strong>Garantir que les Informations Confidentielles ne sont en aucun cas traitées par des modèles d'intelligence artificielle externes (ChatGPT, Gemini, etc).</strong></li>
        </ol>

        <h2>Article 3 : Protection des Données à Caractère Personnel (RGPD)</h2>
        <p>Dans l'hypothèse où les Informations Confidentielles contiendraient des données à caractère personnel (au sens du Règlement (UE) 2016/679), les Parties reconnaissent que le Divulgateur agit en qualité de Responsable de Traitement et le Receveur (AnaByo) en qualité de Sous-Traitant.</p>
        <p>En sa qualité de Sous-Traitant, le Receveur s'engage à :</p>
        <ol>
            <li>Traiter les données uniquement sur instruction documentée du Divulgateur (c'est-à-dire, pour les seules finalités de la Mission).</li>
            <li>Garantir la confidentialité des données personnelles traitées.</li>
            <li>Assurer la sécurité des données en mettant en œuvre les mesures techniques décrites à l'Article 2.</li>
            <li>Notifier le Divulgateur dans les meilleurs délais après en avoir pris connaissance de toute violation de données à caractère personnel.</li>
            <li>Aider le Divulgateur, dans la mesure du possible, à s'acquitter de ses propres obligations RGPD.</li>
            <li>Respecter les engagements de destruction des données tels que définis à l'Article 6.</li>
        </ol>

        <h2>Article 4 : Exclusions</h2>
        <p>Les obligations de confidentialité ne s'appliquent pas aux informations dont le Receveur peut prouver :</p>
        <ul>
            <li>qu'elles étaient dans le domaine public au moment de leur divulgation ;</li>
            <li>qu'il les connaissait déjà avant la divulgation, sans obligation de confidentialité ;</li>
            <li>qu'il les a reçues légalement d'un tiers non soumis à une obligation de confidentialité.</li>
        </ul>

        <h2>Article 5 : Durée de l'Accord</h2>
        <p>L'obligation de confidentialité restera en vigueur pendant toute la durée de la Mission et se poursuivra pour une période de dix (10) ans après la fin de celle-ci (date de la facture finale).</p>

        <h2>Article 6 : Destruction ("Zéro Trace")</h2>
        <p>Au terme de la Mission, et après une période de garde de 30 jours maximum (permettant d'assurer le suivi post-livraison et la validation par le Divulgateur), le Receveur s'engage à détruire de manière sécurisée et définitive toutes les copies des Informations Confidentielles en sa possession (sur supports locaux, en ligne et sauvegardes), sans possibilité de récupération.</p>

        <h2>Article 7 : Propriété Intellectuelle</h2>
        <p>Le présent accord n'accorde au Receveur aucun droit, titre ou licence de propriété intellectuelle sur les Informations Confidentielles, qui demeurent la propriété exclusive du Divulgateur.</p>

        <h2>Article 8 : Droit Applicable</h2>
        <p>Le présent accord est régi par le droit français. En cas de litige, les Parties s'efforceront de trouver une solution amiable. À défaut, les tribunaux compétents de Bordeaux seront seuls compétents.</p>

        <div class="signature-section">
            <div class="signature-box">
                <div>
                    <div class="signature-title">Pour le Divulgateur :</div>
                    <strong>${clientName}</strong><br>
                    ${clientRep}
                </div>
                <div class="signature-line">Date : .................................................</div>
            </div>
            <div class="signature-box">
                <div>
                    <div class="signature-title">Pour le Receveur :</div>
                    <strong>AnaByo</strong><br>
                    Tom Bourachot
                    ${signatureHtml}
                </div>
                <div class="signature-line">Date : ${date}</div>
            </div>
        </div>
    </body>
    </html>
    `;
}