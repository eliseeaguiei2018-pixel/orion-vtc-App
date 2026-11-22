import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildApp } from '../src/app.js';
import { Routage } from '../src/modules/maps/routage.js';
import { classerItineraires, PEAGES } from '../src/modules/geo-ci/abidjan.js';

/**
 * PONT À PÉAGE OU VOIE NORMALE, MISE À DISPOSITION À L'HEURE : le choix du client voyage
 * du devis à la course, jusqu'au chauffeur, à la console et au paiement. Le péage payé par
 * le chauffeur lui revient en entier (aucune commission dessus).
 */
const AUTH = { 'x-admin-token': 'orion-admin-dev' };
const COCODY = { lat: 5.3596, lng: -3.9903 };
const ZONE4 = { lat: 5.2942, lng: -3.9846 };
const HKB = PEAGES.find((p) => p.id === 'hkb')!;

async function chauffeurEnLigne(app: Awaited<ReturnType<typeof buildApp>>['app'], nom: string) {
  const drv = await app.inject({ method: 'POST', url: '/drivers', payload: { name: nom, category: 'argent' } });
  const driverId = drv.json().driver.id as string;
  await app.inject({ method: 'POST', url: `/drivers/${driverId}/online`, payload: { position: { lat: 5.358, lng: -3.991 } } });
  return driverId;
}

test('course par le pont HKB : péage au devis, sur la course, dans la console, reversé au chauffeur', async (t) => {
  const { app, container } = await buildApp();
  t.after(() => app.close());
  const driverId = await chauffeurEnLigne(app, 'Chauffeur péage');
  const est = await app.inject({ method: 'POST', url: '/pricing/estimate', payload: { origin: COCODY, destination: ZONE4, category: 'argent', clientId: 'client-peage', itineraire: 'peage', peages: ['hkb', 'hkb'] } });
  assert.equal(est.statusCode, 200, est.body);
  const quote = est.json().quote;
  assert.deepEqual(quote.itineraire, { choix: 'peage', peages: ['hkb'] });
  assert.equal(quote.breakdown.peage, 500);

  const cree = await app.inject({ method: 'POST', url: '/rides', payload: { clientId: 'client-peage', lockId: quote.lockId, paymentMethod: 'card' } });
  assert.equal(cree.statusCode, 201, cree.body);
  const rideId = cree.json().ride.id as string;
  assert.equal(container.rides.get(rideId)?.quote.itineraire?.choix, 'peage');

  // Console : la ligne de la course dit l'itinéraire et le péage.
  const liste = (await app.inject({ method: 'GET', url: '/admin/rides?limit=20', headers: AUTH })).json().rides as Array<{ id: string; itineraire?: { choix: string; peage: number } }>;
  const ligne = liste.find((r) => r.id === rideId);
  assert.deepEqual(ligne?.itineraire, { choix: 'peage', peages: ['hkb'], peage: 500 });

  for (const to of ['driver_en_route', 'arrived', 'in_progress', 'completed']) {
    await app.inject({ method: 'POST', url: `/rides/${rideId}/transition`, payload: { to } });
  }
  const pay = await app.inject({ method: 'POST', url: `/rides/${rideId}/pay`, payload: { method: 'card' } });
  assert.equal(pay.json().rideStatus, 'paid', pay.body);
  const ecritures = container.wallet.ecritures(driverId).filter((e) => e.rideId === rideId);
  const reverse = ecritures.find((e) => e.type === 'adjustment' && /Péage/.test(e.note ?? ''));
  assert.equal(reverse?.amount, 500, 'péage reversé en entier');
  const gain = ecritures.find((e) => e.type === 'ride_earning')!.amount;
  const commission = -ecritures.find((e) => e.type === 'commission')!.amount;
  assert.equal(gain + commission, quote.amount - 500, 'la commission ne porte pas sur le péage');
});

test('voie normale : aucun péage, et le serveur ne facture pas un péage annoncé pour la voie normale', async (t) => {
  const { app } = await buildApp();
  t.after(() => app.close());
  const est = await app.inject({ method: 'POST', url: '/pricing/estimate', payload: { origin: COCODY, destination: ZONE4, category: 'or', clientId: 'client-normal', itineraire: 'normal', peages: ['hkb'] } });
  const quote = est.json().quote;
  assert.deepEqual(quote.itineraire, { choix: 'normal', peages: [] });
  assert.equal(quote.breakdown.peage, undefined);
});

test('mise à disposition à l’heure : la durée suit la course jusqu’à la console', async (t) => {
  const { app } = await buildApp();
  t.after(() => app.close());
  await chauffeurEnLigne(app, 'Chauffeur dispo');
  const debut = new Date(Date.now() + 3600_000).toISOString();
  const est = await app.inject({ method: 'POST', url: '/pricing/estimate', payload: { origin: COCODY, destination: COCODY, category: 'argent', clientId: 'client-dispo', miseADisposition: { heures: 3, debut } } });
  assert.equal(est.statusCode, 200, est.body);
  const quote = est.json().quote;
  assert.deepEqual(quote.miseADisposition, { heures: 3, debut });
  assert.equal(quote.amount, 15_000);
  assert.equal(quote.itineraire, undefined);
  const cree = await app.inject({ method: 'POST', url: '/rides', payload: { clientId: 'client-dispo', lockId: quote.lockId } });
  assert.equal(cree.statusCode, 201, cree.body);
  const liste = (await app.inject({ method: 'GET', url: '/admin/rides?limit=20', headers: AUTH })).json().rides as Array<{ id: string; miseADisposition?: { heures: number } }>;
  assert.equal(liste.find((r) => r.id === cree.json().ride.id)?.miseADisposition?.heures, 3);
});

test('itinéraire selon le choix : variante sans péage, sinon contournement du pont', async () => {
  // Deux tracés OSRM : le premier passe sur le pont HKB, le second par le Plateau.
  const parHkb = { distance: 9000, duration: 900, geometry: { coordinates: [[COCODY.lng, COCODY.lat], [HKB.lng, HKB.lat], [ZONE4.lng, ZONE4.lat]] }, legs: [{ steps: [] }] };
  const parPlateau = { distance: 14000, duration: 1500, geometry: { coordinates: [[COCODY.lng, COCODY.lat], [-4.0104, 5.3164], [ZONE4.lng, ZONE4.lat]] }, legs: [{ steps: [] }] };
  const urls: string[] = [];
  const reponse = (routes: unknown[]) => new Response(JSON.stringify({ code: 'Ok', routes }), { status: 200, headers: { 'content-type': 'application/json' } });
  const avecVariante = new Routage('https://osrm.test', (async (u: string) => { urls.push(u); return reponse([parHkb, parPlateau]); }) as unknown as typeof fetch);
  assert.equal((await avecVariante.itineraireSelonChoix([COCODY, ZONE4], 'peage')).distanceMeters, 9000);
  assert.equal((await avecVariante.itineraireSelonChoix([COCODY, ZONE4], 'normal')).distanceMeters, 14000);
  assert.ok(urls.some((u) => u.includes('alternatives=3')), 'variantes demandées à OSRM');

  // OSRM ne propose que le pont : la voie normale passe par le contournement (pont Général-de-Gaulle).
  urls.length = 0;
  const sansVariante = new Routage('https://osrm.test', (async (u: string) => { urls.push(u); return reponse(u.includes(String(HKB.contournement!.lng.toFixed(6))) ? [parPlateau] : [parHkb]); }) as unknown as typeof fetch);
  const normal = await sansVariante.itineraireSelonChoix([COCODY, ZONE4], 'normal');
  assert.equal(normal.distanceMeters, 14000);
  assert.ok(urls.some((u) => u.includes(HKB.contournement!.lng.toFixed(6))), 'passage par le contournement');

  // Classement : une voie normale absurde (trois fois plus longue + 20 min) n'est pas proposée.
  const r = (d: number, s: number, geo: { lat: number; lng: number }[]) => ({ geometrie: geo, distanceMeters: d, durationSeconds: s });
  const c = classerItineraires([r(9000, 900, [COCODY, HKB, ZONE4]), r(60000, 5000, [COCODY, { lat: 5.3164, lng: -4.0104 }, ZONE4])]);
  assert.equal(c.peage?.peages[0]?.id, 'hkb');
  assert.equal(c.normal, null);
});
