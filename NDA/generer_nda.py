from fpdf import FPDF, XPos, YPos
from datetime import datetime
import os
import json
from .pdf_base import BasePDF # Import relatif depuis le même package

class NDAPDF(BasePDF):
    """
    Génère le PDF du NDA :
    - Page 1: Résumé style CGV (police DejaVu)
    - Page 2+: Contrat style 1 colonne (police DejaVu)
    """
    
    def header(self):
        if self.page_no() == 1:
            self.header_layout()

    def footer(self):
        """ Utilise le pied de page centralisé. """
        super().footer(doc_type="NDA")

    def create_summary_page(self, main_title, subtitle, points_data):
        """
        Surcharge la méthode de base pour fournir les données spécifiques au NDA.
        La signature de la méthode est maintenant cohérente avec la classe parente.
        """
        """Crée la page de résumé en utilisant la méthode centralisée de BasePDF."""
        nda_points = [
            {
                "title": "1. Qu'est-ce qui est confidentiel ?",
                "text": "Absolument tout est confidentiel (données brutes, résultats). AnaByo s'engage à utiliser des supports cryptés, à limiter l'accès à une seule personne et, point crucial, garantit de ne jamais traiter vos données à l'aide d'une IA."
            },
            {
                "title": "2. Politique \"Zéro Trace\"",
                "text": "Une fois la mission validée par vos soins (et après un court délai de suivi), toutes vos données sont définitivement et sécuritairement détruites de nos systèmes."
            },
            {
                "title": "3. Propriété Intellectuelle",
                "text": "Vous restez l'unique propriétaire de vos données et des résultats. Cet accord ne donne à AnaByo aucun droit de propriété intellectuelle sur vos travaux."
            },
            {
                "title": "4. Durée",
                "text": "L'engagement de confidentialité ne s'arrête pas à la fin de la mission. Il reste en vigueur pour une durée de 10 ans après la facture finale."
            }
        ]

        super().create_summary_page( # Appelle la méthode parente avec les données du NDA
            main_title="Accord de Non-Divulgation",
            subtitle="L'essentiel en 30 secondes",
            points_data=nda_points
        )

    # --- Fonctions de style pour le contrat (1 colonne, style "DejaVu") ---

    def chapter_title(self, title):
        """ Titre principal (ex: ACCORD DE CONFIDENTIALITÉ) """
        self.set_font(self.font_name, "B", 20) 
        self.multi_cell(0, 10, f"{title} - AnaByo", align='C', new_x=XPos.LMARGIN, new_y=YPos.NEXT)
        self.ln(15) 

    def sub_title(self, title):
        """ 
        Titres d'article (ex: Article 1: Définition...) 
        CORRIGÉ pour centrer le PRÉAMBULE et mettre les Articles en BI.
        """
        self.ln(5) # Espace avant
        
        if "PRÉAMBULE" in title.upper():
            self.set_font(self.font_name, "B", 10) # Gras
            align = 'C' # Centré
        else:
            self.set_font(self.font_name, "BI", 10) # Gras Italique
            align = 'L' # Aligné à gauche
            
        self.multi_cell(0, 8, title, align=align, new_x=XPos.LMARGIN, new_y=YPos.NEXT)
        self.ln(2)

    def chapter_body(self, text):
        """ 
        Corps de texte, en DejaVu et justifié.
        CORRIGÉ pour résoudre le problème de saut de ligne.
        """
        self.set_font(self.font_name, "", 10) 
        self.multi_cell(0, 5, text, align='J', new_x=XPos.LMARGIN, new_y=YPos.NEXT)
        # PAS de self.ln(3) ici, pour resserrer les lignes

    def write_markdown_line(self, text):
        """
        Écrit une ligne (liste ou gras) en style DejaVu, 1 colonne.
        """
        parts = text.split('**')
        
        for i, part in enumerate(parts):
            if not part:
                continue
            if i % 2 == 0:
                self.set_font(self.font_name, "", 10) 
            else:
                self.set_font(self.font_name, "B", 10)
            
            self.write(text=part) 
        
        # Logique d'espacement
        text_to_check = text.strip().lstrip('**').lstrip()
        
        # CORRECTION : Définir plus précisément les lignes d'information des parties
        # pour un espacement simple, sans affecter les autres lignes.
        party_info_keywords = [
            "Nom du Laboratoire / Partenaire", "Adresse :", "Représenté par :",
            "Siège social :", "N° SIRET :", "Email :",
        ]
        is_party_info_line = any(keyword in text_to_check for keyword in party_info_keywords)

        # CORRECTION : Rétablir l'espace après la dernière ligne d'info du client.
        # Si la ligne est la dernière du bloc "Divulgateur", on ajoute un espace plus grand.
        if "Représenté par :" in text_to_check and self.client_data.get('representant') in text_to_check:
            is_party_info_line = False # On la traite comme une ligne normale pour avoir un espacement plus grand après.

        if (text_to_check.startswith('- ') or 
            text_to_check.startswith('* ') or 
            (text_to_check and text_to_check[0].isdigit() and ". " in text_to_check) or
             is_party_info_line):
            self.ln(5) # Espacement simple pour les listes
        else:
            self.ln(8) # Espacement plus grand pour les paragraphes

    def signature_section(self, name, title, signature_path=None):
        """ Surcharge la base pour forcer le style NDA (pas de ligne). """
        self.set_font(self.font_name, "", 10) 
        super().signature_section(
            name=name, 
            title=title, 
            width=80, 
            draw_line=False, # Pas de ligne
            signature_path=signature_path
        )

def generer_nda_pdf(config_data, output_dir, client_data_override=None):
    """
    Fonction principale pour générer le PDF du NDA (style 1 colonne).
    """
    client_data = config_data['client']
    nda_data = config_data['nda']
    prestataire_data = config_data['prestataire']
    
    # --- Lecture et préparation du contenu du NDA ---
    script_dir = os.path.dirname(__file__)
    project_root = os.path.abspath(os.path.join(script_dir, '..', '..'))
    nda_source_path = os.path.join(project_root, 'templates', 'nda_source.md')

    with open(nda_source_path, 'r', encoding='utf-8') as f:
        nda_template = f.read()

    # Remplacer les placeholders
    placeholders = {
         "{duree_confidentialite_ans}": str(nda_data.get("duree_confidentialite_ans", 10)),
         "{delai_destruction_jours}": str(nda_data.get("delai_destruction_jours", 30)),
         "{juridiction_competente}": nda_data.get("juridiction_competente", "tribunaux compétents de Bordeaux"),
         "`[NOM COMPLET DU PARTENAIRE OU LABORATOIRE]`": client_data.get('nom_complet', ''),
         "`[SIREN DU PARTENAIRE]`": client_data.get('siren', ''),
         "`[Adresse du PARTENAIRE]`": client_data.get('adresse', '').replace('\n', ', '),
         "`[Nom du contact principal, ex: Dr. Dupont]`": client_data.get('representant', ''),
         "`[VOTRE NUMÉRO DE SIRET ICI]`": "99998298600013",
    }
    nda_content = nda_template
    for placeholder, value in placeholders.items():
        nda_content = nda_content.replace(placeholder, value)

    pdf = NDAPDF('P', 'mm', 'A4')

    # CORRECTION : Stocker client_data dans l'instance pour y accéder depuis les méthodes
    pdf.client_data = client_data
    
    pdf.add_page()
    pdf.alias_nb_pages()
    
    # --- BOUCLE DE GÉNÉRATION (style 1 colonne) ---
    is_prestataire_block = False # Flag pour gérer le bloc d'infos du prestataire
    for line in nda_content.split('\n'):
        text = line.strip()
        
        if text.startswith('# '): 
            pdf.chapter_title(text.lstrip('# '))
            is_prestataire_block = False
            
        elif text.startswith('## '):
            pdf.sub_title(text.lstrip('## '))
            is_prestataire_block = "Le \"Receveur\"" in text

        elif text and not text.startswith('`[') and not text.startswith('<br>'):
            # CORRECTION 1: Logique d'espacement pour l'en-tête
            # Si la ligne contient ':', '1.' ou '2.' (comme dans la définition des parties)
            # OU si elle contient du gras ou des listes.
            
            # CORRECTION : Ajout d'un espace après "Le Divulgateur"
            if "Nom du Laboratoire / Partenaire" in text:
                pdf.ln(3)

            # CORRECTION : Ajout d'un espace après "Le Receveur"
            if "Représenté par : Tom Bourachot" in text:
                pdf.ln(3)

            if (':' in text or '1.' in text or '2.' in text or
                text.startswith('- ') or text.startswith('* ') or 
                '**' in text):
                
                pdf.write_markdown_line(text)
            
            # Sinon, c'est un paragraphe normal justifié
            # CORRECTION 3: Si on est dans le bloc prestataire, on resserre les lignes
            elif is_prestataire_block:
                pdf.set_font(pdf.font_name, "", 10)
                pdf.multi_cell(0, 5, text, align='L', new_x=XPos.LMARGIN, new_y=YPos.NEXT)

            else:
                pdf.chapter_body(text)
    
    # --- SIGNATURES ---
    # Vérifier s'il reste assez de place pour les signatures (environ 60mm)
    # self.h = hauteur de la page, self.b_margin = marge du bas
    hauteur_signatures_estimee = 60 
    if pdf.get_y() > (pdf.h - pdf.b_margin - hauteur_signatures_estimee):
        pdf.add_page()
        # On s'assure que le footer de la page précédente est bien numéroté
        # et que la nouvelle page a le bon numéro pour le footer suivant.
        pdf.alias_nb_pages() 

    pdf.ln(10)
    y_signatures_start = pdf.get_y() 

    pdf.set_font(pdf.font_name, 'B', 10) 
    pdf.cell(95, 7, "Pour le Divulgateur (Le Partenaire)", border=0, align='L')
    
    pdf.set_xy(115, y_signatures_start) 
    pdf.set_font(pdf.font_name, 'B', 10)
    pdf.cell(95, 7, "Pour le Receveur (Le Prestataire)", border=0, align='L')
    pdf.ln() 

    y_sections_start = pdf.get_y() 

    pdf.set_xy(pdf.l_margin, y_sections_start) 
    pdf.signature_section(f"{client_data['representant']}", f"{client_data['fonction']}")

    # --- CORRECTION : Utiliser le chemin de la signature depuis la config ---
    # On récupère le chemin relatif depuis config.json et on le rend absolu
    signature_path_relatif = prestataire_data.get('signature_path')
    signature_path = None
    if signature_path_relatif and isinstance(signature_path_relatif, str):
        signature_path_abs = os.path.join(project_root, signature_path_relatif)
        if os.path.exists(signature_path_abs):
            signature_path = signature_path_abs

    pdf.set_xy(115, y_sections_start) 
    pdf.signature_section(
        "Tom Bourachot", 
        "Entrepreneur Individuel", 
        signature_path=signature_path
    )

    # --- Génération du fichier ---
    os.makedirs(output_dir, exist_ok=True)
    nom_fichier_base = f"NDA_AnaByo_{client_data['nom_complet'].replace(' ', '_')}.pdf"
    chemin_sortie = os.path.join(output_dir, nom_fichier_base)
    pdf.output(chemin_sortie)
    print(f"✅ NDA (style 1 colonne) généré : {chemin_sortie}")


if __name__ == '__main__':
    script_dir = os.path.dirname(__file__)
    project_root = os.path.abspath(os.path.join(script_dir, '..', '..'))
    signature_path = os.path.join(project_root, 'templates', 'assets', 'signatures', 'signature_tom_bourachot.png')
    print("--- Lancement de la génération du NDA en mode test ---")
    script_dir = os.path.dirname(__file__)
    project_root = os.path.abspath(os.path.join(script_dir, '..', '..'))
    output_folder_test = os.path.join(project_root, 'output', 'nda')
    os.makedirs(output_folder_test, exist_ok=True)
    print(f"Dossier de sortie pour le test : {output_folder_test}")

    config_file_path = os.path.join(project_root, 'config.json')
    if not os.path.exists(config_file_path):
        print(f"❌ ERREUR : Le fichier de configuration '{config_file_path}' est introuvable.")
        raise FileNotFoundError(f"Fichier de configuration introuvable: {config_file_path}")
    
    with open(config_file_path, 'r', encoding='utf-8') as f:
        # On ne modifie plus le config data, on le passe tel quel
        generer_nda_pdf(config_data=json.load(f), output_dir=output_folder_test)

    # Le code ci-dessous est maintenant inutile car on lit directement depuis config.json
    # signature_path_test = os.path.join(project_root, 'templates', 'assets', 'signatures', 'signature_tom_bourachot.png')
    # if 'prestataire' not in loaded_config_data:
    #     loaded_config_data['prestataire'] = {}
    # loaded_config_data['prestataire']['signature_path'] = signature_path_test

    print("--- Fin de la génération du NDA de test ---")