import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildApp } from '../src/app.js';

const AUTH = { 'x-admin-token': 'orion-admin-dev' };

test('diffusion : annonce clients visible côté public', async (t) => {
  const { app } = await buildApp();
  t.after(() => app.close());
  const res = await app.inject({ method: 'POST', url: '/admin/broadcast', headers: AUTH, payload: { audience: 'clients', title: 'Promo', body: 'Code BIENVENUE -30%' } });
  assert.equal(res.statusCode, 200);
  const pub = await app.inject({ method: 'GET', url: '/announcements' });
  assert.ok(pub.json().announcements.some((a: { title: string }) => a.title === 'Promo'));
});

test('finances : agrégats + export CSV', async (t) => {
  const { app } = await buildApp();
  t.after(() => app.close());
  const fin = await app.inject({ method: 'GET', url: '/admin/finance', headers: AUTH });
  assert.equal(fin.statusCode, 200);
  assert.equal(fin.json().currency, 'XOF');
  const csv = await app.inject({ method: 'GET', url: '/admin/rides.csv', headers: AUTH });
  assert.equal(csv.statusCode, 200);
  assert.match(csv.headers['content-type'] as string, /text\/csv/);
  assert.match(csv.body, /^id,clientId,driverName/);
});
