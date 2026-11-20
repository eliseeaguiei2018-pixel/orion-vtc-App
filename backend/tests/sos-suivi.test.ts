import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildApp } from '../src/app.js';

/**
 * SOS — CE QUE VOIT LA PERSONNE EN DÉTRESSE, ET QUI PEUT VOIR SON ALERTE.
 *
 * La console recevait tout ; l'usager, rien. Après avoir appuyé sur SOS, il lisait
 * « SAMU (185) notifié » alors qu'aucun numéro n'avait été composé, puis plus aucune
 * nouvelle : ni prise en charge, ni message, ni secours réellement prévenus. Dans
 * le même temps, la liste des alertes et le flux de supervision étaient publics.
 */
const JETON = { 'x-admin-token': 'orion-admin-dev' };
const ABIDJAN = { lat: 5.3236, lng: -4.0217 };

type App = Awaited<ReturnType<typeof buildApp>>['app'];

async function sos(app: App, userId = 'client-aya') {
  const r = await app.inject({ method: 'POST', url: '/safety/sos', payload: { userId, location: ABIDJAN } });
  assert.equal(r.statusCode, 201, r.body);
  return r.json() as { alert: { id: string }; suivi: { status: string; secours: unknown[]; priseEnCharge: unknown } };
}
const suivi = async (app: App, id: string, userId = 'client-aya') =>
  (await app.inject({ method: 'GET', url: `/safety/sos/${id}?userId=${userId}` })).json().suivi;

test('à l’envoi : reçu par la supervision, aucun secours annoncé à tort', async (t) => {
  const { app } = await buildApp();
  t.after(() => app.close());
  const r = await sos(app);
  assert.equal(r.suivi.status, 'raised');
  assert.deepEqual(r.suivi.secours, []);
  assert.equal(r.suivi.priseEnCharge, null);
});

test('l’usager suit sa prise en charge, les messages de l’agent, et peut répondre', async (t) => {
  const { app } = await buildApp();
  t.after(() => app.close());
  const { alert } = await sos(app);

  assert.equal((await app.inject({ method: 'POST', url: `/admin/sos/${alert.id}/claim`, headers: JETON })).statusCode, 200);
  let s = await suivi(app, alert.id);
  assert.equal(s.status, 'acknowledged');
  assert.ok(s.priseEnCharge, 'la prise en charge doit être visible');
  assert.equal(s.priseEnCharge.agent, 'Supervision ORION', 'un compte technique ne s’affiche pas « Super »');

  await app.inject({ method: 'POST', url: `/admin/sos/${alert.id}/message`, headers: JETON, payload: { text: 'Pouvez-vous parler librement ?' } });
  const rep = await app.inject({ method: 'POST', url: `/safety/sos/${alert.id}/message`, payload: { userId: 'client-aya', text: 'Non, envoyez la police' } });
  assert.equal(rep.statusCode, 200, rep.body);
  s = rep.json().suivi;
  assert.deepEqual(s.chat.map((m: { from: string }) => m.from), ['agent', 'usager']);

  // La console lit la réponse dans le dossier.
  const d = await app.inject({ method: 'GET', url: `/admin/sos/${alert.id}`, headers: JETON });
  assert.equal(d.json().alert.chat.at(-1).text, 'Non, envoyez la police');
});

test('appeler le SAMU depuis le poste l’annonce à l’usager ; appeler le passager, non', async (t) => {
  const { app } = await buildApp();
  t.after(() => app.close());
  const { alert } = await sos(app);

  const samu = await app.inject({ method: 'POST', url: `/admin/sos/${alert.id}/contact`, headers: JETON, payload: { canal: 'appel', contactId: 'samu' } });
  assert.equal(samu.statusCode, 200, samu.body);
  let s = await suivi(app, alert.id);
  assert.equal(s.status, 'dispatched');
  assert.equal(s.secours.length, 1);
  assert.equal(s.secours[0].numero, '185');
  assert.equal(s.secours[0].issue, 'tentative');

  await app.inject({ method: 'POST', url: `/admin/sos/${alert.id}/contact/${samu.json().entry.id}`, headers: JETON, payload: { issue: 'joint', compteRendu: 'Ambulance engagée' } });
  s = await suivi(app, alert.id);
  assert.equal(s.secours[0].issue, 'joint');
  assert.equal(JSON.stringify(s).includes('Ambulance engagée'), false, 'le compte rendu interne reste interne');

  await app.inject({ method: 'POST', url: `/admin/sos/${alert.id}/contact`, headers: JETON, payload: { canal: 'appel', numero: '+2250700000099', label: 'Numéro libre' } });
  assert.equal((await suivi(app, alert.id)).secours.length, 1, 'un appel hors secours n’est pas annoncé comme un secours');

  // La position envoyée par SMS à la police : annoncée comme un envoi, pas un appel.
  await app.inject({ method: 'POST', url: `/admin/sos/${alert.id}/contact`, headers: JETON, payload: { canal: 'sms', contactId: 'police', message: 'ORION · SOS — Position : https://maps.google.com/?q=5.32360,-4.02170' } });
  s = await suivi(app, alert.id);
  assert.equal(s.secours.length, 2);
  assert.equal(s.secours[1].numero, '170');
  assert.equal(s.secours[1].canal, 'sms');
});

test('alerte clôturée : l’usager le voit et ne peut plus écrire dans le vide', async (t) => {
  const { app } = await buildApp();
  t.after(() => app.close());
  const { alert } = await sos(app);
  await app.inject({ method: 'POST', url: `/admin/sos/${alert.id}/claim`, headers: JETON });
  await app.inject({ method: 'POST', url: `/admin/sos/${alert.id}/close`, headers: JETON, payload: { note: 'Fausse manipulation confirmée par la passagère.' } });
  assert.ok((await suivi(app, alert.id)).clotureeA);
  const r = await app.inject({ method: 'POST', url: `/safety/sos/${alert.id}/message`, payload: { userId: 'client-aya', text: 'Encore là ?' } });
  assert.equal(r.statusCode, 409);
});

test('personne d’autre que son auteur ne lit une alerte', async (t) => {
  const { app } = await buildApp();
  t.after(() => app.close());
  const { alert } = await sos(app);
  assert.equal((await app.inject({ method: 'GET', url: `/safety/sos/${alert.id}?userId=client-autre` })).statusCode, 404);
  assert.equal((await app.inject({ method: 'POST', url: `/safety/sos/${alert.id}/message`, payload: { userId: 'client-autre', text: 'coucou' } })).statusCode, 404);
});

test('la liste des alertes et leur statut ne sont plus publics', async (t) => {
  const { app } = await buildApp();
  t.after(() => app.close());
  const { alert } = await sos(app);
  assert.equal((await app.inject({ method: 'GET', url: '/safety/alerts' })).statusCode, 401);
  const forge = await app.inject({ method: 'POST', url: `/safety/alerts/${alert.id}/status`, payload: { status: 'resolved' } });
  assert.equal(forge.statusCode, 401, 'un inconnu ne doit pas pouvoir « résoudre » une détresse');
  assert.equal((await suivi(app, alert.id)).status, 'raised');
  assert.equal((await app.inject({ method: 'GET', url: '/safety/alerts', headers: JETON })).statusCode, 200);
});

test('temps réel : le flux de supervision exige une session, le suivi usager arrive en direct', async (t) => {
  const { app } = await buildApp();
  await app.listen({ port: 0, host: '127.0.0.1' });
  const { port } = app.server.address() as { port: number };
  t.after(() => app.close());

  // 1) Supervision sans session : refusée avant la mise à niveau.
  const anonyme = new WebSocket(`ws://127.0.0.1:${port}/ws/emergency`);
  const refus = await new Promise<string>((r) => {
    anonyme.addEventListener('open', () => r('ouvert'), { once: true });
    anonyme.addEventListener('error', () => r('refusé'), { once: true });
  });
  assert.equal(refus, 'refusé');

  // 2) Supervision avec le jeton du personnel : acceptée.
  const injecte = await app.injectWS('/ws/emergency', { headers: JETON });
  injecte.terminate();

  // 3) L'usager suit SON alerte et reçoit la prise en charge en direct.
  const { alert } = await sos(app);
  const trames: Array<{ type: string; suivi?: { status: string }; data?: { status: string; priseEnCharge: unknown } }> = [];
  const ws = new WebSocket(`ws://127.0.0.1:${port}/ws/sos/${alert.id}?userId=client-aya`);
  t.after(() => ws.close());
  ws.addEventListener('message', (ev) => trames.push(JSON.parse(String(ev.data))));
  await new Promise((r) => ws.addEventListener('open', () => r(null), { once: true }));
  const attendre = async (pred: () => boolean, quoi: string) => {
    for (let i = 0; i < 40 && !pred(); i++) await new Promise((r) => setTimeout(r, 50));
    assert.ok(pred(), `non reçu : ${quoi}`);
  };
  await attendre(() => trames.some((f) => f.type === 'connected' && f.suivi?.status === 'raised'), 'état initial');
  await app.inject({ method: 'POST', url: `/admin/sos/${alert.id}/claim`, headers: JETON });
  await attendre(() => trames.some((f) => f.type === 'sos.suivi' && f.data?.status === 'acknowledged' && f.data.priseEnCharge !== null), 'prise en charge');

  // 4) Quelqu'un d'autre ne peut pas s'abonner à cette alerte.
  const intrus = new WebSocket(`ws://127.0.0.1:${port}/ws/sos/${alert.id}?userId=client-autre`);
  const issue = await new Promise<string>((r) => {
    intrus.addEventListener('open', () => r('ouvert'), { once: true });
    intrus.addEventListener('error', () => r('refusé'), { once: true });
  });
  assert.equal(issue, 'refusé');
});
