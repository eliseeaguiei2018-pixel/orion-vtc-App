import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildApp } from '../src/app.js';

test('parcours complet : estimation → course → matching → notation', async (t) => {
  const { app, container } = await buildApp();
  t.after(() => app.close());

  // 1) Un chauffeur s'inscrit et passe en ligne près de l'origine (0,0).
  const drvRes = await app.inject({
    method: 'POST',
    url: '/drivers',
    payload: { name: 'Awa', category: 'green' },
  });
  assert.equal(drvRes.statusCode, 201);
  const driverId = drvRes.json().driver.id as string;
  await app.inject({
    method: 'POST',
    url: `/drivers/${driverId}/online`,
    payload: { position: { lat: 0.001, lng: 0.001 } },
  });

  // 2) Le client demande une estimation (prix verrouillé).
  const est = await app.inject({
    method: 'POST',
    url: '/pricing/estimate',
    payload: { origin: { lat: 0, lng: 0 }, destination: { lat: 0.05, lng: 0.05 }, category: 'green' },
  });
  assert.equal(est.statusCode, 200);
  const quote = est.json().quote;
  assert.ok(quote.lockId && quote.amount > 0);

  // 3) Création de la course avec le devis verrouillé → matching automatique.
  const ride = await app.inject({
    method: 'POST',
    url: '/rides',
    headers: { 'idempotency-key': 'demo-key-1' },
    payload: { clientId: 'client-1', lockId: quote.lockId },
  });
  assert.equal(ride.statusCode, 201);
  const rideId = ride.json().ride.id as string;
  assert.equal(ride.json().ride.status, 'accepted');
  assert.equal(ride.json().ride.driverId, driverId);

  // 4) Idempotence : rejouer la requête ne crée pas de doublon.
  const replay = await app.inject({
    method: 'POST',
    url: '/rides',
    headers: { 'idempotency-key': 'demo-key-1' },
    payload: { clientId: 'client-1', lockId: quote.lockId },
  });
  assert.equal(replay.json().ride.id, rideId);

  // 5) Progression des états jusqu'au paiement.
  for (const to of ['driver_en_route', 'arrived', 'in_progress', 'completed', 'paid']) {
    const r = await app.inject({ method: 'POST', url: `/rides/${rideId}/transition`, payload: { to } });
    assert.equal(r.statusCode, 200, `transition vers ${to}`);
  }

  // 6) Notation du chauffeur.
  const rate = await app.inject({ method: 'POST', url: `/rides/${rideId}/rate`, payload: { stars: 5 } });
  assert.equal(rate.statusCode, 200);
  assert.equal(rate.json().ride.status, 'rated');
  assert.equal(container.drivers.get(driverId)!.ratingAvg, 5);
});

test('devis inexistant refusé (prix non vérifiable)', async (t) => {
  const { app } = await buildApp();
  t.after(() => app.close());
  const res = await app.inject({
    method: 'POST',
    url: '/rides',
    payload: { clientId: 'client-x', lockId: 'inexistant' },
  });
  assert.equal(res.statusCode, 409);
});

test('transition illégale refusée', async (t) => {
  const { app } = await buildApp();
  t.after(() => app.close());
  const est = await app.inject({
    method: 'POST',
    url: '/pricing/estimate',
    payload: { origin: { lat: 0, lng: 0 }, destination: { lat: 0.05, lng: 0.05 } },
  });
  const ride = await app.inject({
    method: 'POST',
    url: '/rides',
    payload: { clientId: 'c', lockId: est.json().quote.lockId },
  });
  const rideId = ride.json().ride.id as string;
  // no_driver (pas de chauffeur en ligne) → transition vers in_progress illégale.
  const bad = await app.inject({ method: 'POST', url: `/rides/${rideId}/transition`, payload: { to: 'in_progress' } });
  assert.equal(bad.statusCode, 409);
});

test('health endpoints', async (t) => {
  const { app } = await buildApp();
  t.after(() => app.close());
  const live = await app.inject({ method: 'GET', url: '/health/live' });
  const ready = await app.inject({ method: 'GET', url: '/health/ready' });
  assert.equal(live.statusCode, 200);
  assert.equal(ready.statusCode, 200);
  assert.equal(ready.json().status, 'ready');
});
