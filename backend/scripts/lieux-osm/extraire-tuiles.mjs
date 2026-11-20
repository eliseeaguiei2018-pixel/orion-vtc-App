#!/usr/bin/env node
/**
 * Extraction OpenStreetMap depuis les tuiles vectorielles OpenFreeMap (mises à jour chaque
 * semaine) : lieux nommés (couche « place ») et limites administratives (couche
 * « boundary »). Usage : node extraire-tuiles.mjs <dossier-de-sortie>
 * Produit places-z14.json, places-z13.json, limites-z14.json.
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const sortie = process.argv[2];
if (!sortie) throw new Error('Usage : node extraire-tuiles.mjs <dossier-de-sortie>');
mkdirSync(sortie, { recursive: true });
// Décodeurs de tuiles livrés avec MapLibre (dépendance du frontend).
const req = createRequire(new URL('../../../frontend/package.json', import.meta.url));
const { VectorTile } = await import(req.resolve('@mapbox/vector-tile'));
const { PbfReader: Pbf } = await import(req.resolve('pbf'));

const tuilesUrl = (await (await fetch('https://tiles.openfreemap.org/planet')).json()).tiles[0];
const lon2x = (lon, z) => Math.floor((lon + 180) / 360 * 2 ** z);
const lat2y = (lat, z) => Math.floor((1 - Math.log(Math.tan(lat * Math.PI / 180) + 1 / Math.cos(lat * Math.PI / 180)) / Math.PI) / 2 * 2 ** z);

async function parcourir(z, [o, s, e, n], surTuile) {
  for (let x = lon2x(o, z); x <= lon2x(e, z); x++) for (let y = lat2y(n, z); y <= lat2y(s, z); y++) {
    const r = await fetch(tuilesUrl.replace('{z}', z).replace('{x}', x).replace('{y}', y));
    if (r.ok) surTuile(new VectorTile(new Pbf(new Uint8Array(await r.arrayBuffer()))), x, y);
  }
}

for (const [z, emprise, fichier] of [[14, [-4.12, 5.24, -3.88, 5.46], 'places-z14.json'], [13, [-4.16, 5.20, -3.80, 5.52], 'places-z13.json']]) {
  const vus = new Map();
  await parcourir(z, emprise, (t, x, y) => {
    const c = t.layers.place; if (!c) return;
    for (let i = 0; i < c.length; i++) {
      const f = c.feature(i); const g = f.toGeoJSON(x, y, z).geometry;
      const nom = f.properties['name:fr'] || f.properties.name;
      if (g.type !== 'Point' || !nom) continue;
      const k = `${nom}|${f.properties.class}`;
      if (!vus.has(k)) vus.set(k, { nom, classe: f.properties.class, rang: f.properties.rank ?? null, lat: +g.coordinates[1].toFixed(5), lng: +g.coordinates[0].toFixed(5) });
    }
  });
  writeFileSync(path.join(sortie, fichier), JSON.stringify([...vus.values()]));
  console.log(fichier, vus.size, 'lieux');
}

const segs = {};
await parcourir(14, [-4.22, 5.19, -3.78, 5.56], (t, x, y) => {
  const c = t.layers.boundary; if (!c) return;
  for (let i = 0; i < c.length; i++) {
    const f = c.feature(i); const g = f.toGeoJSON(x, y, 14).geometry;
    const lignes = g.type === 'LineString' ? [g.coordinates] : g.type === 'MultiLineString' ? g.coordinates : [];
    for (const l of lignes) for (let k = 1; k < l.length; k++) (segs[f.properties.admin_level] ??= new Set()).add([l[k - 1][0], l[k - 1][1], l[k][0], l[k][1]].map((v) => +v.toFixed(6)).join(','));
  }
});
writeFileSync(path.join(sortie, 'limites-z14.json'), JSON.stringify(Object.fromEntries(Object.entries(segs).map(([k, v]) => [k, [...v].map((s) => s.split(',').map(Number))]))));
console.log('limites', Object.fromEntries(Object.entries(segs).map(([k, v]) => [k, v.size])));
