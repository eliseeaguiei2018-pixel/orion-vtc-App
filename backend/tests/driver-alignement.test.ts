import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { FastifyInstance } from 'fastify';
import type { RealtimeMessage } from '../src/modules/realtime/hub.js';

/**
 * ALIGNEMENT APP CHAUFFEUR ↔ ÉCOSYSTÈME : tracé GPS des vrais chauffeurs, course
 * libérée faute de paiement, part d'abonnement, annulation motivée par le chauffeur,
 * locations Signature synchronisées, note reçue en direct, confidentialité du passager.
 */
const AUTH = { 'x-admin-token': 'orion-admin-dev' };
const POS = { lat: 5.336, lng: -4.031 };
const ORIGIN = { lat: 5.335, lng: -4.03 };
const DEST = { lat: 5.345, lng: -4.02 };

async function appDriver(app: FastifyInstance, phone: string, name: string, pos = POS) {
  const otp = (await app.inject({ method: 'POST', url: '/drivers/auth/otp', payload: { phone } })).json();
  const v = (await app.inject({ method: 'POST', url: '/drivers/auth/verify', payload: { phone, code: otp.devCode, name } })).json();
  await app.inject({ method: 'POST', url: `/admin/drivers/${v.driver.id}/kyc`, headers: AUTH, payload: { status: 'active' } });
  const headers = { authorization: `Bearer ${v.token}` };
  const on = await app.inject({ method: 'POST', url: `/drivers/${v.driver.id}/online`, headers, payload: { position: pos } });
  assert.equal(on.statusCode, 200, on.body);
  return { id: v.driver.id as string, headers };
}

async function order(app: FastifyInstance, key: string, extra: Record<string, unknown> = {}) {
  const est = await app.inject({ method: 'POST', url: '/pricing/estimate', payload: { origin: ORIGIN, destination: DEST, category: 'bronze' } });
  const r = await app.inject({ method: 'POST', url: '/rides', headers: { 'idempotency-key': key }, payload: { clientId: `client-${key}`, lockId: est.json().quote.lockId, ...extra } });
  assert.equal(r.statusCode, 201, r.body);
  return { ...r.json().ride, code: r.json().codePriseEnCharge } as { id: string; status: string; driverId?: string; code: string; clientId: string };
}

const loc = (app: FastifyInstance, d: { id: string; headers: Record<string, string> }, p: { lat: number; lng: number }) =>
  app.inject({ method: 'POST', url: `/drivers/${d.id}/location`, headers: d.headers, payload: { position: p } });

test('Tracé GPS : les positions de l’app alimentent la course (SOS, déviation, litiges)', async (t) => {
  const { buildApp } = await import('../src/app.js');
  const { app, container } = await buildApp();
  t.after(() => app.close());
  const d = await appDriver(app, '0180000001', 'Koffi Tracé');
  const ride = await order(app, 'trace-1');
  assert.equal(ride.driverId, d.id);
  await app.inject({ method: 'POST', url: `/drivers/${d.id}/offers/${ride.id}/accept`, headers: d.headers });
  await app.inject({ method: 'POST', url: `/rides/${ride.id}/transition`, headers: d.headers, payload: { to: 'driver_en_route' } });
  await loc(app, d, { lat: 5.3352, lng: -4.0302 });
  await loc(app, d, { lat: 5.3351, lng: -4.0301 });
  await app.inject({ method: 'POST', url: `/rides/${ride.id}/transition`, headers: d.headers, payload: { to: 'arrived' } });
  const start = await app.inject({ method: 'POST', url: `/rides/${ride.id}/start`, headers: d.headers, payload: { code: ride.code } });
  assert.equal(start.statusCode, 200, start.body);
  await loc(app, d, { lat: 5.338, lng: -4.027 });
  const r = container.rides.get(ride.id)!;
  assert.equal(r.trace?.length, 3, 'chaque position reçue est tracée');
  assert.equal(r.traceDepart, 2, 'le trajet avec le client commence à la prise en charge');
  assert.ok(typeof r.trace?.[2]?.t === 'number', 'points horodatés');

  // Le SOS du chauffeur part de sa VRAIE dernière position, plus du point de départ.
  const sos = await app.inject({ method: 'POST', url: `/rides/${ride.id}/sos`, headers: d.headers, payload: { by: 'chauffeur' } });
  assert.equal(sos.statusCode, 201);
  const alerte = container.safety.list(10).find((a) => a.id === sos.json().alert.id)!;
  assert.deepEqual({ lat: alerte.location.lat, lng: alerte.location.lng }, { lat: 5.338, lng: -4.027 });
  // Suivi de SON alerte par le chauffeur (même parcours que le client).
  const suivi = await app.inject({ method: 'GET', url: `/safety/sos/${alerte.id}?userId=${d.id}` });
  assert.equal(suivi.statusCode, 200);
});

test('Course terminée sans paiement : le chauffeur est libéré, la course passe « à régulariser »', async (t) => {
  const { buildApp } = await import('../src/app.js');
  const { app, container } = await buildApp();
  t.after(() => app.close());
  const d = await appDriver(app, '0180000002', 'Awa Impayé');
  const ride = await order(app, 'unpaid-1');
  await app.inject({ method: 'POST', url: `/drivers/${d.id}/offers/${ride.id}/accept`, headers: d.headers });
  for (const to of ['driver_en_route', 'arrived']) await app.inject({ method: 'POST', url: `/rides/${ride.id}/transition`, headers: d.headers, payload: { to } });
  await app.inject({ method: 'POST', url: `/rides/${ride.id}/start`, headers: d.headers, payload: { code: ride.code } });
  await app.inject({ method: 'POST', url: `/rides/${ride.id}/transition`, headers: d.headers, payload: { to: 'completed' } });
  assert.equal((await app.inject({ method: 'GET', url: `/drivers/${d.id}/active-ride`, headers: d.headers })).json().ride.id, ride.id);

  // Délai console écoulé : libération automatique.
  const faites = container.rideRelease.tick(Date.now() + 60 * 60_000);
  assert.equal(faites.length, 1);
  assert.equal((await app.inject({ method: 'GET', url: `/drivers/${d.id}/active-ride`, headers: d.headers })).json().ride, null, 'plus de mission bloquante');
  const hist = (await app.inject({ method: 'GET', url: `/drivers/${d.id}/rides`, headers: d.headers })).json();
  assert.equal(hist.aRegulariser.length, 1);
  assert.equal(hist.aRegulariser[0].id, ride.id);

  // Le chauffeur régularise l'encaissement espèces : la course sort de la liste.
  const pay = await app.inject({ method: 'POST', url: `/rides/${ride.id}/pay`, headers: { ...d.headers, 'idempotency-key': 'reg-1' }, payload: { method: 'cash' } });
  assert.equal(pay.statusCode, 200, pay.body);
  const apres = (await app.inject({ method: 'GET', url: `/drivers/${d.id}/rides`, headers: d.headers })).json();
  assert.equal(apres.aRegulariser.length, 0);
});

test('Abonnement : le chauffeur voit ce que le client paie vraiment, est payé sur le brut', async (t) => {
  const { buildApp } = await import('../src/app.js');
  const { app, container } = await buildApp();
  t.after(() => app.close());
  const d = await appDriver(app, '0180000003', 'Grace Abonné');
  const ride = await order(app, 'abo-1');
  const r = container.rides.get(ride.id)!;
  r.subscription = { plan: 'ORION Pro', montantCouvert: r.quote.amount, remise: 0, aPayer: 0, raison: 'Course incluse dans le forfait' };
  const act = (await app.inject({ method: 'GET', url: `/drivers/${d.id}/active-ride`, headers: d.headers })).json().ride;
  assert.equal(act.encaissement.aEncaisser, 0, 'rien à demander au client');
  assert.equal(act.encaissement.brut, r.quote.amount);
  assert.equal(act.encaissement.abonnement.plan, 'ORION Pro');

  await app.inject({ method: 'POST', url: `/drivers/${d.id}/offers/${ride.id}/accept`, headers: d.headers });
  for (const to of ['driver_en_route', 'arrived']) await app.inject({ method: 'POST', url: `/rides/${ride.id}/transition`, headers: d.headers, payload: { to } });
  await app.inject({ method: 'POST', url: `/rides/${ride.id}/start`, headers: d.headers, payload: { code: ride.code } });
  await app.inject({ method: 'POST', url: `/rides/${ride.id}/transition`, headers: d.headers, payload: { to: 'completed' } });
  const pay = await app.inject({ method: 'POST', url: `/rides/${ride.id}/pay`, headers: { 'idempotency-key': 'abo-pay' }, payload: { method: 'cash' } });
  assert.equal(pay.statusCode, 200, pay.body);
  const types = container.wallet.history(d.id).map((e) => e.type);
  assert.ok(!types.includes('cash_collected'), 'aucune espèce encaissée');
  assert.ok(container.wallet.balance(d.id) > 0, 'le chauffeur est rémunéré sur le brut');
});

test('Annulation par le chauffeur : motif, réattribution sans frais, client absent, course en cours', async (t) => {
  const { buildApp } = await import('../src/app.js');
  const { app, container } = await buildApp();
  t.after(() => app.close());
  const a = await appDriver(app, '0180000004', 'Chauffeur A', { lat: 5.336, lng: -4.031 });
  const b = await appDriver(app, '0180000005', 'Chauffeur B', { lat: 5.337, lng: -4.032 });
  const byId: Record<string, typeof a> = { [a.id]: a, [b.id]: b };

  // 1) En route, client injoignable → la course part vers l'autre chauffeur, sans frais.
  const ride = await order(app, 'cancel-1');
  const first = byId[ride.driverId!]!;
  const other = first === a ? b : a;
  await app.inject({ method: 'POST', url: `/drivers/${first.id}/offers/${ride.id}/accept`, headers: first.headers });
  await app.inject({ method: 'POST', url: `/rides/${ride.id}/transition`, headers: first.headers, payload: { to: 'driver_en_route' } });
  const sansMotif = await app.inject({ method: 'POST', url: `/drivers/${first.id}/rides/${ride.id}/cancel`, headers: first.headers, payload: {} });
  assert.equal(sansMotif.statusCode, 400, 'motif obligatoire');
  const c1 = await app.inject({ method: 'POST', url: `/drivers/${first.id}/rides/${ride.id}/cancel`, headers: first.headers, payload: { motif: 'client_injoignable' } });
  assert.equal(c1.statusCode, 200, c1.body);
  assert.equal(c1.json().reattribuee, true);
  const r1 = container.rides.get(ride.id)!;
  assert.equal(r1.driverId, other.id);
  assert.equal(r1.status, 'accepted', 'repart pour le nouveau chauffeur');
  assert.ok(!r1.events.some((e) => e.type === 'cancel_fee'), 'aucun frais pour le passager');
  assert.equal(container.clients.get(r1.clientId)?.cancellations ?? 0, 0, 'aucune annulation comptée contre le passager');
  assert.equal(container.drivers.get(first.id)!.cancellations, 1);
  assert.equal(container.drivers.get(first.id)!.availability, 'online');
  assert.ok(container.audit.list(50).some((e) => e.action === 'ride.cancel_chauffeur' && e.target === ride.id));

  // 2) Client absent : refusé avant la fin des minutes offertes, accepté après (frais).
  await app.inject({ method: 'POST', url: `/drivers/${other.id}/offers/${ride.id}/accept`, headers: other.headers });
  for (const to of ['driver_en_route', 'arrived']) await app.inject({ method: 'POST', url: `/rides/${ride.id}/transition`, headers: other.headers, payload: { to } });
  const trop = await app.inject({ method: 'POST', url: `/drivers/${other.id}/rides/${ride.id}/cancel`, headers: other.headers, payload: { motif: 'client_absent' } });
  assert.equal(trop.statusCode, 400);
  const arrivee = [...container.rides.get(ride.id)!.events].reverse().find((e) => e.type === 'arrived')!;
  arrivee.at = new Date(Date.now() - 30 * 60_000).toISOString();
  const absent = await app.inject({ method: 'POST', url: `/drivers/${other.id}/rides/${ride.id}/cancel`, headers: other.headers, payload: { motif: 'client_absent' } });
  assert.equal(absent.statusCode, 200, absent.body);
  const r2 = container.rides.get(ride.id)!;
  assert.equal(r2.status, 'cancelled');
  const ev = r2.events.find((e) => e.type === 'cancelled')!.payload as { by: string; motif: string };
  assert.equal(ev.by, 'chauffeur');
  assert.equal(ev.motif, 'client_absent');
  assert.ok((container.clients.get(r2.clientId)?.noShowFees ?? 0) > 0, 'frais d’absence inscrits');

  // 3) Course en cours : pas d'annulation par le chauffeur.
  const ride2 = await order(app, 'cancel-2');
  const d2 = byId[ride2.driverId!]!;
  await app.inject({ method: 'POST', url: `/drivers/${d2.id}/offers/${ride2.id}/accept`, headers: d2.headers });
  for (const to of ['driver_en_route', 'arrived']) await app.inject({ method: 'POST', url: `/rides/${ride2.id}/transition`, headers: d2.headers, payload: { to } });
  await app.inject({ method: 'POST', url: `/rides/${ride2.id}/start`, headers: d2.headers, payload: { code: ride2.code } });
  const enCours = await app.inject({ method: 'POST', url: `/drivers/${d2.id}/rides/${ride2.id}/cancel`, headers: d2.headers, payload: { motif: 'autre' } });
  assert.equal(enCours.statusCode, 400);
  // Un autre chauffeur ne peut pas annuler la course d'un collègue.
  const intrus = d2 === a ? b : a;
  const vol = await app.inject({ method: 'POST', url: `/drivers/${intrus.id}/rides/${ride2.id}/cancel`, headers: intrus.headers, payload: { motif: 'autre' } });
  assert.equal(vol.statusCode, 404);
});

test('Location Signature : étapes du chauffeur, statut console et réaffectation en direct', async (t) => {
  const { buildApp } = await import('../src/app.js');
  const { app, container } = await buildApp();
  t.after(() => app.close());
  const a = await appDriver(app, '0180000006', 'Chauffeur Prestige');
  const b = await appDriver(app, '0180000007', 'Chauffeur Relais');
  const res = await app.inject({ method: 'POST', url: '/rental/reserve', payload: {
    formula: 'evenement', vehicleId: 'maextro-s800', duree: 'journee', userId: 'client-mariage', lieu: 'Église Saint-Paul, Plateau',
    debut: new Date(Date.now() + 3 * 86_400_000).toISOString(), options: { decoration: true, tapisRouge: true },
    contact: { nom: 'Aya Konan', telephone: '+2250102030405' },
  } });
  assert.equal(res.statusCode, 201, res.body);
  const id = res.json().reservation.id as string;

  const { driverRoom } = await import('../src/modules/realtime/hub.js');
  const msgsA: RealtimeMessage[] = [];
  const msgsB: RealtimeMessage[] = [];
  container.realtime.subscribe(driverRoom(a.id), (m) => msgsA.push(m));
  container.realtime.subscribe(driverRoom(b.id), (m) => msgsB.push(m));

  await app.inject({ method: 'POST', url: `/admin/rental/${id}/assign`, headers: AUTH, payload: { driverId: a.id } });
  const liste = (await app.inject({ method: 'GET', url: `/drivers/${a.id}/rentals`, headers: a.headers })).json();
  assert.equal(liste.rentals[0].id, id);
  assert.equal(liste.rentals[0].total, undefined, 'le prix n’est jamais exposé au chauffeur');
  assert.equal(liste.rentals[0].options.tapisRouge, true);

  // Console : confirmation → poussée au chauffeur.
  await app.inject({ method: 'POST', url: `/admin/rental/${id}/status`, headers: AUTH, payload: { status: 'confirmee' } });
  assert.ok(msgsA.some((m) => m.type === 'rental.update' && (m.data as { rental: { status: string } }).rental.status === 'confirmee'));

  // Étapes du chauffeur : préparé, puis fin de service refusée avant le début.
  const prep = await app.inject({ method: 'POST', url: `/drivers/${a.id}/rentals/${id}/etape`, headers: a.headers, payload: { etape: 'vehicule_prepare', note: 'Fleurs blanches posées' } });
  assert.equal(prep.statusCode, 200, prep.body);
  assert.equal(prep.json().rental.etapes[0].etape, 'vehicule_prepare');
  assert.equal((await app.inject({ method: 'POST', url: `/drivers/${a.id}/rentals/${id}/etape`, headers: a.headers, payload: { etape: 'vehicule_prepare' } })).statusCode, 409);
  assert.equal((await app.inject({ method: 'POST', url: `/drivers/${a.id}/rentals/${id}/etape`, headers: a.headers, payload: { etape: 'fin_service' } })).statusCode, 400);
  // Un autre chauffeur ne peut rien déclarer sur cette location.
  assert.equal((await app.inject({ method: 'POST', url: `/drivers/${b.id}/rentals/${id}/etape`, headers: b.headers, payload: { etape: 'en_route' } })).statusCode, 404);

  // Réaffectation console : l'ancien chauffeur est prévenu que la location lui est retirée.
  await app.inject({ method: 'POST', url: `/admin/rental/${id}/assign`, headers: AUTH, payload: { driverId: b.id } });
  assert.ok(msgsA.some((m) => m.type === 'rental.withdrawn'));
  assert.ok(msgsB.some((m) => m.type === 'rental.assigned'));
  const debut = await app.inject({ method: 'POST', url: `/drivers/${b.id}/rentals/${id}/etape`, headers: b.headers, payload: { etape: 'debut_service' } });
  assert.equal(debut.json().rental.status, 'en_cours');
  const fin = await app.inject({ method: 'POST', url: `/drivers/${b.id}/rentals/${id}/etape`, headers: b.headers, payload: { etape: 'fin_service' } });
  assert.equal(fin.json().rental.status, 'terminee');
  assert.equal(container.rental.get(id)!.status, 'terminee', 'la console voit la fin de service');
});

test('Note reçue en direct et confidentialité du passager (prénom + photo)', async (t) => {
  const { buildApp } = await import('../src/app.js');
  const { app, container } = await buildApp();
  t.after(() => app.close());
  const d = await appDriver(app, '0180000008', 'Ismaël Note');
  const ride = await order(app, 'note-1');
  container.clients.updateProfile(ride.clientId, { name: 'Mariam Touré Koné' });
  const act = (await app.inject({ method: 'GET', url: `/drivers/${d.id}/active-ride`, headers: d.headers })).json().ride;
  assert.equal(act.client.name, 'Mariam', 'prénom seulement (politique de confidentialité)');
  assert.ok('photo' in act.client);

  const { driverRoom } = await import('../src/modules/realtime/hub.js');
  const msgs: RealtimeMessage[] = [];
  container.realtime.subscribe(driverRoom(d.id), (m) => msgs.push(m));
  await app.inject({ method: 'POST', url: `/drivers/${d.id}/offers/${ride.id}/accept`, headers: d.headers });
  for (const to of ['driver_en_route', 'arrived']) await app.inject({ method: 'POST', url: `/rides/${ride.id}/transition`, headers: d.headers, payload: { to } });
  await app.inject({ method: 'POST', url: `/rides/${ride.id}/start`, headers: d.headers, payload: { code: ride.code } });
  await app.inject({ method: 'POST', url: `/rides/${ride.id}/transition`, headers: d.headers, payload: { to: 'completed' } });
  await app.inject({ method: 'POST', url: `/rides/${ride.id}/pay`, headers: { 'idempotency-key': 'note-pay' }, payload: { method: 'wave', phone: '+2250707070707' } });
  await app.inject({ method: 'POST', url: `/rides/${ride.id}/rate`, payload: { stars: 5, comment: 'Chauffeur très poli et voiture propre' } });
  const note = msgs.find((m) => m.type === 'ride.rated');
  assert.ok(note, 'note poussée au chauffeur');
  const data = note!.data as { stars: number; tags: string[]; comment?: string };
  assert.equal(data.stars, 5);
  assert.ok(data.tags.includes('#Courtoisie'));
  assert.equal(data.comment, undefined, 'jamais le texte brut du passager');
});
