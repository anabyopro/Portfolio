// Fichier : netlify/shared/templates/invoice.js

module.exports.getInvoiceTemplate = function(data) {
    // Note : dateEcheance doit être passée depuis generate-invoice.js
    const { numero, date, dateEcheance, client, lignes, totalHT, ref_devis } = data;

    const lignesHtml = lignes.map(l => `
        <tr>
            <td style="text-align:left; padding: 12px 8px; border-bottom: 1px solid #eee;">${l.description}</td>
            <td style="text-align:center; padding: 8px; border-bottom: 1px solid #eee;">${l.quantite}</td>
            <td style="text-align:right; padding: 8px; border-bottom: 1px solid #eee;">${l.prix_unitaire.toFixed(2)} €</td>
            <td style="text-align:right; padding: 8px; border-bottom: 1px solid #eee; font-weight:bold;">${l.total.toFixed(2)} €</td>
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
                color: #1e293b; 
                max-width: 850px; 
                margin: 0 auto; 
                font-size: 13px; 
                line-height: 1.5; 
                min-height: 100vh;
                position: relative;
                box-sizing: border-box;
            }
            
            /* En-tête */
            .header-table { width: 100%; margin-bottom: 50px; border-spacing: 0; }
            
            .logo { font-size: 32px; font-weight: 800; margin-bottom: 5px; letter-spacing: -1px; }
            .logo .ana { color: #000000; }
            .logo .byo { color: #a3e635; }

            .seller-info { font-size: 12px; color: #475569; margin-top: 10px; line-height: 1.4; }
            
            .invoice-details { text-align: right; vertical-align: top; }
            .invoice-title { margin: 0; color: #0369a1; font-size: 28px; text-transform: uppercase; font-weight: 900; }
            .invoice-meta { margin: 5px 0; font-size: 14px; font-weight: bold; color: #0f172a; }
            .invoice-ref { margin: 0; font-size: 12px; color: #64748b; }

            /* Client */
            .client-box { 
                margin-bottom: 40px; 
                padding: 20px; 
                background: #f8fafc; 
                border-radius: 12px; 
                border: 1px solid #e2e8f0; 
                width: 45%; 
                margin-left: auto; 
            }
            .client-label { font-size: 10px; text-transform: uppercase; color: #64748b; font-weight: 800; margin-bottom: 8px; display: block; }
            .client-name { font-size: 15px; font-weight: bold; color: #0f172a; margin-bottom: 4px; }
            .client-address { white-space: pre-line; color: #334155; font-size: 12px; }

            /* Tableau */
            table.items { width: 100%; border-collapse: collapse; margin-bottom: 30px; }
            table.items th { background: #f1f5f9; padding: 12px 10px; text-align: center; font-size: 11px; text-transform: uppercase; color: #475569; border-bottom: 2px solid #cbd5e1; }
            
            /* Totaux */
            .totals-container { display: flex; justify-content: flex-end; margin-bottom: 40px; }
            .totals-box { width: 280px; text-align: right; }
            .total-row { margin-bottom: 5px; font-size: 14px; color: #475569; }
            .total-final { font-size: 20px; font-weight: bold; color: #0369a1; border-top: 2px solid #e2e8f0; padding-top: 10px; margin-top: 10px; }
            .tva-notice { font-size: 11px; font-style: italic; color: #64748b; margin-top: 5px; }

            /* Paiement */
            .payment-info { 
                background: #f0f9ff; 
                border-radius: 8px;
                border: 1px solid #bae6fd;
                padding: 20px; 
                font-size: 12px;
                margin-bottom: 40px;
            }
            .payment-title { font-weight: bold; color: #0c4a6e; margin-bottom: 8px; display: block; font-size: 13px; }
            .iban-box { font-family: monospace; font-size: 13px; color: #0369a1; margin-top: 8px; display: block; }

            /* Mentions Légales */
            .legal-footer {
                font-size: 10px;
                color: #94a3b8;
                border-top: 1px solid #e2e8f0;
                padding-top: 20px;
                line-height: 1.6;
                position: absolute;
                bottom: 40px;
                left: 40px;
                right: 40px;
            }
            .legal-section { margin-bottom: 4px; }
        </style>
    </head>
    <body>
        <table class="header-table">
            <tr>
                <td valign="top">
                    <div class="logo"><span class="ana">Ana</span><span class="byo">Byo</span></div>
                    <div class="seller-info">
                        <strong>BOURACHOT Tom - Entrepreneur Individuel</strong><br>
                        41 rue Charles Floquet, Apt 3<br>
                        33400 Talence<br>
                        SIRET : 99998298600013<br>
                        contact@anabyo.com
                    </div>
                </td>
                <td class="invoice-details">
                    <h1 class="invoice-title">Facture</h1>
                    <p class="invoice-meta">N° ${numero}</p>
                    <p class="invoice-meta">Date : ${date}</p>
                    <p class="invoice-ref">Réf. mission : ${ref_devis}</p>
                </td>
            </tr>
        </table>

        <div class="client-box">
            <span class="client-label">Facturé à :</span>
            <div class="client-name">${client.nom_complet}</div>
            <div class="client-address">
                ${client.adresse || ''}
                ${client.siren ? `<br>SIREN : ${client.siren}` : ''}
                ${client.tva_intracom ? `<br>TVA : ${client.tva_intracom}` : ''}
            </div>
        </div>

        <table class="items">
            <thead>
                <tr>
                    <th style="text-align:left;">Désignation des prestations</th>
                    <th width="60">Qté</th>
                    <th width="100">Prix U. HT</th>
                    <th width="100">Total HT</th>
                </tr>
            </thead>
            <tbody>${lignesHtml}</tbody>
        </table>

        <div class="totals-container">
            <div class="totals-box">
                <div class="total-row">Total HT : ${totalHT.toFixed(2)} €</div>
                <div class="total-final">Total TTC : ${totalHT.toFixed(2)} €</div>
                <div class="tva-notice">TVA non applicable, art. 293 B du CGI</div>
            </div>
        </div>

        <div class="payment-info">
            <span class="payment-title">Conditions de règlement</span>
            Date d'échéance : <strong>${dateEcheance || 'À réception'}</strong><br>
            Escompte pour paiement anticipé : Néant<br>
            Mode de règlement : Virement bancaire<br>
            <span class="iban-box">
                IBAN : FR76 1451 8292 6709 0152 0374 030<br>
                BIC : FTNOFRPIXXX
            </span>
        </div>

        <div class="legal-footer">
            <div class="legal-section">
                <strong>Pénalités de retard :</strong> En cas de retard de paiement, un taux égal au taux d'intérêt appliqué par la BCE à son opération de refinancement la plus récente majoré de 10 points de pourcentage sera appliqué.
            </div>
            <div class="legal-section">
                <strong>Indemnité forfaitaire :</strong> En cas de retard de paiement, une indemnité forfaitaire de 40 € pour frais de recouvrement sera due (Art. L. 441-10 du Code de commerce).
            </div>
            <div class="legal-section" style="margin-top: 10px; text-align: center;">
                BOURACHOT Tom EI - SIRET : 99998298600013 - Siège social : 41 rue Charles Floquet, 33400 Talence
            </div>
        </div>
    </body>
    </html>
    `;
};