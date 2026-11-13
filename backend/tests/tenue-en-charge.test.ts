import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildApp } from '../src/app.js';
import { config } from '../src/config/index.js';
import { Routage } from '../src/modules/maps/routage.js';
import type { Ride } from '../src/modules/rides/store.js';
import type { Quote } from '../src/modules/services/types.js';

/**
 * TENUE EN CHARGE : ce que le test de 5 000 courses simultanées a révélé, verrouillé.
 *  - la liste des équipages bloquait le serveur 8,6 s (chauffeurs × courses) ;
 *  - le tableau de bord recevait des milliers de messages par seconde, un par ligne ;
 *  - son état pesait des mégaoctets (un objet détaillé par véhicule, chaque tracé) ;
 *  - une rafale de commandes lançait autant d'appels OSRM simultanés.
 */
const AUTH = { 'x-admin-token': 'orion-admin-dev' };

function course(i: number, driverId: string, status: Ride['status']): Ride {
  const quote = {
    lockId: `l${i}`, serviceType: 'course', category: 'bronze',
    origin: { lat: 5.32, lng: -4.02 }, destination: { lat: 5.36, lng: -3.99 },
    amount: 1500, currency: 'XOF', distanceMeters: 5000, etaSeconds: 900, trafficLevel: 'dense',
    breakdown: { base: 300, distance: 650, time: 200, surge: 1, traffic: 0, discount: 0, subtotal: 1150, tva: 58, fee: 115, insurance: 0 },
  } as unknown as Quote;
  return {
    id: `charge-ride-${i}`, clientId: `client-${i % 500}`, driverId, serviceType: 'course', status,
    origin: quote.origin, destination: quote.destination, quote, events: [], createdAt: new Date().toISOString(),
  } as unknown as Ride;
}

test('équipages : une passe par source, plus de blocage avec des milliers de chauffeurs', async (t) => {
  const { app, container } = await buildApp();
  t.after(() => app.close());
  for (let i = 0; i < 3000; i++) {
    container.drivers.upsert({ id: `drv-${i}`, name: `Chauffeur ${i}`, matricule: `ORION-CI-${10000 + i}`, kycStatus: 'active', availability: 'online', category: 'bronze', ratingAvg: 4.8, ratingCount: 10 } as never);
  }
  for (let i = 0; i < 3000; i++) container.rides.save(course(i, `drv-${i % 1000}`, i % 2 ? 'completed' : 'in_progress'));

  const debut = performance.now();
  const res = await app.inject({ method: 'GET', url: '/admin/crew', headers: AUTH });
  const duree = performance.now() - debut;
  assert.equal(res.statusCode, 200);
  const corps = res.json();
  assert.ok(duree < 1500, `liste des équipages en ${Math.round(duree)} ms`);
  assert.ok(corps.total >= 3000, 'le total compte tous les chauffeurs');
  assert.equal(corps.equipages.length, 300, 'la console reçoit une liste bornée');
  // Les comptes restent justes : drv-1 a les courses 1, 1001, 2001, toutes terminées.
  const un = (await app.inject({ method: 'GET', url: '/admin/crew?q=ORION-CI-10001', headers: AUTH })).json();
  assert.equal(un.equipages[0].courses, 3);
});

test('tableau de bord : au-delà de 400 véhicules, la carte passe en points compacts', async (t) => {
  const { app, container } = await buildApp();
  t.after(() => app.close());
  for (let i = 0; i < 450; i++) {
    const d = container.drivers.upsert({ id: `masse-${i}`, name: `C ${i}`, matricule: `M-${i}`, kycStatus: 'active', availability: 'offline', category: 'bronze', ratingAvg: 4.8, ratingCount: 10 } as never);
    await container.drivers.goOnline(d.id, { lat: 5.3 + (i % 30) * 0.003, lng: -4.05 + Math.floor(i / 30) * 0.004 });
  }
  const etat = (await app.inject({ method: 'GET', url: '/admin/dashboard', headers: AUTH })).json();
  assert.equal(etat.carte.mode, 'masse');
  assert.equal(etat.flotte.length, 0, 'plus d’objet détaillé par véhicule');
  assert.ok(etat.carte.libres.length >= 450);
  assert.equal(etat.carte.libres[0].length, 2, 'un point = [lng, lat]');
});

test('tableau de bord : le direct part par lots, avec le compte exact', async (t) => {
  const { app, container } = await buildApp();
  await app.listen({ port: 0, host: '127.0.0.1' });
  const port = (app.server.address() as { port: number }).port;
  // Le WebSocket de Node accepte des en-têtes (extension d'undici) : le jeton du personnel.
  const ws = new WebSocket(`ws://127.0.0.1:${port}/ws/dashboard`, { headers: AUTH } as unknown as string[]);
  t.after(async () => { ws.close(); await app.close(); });
  const trames: Array<{ type: string; data?: { entrees?: unknown[]; recus?: number } }> = [];
  ws.addEventListener('message', (ev) => trames.push(JSON.parse(String(ev.data))));
  await new Promise((ok) => ws.addEventListener('open', () => ok(null), { once: true }));

  for (let i = 0; i < 500; i++) container.realtime.publish('tableau', 'journal', { id: `e${i}`, titre: `ligne ${i}` });
  for (let i = 0; i < 40 && !trames.some((f) => f.type === 'journal.lot'); i++) await new Promise((r) => setTimeout(r, 50));
  await new Promise((r) => setTimeout(r, 400));

  const lots = trames.filter((f) => f.type === 'journal.lot');
  assert.ok(lots.length >= 1 && lots.length <= 3, `${lots.length} lot(s) pour 500 lignes`);
  assert.equal(lots.reduce((n, l) => n + (l.data?.recus ?? 0), 0), 500, 'aucune ligne perdue dans le compte');
  assert.ok(lots.every((l) => (l.data?.entrees?.length ?? 0) <= 40), 'un lot garde les 40 plus récentes');
  assert.equal((lots[0]!.data!.entrees![0] as { id: string }).id, 'e499', 'la plus récente en tête');
  assert.ok(!trames.some((f) => f.type === 'journal'), 'plus aucun message ligne par ligne');
});

test('itinéraires : rafale bornée, demandes identiques partagées, repli immédiat si saturé', async () => {
  let appels = 0;
  let liberer: () => void = () => {};
  const bloque = new Promise<void>((ok) => { liberer = ok; });
  const lent = (async () => {
    appels += 1;
    await bloque;
    return new Response(JSON.stringify({ code: 'NoRoute' }), { status: 200 });
  }) as typeof fetch;
  const r = new Routage('https://osrm.exemple', lent, 6000, 400, 2, 3);
  const A = { lat: 5.32, lng: -4.02 };
  const point = (i: number) => ({ lat: 5.33 + i * 0.001, lng: -4.0 });

  // Cinq demandes identiques : un seul appel.
  const memes = Array.from({ length: 5 }, () => r.itineraire([A, point(0)]));
  // Puis une rafale : 2 en cours au plus, 3 en file, le reste repart en tracé de repli.
  const autres = Array.from({ length: 10 }, (_, i) => r.itineraire([A, point(i + 1)]));
  await new Promise((ok) => setImmediate(ok));
  assert.equal(r.etat().actifs, 2);
  assert.equal(r.etat().enFile, 3);
  assert.equal(r.etat().repliSaturation, 6, 'au-delà de la file : repli immédiat, sans attendre');
  liberer();
  const tous = await Promise.all([...memes, ...autres]);
  assert.ok(tous.every((x) => x.geometrie.length >= 2));
  // 1 appel partagé par les 5 demandes identiques, 1 autre actif, puis les 3 de la file.
  assert.equal(appels, 5, `${appels} appels OSRM pour 15 demandes`);
});

test('test de charge : préparation refusée sans autorisation explicite, jamais en production', async (t) => {
  const { app } = await buildApp();
  t.after(() => app.close());
  const corps = { conducteurs: 10, clients: 10 };
  const sans = await app.inject({ method: 'POST', url: '/admin/charge/preparer', headers: AUTH, payload: corps });
  assert.equal(sans.statusCode, 403, 'désactivé par défaut');

  const reglage = config as { TEST_CHARGE: boolean; NODE_ENV: string };
  reglage.TEST_CHARGE = true;
  t.after(() => { reglage.TEST_CHARGE = false; });
  const ok = await app.inject({ method: 'POST', url: '/admin/charge/preparer', headers: AUTH, payload: corps });
  assert.equal(ok.statusCode, 200);
  assert.equal(ok.json().clients.length, 10);

  const env = reglage.NODE_ENV;
  reglage.NODE_ENV = 'production';
  try {
    const prod = await app.inject({ method: 'POST', url: '/admin/charge/preparer', headers: AUTH, payload: corps });
    assert.equal(prod.statusCode, 403, 'jamais en production');
  } finally { reglage.NODE_ENV = env; }

  const m = (await app.inject({ method: 'GET', url: '/admin/systeme/mesures', headers: AUTH })).json();
  assert.ok(m.serveur.requetesParSeconde >= 0 && typeof m.serveur.boucleMs.p99 === 'number');
  assert.ok(m.plateforme.conducteursEnLigne >= 10);
});

test('tableau de bord : un SOS donne UNE ligne, avec la commune', async (t) => {
  const { app, container } = await buildApp();
  t.after(() => app.close());
  const lignes: Array<{ titre: string }> = [];
  container.realtime.subscribe('tableau', (m) => { if (m.type === 'journal') lignes.push(m.data as { titre: string }); });
  container.safety.raiseSos({ userId: 'client-1', location: { lat: 5.3236, lng: -4.0217 }, rideId: 'ride-1', source: 'client' });
  const sos = lignes.filter((l) => l.titre.startsWith('Alerte SOS'));
  assert.equal(sos.length, 1, `lignes : ${lignes.map((l) => l.titre).join(' | ')}`);
  assert.match(sos[0]!.titre, /Alerte SOS · \S/, 'la commune suit le titre');
});
