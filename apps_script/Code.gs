/**
 * Code.gs — Tour de contrôle « Vidéos programmatiques » (ESIEA, sujet 8).
 *
 * Flux : Sheet (A_TRAITER) -> extraction PDF (OCR Drive) -> LLM Groq (JSON strict + garde-fous)
 *        -> EN_ATTENTE_VALIDATION -> l'humain met Validation_Humaine = OUI
 *        -> GitHub Actions (repository_dispatch) rend la vidéo -> webhook doPost
 *        -> vidéo dans Drive + URL dans la Sheet + brouillon Gmail (jamais envoyé automatiquement).
 *
 * Aucune clé en clair : tout est stocké dans les propriétés du script (menu « Configurer les secrets »).
 */

var SHEET_PROD = 'PRODUCTION';
var SHEET_PROMPTS = 'PROMPTS';
var SHEET_LOG = 'CONFIG_LOG';

var ST = {
  TODO: 'A_TRAITER', GEN: 'SCRIPT_EN_COURS', WAIT: 'EN_ATTENTE_VALIDATION',
  RENDER: 'RENDU_EN_COURS', DONE: 'TERMINE', ERR: 'ERREUR'
};

// Colonnes imposées par le sujet, puis colonnes de pilotage ajoutées à droite.
var PROD_HEADERS = [
  'ID_Execution', 'Option_Choisie', 'URL_PDF_1', 'URL_PDF_2_ou_Portfolio', 'URL_Brief_ou_Offre',
  'Statut_Traitement', 'Duree_Audio_Sec', 'URL_Video_Cloud', 'Date_Generation',
  'Script_JSON', 'Validation_Humaine', 'Nb_Mots', 'Cout_Estime_EUR', 'Brouillon_Gmail'
];
var PROMPT_HEADERS = ['ID_Prompt', 'Role_Systeme', 'Template_Prompt_User', 'Temperature', 'Model_Name'];
var LOG_HEADERS = ['Timestamp', 'Niveau_Log', 'Etape_Workflow', 'Message_Detaille'];

var DEFAULT_MODEL = 'llama-3.3-70b-versatile';
var VOICE = 'fr-FR-DeniseNeural';

// ------------------------------------------------------------------ menu & installation
function onOpen() {
  SpreadsheetApp.getUi().createMenu('Vidéos programmatiques')
    .addItem('1. Initialiser la Sheet', 'setupSheets')
    .addItem('2. Configurer les secrets', 'configureSecrets')
    .addItem('3. Installer les déclencheurs', 'installTriggers')
    .addSeparator()
    .addItem('Générer les scripts (A_TRAITER)', 'generateAll')
    .addItem('Lancer le rendu des scripts validés', 'renderAllValidated')
    .addToUi();
}

function setupSheets() {
  var ss = SpreadsheetApp.getActive();
  ensureSheet_(ss, SHEET_PROD, PROD_HEADERS, '#1a237e');
  ensureSheet_(ss, SHEET_PROMPTS, PROMPT_HEADERS, '#004d40');
  ensureSheet_(ss, SHEET_LOG, LOG_HEADERS, '#37474f');

  var prod = ss.getSheetByName(SHEET_PROD);
  prod.getRange('B2:B200').setDataValidation(
    SpreadsheetApp.newDataValidation().requireValueInList(['A', 'B'], true).build());
  prod.getRange('F2:F200').setDataValidation(
    SpreadsheetApp.newDataValidation().requireValueInList(Object.keys(ST).map(function (k) { return ST[k]; }), true).build());
  prod.getRange('K2:K200').setDataValidation(
    SpreadsheetApp.newDataValidation().requireValueInList(['OUI', 'NON'], true).build());
  prod.setFrozenRows(1);

  var pr = ss.getSheetByName(SHEET_PROMPTS);
  if (pr.getLastRow() < 2) { pr.getRange(2, 1, 2, 5).setValues(defaultPrompts_()); }
  pr.setColumnWidths(2, 2, 520);
  logEvent_('INFO', 'SETUP', 'Feuilles initialisées');
  SpreadsheetApp.getActive().toast('Sheet initialisée. Étape suivante : « Configurer les secrets ».');
}

function ensureSheet_(ss, name, headers, color) {
  var sh = ss.getSheetByName(name) || ss.insertSheet(name);
  sh.getRange(1, 1, 1, headers.length).setValues([headers])
    .setBackground(color).setFontColor('#ffffff').setFontWeight('bold');
  return sh;
}

function configureSecrets() {
  var ui = SpreadsheetApp.getUi();
  var props = PropertiesService.getScriptProperties();
  var fields = [
    ['GROQ_API_KEY', 'Clé API Groq (console.groq.com, gratuite)'],
    ['GH_REPO', 'Dépôt GitHub au format utilisateur/depot'],
    ['GH_TOKEN', 'Jeton GitHub fine-grained (Contents : lecture/écriture sur ce dépôt)'],
    ['GMAIL_TO', "(optionnel) destinataire du brouillon d'e-mail"],
    ['CALENDLY_URL', '(optionnel) lien Calendly à inclure dans le brouillon']
  ];
  fields.forEach(function (f) {
    var r = ui.prompt(f[1], 'Laisser vide pour conserver la valeur actuelle.', ui.ButtonSet.OK_CANCEL);
    if (r.getSelectedButton() !== ui.Button.OK) { return; }
    if (r.getResponseText().trim()) { props.setProperty(f[0], r.getResponseText().trim()); }
  });
  if (!props.getProperty('WEBHOOK_TOKEN')) {
    props.setProperty('WEBHOOK_TOKEN', Utilities.getUuid() + Utilities.getUuid());
  }
  ui.alert('Secrets enregistrés',
    "Jeton du webhook à copier dans les secrets GitHub (WEBHOOK_TOKEN) :\n\n" +
    props.getProperty('WEBHOOK_TOKEN') +
    "\n\nPuis déployez la web app (Déployer > Nouveau déploiement > Application Web, " +
    "exécuter en tant que : moi, accès : tout le monde) et copiez son URL dans le secret GitHub WEBHOOK_URL.",
    ui.ButtonSet.OK);
}

function installTriggers() {
  ScriptApp.getProjectTriggers().forEach(function (t) { ScriptApp.deleteTrigger(t); });
  ScriptApp.newTrigger('handleEdit_').forSpreadsheet(SpreadsheetApp.getActive()).onEdit().create();
  logEvent_('INFO', 'SETUP', 'Déclencheur onEdit installé (pilotage 100 % depuis la Sheet)');
  SpreadsheetApp.getActive().toast('Déclencheur installé.');
}

// ------------------------------------------------------------------ déclenchement par la Sheet
function handleEdit_(e) {
  var sh = e.range.getSheet();
  if (sh.getName() !== SHEET_PROD || e.range.getRow() < 2) { return; }
  var col = e.range.getColumn();
  var row = e.range.getRow();
  var status = sh.getRange(row, 6).getValue();
  if (col === 6 && e.range.getValue() === ST.TODO) { processRow_(sh, row); }
  if (col === 11 && e.range.getValue() === 'OUI' && status === ST.WAIT) { dispatchRender_(sh, row); }
}

function generateAll() {
  var sh = SpreadsheetApp.getActive().getSheetByName(SHEET_PROD);
  for (var r = 2; r <= sh.getLastRow(); r++) {
    if (sh.getRange(r, 6).getValue() === ST.TODO) { processRow_(sh, r); }
  }
}

function renderAllValidated() {
  var sh = SpreadsheetApp.getActive().getSheetByName(SHEET_PROD);
  for (var r = 2; r <= sh.getLastRow(); r++) {
    if (sh.getRange(r, 6).getValue() === ST.WAIT && sh.getRange(r, 11).getValue() === 'OUI') {
      dispatchRender_(sh, r);
    }
  }
}

// ------------------------------------------------------------------ étapes 1 et 2 : PDF -> script
function processRow_(sh, row) {
  var runId = sh.getRange(row, 1).getValue() || ('RUN-' + Utilities.formatDate(new Date(), 'Europe/Paris', 'yyyyMMdd-HHmmss'));
  sh.getRange(row, 1).setValue(runId);
  setStatus_(sh, row, ST.GEN);
  try {
    var option = String(sh.getRange(row, 2).getValue() || 'B').toUpperCase();
    var urls = sh.getRange(row, 3, 1, 3).getValues()[0];
    var sources = urls.map(function (u, i) { return extractPdfText_(u, 'PDF ' + (i + 1)); });
    logEvent_('INFO', 'EXTRACTION', runId + ' : ' + sources.map(function (s) { return s.length; }).join('/') + ' caractères extraits');

    var cfg = getPrompt_('P_SCRIPT_' + option);
    var clean = sources.map(anonymize_);
    var vars = { SOURCE_1: clean[0], SOURCE_2: clean[1], SOURCE_3: clean[2], MOTS_MIN: MIN_WORDS, MOTS_MAX: MAX_WORDS };
    var system = fillTemplate_(cfg.system, vars);
    var user = fillTemplate_(cfg.user, vars);

    var script = null, usageTotal = { prompt_tokens: 0, completion_tokens: 0 }, lastErrors = [];
    for (var attempt = 1; attempt <= 3; attempt++) {
      var prompt = user;
      if (lastErrors.length) {
        prompt += '\n\nTa réponse précédente a été REJETÉE pour ces raisons, corrige-les :\n- ' + lastErrors.join('\n- ');
      }
      var res = callGroq_(system, prompt, cfg.temperature, cfg.model);
      usageTotal.prompt_tokens += (res.usage.prompt_tokens || 0);
      usageTotal.completion_tokens += (res.usage.completion_tokens || 0);
      var parsed;
      try { parsed = extractJson_(res.content); } catch (err) { lastErrors = [String(err.message)]; logEvent_('ERROR', 'LLM_JSON', runId + ' essai ' + attempt + ' : ' + err.message); continue; }
      var v = validateScript_(parsed, clean);
      if (v.ok) { script = parsed; script.__nbMots = v.nbMots; break; }
      lastErrors = v.errors.slice(0, 6);
      logEvent_('ERROR', 'VALIDATION', runId + ' essai ' + attempt + ' : ' + v.errors.slice(0, 3).join(' | '));
    }
    if (!script) { throw new Error('Script rejeté après 3 essais : ' + lastErrors.join(' | ')); }

    var nbMots = script.__nbMots; delete script.__nbMots;
    var props = PropertiesService.getScriptProperties();
    var cost = estimateCost_(usageTotal, Number(props.getProperty('PRICE_IN_PER_M')), Number(props.getProperty('PRICE_OUT_PER_M')));
    sh.getRange(row, 10).setValue(JSON.stringify(script, null, 2));
    sh.getRange(row, 12).setValue(nbMots);
    sh.getRange(row, 13).setValue(cost);
    sh.getRange(row, 11).setValue('NON');
    setStatus_(sh, row, ST.WAIT);
    logEvent_('INFO', 'SCRIPT', runId + ' : script validé automatiquement (' + nbMots + ' mots). Relecture humaine requise.');
  } catch (err) {
    setStatus_(sh, row, ST.ERR);
    logEvent_('ERROR', 'GENERATION', runId + ' : ' + err.message);
  }
}

/** Extraction PDF robuste : conversion Drive avec OCR (gère aussi les PDF scannés). */
function extractPdfText_(url, label) {
  var id = fileIdFromUrl_(url);
  var file = DriveApp.getFileById(id);
  var text;
  if (file.getMimeType() === MimeType.GOOGLE_DOCS) {
    text = DocumentApp.openById(id).getBody().getText();
  } else {
    var tmp = Drive.Files.create({ name: 'tmp_ocr_' + id, mimeType: MimeType.GOOGLE_DOCS },
      file.getBlob(), { ocrLanguage: 'fr' });
    try { text = DocumentApp.openById(tmp.id).getBody().getText(); }
    finally { Drive.Files.remove(tmp.id); }
  }
  if (!text || text.trim().length < 150) {
    throw new Error(label + ' illisible : texte vide même après OCR (' + file.getName() + ')');
  }
  return text.trim();
}

function getPrompt_(id) {
  var sh = SpreadsheetApp.getActive().getSheetByName(SHEET_PROMPTS);
  var rows = sh.getDataRange().getValues();
  for (var i = 1; i < rows.length; i++) {
    if (rows[i][0] === id) {
      return { system: rows[i][1], user: rows[i][2], temperature: Number(rows[i][3]) || 0.2, model: rows[i][4] || DEFAULT_MODEL };
    }
  }
  throw new Error('Prompt introuvable dans PROMPTS : ' + id);
}

function callGroq_(system, user, temperature, model) {
  var key = PropertiesService.getScriptProperties().getProperty('GROQ_API_KEY');
  if (!key) { throw new Error("GROQ_API_KEY non configurée (menu « Configurer les secrets »)"); }
  var payload = {
    model: model, temperature: temperature, response_format: { type: 'json_object' },
    messages: [{ role: 'system', content: system }, { role: 'user', content: user }]
  };
  for (var i = 0; i < 2; i++) {
    var r = UrlFetchApp.fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'post', contentType: 'application/json', muteHttpExceptions: true,
      headers: { Authorization: 'Bearer ' + key }, payload: JSON.stringify(payload)
    });
    if (r.getResponseCode() === 429 && i === 0) { Utilities.sleep(8000); continue; }   // quota gratuit
    if (r.getResponseCode() !== 200) { throw new Error('Groq HTTP ' + r.getResponseCode() + ' : ' + r.getContentText().slice(0, 200)); }
    var j = JSON.parse(r.getContentText());
    return { content: j.choices[0].message.content, usage: j.usage || {} };
  }
  throw new Error('Groq : quota dépassé, réessayez dans une minute');
}

// ------------------------------------------------------------------ étape 3 : rendu (GitHub Actions)
function dispatchRender_(sh, row) {
  var runId = sh.getRange(row, 1).getValue();
  try {
    var script = JSON.parse(sh.getRange(row, 10).getValue());
    // Le script a pu être modifié à la main : on re-valide contre les PDF avant de rendre.
    var urls = sh.getRange(row, 3, 1, 3).getValues()[0];
    var clean = urls.map(function (u, i) { return anonymize_(extractPdfText_(u, 'PDF ' + (i + 1))); });
    var v = validateScript_(script, clean);
    if (!v.ok) { throw new Error('Script modifié invalide : ' + v.errors.slice(0, 3).join(' | ')); }

    var props = PropertiesService.getScriptProperties();
    var scenes = script.scenes.map(function (s) {      // faits_sources inutiles côté rendu
      return { scene_id: s.scene_id, titre_ecran: s.titre_ecran, mots_cles_ecran: s.mots_cles_ecran, texte_voix_off: s.texte_voix_off };
    });
    var body = { event_type: 'render_video', client_payload: {
      run_id: runId, voice: VOICE,
      script: { candidat: script.candidat, poste: script.poste, entreprise: script.entreprise || '', scenes: scenes }
    } };
    var r = UrlFetchApp.fetch('https://api.github.com/repos/' + props.getProperty('GH_REPO') + '/dispatches', {
      method: 'post', contentType: 'application/json', muteHttpExceptions: true,
      headers: { Authorization: 'Bearer ' + props.getProperty('GH_TOKEN'), Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' },
      payload: JSON.stringify(body)
    });
    if (r.getResponseCode() !== 204) { throw new Error('GitHub HTTP ' + r.getResponseCode() + ' : ' + r.getContentText().slice(0, 200)); }
    setStatus_(sh, row, ST.RENDER);
    logEvent_('INFO', 'RENDU', runId + ' : rendu déclenché sur GitHub Actions');
  } catch (err) {
    setStatus_(sh, row, ST.ERR);
    logEvent_('ERROR', 'RENDU', runId + ' : ' + err.message);
  }
}

// ------------------------------------------------------------------ étape 5 : retour du rendu (webhook)
function doPost(e) {
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    var body = JSON.parse(e.postData.contents);
    var props = PropertiesService.getScriptProperties();
    if (!body.token || body.token !== props.getProperty('WEBHOOK_TOKEN')) {
      logEvent_('ERROR', 'WEBHOOK', 'Appel refusé : jeton invalide');
      return json_({ ok: false, error: 'unauthorized' });
    }
    var sh = SpreadsheetApp.getActive().getSheetByName(SHEET_PROD);
    var row = findRow_(sh, body.run_id);
    if (!row) { return json_({ ok: false, error: 'run_id inconnu' }); }

    if (body.status !== 'OK') {
      setStatus_(sh, row, ST.ERR);
      logEvent_('ERROR', 'RENDU', body.run_id + ' : ' + (body.message || 'échec du rendu'));
      return json_({ ok: true });
    }
    var blob = Utilities.newBlob(Utilities.base64Decode(body.video_b64), 'video/mp4', body.run_id + '.mp4');
    var file = getOutputFolder_().createFile(blob);
    file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);   // partage par lien
    sh.getRange(row, 7).setValue(body.meta.duree_audio_sec);
    sh.getRange(row, 8).setValue(file.getUrl());
    sh.getRange(row, 9).setValue(new Date());
    setStatus_(sh, row, ST.DONE);
    logEvent_('INFO', 'RENDU', body.run_id + ' : vidéo disponible (' + body.meta.duree_audio_sec + ' s, ' + body.meta.taille_mo + ' Mo)');
    createDraft_(sh, row, file.getUrl());
    return json_({ ok: true });
  } catch (err) {
    logEvent_('ERROR', 'WEBHOOK', String(err.message));
    return json_({ ok: false, error: String(err.message) });
  } finally {
    lock.releaseLock();
  }
}

/** Bonus : brouillon Gmail pré-rédigé. JAMAIS envoyé automatiquement (validation humaine). */
function createDraft_(sh, row, videoUrl) {
  var props = PropertiesService.getScriptProperties();
  var script = JSON.parse(sh.getRange(row, 10).getValue());
  var calendly = props.getProperty('CALENDLY_URL');
  var body = 'Bonjour,\n\nSuite à votre offre « ' + script.poste + ' », je vous partage une courte vidéo de présentation (moins d\'une minute) :\n' +
    videoUrl + '\n\n' + (calendly ? 'Pour échanger, vous pouvez réserver un créneau ici : ' + calendly + '\n\n' : '') +
    'Bien cordialement,\n' + script.candidat;
  GmailApp.createDraft(props.getProperty('GMAIL_TO') || '', 'Candidature – ' + script.poste + ' – vidéo de présentation', body);
  sh.getRange(row, 14).setValue('Brouillon créé (non envoyé)');
  logEvent_('INFO', 'GMAIL', sh.getRange(row, 1).getValue() + ' : brouillon créé, envoi manuel après relecture');
}

// ------------------------------------------------------------------ utilitaires
function getOutputFolder_() {
  var props = PropertiesService.getScriptProperties();
  var id = props.getProperty('DRIVE_FOLDER_ID');
  if (id) { return DriveApp.getFolderById(id); }
  var f = DriveApp.createFolder('Videos_Programmatiques');
  props.setProperty('DRIVE_FOLDER_ID', f.getId());
  return f;
}

function findRow_(sh, runId) {
  var ids = sh.getRange(1, 1, sh.getLastRow(), 1).getValues();
  for (var i = 1; i < ids.length; i++) { if (ids[i][0] === runId) { return i + 1; } }
  return 0;
}

function setStatus_(sh, row, status) { sh.getRange(row, 6).setValue(status); SpreadsheetApp.flush(); }

function logEvent_(level, step, message) {
  var sh = SpreadsheetApp.getActive().getSheetByName(SHEET_LOG);
  if (sh) { sh.appendRow([new Date(), level, step, message]); }
}

function json_(o) { return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON); }

// ------------------------------------------------------------------ prompts par défaut
function defaultPrompts_() {
  var rules =
    "Tu rédiges le script d'une vidéo de pitch de 45 à 60 secondes, en français, à la voix off.\n" +
    "RÈGLES ABSOLUES :\n" +
    "1. Utilise EXCLUSIVEMENT des faits présents dans les sources. N'invente ni compétence, ni diplôme, ni chiffre, ni expérience.\n" +
    "2. Chaque scène contient 'faits_sources' : 1 à 3 extraits COPIÉS MOT POUR MOT (5 à 12 mots) des sources qui justifient la scène.\n" +
    "3. Total des 'texte_voix_off' entre {{MOTS_MIN}} et {{MOTS_MAX}} mots. Phrases courtes, style oral.\n" +
    "4. Structure : scène 1 = accroche personnalisée (poste + entreprise visés) ; scènes centrales = preuves chiffrées ou concrètes issues des sources ; dernière scène = appel à l'action (proposer un échange, sans inventer de lien).\n" +
    "5. Réponds UNIQUEMENT par un objet JSON de la forme :\n" +
    '{"candidat":"...","poste":"...","entreprise":"...","scenes":[{"scene_id":1,"titre_ecran":"...","mots_cles_ecran":["..."],"texte_voix_off":"...","faits_sources":["..."]}]}\n' +
    "avec 4 à 6 scènes, 'mots_cles_ecran' de 1 à 4 éléments courts.";
  var userB = "SOURCE 1 — CV du candidat :\n{{SOURCE_1}}\n\nSOURCE 2 — Portfolio / lettre de motivation :\n{{SOURCE_2}}\n\nSOURCE 3 — Fiche de poste :\n{{SOURCE_3}}\n\nProduis le JSON du pitch (Option B : adéquation profil / poste).";
  var userA = "SOURCE 1 — CV du consultant 1 :\n{{SOURCE_1}}\n\nSOURCE 2 — CV du consultant 2 :\n{{SOURCE_2}}\n\nSOURCE 3 — Brief technique du client :\n{{SOURCE_3}}\n\nProduis le JSON du pitch (Option A : complémentarité des deux consultants face au besoin). Désigne les consultants par 'Consultant 1' et 'Consultant 2' (anonymisation RGPD) ; mets 'Équipe ESN' dans 'candidat'.";
  return [
    ['P_SCRIPT_B', rules, userB, 0.2, DEFAULT_MODEL],
    ['P_SCRIPT_A', rules, userA, 0.2, DEFAULT_MODEL]
  ];
}
