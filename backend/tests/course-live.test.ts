import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { minutesFacturees } from '../src/modules/rides/courseLive.js';

/**
 * LA COURSE EN DIRECT : arrêts prévus et arrêts demandés facturés à la minute et tracés des
 * deux côtés ; chat avec réponses toutes prêtes à l'arrivée ; appel par internet ; espèces
 * autorisées par le chauffeur quand le moyen choisi ne passe pas.
 */
const AUTH = { 'x-admin-token': 'orion-admin-dev' };
const POS = { lat: 5.336, lng: -4.031 };
const ORIGIN = { lat: 5.335, lng: -4.03 };
const ARRET = { lat: 5.338, lng: -4.026 };
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

test('minutes d’arrêt : 15 s de tolérance, puis chaque minute entamée', () => {
  assert.equal(minutesFacturees(0, 10_000), 0);
  assert.equal(minutesFacturees(0, 20_000), 1);
  assert.equal(minutesFacturees(0, 75_000), 1);
  assert.equal(minutesFacturees(0, 76_000), 2);
  assert.equal(minutesFacturees(0, 5 * 60_000 + 15_000), 5);
});

test('arrêts, chat, appel par internet et espèces de secours, d’un bout à l’autre', async (t) => {
  const { app, container } = await buildApp();
  t.after(() => app.close());
  const k = await chauffeur(app, '0701020488', 'Konan Yao');
  const aya = await passager(app, '0707070488', 'Aya Kouassi');
  const autre = await passager(app, '0707070489', 'Intrus');
  const evts: string[] = [];
  container.realtime.subscribeAll((m) => { if (/^(ride\.arrets|chat\.message|appel\.etat|paiement\.especes)$/.test(m.type)) evts.push(m.type); });

  const q = (await app.inject({ method: 'POST', url: '/pricing/estimate', payload: { origin: ORIGIN, destination: DEST, stops: [ARRET], category: 'argent' } })).json().quote;
  const cree = await app.inject({ method: 'POST', url: '/rides', headers: { 'idempotency-key': 'live-1', ...aya.h }, payload: { clientId: aya.id, lockId: q.lockId, paymentMethod: 'wave', nomsArrets: ['Pharmacie de la Riviera'] } });
  assert.equal(cree.statusCode, 201, cree.body);
  const { ride, codePriseEnCharge } = cree.json() as { ride: { id: string; driverId: string }; codePriseEnCharge: string };
  assert.equal(ride.driverId, k.id);
  const id = ride.id;

  for (const to of ['driver_en_route', 'arrived']) {
    assert.equal((await app.inject({ method: 'POST', url: `/rides/${id}/transition`, headers: k.h, payload: { to } })).statusCode, 200);
  }
  // Arrivée : ORION l'annonce dans le chat ; le client répond d'un toucher, le chauffeur est prévenu.
  const chat0 = (await app.inject({ method: 'GET', url: `/rides/${id}/chat`, headers: aya.h })).json();
  assert.match(chat0.messages[0].texte, /chauffeur est arrivé/);
  assert.deepEqual(Object.keys(chat0.rapides), ['sors', 'retard']);
  const sors = await app.inject({ method: 'POST', url: `/rides/${id}/chat`, headers: aya.h, payload: { rapide: 'sors' } });
  assert.equal(sors.json().message.texte, 'J’arrive, je sors tout de suite');
  assert.equal(sors.json().message.de, 'client');
  assert.equal((await app.inject({ method: 'POST', url: `/rides/${id}/chat`, headers: k.h, payload: { rapide: 'retard' } })).statusCode, 403, 'les réponses toutes prêtes sont celles du client');
  assert.equal((await app.inject({ method: 'POST', url: `/rides/${id}/chat`, headers: k.h, payload: { texte: 'Je suis devant le portail bleu' } })).statusCode, 200);
  assert.equal((await app.inject({ method: 'GET', url: `/rides/${id}/chat`, headers: autre.h })).statusCode, 403, 'personne d’autre ne lit la discussion');
  const chat = (await app.inject({ method: 'GET', url: `/rides/${id}/chat`, headers: k.h })).json();
  assert.deepEqual(chat.messages.map((m: { de: string }) => m.de), ['orion', 'client', 'chauffeur']);

  // Appel par internet : le client appelle, le chauffeur décroche, puis raccroche.
  const appel = await app.inject({ method: 'POST', url: `/rides/${id}/appel`, headers: aya.h, payload: { action: 'appeler' } });
  assert.equal(appel.json().etat, 'sonne');
  assert.equal((await app.inject({ method: 'POST', url: `/rides/${id}/appel`, headers: aya.h, payload: { action: 'decrocher' } })).statusCode, 400, 'on ne décroche pas son propre appel');
  assert.equal((await app.inject({ method: 'POST', url: `/rides/${id}/appel`, headers: k.h, payload: { action: 'decrocher' } })).json().etat, 'en_cours');
  assert.equal((await app.inject({ method: 'POST', url: `/rides/${id}/appel`, headers: k.h, payload: { action: 'raccrocher' } })).json().etat, 'fini');
  assert.equal((await app.inject({ method: 'POST', url: `/rides/${id}/appel`, headers: autre.h, payload: { action: 'appeler' } })).statusCode, 403);

  // Démarrage avec le code, puis l'arrêt prévu (déclaré d'un clic) et un arrêt demandé de vive voix.
  assert.equal((await app.inject({ method: 'POST', url: `/rides/${id}/start`, headers: k.h, payload: { code: codePriseEnCharge } })).statusCode, 200);
  assert.equal((await app.inject({ method: 'POST', url: `/rides/${id}/arrets`, headers: aya.h, payload: { type: 'demande' } })).statusCode, 403, 'seul le chauffeur déclare un arrêt');
  const a1 = await app.inject({ method: 'POST', url: `/rides/${id}/arrets`, headers: k.h, payload: { type: 'prevu', index: 0, position: ARRET } });
  assert.equal(a1.statusCode, 200, a1.body);
  assert.equal(a1.json().enCours.nom, 'Pharmacie de la Riviera');
  assert.equal((await app.inject({ method: 'POST', url: `/rides/${id}/arrets`, headers: k.h, payload: { type: 'demande' } })).statusCode, 409, 'un arrêt à la fois');
  // Le compteur tourne : on avance l'horloge de l'arrêt de 3 min 30 s.
  const brut = container.rides.get(id) as unknown as { arrets: Array<{ debut: string }> };
  brut.arrets[0]!.debut = new Date(Date.now() - 210_000).toISOString();
  const f1 = (await app.inject({ method: 'POST', url: `/rides/${id}/arrets/fin`, headers: k.h })).json();
  assert.equal(f1.minutes, 4, '3 min 30 s → 4 minutes entamées (après 15 s de tolérance)');
  assert.equal(f1.montant, 400, '100 F la minute');
  assert.equal(f1.prevus[0].fait, true);
  assert.equal((await app.inject({ method: 'POST', url: `/rides/${id}/arrets`, headers: k.h, payload: { type: 'prevu', index: 0 } })).statusCode, 409, 'arrêt prévu déjà marqué');
  assert.equal((await app.inject({ method: 'POST', url: `/rides/${id}/arrets`, headers: k.h, payload: { type: 'demande' } })).statusCode, 200);
  brut.arrets[1]!.debut = new Date(Date.now() - 125_000).toISOString();
  // Fin de course pendant l'arrêt demandé : il se ferme et compte (2 min).
  assert.equal((await app.inject({ method: 'POST', url: `/rides/${id}/transition`, headers: k.h, payload: { to: 'completed' } })).statusCode, 200);
  const vueClient = (await app.inject({ method: 'GET', url: `/rides/${id}/arrets`, headers: aya.h })).json();
  assert.equal(vueClient.montant, 600, 'les deux arrêts : 4 + 2 minutes');
  assert.equal(vueClient.enCours, null);
  const vueChauffeur = (await app.inject({ method: 'GET', url: `/drivers/${k.id}/rides`, headers: k.h })).json();
  const r = (vueChauffeur.rides ?? vueChauffeur).find?.((x: { id: string }) => x.id === id);
  if (r) assert.equal(r.encaissement.brut, q.amount + 600, 'le chauffeur voit le prix avec les arrêts');

  // Wave ne passe pas : le chauffeur autorise les espèces, le client confirme, le paiement inclut les arrêts.
  assert.equal((await app.inject({ method: 'POST', url: `/rides/${id}/especes/confirmer`, headers: aya.h })).statusCode, 409, 'pas avant l’autorisation');
  assert.equal((await app.inject({ method: 'POST', url: `/rides/${id}/especes/autoriser`, headers: aya.h })).statusCode, 403, 'c’est le chauffeur qui autorise');
  assert.equal((await app.inject({ method: 'POST', url: `/rides/${id}/especes/autoriser`, headers: k.h })).statusCode, 200);
  const conf = await app.inject({ method: 'POST', url: `/rides/${id}/especes/confirmer`, headers: aya.h }); assert.equal(conf.statusCode, 200, conf.body);
  const pay = await app.inject({ method: 'POST', url: `/rides/${id}/pay`, headers: { 'idempotency-key': 'live-pay' }, payload: { method: 'cash' } });
  assert.equal(pay.statusCode, 200, pay.body);
  assert.equal(pay.json().payment.amount, q.amount + 600);

  for (const e of ['chat.message', 'appel.etat', 'ride.arrets', 'paiement.especes']) assert.ok(evts.includes(e), `${e} diffusé en direct`);
  const types = container.rides.get(id)!.events.map((e) => e.type);
  for (const e of ['arret_debut', 'arret_fin', 'appel', 'especes_autorisees', 'especes_client']) assert.ok(types.includes(e), `${e} tracé dans la course`);
});
