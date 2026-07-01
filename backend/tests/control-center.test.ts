import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildApp } from '../src/app.js';

const AUTH = { 'x-admin-token': 'orion-admin-dev' };
const origin = { lat: 5.3236, lng: -4.0217 };
const destination = { lat: 5.3599, lng: -3.9876 };

test('code promo : réduit le prix de la course', async (t) => {
  const { app } = await buildApp();
  t.after(() => app.close());
  const full = (await app.inject({ method: 'POST', url: '/pricing/estimate', payload: { origin, destination, category: 'bronze' } })).json().quote.amount as number;
  await app.inject({ method: 'PUT', url: '/admin/promos', headers: AUTH, payload: { code: 'ORION20', kind: 'percent', value: 20 } });
  const withPromo = (await app.inject({ method: 'POST', url: '/pricing/estimate', payload: { origin, destination, category: 'bronze', promoCode: 'orion20' } })).json().quote.amount as number;
  assert.ok(withPromo < full, `${withPromo} < ${full}`);
});

test('gestion chauffeur : suspension KYC met hors-ligne', async (t) => {
  const { app, container } = await buildApp();
  t.after(() => app.close());
  const drv = await app.inject({ method: 'POST', url: '/drivers', payload: { name: 'Awa', category: 'bronze' } });
  const id = drv.json().driver.id as string;
  await app.inject({ method: 'POST', url: `/drivers/${id}/online`, payload: { position: { lat: 5.324, lng: -4.021 } } });
  const res = await app.inject({ method: 'POST', url: `/admin/drivers/${id}/kyc`, headers: AUTH, payload: { status: 'suspended' } });
  assert.equal(res.statusCode, 200);
  assert.equal(container.drivers.get(id)!.kycStatus, 'suspended');
  assert.equal(container.drivers.get(id)!.availability, 'offline');
});

test('services : activer Food se reflète dans /config public', async (t) => {
  const { app } = await buildApp();
  t.after(() => app.close());
  await app.inject({ method: 'PUT', url: '/admin/services', headers: AUTH, payload: { services: { food: true } } });
  const cfg = await app.inject({ method: 'GET', url: '/config' });
  assert.equal(cfg.json().services.food, true);
});

test('support : le client ouvre un chat, l’agent répond, journal alimenté', async (t) => {
  const { app } = await buildApp();
  t.after(() => app.close());
  const open = await app.inject({ method: 'POST', url: '/support/messages', payload: { clientId: 'client-42', text: 'Bonjour, une question' } });
  assert.equal(open.statusCode, 201);
  const convId = open.json().conversation.id as string;

  const list = await app.inject({ method: 'GET', url: '/admin/support', headers: AUTH });
  assert.ok(list.json().conversations.some((c: { id: string }) => c.id === convId));

  const reply = await app.inject({ method: 'POST', url: `/admin/support/${convId}/reply`, headers: AUTH, payload: { text: 'Bonjour, comment aider ?' } });
  assert.equal(reply.statusCode, 200);
  assert.equal(reply.json().message.from, 'agent');

  // Client apparaît + peut être bloqué
  const clients = await app.inject({ method: 'GET', url: '/admin/clients', headers: AUTH });
  assert.ok(clients.json().clients.some((c: { id: string }) => c.id === 'client-42'));
  const block = await app.inject({ method: 'POST', url: '/admin/clients/client-42/status', headers: AUTH, payload: { status: 'blocked' } });
  assert.equal(block.json().client.status, 'blocked');

  // Journal d'audit non vide
  const audit = await app.inject({ method: 'GET', url: '/admin/audit', headers: AUTH });
  assert.ok(audit.json().entries.length > 0);
});
