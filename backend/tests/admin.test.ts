import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildApp } from '../src/app.js';

const AUTH = { 'x-admin-token': 'orion-admin-dev' };

test('admin : accès refusé sans jeton', async (t) => {
  const { app } = await buildApp();
  t.after(() => app.close());
  const res = await app.inject({ method: 'GET', url: '/admin/overview' });
  assert.equal(res.statusCode, 401);
});

test('admin : overview + drivers avec jeton', async (t) => {
  const { app, container } = await buildApp();
  t.after(() => app.close());

  const drv = await app.inject({ method: 'POST', url: '/drivers', payload: { name: 'Awa', category: 'argent' } });
  const driverId = drv.json().driver.id as string;
  await app.inject({ method: 'POST', url: `/drivers/${driverId}/online`, payload: { position: { lat: 5.324, lng: -4.021 } } });

  const ov = await app.inject({ method: 'GET', url: '/admin/overview', headers: AUTH });
  assert.equal(ov.statusCode, 200);
  const body = ov.json();
  assert.equal(body.currency, 'XOF');
  assert.equal(body.drivers.total, 1);
  assert.equal(body.drivers.online, 1);

  const fleet = await app.inject({ method: 'GET', url: '/admin/fleet/live', headers: AUTH });
  assert.equal(fleet.json().fleet.length, 1);
  assert.equal(fleet.json().fleet[0].matricule?.startsWith('ORION-CI-'), true);
  void container;
});

test('admin : supervision SAMU (alerte SOS → résolue)', async (t) => {
  const { app } = await buildApp();
  t.after(() => app.close());

  const sos = await app.inject({
    method: 'POST',
    url: '/safety/sos',
    payload: { userId: 'client-1', location: { lat: 5.33, lng: -4.01 } },
  });
  assert.equal(sos.statusCode, 201);
  const id = sos.json().alert.id as string;

  const list = await app.inject({ method: 'GET', url: '/admin/alerts', headers: AUTH });
  assert.equal(list.json().alerts.length, 1);

  const upd = await app.inject({
    method: 'POST',
    url: `/admin/alerts/${id}/status`,
    headers: AUTH,
    payload: { status: 'resolved' },
  });
  assert.equal(upd.statusCode, 200);
  assert.equal(upd.json().alert.status, 'resolved');
});

test('admin : fiche détaillée chauffeur (profil + courses + ledger)', async (t) => {
  const { app } = await buildApp();
  t.after(() => app.close());

  const drv = await app.inject({ method: 'POST', url: '/drivers', payload: { name: 'Kouassi', category: 'argent' } });
  const driverId = drv.json().driver.id as string;

  const res = await app.inject({ method: 'GET', url: `/admin/drivers/${driverId}`, headers: AUTH });
  assert.equal(res.statusCode, 200);
  const d = res.json().driver;
  assert.equal(d.id, driverId);
  assert.equal(d.name, 'Kouassi');
  assert.equal(d.category, 'argent');
  assert.ok(Array.isArray(d.rides));
  assert.ok(Array.isArray(d.ledger));
  assert.equal(typeof d.balance, 'number');
  assert.equal(typeof d.earnings, 'number');

  const missing = await app.inject({ method: 'GET', url: '/admin/drivers/inconnu', headers: AUTH });
  assert.equal(missing.statusCode, 404);
});

test('admin : fiche détaillée client (dépenses + courses)', async (t) => {
  const { app } = await buildApp();
  t.after(() => app.close());

  const res = await app.inject({ method: 'GET', url: '/admin/clients/client-x', headers: AUTH });
  assert.equal(res.statusCode, 200);
  const c = res.json().client;
  assert.equal(c.id, 'client-x');
  assert.ok(Array.isArray(c.recentRides));
  assert.ok(Array.isArray(c.conversations));
  assert.equal(typeof c.spent, 'number');
});

test('admin : zones — liste par défaut + upsert + facteur appliqué au prix', async (t) => {
  const { app, container } = await buildApp();
  t.after(() => app.close());

  const list = await app.inject({ method: 'GET', url: '/admin/zones', headers: AUTH });
  assert.equal(list.statusCode, 200);
  assert.ok(list.json().zones.length >= 1);

  // Crée une zone très chère centrée sur un point précis.
  const up = await app.inject({
    method: 'PUT', url: '/admin/zones', headers: AUTH,
    payload: { id: 'test-zone', name: 'Test', factor: 2, lat: 5.35, lng: -4.0, radiusKm: 2, active: true },
  });
  assert.equal(up.statusCode, 200);
  assert.equal(up.json().zone.factor, 2);

  // Le facteur de zone doit remonter pour un point dans le rayon.
  assert.equal(container.settings.zoneFactor({ lat: 5.35, lng: -4.0 }), 2);

  // Désactivation → facteur neutre (1) pour ce même point (si aucune autre zone).
  const off = await app.inject({ method: 'POST', url: '/admin/zones/test-zone/active', headers: AUTH, payload: { active: false } });
  assert.equal(off.statusCode, 200);
  assert.equal(off.json().zone.active, false);

  // Suppression.
  const del = await app.inject({ method: 'DELETE', url: '/admin/zones/test-zone', headers: AUTH });
  assert.equal(del.statusCode, 200);
  assert.equal(container.settings.getZones().some((z) => z.id === 'test-zone'), false);
});

test('admin : zone factor modifie le prix fixe', async (t) => {
  const { app, container } = await buildApp();
  t.after(() => app.close());

  const origin = { lat: 5.35, lng: -4.0 };
  const destination = { lat: 5.37, lng: -3.98 };

  // Neutralise toutes les zones par défaut pour isoler l'effet.
  for (const z of [...container.settings.getZones()]) container.settings.removeZone(z.id);
  const q1 = await app.inject({ method: 'POST', url: '/pricing/estimate', payload: { origin, destination, category: 'argent' } });
  const base = q1.json().quote.amount as number;

  container.settings.upsertZone({ id: 'z-cher', name: 'Cher', factor: 1.5, lat: 5.35, lng: -4.0, radiusKm: 3, active: true });
  const q2 = await app.inject({ method: 'POST', url: '/pricing/estimate', payload: { origin, destination, category: 'argent' } });
  const withZone = q2.json().quote.amount as number;

  assert.ok(withZone > base, `zone chère doit augmenter le prix (${withZone} > ${base})`);
});

test('admin : statistiques quotidiennes (tendances)', async (t) => {
  const { app } = await buildApp();
  t.after(() => app.close());

  const res = await app.inject({ method: 'GET', url: '/admin/stats?days=7', headers: AUTH });
  assert.equal(res.statusCode, 200);
  const body = res.json();
  assert.equal(body.days, 7);
  assert.equal(body.series.length, 7);
  assert.equal(typeof body.totals.rides, 'number');
  assert.equal(typeof body.totals.revenue, 'number');
  // Chaque jour a une date ISO (AAAA-MM-JJ) croissante.
  for (const b of body.series) assert.match(b.date, /^\d{4}-\d{2}-\d{2}$/);
});

test('admin : login JWT — succès, accès protégé, échec identifiants', async (t) => {
  const { app } = await buildApp();
  t.after(() => app.close());

  // Mauvais mot de passe → 401.
  const bad = await app.inject({ method: 'POST', url: '/admin/login', payload: { username: 'admin', password: 'faux' } });
  assert.equal(bad.statusCode, 401);

  // Bon compte par défaut (dev) → jeton JWT.
  const ok = await app.inject({ method: 'POST', url: '/admin/login', payload: { username: 'admin', password: 'orion-admin-dev' } });
  assert.equal(ok.statusCode, 200);
  const { token, account } = ok.json();
  assert.ok(typeof token === 'string' && token.split('.').length === 3);
  assert.equal(account.role, 'super_admin');
  assert.ok(account.permissions.includes('pricing:write'));

  // Le JWT ouvre les routes protégées (Authorization: Bearer).
  const me = await app.inject({ method: 'GET', url: '/admin/me', headers: { authorization: `Bearer ${token}` } });
  assert.equal(me.statusCode, 200);
  assert.equal(me.json().role, 'super_admin');

  // Sans jeton → 401.
  const no = await app.inject({ method: 'GET', url: '/admin/me' });
  assert.equal(no.statusCode, 401);

  // JWT falsifié → 401.
  const forged = await app.inject({ method: 'GET', url: '/admin/me', headers: { authorization: `Bearer ${token}x` } });
  assert.equal(forged.statusCode, 401);
});

test('admin : hiérarchie — seuls les dirigeants approuvent les virements', async () => {
  const { ROLE_PERMISSIONS } = await import('../src/modules/admin/roles.js');
  // Dirigeants : accès complet, y compris l'approbation.
  for (const r of ['ceo', 'dg', 'daa', 'coo', 'super_admin'] as const) {
    assert.ok(ROLE_PERMISSIONS[r].includes('treasury:approve'), `${r} doit approuver`);
  }
  // CFO : demande mais n'approuve JAMAIS (double validation).
  assert.ok(ROLE_PERMISSIONS.cfo.includes('treasury:request'));
  assert.ok(!ROLE_PERMISSIONS.cfo.includes('treasury:approve'));
  // Équipe finance : lecture seule de la trésorerie.
  assert.ok(ROLE_PERMISSIONS.finance.includes('treasury:read'));
  assert.ok(!ROLE_PERMISSIONS.finance.includes('treasury:request'));
});

test('admin : trésorerie — demande, approbation, rejet (maker-checker)', async (t) => {
  const { app } = await buildApp();
  t.after(() => app.close());

  // Demande de virement (super_admin a treasury:request).
  const reqRes = await app.inject({
    method: 'POST', url: '/admin/treasury/request', headers: AUTH,
    payload: { amount: 2_500_000, destination: 'SGCI — CI93 SG01 0002 4518', reason: 'Salaires juillet' },
  });
  assert.equal(reqRes.statusCode, 200);
  const t1 = reqRes.json().transfer;
  assert.equal(t1.status, 'pending');

  // Liste : 1 demande en attente.
  const list1 = await app.inject({ method: 'GET', url: '/admin/treasury', headers: AUTH });
  assert.equal(list1.json().pending, 1);

  // Séparation des tâches : le demandeur ne peut pas approuver sa propre demande.
  const self = await app.inject({ method: 'POST', url: `/admin/treasury/${t1.id}/approve`, headers: AUTH });
  assert.equal(self.statusCode, 403);

  // Rejet par un dirigeant (ici le même compte peut rejeter — pas d'exécution d'argent).
  const rej = await app.inject({ method: 'POST', url: `/admin/treasury/${t1.id}/reject`, headers: AUTH, payload: { note: 'Montant à revalider' } });
  assert.equal(rej.statusCode, 200);
  assert.equal(rej.json().transfer.status, 'rejected');

  // Une demande déjà décidée ne peut plus être approuvée.
  const again = await app.inject({ method: 'POST', url: `/admin/treasury/${t1.id}/approve`, headers: AUTH });
  assert.equal(again.statusCode, 404);
});

test('admin : recherche globale (chauffeur par nom, limites de permissions)', async (t) => {
  const { app } = await buildApp();
  t.after(() => app.close());

  await app.inject({ method: 'POST', url: '/drivers', payload: { name: 'Mariam Ouattara', category: 'or' } });

  const res = await app.inject({ method: 'GET', url: '/admin/search?q=mariam', headers: AUTH });
  assert.equal(res.statusCode, 200);
  const body = res.json();
  assert.equal(body.drivers.length, 1);
  assert.equal(body.drivers[0].name, 'Mariam Ouattara');
  assert.ok(Array.isArray(body.clients));
  assert.ok(Array.isArray(body.rides));

  // Requête trop courte → résultats vides (pas de scan complet).
  const short = await app.inject({ method: 'GET', url: '/admin/search?q=m', headers: AUTH });
  assert.equal(short.json().drivers.length, 0);
});

test('admin : anti-brute-force — verrouillage après 5 échecs', async (t) => {
  const { app } = await buildApp();
  t.after(() => app.close());

  // 5 échecs sur un compte (inexistant : le verrou s'applique quand même).
  for (let i = 0; i < 5; i++) {
    const r = await app.inject({ method: 'POST', url: '/admin/login', payload: { username: 'ghost', password: 'x' } });
    assert.equal(r.statusCode, 401);
  }
  // 6e tentative → verrouillé (429), même avec un mot de passe quelconque.
  const locked = await app.inject({ method: 'POST', url: '/admin/login', payload: { username: 'ghost', password: 'x' } });
  assert.equal(locked.statusCode, 429);
});

test('admin : pagination serveur des chauffeurs', async (t) => {
  const { app } = await buildApp();
  t.after(() => app.close());

  for (const n of ['Aya', 'Bintou', 'Chaka']) {
    await app.inject({ method: 'POST', url: '/drivers', payload: { name: n, category: 'argent' } });
  }
  const p1 = await app.inject({ method: 'GET', url: '/admin/drivers?page=1&limit=2', headers: AUTH });
  const b1 = p1.json();
  assert.equal(b1.drivers.length, 2);
  assert.equal(b1.total, 3);
  assert.equal(b1.pages, 2);
  assert.equal(b1.page, 1);
  const p2 = await app.inject({ method: 'GET', url: '/admin/drivers?page=2&limit=2', headers: AUTH });
  assert.equal(p2.json().drivers.length, 1);
  // Page au-delà de la fin → ramenée à la dernière page.
  const p9 = await app.inject({ method: 'GET', url: '/admin/drivers?page=9&limit=2', headers: AUTH });
  assert.equal(p9.json().page, 2);
});

test('admin : export comptable trésorerie (CSV, échappement)', async (t) => {
  const { app } = await buildApp();
  t.after(() => app.close());

  await app.inject({
    method: 'POST', url: '/admin/treasury/request', headers: AUTH,
    payload: { amount: 750000, destination: 'SGCI, agence "Plateau"', reason: 'Test, virement' },
  });
  const csv = await app.inject({ method: 'GET', url: '/admin/treasury.csv', headers: AUTH });
  assert.equal(csv.statusCode, 200);
  assert.match(csv.headers['content-type'] as string, /text\/csv/);
  assert.ok(csv.body.startsWith('reference,montant'));
  // Les virgules et guillemets internes sont bien échappés (RFC 4180).
  assert.ok(csv.body.includes('"SGCI, agence ""Plateau"""'));
});
