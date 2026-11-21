import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Geocodeur } from '../src/modules/maps/geocodage.js';
import { QUARTIERS_ABIDJAN } from '../src/modules/maps/quartiers-abidjan.js';
import { communeDe, lieuDe } from '../src/modules/maps/lieux.js';
import { buildApp } from '../src/app.js';
import { existsSync, readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { indexLieux } from '../src/modules/maps/index-lieux.js';

const PLATEAU = { lat: 5.3236, lng: -4.0217 };

test('répertoire : sans accents ni tirets, la commune est trouvée', () => {
  const g = new Geocodeur(null);
  assert.equal(g.repertoire('adjame')[0]?.nom, 'Adjamé');
  assert.equal(g.repertoire('port bouet')[0]?.nom, 'Port-Bouët');
  assert.equal(g.repertoire('ATTECOUBE')[0]?.nom, 'Attécoubé');
  assert.equal(g.repertoire('bouake')[0]?.nom, 'Bouaké');
  for (const l of g.repertoire('co')) assert.ok(Number.isFinite(l.location.lat) && Number.isFinite(l.location.lng), 'chaque lieu a sa position');
});

test('répertoire : les quartiers d’Abidjan (OpenStreetMap) sont trouvés hors ligne', () => {
  const g = new Geocodeur(null);
  for (const [q, attendu] of [['riviera 2', 'Riviéra 2'], ['angre', 'Angré'], ['zone 4', 'Zone 4'], ['selmer', 'Selmer'], ['deux plateaux', 'Deux Plateaux'], ['bietri', 'Biétri']] as const) {
    const r = g.repertoire(q, PLATEAU);
    assert.equal(r[0]?.nom, attendu, `« ${q} » → ${r.map((l) => l.nom).join(', ')}`);
    assert.ok(r[0]!.location.lat > 5.1 && r[0]!.location.lat < 5.6 && r[0]!.location.lng > -4.3 && r[0]!.location.lng < -3.6, 'dans le Grand Abidjan');
  }
  // La commune vient des LIMITES communales OSM (Angré est à Cocody, pas à Abobo).
  assert.equal(g.repertoire('angre')[0]?.secteur, 'Quartier · Cocody');
});

test('données : aucun doublon (même nom à moins de 1,5 km), niveaux et communes renseignés', () => {
  const sans = (s: string) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  const L = QUARTIERS_ABIDJAN;
  for (let i = 0; i < L.length; i++) for (let j = i + 1; j < L.length; j++) {
    if (sans(L[i]![0]) !== sans(L[j]![0])) continue;
    const d = Math.hypot((L[i]![1] - L[j]![1]) * 110.6, (L[i]![2] - L[j]![2]) * 110.3);
    assert.ok(d >= 1.5, `doublon : ${L[i]![0]} / ${L[j]![0]} à ${Math.round(d * 1000)} m`);
  }
  assert.ok(L.length > 300, `${L.length} lieux`);
  assert.ok(L.every(([, , , niveau]) => ['quartier', 'sous-quartier', 'village', 'hameau', 'ile'].includes(niveau)));
});

test('commune par les limites OSM : cas connus du terrain', () => {
  const cas: Array<[string, number, number, string]> = [
    ['Angré', 5.40405, -3.98881, 'Cocody'], ['Riviéra 2', 5.34646, -3.97476, 'Cocody'], ['Deux Plateaux', 5.36966, -3.99195, 'Cocody'],
    ['Zone 4', 5.29194, -3.98127, 'Marcory'], ['Biétri', 5.27767, -3.97499, 'Marcory'], ['Anoumabo', 5.30966, -3.96822, 'Marcory'],
    ['Selmer', 5.34037, -4.07002, 'Yopougon'], ['Niangon', 5.32358, -4.09821, 'Yopougon'], ['Williamsville', 5.37183, -4.0247, 'Adjamé'],
    ['Abobo Baoulé', 5.43429, -3.99602, 'Abobo'], ['Vridi', 5.258, -4.01, 'Port-Bouët'], ['Biafra', 5.31344, -4.00484, 'Treichville'],
  ];
  for (const [nom, lat, lng, attendu] of cas) assert.equal(communeDe({ lat, lng }), attendu, nom);
  assert.equal(communeDe({ lat: 7.69, lng: -5.03 }), null, 'Bouaké est hors du district');
});

test('nom d’une position : quartier réel et commune ; hors Abidjan, la ville', () => {
  assert.equal(lieuDe({ lat: 5.34646, lng: -3.97476 }).libelle, 'Riviéra 2, Cocody');
  assert.equal(lieuDe({ lat: 5.2919, lng: -3.9813 }).libelle, 'Zone 4, Marcory');
  assert.equal(lieuDe({ lat: 7.6906, lng: -5.0303 }).libelle, 'Bouaké');
});

test('recherche : un même lieu n’apparaît qu’une fois ; le quartier avant ses subdivisions', () => {
  const g = new Geocodeur(null);
  const angre = g.repertoire('angre').filter((l) => l.nom === 'Angré');
  assert.equal(angre.length, 1, 'Angré proposé une seule fois');
  const zone4 = g.repertoire('zone 4');
  assert.equal(zone4[0]?.nom, 'Zone 4');
  assert.match(zone4[0]!.secteur, /^Quartier · Marcory/);
  assert.ok(zone4.slice(1).some((l) => /^Sous-quartier · Marcory/.test(l.secteur)), zone4.map((l) => `${l.nom} (${l.secteur})`).join(', '));
});

test('OpenStreetMap : adresses précises en premier, avec coordonnées, hors Côte d’Ivoire écarté', async () => {
  let appel = '';
  const faux = async (url: string) => {
    appel = url;
    return new Response(JSON.stringify({ features: [
      { properties: { name: 'Pharmacie de la Riviera Palmeraie', street: 'Boulevard Mitterrand', district: 'Riviera Palmeraie', city: 'Abidjan', countrycode: 'CI', osm_type: 'N', osm_id: 42 }, geometry: { coordinates: [-3.9512, 5.3683] } },
      { properties: { name: 'Riviera', city: 'Accra', countrycode: 'GH', osm_type: 'N', osm_id: 7 }, geometry: { coordinates: [-0.2, 5.6] } },
    ] }), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  const g = new Geocodeur('https://photon.exemple', faux as never);
  const lieux = await g.rechercher('Riviera Palmeraie', PLATEAU);
  assert.equal(lieux[0]?.nom, 'Pharmacie de la Riviera Palmeraie');
  assert.equal(lieux[0]?.source, 'osm');
  assert.deepEqual(lieux[0]?.location, { lat: 5.3683, lng: -3.9512 });
  assert.match(lieux[0]!.secteur, /Riviera Palmeraie/);
  assert.ok(!lieux.some((l) => l.secteur.includes('Accra')), 'le Ghana est écarté');
  assert.match(appel, /bbox=-8\.61%2C4\.34%2C-2\.49%2C10\.74/);
  assert.match(appel, /lang=fr/);
});

test('OpenStreetMap injoignable : le répertoire répond quand même', async () => {
  const panne = async () => { throw new Error('réseau'); };
  const g = new Geocodeur('https://photon.exemple', panne as never);
  const lieux = await g.rechercher('Yopougon', PLATEAU);
  assert.equal(lieux[0]?.nom, 'Yopougon');
  assert.equal(lieux[0]?.source, 'repertoire');
});

test('route /maps/recherche : coordonnées pour chaque résultat ; requête trop courte refusée', async (t) => {
  const { app } = await buildApp();
  t.after(() => app.close());
  const r = await app.inject({ method: 'GET', url: '/maps/recherche?q=cocody&lat=5.32&lng=-4.02' });
  assert.equal(r.statusCode, 200, r.body);
  const lieux = r.json().lieux as Array<{ nom: string; location: { lat: number } }>;
  assert.ok(lieux.some((l) => l.nom === 'Cocody'));
  assert.ok(lieux.every((l) => typeof l.location.lat === 'number'));
  const res = await app.inject({ method: 'POST', url: '/geo/resolve', payload: { point: { lat: 5.34646, lng: -3.97476 } } });
  assert.equal(res.json().lieu.libelle, 'Riviéra 2, Cocody');
  assert.equal((await app.inject({ method: 'GET', url: '/maps/recherche?q=c' })).statusCode, 400);
});

test("app cliente : sa copie des lieux (recherche sans serveur) est identique à celle du serveur", () => {
  const serveur = readFileSync(new URL('../src/modules/maps/quartiers-abidjan.ts', import.meta.url), 'utf8');
  const app = readFileSync(new URL('../../frontend/src/lieux-abidjan.ts', import.meta.url), 'utf8');
  assert.equal(app, serveur, 'régénérer avec scripts/lieux-osm (README) : les deux copies ont divergé');
});

/* ---------------- Index détaillé du district (48 924 lieux), côté serveur ---------------- */

const RIVIERA = { lat: 5.3458, lng: -4.0010 };

test('index détaillé : chargé par le serveur, chaque lieu a un nom, une position et une catégorie', () => {
  const ix = indexLieux();
  assert.ok(ix, 'data/lieux-index.json.gz est lisible');
  assert.ok(ix.lieux.length > 40_000, `${ix.lieux.length} lieux`);
  assert.equal(ix.cles.length, ix.lieux.length);
  for (const [nom, lat, lng, c] of ix.lieux) {
    assert.ok(nom && lat > 4.9 && lat < 5.8 && lng > -4.6 && lng < -3.5, `${nom} ${lat},${lng}`);
    assert.ok(ix.categories[c], `catégorie ${c} de ${nom}`);
  }
});

test('index détaillé : un commerce, une banque, une rue sont trouvés par leur nom, avec leur quartier', () => {
  const g = new Geocodeur(null);
  const ix = indexLieux()!;
  // Un lieu de chaque famille, pris dans l'index lui-même : il doit ressortir de la recherche.
  for (const pictogramme of ['pharmacy', 'bank', 'school', 'road', 'lodging']) {
    const c = ix.categories.findIndex(([, p]) => p === pictogramme);
    const lieu = ix.lieux.find((l) => l[3] === c && l[0].length > 12 && l[0].split(' ').length >= 3);
    assert.ok(lieu, `un lieu « ${pictogramme} » dans l'index`);
    const r = g.repertoire(lieu[0], { lat: lieu[1], lng: lieu[2] });
    const trouve = r.find((l) => l.nom === lieu[0]);
    assert.ok(trouve, `« ${lieu[0]} » → ${r.map((l) => l.nom).join(' | ')}`);
    assert.equal(trouve.categorie, pictogramme);
    assert.equal(trouve.source, 'repertoire');
    assert.match(trouve.secteur, / · /, 'catégorie · quartier ou commune');
  }
});

test('index détaillé : « pharmacie », « banque », « mosquée » donnent les lieux de la catégorie les plus proches', () => {
  const g = new Geocodeur(null);
  for (const [q, pictogrammes] of [['pharmacie', ['pharmacy']], ['banque', ['bank']], ['mosquee', ['religious_muslim', 'place_of_worship']], ['supermarche', ['grocery', 'shop']]] as const) {
    const r = g.repertoire(q, RIVIERA);
    assert.ok(r.length >= 8, `« ${q} » : ${r.length} résultats`);
    const duType = r.filter((l) => (pictogrammes as readonly string[]).includes(l.categorie ?? ''));
    assert.ok(duType.length >= 6, `« ${q} » → ${r.map((l) => `${l.nom} (${l.categorie})`).join(' | ')}`);
    // Les plus proches d'abord : les premiers sont à quelques kilomètres, pas à l'autre bout du district.
    const km = (l: { location: { lat: number; lng: number } }) => Math.hypot((l.location.lat - RIVIERA.lat) * 110.6, (l.location.lng - RIVIERA.lng) * 110.3);
    assert.ok(km(duType[0]!) < 3, `le premier « ${q} » est à ${km(duType[0]!).toFixed(1)} km`);
  }
});

test('index détaillé : les communes et quartiers restent en tête, sans doublon avec l’index', () => {
  const g = new Geocodeur(null);
  assert.equal(g.repertoire('cocody', RIVIERA)[0]?.nom, 'Cocody');
  assert.equal(g.repertoire('cocody', RIVIERA)[0]?.secteur.startsWith('Commune'), true);
  const riviera = g.repertoire('riviera golf', RIVIERA);
  assert.match(riviera[0]!.nom, /^Rivi[ée]ra Golf/i, riviera.map((l) => l.nom).join(' | '));
  const noms = riviera.map((l) => `${l.nom}|${l.location.lat.toFixed(3)},${l.location.lng.toFixed(3)}`);
  assert.equal(new Set(noms).size, noms.length, 'aucun doublon');
  assert.ok(g.repertoire('a').length <= 12 && g.repertoire('pharmacie', RIVIERA).length <= 12, '12 résultats au plus');
});

test('route /maps/recherche : l’index détaillé répond, avec la catégorie de chaque lieu', async (t) => {
  const { app } = await buildApp();
  t.after(() => app.close());
  const r = await app.inject({ method: 'GET', url: `/maps/recherche?q=pharmacie&lat=${RIVIERA.lat}&lng=${RIVIERA.lng}` });
  assert.equal(r.statusCode, 200, r.body);
  const lieux = r.json().lieux as Array<{ nom: string; categorie?: string; secteur: string; location: { lat: number; lng: number } }>;
  assert.ok(lieux.filter((l) => l.categorie === 'pharmacy').length >= 6, lieux.map((l) => l.nom).join(' | '));
  assert.ok(lieux.every((l) => Number.isFinite(l.location.lat) && Number.isFinite(l.location.lng)));
});

test('index détaillé : la copie du serveur est celle livrée avec les applications', () => {
  const app = new URL('../../frontend/public/carte/lieux-index.json', import.meta.url);
  if (!existsSync(app)) return; // image du serveur seule : pas de copie à comparer
  const serveur = gunzipSync(readFileSync(new URL('../data/lieux-index.json.gz', import.meta.url)));
  assert.ok(serveur.equals(readFileSync(app)), 'relancer « npm run index-lieux » : les deux copies ont divergé');
});
