import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scryptSync } from 'node:crypto';

/**
 * Équipes & managers : la config capture process.env au chargement → on définit
 * les comptes AVANT tout import applicatif (imports dynamiques dans les tests).
 */
const SALT = 'f0e1d2c3b4a59687';
const HASH = scryptSync('Equipe#2026', SALT, 32).toString('hex');
process.env.ADMIN_USERS = JSON.stringify([
  { username: 'dg', name: 'Directeur Général', role: 'dg', salt: SALT, hash: HASH },
  { username: 'chef.awa', name: 'Awa (Chef d’équipe)', role: 'manager', salt: SALT, hash: HASH },
  { username: 'chef.yao', name: 'Yao (Chef d’équipe)', role: 'manager', salt: SALT, hash: HASH },
]);

const AUTH = { 'x-admin-token': 'orion-admin-dev' };

async function login(app: { inject: (o: object) => Promise<{ json: () => { token: string } }> }, username: string) {
  const res = await app.inject({ method: 'POST', url: '/admin/login', payload: { username, password: 'Equipe#2026' } });
  return { authorization: `Bearer ${res.json().token}` };
}

test('équipes : création, flotte affiliée, portée manager imposée côté serveur', async (t) => {
  const { buildApp } = await import('../src/app.js');
  const { app } = await buildApp();
  t.after(() => app.close());

  // Deux chauffeurs.
  const d1 = (await app.inject({ method: 'POST', url: '/drivers', payload: { name: 'Flotte A1', category: 'bronze' } })).json().driver.id as string;
  const d2 = (await app.inject({ method: 'POST', url: '/drivers', payload: { name: 'Flotte B1', category: 'bronze' } })).json().driver.id as string;

  // La direction crée deux équipes avec leurs flottes.
  const t1 = await app.inject({ method: 'PUT', url: '/admin/teams', headers: AUTH, payload: { name: 'Équipe Cocody', managerUsername: 'chef.awa', managerName: 'Awa', driverIds: [d1] } });
  assert.equal(t1.statusCode, 200);
  await app.inject({ method: 'PUT', url: '/admin/teams', headers: AUTH, payload: { name: 'Équipe Marcory', managerUsername: 'chef.yao', driverIds: [d2] } });

  // La direction voit les 2 équipes ; le chef Awa n'en voit qu'UNE (la sienne).
  const all = await app.inject({ method: 'GET', url: '/admin/teams', headers: AUTH });
  assert.equal(all.json().teams.length, 2);
  const awa = await login(app, 'chef.awa');
  const mine = await app.inject({ method: 'GET', url: '/admin/teams', headers: awa });
  assert.equal(mine.json().teams.length, 1);
  assert.equal(mine.json().teams[0].name, 'Équipe Cocody');
  assert.equal(mine.json().teams[0].drivers[0].id, d1);

  // Awa peut avertir SON chauffeur… mais pas celui de l'équipe de Yao (403).
  const okWarn = await app.inject({ method: 'POST', url: `/admin/drivers/${d1}/warn`, headers: awa });
  assert.equal(okWarn.statusCode, 200);
  const koWarn = await app.inject({ method: 'POST', url: `/admin/drivers/${d2}/warn`, headers: awa });
  assert.equal(koWarn.statusCode, 403);

  // Un manager ne peut pas créer d'équipe (teams:write réservé direction/flotte).
  const koCreate = await app.inject({ method: 'PUT', url: '/admin/teams', headers: awa, payload: { name: 'X', managerUsername: 'chef.awa' } });
  assert.equal(koCreate.statusCode, 403);
});

test('CRM chauffeur : dossier véhicule + formation éco-conduite (QCM serveur)', async (t) => {
  const { buildApp } = await import('../src/app.js');
  const { app } = await buildApp();
  t.after(() => app.close());

  const id = (await app.inject({ method: 'POST', url: '/drivers', payload: { name: 'Eco Drv', category: 'bronze' } })).json().driver.id as string;

  // Dossier véhicule : modèle + expiration d'assurance.
  const prof = await app.inject({ method: 'POST', url: `/drivers/${id}/profile`, payload: { vehicleModel: 'BYD Dolphin 2024', insuranceExpiry: '2026-08-15' } });
  assert.equal(prof.statusCode, 200);

  // Le contenu du module ne divulgue PAS les réponses.
  const mod = await app.inject({ method: 'GET', url: '/training/eco' });
  assert.equal(mod.json().questions.length, 4);
  assert.equal(JSON.stringify(mod.json()).includes('"answer"'), false);

  // Mauvaises réponses → échec, non certifié.
  const fail = await app.inject({ method: 'POST', url: `/drivers/${id}/training`, payload: { answers: [0, 0, 1, 0] } });
  assert.equal(fail.statusCode, 400);
  assert.equal(fail.json().passed, false);

  // Bonnes réponses → certifié (visible dans la liste admin).
  const pass = await app.inject({ method: 'POST', url: `/drivers/${id}/training`, payload: { answers: [1, 1, 0, 1] } });
  assert.equal(pass.statusCode, 200);
  assert.equal(pass.json().trained, true);
  const list = await app.inject({ method: 'GET', url: '/admin/drivers', headers: AUTH });
  const row = (list.json().drivers as Array<{ id: string; trained: boolean; vehicleModel: string | null }>).find((d) => d.id === id);
  assert.equal(row?.trained, true);
  assert.equal(row?.vehicleModel, 'BYD Dolphin 2024');
});

test('anti-abus : 3 annulations → avertissement automatique du client', async (t) => {
  const { buildApp } = await import('../src/app.js');
  const { app, container } = await buildApp();
  t.after(() => app.close());

  const drv = (await app.inject({ method: 'POST', url: '/drivers', payload: { name: 'Cancel Drv', category: 'bronze' } })).json().driver.id as string;
  await app.inject({ method: 'POST', url: `/drivers/${drv}/online`, payload: { position: { lat: 5.351, lng: -4.001 } } });

  for (let i = 0; i < 3; i++) {
    const est = await app.inject({ method: 'POST', url: '/pricing/estimate', payload: { origin: { lat: 5.35, lng: -4.0 }, destination: { lat: 5.37, lng: -3.98 }, category: 'bronze' } });
    const ride = await app.inject({ method: 'POST', url: '/rides', payload: { clientId: 'client-abus', lockId: est.json().quote.lockId }, headers: { 'idempotency-key': `ab-${i}` } });
    await app.inject({ method: 'POST', url: `/rides/${ride.json().ride.id}/transition`, payload: { to: 'cancelled' } });
  }

  const c = container.clients.get('client-abus');
  assert.equal(c?.cancellations, 3);
  assert.equal(c?.warnings, 1, 'avertissement automatique posé au 3e abandon');
});

test('B2B : ligne de crédit, refus au-delà du plafond, facture mensuelle CSV', async (t) => {
  const { buildApp } = await import('../src/app.js');
  const { app } = await buildApp();
  t.after(() => app.close());

  const drv = (await app.inject({ method: 'POST', url: '/drivers', payload: { name: 'B2B Drv', category: 'bronze' } })).json().driver.id as string;
  await app.inject({ method: 'POST', url: `/drivers/${drv}/online`, payload: { position: { lat: 5.351, lng: -4.001 } } });

  // Plafond calibré pour UNE course : la deuxième dépassera la ligne de crédit.
  const est = await app.inject({ method: 'POST', url: '/pricing/estimate', payload: { origin: { lat: 5.35, lng: -4.0 }, destination: { lat: 5.37, lng: -3.98 }, category: 'bronze' } });
  const amount = est.json().quote.amount as number;
  const acc = await app.inject({ method: 'PUT', url: '/admin/corporate', headers: AUTH, payload: { id: 'hotel-ivoire', name: 'Hôtel Ivoire', creditLimit: amount + 100 } });
  assert.equal(acc.statusCode, 200);
  const ride = await app.inject({ method: 'POST', url: '/rides', payload: { clientId: 'client-b2b', lockId: est.json().quote.lockId, corporateCode: 'hotel-ivoire' }, headers: { 'idempotency-key': 'b2b-1' } });
  assert.equal(ride.statusCode, 201);

  // Le crédit consommé est visible ; un dépassement est refusé (409).
  const list = await app.inject({ method: 'GET', url: '/admin/corporate', headers: AUTH });
  assert.equal(list.json().accounts[0].balanceUsed, amount);
  const est2 = await app.inject({ method: 'POST', url: '/pricing/estimate', payload: { origin: { lat: 5.35, lng: -4.0 }, destination: { lat: 5.37, lng: -3.98 }, category: 'bronze' } });
  const over = await app.inject({ method: 'POST', url: '/rides', payload: { clientId: 'client-b2b2', lockId: est2.json().quote.lockId, corporateCode: 'hotel-ivoire' }, headers: { 'idempotency-key': 'b2b-2' } });
  assert.equal(over.statusCode, 409, 'ligne de crédit dépassée → refus');

  // Facture mensuelle consolidée (CSV) + règlement (remise à zéro, aval direction).
  const month = new Date().toISOString().slice(0, 7);
  const inv = await app.inject({ method: 'GET', url: `/admin/corporate/hotel-ivoire/invoice?month=${month}`, headers: AUTH });
  assert.match(inv.headers['content-type'] as string, /text\/csv/);
  assert.ok(inv.body.includes('Hôtel Ivoire'));
  assert.ok(inv.body.includes(String(amount)));
  const settle = await app.inject({ method: 'POST', url: '/admin/corporate/hotel-ivoire/settle', headers: AUTH });
  assert.equal(settle.json().account.balanceUsed, 0);
});

test('IA : conversion par zone, churn et bilan carbone PDF', async (t) => {
  const { buildApp } = await import('../src/app.js');
  const { app, container } = await buildApp();
  t.after(() => app.close());

  const drv = (await app.inject({ method: 'POST', url: '/drivers', payload: { name: 'IA Drv', category: 'bronze' } })).json().driver.id as string;
  await app.inject({ method: 'POST', url: `/drivers/${drv}/online`, payload: { position: { lat: 5.351, lng: -4.001 } } });

  // 3 sessions (devis), 1 seule commande → conversion 33 %.
  const mk = () => app.inject({ method: 'POST', url: '/pricing/estimate', payload: { origin: { lat: 5.35, lng: -4.0 }, destination: { lat: 5.37, lng: -3.98 }, category: 'bronze' } });
  const e1 = await mk(); await mk(); await mk();
  await app.inject({ method: 'POST', url: '/rides', payload: { clientId: 'client-conv', lockId: e1.json().quote.lockId }, headers: { 'idempotency-key': 'cv-1' } });
  const conv = await app.inject({ method: 'GET', url: '/admin/conversion', headers: AUTH });
  const cell = conv.json().cells[0];
  assert.equal(cell.sessions, 3);
  assert.equal(cell.orders, 1);
  assert.equal(cell.rate, 33);

  // Churn : client régulier silencieux depuis 20 jours → signalé.
  const cl = container.clients.touch('client-fidele', { name: 'Mariam' });
  cl.rides = 12; cl.lastSeenAt = new Date(Date.now() - 20 * 86_400_000).toISOString();
  const churn = await app.inject({ method: 'GET', url: '/admin/churn', headers: AUTH });
  assert.ok((churn.json().clients as Array<{ id: string }>).some((c2) => c2.id === 'client-fidele'));

  // Prédiction : endpoint répond avec l'heure ciblée.
  const pred = await app.inject({ method: 'GET', url: '/admin/predict', headers: AUTH });
  assert.equal(pred.statusCode, 200);
  assert.equal(typeof pred.json().hour, 'number');

  // Bilan carbone PDF : vrai PDF téléchargeable.
  const pdf = await app.inject({ method: 'GET', url: '/admin/green/report.pdf', headers: AUTH });
  assert.match(pdf.headers['content-type'] as string, /application\/pdf/);
  assert.equal(pdf.rawPayload.subarray(0, 5).toString(), '%PDF-');

  // Split payment : la TVA collectée apparaît isolée dans les finances.
  const fin = await app.inject({ method: 'GET', url: '/admin/finance', headers: AUTH });
  assert.equal(typeof fin.json().taxes, 'number');
});
