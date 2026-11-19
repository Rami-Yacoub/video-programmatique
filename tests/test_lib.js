// Tests des garde-fous d'Apps Script (Lib.gs) sous Node : `node tests/test_lib.js`
const fs = require('fs'), vm = require('vm'), assert = require('assert');
const ctx = vm.createContext({});
vm.runInContext(fs.readFileSync(__dirname + '/../apps_script/Lib.gs', 'utf8'), ctx);
const run = (code) => vm.runInContext(code, ctx);
const sources = ['cv_exemple', 'portfolio_exemple', 'offre_exemple']
  .map(n => fs.readFileSync(__dirname + '/../samples/' + n + '.txt', 'utf8'));
const good = JSON.parse(fs.readFileSync(__dirname + '/../samples/script_exemple.json', 'utf8'));
ctx.__sources = sources;
const validate = (s) => { ctx.__s = s; return run('validateScript_(__s, __sources)'); };
const clone = () => JSON.parse(JSON.stringify(good));
let n = 0; const ok = (name, fn) => { fn(); n++; console.log('  ok  ' + name); };

ok('script exemple valide (100-130 mots)', () => {
  const r = validate(good);
  assert.ok(r.ok, r.errors.join(' | '));
  assert.ok(r.nbMots >= 100 && r.nbMots <= 130, 'mots=' + r.nbMots);
});
ok('hallucination : extrait absent des PDF rejeté', () => {
  const s = clone(); s.scenes[1].faits_sources = ["maîtrise de Kubernetes et Terraform en production"];
  const r = validate(s); assert.ok(!r.ok && r.errors.some(e => /introuvable/.test(e)));
});
ok('hallucination : chiffre inventé rejeté', () => {
  const s = clone(); s.scenes[1].texte_voix_off = s.scenes[1].texte_voix_off.replace('18', '45');
  const r = validate(s); assert.ok(!r.ok && r.errors.some(e => /45/.test(e)));
});
ok('script trop long rejeté (> 130 mots)', () => {
  const s = clone(); s.scenes[0].texte_voix_off += ' ' + s.scenes[3].texte_voix_off;
  const r = validate(s); assert.ok(!r.ok && r.errors.some(e => /trop long/.test(e)));
});
ok('script trop court rejeté', () => {
  const s = clone(); s.scenes.forEach(x => x.texte_voix_off = 'Bonjour.');
  assert.ok(validate(s).errors.some(e => /trop court/.test(e)));
});
ok('structure : champ manquant rejeté', () => {
  const s = clone(); delete s.scenes[2].mots_cles_ecran;
  assert.ok(!validate(s).ok);
});
ok('JSON vide / nombre de scènes', () => {
  assert.ok(!validate(null).ok);
  const s = clone(); s.scenes = s.scenes.slice(0, 2); assert.ok(!validate(s).ok);
});
ok('anonymize_ retire e-mails et téléphones', () => {
  ctx.__t = 'Contact : jean.dupont@mail.fr ou +33 6 12 34 56 78';
  const t = run('anonymize_(__t)'); assert.ok(!/@|\d{2} \d{2}/.test(t), t);
});
ok('extractJson_ tolère du texte autour', () => {
  ctx.__j = 'Voici : {"a": 1} merci'; assert.strictEqual(run('extractJson_(__j).a'), 1);
  ctx.__j = 'pas de json'; assert.throws(() => run('extractJson_(__j)'));
});
ok('fileIdFromUrl_ / fillTemplate_ / estimateCost_', () => {
  assert.strictEqual(run("fileIdFromUrl_('https://drive.google.com/file/d/1aBcDeFgHiJkLmNoPqRsTuVwXyZ012345/view')"), '1aBcDeFgHiJkLmNoPqRsTuVwXyZ012345');
  assert.strictEqual(run("fillTemplate_('a {{X}} b {{Y}}', {X: 1})"), 'a 1 b {{Y}}');
  assert.strictEqual(run('estimateCost_({prompt_tokens: 1e6, completion_tokens: 1e6}, 0.5, 1.5)'), 2);
});
console.log(n + ' tests OK');
