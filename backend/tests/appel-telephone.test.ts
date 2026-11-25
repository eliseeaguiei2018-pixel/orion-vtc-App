import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildApp } from '../src/app.js';
import { issueClientToken } from '../src/modules/clients/auth.js';
import { issueDriverToken } from '../src/modules/driver-app/auth.js';
import { numeroComposable } from '../src/modules/rides/routes.js';

/**
 * BOUTON « APPELER » : un toucher ouvre le clavier téléphonique du portable avec le
 * numéro de l'autre participant. Le numéro n'est donné qu'aux deux participants de la
 * course, pendant la course, et chaque remise est journalisée.
 */
const AUTH = { 'x-admin-token': 'orion-admin-dev' };

test('Numéro composable : espaces retirés, indicatif ivoirien ajouté', () => {
  assert.equal(numeroComposable('+225 07 01 02 03 04'), '+2250701020304');
  assert.equal(numeroComposable('07 01 02 03 04'), '+2250701020304');
  assert.equal(numeroComposable('00225 0701020304'), '+2250701020304');
  assert.equal(numeroComposable('+33 6 12 34 56 78'), '+33612345678');
  assert.equal(numeroComposable('abc'), null);
  assert.equal(numeroComposable(undefined), null);
});

test('Passager et chauffeur obtiennent le numéro de l’autre, et personne d’autre', async (t) => {
  const { app, container } = await buildApp();
  t.after(() => app.close());

  const drv = await app.inject({ method: 'POST', url: '/drivers', payload: { name: 'Konan Yao', category: 'argent', phone: '+225 07 11 22 33 44' } });
  const driverId = drv.json().driver.id as string;
  await app.inject({ method: 'POST', url: `/drivers/${driverId}/online`, payload: { position: { lat: 5.324, lng: -4.021 } } });
  container.clients.touch('client-appel', { name: 'Awa Koné', phone: '05 55 66 77 88' });

  const est = await app.inject({
    method: 'POST', url: '/pricing/estimate',
    payload: { origin: { lat: 5.3236, lng: -4.0217 }, destination: { lat: 5.3599, lng: -3.9876 }, category: 'argent', clientId: 'client-appel' },
  });
  const ride = await app.inject({ method: 'POST', url: '/rides', payload: { clientId: 'client-appel', lockId: est.json().quote.lockId } });
  const r = ride.json().ride;
  assert.equal(r.driverId, driverId, 'la course est attribuée au chauffeur créé');

  const passager = { authorization: `Bearer ${issueClientToken('client-appel').token}` };
  const chauffeur = { authorization: `Bearer ${issueDriverToken(driverId).token}` };

  // Le passager reçoit le numéro de SON chauffeur, prêt pour le clavier du téléphone.
  const c1 = await app.inject({ method: 'GET', url: `/rides/${r.id}/contact`, headers: passager });
  assert.equal(c1.statusCode, 200, c1.body);
  assert.deepEqual(c1.json(), { nom: 'Konan Yao', telephone: '+2250711223344', lien: 'tel:+2250711223344', role: 'chauffeur' });

  // Le chauffeur reçoit celui de SON passager.
  const c2 = await app.inject({ method: 'GET', url: `/rides/${r.id}/contact`, headers: chauffeur });
  assert.equal(c2.statusCode, 200, c2.body);
  assert.equal(c2.json().lien, 'tel:+2250555667788');
  assert.equal(c2.json().role, 'passager');

  // Personne d'autre : sans session, un autre client, un autre chauffeur.
  assert.equal((await app.inject({ method: 'GET', url: `/rides/${r.id}/contact` })).statusCode, 401);
  const intrus = { authorization: `Bearer ${issueClientToken('client-intrus').token}` };
  assert.equal((await app.inject({ method: 'GET', url: `/rides/${r.id}/contact`, headers: intrus })).statusCode, 403);
  const autreChauffeur = { authorization: `Bearer ${issueDriverToken('chauffeur-intrus').token}` };
  assert.ok([401, 403].includes((await app.inject({ method: 'GET', url: `/rides/${r.id}/contact`, headers: autreChauffeur })).statusCode));

  // Chaque remise de numéro est journalisée.
  const journal = container.audit.list().filter((e) => e.action === 'course.contact' && e.target === r.id);
  assert.equal(journal.length, 2);
  assert.deepEqual(journal.map((e) => e.role).sort(), ['chauffeur', 'client']);

  // Course terminée : le numéro n'est plus donné.
  for (const to of ['driver_en_route', 'arrived', 'in_progress', 'completed']) {
    await app.inject({ method: 'POST', url: `/rides/${r.id}/transition`, headers: AUTH, payload: { to } });
  }
  const apres = await app.inject({ method: 'GET', url: `/rides/${r.id}/contact`, headers: passager });
  assert.equal(apres.statusCode, 403);
});
