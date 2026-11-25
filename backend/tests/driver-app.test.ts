import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { FastifyInstance } from 'fastify';

/**
 * Socle APP CHAUFFEUR : connexion par code SMS, jeton chauffeur, garde-fous de mise en
 * ligne, configuration flotte synchronisée avec la console (HTTP + WebSocket), affectation
 * poussée en direct, historique / gains, dette espèces et son plafond.
 */
const AUTH = { 'x-admin-token': 'orion-admin-dev' };
// Plateau : secteur sans bonus chauffeur (calculs de gains exacts).
const POS = { lat: 5.336, lng: -4.031 };
const ORIGIN = { lat: 5.335, lng: -4.03 };
const DEST = { lat: 5.345, lng: -4.02 };

async function login(app: FastifyInstance, phone: string, name?: string) {
  const otp = await app.inject({ method: 'POST', url: '/drivers/auth/otp', payload: { phone } });
  assert.equal(otp.statusCode, 200, otp.body);
  const code = otp.json().devCode as string;
  assert.match(code, /^\d{6}$/, 'code renvoyé en développement');
  const v = await app.inject({ method: 'POST', url: '/drivers/auth/verify', payload: { phone, code, name } });
  assert.ok(v.statusCode === 200 || v.statusCode === 201, v.body);
  const body = v.json() as { token: string; created: boolean; driver: { id: string; kycStatus: string; phone: string } };
  return { ...body, headers: { authorization: `Bearer ${body.token}` } };
}

async function approve(app: FastifyInstance, id: string) {
  const r = await app.inject({ method: 'POST', url: `/admin/drivers/${id}/kyc`, headers: AUTH, payload: { status: 'active' } });
  assert.equal(r.statusCode, 200, r.body);
}

async function order(app: FastifyInstance, key: string, paymentMethod?: string) {
  const est = await app.inject({ method: 'POST', url: '/pricing/estimate', payload: { origin: ORIGIN, destination: DEST, category: 'argent' } });
  const r = await app.inject({ method: 'POST', url: '/rides', headers: { 'idempotency-key': key }, payload: { clientId: `client-${key}`, lockId: est.json().quote.lockId, paymentMethod } });
  assert.equal(r.statusCode, 201, r.body);
  return { ...r.json().ride, code: r.json().codePriseEnCharge } as { id: string; status: string; driverId?: string; paymentMethod?: string; code: string };
}

test('Connexion : inscription par code SMS, reconnexion, code faux, anti-spam', async (t) => {
  const { buildApp } = await import('../src/app.js');
  const { app } = await buildApp();
  t.after(() => app.close());

  // Nouveau numéro sans nom → refus explicite (inscription = nom obligatoire).
  const o = await app.inject({ method: 'POST', url: '/drivers/auth/otp', payload: { phone: '07 08 09 10 11' } });
  assert.equal(o.json().registered, false);
  assert.equal(o.json().phone, '+2250708091011', 'numéro normalisé (indicatif CI)');
  const noName = await app.inject({ method: 'POST', url: '/drivers/auth/verify', payload: { phone: '0708091011', code: o.json().devCode } });
  assert.equal(noName.statusCode, 400);

  // Renvoi immédiat refusé (anti-spam SMS).
  const again = await app.inject({ method: 'POST', url: '/drivers/auth/otp', payload: { phone: '0708091011' } });
  assert.equal(again.statusCode, 429);

  // Code faux → 401.
  const ko = await app.inject({ method: 'POST', url: '/drivers/auth/verify', payload: { phone: '0708091011', code: '000000', name: 'Koffi' } });
  assert.equal(ko.statusCode, 401);

  // Inscription d'un autre numéro → dossier en brouillon, matricule ORION, téléphone enregistré.
  const s = await login(app, '0102030405', 'Koffi N’Guessan');
  assert.equal(s.created, true);
  assert.equal(s.driver.kycStatus, 'draft');
  assert.equal(s.driver.phone, '+2250102030405');

  // Reprise de session : /drivers/me avec le jeton.
  const me = await app.inject({ method: 'GET', url: '/drivers/me', headers: s.headers });
  assert.equal(me.statusCode, 200);
  assert.equal(me.json().driver.id, s.driver.id);
  assert.equal(typeof me.json().finance.commissionRate, 'number');
  assert.equal((await app.inject({ method: 'GET', url: '/drivers/me' })).statusCode, 401);

  // Le jeton chauffeur n'ouvre JAMAIS la console (secret distinct).
  const adm = await app.inject({ method: 'GET', url: '/admin/drivers', headers: s.headers });
  assert.ok(adm.statusCode === 401 || adm.statusCode === 403, `console refusée (${adm.statusCode})`);
});

test('Dossier : soumission complète exigée, zones à forte demande', async (t) => {
  const { buildApp } = await import('../src/app.js');
  const { app } = await buildApp();
  t.after(() => app.close());
  const s = await login(app, '0177777777', 'Serge Aka');
  const submit = () => app.inject({ method: 'POST', url: `/drivers/${s.driver.id}/kyc/submit`, headers: s.headers });

  const ko = await submit();
  assert.equal(ko.statusCode, 400);
  assert.ok((ko.json().error.details.missing as string[]).includes('numéro de permis'));

  // Chauffeur salarié : seules ses informations personnelles sont demandées. Le véhicule, la
  // gamme et l'assurance sont attribués par ORION (console), jamais saisis par le chauffeur.
  assert.equal((ko.json().error.details.missing as string[]).some((m) => /véhicule|immatriculation|assurance/.test(m)), false);
  await app.inject({ method: 'POST', url: `/drivers/${s.driver.id}/profile`, headers: s.headers, payload: {
    birthDate: '1990-04-12', licenseNo: 'CI-AB-12345',
  } });
  const ok = await submit();
  assert.equal(ok.statusCode, 200, ok.body);
  assert.equal(ok.json().driver.kycStatus, 'docs_submitted');

  // Une fois validé par la console, plus de re-soumission.
  await approve(app, s.driver.id);
  assert.equal((await submit()).statusCode, 400);

  // Carte de chaleur : un devis compte comme une demande dans sa cellule.
  await app.inject({ method: 'POST', url: '/pricing/estimate', payload: { origin: ORIGIN, destination: DEST, category: 'argent' } });
  const heat = (await app.inject({ method: 'GET', url: '/drivers/demand' })).json();
  assert.ok(heat.cells.length >= 1);
  assert.equal(typeof heat.cells[0].demand, 'number');
});

test('Jeton chauffeur : chacun ses données ; routes existantes compatibles sans jeton', async (t) => {
  const { buildApp } = await import('../src/app.js');
  const { app } = await buildApp();
  t.after(() => app.close());
  const a = await login(app, '0111111111', 'Chauffeur A');
  const b = await login(app, '0122222222', 'Chauffeur B');

  // Nouvelles routes personnelles : jeton obligatoire et propriétaire uniquement.
  assert.equal((await app.inject({ method: 'GET', url: `/drivers/${a.driver.id}/rides` })).statusCode, 401);
  assert.equal((await app.inject({ method: 'GET', url: `/drivers/${a.driver.id}/rides`, headers: b.headers })).statusCode, 403);
  assert.equal((await app.inject({ method: 'GET', url: `/drivers/${a.driver.id}/rides`, headers: a.headers })).statusCode, 200);

  // Routes existantes : sans jeton → inchangées (compatibilité) ; jeton d'un autre → 403.
  assert.equal((await app.inject({ method: 'GET', url: `/drivers/${a.driver.id}/wallet` })).statusCode, 200);
  assert.equal((await app.inject({ method: 'GET', url: `/drivers/${a.driver.id}/wallet`, headers: b.headers })).statusCode, 403);
  const pay = await app.inject({ method: 'POST', url: `/drivers/${a.driver.id}/payout`, headers: b.headers, payload: { amount: 100 } });
  assert.equal(pay.statusCode, 403, 'retrait impossible avec le jeton d’un autre chauffeur');
});

test('Mise en ligne : dossier validé exigé (app), suspension motivée, ORION fermé', async (t) => {
  const { buildApp } = await import('../src/app.js');
  const { app } = await buildApp();
  t.after(() => app.close());
  const s = await login(app, '0133333333', 'Awa Bamba');
  const url = `/drivers/${s.driver.id}/online`;

  // Brouillon : refus depuis l'app.
  const draft = await app.inject({ method: 'POST', url, headers: s.headers, payload: { position: POS } });
  assert.equal(draft.statusCode, 403);
  assert.match(draft.json().error.message, /validation/);

  // La console valide le dossier → mise en ligne acceptée.
  await approve(app, s.driver.id);
  const ok = await app.inject({ method: 'POST', url, headers: s.headers, payload: { position: POS } });
  assert.equal(ok.statusCode, 200);

  // ORION fermé (maintenance console) → refus.
  await app.inject({ method: 'PUT', url: '/admin/services', headers: AUTH, payload: { open: false } });
  const closed = await app.inject({ method: 'POST', url, headers: s.headers, payload: { position: POS } });
  assert.equal(closed.statusCode, 409);
  await app.inject({ method: 'PUT', url: '/admin/services', headers: AUTH, payload: { open: true } });

  // Suspension motivée → hors ligne + refus avec le motif, même sans jeton.
  await app.inject({ method: 'POST', url: `/admin/drivers/${s.driver.id}/kyc`, headers: AUTH, payload: { status: 'suspended', reason: 'Assurance expirée' } });
  const susp = await app.inject({ method: 'POST', url, payload: { position: POS } });
  assert.equal(susp.statusCode, 403);
  assert.match(susp.json().error.message, /Assurance expirée/);
});

test('Synchro console → app chauffeur en temps réel (WS /ws/drivers/:id)', async (t) => {
  const { buildApp } = await import('../src/app.js');
  const { app } = await buildApp();
  await app.listen({ port: 0, host: '127.0.0.1' });
  const { port } = app.server.address() as { port: number };
  const s = await login(app, '0144444444', 'Ismaël Koné');

  // Jeton invalide → trame d'erreur puis fermeture.
  const bad = new WebSocket(`ws://127.0.0.1:${port}/ws/drivers/${s.driver.id}?token=faux`);
  const badFrame = await new Promise<{ type: string }>((r) => bad.addEventListener('message', (ev) => r(JSON.parse(String(ev.data))), { once: true }));
  assert.equal(badFrame.type, 'error');

  type Frame = { type: string; data?: Record<string, unknown>; [k: string]: unknown };
  const frames: Frame[] = [];
  const ws = new WebSocket(`ws://127.0.0.1:${port}/ws/drivers/${s.driver.id}?token=${s.token}`);
  t.after(async () => { ws.close(); bad.close(); await app.close(); });
  ws.addEventListener('message', (ev) => frames.push(JSON.parse(String(ev.data)) as Frame));
  const waitFor = async (pred: (f: Frame) => boolean, label: string) => {
    for (let i = 0; i < 60; i++) {
      const f = frames.find(pred);
      if (f) return f;
      await new Promise((r) => setTimeout(r, 50));
    }
    assert.fail(`trame attendue non reçue : ${label}`);
  };

  // 1) État initial complet à la connexion (même forme que GET /config et /drivers/config).
  const hello = await waitFor((f) => f.type === 'connected', 'connected');
  const http = (await app.inject({ method: 'GET', url: '/drivers/config' })).json();
  assert.deepEqual(hello['driverConfig'], http);
  assert.equal((hello['driverConfig'] as { offer: { timeoutSec: number } }).offer.timeoutSec, 12);
  assert.equal((hello['config'] as { open: boolean }).open, true);
  assert.equal(hello['activeRide'], null);

  // 2) La console change le délai d'offre et la commission verte → diffusion immédiate.
  await app.inject({ method: 'PUT', url: '/admin/dispatch', headers: AUTH, payload: { offerTimeoutSec: 14, commissionGreen: 0.1 } });
  await waitFor((f) => f.type === 'driver-config.update'
    && (f.data as { offer?: { timeoutSec: number } }).offer?.timeoutSec === 14
    && (f.data as { commission?: { green: number } }).commission?.green === 0.1, 'driver-config.update');

  // 3) La console valide le dossier → fiche poussée en direct.
  await approve(app, s.driver.id);
  await waitFor((f) => f.type === 'driver.update' && (f.data as { driver: { kycStatus: string } }).driver.kycStatus === 'active', 'KYC validé');

  // 4) Maintenance ORION → même trame que l'app cliente (`config.update`).
  await app.inject({ method: 'PUT', url: '/admin/services', headers: AUTH, payload: { open: false } });
  await waitFor((f) => f.type === 'config.update' && (f.data as { open: boolean }).open === false, 'maintenance');
  await app.inject({ method: 'PUT', url: '/admin/services', headers: AUTH, payload: { open: true } });

  // 5) Affectation d'une course → poussée sur le canal du chauffeur.
  await app.inject({ method: 'POST', url: `/drivers/${s.driver.id}/online`, headers: s.headers, payload: { position: POS } });
  const ride = await order(app, 'ws-1', 'wave');
  assert.equal(ride.driverId, s.driver.id);
  const assigned = await waitFor((f) => f.type === 'ride.assigned', 'ride.assigned');
  const view = (assigned.data as { ride: { id: string; paymentMethod: string } }).ride;
  assert.equal(view.id, ride.id);
  assert.equal(view.paymentMethod, 'wave', 'moyen de paiement annoncé visible du chauffeur');

  // 6) Suspension motivée en direct.
  await app.inject({ method: 'POST', url: `/admin/drivers/${s.driver.id}/warn`, headers: AUTH });
  await waitFor((f) => f.type === 'driver.update' && (f.data as { driver: { warnings?: number } }).driver.warnings === 1, 'avertissement');
});

test('Course, espèces et gains : dette espèces, plafond console, historique', async (t) => {
  const { buildApp } = await import('../src/app.js');
  const { app, container } = await buildApp();
  t.after(() => app.close());
  const s = await login(app, '0155555555', 'Grace Kouassi');
  await approve(app, s.driver.id);
  await app.inject({ method: 'POST', url: `/drivers/${s.driver.id}/online`, headers: s.headers, payload: { position: POS } });

  const ride = await order(app, 'cash-1', 'cash');
  assert.equal(ride.driverId, s.driver.id);

  // Course en cours récupérable (reprise de l'app).
  const active = await app.inject({ method: 'GET', url: `/drivers/${s.driver.id}/active-ride`, headers: s.headers });
  assert.equal(active.json().ride.id, ride.id);
  assert.equal(active.json().ride.paymentMethod, 'cash');

  // Le chauffeur fait avancer la course avec SON jeton (routes existantes).
  // Le démarrage passe par le code que le passager donne au chauffeur.
  for (const to of ['driver_en_route', 'arrived', 'in_progress', 'completed']) {
    const r = to === 'in_progress'
      ? await app.inject({ method: 'POST', url: `/rides/${ride.id}/start`, headers: s.headers, payload: { code: ride.code } })
      : await app.inject({ method: 'POST', url: `/rides/${ride.id}/transition`, headers: s.headers, payload: { to } });
    assert.equal(r.statusCode, 200, `transition ${to} : ${r.body}`);
  }
  const pay = await app.inject({ method: 'POST', url: `/rides/${ride.id}/pay`, headers: { 'idempotency-key': 'pay-cash-1' }, payload: { method: 'cash' } });
  assert.equal(pay.statusCode, 200);
  const { commission, gross } = pay.json().commission as { commission: number; gross: number };

  // Historique + totaux du jour.
  const hist = (await app.inject({ method: 'GET', url: `/drivers/${s.driver.id}/rides`, headers: s.headers })).json();
  const bonus = hist.rides[0].earnings.bonus as number;
  assert.equal(bonus, 0, 'secteur sans bonus');

  // Espèces : le chauffeur a l'argent en main → il doit la commission (solde négatif).
  const finance = (await app.inject({ method: 'GET', url: '/drivers/me', headers: s.headers })).json().finance;
  assert.equal(finance.balance, -commission);
  assert.equal(finance.cashDebt, commission);
  assert.equal(finance.cashBlocked, false);

  assert.equal(hist.rides[0].id, ride.id);
  assert.equal(hist.rides[0].earnings.cashCollected, gross);
  assert.equal(hist.today.rides, 1);
  assert.equal(hist.today.gross, gross);
  assert.equal(hist.today.commission, commission);
  assert.equal((await app.inject({ method: 'GET', url: `/drivers/${s.driver.id}/active-ride`, headers: s.headers })).json().ride, null);

  // Plafond console abaissé sous la dette → plus de course espèces, mais mobile money OK.
  await app.inject({ method: 'PUT', url: '/admin/dispatch', headers: AUTH, payload: { cashDebtLimit: Math.max(0, commission - 1) } });
  assert.equal((await app.inject({ method: 'GET', url: '/drivers/me', headers: s.headers })).json().finance.cashBlocked, true);
  const cashRide = await order(app, 'cash-2', 'cash');
  assert.equal(cashRide.status, 'no_driver', 'course espèces refusée au chauffeur endetté');
  const waveRide = await order(app, 'wave-2', 'wave');
  assert.equal(waveRide.driverId, s.driver.id, 'course mobile money toujours attribuée');

  // Un autre chauffeur ne peut pas piloter cette course.
  const other = await login(app, '0166666666', 'Autre');
  const steal = await app.inject({ method: 'POST', url: `/rides/${waveRide.id}/transition`, headers: other.headers, payload: { to: 'driver_en_route' } });
  assert.equal(steal.statusCode, 403);
  void container;
});
