// Fichier : netlify/shared/templates/invoice.js

module.exports.getInvoiceTemplate = function(data) {
    const { numero, date, client, lignes, totalHT, ref_devis, iban, bic } = data;

    const lignesHtml = lignes.map(l => `
        <tr>
            <td style="text-align:left; padding: 8px; border-bottom: 1px solid #eee;">${l.description}</td>
            <td style="text-align:center; padding: 8px; border-bottom: 1px solid #eee;">${l.quantite}</td>
            <td style="text-align:right; padding: 8px; border-bottom: 1px solid #eee;">${l.prix_unitaire.toFixed(2)}</td>
            <td style="text-align:right; padding: 8px; border-bottom: 1px solid #eee; font-weight:bold;">${l.total.toFixed(2)}</td>
        </tr>
    `).join('');

    return `
    <!DOCTYPE html>
    <html lang="fr">
    <head>
        <meta charset="UTF-8">
        <style>
            body { 
                font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif; 
                padding: 40px; 
                color: #333; 
                max-width: 800px; 
                margin: 0 auto; 
                font-size: 14px; 
                line-height: 1.5; 
            }
            
            /* En-tête */
            .header-table { width: 100%; margin-bottom: 40px; }
            
            /* --- LOGO TEXTE (Couleurs Site) --- */
            .logo { font-size: 36px; font-weight: 800; margin-bottom: 5px; letter-spacing: -1px; line-height: 1; }
            .logo .ana { color: #38bdf8; } /* Sky-400 */
            .logo .byo { color: #a3e635; } /* Lime-400 */
            /* ---------------------------------- */

            .seller-info { font-size: 12px; color: #64748b; margin-top: 10px; }
            
            .invoice-details { text-align: right; vertical-align: top; }
            .invoice-title { margin: 0; color: #0369a1; font-size: 24px; text-transform: uppercase; letter-spacing: 1px; }
            .invoice-meta { margin: 4px 0; font-size: 14px; font-weight: bold; }
            .invoice-ref { margin: 0; font-size: 12px; color: #64748b; font-style: italic; }

            /* Client */
            .client-box { 
                margin-bottom: 40px; 
                padding: 20px; 
                background: #f8fafc; 
                border-radius: 8px; 
                border: 1px solid #e2e8f0; 
                width: 45%; 
                margin-left: auto; 
            }
            .client-label { font-size: 10px; text-transform: uppercase; color: #64748b; font-weight: bold; margin-bottom: 5px; display: block; }
            .client-name { font-size: 16px; font-weight: bold; color: #0f172a; }
            .client-address { white-space: pre-line; margin-top: 5px; color: #334155; font-size: 13px; }

            /* Tableau */
            table.items { width: 100%; border-collapse: collapse; margin-bottom: 30px; }
            table.items th { background: #f1f5f9; padding: 10px; text-align: center; font-size: 11px; text-transform: uppercase; color: #475569; border-bottom: 2px solid #cbd5e1; }
            
            /* Totaux */
            .totals-container { display: flex; justify-content: flex-end; margin-bottom: 40px; page-break-inside: avoid; }
            .totals-box { width: 250px; text-align: right; }
            .total-row { margin-bottom: 5px; font-size: 14px; }
            .total-final { font-size: 18px; font-weight: bold; color: #0369a1; border-top: 2px solid #e2e8f0; padding-top: 10px; margin-top: 10px; }
            .tva-notice { font-size: 10px; color: #64748b; margin-bottom: 10px; }

            /* Paiement */
            .payment-info { 
                background: #f0f9ff; 
                border-left: 4px solid #0ea5e9; 
                padding: 15px; 
                font-size: 13px;
                page-break-inside: avoid;
                margin-bottom: 30px;
            }
            .payment-title { font-weight: bold; color: #0c4a6e; margin-bottom: 5px; display: block; }
            .iban-box { font-family: monospace; background: white; padding: 5px 10px; border-radius: 4px; border: 1px solid #bae6fd; display: inline-block; margin-top: 5px; }

            /* --- MENTIONS LÉGALES (Remontées) --- */
            .legal-info {
                text-align: center;
                font-size: 10px;
                color: #94a3b8;
                border-top: 1px solid #e2e8f0;
                padding-top: 20px;
                margin-top: 20px;
                page-break-inside: avoid;
            }
        </style>
    </head>
    <body>
        <table class="header-table">
            <tr>
                <td valign="top">
                    <div class="logo"><span class="ana">Ana</span><span class="byo">Byo</span></div>
                    
                    <div class="seller-info">
                        Tom Bourachot<br>
                        Expert en Bio-informatique<br>
                        anabyopro@gmail.com
                    </div>
                </td>
                <td class="invoice-details">
                    <h1 class="invoice-title">Facture</h1>
                    <p class="invoice-meta">N° ${numero}</p>
                    <p class="invoice-meta">Date : ${date}</p>
                    <p class="invoice-ref">Réf projet : ${ref_devis}</p>
                </td>
            </tr>
        </table>

        <div class="client-box">
            <span class="client-label">Facturé à :</span>
            <div class="client-name">${client.nom_complet}</div>
            ${client.representant ? `<div>Attn: ${client.representant}</div>` : ''}
            <div class="client-address">${client.adresse || ''}</div>
        </div>

        <table class="items">
            <thead>
                <tr>
                    <th style="text-align:left;">Désignation</th>
                    <th width="60">Qté</th>
                    <th width="100">Prix U.</th>
                    <th width="100">Total HT</th>
                </tr>
            </thead>
            <tbody>${lignesHtml}</tbody>
        </table>

        <div class="totals-container">
            <div class="totals-box">
                <div class="total-row">Total HT : ${totalHT.toFixed(2)} €</div>
                <div class="tva-notice">TVA non applicable, art. 293 B du CGI</div>
                <div class="total-final">Net à payer : ${totalHT.toFixed(2)} €</div>
            </div>
        </div>

        <div class="payment-info">
            <span class="payment-title">Mode de règlement : Virement Bancaire</span>
            Merci d'indiquer le numéro de facture <strong>${numero}</strong> en libellé du virement.<br>
            <div class="iban-box">
                IBAN : FR76 1451 8292 6709 0152 0374 030 &nbsp;|&nbsp; BIC : FTNOFRPIXXX
            </div>
        </div>

        <div class="legal-info">
            Conditions de paiement : 30 jours nets date de facture. Aucun escompte pour paiement anticipé.<br>
            En cas de retard, une pénalité de 3 fois le taux d'intérêt légal et une indemnité forfaitaire de 40€ pour frais de recouvrement seront exigibles.<br>
            <br>
            AnaByo - Tom Bourachot - SIRET : 934 342 511 00016 - Siège social : 21 rue de la république, 33400 Talence
        </div>
    </body>
    </html>
    `;
};