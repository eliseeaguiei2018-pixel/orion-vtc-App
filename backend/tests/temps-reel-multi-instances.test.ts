import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { createServer } from 'node:net';
import { buildApp, brancherBusRedis } from '../src/app.js';
import { createContainer } from '../src/container.js';
import { EMERGENCY_ROOM, rideRoom, type RealtimeMessage } from '../src/modules/realtime/hub.js';

/**
 * PLUSIEURS INSTANCES, UN SEUL TEMPS RÉEL.
 *
 * Deux serveurs ORION tournent côte à côte, reliés par un vrai Redis. Un SOS levé sur
 * l'instance A doit arriver au poste de supervision branché sur l'instance B, une seule
 * fois, et l'instance A ne doit pas recevoir son propre message en double.
 *
 * Le test démarre son propre Redis s'il est installé ; sinon il est ignoré (et le dit).
 */
const redisDisponible = spawnSync('redis-server', ['--version']).status === 0;

async function portLibre(): Promise<number> {
  return new Promise((ok) => {
    const s = createServer().listen(0, () => {
      const port = (s.address() as { port: number }).port;
      s.close(() => ok(port));
    });
  });
}

async function demarrerRedis(): Promise<{ url: string; arreter: () => void; processus: ChildProcess }> {
  const port = await portLibre();
  const processus = spawn('redis-server', ['--port', String(port), '--save', '', '--appendonly', 'no'], { stdio: 'ignore' });
  for (let i = 0; i < 50; i += 1) {
    if (spawnSync('redis-cli', ['-p', String(port), 'ping']).stdout?.toString().trim() === 'PONG') break;
    await new Promise((ok) => setTimeout(ok, 100));
  }
  return { url: `redis://127.0.0.1:${port}`, processus, arreter: () => processus.kill('SIGKILL') };
}

const attendre = (ms: number) => new Promise((ok) => setTimeout(ok, ms));

test('Un SOS levé sur une instance arrive sur l’autre, une seule fois', { skip: !redisDisponible && 'redis-server absent de cette machine' }, async (t) => {
  const redis = await demarrerRedis();
  t.after(() => redis.arreter());

  const a = createContainer();
  const b = createContainer();
  await brancherBusRedis(a, redis.url);
  await brancherBusRedis(b, redis.url);
  const appA = (await buildApp(a)).app;
  const appB = (await buildApp(b)).app;
  t.after(async () => { await appA.close(); await appB.close(); });

  const recusSurB: RealtimeMessage[] = [];
  const recusSurA: RealtimeMessage[] = [];
  b.realtime.subscribe(EMERGENCY_ROOM, (m) => recusSurB.push(m));
  a.realtime.subscribe(EMERGENCY_ROOM, (m) => recusSurA.push(m));

  const alerte = a.safety.raiseSos({ userId: 'client-multi', location: { lat: 5.33, lng: -4.02 }, source: 'client' });
  for (let i = 0; i < 40 && recusSurB.length === 0; i += 1) await attendre(25);

  assert.equal(recusSurB.length, 1, 'le poste branché sur B reçoit le SOS levé sur A');
  assert.equal((recusSurB[0]!.data as { id: string }).id, alerte.id);
  assert.equal(recusSurB[0]!.type, 'emergency.alert');
  await attendre(100);
  assert.equal(recusSurA.length, 1, 'A ne reçoit pas son propre message une deuxième fois');
  assert.equal(recusSurB.length, 1, 'B ne le reçoit qu’une fois');

  // Dans l'autre sens, sur la room d'une course : le chauffeur sur A suit le client sur B.
  const surA: RealtimeMessage[] = [];
  a.realtime.subscribe(rideRoom('course-x'), (m) => surA.push(m));
  b.realtime.publish(rideRoom('course-x'), 'ride.update', { status: 'accepted' });
  for (let i = 0; i < 40 && surA.length === 0; i += 1) await attendre(25);
  assert.equal(surA.length, 1);

  // L'état du bus est visible des mesures serveur.
  const mesures = await appA.inject({ method: 'GET', url: '/admin/systeme/mesures', headers: { 'x-admin-token': 'orion-admin-dev' } });
  const bus = mesures.json().tempsReel;
  assert.equal(bus.mode, 'redis');
  assert.equal(bus.connecte, true);
  assert.ok(bus.envoyes >= 1 && bus.recus >= 1, JSON.stringify(bus));
});

test('Redis tombe : chaque instance continue de servir ses propres clients', { skip: !redisDisponible && 'redis-server absent de cette machine' }, async (t) => {
  const redis = await demarrerRedis();
  const a = createContainer();
  await brancherBusRedis(a, redis.url);
  const appA = (await buildApp(a)).app;
  t.after(async () => { redis.arreter(); await appA.close(); });

  redis.arreter();
  await attendre(300);
  const locaux: RealtimeMessage[] = [];
  a.realtime.subscribe(EMERGENCY_ROOM, (m) => locaux.push(m));
  a.safety.raiseSos({ userId: 'client-panne', location: { lat: 5.33, lng: -4.02 }, source: 'client' });
  assert.equal(locaux.length, 1, 'le SOS est livré immédiatement aux clients de cette instance');
  const sante = await appA.inject({ method: 'GET', url: '/health/live' });
  assert.equal(sante.statusCode, 200, 'le serveur répond toujours');
});
