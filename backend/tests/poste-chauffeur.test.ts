import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildApp } from '../src/app.js';

/**
 * LE POSTE DU CHAUFFEUR DANS LA CONSOLE.
 *
 * Un chauffeur qui se connectait restait sur « Chargement de la console… » : l'écran
 * attendait la vue d'ensemble de l'entreprise, qu'il n'a pas le droit de lire. Son
 * poste doit lui donner tout ce qui le concerne — et rien de ce qui ne le concerne pas.
 */
const A = { 'x-admin-token': 'orion-admin-dev' };

test('le chauffeur trouve son travail, son argent, son équipe et de quoi faire une demande', async (t) => {
  const { app, container } = await buildApp();
  t.after(() => app.close());

  const d = container.drivers.upsert({
    id: 'drv-poste-1', name: 'Aïcha Touré', matricule: 'ORION-CI-1707', category: 'argent',
    kycStatus: 'active', availability: 'offline', ratingAvg: 4.9, ratingCount: 40, phone: '+2250701020304',
  });
  await container.drivers.goOnline(d.id, { lat: 5.3236, lng: -4.0217 });
  // Une course réelle, payée et notée.
  const est = await app.inject({ method: 'POST', url: '/pricing/estimate', payload: { origin: { lat: 5.3236, lng: -4.0217 }, destination: { lat: 5.3596, lng: -3.9903 }, category: 'argent', clientId: 'client-p1' } });
  const ride = (await app.inject({ method: 'POST', url: '/rides', payload: { clientId: 'client-p1', lockId: est.json().quote.lockId, paymentMethod: 'cash' } })).json().ride;
  assert.equal(ride.driverId, d.id);
  for (const to of ['driver_en_route', 'arrived', 'in_progress', 'completed']) {
    await app.inject({ method: 'POST', url: `/rides/${ride.id}/transition`, payload: { to } });
  }
  await app.inject({ method: 'POST', url: `/rides/${ride.id}/pay`, payload: { method: 'cash' } });
  await app.inject({ method: 'POST', url: `/rides/${ride.id}/rate`, payload: { stars: 5 } });

  const compte = (await app.inject({ method: 'POST', url: '/admin/accounts', headers: A, payload: { name: d.name, role: 'chauffeur', driverId: d.id, matricule: d.matricule } })).json();
  const login = await app.inject({ method: 'POST', url: '/admin/login', payload: { username: compte.account.username, password: compte.motDePasseProvisoire } });
  const h = { authorization: `Bearer ${login.json().token}` };

  // Les chiffres de l'entreprise lui restent fermés…
  assert.equal((await app.inject({ method: 'GET', url: '/admin/overview', headers: h })).statusCode, 403);

  // …mais son poste est complet.
  const r = await app.inject({ method: 'GET', url: '/admin/mon-poste', headers: h });
  assert.equal(r.statusCode, 200, r.body);
  const poste = r.json();
  const md = poste.monDossier;
  assert.ok(md, 'le chauffeur doit avoir son dossier dans son poste');
  assert.equal(md.driverId, d.id);
  assert.equal(md.profil.category, 'argent');
  assert.equal(md.dernieresCourses.length, 1);
  assert.equal(md.dernieresCourses[0].id, ride.id);
  assert.equal(md.dernieresCourses[0].paiement, 'cash');
  assert.equal(md.dernieresCourses[0].note, 5);
  assert.match(md.dernieresCourses[0].trajet, /→/);
  assert.ok(md.argent.plafondDette > 0, 'il doit connaître le plafond de dette espèces');
  assert.ok(md.typesRequete.some((x: { code: string; financiere: boolean }) => x.code === 'avance' && x.financiere));
  assert.ok(md.plafonds.avance > 0);

  // Et rien de ce qui ne le regarde pas.
  assert.deepEqual(poste.aTraiter, []);
  assert.deepEqual(poste.flotte, []);
  assert.equal(poste.caisse, null);
});
