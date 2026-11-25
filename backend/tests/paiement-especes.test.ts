import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildApp } from '../src/app.js';

/**
 * ESPÈCES : le chauffeur confirme l'encaissement (la course passe à « payée »), puis le client
 * appuie sur « J'ai payé en espèces ». Avant : erreur « La course doit être terminée avant
 * paiement », client bloqué sur l'écran de paiement. Maintenant : succès, sans double crédit.
 */
test('espèces confirmées par le chauffeur, puis « J’ai payé » du client : succès, rien encaissé deux fois', async (t) => {
  const { app, container } = await buildApp();
  t.after(() => app.close());
  const driverId = (await app.inject({ method: 'POST', url: '/drivers', payload: { name: 'Koffi', category: 'argent' } })).json().driver.id as string;
  await app.inject({ method: 'POST', url: `/drivers/${driverId}/online`, payload: { position: { lat: 5.324, lng: -4.021 } } });
  const quote = (await app.inject({ method: 'POST', url: '/pricing/estimate', payload: { origin: { lat: 5.3236, lng: -4.0217 }, destination: { lat: 5.3599, lng: -3.9876 }, category: 'argent' } })).json().quote;
  const rideId = (await app.inject({ method: 'POST', url: '/rides', headers: { 'idempotency-key': 'esp-1' }, payload: { clientId: 'client-esp', lockId: quote.lockId } })).json().ride.id as string;
  for (const to of ['driver_en_route', 'arrived', 'in_progress', 'completed']) {
    assert.equal((await app.inject({ method: 'POST', url: `/rides/${rideId}/transition`, payload: { to } })).statusCode, 200);
  }

  // Le chauffeur déclare l'espèce reçue.
  const chauffeur = await app.inject({ method: 'POST', url: `/rides/${rideId}/pay`, headers: { 'idempotency-key': `cash-${rideId}` }, payload: { method: 'cash' } });
  assert.equal(chauffeur.statusCode, 200);
  assert.equal(chauffeur.json().rideStatus, 'paid');
  const soldeApres = container.wallet.balance?.(driverId);

  // Le client confirme de son côté : succès, et le portefeuille du chauffeur ne bouge plus.
  const client = await app.inject({ method: 'POST', url: `/rides/${rideId}/pay`, headers: { 'idempotency-key': `pay-${rideId}-cash` }, payload: { method: 'cash' } });
  assert.equal(client.statusCode, 200, client.body);
  assert.equal(client.json().rideStatus, 'paid');
  assert.equal(client.json().dejaPayee, true);
  assert.equal(container.wallet.balance?.(driverId), soldeApres);
  assert.equal(container.rides.get(rideId)!.events.filter((e) => e.type === 'paid').length, 1, 'un seul paiement enregistré');

  // Après la notation, le même geste reste un succès.
  await app.inject({ method: 'POST', url: `/rides/${rideId}/rate`, payload: { stars: 5 } });
  const encore = await app.inject({ method: 'POST', url: `/rides/${rideId}/pay`, payload: { method: 'cash' } });
  assert.equal(encore.statusCode, 200);
  assert.equal(encore.json().rideStatus, 'paid');
});
