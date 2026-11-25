import { test } from 'node:test';
import assert from 'node:assert/strict';

/**
 * COMPTE DE VÉRIFICATION APP STORE / GOOGLE PLAY.
 *
 * Les vérificateurs d'Apple et de Google ne reçoivent pas nos SMS : sans compte de
 * démonstration utilisable, l'app est refusée. Un seul numéro, désigné par la
 * configuration, accepte un code fixe — en production, sans jamais renvoyer le code.
 */
process.env.NODE_ENV = 'production';
process.env.CLIENT_REVIEW_PHONE = '+225 01 00 00 00 01';
process.env.CLIENT_REVIEW_CODE = '424242';
process.env.ADMIN_JWT_SECRET = 'secret-de-test-suffisamment-long-pour-la-production';
// Production complète : le serveur refuse de démarrer avec un secret public du dépôt.
process.env.DRIVER_JWT_SECRET = 'secret-chauffeur-de-test-suffisamment-long-0001';
process.env.CLIENT_JWT_SECRET = 'secret-client-de-test-suffisamment-long-00000001';
process.env.ADMIN_TOKEN = 'jeton-admin-de-test-suffisamment-long';
process.env.ADMIN_PASSWORD = 'Mot-de-passe-de-test-2026';

test('le numéro de vérification accepte le code fixe ; tout autre numéro reste un vrai code SMS', async (t) => {
  const { buildApp } = await import('../src/app.js');
  const { app } = await buildApp();
  t.after(() => app.close());

  const revue = await app.inject({ method: 'POST', url: '/clients/auth/otp', payload: { phone: '0100000001' } });
  assert.equal(revue.statusCode, 200, revue.body);
  assert.equal(revue.json().devCode, undefined, 'en production, aucun code ne revient dans la réponse');
  const ok = await app.inject({ method: 'POST', url: '/clients/auth/verify', payload: { clientId: 'client-revue', phone: '0100000001', code: '424242', name: 'Vérification App Store' } });
  assert.equal(ok.statusCode, 200, ok.body);

  await app.inject({ method: 'POST', url: '/clients/auth/otp', payload: { phone: '0712345678' } });
  const autre = await app.inject({ method: 'POST', url: '/clients/auth/verify', payload: { clientId: 'client-x', phone: '0712345678', code: '424242', name: 'Quelqu’un' } });
  assert.equal(autre.statusCode, 401, 'le code fixe ne vaut que pour le numéro de vérification');
});
