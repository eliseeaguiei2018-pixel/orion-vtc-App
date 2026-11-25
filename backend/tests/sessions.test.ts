import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scryptSync } from 'node:crypto';

/**
 * Cahier des charges — sessions 1 à 7 de la console :
 * SAMU, Support & Chat, Notifications, Courses, Dispatch, Qualité, Mobilité Verte
 * + exigence transversale : tentative d'accès non autorisé signalée à la direction.
 * La config capture process.env au chargement → comptes définis AVANT les imports.
 */
const SALT = 'a1b2c3d4e5f60718';
const HASH = scryptSync('Session#2026', SALT, 32).toString('hex');
process.env.ADMIN_USERS = JSON.stringify([
  { username: 'dg', name: 'Directeur Général', role: 'dg', salt: SALT, hash: HASH },
  { username: 'agent.a', name: 'Agent Aya (SAMU)', role: 'ops', salt: SALT, hash: HASH },
  { username: 'agent.b', name: 'Agent Ben (SAMU)', role: 'ops', salt: SALT, hash: HASH },
  { username: 'agent.sup', name: 'Agent Support', role: 'support', salt: SALT, hash: HASH },
]);

const AUTH = { 'x-admin-token': 'orion-admin-dev' };
type App = { inject: (o: object) => Promise<{ statusCode: number; body: string; rawPayload: Buffer; headers: Record<string, unknown>; json: () => any }> };

async function login(app: App, username: string) {
  const res = await app.inject({ method: 'POST', url: '/admin/login', payload: { username, password: 'Session#2026' } });
  return { authorization: `Bearer ${res.json().token}` };
}

async function newDriver(app: App, name: string, pos = { lat: 5.351, lng: -4.001 }) {
  const id = (await app.inject({ method: 'POST', url: '/drivers', payload: { name, category: 'argent' } })).json().driver.id as string;
  await app.inject({ method: 'POST', url: `/drivers/${id}/online`, payload: { position: pos } });
  return id;
}

async function newRide(app: App, clientId: string, key: string) {
  const est = await app.inject({ method: 'POST', url: '/pricing/estimate', payload: { origin: { lat: 5.35, lng: -4.0 }, destination: { lat: 5.37, lng: -3.98 }, category: 'argent' } });
  const ride = await app.inject({ method: 'POST', url: '/rides', payload: { clientId, lockId: est.json().quote.lockId }, headers: { 'idempotency-key': key } });
  return ride.json().ride as { id: string; status: string; driverId?: string };
}

async function finishAndPay(app: App, rideId: string) {
  for (const to of ['driver_en_route', 'arrived', 'in_progress', 'completed']) {
    await app.inject({ method: 'POST', url: `/rides/${rideId}/transition`, payload: { to } });
  }
  await app.inject({ method: 'POST', url: `/rides/${rideId}/pay`, payload: { method: 'cash' }, headers: { 'idempotency-key': `pay-${rideId}` } });
}

test('transversal : accès non autorisé → refus explicite + signalement direction (DG/CFO/DAA)', async (t) => {
  const { buildApp } = await import('../src/app.js');
  const { app } = await buildApp();
  t.after(() => app.close());

  // Un agent support tente d'accéder à la trésorerie (session interdite).
  const sup = await login(app, 'agent.sup');
  const ko = await app.inject({ method: 'GET', url: '/admin/treasury', headers: sup });
  assert.equal(ko.statusCode, 403);
  assert.match(ko.json().error.message, /sans autorisation de la direction/);
  assert.match(ko.json().error.message, /signalée à la direction/);

  // Clic sur une session verrouillée dans la console → signalement volontaire.
  const clicked = await app.inject({ method: 'POST', url: '/admin/access-denied', headers: sup, payload: { section: 'treasury' } });
  assert.equal(clicked.statusCode, 200);
  assert.equal(clicked.json().reported, true);

  // La direction (DG) voit les DEUX tentatives, nominatives, avec destinataires.
  const dg = await login(app, 'dg');
  const alerts = await app.inject({ method: 'GET', url: '/admin/security-alerts', headers: dg });
  assert.equal(alerts.statusCode, 200);
  const attempts = alerts.json().attempts as Array<{ name: string; role: string; permission?: string; section?: string; notified: string[] }>;
  assert.ok(attempts.length >= 2);
  assert.ok(attempts.every((a) => a.name === 'Agent Support'));
  assert.deepEqual(attempts[0]!.notified, ['DG', 'CFO', 'DAA']);
  assert.ok(attempts.some((a) => a.permission === 'treasury:read'));
  assert.ok(attempts.some((a) => a.section === 'treasury'));

  // …mais la boîte sécurité est elle-même RÉSERVÉE à la direction.
  const koRead = await app.inject({ method: 'GET', url: '/admin/security-alerts', headers: sup });
  assert.equal(koRead.statusCode, 403);
});

test('SAMU : SOS niveau rouge, SLA, prise en charge nominative, chat discret, clôture scellée', async (t) => {
  const { buildApp } = await import('../src/app.js');
  const { app } = await buildApp();
  t.after(() => app.close());

  await newDriver(app, 'SAMU Drv');
  const ride = await newRide(app, 'client-sos', 'sos-1');
  assert.equal(ride.status, 'accepted');

  // Bouton Urgence de l'app → alerte ROUGE dans la file de triage avec chrono SLA.
  const sos = await app.inject({ method: 'POST', url: `/rides/${ride.id}/sos`, payload: { by: 'client', note: 'Comportement inquiétant' } });
  assert.equal(sos.statusCode, 201);
  assert.equal(sos.json().alert.level, 'rouge');
  const triage = await app.inject({ method: 'GET', url: '/admin/sos', headers: AUTH });
  const alert = (triage.json().alerts as Array<{ id: string; level: string; slaSeconds: number }>).find((a) => a.id === sos.json().alert.id)!;
  assert.equal(alert.level, 'rouge');
  assert.equal(typeof alert.slaSeconds, 'number');
  assert.ok((triage.json().presets as string[]).length >= 3, 'messages pré-enregistrés du chat discret');

  // Prise en charge nominative : l'agent A verrouille, l'agent B est refusé (409).
  const a = await login(app, 'agent.a');
  const b = await login(app, 'agent.b');
  const claimA = await app.inject({ method: 'POST', url: `/admin/sos/${alert.id}/claim`, headers: a });
  assert.equal(claimA.statusCode, 200);
  assert.equal(claimA.json().alert.agent, 'Agent Aya (SAMU)');
  const claimB = await app.inject({ method: 'POST', url: `/admin/sos/${alert.id}/claim`, headers: b });
  assert.equal(claimB.statusCode, 409);

  // Chat sécurisé discret : seul l'agent gestionnaire écrit.
  const msgB = await app.inject({ method: 'POST', url: `/admin/sos/${alert.id}/message`, headers: b, payload: { text: 'Êtes-vous en danger ?' } });
  assert.equal(msgB.statusCode, 403);
  const msgA = await app.inject({ method: 'POST', url: `/admin/sos/${alert.id}/message`, headers: a, payload: { text: 'Êtes-vous en danger ? Répondez par Oui ou Non.' } });
  assert.equal(msgA.statusCode, 200);

  // Dossier d'identification instantanée : véhicule, chauffeur, passager, batteries.
  const dossier = await app.inject({ method: 'GET', url: `/admin/sos/${alert.id}`, headers: a });
  assert.equal(dossier.statusCode, 200);
  assert.ok(dossier.json().driver.name);
  assert.equal(typeof dossier.json().passenger.phoneBatteryPct, 'number');
  assert.equal(dossier.json().telemetry.refreshSeconds, 1);

  // Clôture : note trop courte → 400 ; autre agent → 403 ; agent A + note → SCELLÉ.
  const koNote = await app.inject({ method: 'POST', url: `/admin/sos/${alert.id}/close`, headers: a, payload: { note: 'court' } });
  assert.equal(koNote.statusCode, 400);
  const koAgent = await app.inject({ method: 'POST', url: `/admin/sos/${alert.id}/close`, headers: b, payload: { note: 'Tentative de clôture par un autre agent' } });
  assert.equal(koAgent.statusCode, 403);
  const closed = await app.inject({ method: 'POST', url: `/admin/sos/${alert.id}/close`, headers: a, payload: { note: 'Fausse alerte confirmée par le passager, aucune menace. Course reprise normalement.' } });
  assert.equal(closed.statusCode, 200);
  assert.equal(closed.json().alert.sealed, true);

  // Dossier scellé : inaccessible aux niveaux inférieurs, lisible par la direction.
  const koSealed = await app.inject({ method: 'GET', url: `/admin/sos/${alert.id}`, headers: a });
  assert.equal(koSealed.statusCode, 403);
  const okSealed = await app.inject({ method: 'GET', url: `/admin/sos/${alert.id}`, headers: AUTH });
  assert.equal(okSealed.statusCode, 200);

  // Réquisition PDF + export télémétrie CSV (direction).
  const pdf = await app.inject({ method: 'GET', url: `/admin/sos/${alert.id}/report.pdf`, headers: AUTH });
  assert.match(pdf.headers['content-type'] as string, /application\/pdf/);
  assert.equal(pdf.rawPayload.subarray(0, 5).toString(), '%PDF-');
  const csv = await app.inject({ method: 'GET', url: `/admin/sos/${alert.id}/telemetry.csv`, headers: AUTH });
  assert.match(csv.body, /point,lat,lng/);
});

test('Support : priorités, macros, SLA/CSAT, plafond de remboursement, code de dédommagement', async (t) => {
  const { buildApp } = await import('../src/app.js');
  const { app } = await buildApp();
  t.after(() => app.close());

  // Deux tickets : « objet oublié » doit passer DEVANT la question générale.
  await app.inject({ method: 'POST', url: '/support/messages', payload: { clientId: 'cl-1', subject: 'Question générale', text: 'Comment marche le parrainage ?' } });
  const conv2 = (await app.inject({ method: 'POST', url: '/support/messages', payload: { clientId: 'cl-2', subject: 'Objet oublié dans le véhicule', text: 'J’ai oublié mon téléphone' } })).json().conversation;
  const inbox = await app.inject({ method: 'GET', url: '/admin/support', headers: AUTH });
  assert.equal(inbox.json().conversations[0].id, conv2.id, 'priorité 1 (objet oublié) en tête');
  assert.equal(inbox.json().conversations[0].priority, 1);

  // Macros (réponses en un clic) + stats SLA après première réponse agent.
  const macros = await app.inject({ method: 'GET', url: '/admin/support/macros', headers: AUTH });
  assert.ok(macros.json().macros.length >= 4);
  await app.inject({ method: 'POST', url: `/admin/support/${conv2.id}/reply`, headers: AUTH, payload: { text: macros.json().macros[0].text } });
  await app.inject({ method: 'POST', url: `/support/${conv2.id}/csat`, payload: { stars: 5 } });
  const stats = await app.inject({ method: 'GET', url: '/admin/support/stats', headers: AUTH });
  assert.equal(typeof stats.json().avgFirstReplyMin, 'number');
  assert.equal(stats.json().csat, 5);

  // Plafond de remboursement : l'agent support est bloqué au-delà, la direction passe.
  await app.inject({ method: 'PUT', url: '/admin/dispatch', headers: AUTH, payload: { refundCap: 2000 } });
  await newDriver(app, 'Sup Drv');
  const ride = await newRide(app, 'cl-2', 'sup-1');
  const disp = (await app.inject({ method: 'POST', url: `/rides/${ride.id}/dispute`, payload: { clientId: 'cl-2', kind: 'facturation', description: 'Montant contesté' } })).json().dispute;
  const sup = await login(app, 'agent.sup');
  const ko = await app.inject({ method: 'POST', url: `/admin/disputes/${disp.id}/status`, headers: sup, payload: { status: 'resolved', refund: 5000 } });
  assert.equal(ko.statusCode, 403, 'au-delà du plafond → escalade superviseur');
  const okSmall = await app.inject({ method: 'POST', url: `/admin/disputes/${disp.id}/status`, headers: sup, payload: { status: 'investigating' } });
  assert.equal(okSmall.statusCode, 200);
  const okExec = await app.inject({ method: 'POST', url: `/admin/disputes/${disp.id}/status`, headers: AUTH, payload: { status: 'resolved', refund: 5000 } });
  assert.equal(okExec.statusCode, 200);

  // Code promotionnel personnalisé de dédommagement (usage unique, expirant).
  const comp = await app.inject({ method: 'POST', url: '/admin/promos/compensation', headers: AUTH, payload: { clientId: 'cl-2', percent: 20, days: 7 } });
  assert.equal(comp.statusCode, 200);
  assert.equal(comp.json().promo.maxUses, 1);
  assert.equal(comp.json().promo.value, 20);
  assert.ok(comp.json().promo.expiresAt);
});

test('Notifications : canaux + segments + stats de campagne + déclencheurs automatisés', async (t) => {
  const { buildApp } = await import('../src/app.js');
  const { app } = await buildApp();
  t.after(() => app.close());

  // Campagne e-mail ciblée VIP avec balises de personnalisation → stats simulées.
  const b = await app.inject({ method: 'POST', url: '/admin/broadcast', headers: AUTH, payload: {
    audience: 'clients', channel: 'email', segment: 'vip',
    title: 'Bilan carbone mensuel', body: 'Bonjour [Prénom], voici votre impact vert du mois.',
  } });
  assert.equal(b.statusCode, 200);
  assert.equal(b.json().announcement.channel, 'email');
  assert.ok(b.json().announcement.stats, 'stats de campagne présentes');

  // Trigger batterie : chauffeur électrique à 10 % → borne recommandée + envoi auto.
  const drv = await newDriver(app, 'Batterie Faible');
  await app.inject({ method: 'POST', url: `/drivers/${drv}/telemetry`, payload: { engine: 'electric', batteryPct: 10, batteryHealthPct: 91 } });
  const trig = await app.inject({ method: 'GET', url: '/admin/notify/triggers', headers: AUTH });
  const low = trig.json().lowBattery as Array<{ id: string; station: string | null }>;
  assert.ok(low.some((d) => d.id === drv));
  assert.ok(low.find((d) => d.id === drv)!.station, 'borne partenaire recommandée');
  assert.equal(typeof trig.json().offPeak.bonus, 'number');
  const run = await app.inject({ method: 'POST', url: '/admin/notify/triggers/run', headers: AUTH, payload: { trigger: 'battery' } });
  assert.ok(run.json().sent >= 1);

  // Win-back : la campagne génère un code court RETOUR-xxxx (15 %, 7 jours).
  const winApp = await app.inject({ method: 'POST', url: '/admin/notify/triggers/run', headers: AUTH, payload: { trigger: 'winback' } });
  assert.equal(winApp.statusCode, 200);
  assert.match(winApp.json().code, /^RETOUR-/);
});

test('Courses : anomalies, clôture forcée, destination en vol, réservations + ponctualité', async (t) => {
  const { buildApp } = await import('../src/app.js');
  const { app } = await buildApp();
  t.after(() => app.close());

  await newDriver(app, 'Ops Drv 1');
  const r1 = await newRide(app, 'cl-ops', 'ops-1');
  assert.equal(r1.status, 'accepted');

  // Destination en vol : devis recalculé instantanément (événement tracé).
  const before = (await app.inject({ method: 'GET', url: `/admin/rides/${r1.id}`, headers: AUTH })).json().ride.quote.amount as number;
  const dest = await app.inject({ method: 'PUT', url: `/admin/rides/${r1.id}/destination`, headers: AUTH, payload: { lat: 5.42, lng: -3.93 } });
  assert.equal(dest.statusCode, 200);
  assert.ok(dest.json().ride.amount > before, 'destination plus lointaine → devis recalculé à la hausse');

  // Clôture forcée (bug réseau) : la course se termine, le chauffeur est libéré.
  const forced = await app.inject({ method: 'POST', url: `/admin/rides/${r1.id}/force`, headers: AUTH, payload: { action: 'complete' } });
  assert.equal(forced.json().ride.status, 'completed');
  const again = await app.inject({ method: 'POST', url: `/admin/rides/${r1.id}/force`, headers: AUTH, payload: { action: 'cancel' } });
  assert.equal(again.statusCode, 409, 'course déjà terminée');

  // La liste des courses expose le drapeau d'anomalie (peut être null).
  const list = await app.inject({ method: 'GET', url: '/admin/rides', headers: AUTH });
  assert.ok('anomaly' in list.json().rides[0]);

  // Réservations : trop tôt → 400 ; valide → calendrier console + assignation.
  const soon = await app.inject({ method: 'POST', url: '/reservations', payload: {
    clientId: 'cl-res', origin: { lat: 5.35, lng: -4.0 }, destination: { lat: 5.26, lng: -3.93 },
    category: 'argent', scheduledFor: new Date(Date.now() + 5 * 60_000).toISOString(),
  } });
  assert.equal(soon.statusCode, 400);
  const res = await app.inject({ method: 'POST', url: '/reservations', payload: {
    clientId: 'cl-res', origin: { lat: 5.35, lng: -4.0 }, destination: { lat: 5.26, lng: -3.93 },
    category: 'argent', scheduledFor: new Date(Date.now() + 2 * 3_600_000).toISOString(),
  } });
  assert.equal(res.statusCode, 201);
  const cal = await app.inject({ method: 'GET', url: '/admin/reservations', headers: AUTH });
  const row = (cal.json().reservations as Array<{ id: string; punctualityAlert: boolean; minutesToGo: number }>).find((x) => x.id === res.json().reservation.id)!;
  assert.equal(row.punctualityAlert, false, 'pas d’alerte à H-120');
  const assign = await app.inject({ method: 'POST', url: `/admin/reservations/${row.id}/assign`, headers: AUTH, payload: {} });
  assert.equal(assign.statusCode, 200);
  assert.equal(assign.json().reservation.status, 'assignee');
});

test('Dispatch : rayons/pondération/broadcast pilotables, surge manuel de zone, shadow mode, exports', async (t) => {
  const { buildApp } = await import('../src/app.js');
  const { app } = await buildApp();
  t.after(() => app.close());

  // Nouveaux réglages persistés et clampés.
  const put = await app.inject({ method: 'PUT', url: '/admin/dispatch', headers: AUTH, payload: {
    radiusKm: 2, radiusMaxKm: 10, offerMode: 'broadcast', weightRating: 5, weightIdle: 3,
    greenPriority: true, surgeThreshold: 1.5, surgeSmoothingMin: 15, offPeakBonus: 750,
  } });
  assert.equal(put.statusCode, 200);
  const ops = (await app.inject({ method: 'GET', url: '/admin/dispatch', headers: AUTH })).json().ops;
  assert.equal(ops.radiusMaxKm, 10);
  assert.equal(ops.offerMode, 'broadcast');
  assert.equal(ops.weightRating, 5);
  assert.equal(ops.greenPriority, true);

  // Pondération note : à distances comparables, le 4.9 bat le 4.2 plus proche.
  const { buildApp: build2 } = await import('../src/app.js');
  const { app: app2, container: c2 } = await build2();
  t.after(() => app2.close());
  await app2.inject({ method: 'PUT', url: '/admin/dispatch', headers: AUTH, payload: { weightRating: 8 } });
  const far = await newDriver(app2 as unknown as App, 'Note 4.9', { lat: 5.362, lng: -4.0 });   // ~1.3 km
  const near = await newDriver(app2 as unknown as App, 'Note 4.2', { lat: 5.353, lng: -4.0 });  // ~0.3 km
  const dFar = c2.drivers.get(far)!; dFar.ratingAvg = 4.9; dFar.ratingCount = 100;
  const dNear = c2.drivers.get(near)!; dNear.ratingAvg = 4.2; dNear.ratingCount = 100;
  const ride = await newRide(app2 as unknown as App, 'cl-score', 'score-1');
  assert.equal(ride.driverId, far, 'le mieux noté l’emporte malgré la distance');

  // Surge MANUEL de zone : le devis au départ de la zone monte (plafonné cap vert).
  const zone = await app.inject({ method: 'PUT', url: '/admin/zones', headers: AUTH, payload: {
    id: 'stade-ebimpe', name: 'Stade (événement)', factor: 1, lat: 5.35, lng: -4.0, radiusKm: 2, surgeManual: 1.25,
  } });
  assert.equal(zone.statusCode, 200);
  const est = await app.inject({ method: 'POST', url: '/pricing/estimate', payload: { origin: { lat: 5.35, lng: -4.0 }, destination: { lat: 5.37, lng: -3.98 }, category: 'argent' } });
  assert.equal(est.json().quote.breakdown.surge, 1.25);

  // Shadow mode + documentation PDF + matrice tarifaire CSV.
  const sim = await app.inject({ method: 'POST', url: '/admin/dispatch/simulate', headers: AUTH, payload: { maxEtaMinutes: 15, radiusMaxKm: 12 } });
  assert.equal(typeof sim.json().current.matchRate, 'number');
  assert.equal(typeof sim.json().proposed.matchRate, 'number');
  const pdf = await app.inject({ method: 'GET', url: '/admin/dispatch/config.pdf', headers: AUTH });
  assert.equal(pdf.rawPayload.subarray(0, 5).toString(), '%PDF-');
  const matrix = await app.inject({ method: 'GET', url: '/admin/pricing/matrix.csv', headers: AUTH });
  assert.match(matrix.body, /zone,facteur_zone/);
});

test('Qualité & Verte : désappariement 1★, mots sensibles → blocage préventif, CSAT, VIP, points carbone, ESG', async (t) => {
  const { buildApp } = await import('../src/app.js');
  const { app, container } = await buildApp();
  t.after(() => app.close());

  const drv = await newDriver(app, 'Qualité Drv');
  const ride = await newRide(app, 'cl-q', 'q-1');
  await finishAndPay(app, ride.id);

  // Points Carbone : crédités au passager après paiement d'une course électrique.
  assert.ok((container.clients.get('cl-q')?.greenPoints ?? 0) >= 1, 'points carbone crédités');

  // Note 1★ + mot sensible : désappariement DÉFINITIF + blocage préventif + alerte sécurité.
  const rate = await app.inject({ method: 'POST', url: `/rides/${ride.id}/rate`, payload: { stars: 1, comment: 'Conduite dangereuse, odeur d’alcool dans le véhicule' } });
  assert.equal(rate.statusCode, 200);
  assert.equal(container.matching.isBlockedPair('cl-q', drv), true, 'paire client|chauffeur désappariée');
  assert.equal(container.drivers.get(drv)?.kycStatus, 'suspended', 'blocage préventif le temps de l’investigation');
  const triage = await app.inject({ method: 'GET', url: '/admin/sos', headers: AUTH });
  assert.ok((triage.json().alerts as Array<{ kind: string }>).some((a) => a.kind === 'mot_sensible'), 'alerte priorité absolue');

  // CSAT 7 jours + taux d'acceptation / d'annulation.
  const csat = await app.inject({ method: 'GET', url: '/admin/quality/csat', headers: AUTH });
  assert.equal(csat.json().series.length, 7);
  assert.equal(typeof csat.json().acceptRate, 'number');

  // VIP / Top Driver + matrice Excel + fiche PDF.
  const vip = await app.inject({ method: 'POST', url: `/admin/drivers/${drv}/vip`, headers: AUTH, payload: { vip: true } });
  assert.equal(vip.json().driver.vip, true);
  const q = await app.inject({ method: 'GET', url: '/admin/quality', headers: AUTH });
  assert.ok(Array.isArray(q.json().top), 'top 5 % exposé');
  const qcsv = await app.inject({ method: 'GET', url: '/admin/quality.csv', headers: AUTH });
  assert.match(qcsv.body, /matricule,nom/);
  const qpdf = await app.inject({ method: 'GET', url: `/admin/drivers/${drv}/quality.pdf`, headers: AUTH });
  assert.equal(qpdf.rawPayload.subarray(0, 5).toString(), '%PDF-');

  // Mobilité verte : SoH suivi, export énergie, rapport ESG B2B.
  await app.inject({ method: 'POST', url: `/drivers/${drv}/telemetry`, payload: { batteryPct: 60, batteryHealthPct: 88 } });
  const green = await app.inject({ method: 'GET', url: '/admin/green', headers: AUTH });
  assert.equal(green.json().fleet.avgSoh, 88);
  assert.ok(Array.isArray(green.json().topGreenClients));
  const energy = await app.inject({ method: 'GET', url: '/admin/green/energy.csv', headers: AUTH });
  assert.match(energy.body, /kwh_estimes/);
  await app.inject({ method: 'PUT', url: '/admin/corporate', headers: AUTH, payload: { id: 'sodeci', name: 'SODECI', creditLimit: 100000 } });
  const esg = await app.inject({ method: 'GET', url: '/admin/corporate/sodeci/esg.pdf', headers: AUTH });
  assert.equal(esg.rawPayload.subarray(0, 5).toString(), '%PDF-');
});
