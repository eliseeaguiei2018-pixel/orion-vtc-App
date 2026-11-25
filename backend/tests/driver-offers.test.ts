import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { FastifyInstance } from 'fastify';
import type { RealtimeMessage } from '../src/modules/realtime/hub.js';

/**
 * OFFRES DE COURSE (app chauffeur) : compte à rebours console, acceptation, refus,
 * réattribution en cascade, expiration (pause), actions console, simulateur.
 */
const AUTH = { 'x-admin-token': 'orion-admin-dev' };
const ORIGIN = { lat: 5.335, lng: -4.03 };
const DEST = { lat: 5.345, lng: -4.02 };

async function appDriver(app: FastifyInstance, phone: string, name: string, pos = { lat: 5.336, lng: -4.031 }) {
  const otp = (await app.inject({ method: 'POST', url: '/drivers/auth/otp', payload: { phone } })).json();
  const v = (await app.inject({ method: 'POST', url: '/drivers/auth/verify', payload: { phone, code: otp.devCode, name } })).json();
  await app.inject({ method: 'POST', url: `/admin/drivers/${v.driver.id}/kyc`, headers: AUTH, payload: { status: 'active' } });
  const headers = { authorization: `Bearer ${v.token}` };
  const on = await app.inject({ method: 'POST', url: `/drivers/${v.driver.id}/online`, headers, payload: { position: pos } });
  assert.equal(on.statusCode, 200, on.body);
  return { id: v.driver.id as string, headers };
}

async function order(app: FastifyInstance, key: string) {
  const est = await app.inject({ method: 'POST', url: '/pricing/estimate', payload: { origin: ORIGIN, destination: DEST, category: 'argent' } });
  const r = await app.inject({ method: 'POST', url: '/rides', headers: { 'idempotency-key': key }, payload: { clientId: `client-${key}`, lockId: est.json().quote.lockId } });
  assert.equal(r.statusCode, 201, r.body);
  return r.json().ride as { id: string; status: string; driverId?: string };
}

test('Offre : délai console, acceptation, double réponse refusée', async (t) => {
  const { buildApp } = await import('../src/app.js');
  const { app, container } = await buildApp();
  t.after(() => app.close());
  await app.inject({ method: 'PUT', url: '/admin/dispatch', headers: AUTH, payload: { offerTimeoutSec: 11 } });
  const a = await appDriver(app, '0170000001', 'Yao Konan');

  const seen: RealtimeMessage[] = [];
  const { driverRoom } = await import('../src/modules/realtime/hub.js');
  container.realtime.subscribe(driverRoom(a.id), (m) => seen.push(m));

  const ride = await order(app, 'off-1');
  assert.equal(ride.driverId, a.id);
  const assigned = seen.find((m) => m.type === 'ride.assigned')!;
  const offer = (assigned.data as { offer: { timeoutSec: number; expiresAt: string } }).offer;
  assert.equal(offer.timeoutSec, 11, 'délai d’acceptation = réglage console');
  assert.ok(Date.parse(offer.expiresAt) > Date.now());

  const act = (await app.inject({ method: 'GET', url: `/drivers/${a.id}/active-ride`, headers: a.headers })).json().ride;
  assert.equal(act.offer.timeoutSec, 11);

  const ok = await app.inject({ method: 'POST', url: `/drivers/${a.id}/offers/${ride.id}/accept`, headers: a.headers });
  assert.equal(ok.statusCode, 200);
  assert.equal(ok.json().ride.offer, null, 'offre confirmée');
  assert.ok(container.rides.get(ride.id)!.events.some((e) => e.type === 'driver_confirmed'));
  const again = await app.inject({ method: 'POST', url: `/drivers/${a.id}/offers/${ride.id}/accept`, headers: a.headers });
  assert.equal(again.statusCode, 409);

  // Statistiques d'offres sur la fiche (taux d'acceptation).
  const d = container.drivers.get(a.id)!;
  assert.equal(d.offersReceived, 1);
  assert.equal(d.offersAccepted, 1);
  // Sans jeton : refusé.
  assert.equal((await app.inject({ method: 'POST', url: `/drivers/${a.id}/offers/${ride.id}/decline` })).statusCode, 401);
});

test('Refus : réattribution en cascade puis annulation sans frais si personne', async (t) => {
  const { buildApp } = await import('../src/app.js');
  const { app, container } = await buildApp();
  t.after(() => app.close());
  const a = await appDriver(app, '0170000002', 'Chauffeur A', { lat: 5.336, lng: -4.031 });
  const b = await appDriver(app, '0170000003', 'Chauffeur B', { lat: 5.337, lng: -4.032 });
  const drivers = { [a.id]: a, [b.id]: b };

  const { rideRoom } = await import('../src/modules/realtime/hub.js');
  const ride = await order(app, 'off-2');
  const roomMsgs: RealtimeMessage[] = [];
  container.realtime.subscribe(rideRoom(ride.id), (m) => roomMsgs.push(m));

  const first = drivers[ride.driverId!]!;
  const second = first === a ? b : a;
  const dec = await app.inject({ method: 'POST', url: `/drivers/${first.id}/offers/${ride.id}/decline`, headers: first.headers, payload: { reason: 'Trop loin' } });
  assert.equal(dec.statusCode, 200);
  assert.equal(dec.json().reassigned, true);
  assert.equal(container.rides.get(ride.id)!.driverId, second.id, 'cascade vers le suivant');
  assert.equal(container.drivers.get(first.id)!.availability, 'online', 'le chauffeur qui refuse reste en ligne');
  assert.ok(roomMsgs.some((m) => m.type === 'ride.reassigned'), 'client prévenu en direct');

  // Le second refuse aussi : le premier (qui a déjà refusé) n'est PAS re-sollicité.
  const dec2 = await app.inject({ method: 'POST', url: `/drivers/${second.id}/offers/${ride.id}/decline`, headers: second.headers });
  assert.equal(dec2.json().reassigned, false);
  const r = container.rides.get(ride.id)!;
  assert.equal(r.status, 'cancelled');
  assert.ok(r.events.some((e) => e.type === 'no_driver'));
  assert.ok(!r.events.some((e) => e.type === 'cancel_fee'), 'aucun frais facturé au client');
  assert.ok(roomMsgs.some((m) => m.type === 'ride.status' && (m.data as { status: string }).status === 'cancelled'));
});

test('Expiration : chauffeur mis en pause et prévenu, course réattribuée', async (t) => {
  const { buildApp } = await import('../src/app.js');
  const { app, container } = await buildApp();
  t.after(() => app.close());
  const a = await appDriver(app, '0170000004', 'Chauffeur A', { lat: 5.336, lng: -4.031 });
  const b = await appDriver(app, '0170000005', 'Chauffeur B', { lat: 5.337, lng: -4.032 });
  const ride = await order(app, 'off-3');
  const first = ride.driverId!;
  const other = first === a.id ? b.id : a.id;

  const { driverRoom } = await import('../src/modules/realtime/hub.js');
  const notes: RealtimeMessage[] = [];
  container.realtime.subscribe(driverRoom(first), (m) => notes.push(m));

  // Fin du compte à rebours (déclenchée directement : pas d'attente réelle en test).
  const { offersOf } = await import('../src/modules/driver-app/offers.js');
  await (offersOf(container) as unknown as { expire(id: string): Promise<void> }).expire(ride.id);

  assert.equal(container.drivers.get(first)!.availability, 'paused');
  assert.equal(container.drivers.get(first)!.offersExpired, 1);
  assert.ok(notes.some((m) => m.type === 'notification'), 'notification « offre manquée »');
  assert.ok(notes.some((m) => m.type === 'ride.withdrawn'));
  assert.equal(container.rides.get(ride.id)!.driverId, other);

  // Repasser en ligne lève la pause.
  const back = await app.inject({ method: 'POST', url: `/drivers/${first}/online`, headers: (first === a.id ? a : b).headers, payload: { position: { lat: 5.336, lng: -4.031 } } });
  assert.equal(back.statusCode, 200);
  assert.equal(container.drivers.get(first)!.availability, 'online');
});

test('Console : réassignation manuelle et clôture forcée poussées aux chauffeurs', async (t) => {
  const { buildApp } = await import('../src/app.js');
  const { app, container } = await buildApp();
  t.after(() => app.close());
  const a = await appDriver(app, '0170000006', 'Chauffeur A', { lat: 5.336, lng: -4.031 });
  const b = await appDriver(app, '0170000007', 'Chauffeur B', { lat: 5.337, lng: -4.032 });
  const ride = await order(app, 'off-4');
  const first = ride.driverId!;
  const next = first === a.id ? b.id : a.id;

  const { driverRoom, rideRoom } = await import('../src/modules/realtime/hub.js');
  const prevMsgs: RealtimeMessage[] = [];
  const nextMsgs: RealtimeMessage[] = [];
  const roomMsgs: RealtimeMessage[] = [];
  container.realtime.subscribe(driverRoom(first), (m) => prevMsgs.push(m));
  container.realtime.subscribe(driverRoom(next), (m) => nextMsgs.push(m));
  container.realtime.subscribe(rideRoom(ride.id), (m) => roomMsgs.push(m));

  const re = await app.inject({ method: 'POST', url: `/admin/rides/${ride.id}/reassign`, headers: AUTH, payload: { driverId: next } });
  assert.equal(re.statusCode, 200, re.body);
  assert.ok(prevMsgs.some((m) => m.type === 'ride.withdrawn'), 'ancien chauffeur prévenu');
  const assigned = nextMsgs.find((m) => m.type === 'ride.assigned');
  assert.ok(assigned && (assigned.data as { offer: unknown }).offer, 'nouveau chauffeur : offre à confirmer');
  assert.ok(roomMsgs.some((m) => m.type === 'ride.reassigned'), 'client prévenu');

  const force = await app.inject({ method: 'POST', url: `/admin/rides/${ride.id}/force`, headers: AUTH, payload: { action: 'cancel' } });
  assert.equal(force.statusCode, 200);
  assert.ok(roomMsgs.some((m) => m.type === 'ride.status' && (m.data as { status: string }).status === 'cancelled'));
  assert.ok(nextMsgs.some((m) => m.type === 'ride.withdrawn'));
});

test('Simulateur : les chauffeurs équipés de l’app ne sont jamais simulés', async () => {
  const { RideSimulator } = await import('../src/modules/rides/simulator.js');
  const { RideStore } = await import('../src/modules/rides/store.js');
  const { RealtimeHub } = await import('../src/modules/realtime/hub.js');
  const { createRepository } = await import('../src/core/db/repository.js');
  const rides = new RideStore(createRepository('rides-sim-test'));
  const mk = (id: string, driverId: string) => rides.save({
    id, clientId: 'c', driverId, serviceType: 'ride', status: 'accepted', origin: ORIGIN, destination: DEST,
    quote: { lockId: id, serviceType: 'ride', category: 'argent', amount: 1000, currency: 'XOF', origin: ORIGIN, destination: DEST, distanceMeters: 1000, etaSeconds: 60, trafficLevel: 'fluid', breakdown: { base: 0, distance: 0, time: 0, surge: 1, traffic: 0, discount: 0, subtotal: 0, tva: 0, fee: 0, insurance: 0 }, expiresAt: new Date().toISOString() },
    events: [], createdAt: new Date().toISOString(),
  });
  const sim = new RideSimulator(rides, new RealtimeHub(), { enabled: true, tickMs: 1000, enrouteMs: 5000, tripMs: 5000 });
  sim.skipWhen((driverId) => driverId === 'drv-app');
  sim.start(mk('r-app', 'drv-app'));
  sim.start(mk('r-demo', 'drv-demo'));
  assert.equal(rides.get('r-app')!.status, 'accepted', 'chauffeur app : pas de simulation');
  assert.equal(rides.get('r-demo')!.status, 'driver_en_route', 'chauffeur démo : simulé comme avant');
  sim.stopAll();
});
