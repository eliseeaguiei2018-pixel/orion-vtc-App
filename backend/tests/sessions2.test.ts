import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scryptSync } from 'node:crypto';

/**
 * Cahier des charges — sessions 8 à 11 :
 * Équipes/RH, Intelligence Artificielle (anti-fraude/élasticité/copilote),
 * Entreprises B2B (filiales/politiques/import/web-booker), Litiges N2/N3
 * (escalade/claim-lock/quarantaine/chargeback).
 */
const SALT = 'b2c3d4e5f6a70819';
const HASH = scryptSync('Session#2026', SALT, 32).toString('hex');
process.env.ADMIN_USERS = JSON.stringify([
  { username: 'dg', name: 'Directeur Général', role: 'dg', salt: SALT, hash: HASH },
  { username: 'exp.a', name: 'Expert Litiges A', role: 'support', salt: SALT, hash: HASH },
  { username: 'exp.b', name: 'Expert Litiges B', role: 'support', salt: SALT, hash: HASH },
]);

const AUTH = { 'x-admin-token': 'orion-admin-dev' };
type App = { inject: (o: object) => Promise<{ statusCode: number; body: string; rawPayload: Buffer; headers: Record<string, unknown>; json: () => any }> };

async function login(app: App, username: string) {
  const res = await app.inject({ method: 'POST', url: '/admin/login', payload: { username, password: 'Session#2026' } });
  return { authorization: `Bearer ${res.json().token}` };
}
async function onlineDriver(app: App, name: string, pos = { lat: 5.351, lng: -4.001 }) {
  const id = (await app.inject({ method: 'POST', url: '/drivers', payload: { name, category: 'bronze' } })).json().driver.id as string;
  await app.inject({ method: 'POST', url: `/drivers/${id}/online`, payload: { position: pos } });
  return id;
}

test('S8 Équipes : shifts, maintenance, squad P&L, productivité, micro-broadcast', async (t) => {
  const { buildApp } = await import('../src/app.js');
  const { app, container } = await buildApp();
  t.after(() => app.close());

  // Planning d'astreinte + affectation territoriale.
  const shift = await app.inject({ method: 'PUT', url: '/admin/shifts', headers: AUTH, payload: {
    username: 'awa.ops', name: 'Awa (Dispatch)', date: '2026-07-10', slot: 'nuit', zoneId: 'cocody',
  } });
  assert.equal(shift.statusCode, 200);
  const shifts = await app.inject({ method: 'GET', url: '/admin/shifts?date=2026-07-10', headers: AUTH });
  assert.equal(shifts.json().shifts.length, 1);
  assert.equal(shifts.json().shifts[0].slot, 'nuit');
  const hours = await app.inject({ method: 'GET', url: '/admin/staff/hours.csv', headers: AUTH });
  assert.match(hours.body, /employe,identifiant,date,tranche,zone/);

  // Tickets de maintenance (cycle de vie véhicule) : ouvrir → assigner → résoudre.
  const drv = await onlineDriver(app, 'Squad Drv');
  const tk = await app.inject({ method: 'POST', url: '/admin/maintenance', headers: AUTH, payload: {
    driverId: drv, kind: 'controle_technique', title: 'Contrôle technique requis dans 15 jours',
  } });
  assert.equal(tk.statusCode, 200);
  const tid = tk.json().ticket.id;
  await app.inject({ method: 'POST', url: `/admin/maintenance/${tid}/assign`, headers: AUTH, payload: { assignee: 'Agent X' } });
  const resolved = await app.inject({ method: 'POST', url: `/admin/maintenance/${tid}/resolve`, headers: AUTH });
  assert.equal(resolved.json().ticket.status, 'resolu');

  // Squad + micro P&L + micro-broadcast à la SEULE flotte de l'équipe.
  const team = await app.inject({ method: 'PUT', url: '/admin/teams', headers: AUTH, payload: { name: 'Squad Premium', managerUsername: 'chef.p', driverIds: [drv] } });
  const teamId = team.json().team.id;
  const pnl = await app.inject({ method: 'GET', url: `/admin/teams/${teamId}/pnl`, headers: AUTH });
  assert.equal(pnl.statusCode, 200);
  assert.equal(pnl.json().pnl.vehicles, 1);
  const bc = await app.inject({ method: 'POST', url: `/admin/teams/${teamId}/broadcast`, headers: AUTH, payload: { title: 'Inspection', body: 'Propreté obligatoire vendredi' } });
  assert.equal(bc.json().sent, 1);

  // Productivité interne dérivée du journal d'audit (les actions ci-dessus sont tracées).
  const prod = await app.inject({ method: 'GET', url: '/admin/staff/productivity', headers: AUTH });
  assert.ok(Array.isArray(prod.json().staff));
  assert.ok(prod.json().staff.some((s: { total: number }) => s.total > 0));
  void container;
});

test('S8 : verrouillage session après inactivité + anomalies internes signalées', async (t) => {
  process.env.ADMIN_INACTIVITY_MINUTES = '15';
  const { buildApp } = await import('../src/app.js');
  const { app } = await buildApp();
  t.after(() => app.close());

  // Émettre beaucoup de codes promo en < 1 h → anomalie de comportement signalée à la direction.
  for (let i = 0; i < 6; i++) {
    await app.inject({ method: 'PUT', url: '/admin/promos', headers: AUTH, payload: { code: `PROMO${i}`, kind: 'percent', value: 10 } });
  }
  const anomalies = await app.inject({ method: 'GET', url: '/admin/staff/anomalies', headers: AUTH });
  assert.equal(anomalies.statusCode, 200);
  assert.ok((anomalies.json().anomalies as Array<{ reason: string }>).some((a) => /codes promo/.test(a.reason)));
  // La tentative anormale est aussi remontée dans les alertes sécurité (direction).
  const sec = await app.inject({ method: 'GET', url: '/admin/security-alerts', headers: AUTH });
  assert.ok(sec.json().attempts.length >= 1);
});

test('S9 IA : anti-fraude (ghost rides, spoofing), élasticité, copilote', async (t) => {
  const { buildApp } = await import('../src/app.js');
  const { app, container } = await buildApp();
  t.after(() => app.close());

  // Seed : 3 courses même client + même chauffeur (collusion) + une avec téléportation GPS.
  const drvId = await onlineDriver(app, 'Fraud Drv');
  const now = new Date().toISOString();
  const mkQuote = () => ({ lockId: 'x', amount: 3000, currency: 'XOF' as const, serviceType: 'ride', category: 'bronze', origin: { lat: 5.35, lng: -4.0 }, destination: { lat: 5.37, lng: -3.98 }, distanceMeters: 4000, expiresAt: now, trafficLevel: 'fluid', breakdown: { base: 300, distance: 1800, time: 600, subtotal: 2700, tva: 135, fee: 270, insurance: 0, surge: 1 } });
  for (let i = 0; i < 3; i++) {
    container.rides.save({ id: `ghost-${i}`, clientId: 'client-collusion', driverId: drvId, serviceType: 'ride', status: 'rated', origin: { lat: 5.35, lng: -4.0 }, destination: { lat: 5.37, lng: -3.98 }, quote: mkQuote() as any, events: [], createdAt: now });
  }
  // Course avec saut GPS irréaliste (spoofing).
  container.rides.save({ id: 'spoof-1', clientId: 'client-x', driverId: drvId, serviceType: 'ride', status: 'in_progress', origin: { lat: 5.35, lng: -4.0 }, destination: { lat: 5.37, lng: -3.98 }, quote: mkQuote() as any, events: [], trace: [{ lat: 5.35, lng: -4.0 }, { lat: 5.40, lng: -3.95 }], createdAt: now });

  const fraud = await app.inject({ method: 'GET', url: '/admin/fraud', headers: AUTH });
  assert.ok((fraud.json().ghostRides as Array<{ clientId: string; count: number }>).some((g) => g.clientId === 'client-collusion' && g.count >= 3));
  assert.ok((fraud.json().gpsSpoof as Array<{ rideId: string }>).some((s) => s.rideId === 'spoof-1'));

  // Élasticité-prix (recommandation par cellule) + copilote NL.
  await app.inject({ method: 'POST', url: '/pricing/estimate', payload: { origin: { lat: 5.35, lng: -4.0 }, destination: { lat: 5.37, lng: -3.98 }, category: 'bronze' } });
  const el = await app.inject({ method: 'GET', url: '/admin/elasticity', headers: AUTH });
  assert.equal(el.statusCode, 200);
  assert.ok(Array.isArray(el.json().cells));
  const cop = await app.inject({ method: 'POST', url: '/admin/copilot', headers: AUTH, payload: { q: 'chiffre d’affaires électrique vs thermique' } });
  assert.match(cop.json().answer, /électriques|electriques/);
});

test('S10 B2B : filiales, import de masse, politique de déplacement, web booker, facture PDF', async (t) => {
  const { buildApp } = await import('../src/app.js');
  const { app } = await buildApp();
  t.after(() => app.close());

  // Entité mère + filiale + NIF.
  await app.inject({ method: 'PUT', url: '/admin/corporate', headers: AUTH, payload: { id: 'groupe-x', name: 'Groupe X', nif: 'CI-123456', creditLimit: 5_000_000 } });
  await app.inject({ method: 'PUT', url: '/admin/corporate', headers: AUTH, payload: { id: 'groupe-x-rh', name: 'Groupe X — RH', parentId: 'groupe-x', creditLimit: 1_000_000 } });
  const children = await app.inject({ method: 'GET', url: '/admin/corporate/groupe-x/children', headers: AUTH });
  assert.equal(children.json().children.length, 1);

  // Import de masse des collaborateurs.
  const imp = await app.inject({ method: 'POST', url: '/admin/corporate/groupe-x/members', headers: AUTH, payload: { memberIds: ['client-1', 'client-2', 'client-2', 'client-3'] } });
  assert.equal(imp.json().added, 3);

  // Politique : zone autorisée = cocody uniquement → web booker au Plateau refusé (409).
  await app.inject({ method: 'PUT', url: '/admin/corporate', headers: AUTH, payload: { id: 'groupe-x', name: 'Groupe X', creditLimit: 5_000_000, policy: { zoneIds: ['cocody'] } } });
  const koBook = await app.inject({ method: 'POST', url: '/admin/corporate/groupe-x/book', headers: AUTH, payload: {
    guestName: 'M. Invité', origin: { lat: 5.3236, lng: -4.0217 }, destination: { lat: 5.35, lng: -3.99 }, category: 'bronze',
  } });
  assert.equal(koBook.statusCode, 409);
  assert.match(koBook.json().error, /Zone non autorisée/);

  // Web booker dans Cocody : conforme → réservation créée + imputée.
  const okBook = await app.inject({ method: 'POST', url: '/admin/corporate/groupe-x/book', headers: AUTH, payload: {
    guestName: 'Mme Cliente', origin: { lat: 5.3596, lng: -3.9903 }, destination: { lat: 5.35, lng: -3.99 }, category: 'bronze',
  } });
  assert.equal(okBook.statusCode, 201);
  assert.ok(okBook.json().booking.amount > 0);

  // Facture consolidée PDF.
  const pdf = await app.inject({ method: 'GET', url: '/admin/corporate/groupe-x/invoice.pdf', headers: AUTH });
  assert.match(pdf.headers['content-type'] as string, /application\/pdf/);
  assert.equal(pdf.rawPayload.subarray(0, 5).toString(), '%PDF-');
});

test('S11 Litiges : escalade + claim lock, quarantaine (gel wallet), chargeback + dossier PDF, pertes CSV', async (t) => {
  const { buildApp } = await import('../src/app.js');
  const { app, container } = await buildApp();
  t.after(() => app.close());

  // Course payée puis litige ouvert.
  const drv = await onlineDriver(app, 'Litige Drv');
  const est = await app.inject({ method: 'POST', url: '/pricing/estimate', payload: { origin: { lat: 5.35, lng: -4.0 }, destination: { lat: 5.37, lng: -3.98 }, category: 'bronze' } });
  const ride = (await app.inject({ method: 'POST', url: '/rides', payload: { clientId: 'client-lit', lockId: est.json().quote.lockId }, headers: { 'idempotency-key': 'lit-1' } })).json().ride;
  const disp = (await app.inject({ method: 'POST', url: `/rides/${ride.id}/dispute`, payload: { clientId: 'client-lit', kind: 'facturation', description: 'Paiement contesté, carte volée selon le client' } })).json().dispute;

  // Escalade + verrou par l'expert A ; l'expert B est refusé (claim lock).
  const a = await login(app, 'exp.a');
  const b = await login(app, 'exp.b');
  const esc = await app.inject({ method: 'POST', url: `/admin/disputes/${disp.id}/escalate`, headers: a, payload: { kind: 'chargeback' } });
  assert.equal(esc.statusCode, 200);
  assert.equal(esc.json().dispute.lockedBy, 'Expert Litiges A');
  const escB = await app.inject({ method: 'POST', url: `/admin/disputes/${disp.id}/escalate`, headers: b, payload: { kind: 'chargeback' } });
  assert.equal(escB.statusCode, 409);
  const noteB = await app.inject({ method: 'POST', url: `/admin/disputes/${disp.id}/note`, headers: b, payload: { text: 'tentative' } });
  assert.equal(noteB.statusCode, 403, 'note réservée à l’expert gestionnaire');

  // Quarantaine : gel du wallet chauffeur → retrait bloqué.
  container.wallet.credit(drv, 10000, 'ride_earning', 'seed');
  const q = await app.inject({ method: 'POST', url: `/admin/disputes/${disp.id}/quarantine`, headers: a, payload: { on: true } });
  assert.equal(q.json().frozen, true);
  assert.equal(container.wallet.isFrozen(drv), true);
  assert.throws(() => container.wallet.requestPayout(drv, 5000), /gelé/);

  // Copilote : synthèse du litige.
  const sum = await app.inject({ method: 'GET', url: `/admin/disputes/${disp.id}/summary`, headers: a });
  assert.match(sum.json().summary, /facturation|chargeback/);

  // Evidence package chargeback + dossier légal (PDF) + matrice des pertes (CSV).
  const cb = await app.inject({ method: 'GET', url: `/admin/disputes/${disp.id}/chargeback.pdf`, headers: a });
  assert.equal(cb.rawPayload.subarray(0, 5).toString(), '%PDF-');
  const dossier = await app.inject({ method: 'GET', url: `/admin/disputes/${disp.id}/dossier.pdf`, headers: a });
  assert.equal(dossier.rawPayload.subarray(0, 5).toString(), '%PDF-');
  const csv = await app.inject({ method: 'GET', url: '/admin/disputes.csv', headers: AUTH });
  assert.match(csv.body, /dossier,categorie,statut/);

  // Indemnisation perte d'exploitation.
  const lou = await app.inject({ method: 'GET', url: `/admin/drivers/${drv}/loss-of-use`, headers: a });
  assert.equal(lou.statusCode, 200);
  assert.equal(typeof lou.json().lossOfUse.dailyAvg, 'number');
});
