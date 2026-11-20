import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Geocodeur } from '../src/modules/maps/geocodage.js';
import { buildApp } from '../src/app.js';

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
  // Aucune commune devinée pour un quartier (un libellé faux serait pire que rien).
  assert.equal(g.repertoire('angre')[0]?.secteur, 'Quartier · Abidjan');
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
  assert.equal((await app.inject({ method: 'GET', url: '/maps/recherche?q=c' })).statusCode, 400);
});
