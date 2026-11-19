"""Génère 3 PDF d'exemple FICTIFS (Option B) : CV, lettre/portfolio, fiche de poste.
Personne réelle non concernée : remplacez-les par vos propres documents pour la démo."""
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import getSampleStyleSheet
from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer
import sys

DOCS = {
"cv_exemple.pdf": ("Camille Durand - Ingénieure Data / IA", [
 "Profil : élève ingénieure en dernière année, spécialité intelligence artificielle et data science.",
 "Formation : Diplôme d'ingénieur en cours, école d'ingénieurs, parcours IA et Data Science (2024-2027).",
 "Expérience 1 : Stage de 4 mois chez Optilog, développement d'un modèle de prévision de la demande en Python, réduction de l'erreur de prévision de 18 %.",
 "Expérience 2 : Projet de fin d'études en équipe de 4 personnes, chatbot RAG pour la documentation interne, 1 200 documents indexés.",
 "Compétences : Python, SQL, scikit-learn, PyTorch, Google Apps Script, Docker, Git.",
 "Langues : Français (langue maternelle), Anglais (niveau C1), Espagnol (niveau B1).",
]),
"portfolio_exemple.pdf": ("Portfolio et lettre de motivation - Camille Durand", [
 "Réalisation 1 : Tableau de bord de suivi qualité déployé pour 3 équipes, utilisé chaque semaine.",
 "Réalisation 2 : Pipeline d'extraction de factures par OCR, 92 % des champs reconnus automatiquement.",
 "Réalisation 3 : Concours de data science, classement dans le top 10 sur 120 équipes.",
 "Motivation : je souhaite mettre mes compétences en machine learning au service de produits concrets et mesurables.",
 "Disponibilité : stage de fin d'études de 6 mois à partir de février 2027.",
]),
"offre_exemple.pdf": ("Offre - Ingénieur Data / IA (stage 6 mois) - Datavox Technologies", [
 "Entreprise : Datavox Technologies, éditeur de solutions d'analyse de données pour le secteur de la santé.",
 "Mission : concevoir et industrialiser des modèles de machine learning et des assistants basés sur l'IA générative.",
 "Profil recherché : formation d'ingénieur en IA ou data science, maîtrise de Python et SQL, goût pour le travail en équipe.",
 "Atouts appréciés : expérience en traitement de documents, OCR, ou RAG, et capacité à mesurer l'impact des modèles.",
 "Contrat : stage de 6 mois, démarrage en février 2027.",
])}

for name, (title, lines) in DOCS.items():
    st = getSampleStyleSheet()
    doc = SimpleDocTemplate(f"samples/{name}", pagesize=A4, title=title)
    story = [Paragraph(title, st["Title"]), Spacer(1, 12)]
    for l in lines:
        story += [Paragraph(l, st["BodyText"]), Spacer(1, 8)]
    doc.build(story)
print("OK")
