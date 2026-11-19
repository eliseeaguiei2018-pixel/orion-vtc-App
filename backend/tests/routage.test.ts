import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildApp } from '../src/app.js';
import { Routage, pointSurTrace } from '../src/modules/maps/routage.js';

/**
 * ITINÉRAIRE ROUTIER : le véhicule suit les routes, pas une ligne droite.
 * Avant : la carte reliait départ et arrivée d'un trait, à travers la lagune.
 */
const PLATEAU = { lat: 5.3236, lng: -4.0217 };
const COCODY = { lat: 5.36, lng: -3.99 };

const reponseOsrm = {
  code: 'Ok',
  routes: [{
    distance: 7625, duration: 589,
    geometry: { coordinates: [[-4.0217, 5.3236], [-4.01, 5.33], [-4.0, 5.345], [-3.99, 5.36]] },
    legs: [{ steps: [
      { name: 'Boulevard de la République', distance: 900, maneuver: { type: 'depart' } },
      { name: 'Pont Alassane Ouattara', distance: 1500, maneuver: { type: 'turn', modifier: 'right' } },
      { name: 'Boulevard de France', distance: 3000, maneuver: { type: 'continue' } },
      { name: '', distance: 0, maneuver: { type: 'arrive' } },
    ] }],
  }],
};

test('OSRM : tracé réel, ponts repérés, mis en cache', async () => {
  let appels = 0;
  const faux = (async () => { appels += 1; return new Response(JSON.stringify(reponseOsrm), { status: 200 }); }) as typeof fetch;
  const r = new Routage('https://osrm.exemple', faux);
  const it = await r.itineraire([PLATEAU, COCODY]);
  assert.equal(it.provider, 'osrm');
  assert.equal(it.geometrie.length, 4, 'le tracé suit les routes, point par point');
  assert.deepEqual(it.ponts, ['Pont Alassane Ouattara']);
  assert.equal(it.distanceMeters, 7625);
  await r.itineraire([PLATEAU, COCODY]);
  assert.equal(appels, 1, 'second calcul servi par le cache');
});

test('panne du calcul : tracé de repli, la course n’est jamais bloquée', async () => {
  const enPanne = (async () => { throw new Error('réseau coupé'); }) as typeof fetch;
  const it = await new Routage('https://osrm.exemple', enPanne).itineraire([PLATEAU, COCODY]);
  assert.equal(it.provider, 'repli');
  assert.equal(it.geometrie.length, 2);
  assert.ok(it.distanceMeters > 0);
});

test('le véhicule avance le long du tracé, pas en ligne droite', () => {
  const trace = [{ lat: 0, lng: 0 }, { lat: 0, lng: 1 }, { lat: 1, lng: 1 }];
  const milieu = pointSurTrace(trace, 0.5);
  assert.ok(Math.abs(milieu.lat) < 1e-6 && Math.abs(milieu.lng - 1) < 1e-3, 'à mi-parcours : au coin, pas en diagonale');
  assert.deepEqual(pointSurTrace(trace, 1), { lat: 1, lng: 1 });
});

test('API : réservé à la Côte d’Ivoire', async (t) => {
  const { app } = await buildApp();
  t.after(() => app.close());
  const paris = await app.inject({ method: 'POST', url: '/maps/itineraire', payload: { points: [{ lat: 48.85, lng: 2.35 }, { lat: 48.86, lng: 2.36 }] } });
  assert.equal(paris.statusCode, 400);
  assert.match(paris.body, /Côte d’Ivoire/);
});

test('guidage chauffeur : toutes les manœuvres, avec leur position (bretelles, ronds-points)', async () => {
  const osrm = {
    code: 'Ok',
    routes: [{
      distance: 4200, duration: 420,
      geometry: { coordinates: [[-4.0217, 5.3236], [-4.015, 5.33], [-4.005, 5.34], [-3.99, 5.36]] },
      legs: [{ steps: [
        { name: 'Boulevard de la République', distance: 800, maneuver: { type: 'depart', location: [-4.0217, 5.3236] } },
        { name: '', distance: 300, maneuver: { type: 'on ramp', modifier: 'slight right', location: [-4.015, 5.33] } },
        { name: 'Boulevard Latrille', distance: 2100, maneuver: { type: 'roundabout', modifier: 'right', exit: 2, location: [-4.005, 5.34] } },
        { name: '', distance: 0, maneuver: { type: 'arrive', location: [-3.99, 5.36] } },
      ] }],
    }],
  };
  const faux = (async () => new Response(JSON.stringify(osrm), { status: 200 })) as typeof fetch;
  const it = await new Routage('https://osrm.exemple', faux).itineraire([PLATEAU, COCODY]);
  assert.equal(it.manoeuvres.length, 4, 'la bretelle sans nom est gardée pour le guidage');
  assert.deepEqual(it.manoeuvres[1], { type: 'on ramp', modificateur: 'slight right', nom: '', distanceMeters: 300, position: { lat: 5.33, lng: -4.015 } });
  assert.equal(it.manoeuvres[2]!.sortie, 2);
  assert.equal(it.etapes.length, 3, 'les étapes nommées historiques sont inchangées');
  const repli = await new Routage(undefined).itineraire([PLATEAU, COCODY]);
  assert.deepEqual(repli.manoeuvres, []);
});
