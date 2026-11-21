import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scryptSync } from 'node:crypto';

/**
 * Cahier des charges — sessions 12 à 15 :
 * Chauffeur (KYC/loyauté/contrat), Client (VIP/blacklist/no-show/LTV),
 * Finances (commissions par gamme, cash limit, gateways, notes de frais),
 * Trésorerie (ratio de couverture, burn/runway, amortissement).
 */
const SALT = 'c3d4e5f6a7b80920';
const HASH = scryptSync('Session#2026', SALT, 32).toString('hex');
process.env.ADMIN_USERS = JSON.stringify([
  { username: 'dg', name: 'Directeur Général', role: 'dg', salt: SALT, hash: HASH },
  { username: 'cfo', name: 'Directeur Financier', role: 'cfo', salt: SALT, hash: HASH },
  { username: 'agent', name: 'Agent Support', role: 'support', salt: SALT, hash: HASH },
]);

const AUTH = { 'x-admin-token': 'orion-admin-dev' };
type App = { inject: (o: object) => Promise<{ statusCode: number; body: string; rawPayload: Buffer; headers: Record<string, unknown>; json: () => any }> };
async function login(app: App, u: string) {
  const res = await app.inject({ method: 'POST', url: '/admin/login', payload: { username: u, password: 'Session#2026' } });
  return { authorization: `Bearer ${res.json().token}` };
}
async function onlineDriver(app: App, name: string) {
  const id = (await app.inject({ method: 'POST', url: '/drivers', payload: { name, category: 'argent' } })).json().driver.id as string;
  await app.inject({ method: 'POST', url: `/drivers/${id}/online`, payload: { position: { lat: 5.351, lng: -4.001 } } });
  return id;
}
async function fullRide(app: App, clientId: string, key: string) {
  const est = await app.inject({ method: 'POST', url: '/pricing/estimate', payload: { origin: { lat: 5.35, lng: -4.0 }, destination: { lat: 5.37, lng: -3.98 }, category: 'argent' } });
  const ride = (await app.inject({ method: 'POST', url: '/rides', payload: { clientId, lockId: est.json().quote.lockId }, headers: { 'idempotency-key': key } })).json().ride;
  for (const to of ['driver_en_route', 'arrived', 'in_progress', 'completed']) {
    await app.inject({ method: 'POST', url: `/rides/${ride.id}/transition`, payload: { to } });
  }
  await app.inject({ method: 'POST', url: `/rides/${ride.id}/pay`, payload: { method: 'cash' }, headers: { 'idempotency-key': `pay-${key}` } });
  return ride;
}

test('S12 Chauffeur : suspension motivée, expirations, fidélité commission, contrat + flotte', async (t) => {
  const { buildApp } = await import('../src/app.js');
  const { app, container } = await buildApp();
  t.after(() => app.close());

  const id = await onlineDriver(app, 'KYC Drv');
  // Dossier véhicule + conformité verte (kWh, prise, RIB, NIF).
  await app.inject({ method: 'POST', url: `/drivers/${id}/profile`, payload: {
    vehicleModel: 'BYD Dolphin', vehiclePlate: '1234 CI 01', insuranceExpiry: new Date(Date.now() + 10 * 86_400_000).toISOString().slice(0, 10),
    batteryKwh: 60, plugType: 'Type 2', cablesConfirmed: true, ribVerified: true, nif: 'CI-99',
  } });

  // Suspension : motif OBLIGATOIRE (trace légale).
  const koSusp = await app.inject({ method: 'POST', url: `/admin/drivers/${id}/kyc`, headers: AUTH, payload: { status: 'suspended' } });
  assert.equal(koSusp.statusCode, 400);
  const okSusp = await app.inject({ method: 'POST', url: `/admin/drivers/${id}/kyc`, headers: AUTH, payload: { status: 'suspended', reason: 'Signalement litige grave' } });
  assert.equal(okSusp.json().driver.suspensionReason, 'Signalement litige grave');
  await app.inject({ method: 'POST', url: `/admin/drivers/${id}/kyc`, headers: AUTH, payload: { status: 'active' } });

  // Expirations sous 30 jours.
  const exp = await app.inject({ method: 'GET', url: '/admin/drivers/expiring', headers: AUTH });
  assert.ok((exp.json().drivers as Array<{ id: string; daysLeft: number }>).some((d) => d.id === id && d.daysLeft <= 30));

  // Fidélité : commission personnalisée réduite.
  const loy = await app.inject({ method: 'POST', url: `/admin/drivers/${id}/loyalty`, headers: AUTH, payload: { loyaltyTier: 'gold', commissionOverride: 0.10 } });
  assert.equal(loy.json().driver.commissionOverride, 0.10);

  // Contrat PDF + matrice flotte CSV.
  const contract = await app.inject({ method: 'GET', url: `/admin/drivers/${id}/contract.pdf`, headers: AUTH });
  assert.equal(contract.rawPayload.subarray(0, 5).toString(), '%PDF-');
  const fleet = await app.inject({ method: 'GET', url: '/admin/fleet.csv', headers: AUTH });
  assert.match(fleet.body, /matricule,nom,motorisation/);
  void container;
});

test('S13 Client : VIP no-surge, no-show, blacklist device, empreinte carbone, LTV', async (t) => {
  const { buildApp } = await import('../src/app.js');
  const { app, container } = await buildApp();
  t.after(() => app.close());

  await onlineDriver(app, 'Client Drv');
  await fullRide(app, 'client-crm', 'crm-1');
  // Points verts + empreinte carbone crédités après course électrique.
  assert.ok((container.clients.get('client-crm')?.co2SavedKg ?? 0) > 0);

  // VIP + verrou no-surge.
  const vip = await app.inject({ method: 'POST', url: '/admin/clients/client-crm/vip', headers: AUTH, payload: { vipTier: 'platinum', noSurgeLock: true } });
  assert.equal(vip.json().client.vipTier, 'platinum');
  assert.equal(vip.json().client.noSurgeLock, true);

  // Frais de no-show (annulation après arrivée).
  const ns = await app.inject({ method: 'POST', url: '/admin/clients/client-crm/noshow', headers: AUTH, payload: { fee: 1000 } });
  assert.equal(ns.json().client.noShowFees, 1000);
  const nsCancel = await app.inject({ method: 'POST', url: '/admin/clients/client-crm/noshow', headers: AUTH, payload: { fee: 0, cancel: true } });
  assert.equal(nsCancel.json().client.noShowFees, 0);

  // Blacklist device → compte bloqué.
  const bl = await app.inject({ method: 'POST', url: '/admin/clients/client-crm/blacklist', headers: AUTH, payload: { imei: '359-IMEI-XX', reason: 'Fraude répétée' } });
  assert.equal(bl.json().client.status, 'blocked');

  // Matrice LTV/CAC + rapport comportement PDF.
  const csv = await app.inject({ method: 'GET', url: '/admin/clients.csv', headers: AUTH });
  assert.match(csv.body, /depense_ltv_fcfa/);
  const pdf = await app.inject({ method: 'GET', url: '/admin/clients/behavior.pdf', headers: AUTH });
  assert.equal(pdf.rawPayload.subarray(0, 5).toString(), '%PDF-');
});

test('S14 Finances : commission verte réduite, gateway coupé, cash-debt, payouts', async (t) => {
  const { buildApp } = await import('../src/app.js');
  const { app, container } = await buildApp();
  t.after(() => app.close());

  // Commission verte 12 % par défaut (au lieu de 18 % standard) : vérifiée à la source.
  const drv = await onlineDriver(app, 'Fin Drv');
  const est0 = await app.inject({ method: 'POST', url: '/pricing/estimate', payload: { origin: { lat: 5.35, lng: -4.0 }, destination: { lat: 5.37, lng: -3.98 }, category: 'argent' } });
  const ride = (await app.inject({ method: 'POST', url: '/rides', payload: { clientId: 'client-fin', lockId: est0.json().quote.lockId }, headers: { 'idempotency-key': 'fin-1' } })).json().ride;
  for (const to of ['driver_en_route', 'arrived', 'in_progress', 'completed']) await app.inject({ method: 'POST', url: `/rides/${ride.id}/transition`, payload: { to } });
  const pay = await app.inject({ method: 'POST', url: `/rides/${ride.id}/pay`, payload: { method: 'cash' }, headers: { 'idempotency-key': 'pay-fin-1' } });
  assert.equal(pay.json().commission.rate, 0.12, 'commission verte réduite appliquée');

  // Passerelle coupée (panne) → paiement refusé.
  await app.inject({ method: 'POST', url: '/admin/finance/gateways', headers: AUTH, payload: { method: 'wave', enabled: false } });
  const drv2 = await onlineDriver(app, 'Fin Drv2');
  const est = await app.inject({ method: 'POST', url: '/pricing/estimate', payload: { origin: { lat: 5.35, lng: -4.0 }, destination: { lat: 5.37, lng: -3.98 }, category: 'argent' } });
  const r2 = (await app.inject({ method: 'POST', url: '/rides', payload: { clientId: 'client-fin2', lockId: est.json().quote.lockId }, headers: { 'idempotency-key': 'fin-2' } })).json().ride;
  for (const to of ['driver_en_route', 'arrived', 'in_progress', 'completed']) await app.inject({ method: 'POST', url: `/rides/${r2.id}/transition`, payload: { to } });
  const payKo = await app.inject({ method: 'POST', url: `/rides/${r2.id}/pay`, payload: { method: 'wave', phone: '+22507080910' }, headers: { 'idempotency-key': 'pw-2' } });
  assert.equal(payKo.statusCode, 400);
  void drv2;

  // Recouvrement dette espèces : wallet fortement négatif → apparaît dans cash-debt.
  container.wallet.credit(drv, -40000, 'adjustment', 'dette espèces test');
  const debt = await app.inject({ method: 'GET', url: '/admin/finance/cash-debt', headers: AUTH });
  assert.ok((debt.json().debtors as Array<{ id: string }>).some((d) => d.id === drv));

  // Fichier de virement de masse.
  const payouts = await app.inject({ method: 'GET', url: '/admin/payouts.csv', headers: AUTH });
  assert.match(payouts.body, /matricule,nom,solde_a_verser_fcfa/);
});

test('S14 Notes de frais : demande → CFO approuve → cash-out → justificatif → reliquat', async (t) => {
  const { buildApp } = await import('../src/app.js');
  const { app } = await buildApp();
  t.after(() => app.close());

  const agent = await login(app, 'agent');
  const cfo = await login(app, 'cfo');

  // L'agent ouvre un ticket de financement (self-service).
  const tk = await app.inject({ method: 'POST', url: '/admin/expenses', headers: agent, payload: {
    amount: 50000, category: 'marketing', neededDate: new Date().toISOString(), description: 'Campagne terrain quartier',
  } });
  assert.equal(tk.statusCode, 201);
  const id = tk.json().ticket.id;

  // Un support ne peut pas décider (treasury:request réservé CFO/direction).
  const koDecide = await app.inject({ method: 'POST', url: `/admin/expenses/${id}/decide`, headers: agent, payload: { decision: 'approve' } });
  assert.equal(koDecide.statusCode, 403);
  assert.match(koDecide.json().error.message, /sans autorisation de la direction/);

  // Le CFO approuve → crédit instantané du wallet interne.
  const appr = await app.inject({ method: 'POST', url: `/admin/expenses/${id}/decide`, headers: cfo, payload: { decision: 'approve' } });
  assert.equal(appr.json().ticket.status, 'approved');
  assert.equal(appr.json().ticket.credited, true);

  // Cash-out vers Wave, puis justificatif inférieur → reliquat restitué.
  const co = await app.inject({ method: 'POST', url: `/admin/expenses/${id}/cashout`, headers: agent, payload: { channel: 'wave' } });
  assert.equal(co.json().ticket.cashOut.channel, 'wave');
  const rc = await app.inject({ method: 'POST', url: `/admin/expenses/${id}/receipt`, headers: agent, payload: { spentAmount: 42000 } });
  assert.equal(rc.json().ticket.refunded, 8000, 'reliquat rapatrié vers ORION');
  assert.equal(rc.json().ticket.receipt.matches, true);
});

test('S15 Trésorerie : ratio de couverture, burn/runway, amortissement, reporting PDF', async (t) => {
  const { buildApp } = await import('../src/app.js');
  const { app } = await buildApp();
  t.after(() => app.close());

  const liq = await app.inject({ method: 'GET', url: '/admin/liquidity', headers: AUTH });
  assert.equal(liq.statusCode, 200);
  assert.equal(typeof liq.json().backingRatio, 'number');
  assert.equal(typeof liq.json().burnRate, 'number');
  assert.ok('runwayMonths' in liq.json());

  const amo = await app.inject({ method: 'GET', url: '/admin/treasury/amortization', headers: AUTH });
  assert.equal(typeof amo.json().vehicles, 'number');

  const pdf = await app.inject({ method: 'GET', url: '/admin/treasury/report.pdf', headers: AUTH });
  assert.equal(pdf.rawPayload.subarray(0, 5).toString(), '%PDF-');

  // La trésorerie est réservée : un support est refusé et signalé à la direction.
  const agent = await login(app, 'agent');
  const ko = await app.inject({ method: 'GET', url: '/admin/liquidity', headers: agent });
  assert.equal(ko.statusCode, 403);
});
