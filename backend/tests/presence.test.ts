import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildApp } from '../src/app.js';

/**
 * PRÉSENCE DES CHAUFFEURS — ce que « en ligne » veut dire.
 *
 * Un chauffeur reste `online` tant qu'il ne se déconnecte pas, mais sa présence
 * dans l'index de dispatch expire sans position reçue. Trouvé en enregistrant la
 * démonstration : la console affichait « 44 en ligne » pendant que chaque commande
 * partait en « aucun chauffeur ». Ces tests verrouillent ce que la console doit
 * dire dans ce cas, et ce que le dispatch fait réellement.
 */
const A = { 'x-admin-token': 'orion-admin-dev' };

async function chauffeurEnLigne(container: Awaited<ReturnType<typeof buildApp>>['container'], id: string) {
  const d = container.drivers.upsert({
    id, name: `Chauffeur ${id}`, matricule: `AB-${id}-CI`, category: 'bronze',
    kycStatus: 'active', availability: 'offline', ratingAvg: 4.8, ratingCount: 20, phone: '+2250701020304',
  });
  await container.drivers.goOnline(d.id, { lat: 5.3236, lng: -4.0217 });
  return d;
}

test('un chauffeur en ligne dont la position a expiré n’est plus attribuable — et la vigilance le dit', async (t) => {
  const { app, container } = await buildApp();
  t.after(() => app.close());

  const present = await chauffeurEnLigne(container, 'pres-1');
  const muet = await chauffeurEnLigne(container, 'muet-1');
  // Sa dernière position est trop vieille : l'index l'oublie (TTL à zéro).
  await container.geo.upsert({ id: muet.id, lat: 5.3236, lng: -4.0217, meta: { category: 'bronze' } }, 0);

  const sante = await app.inject({ method: 'GET', url: '/admin/vigilance', headers: A });
  const constat = sante.json().constats.find((c: { id: string }) => c.id === 'chauffeurs-en-ligne-muets');
  assert.ok(constat, 'le constat doit exister');
  assert.ok(constat.elements.includes(muet.id), 'le chauffeur muet doit être nommé');
  assert.ok(!constat.elements.includes(present.id), 'le chauffeur présent ne doit pas l’être');
  assert.equal(constat.section, 'dispatch');

  // Le présent prend la course ; le muet ne peut pas.
  const est = await app.inject({
    method: 'POST', url: '/pricing/estimate',
    payload: { origin: { lat: 5.3236, lng: -4.0217 }, destination: { lat: 5.3596, lng: -3.9903 }, category: 'bronze', clientId: 'client-p' },
  });
  const ride = (await app.inject({ method: 'POST', url: '/rides', payload: { clientId: 'client-p', lockId: est.json().quote.lockId } })).json().ride;
  assert.equal(ride.driverId, present.id);
});

test('si tous les chauffeurs en ligne sont muets, c’est critique : la flotte n’existe plus pour le dispatch', async (t) => {
  const { app, container } = await buildApp();
  t.after(() => app.close());
  for (const id of ['m-1', 'm-2', 'm-3']) {
    await chauffeurEnLigne(container, id);
    await container.geo.upsert({ id, lat: 5.3236, lng: -4.0217, meta: { category: 'bronze' } }, 0);
  }
  const sante = await app.inject({ method: 'GET', url: '/admin/vigilance', headers: A });
  const constat = sante.json().constats.find((c: { id: string }) => c.id === 'chauffeurs-en-ligne-muets');
  assert.equal(constat.severite, 'critique');
  assert.equal(constat.elements.length, 3);
});
