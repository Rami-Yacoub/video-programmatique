# Vidéos programmatiques — Tour de contrôle (ESIEA, sujet 8, Option B)

Dépose de 3 PDF (CV, portfolio/lettre, offre) dans une Google Sheet → pitch vidéo de 45-60 s,
sous-titré, hébergé sur Drive, avec brouillon Gmail. Aucun outil no-code, aucune clé en clair.

## Architecture
```
Google Sheet (PRODUCTION / PROMPTS / CONFIG_LOG)      Statut = A_TRAITER
   │ Apps Script : OCR Drive des 3 PDF → anonymisation e-mails/tél → LLM Groq (JSON strict)
   │   → garde-fous (extraits verbatim, chiffres, 100-130 mots) → 3 essais auto-corrigés
   ▼ Statut = EN_ATTENTE_VALIDATION   ← l'humain relit/corrige le script, met Validation_Humaine = OUI
   │ Apps Script re-valide, puis API REST GitHub (repository_dispatch)
   ▼ GitHub Actions : edge-tts (voix) + visuels Pillow + sous-titres + FFmpeg ; débit ajusté pour 45-60 s
   │ POST (jeton secret) → web app Apps Script
   ▼ Drive (partage par lien) → URL_Video_Cloud, durée, date, Statut = TERMINE, brouillon Gmail (non envoyé)
```
Tout s'exécute dans le cloud : aucun téléchargement ni ré-upload manuel. Les erreurs mettent le statut à `ERREUR` et écrivent dans CONFIG_LOG.

## Installation (≈ 10 min)
1. Créez un dépôt GitHub (public ou privé) avec le contenu de ce dossier.
2. Créez une Google Sheet, **Extensions > Apps Script**, collez `Lib.gs`, `Code.gs` et `appsscript.json` (Paramètres du projet > afficher le manifeste).
3. Rechargez la Sheet : menu **Vidéos programmatiques > 1. Initialiser**, puis **2. Configurer les secrets** (clé Groq, `utilisateur/depot`, jeton GitHub *fine-grained* avec « Contents : read/write » sur ce seul dépôt). Notez le `WEBHOOK_TOKEN` affiché.
4. **Déployer > Nouvelle application Web** (exécuter en tant que : moi ; accès : tout le monde). Copiez l'URL.
5. GitHub > Settings > Secrets > Actions : `WEBHOOK_URL` (URL de l'étape 4) et `WEBHOOK_TOKEN`.
6. Menu **3. Installer les déclencheurs**. Autorisez les accès Google.
7. Utilisation : une ligne dans PRODUCTION (`Option_Choisie`, 3 URL Drive), `Statut_Traitement` = `A_TRAITER`. Relisez `Script_JSON`, mettez `Validation_Humaine` = `OUI`. Quelques minutes plus tard : `URL_Video_Cloud`.

Tests : `node tests/test_lib.js` (garde-fous) et `ALLOW_TTS_FALLBACK=1 python -m pytest tests/` (rendu).

## Coût unitaire par vidéo
| Brique | Coût |
|---|---|
| LLM Groq (palier gratuit, ~3 appels × ~4 k tokens max) | 0 € (hors palier : tarif × tokens, calculé dans `Cout_Estime_EUR` via `PRICE_IN_PER_M`/`PRICE_OUT_PER_M`) |
| edge-tts, FFmpeg, Pillow | 0 € |
| GitHub Actions (~2 min de calcul) | 0 € (palier gratuit) |
| Drive / Apps Script / Gmail | 0 € |

## Risques et parades
- **Hallucinations** : le LLM doit citer des extraits copiés mot pour mot des PDF ; Apps Script vérifie qu'ils existent dans les sources, que chaque chiffre prononcé y figure, et rejette sinon (3 essais avec retour d'erreur). Le script est re-validé après toute modification humaine. Relecture humaine obligatoire avant rendu.
- **RGPD / droit à l'image** : e-mails et téléphones retirés avant l'appel LLM ; Option A : consultants désignés « Consultant 1/2 » ; voix de synthèse générique (aucun clonage), aucune image de personne ; vidéos en partage par lien, jamais publiques. Les PDF de démo fournis sont fictifs.
- **Format** : durée mesurée sur l'audio réel (45-60 s), débit ajusté ±25 %, sinon échec explicite ; 130 mots max.
- **Secrets** : propriétés du script Apps Script et secrets GitHub ; webhook protégé par jeton.
- **Dépendance** : edge-tts utilise un service Microsoft non officiel ; en cas d'indisponibilité le rendu échoue proprement (statut `ERREUR`) — alternative : Google Cloud TTS.
