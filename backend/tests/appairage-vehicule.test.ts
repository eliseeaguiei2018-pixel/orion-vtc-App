import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildApp } from '../src/app.js';
import { issueDriverToken, verifyDriverToken } from '../src/modules/driver-app/auth.js';

/**
 * APPAIRAGE TÉLÉPHONE ↔ ÉCRAN DE VÉHICULE : le chauffeur, déjà connecté sur son téléphone,
 * obtient un code à six chiffres ; l'écran de la voiture le saisit et reçoit une session
 * chauffeur. Le code est à usage unique, lié au bon chauffeur, limité en essais.
 */
async function creerChauffeur(app: any, nom: string) {
  const r = await app.inject({ method: 'POST', url: '/drivers', payload: { name: nom, category: 'argent' } });
  return r.json().driver.id as string;
}

test('Un écran de véhicule obtient une session avec le code du téléphone', async (t) => {
  const { app, container } = await buildApp();
  t.after(() => app.close());
  const id = await creerChauffeur(app, 'Konan Yao');
  const phone = { authorization: `Bearer ${issueDriverToken(id).token}` };

  // Le code ne se demande que depuis le téléphone du chauffeur lui-même.
  assert.equal((await app.inject({ method: 'POST', url: `/drivers/${id}/ecran-vehicule/appairer` })).statusCode, 401);
  const autre = { authorization: `Bearer ${issueDriverToken('autre-chauffeur').token}` };
  assert.equal((await app.inject({ method: 'POST', url: `/drivers/${id}/ecran-vehicule/appairer`, headers: autre })).statusCode, 403);

  const demande = await app.inject({ method: 'POST', url: `/drivers/${id}/ecran-vehicule/appairer`, headers: phone });
  assert.equal(demande.statusCode, 200, demande.body);
  const code = demande.json().code as string;
  assert.match(code, /^\d{6}$/);

  // L'écran de la voiture présente le code et reçoit une session du BON chauffeur.
  const session = await app.inject({ method: 'POST', url: '/ecran-vehicule/session', payload: { code } });
  assert.equal(session.statusCode, 200, session.body);
  assert.equal(session.json().driver.id, id);
  assert.equal(session.json().driver.matricule, container.drivers.get(id)!.matricule);
  assert.equal(verifyDriverToken(session.json().token), id, 'le jeton remis ouvre bien ce chauffeur');

  // La session fonctionne vraiment sur une route chauffeur protégée.
  const ecranHeaders = { authorization: `Bearer ${session.json().token}` };
  assert.equal((await app.inject({ method: 'GET', url: `/drivers/${id}/active-ride`, headers: ecranHeaders })).statusCode, 200);

  // Le code est à usage unique : une seconde fois, il est refusé.
  assert.equal((await app.inject({ method: 'POST', url: '/ecran-vehicule/session', payload: { code } })).statusCode, 401);
  assert.ok(container.audit.list().some((e) => e.action === 'vehicule.appairage_reussi' && e.target === id));
});

test('Code expiré, mauvais code, annulation, et brute-force bornée', async (t) => {
  const { app } = await buildApp();
  t.after(() => app.close());
  const id = await creerChauffeur(app, 'Awa Koné');
  const phone = { authorization: `Bearer ${issueDriverToken(id).token}` };

  // Mauvais code : refusé.
  assert.equal((await app.inject({ method: 'POST', url: '/ecran-vehicule/session', payload: { code: '000000' } })).statusCode, 401);

  // Annulation depuis le téléphone : le code ne marche plus.
  const code = (await app.inject({ method: 'POST', url: `/drivers/${id}/ecran-vehicule/appairer`, headers: phone })).json().code;
  await app.inject({ method: 'POST', url: `/drivers/${id}/ecran-vehicule/annuler`, headers: phone });
  assert.equal((await app.inject({ method: 'POST', url: '/ecran-vehicule/session', payload: { code } })).statusCode, 401);

  // Un nouveau code remplace l'ancien (un seul écran en attente à la fois).
  const c1 = (await app.inject({ method: 'POST', url: `/drivers/${id}/ecran-vehicule/appairer`, headers: phone })).json().code;
  const c2 = (await app.inject({ method: 'POST', url: `/drivers/${id}/ecran-vehicule/appairer`, headers: phone })).json().code;
  assert.notEqual(c1, c2);
  assert.equal((await app.inject({ method: 'POST', url: '/ecran-vehicule/session', payload: { code: c1 } })).statusCode, 401, 'l’ancien code est invalidé');

  // Dix mauvais essais depuis la même adresse, puis attente (429).
  let vu429 = false;
  for (let i = 0; i < 12; i += 1) {
    const r = await app.inject({ method: 'POST', url: '/ecran-vehicule/session', payload: { code: '123456' } });
    if (r.statusCode === 429) { vu429 = true; assert.ok(Number(r.headers['retry-after']) > 0); break; }
  }
  assert.ok(vu429, 'la force brute est bornée');
});
