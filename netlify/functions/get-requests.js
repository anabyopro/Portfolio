const { createClient } = require('@supabase/supabase-js');

exports.handler = async function(event) {
    // 1. Authentification
    const correctPassword = process.env.ADMIN_PASSWORD;
    const providedPassword = event.headers['x-admin-password'];

    if (!providedPassword || providedPassword !== correctPassword) {
        return { statusCode: 401, body: JSON.stringify({ error: "Accès non autorisé." }) };
    }

    const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

    try {
        // 2. Récupération des données (On sélectionne toutes les colonnes d'identité)
        const { data: missions, error } = await supabase
            .from('demandes_clients')
            .select(`
                id, tracking_id, created_at, date_mise_a_jour, statut, client_id,
                nom_client, email, contact, fonction, adresse, telephone, siren, tva_intracom,
                type_demande, message, is_urgent, facture_url, bluefiles_link,
                clients_identite (
                    nom_complet, email, representant, fonction, adresse, telephone, siren, tva_intracom
                ),
                finance_recettes (
                    montant_ht,
                    date_paiement,
                    statut_paiement
                )
            `)
            .order('created_at', { ascending: false });

        if (error) throw error;

        // 3. TRADUCTION et FLATTENING pour le Tableau de Bord
        const missionsFormatees = missions.map(m => {
            
            // On s'assure que la date est lisible et corrigée (+2h) pour l'affichage admin
            let dateObj = new Date(m.created_at || m.date_mise_a_jour || new Date().toISOString());
            if (!isNaN(dateObj.getTime())) {
                dateObj.setHours(dateObj.getHours() + 2); // Correction UTC vers France
            }
            
            // Récupération des infos financières (si facture générée)
            const finance = m.finance_recettes && m.finance_recettes.length > 0 ? m.finance_recettes[0] : {};
            
            return {
                ...m, 
                date_creation: dateObj.toISOString(), // Mappé pour le frontend
                
                // CORRECTION : On utilise EN PRIORITÉ les infos du dossier (m.*), 
                // et seulement si elles sont vides, on prend celles de la fiche client.
                nom_client: m.nom_client || m.clients_identite?.nom_complet || 'Client Inconnu',
                email_client: m.email || m.clients_identite?.email || '',
                representant: m.contact || m.clients_identite?.representant || '',
                fonction: m.fonction || m.clients_identite?.fonction || '',
                adresse: m.adresse || m.clients_identite?.adresse || '',
                telephone: m.telephone || m.clients_identite?.telephone || '',
                siren: m.siren || m.clients_identite?.siren || '',
                tva: m.tva_intracom || m.clients_identite?.tva_intracom || '',
                
                // Infos Finance pour le Livre des Recettes
                montant: finance.montant_ht || null,
                date_paiement: finance.date_paiement || null,
                statut_paiement: finance.statut_paiement || null
            };
        });

        return {
            statusCode: 200,
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(missionsFormatees)
        };

    } catch (error) {
        console.error("Erreur get-requests:", error);
        return { statusCode: 500, body: JSON.stringify({ error: error.message }) };
    }
};