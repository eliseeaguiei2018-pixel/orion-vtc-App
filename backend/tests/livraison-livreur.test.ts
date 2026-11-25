import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';

/**
 * LIVREURS MOTO dans Orion Pro (l'app des chauffeurs) : un livreur s'inscrit comme tel, reçoit
 * les livraisons (jamais les courses de passagers), voit le colis et son destinataire, et ne
 * déclare un colis livré qu'avec le code de remise que le destinataire lui donne.
 */
const AUTH = { 'x-admin-token': 'orion-admin-dev' };
const POS = { lat: 5.336, lng: -4.031 };
const RETRAIT = { lat: 5.335, lng: -4.03 };
const DEPOT = { lat: 5.345, lng: -4.02 };

async function inscrire(app: FastifyInstance, phone: string, name: string, category?: string) {
  const otp = (await app.inject({ method: 'POST', url: '/drivers/auth/otp', payload: { phone } })).json();
  const r = await app.inject({ method: 'POST', url: '/drivers/auth/verify', payload: { phone, code: otp.devCode, name, ...(category ? { category } : {}) } });
  assert.equal(r.statusCode, 201, r.body);
  const v = r.json();
  await app.inject({ method: 'POST', url: `/admin/drivers/${v.driver.id}/kyc`, headers: AUTH, payload: { status: 'active' } });
  await app.inject({ method: 'POST', url: `/drivers/${v.driver.id}/online`, headers: { authorization: `Bearer ${v.token}` }, payload: { position: POS } });
  return { id: v.driver.id as string, category: v.driver.category as string, h: { authorization: `Bearer ${v.token}` } };
}

async function expediteur(app: FastifyInstance, phone: string, name: string) {
  const o = (await app.inject({ method: 'POST', url: '/clients/auth/otp', payload: { phone } })).json();
  const v = (await app.inject({ method: 'POST', url: '/clients/auth/verify', payload: { clientId: `c-${phone}`, phone, code: o.devCode, name } })).json();
  return { id: v.client.id as string, h: { authorization: `Bearer ${v.token}` } };
}

test('livreur moto : inscription, colis et destinataire, remise avec le code du destinataire', async (t) => {
  const { app } = await buildApp();
  t.after(() => app.close());
  const chauffeur = await inscrire(app, '0701020311', 'Konan Yao');
  const livreur = await inscrire(app, '0701020322', 'Moussa Traoré', 'moto');
  assert.equal(chauffeur.category, 'argent');
  assert.equal(livreur.category, 'moto', 'le livreur s’inscrit comme livreur moto');
  const awa = await expediteur(app, '0707070711', 'Awa Bamba');

  const q = (await app.inject({ method: 'POST', url: '/pricing/estimate', payload: { serviceType: 'delivery', origin: RETRAIT, destination: DEPOT, category: 'petit' } })).json().quote;
  const r = await app.inject({
    method: 'POST', url: '/rides', headers: { 'idempotency-key': 'liv-1', ...awa.h },
    payload: {
      clientId: awa.id, lockId: q.lockId, paymentMethod: 'cash',
      livraison: { destinataire: { nom: 'Fatou Koné', telephone: '07 08 09 10 11' }, description: 'Enveloppe de documents', instructions: 'Immeuble bleu, 2e étage' },
    },
  });
  assert.equal(r.statusCode, 201, r.body);
  const { ride, codeRemise, codePriseEnCharge } = r.json() as { ride: { id: string; driverId?: string }; codeRemise: string | null; codePriseEnCharge: string | null };
  assert.equal(ride.driverId, livreur.id, 'la livraison va au livreur moto, pas au chauffeur');
  assert.match(codeRemise!, /^\d{4}$/, 'code de remise donné à l’expéditeur');
  assert.equal(codePriseEnCharge, null);

  // Le livreur voit le colis et le destinataire, jamais le code.
  const vue = await app.inject({ method: 'GET', url: `/drivers/${livreur.id}/active-ride`, headers: livreur.h });
  const liv = vue.json().ride.livraison;
  assert.equal(liv.destinataire.nom, 'Fatou Koné');
  assert.equal(liv.destinataire.telephone, '+2250708091011');
  assert.equal(liv.description, 'Enveloppe de documents');
  assert.equal(liv.codeRemiseRequis, true);
  assert.equal(vue.body.includes(`"${codeRemise}"`), false);
  assert.equal((await app.inject({ method: 'GET', url: `/rides/${ride.id}/code-remise`, headers: livreur.h })).statusCode, 403);
  const lu = await app.inject({ method: 'GET', url: `/rides/${ride.id}/code-remise`, headers: awa.h });
  assert.equal(lu.json().code, codeRemise, 'l’expéditeur relit son code');

  for (const to of ['driver_en_route', 'arrived', 'in_progress']) {
    const s = await app.inject({ method: 'POST', url: `/rides/${ride.id}/transition`, headers: livreur.h, payload: { to } });
    assert.equal(s.statusCode, 200, `${to} : ${s.body}`);
  }
  const sansCode = await app.inject({ method: 'POST', url: `/rides/${ride.id}/transition`, headers: livreur.h, payload: { to: 'completed' } });
  assert.equal(sansCode.statusCode, 409, 'pas de « livré » sans le code');
  const faux = codeRemise === '9876' ? '9875' : '9876';
  const mauvais = await app.inject({ method: 'POST', url: `/rides/${ride.id}/livrer`, headers: livreur.h, payload: { code: faux } });
  assert.equal(mauvais.statusCode, 400);
  assert.equal(mauvais.json().essaisRestants, 4);
  assert.equal((await app.inject({ method: 'POST', url: `/rides/${ride.id}/livrer`, headers: chauffeur.h, payload: { code: codeRemise } })).statusCode, 403, 'un autre conducteur ne peut pas livrer');
  const ok = await app.inject({ method: 'POST', url: `/rides/${ride.id}/livrer`, headers: livreur.h, payload: { code: codeRemise } });
  assert.equal(ok.statusCode, 200, ok.body);
  assert.equal(ok.json().ride.status, 'completed');
});

test('livraison : numéro du destinataire contrôlé', async (t) => {
  const { app } = await buildApp();
  t.after(() => app.close());
  await inscrire(app, '0701020333', 'Ali Sanogo', 'moto');
  const awa = await expediteur(app, '0707070722', 'Awa Diallo');
  const q = (await app.inject({ method: 'POST', url: '/pricing/estimate', payload: { serviceType: 'delivery', origin: RETRAIT, destination: DEPOT } })).json().quote;
  const r = await app.inject({
    method: 'POST', url: '/rides', headers: { 'idempotency-key': 'liv-2', ...awa.h },
    payload: { clientId: awa.id, lockId: q.lockId, livraison: { destinataire: { nom: 'X', telephone: 'abcdefgh' } } },
  });
  assert.equal(r.statusCode, 400);
});
