const { createClient } = require('@supabase/supabase-js');

exports.handler = async function(event) {
    const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
    
    // Vérification Admin (Simple)
    const correctPassword = process.env.ADMIN_PASSWORD;
    const providedPassword = event.headers['x-admin-password'];
    if (!providedPassword || providedPassword !== correctPassword) {
        return { statusCode: 401, body: JSON.stringify({ error: "Non autorisé" }) };
    }

    // --- GET : Récupérer le Bilan ---
    if (event.httpMethod === 'GET') {
        try {
            // 1. Récupérer les Recettes (Factures)
            const { data: recettes, error: errR } = await supabase
                .from('finance_recettes')
                .select('*')
                .order('date_emission', { ascending: false });
            
            if (errR) throw errR;

            // 2. Récupérer les Dépenses
            const { data: depenses, error: errD } = await supabase
                .from('finance_depenses')
                .select('*')
                .order('date_depense', { ascending: false });

            if (errD) throw errD;

            // 3. Calculs
            const totalRecettes = recettes.reduce((sum, r) => sum + (r.montant_ht || 0), 0);
            const totalDepenses = depenses.reduce((sum, d) => sum + (d.montant_ht || 0), 0);
            const solde = totalRecettes - totalDepenses;

            return {
                statusCode: 200,
                body: JSON.stringify({
                    recettes,
                    depenses,
                    stats: {
                        totalRecettes,
                        totalDepenses,
                        solde
                    }
                })
            };
        } catch (error) {
            return { statusCode: 500, body: JSON.stringify({ error: error.message }) };
        }
    }

    // --- POST : Ajouter une Dépense ---
    if (event.httpMethod === 'POST') {
        try {
            const { date, description, montant, categorie } = JSON.parse(event.body);

            const { data, error } = await supabase
                .from('finance_depenses')
                .insert({
                    date_depense: date,
                    description,
                    montant_ht: parseFloat(montant),
                    categorie
                })
                .select()
                .single();

            if (error) throw error;

            return { statusCode: 200, body: JSON.stringify(data) };

        } catch (error) {
            return { statusCode: 500, body: JSON.stringify({ error: error.message }) };
        }
    }

    return { statusCode: 405, body: "Method Not Allowed" };
};