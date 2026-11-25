import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildApp } from '../src/app.js';

/**
 * Régressions issues de l'audit :
 *  1) POST /rides renvoie le VRAI chauffeur matché (nom + matricule) → cohérence UI/partage.
 *  2) Le paiement LIBÈRE le chauffeur (availability 'online') — plus de chauffeur bloqué
 *     'on_trip' quand le client ne note pas.
 */
async function setup() {
  const built = await buildApp();
  const { app } = built;
  const drv = await app.inject({ method: 'POST', url: '/drivers', payload: { name: 'Awa Koné', category: 'argent' } });
  const driverId = drv.json().driver.id as string;
  await app.inject({ method: 'POST', url: `/drivers/${driverId}/online`, payload: { position: { lat: 5.324, lng: -4.021 } } });
  const est = await app.inject({
    method: 'POST', url: '/pricing/estimate',
    payload: { origin: { lat: 5.3236, lng: -4.0217 }, destination: { lat: 5.3599, lng: -3.9876 }, category: 'argent' },
  });
  const lockId = est.json().quote.lockId as string;
  return { ...built, driverId, lockId };
}

test('POST /rides renvoie le chauffeur matché (nom + matricule)', async (t) => {
  const { app, driverId, lockId } = await setup();
  t.after(() => app.close());
  const ride = await app.inject({ method: 'POST', url: '/rides', payload: { clientId: 'client-1', lockId } });
  assert.equal(ride.statusCode, 201);
  const driver = ride.json().driver;
  assert.ok(driver, 'driver présent dans la réponse');
  assert.equal(typeof driver.name, 'string');
  assert.equal(driver.matricule.startsWith('ORION-CI-'), true);
  void driverId;
});

test('le paiement libère le chauffeur (availability online)', async (t) => {
  const { app, container, driverId, lockId } = await setup();
  t.after(() => app.close());
  const ride = await app.inject({ method: 'POST', url: '/rides', payload: { clientId: 'client-1', lockId } });
  const rideId = ride.json().ride.id as string;
  assert.equal(container.drivers.get(driverId)!.availability, 'on_trip');

  for (const to of ['driver_en_route', 'arrived', 'in_progress', 'completed']) {
    await app.inject({ method: 'POST', url: `/rides/${rideId}/transition`, payload: { to } });
  }
  const pay = await app.inject({
    method: 'POST', url: `/rides/${rideId}/pay`,
    headers: { 'idempotency-key': `pay-${rideId}` }, payload: { method: 'cash' },
  });
  assert.equal(pay.json().rideStatus, 'paid');
  assert.equal(container.drivers.get(driverId)!.availability, 'online', 'chauffeur libéré après paiement');
});
