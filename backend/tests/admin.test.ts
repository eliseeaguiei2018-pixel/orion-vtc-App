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

  const drv = await app.inject({ method: 'POST', url: '/drivers', payload: { name: 'Awa', category: 'bronze' } });
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
  const q1 = await app.inject({ method: 'POST', url: '/pricing/estimate', payload: { origin, destination, category: 'bronze' } });
  const base = q1.json().quote.amount as number;

  container.settings.upsertZone({ id: 'z-cher', name: 'Cher', factor: 1.5, lat: 5.35, lng: -4.0, radiusKm: 3, active: true });
  const q2 = await app.inject({ method: 'POST', url: '/pricing/estimate', payload: { origin, destination, category: 'bronze' } });
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
