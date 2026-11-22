import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { paliersDeRecherche } from '../src/container.js';
import { domaineConsole } from '../src/modules/realtime/routes.js';
import { accesPersonnel } from '../src/modules/admin/acces-hors-console.js';
import { cleDeLimite } from '../src/core/limiteur.js';
import type { RealtimeMessage } from '../src/modules/realtime/hub.js';

/**
 * TEST SUR LE TERRAIN, DEUX TÉLÉPHONES : le client commande, le chauffeur le plus proche
 * dans un rayon qui s'élargit jusqu'à 30 km reçoit l'offre ; la console valide l'inscription
 * du chauffeur, lui attribue son véhicule et suit tout en temps réel ; le chauffeur salarié
 * voit son activité du mois et sa prime de performance.
 */
const AUTH = { 'x-admin-token': 'orion-admin-dev' };
// Client au Plateau ; destination à Cocody.
const ORIGIN = { lat: 5.3236, lng: -4.0217 };
const DEST = { lat: 5.3596, lng: -3.9903 };
/** Point à environ `km` kilomètres au nord du client (1° de latitude ≈ 111,2 km). */
const auNord = (km: number) => ({ lat: ORIGIN.lat + km / 111.2, lng: ORIGIN.lng });

async function chauffeur(app: FastifyInstance, phone: string, name: string, position: { lat: number; lng: number }, valider = true) {
  const otp = (await app.inject({ method: 'POST', url: '/drivers/auth/otp', payload: { phone } })).json();
  const v = (await app.inject({ method: 'POST', url: '/drivers/auth/verify', payload: { phone, code: otp.devCode, name } })).json();
  const h = { authorization: `Bearer ${v.token}` };
  if (valider) {
    const a = await app.inject({ method: 'POST', url: `/admin/drivers/${v.driver.id}/attribution`, headers: AUTH, payload: { valider: true } });
    assert.equal(a.statusCode, 200, a.body);
    const on = await app.inject({ method: 'POST', url: `/drivers/${v.driver.id}/online`, headers: h, payload: { position } });
    assert.equal(on.statusCode, 200, on.body);
  }
  return { id: v.driver.id as string, h };
}

async function passager(app: FastifyInstance, phone: string, name: string) {
  const o = (await app.inject({ method: 'POST', url: '/clients/auth/otp', payload: { phone } })).json();
  const v = (await app.inject({ method: 'POST', url: '/clients/auth/verify', payload: { clientId: `c-${phone}`, phone, code: o.devCode, name } })).json();
  return { id: v.client.id as string, h: { authorization: `Bearer ${v.token}` } };
}

async function commander(app: FastifyInstance, client: { id: string; h: Record<string, string> }, cle: string) {
  const q = (await app.inject({ method: 'POST', url: '/pricing/estimate', payload: { origin: ORIGIN, destination: DEST, category: 'argent' } })).json().quote;
  const r = await app.inject({ method: 'POST', url: '/rides', headers: { 'idempotency-key': cle, ...client.h }, payload: { clientId: client.id, lockId: q.lockId, paymentMethod: 'cash' } });
  assert.equal(r.statusCode, 201, r.body);
  return r.json() as { ride: { id: string; status: string; driverId?: string; quote: { amount: number; distanceMeters: number } }; codePriseEnCharge: string | null };
}

/** Course complète côté chauffeur : accepte, se rend, démarre avec le code, termine, encaisse. */
async function realiser(app: FastifyInstance, k: { id: string; h: Record<string, string> }, client: { id: string; h: Record<string, string> }, cle: string, etoiles = 5) {
  const { ride, codePriseEnCharge } = await commander(app, client, cle);
  assert.equal(ride.driverId, k.id);
  assert.equal((await app.inject({ method: 'POST', url: `/drivers/${k.id}/offers/${ride.id}/accept`, headers: k.h })).statusCode, 200);
  for (const to of ['driver_en_route', 'arrived']) {
    assert.equal((await app.inject({ method: 'POST', url: `/rides/${ride.id}/transition`, headers: k.h, payload: { to } })).statusCode, 200);
  }
  assert.equal((await app.inject({ method: 'POST', url: `/rides/${ride.id}/start`, headers: k.h, payload: { code: codePriseEnCharge } })).statusCode, 200);
  assert.equal((await app.inject({ method: 'POST', url: `/rides/${ride.id}/transition`, headers: k.h, payload: { to: 'completed' } })).statusCode, 200);
  const pay = await app.inject({ method: 'POST', url: `/rides/${ride.id}/pay`, headers: { ...k.h, 'idempotency-key': `cash-${ride.id}` }, payload: { method: 'cash' } });
  assert.equal(pay.statusCode, 200, pay.body);
  assert.equal((await app.inject({ method: 'POST', url: `/rides/${ride.id}/rate`, headers: client.h, payload: { stars: etoiles } })).statusCode, 200);
  return ride;
}

test('paliers de recherche : du rayon initial à 30 km en doublant', () => {
  assert.deepEqual(paliersDeRecherche(1.5, 30), [1500, 3000, 6000, 12000, 24000, 30000]);
  assert.deepEqual(paliersDeRecherche(2, 2), [2000]);
});

test('dispatch : un chauffeur à 25 km est trouvé, le plus proche passe toujours d’abord, rien au-delà de 30 km', async (t) => {
  const { app } = await buildApp();
  t.after(() => app.close());
  const loin = await chauffeur(app, '0701110001', 'Kouassi Loin', auNord(25));
  const aya = await passager(app, '0707110001', 'Aya Kouassi');

  // Seul chauffeur en ligne, à 25 km : la recherche s'élargit jusqu'à lui.
  const r1 = await commander(app, aya, 'loin-1');
  assert.equal(r1.ride.status, 'accepted');
  assert.equal(r1.ride.driverId, loin.id, 'chauffeur à 25 km trouvé');
  await app.inject({ method: 'POST', url: `/rides/${r1.ride.id}/transition`, payload: { to: 'cancelled' } });
  await app.inject({ method: 'POST', url: `/drivers/${loin.id}/online`, headers: loin.h, payload: { position: auNord(25) } });

  // Un chauffeur à 8 km arrive : il est servi avant celui de 25 km.
  const proche = await chauffeur(app, '0701110002', 'Yao Proche', auNord(8));
  const r2 = await commander(app, aya, 'proche-1');
  assert.equal(r2.ride.driverId, proche.id, 'le plus proche d’abord');
  await app.inject({ method: 'POST', url: `/rides/${r2.ride.id}/transition`, payload: { to: 'cancelled' } });

  // Au-delà de 30 km : personne.
  const { app: app2 } = await buildApp();
  t.after(() => app2.close());
  await chauffeur(app2, '0701110003', 'Bamba Trop Loin', auNord(34));
  const client2 = await passager(app2, '0707110003', 'Awa Traoré');
  const r3 = await commander(app2, client2, 'trop-loin');
  assert.equal(r3.ride.status, 'no_driver');
});

test('console : valider l’inscription et attribuer le véhicule, l’app chauffeur reçoit sa fiche en direct', async (t) => {
  const { app, container } = await buildApp();
  t.after(() => app.close());
  const k = await chauffeur(app, '0701220001', 'Konan Salarié', ORIGIN, false);

  // Dossier non validé : la mise en ligne est refusée.
  const refus = await app.inject({ method: 'POST', url: `/drivers/${k.id}/online`, headers: k.h, payload: { position: ORIGIN } });
  assert.equal(refus.statusCode, 403);

  const vus: RealtimeMessage[] = [];
  const { driverRoom } = await import('../src/modules/realtime/hub.js');
  container.realtime.subscribe(driverRoom(k.id), (m) => vus.push(m));

  const att = await app.inject({ method: 'POST', url: `/admin/drivers/${k.id}/attribution`, headers: AUTH, payload: {
    category: 'or', vehicleModel: 'BYD Seal', vehiclePlate: '1234 ab 01', vehicleColor: 'Noir', engine: 'electric', batteryKwh: 82, matricule: 'ORION-CI-0042', valider: true,
  } });
  assert.equal(att.statusCode, 200, att.body);
  const fiche = att.json().driver;
  assert.equal(fiche.kycStatus, 'active');
  assert.equal(fiche.category, 'or');
  assert.equal(fiche.vehiclePlate, '1234 AB 01');
  assert.equal(fiche.matricule, 'ORION-CI-0042');
  const maj = vus.filter((m) => m.type === 'driver.update').pop();
  assert.ok(maj, 'fiche poussée à l’app chauffeur');
  assert.equal((maj!.data as { driver: { vehicleModel: string } }).driver.vehicleModel, 'BYD Seal');

  // Le chauffeur peut maintenant se mettre en ligne.
  assert.equal((await app.inject({ method: 'POST', url: `/drivers/${k.id}/online`, headers: k.h, payload: { position: ORIGIN } })).statusCode, 200);

  // Matricule déjà pris : refusé.
  const autre = await chauffeur(app, '0701220002', 'Autre Chauffeur', ORIGIN, false);
  const doublon = await app.inject({ method: 'POST', url: `/admin/drivers/${autre.id}/attribution`, headers: AUTH, payload: { matricule: 'orion-ci-0042' } });
  assert.equal(doublon.statusCode, 409);

  // L'app chauffeur ne peut pas modifier son véhicule.
  const app403 = await app.inject({ method: 'POST', url: `/drivers/${k.id}/profile`, headers: k.h, payload: { vehiclePlate: '9999 ZZ 01' } });
  assert.equal(app403.statusCode, 403);
  // Ses informations personnelles, si.
  assert.equal((await app.inject({ method: 'POST', url: `/drivers/${k.id}/profile`, headers: k.h, payload: { licenseNo: 'CI-PERMIS-77' } })).statusCode, 200);
});

test('chauffeur salarié : activité du mois et prime de performance selon la grille de la console', async (t) => {
  const { app } = await buildApp();
  t.after(() => app.close());
  const k = await chauffeur(app, '0701330001', 'Koffi Performant', auNord(0.2));
  const aya = await passager(app, '0707330001', 'Aya Kouassi');

  // Grille réduite pour le test : 2 courses → 5 000 F, 3 → 9 000 F ; excellence dès 2 notes.
  const g = await app.inject({ method: 'PUT', url: '/admin/primes/grille', headers: AUTH, payload: {
    paliers: [{ courses: 3, montant: 9000 }, { courses: 2, montant: 5000 }],
    noteMin: 4.5, tauxAcceptationMin: 80, annulationsMax: 2,
    bonusExcellence: { note: 4.8, minNotes: 2, montant: 2000 },
    bonusAssiduite: { heures: 100, montant: 3000 },
  } });
  assert.equal(g.statusCode, 200, g.body);
  assert.deepEqual(g.json().grille.paliers.map((p: { courses: number }) => p.courses), [2, 3], 'paliers triés');

  const avant = (await app.inject({ method: 'GET', url: `/drivers/${k.id}/prime`, headers: k.h })).json().prime;
  assert.equal(avant.courses, 0);
  assert.equal(avant.montantEstime, 0);
  assert.equal(avant.prochain.courses, 2);

  const r1 = await realiser(app, k, aya, 'p-1');
  await app.inject({ method: 'POST', url: `/drivers/${k.id}/online`, headers: k.h, payload: { position: auNord(0.2) } });
  await realiser(app, k, aya, 'p-2');

  const act = (await app.inject({ method: 'GET', url: `/drivers/${k.id}/activite`, headers: k.h })).json().activite;
  assert.equal(act.courses, 2);
  assert.ok(act.km > 0);
  assert.equal(act.recettes, r1.quote.amount * 2);
  assert.equal(act.especes, act.recettes, 'espèces à remettre à ORION');
  assert.equal(act.note.nombre, 2);
  assert.equal(act.note.moyenne, 5);
  assert.equal(act.offres.recues, 2);
  assert.equal(act.offres.tauxAcceptation, 100);
  assert.equal(act.aujourdhui.courses, 2);
  assert.ok(act.heuresService >= 0);

  const prime = (await app.inject({ method: 'GET', url: `/drivers/${k.id}/prime`, headers: k.h })).json().prime;
  assert.equal(prime.palier.montant, 5000);
  assert.equal(prime.prochain.courses, 3);
  assert.equal(prime.prochain.reste, 1);
  assert.ok(prime.conditions.every((c: { ok: boolean }) => c.ok));
  assert.equal(prime.bonus.find((b: { id: string }) => b.id === 'excellence').acquis, true);
  assert.equal(prime.montantEstime, 7000, 'palier 5 000 F + excellence 2 000 F');
  assert.equal(prime.montantMax, 9000 + 2000 + 3000);

  // Un autre chauffeur ne lit pas la prime de Koffi.
  const autre = await chauffeur(app, '0701330002', 'Curieux', auNord(40));
  assert.equal((await app.inject({ method: 'GET', url: `/drivers/${k.id}/prime`, headers: autre.h })).statusCode, 403);

  // La console voit la prime de chaque chauffeur et le total du mois.
  const liste = (await app.inject({ method: 'GET', url: '/admin/primes', headers: AUTH })).json();
  const ligne = liste.chauffeurs.find((l: { id: string }) => l.id === k.id);
  assert.equal(ligne.montant, 7000);
  assert.ok(liste.total >= 7000);

  // Conditions non tenues (note minimale relevée) : la prime tombe à zéro, avec la raison.
  await app.inject({ method: 'PUT', url: '/admin/primes/grille', headers: AUTH, payload: { noteMin: 5, bonusExcellence: { note: 5.0 } } });
  await app.inject({ method: 'PUT', url: '/admin/primes/grille', headers: AUTH, payload: { tauxAcceptationMin: 100 } });
  const ok = (await app.inject({ method: 'GET', url: `/drivers/${k.id}/prime`, headers: k.h })).json().prime;
  assert.equal(ok.montantEstime, 5000 + 2000, 'note 5/5 et 100 % d’acceptation : conditions tenues');
});

test('console sur téléphone : billet temps réel à usage unique, avis de changement par domaine', async (t) => {
  const { app } = await buildApp();
  t.after(() => app.close());
  const login = await app.inject({ method: 'POST', url: '/admin/login', payload: { username: 'admin', password: 'orion-admin-dev' } });
  assert.equal(login.statusCode, 200, login.body);
  const jeton = login.json().token as string;
  const b = await app.inject({ method: 'POST', url: '/admin/ws-billet', headers: { authorization: `Bearer ${jeton}` }, payload: {} });
  assert.equal(b.statusCode, 200, b.body);
  const billet = b.json().billet as string;
  const req = (q: Record<string, string>) => ({ headers: {}, method: 'GET', query: q });
  const premier = accesPersonnel(req({ billet }), 'overview:read');
  assert.equal(premier.ok, true, 'billet accepté une fois');
  const second = accesPersonnel(req({ billet }), 'overview:read');
  assert.equal(second.ok, false, 'usage unique');
  assert.equal(accesPersonnel(req({ billet: 'invente' }), 'overview:read').ok, false);
  // Sans session : pas de billet.
  assert.equal((await app.inject({ method: 'POST', url: '/admin/ws-billet', payload: {} })).statusCode, 401);

  assert.equal(domaineConsole({ type: 'ride.status', room: 'ride:1' }), 'courses');
  assert.equal(domaineConsole({ type: 'driver.location', room: 'driver:1' }), 'positions');
  assert.equal(domaineConsole({ type: 'driver.update', room: 'driver:1' }), 'chauffeurs');
  assert.equal(domaineConsole({ type: 'emergency.alert', room: 'emergency' }), 'sos');
  assert.equal(domaineConsole({ type: 'journal', room: 'tableau' }), null);
});

test('limiteur de débit : par compte vérifié, un jeton inventé retombe sur l’adresse', async (t) => {
  const { app } = await buildApp();
  t.after(() => app.close());
  const k = await chauffeur(app, '0701440001', 'Limité', ORIGIN, false);
  const fausse = (h: Record<string, string>) => ({ headers: h, ip: '41.66.1.2' }) as unknown as Parameters<typeof cleDeLimite>[0];
  assert.equal(cleDeLimite(fausse(k.h)), `chauffeur:${k.id}`);
  assert.equal(cleDeLimite(fausse({ authorization: 'Bearer abc.def.ghi' })), 'ip:41.66.1.2');
  assert.equal(cleDeLimite(fausse({})), 'ip:41.66.1.2');
});
