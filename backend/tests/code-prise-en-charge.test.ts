import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';

/**
 * CODE DE PRISE EN CHARGE : le passager voit un code à 4 chiffres dans son app, le donne
 * au chauffeur, qui le saisit pour démarrer. Le chauffeur ne peut ni le lire, ni démarrer
 * sans lui ; cinq erreurs bloquent la saisie et préviennent le passager.
 */
const AUTH = { 'x-admin-token': 'orion-admin-dev' };
const POS = { lat: 5.336, lng: -4.031 };
const ORIGIN = { lat: 5.335, lng: -4.03 };
const DEST = { lat: 5.345, lng: -4.02 };

async function chauffeur(app: FastifyInstance, phone: string, name: string) {
  const otp = (await app.inject({ method: 'POST', url: '/drivers/auth/otp', payload: { phone } })).json();
  const v = (await app.inject({ method: 'POST', url: '/drivers/auth/verify', payload: { phone, code: otp.devCode, name } })).json();
  await app.inject({ method: 'POST', url: `/admin/drivers/${v.driver.id}/kyc`, headers: AUTH, payload: { status: 'active' } });
  await app.inject({ method: 'POST', url: `/drivers/${v.driver.id}/online`, headers: { authorization: `Bearer ${v.token}` }, payload: { position: POS } });
  return { id: v.driver.id as string, h: { authorization: `Bearer ${v.token}` } };
}

async function passager(app: FastifyInstance, phone: string, name: string) {
  const o = (await app.inject({ method: 'POST', url: '/clients/auth/otp', payload: { phone } })).json();
  const v = (await app.inject({ method: 'POST', url: '/clients/auth/verify', payload: { clientId: `c-${phone}`, phone, code: o.devCode, name } })).json();
  return { id: v.client.id as string, h: { authorization: `Bearer ${v.token}` } };
}

async function commander(app: FastifyInstance, client: { id: string; h: Record<string, string> }, cle: string, extra: Record<string, unknown> = { category: 'bronze' }) {
  const q = (await app.inject({ method: 'POST', url: '/pricing/estimate', payload: { origin: ORIGIN, destination: DEST, ...extra } })).json().quote;
  const r = await app.inject({ method: 'POST', url: '/rides', headers: { 'idempotency-key': cle, ...client.h }, payload: { clientId: client.id, lockId: q.lockId } });
  assert.equal(r.statusCode, 201, r.body);
  return r.json() as { ride: { id: string; driverId?: string }; codePriseEnCharge: string | null };
}

test('code de prise en charge : seul le passager le voit, le chauffeur le saisit pour démarrer', async (t) => {
  const { app, container } = await buildApp();
  t.after(() => app.close());
  const k = await chauffeur(app, '0701020399', 'Konan Yao');
  const aya = await passager(app, '0707070799', 'Aya Kouassi');

  const recus: Array<{ type: string; data: unknown }> = [];
  container.realtime.subscribe('tableau', (m) => recus.push({ type: m.type, data: m.data }));

  const { ride, codePriseEnCharge: code } = await commander(app, aya, 'code-1');
  assert.equal(ride.driverId, k.id);
  assert.match(code!, /^\d{4}$/, 'code à 4 chiffres remis au passager à la commande');

  // Le code n'apparaît dans aucune réponse lisible par le chauffeur ou par un tiers.
  const publique = await app.inject({ method: 'GET', url: `/rides/${ride.id}` });
  assert.equal(publique.body.includes(code!), false, 'pas dans la vue de la course');
  const active = await app.inject({ method: 'GET', url: `/drivers/${k.id}/active-ride`, headers: k.h });
  assert.equal(active.json().ride.codeRequis, true);
  assert.equal(active.body.includes(`"${code}"`), false, 'pas dans la vue chauffeur');
  assert.equal((await app.inject({ method: 'GET', url: `/rides/${ride.id}/code`, headers: k.h })).statusCode, 403, 'chauffeur refusé');
  assert.equal((await app.inject({ method: 'GET', url: `/rides/${ride.id}/code` })).statusCode, 401, 'sans session refusé');
  // Le passager connecté le relit (reprise de l'app).
  const lu = await app.inject({ method: 'GET', url: `/rides/${ride.id}/code`, headers: aya.h });
  assert.equal(lu.statusCode, 200, lu.body);
  assert.equal(lu.json().code, code);

  // Le chauffeur ne peut pas démarrer sans le code, ni avant d'être arrivé.
  for (const to of ['driver_en_route', 'arrived']) {
    assert.equal((await app.inject({ method: 'POST', url: `/rides/${ride.id}/transition`, headers: k.h, payload: { to } })).statusCode, 200);
  }
  const sansCode = await app.inject({ method: 'POST', url: `/rides/${ride.id}/transition`, headers: k.h, payload: { to: 'in_progress' } });
  assert.equal(sansCode.statusCode, 409, 'transition directe refusée');

  // Mauvais code : refus, essais restants annoncés.
  const faux = code === '9876' ? '9875' : '9876';
  const r1 = await app.inject({ method: 'POST', url: `/rides/${ride.id}/start`, headers: k.h, payload: { code: faux } });
  assert.equal(r1.statusCode, 400);
  assert.equal(r1.json().essaisRestants, 4);
  assert.equal((await app.inject({ method: 'POST', url: `/rides/${ride.id}/start`, headers: k.h, payload: { code: '12' } })).statusCode, 400, '4 chiffres exigés');

  // Bon code : la course démarre, l'identité est confirmée.
  const ok = await app.inject({ method: 'POST', url: `/rides/${ride.id}/start`, headers: k.h, payload: { code } });
  assert.equal(ok.statusCode, 200, ok.body);
  assert.equal(ok.json().ride.status, 'in_progress');
  assert.equal((await app.inject({ method: 'GET', url: `/rides/${ride.id}/code`, headers: aya.h })).json().verifie, true);
  const titres = recus.map((m) => (m.data as { titre?: string }).titre ?? '');
  assert.ok(titres.some((x) => x.startsWith('Code de prise en charge erroné')), titres.join(' | '));
  assert.ok(titres.some((x) => x.startsWith('Identité confirmée par code · Aya K.')), titres.join(' | '));
});

test('code de prise en charge : cinq erreurs bloquent la saisie et préviennent le passager', async (t) => {
  const { app, container } = await buildApp();
  t.after(() => app.close());
  const k = await chauffeur(app, '0701020398', 'Awa Diomandé');
  const aya = await passager(app, '0707070798', 'Aya Kouassi');
  const { ride, codePriseEnCharge: code } = await commander(app, aya, 'code-2');
  for (const to of ['driver_en_route', 'arrived']) await app.inject({ method: 'POST', url: `/rides/${ride.id}/transition`, headers: k.h, payload: { to } });
  const faux = code === '0001' ? '0002' : '0001';
  const codes: number[] = [];
  for (let i = 0; i < 5; i++) codes.push((await app.inject({ method: 'POST', url: `/rides/${ride.id}/start`, headers: k.h, payload: { code: faux } })).statusCode);
  assert.deepEqual(codes, [400, 400, 400, 400, 423]);
  // Même le bon code ne passe plus : la supervision doit intervenir.
  assert.equal((await app.inject({ method: 'POST', url: `/rides/${ride.id}/start`, headers: k.h, payload: { code } })).statusCode, 423);
  assert.ok(container.messages.liste(aya.id).some((m) => m.titre === 'Code de prise en charge bloqué'), 'passager prévenu');
  assert.ok(container.audit.list(50).some((e) => e.action === 'ride.code_bloque'));
  // Un autre chauffeur ne peut pas tenter sa chance.
  const intrus = await chauffeur(app, '0701020397', 'Intrus');
  assert.equal((await app.inject({ method: 'POST', url: `/rides/${ride.id}/start`, headers: intrus.h, payload: { code } })).statusCode, 403);
});

test('code de prise en charge : pas de code pour un colis, simulation sans blocage', async (t) => {
  const { app, container } = await buildApp();
  t.after(() => app.close());
  const aya = await passager(app, '0707070797', 'Aya Kouassi');
  const coursier = (await app.inject({ method: 'POST', url: '/drivers', payload: { name: 'Yacouba Ouattara', category: 'moto' } })).json().driver.id;
  await app.inject({ method: 'POST', url: `/drivers/${coursier}/online`, payload: { position: POS } });
  const colis = await commander(app, aya, 'code-3', { serviceType: 'delivery', category: 'petit' });
  assert.equal(colis.codePriseEnCharge, null, 'une livraison n’a pas de code passager');
  assert.equal(container.codesPriseEnCharge.requis(colis.ride.id), false);

  // Le simulateur (développement) tient le rôle du chauffeur qui saisit le code.
  const id = 'simulee-1';
  container.codesPriseEnCharge.creer(id);
  assert.equal(container.codesPriseEnCharge.requis(id), true);
  container.codesPriseEnCharge.marquerSimule(id);
  assert.equal(container.codesPriseEnCharge.requis(id), false);
  assert.equal(container.codesPriseEnCharge.lire(id)?.par, 'simulation');
});
