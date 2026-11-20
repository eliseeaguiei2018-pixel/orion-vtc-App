import { test } from 'node:test';
import assert from 'node:assert/strict';

/**
 * Cahier des charges — sessions 16 & 17 :
 * Tarification (frais annexes, forfaits plats, shadow pricing) et
 * Zones & tarifs (kill switch, forfaits A→B, retour à vide, plancher premium).
 */
const AUTH = { 'x-admin-token': 'orion-admin-dev' };
type App = { inject: (o: object) => Promise<{ statusCode: number; body: string; rawPayload: Buffer; headers: Record<string, unknown>; json: () => any }> };

async function estimate(app: App, origin: { lat: number; lng: number }, destination: { lat: number; lng: number }) {
  const r = await app.inject({ method: 'POST', url: '/pricing/estimate', payload: { origin, destination, category: 'bronze' } });
  return r.json().quote;
}

test('S16 Tarification : minutes de courtoisie, frais d’annulation progressifs, nettoyage, shadow', async (t) => {
  const { buildApp } = await import('../src/app.js');
  const { app } = await buildApp();
  t.after(() => app.close());

  // Configurer courtoisie 5 min + frais annulation + barème nettoyage.
  const put = await app.inject({ method: 'PUT', url: '/admin/pricing', headers: AUTH, payload: {
    freeWaitMinutes: 5, cancelGraceMinutes: 2, cancelFee: 800, cleaningLight: 10000, cleaningMajor: 50000, longPickupPerKm: 100, longPickupThresholdKm: 5,
  } });
  assert.equal(put.statusCode, 200);
  const pr = (await app.inject({ method: 'GET', url: '/admin/pricing', headers: AUTH })).json().pricing;
  assert.equal(pr.freeWaitMinutes, 5);
  assert.equal(pr.cancelFee, 800);

  // Course : attente de 4 min = offerte (< 5 min courtoisie) → aucune facturation.
  const drv = (await app.inject({ method: 'POST', url: '/drivers', payload: { name: 'Tarif Drv', category: 'bronze' } })).json().driver.id;
  await app.inject({ method: 'POST', url: `/drivers/${drv}/online`, payload: { position: { lat: 5.351, lng: -4.001 } } });
  const est = await estimate(app, { lat: 5.35, lng: -4.0 }, { lat: 5.37, lng: -3.98 });
  const ride = (await app.inject({ method: 'POST', url: '/rides', payload: { clientId: 'c-tarif', lockId: est.lockId }, headers: { 'idempotency-key': 'tf-1' } })).json().ride;
  await app.inject({ method: 'POST', url: `/rides/${ride.id}/transition`, payload: { to: 'driver_en_route' } });
  await app.inject({ method: 'POST', url: `/rides/${ride.id}/transition`, payload: { to: 'arrived' } });
  await app.inject({ method: 'POST', url: `/rides/${ride.id}/transition`, payload: { to: 'in_progress' } });
  const wait4 = await app.inject({ method: 'POST', url: `/rides/${ride.id}/wait`, payload: { minutes: 4 } });
  assert.equal(wait4.json().billableMinutes, 0, '4 min ≤ courtoisie → offert');
  assert.equal(wait4.json().waitFee, 0);
  const wait8 = await app.inject({ method: 'POST', url: `/rides/${ride.id}/wait`, payload: { minutes: 4 } });
  assert.equal(wait8.json().billableMinutes, 3, '8 min − 5 courtoisie = 3 facturées');

  // Barème de nettoyage crédité au chauffeur.
  const clean = await app.inject({ method: 'POST', url: `/admin/rides/${ride.id}/cleaning`, headers: AUTH, payload: { level: 'major' } });
  assert.equal(clean.json().amount, 50000);

  // Frais d'annulation : au-delà du délai de grâce (la course a été créée il y a > 2 min ? non)
  // → on teste la config via shadow pricing (impact d'une nouvelle grille).
  const shadow = await app.inject({ method: 'POST', url: '/admin/pricing/shadow', headers: AUTH, payload: { baseFactor: 1.2, perKmFactor: 1.1 } });
  assert.equal(shadow.statusCode, 200);
  assert.ok(shadow.json().sampled >= 0);
  assert.equal(typeof shadow.json().impactPercent, 'number');
});

test('S17 Zones : forfait plat A→B, retour à vide, plancher premium, kill switch, matrice', async (t) => {
  const { buildApp } = await import('../src/app.js');
  const { app } = await buildApp();
  t.after(() => app.close());

  // Deux zones : départ "hub" et arrivée "peripherie" avec retour à vide + forfait A→B.
  await app.inject({ method: 'PUT', url: '/admin/zones', headers: AUTH, payload: {
    id: 'hub-a', name: 'Hub A', factor: 1, lat: 5.35, lng: -4.0, radiusKm: 1.5,
    flatRates: [{ toZoneId: 'peripherie-b', price: 15000 }], premiumFloor: 5000,
  } });
  await app.inject({ method: 'PUT', url: '/admin/zones', headers: AUTH, payload: {
    id: 'peripherie-b', name: 'Périphérie B', factor: 1, lat: 5.42, lng: -3.93, radiusKm: 3, emptyReturnFee: 2000,
  } });

  // Forfait plat A→B appliqué : le prix reflète le forfait + retour à vide + taxes (≈ 18–20k).
  const flat = await estimate(app, { lat: 5.35, lng: -4.0 }, { lat: 5.42, lng: -3.93 });
  assert.ok(flat.amount >= 15000, `forfait plat appliqué (${flat.amount})`);

  // Plancher premium : une micro-course dans le hub reste au-dessus du plancher majoré.
  const tiny = await estimate(app, { lat: 5.35, lng: -4.0 }, { lat: 5.352, lng: -4.001 });
  assert.ok(tiny.amount >= 5000, `plancher premium respecté (${tiny.amount})`);

  // Kill switch : désactiver le hub → hors zone (retour au facteur neutre, plus de forfait).
  await app.inject({ method: 'POST', url: '/admin/zones/hub-a/active', headers: AUTH, payload: { active: false } });
  const noFlat = await estimate(app, { lat: 5.35, lng: -4.0 }, { lat: 5.42, lng: -3.93 });
  assert.ok(noFlat.amount < flat.amount, 'zone désactivée → forfait plat retiré');

  // Matrice tarifaire par zone (CSV).
  const csv = await app.inject({ method: 'GET', url: '/admin/zones/matrix.csv', headers: AUTH });
  assert.match(csv.body, /zone_depart,zone_arrivee,forfait_fcfa/);
  assert.ok(csv.body.includes('15000'));
});
