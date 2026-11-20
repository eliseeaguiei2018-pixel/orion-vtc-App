import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildApp } from '../src/app.js';

/**
 * LIBÉRATION DES CHAUFFEURS BLOQUÉS « EN COURSE ».
 *
 * Un chauffeur ne redevient disponible qu'au paiement, à la notation ou à
 * l'annulation. Si personne ne paie — client parti sans régler, app fermée —
 * rien ne le libère jamais. Trouvé en enregistrant la démonstration : treize
 * chauffeurs « en course », zéro course active, et le client renvoyé « aucun
 * chauffeur ».
 *
 * Ces tests verrouillent le filet : la fenêtre d'encaissement est respectée, puis
 * le chauffeur est libéré, tracé, prévenu — et une seule fois.
 */
const A = { 'x-admin-token': 'orion-admin-dev' };
const MIN = 60_000;

async function courseTerminee(app: Awaited<ReturnType<typeof buildApp>>['app'], container: Awaited<ReturnType<typeof buildApp>>['container'], suffixe: string) {
  const d = container.drivers.upsert({
    id: `drv-rel-${suffixe}`, name: `Chauffeur ${suffixe}`, matricule: `AB-${suffixe}-CI`, category: 'bronze',
    kycStatus: 'active', availability: 'offline', ratingAvg: 4.8, ratingCount: 20, phone: '+2250701020304',
  });
  await container.drivers.goOnline(d.id, { lat: 5.3236, lng: -4.0217 });

  const est = await app.inject({
    method: 'POST', url: '/pricing/estimate',
    payload: { origin: { lat: 5.3236, lng: -4.0217 }, destination: { lat: 5.3596, lng: -3.9903 }, category: 'bronze', clientId: `client-${suffixe}` },
  });
  const ride = (await app.inject({ method: 'POST', url: '/rides', payload: { clientId: `client-${suffixe}`, lockId: est.json().quote.lockId, paymentMethod: 'cash' } })).json().ride;
  assert.equal(ride.driverId, d.id, 'le chauffeur doit avoir été attribué');
  assert.equal(container.drivers.get(d.id)!.availability, 'on_trip');

  for (const to of ['driver_en_route', 'arrived', 'in_progress', 'completed']) {
    const r = await app.inject({ method: 'POST', url: `/rides/${ride.id}/transition`, payload: { to } });
    assert.equal(r.statusCode, 200, `${to} : ${r.body}`);
  }
  return { ride, driverId: d.id };
}

test('terminée mais non réglée : le chauffeur reste en course le temps d’encaisser, puis est libéré', async (t) => {
  const { app, container } = await buildApp();
  t.after(() => app.close());
  const { ride, driverId } = await courseTerminee(app, container, '001');

  // Dans la fenêtre d'encaissement, rien ne bouge : il rend peut-être la monnaie.
  const tot = container.rideRelease.tick(Date.now() + 2 * MIN);
  assert.equal(tot.length, 0);
  assert.equal(container.drivers.get(driverId)!.availability, 'on_trip');

  // Au-delà, il est libéré, tracé, prévenu.
  const faites = container.rideRelease.tick(Date.now() + 6 * MIN);
  assert.equal(faites.length, 1);
  assert.equal(faites[0]!.rideId, ride.id);
  assert.equal(container.drivers.get(driverId)!.availability, 'online');
  assert.equal(container.rides.get(ride.id)!.status, 'completed', 'l’impayé est un fait financier : la course reste terminée');
  assert.ok(container.rides.get(ride.id)!.events.some((e) => e.type === 'driver_released_unpaid'));
  assert.ok(container.audit.list(50).some((e) => e.action === 'ride.driver_released_unpaid' && e.target === ride.id));

  // Et une seule fois : un second passage ne retrace rien.
  assert.equal(container.rideRelease.tick(Date.now() + 10 * MIN).length, 0);
});

test('le chauffeur libéré peut effectivement reprendre une course', async (t) => {
  const { app, container } = await buildApp();
  t.after(() => app.close());
  const { driverId } = await courseTerminee(app, container, '002');
  container.rideRelease.tick(Date.now() + 6 * MIN);

  const est = await app.inject({
    method: 'POST', url: '/pricing/estimate',
    payload: { origin: { lat: 5.3236, lng: -4.0217 }, destination: { lat: 5.3007, lng: -3.9877 }, category: 'bronze', clientId: 'client-suivant' },
  });
  const suivante = (await app.inject({ method: 'POST', url: '/rides', payload: { clientId: 'client-suivant', lockId: est.json().quote.lockId } })).json().ride;
  assert.equal(suivante.driverId, driverId, 'sans le filet, cette course partait en « aucun chauffeur »');
});

test('payée dans les temps : le filet n’a rien à faire', async (t) => {
  const { app, container } = await buildApp();
  t.after(() => app.close());
  const { ride, driverId } = await courseTerminee(app, container, '003');
  // Les espèces sont capturées sur-le-champ ; le mobile money, lui, reste « en
  // attente » tant que l'opérateur n'a pas confirmé — et ne libère donc pas encore.
  const pay = await app.inject({ method: 'POST', url: `/rides/${ride.id}/pay`, payload: { method: 'cash' } });
  assert.equal(pay.statusCode, 200, pay.body);
  assert.equal(container.drivers.get(driverId)!.availability, 'online');
  assert.equal(container.rideRelease.tick(Date.now() + 30 * MIN).length, 0);
});

test('la vigilance montre l’argent qui n’est pas rentré', async (t) => {
  const { app, container } = await buildApp();
  t.after(() => app.close());
  const { ride } = await courseTerminee(app, container, '004');
  // On recule la fin de course de vingt minutes.
  const r = container.rides.get(ride.id)!;
  const fin = r.events.find((e) => e.type === 'completed')!;
  fin.at = new Date(Date.now() - 20 * MIN).toISOString();

  const sante = await app.inject({ method: 'GET', url: '/admin/vigilance', headers: A });
  const constat = sante.json().constats.find((c: { id: string }) => c.id === 'courses-terminees-non-reglees');
  assert.ok(constat, 'le constat doit exister');
  assert.ok(constat.elements.includes(ride.id));
  assert.equal(constat.section, 'rides');
});
