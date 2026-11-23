import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildApp } from '../src/app.js';
import { OtpStore, type OtpEnregistre } from '../src/modules/driver-app/auth.js';

/**
 * CODE DE CONNEXION D'ORION PRO : le code donné par la console (testeur invité) marche toute sa
 * durée de validité, même si le code envoyé a expiré ou si le serveur a redémarré entre la
 * demande et la saisie ; un code SMS ordinaire survit lui aussi à un redémarrage du serveur.
 */
const AUTH = { 'x-admin-token': 'orion-admin-dev' };

test('ORION Pro : le code donné par la console est accepté, même sans demande en cours', async (t) => {
  const { app } = await buildApp();
  t.after(() => app.close());
  const inv = await app.inject({ method: 'POST', url: '/admin/testeurs', headers: AUTH, payload: { phone: '07 08 31 05 92', nom: 'Chauffeur testeur' } });
  assert.equal(inv.statusCode, 200, inv.body);
  const code = inv.json().acces?.code ?? inv.json().testeur?.code ?? inv.json().code;
  assert.match(String(code), /^\d{6}$/);
  // Aucun code demandé (redémarrage du serveur, ou code expiré) : le code de la console suffit.
  const v = await app.inject({ method: 'POST', url: '/drivers/auth/verify', payload: { phone: '0708310592', code, name: 'Chauffeur Testeur' } });
  assert.equal(v.statusCode, 201, v.body);
  // Un mauvais code reste refusé, et cinq erreurs bloquent ce recours.
  const faux = code === '000001' ? '000002' : '000001';
  for (let i = 0; i < 5; i++) {
    const r = await app.inject({ method: 'POST', url: '/drivers/auth/verify', payload: { phone: '0708310592', code: faux } });
    assert.equal(r.statusCode, 401);
  }
  const bloque = await app.inject({ method: 'POST', url: '/drivers/auth/verify', payload: { phone: '0708310592', code } });
  assert.equal(bloque.statusCode, 401, 'après cinq erreurs, même le bon code attend un quart d’heure');
});

test('codes SMS : gardés en base sous forme d’empreinte, ils survivent à un redémarrage', () => {
  const memoire = new Map<string, OtpEnregistre>();
  const depot = { get: (id: string) => memoire.get(id), put: (o: OtpEnregistre) => { memoire.set(o.id, o); }, delete: (id: string) => { memoire.delete(id); }, all: () => [...memoire.values()] };
  const avant = new OtpStore(depot);
  const emis = avant.issue('+2250708310592');
  assert.ok('code' in emis);
  const code = (emis as { code: string }).code;
  assert.equal(JSON.stringify([...memoire.values()]).includes(`"${code}"`), false, 'aucun code en clair dans la base');
  // Redémarrage du serveur : un nouveau magasin relit les codes en attente.
  const apres = new OtpStore(depot);
  assert.equal(apres.verify('+2250708310592', code), 'ok');
  assert.equal(memoire.size, 0, 'code détruit après usage');
  assert.equal(apres.verify('+2250708310592', code), 'expired');
});
