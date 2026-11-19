# Scripts des deux tutos Cap.so (écran + voix)

## Tuto 1 — Installation (~3 min)
1. « Voici l'outil : une Google Sheet pilote un script Apps Script, et GitHub Actions fait le rendu vidéo. »
2. Montrer le dépôt GitHub (dossiers `apps_script`, `render`, `.github/workflows`) et le fork/création du dépôt.
3. Sheet vierge > Extensions > Apps Script : coller `Lib.gs`, `Code.gs`, `appsscript.json`.
4. Menu Vidéos programmatiques > Initialiser : montrer les 3 onglets PRODUCTION, PROMPTS, CONFIG_LOG.
5. Configurer les secrets (flouter la clé Groq et le jeton GitHub à l'écran) ; copier le `WEBHOOK_TOKEN`.
6. Déployer la web app (moi / tout le monde), copier l'URL.
7. GitHub > Settings > Secrets : `WEBHOOK_URL` et `WEBHOOK_TOKEN`.
8. Installer les déclencheurs, autoriser. « L'installation est terminée. »

## Tuto 2 — Utilisation (~4 min)
1. Montrer les 3 PDF sur Drive (CV, portfolio, offre) et copier leurs liens dans une nouvelle ligne de PRODUCTION ; Option B.
2. Passer `Statut_Traitement` à `A_TRAITER` : « Aucun autre clic : le déclenchement se fait depuis la Sheet. »
3. Statut → `SCRIPT_EN_COURS` puis `EN_ATTENTE_VALIDATION` ; ouvrir `Script_JSON`, montrer scènes, `faits_sources`, `Nb_Mots` (≤ 130) et `Cout_Estime_EUR`.
4. Ouvrir CONFIG_LOG : montrer la validation anti-hallucination (et, idéalement, un rejet puis une correction).
5. Relecture humaine : mettre `Validation_Humaine` = `OUI`.
6. Onglet Actions de GitHub : le workflow `render-video` tourne (~2 min).
7. Retour dans la Sheet : statut `TERMINE`, `Duree_Audio_Sec` (45-60), `URL_Video_Cloud` ; **ouvrir le lien et lire la vidéo finale** (voix + sous-titres).
8. Montrer le brouillon Gmail créé (non envoyé) avec le lien.
9. Refaire un second run (2 générations complètes demandées) ou le montrer déjà présent.
