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
