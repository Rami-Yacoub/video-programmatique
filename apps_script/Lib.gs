/**
 * Lib.gs — fonctions pures (sans service Google) : testables sous Node, voir tests/test_lib.js.
 * Contient les garde-fous « zéro hallucination » et les limites de format du sujet 8.
 */

var MAX_WORDS = 130;   // barème : 130 mots max (malus si > 140 mots ou > 60 s)
var MIN_WORDS = 100;   // ~45 s de voix à débit naturel
var MIN_SCENES = 4;
var MAX_SCENES = 7;

/** Minuscules, sans accents ni ponctuation : sert à comparer script et sources. */
function normalize_(s) {
  return String(s || '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function countWords_(text) {
  var m = String(text || '').match(/[\wÀ-ÿ'’-]+/g);
  return m ? m.length : 0;
}

/** Retire e-mails et téléphones avant tout envoi au LLM (minimisation RGPD). */
function anonymize_(text) {
  return String(text || '')
    .replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, '[email]')
    .replace(/(\+?\d[\d .-]{8,}\d)/g, '[tel]');
}

/** Extrait un objet JSON d'une réponse de LLM (tolère un éventuel texte autour). */
function extractJson_(text) {
  var t = String(text || '').trim();
  try { return JSON.parse(t); } catch (e) { /* on tente l'extraction */ }
  var a = t.indexOf('{'), b = t.lastIndexOf('}');
  if (a >= 0 && b > a) { return JSON.parse(t.substring(a, b + 1)); }
  throw new Error('Réponse du LLM non parsable en JSON');
}

/** Identifiant Drive depuis une URL (…/d/<id>/…, ?id=<id>, …/folders/<id>). */
function fileIdFromUrl_(url) {
  var m = String(url || '').match(/[-\w]{25,}/);
  if (!m) { throw new Error('URL Drive invalide : ' + url); }
  return m[0];
}

/** Remplace {{CLE}} par vars[CLE] dans un gabarit de prompt. */
function fillTemplate_(tpl, vars) {
  return String(tpl || '').replace(/\{\{(\w+)\}\}/g, function (all, k) {
    return (k in vars) ? String(vars[k]) : all;
  });
}

/**
 * Valide le script JSON produit par le LLM (ou corrigé à la main).
 * @param {Object} script  JSON scène par scène
 * @param {string[]} sources  textes bruts des PDF (vérité terrain)
 * @return {{ok:boolean, errors:string[], nbMots:number}}
 */
function validateScript_(script, sources) {
  var errors = [];
  var nbMots = 0;
  if (!script || typeof script !== 'object') {
    return { ok: false, errors: ['JSON vide ou invalide'], nbMots: 0 };
  }
  ['candidat', 'poste'].forEach(function (k) {
    if (!script[k] || typeof script[k] !== 'string') { errors.push("champ '" + k + "' manquant"); }
  });
  var scenes = script.scenes;
  if (!Array.isArray(scenes) || scenes.length < MIN_SCENES || scenes.length > MAX_SCENES) {
    errors.push('scenes : ' + MIN_SCENES + ' à ' + MAX_SCENES + ' scènes attendues');
    return { ok: false, errors: errors, nbMots: 0 };
  }
  var corpus = ' ' + normalize_(sources.join(' ')) + ' ';
  var corpusTokens = {};
  corpus.split(' ').forEach(function (t) { if (t) { corpusTokens[t] = true; } });

  scenes.forEach(function (s, i) {
    var n = i + 1;
    ['scene_id', 'titre_ecran', 'mots_cles_ecran', 'texte_voix_off', 'faits_sources'].forEach(function (k) {
      if (s[k] === undefined || s[k] === null || s[k] === '') { errors.push('scène ' + n + " : '" + k + "' manquant"); }
    });
    if (!Array.isArray(s.mots_cles_ecran) || s.mots_cles_ecran.length < 1 || s.mots_cles_ecran.length > 5) {
      errors.push('scène ' + n + " : 'mots_cles_ecran' doit contenir 1 à 5 éléments");
    }
    nbMots += countWords_(s.texte_voix_off);

    // Garde-fou 1 : chaque extrait cité doit exister mot pour mot dans les sources.
    var faits = Array.isArray(s.faits_sources) ? s.faits_sources : [];
    if (faits.length === 0) { errors.push('scène ' + n + ' : aucun fait source cité'); }
    faits.forEach(function (f) {
      var nf = normalize_(f);
      if (nf.split(' ').length < 3 || corpus.indexOf(' ' + nf + ' ') < 0) {
        errors.push('scène ' + n + ' : extrait introuvable dans les PDF → "' + String(f).slice(0, 60) + '"');
      }
    });
    // Garde-fou 2 : tout chiffre prononcé doit figurer dans les sources.
    (normalize_(s.texte_voix_off).match(/\b\d+\b/g) || []).forEach(function (num) {
      if (!corpusTokens[num]) { errors.push('scène ' + n + ' : chiffre "' + num + '" absent des PDF'); }
    });
  });

  if (nbMots > MAX_WORDS) { errors.push('trop long : ' + nbMots + ' mots (max ' + MAX_WORDS + ')'); }
  if (nbMots < MIN_WORDS) { errors.push('trop court : ' + nbMots + ' mots (min ' + MIN_WORDS + ')'); }
  return { ok: errors.length === 0, errors: errors, nbMots: nbMots };
}

/** Coût en euros à partir de l'usage de tokens et des tarifs (par million de tokens). */
function estimateCost_(usage, priceInPerM, priceOutPerM) {
  var u = usage || {};
  return ((u.prompt_tokens || 0) * (priceInPerM || 0) + (u.completion_tokens || 0) * (priceOutPerM || 0)) / 1e6;
}
