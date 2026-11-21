/**
 * Copie l'index des lieux livré avec les applications (frontend/public/carte/lieux-index.json)
 * vers le serveur (backend/data/lieux-index.json.gz) : une seule source, deux emplacements.
 * À relancer après chaque régénération de l'index — un test vérifie que les deux concordent.
 *
 *   npm run index-lieux
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { gzipSync } from 'node:zlib';

const source = new URL('../../frontend/public/carte/lieux-index.json', import.meta.url);
const cible = new URL('../data/lieux-index.json.gz', import.meta.url);
const json = readFileSync(source);
const { lieux, categories } = JSON.parse(json.toString('utf8'));
mkdirSync(new URL('../data/', import.meta.url), { recursive: true });
writeFileSync(cible, gzipSync(json, { level: 9 }));
console.log(`${lieux.length} lieux, ${categories.length} catégories → data/lieux-index.json.gz`);
