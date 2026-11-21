import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

/**
 * API GATEWAY : la configuration de la passerelle couvre toutes les routes du serveur.
 * Une route ajoutée au serveur sans son chemin dans deploy/gcp/api-gateway/openapi.yaml serait
 * refusée par la passerelle (404) une fois en production : ce test échoue avant.
 */
const RACINE = new URL('..', import.meta.url).pathname;
const SPEC = readFileSync(join(RACINE, '../deploy/gcp/api-gateway/openapi.yaml'), 'utf8');
const DISPENSES = new Set(readFileSync(join(RACINE, 'src/config/index.ts'), 'utf8').match(/GCP_GATEWAY_EXEMPT: z\.string\(\)\.default\('([^']+)'\)/)![1]!.split(',').map((p) => p.slice(1)));

function fichiers(dossier: string): string[] {
  return readdirSync(dossier).flatMap((n) => { const p = join(dossier, n); return statSync(p).isDirectory() ? fichiers(p) : p.endsWith('.ts') ? [p] : []; });
}

test('chaque route du serveur a son chemin dans la configuration de la passerelle', () => {
  // Chemins déclarés dans la passerelle : « /prefixe » (exact) et « /prefixe/{chemin=**} » (tout ce qui suit).
  const declares = new Set<string>();
  let courant = '';
  for (const ligne of SPEC.split('paths:')[1]!.split('\n')) {
    const chemin = /^ {2}(\/[^:]+):/.exec(ligne);
    if (chemin) { courant = chemin[1]!.replace('/{chemin=**}', '/*'); continue; }
    const methode = /^ {4}(get|post|put|patch|delete):/.exec(ligne);
    if (methode && courant) declares.add(`${methode[1]} ${courant}`);
  }
  assert.ok(declares.size > 30, 'configuration de la passerelle lue');

  const manquantes: string[] = [];
  let routes = 0;
  for (const f of fichiers(join(RACINE, 'src'))) {
    for (const m of readFileSync(f, 'utf8').matchAll(/\b(?:app|scoped)\.(get|post|put|patch|delete)\(\s*[`']\/([a-zA-Z-]+)(\/?)/g)) {
      const [, methode, prefixe, suite] = m;
      if (DISPENSES.has(prefixe!)) continue;
      routes++;
      const attendu = `${methode} /${prefixe}${suite ? '/*' : ''}`;
      if (!declares.has(attendu)) manquantes.push(`${attendu}  (${f.replace(RACINE, '')})`);
    }
  }
  assert.ok(routes > 100, `routes du serveur lues : ${routes}`);
  assert.deepEqual(manquantes, [], 'routes absentes de deploy/gcp/api-gateway/openapi.yaml');
});
