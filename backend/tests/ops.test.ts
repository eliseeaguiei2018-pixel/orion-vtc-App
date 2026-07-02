import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildApp } from '../src/app.js';

const AUTH = { 'x-admin-token': 'orion-admin-dev' };

/** Crée un chauffeur en ligne à la position donnée. */
async function driverAt(app: Awaited<ReturnType<typeof buildApp>>['app'], name: string, lat: number, lng: number) {
  const res = await app.inject({ method: 'POST', url: '/drivers', payload: { name, category: 'bronze' } });
  const id = res.json().driver.id as string;
  await app.inject({ method: 'POST', url: `/drivers/${id}/online`, payload: { position: { lat, lng } } });
  return id;
}

/** Devis + création de course pour un client donné. */
async function createRide(app: Awaited<ReturnType<typeof buildApp>>['app'], clientId: string) {
  const est = await app.inject({
    method: 'POST', url: '/pricing/estimate',
    payload: { origin: { lat: 5.35, lng: -4.0 }, destination: { lat: 5.37, lng: -3.98 }, category: 'bronze' },
  });
  const lockId = est.json().quote.lockId as string;
  const res = await app.inject({ method: 'POST', url: '/rides', payload: { clientId, lockId }, headers: { 'idempotency-key': `${clientId}-${lockId}` } });
  return res.json().ride as { id: string; status: string; driverId?: string };
}

test('dispatch : stratégie pilotable — longest_idle choisit le plus ancien en attente', async (t) => {
  const { app } = await buildApp();
  t.after(() => app.close());

  // Deux chauffeurs : « Ancien » attend depuis plus longtemps mais est plus loin.
  const ancien = await driverAt(app, 'Ancien', 5.365, -4.012); // ~2 km
  await new Promise((r) => setTimeout(r, 25));
  const proche = await driverAt(app, 'Proche', 5.351, -4.001); // ~150 m

  // Règle par défaut (nearest) → le plus proche gagne.
  const r1 = await createRide(app, 'client-n1');
  assert.equal(r1.driverId, proche);
  await app.inject({ method: 'POST', url: `/rides/${r1.id}/transition`, payload: { to: 'cancelled' } });

  // Bascule en longest_idle depuis la console → l'ancien gagne malgré la distance.
  const upd = await app.inject({ method: 'PUT', url: '/admin/dispatch', headers: AUTH, payload: { strategy: 'longest_idle' } });
  assert.equal(upd.json().ops.strategy, 'longest_idle');
  const r2 = await createRide(app, 'client-n2');
  assert.equal(r2.driverId, ancien);
});

test('dispatch : réassignation manuelle par la console', async (t) => {
  const { app } = await buildApp();
  t.after(() => app.close());

  const d1 = await driverAt(app, 'Premier', 5.351, -4.001);
  const ride = await createRide(app, 'client-r1');
  assert.equal(ride.driverId, d1);

  // Deuxième chauffeur disponible → réassignation imposée.
  const d2 = await driverAt(app, 'Second', 5.352, -4.002);
  const re = await app.inject({ method: 'POST', url: `/admin/rides/${ride.id}/reassign`, headers: AUTH, payload: { driverId: d2 } });
  assert.equal(re.statusCode, 200);
  assert.equal(re.json().ride.driverId, d2);

  // L'ancien chauffeur est libéré (online), le nouveau est en course.
  const drivers = await app.inject({ method: 'GET', url: '/admin/drivers', headers: AUTH });
  const list = drivers.json().drivers as Array<{ id: string; availability: string }>;
  assert.equal(list.find((d) => d.id === d1)?.availability, 'online');
  assert.equal(list.find((d) => d.id === d2)?.availability, 'on_trip');

  // La fiche course garde la trace de la réassignation.
  const detail = await app.inject({ method: 'GET', url: `/admin/rides/${ride.id}`, headers: AUTH });
  const events = detail.json().ride.events as Array<{ type: string }>;
  assert.ok(events.some((e) => e.type === 'reassigned'));
});

test('qualité : avertissement automatique sous le seuil + avertissement manuel', async (t) => {
  const { app } = await buildApp();
  t.after(() => app.close());

  const id = await driverAt(app, 'Mauvaises notes', 5.351, -4.001);
  await app.inject({ method: 'PUT', url: '/admin/dispatch', headers: AUTH, payload: { minRating: 4.8, autoWarn: true } });

  // 5 courses notées 3/5 → moyenne 3 < 4.8 → avertissement auto à partir de la 5e note.
  for (let i = 0; i < 5; i++) {
    const ride = await createRide(app, `client-q${i}`);
    for (const s of ['driver_en_route', 'arrived', 'in_progress', 'completed', 'paid'] as const) {
      await app.inject({ method: 'POST', url: `/rides/${ride.id}/transition`, payload: { to: s } });
    }
    await app.inject({ method: 'POST', url: `/rides/${ride.id}/rate`, payload: { stars: 3 } });
  }

  const quality = await app.inject({ method: 'GET', url: '/admin/quality', headers: AUTH });
  const q = quality.json();
  assert.equal(q.threshold, 4.8);
  const row = (q.drivers as Array<{ id: string; warnings: number; below: boolean }>).find((d) => d.id === id);
  assert.ok(row);
  assert.ok(row!.below, 'chauffeur signalé sous le seuil');
  assert.ok(row!.warnings >= 1, 'avertissement automatique enregistré');

  // Avertissement manuel supplémentaire.
  const warn = await app.inject({ method: 'POST', url: `/admin/drivers/${id}/warn`, headers: AUTH });
  assert.equal(warn.json().driver.warnings, row!.warnings + 1);
});

test('litiges : ouverture client → instruction → résolution avec remboursement', async (t) => {
  const { app, container } = await buildApp();
  t.after(() => app.close());

  await driverAt(app, 'Litige Drv', 5.351, -4.001);
  const ride = await createRide(app, 'client-L1');

  // Le client ouvre une réclamation de facturation.
  const open = await app.inject({
    method: 'POST', url: `/rides/${ride.id}/dispute`,
    payload: { clientId: 'client-L1', kind: 'facturation', description: 'Montant débité deux fois' },
  });
  assert.equal(open.statusCode, 201);
  const dispute = open.json().dispute;
  assert.equal(dispute.status, 'open');

  // Mauvais client → refus.
  const bad = await app.inject({ method: 'POST', url: `/rides/${ride.id}/dispute`, payload: { clientId: 'autre', kind: 'trajet', description: 'test refus' } });
  assert.equal(bad.statusCode, 400);

  // La console instruit puis résout avec remboursement de 500 F.
  const inv = await app.inject({ method: 'POST', url: `/admin/disputes/${dispute.id}/status`, headers: AUTH, payload: { status: 'investigating' } });
  assert.equal(inv.json().dispute.status, 'investigating');
  const res = await app.inject({
    method: 'POST', url: `/admin/disputes/${dispute.id}/status`, headers: AUTH,
    payload: { status: 'resolved', resolution: 'Double débit confirmé, remboursé', refund: 500 },
  });
  assert.equal(res.json().dispute.status, 'resolved');
  assert.equal(res.json().dispute.refund, 500);

  // Le portefeuille client est crédité (traçabilité du remboursement).
  assert.equal(container.clientWallet.balance('client-L1'), 500);

  // Liste console : plus aucun litige ouvert.
  const list = await app.inject({ method: 'GET', url: '/admin/disputes', headers: AUTH });
  assert.equal(list.json().open, 0);
});

test('audit : exports CSV protégés contre l’injection de formule tableur', async (t) => {
  const { app } = await buildApp();
  t.after(() => app.close());

  await app.inject({
    method: 'POST', url: '/admin/treasury/request', headers: AUTH,
    payload: { amount: 1000, destination: '=HYPERLINK("http://mal")', reason: '+SOMME(A1:A9)' },
  });
  const csv = await app.inject({ method: 'GET', url: '/admin/treasury.csv', headers: AUTH });
  assert.ok(csv.body.includes(`"'=HYPERLINK`), 'formule neutralisée par apostrophe');
  assert.ok(csv.body.includes(`"'+SOMME`), 'formule neutralisée par apostrophe');
});

test('mobilité verte : télémétrie batterie, exclusion du dispatch, indicateurs CO2', async (t) => {
  const { app } = await buildApp();
  t.after(() => app.close());

  // Deux électriques proches : batterie faible (8 %) vs pleine (90 %).
  const faible = await driverAt(app, 'Batterie faible', 5.351, -4.001);
  const pleine = await driverAt(app, 'Batterie pleine', 5.352, -4.002);
  await app.inject({ method: 'POST', url: `/drivers/${faible}/telemetry`, payload: { engine: 'electric', batteryPct: 8 } });
  await app.inject({ method: 'POST', url: `/drivers/${pleine}/telemetry`, payload: { engine: 'electric', batteryPct: 90 } });

  // Course ~3 km → il faut ≥ ~13 % : la batterie faible est exclue même si plus proche.
  const ride = await createRide(app, 'client-green');
  assert.equal(ride.driverId, pleine, 'le véhicule à 8 % de batterie est écarté du dispatch');

  // Indicateurs verts : CO2 économisé + part électrique + télémétrie visible.
  for (const s of ['driver_en_route', 'arrived', 'in_progress', 'completed', 'paid'] as const) {
    await app.inject({ method: 'POST', url: `/rides/${ride.id}/transition`, payload: { to: s } });
  }
  const green = await app.inject({ method: 'GET', url: '/admin/green', headers: AUTH });
  const g = green.json();
  assert.ok(g.co2SavedKg > 0, 'CO2 économisé calculé');
  assert.equal(g.electricShare, 100);
  assert.equal(g.fleet.electric, 2);
  assert.equal(g.fleet.lowBattery, 1);
  assert.ok(g.fleet.batteries.some((b: { id: string; batteryPct: number }) => b.id === faible && b.batteryPct === 8));
});

test('dispatch avancé : filtre ETA, cascade (bornes 10–15 s), surge plafonné vert', async (t) => {
  const { app } = await buildApp();
  t.after(() => app.close());

  // --- Filtre ETA : seuil 3 min → un chauffeur à ~3,5 km (ETA ~7,5 min) est exclu.
  await driverAt(app, 'Lointain', 5.378, -4.018);
  await app.inject({ method: 'PUT', url: '/admin/dispatch', headers: AUTH, payload: { maxEtaMinutes: 3 } });
  const r1 = await createRide(app, 'client-eta1');
  assert.equal(r1.status, 'no_driver', 'ETA trop long → aucun chauffeur éligible');
  // Seuil élargi → le même chauffeur devient éligible.
  await app.inject({ method: 'PUT', url: '/admin/dispatch', headers: AUTH, payload: { maxEtaMinutes: 30 } });
  const r2 = await createRide(app, 'client-eta2');
  assert.equal(r2.status, 'accepted');
  await app.inject({ method: 'POST', url: `/rides/${r2.id}/transition`, payload: { to: 'cancelled' } });

  // --- Cascade : le délai d'offre est borné 10–15 s (zod refuse hors bornes).
  const bad = await app.inject({ method: 'PUT', url: '/admin/dispatch', headers: AUTH, payload: { offerTimeoutSec: 20 } });
  assert.equal(bad.statusCode, 400);
  const ok = await app.inject({ method: 'PUT', url: '/admin/dispatch', headers: AUTH, payload: { offerTimeoutSec: 15 } });
  assert.equal(ok.json().ops.offerTimeoutSec, 15);

  // --- Surge par cellules : 1 chauffeur en ligne, rafale de demandes au même point
  // → demande > offre ×2 → ×1.5 brut, PLAFONNÉ à 1.3 (incitation verte).
  const est = () => app.inject({
    method: 'POST', url: '/pricing/estimate',
    payload: { origin: { lat: 5.35, lng: -4.0 }, destination: { lat: 5.37, lng: -3.98 }, category: 'bronze' },
  });
  let last = await est();
  for (let i = 0; i < 5; i++) last = await est();
  const surged = last.json().quote;
  assert.equal(surged.breakdown.surge, 1.3, 'surge actif mais plafonné vert (1.3)');

  // Surge désactivé depuis la console → retour à 1 immédiatement.
  await app.inject({ method: 'PUT', url: '/admin/dispatch', headers: AUTH, payload: { surgeEnabled: false } });
  const calm = await est();
  assert.equal(calm.json().quote.breakdown.surge, 1);
  assert.ok(calm.json().quote.amount < surged.amount, 'le prix retombe sans surge');
});
