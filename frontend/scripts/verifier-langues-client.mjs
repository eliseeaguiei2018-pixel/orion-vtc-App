#!/usr/bin/env node
/**
 * CONTRÔLE DES TRADUCTIONS DE L'APP CLIENT (lancé par la CI : npm run check:langues).
 *
 * Chaque texte français doit exister dans les 7 autres langues. Seule exception, déclarée
 * et affichée au client dans sa langue : les textes JURIDIQUES (legal_*) et MÉDICAUX
 * d'ORION Assurance (as_*, ant_*), qui restent en français (version qui fait foi) tant
 * qu'un traducteur assermenté ne les a pas validés — sauf en anglais, déjà validé.
 *
 * Les dictionnaires sont en TypeScript : on les transpile à la volée avec le compilateur
 * du projet (aucune dépendance de plus).
 */
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import ts from 'typescript';

const racine = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'src', 'i18n');
const fichiers = ['translations', 'complements', 'complements-langues', 'nouveautes', 'lieux'];
const tmp = mkdtempSync(path.join(tmpdir(), 'orion-langues-'));
try {
  for (const f of fichiers) {
    const source = readFileSync(path.join(racine, `${f}.ts`), 'utf8');
    const js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText
      .replace(/from '\.\/([\w-]+)'/g, "from './$1.mjs'");
    writeFileSync(path.join(tmp, `${f}.mjs`), js);
  }
  const { TRANSLATIONS } = await import(pathToFileURL(path.join(tmp, 'translations.mjs')).href);
  const fr = TRANSLATIONS.fr;
  const exempte = (k) => /^(legal_|as_|ant_)/.test(k) && k !== 'legal_credits_t' && k !== 'legal_carte';
  let erreurs = 0;
  for (const [lang, dict] of Object.entries(TRANSLATIONS)) {
    if (lang === 'fr') continue;
    const manquantes = Object.keys(fr).filter((k) => !(k in dict) && (lang === 'en' || !exempte(k)));
    const vides = Object.keys(dict).filter((k) => typeof dict[k] !== 'string' || !dict[k].trim());
    // Variables {x} : la traduction doit garder les mêmes, sinon le texte affiche « {x} ».
    const variables = Object.keys(fr).filter((k) => k in dict && [...fr[k].matchAll(/\{(\w+)\}/g)].some((m) => !dict[k].includes(m[0])));
    for (const [titre, liste] of [['manquantes', manquantes], ['vides', vides], ['variables perdues', variables]]) {
      if (liste.length) { erreurs += liste.length; console.error(`✗ ${lang} : ${liste.length} clé(s) ${titre} — ${liste.slice(0, 12).join(', ')}${liste.length > 12 ? '…' : ''}`); }
    }
    if (!manquantes.length && !vides.length && !variables.length) console.log(`✓ ${lang} : ${Object.keys(fr).length} textes couverts`);
  }
  if (erreurs) { console.error(`\n${erreurs} problème(s) de traduction dans l'app client.`); process.exitCode = 1; }
} finally {
  rmSync(tmp, { recursive: true, force: true });
}
