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
                *,
                created_at,
                date_mise_a_jour,
                clients_identite (
                    nom_complet,
                    email,
                    representant,
                    fonction,
                    adresse,
                    telephone
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
            
            return {
                ...m, 
                date_creation: dateObj.toISOString(), // Mappé pour le frontend
                
                // On remonte TOUTES les infos clients (nécessaire pour facturation/contact)
                nom_client: m.clients_identite?.nom_complet || 'Client Inconnu',
                email_client: m.clients_identite?.email || '',
                representant: m.clients_identite?.representant || '',
                fonction: m.clients_identite?.fonction || '',
                adresse: m.clients_identite?.adresse || '',
                telephone: m.clients_identite?.telephone || ''
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