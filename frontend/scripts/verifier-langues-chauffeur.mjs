// Contrôle des traductions de l'app Chauffeur (npm run check:langues).
// Chaque phrase affichée (tr('…'), aTraduire('…'), libelles({…})) doit exister dans les
// 8 langues des tables src/driver/langues, avec les mêmes variables {0}, {1}…
// Échoue (code 1) au moindre manque : aucune phrase ne reste en français par oubli.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import ts from 'typescript';

const RACINE = join(import.meta.dirname, '..', 'src', 'driver');
const LANGUES = ['fr', 'en', 'es', 'it', 'ar', 'zh', 'de', 'ru'];
// Noms propres, marques et unités : identiques dans toutes les langues.
const INVARIABLES = new Set(['Wave', 'Orange Money', 'MTN MoMo', 'Moov Money', 'GPS', 'SoC', 'SoH', '{0} kWh', 'Google Maps', 'Waze', 'ORION',
  'Type 1', 'Type 2', 'CCS', 'CHAdeMO', 'GB/T', '1234 AB 01']);

const fichiers = (dir) => readdirSync(dir).flatMap((n) => {
  const p = join(dir, n);
  return statSync(p).isDirectory() ? fichiers(p) : /\.(ts|tsx)$/.test(n) ? [p] : [];
});
const lire = (p) => ts.createSourceFile(p, readFileSync(p, 'utf8'), ts.ScriptTarget.Latest, true, p.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);

// 1. Phrases utilisées dans le code
const phrases = new Map();
const litteraux = (e, out) => {
  if (ts.isStringLiteral(e) || ts.isNoSubstitutionTemplateLiteral(e)) out.push(e.text);
  else if (ts.isConditionalExpression(e)) { litteraux(e.whenTrue, out); litteraux(e.whenFalse, out); }
  else if (ts.isParenthesizedExpression(e)) litteraux(e.expression, out);
  else if (ts.isBinaryExpression(e) && e.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken) { litteraux(e.left, out); litteraux(e.right, out); }
  return out;
};
for (const f of fichiers(RACINE).filter((p) => !p.includes(`${join('driver', 'langues')}`) && !p.endsWith('demo.ts'))) {
  const sf = lire(f);
  const ici = relative(RACINE, f);
  const visiter = (n) => {
    if (ts.isCallExpression(n) && n.arguments[0]) {
      const nom = n.expression.getText(sf);
      if (nom === 'tr' || nom === 'aTraduire') for (const t of litteraux(n.arguments[0], [])) if (!phrases.has(t)) phrases.set(t, ici);
      if (nom === 'libelles') {
        const v = (m) => { if (ts.isStringLiteral(m) && ts.isPropertyAssignment(m.parent) && m.parent.initializer === m && !phrases.has(m.text)) phrases.set(m.text, ici); ts.forEachChild(m, v); };
        v(n.arguments[0]);
      }
    }
    ts.forEachChild(n, visiter);
  };
  visiter(sf);
}

// 2. Tables de traduction
const table = new Map();
let problemes = 0;
const signaler = (...m) => { console.log('✗', ...m); problemes++; };
for (const f of fichiers(join(RACINE, 'langues'))) {
  const sf = lire(f);
  const visiter = (n) => {
    if (ts.isArrayLiteralExpression(n) && n.elements.length && n.elements.every((e) => ts.isStringLiteral(e))) {
      const ligne = n.elements.map((e) => e.text);
      const deja = table.get(ligne[0]);
      if (deja && deja.join('\u0000') !== ligne.join('\u0000')) signaler('Doublon divergent :', ligne[0]);
      table.set(ligne[0], ligne);
      return;
    }
    ts.forEachChild(n, visiter);
  };
  visiter(sf);
}
const variables = (s) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(',');
for (const [fr, ligne] of table) {
  LANGUES.forEach((l, i) => {
    if (i === 0) return;
    if (!ligne[i]) signaler(`Traduction ${l} manquante :`, fr);
    else if (variables(ligne[i]) !== variables(fr)) signaler(`Variables différentes en ${l} :`, fr, '→', ligne[i]);
  });
}
for (const [fr, ou] of phrases) if (!table.has(fr) && !INVARIABLES.has(fr)) signaler(`Phrase sans traduction (${ou}) :`, JSON.stringify(fr));
const orphelines = [...table.keys()].filter((k) => !phrases.has(k));
if (orphelines.length) console.log(`ℹ ${orphelines.length} ligne(s) de traduction sans usage :`, orphelines.join(' | '));

console.log(problemes
  ? `${problemes} problème(s) de traduction — app Chauffeur`
  : `Traductions de l'app Chauffeur complètes : ${phrases.size} phrases × ${LANGUES.length} langues ✔`);
process.exit(problemes ? 1 : 0);
