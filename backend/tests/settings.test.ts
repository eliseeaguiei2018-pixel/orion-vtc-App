import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildApp } from '../src/app.js';

const AUTH = { 'x-admin-token': 'orion-admin-dev' };
const origin = { lat: 5.3236, lng: -4.0217 };
const destination = { lat: 5.3599, lng: -3.9876 };

test('admin/me : super_admin a la permission pricing:write', async (t) => {
  const { app } = await buildApp();
  t.after(() => app.close());
  const me = await app.inject({ method: 'GET', url: '/admin/me', headers: AUTH });
  assert.equal(me.statusCode, 200);
  assert.equal(me.json().role, 'super_admin');
  assert.ok(me.json().permissions.includes('pricing:write'));
});

test('tarification pilotable : baisser baseFare/perKm réduit le prix des courses', async (t) => {
  const { app } = await buildApp();
  t.after(() => app.close());

  const before = await app.inject({ method: 'POST', url: '/pricing/estimate', payload: { origin, destination, category: 'argent' } });
  const priceBefore = before.json().quote.amount as number;

  const upd = await app.inject({ method: 'PUT', url: '/admin/pricing', headers: AUTH, payload: { baseFare: 150, perKm: 80 } });
  assert.equal(upd.statusCode, 200);
  assert.equal(upd.json().pricing.baseFare, 150);

  const after = await app.inject({ method: 'POST', url: '/pricing/estimate', payload: { origin, destination, category: 'argent' } });
  const priceAfter = after.json().quote.amount as number;
  assert.ok(priceAfter < priceBefore, `attendu ${priceAfter} < ${priceBefore}`);
});

test('tarification : augmenter les prix fonctionne aussi', async (t) => {
  const { app } = await buildApp();
  t.after(() => app.close());
  const before = (await app.inject({ method: 'POST', url: '/pricing/estimate', payload: { origin, destination, category: 'or' } })).json().quote.amount as number;
  await app.inject({ method: 'PUT', url: '/admin/pricing', headers: AUTH, payload: { perKm: 400 } });
  const after = (await app.inject({ method: 'POST', url: '/pricing/estimate', payload: { origin, destination, category: 'or' } })).json().quote.amount as number;
  assert.ok(after > before);
});

test('RBAC : jeton inconnu refusé (401)', async (t) => {
  const { app } = await buildApp();
  t.after(() => app.close());
  const res = await app.inject({ method: 'GET', url: '/admin/pricing', headers: { 'x-admin-token': 'mauvais' } });
  assert.equal(res.statusCode, 401);
});
