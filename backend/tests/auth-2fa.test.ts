import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scryptSync } from 'node:crypto';

/**
 * 2FA (TOTP) : on définit ADMIN_USERS AVANT tout import applicatif (la config
 * capture process.env au chargement), d'où les imports dynamiques dans les tests.
 */
const SALT = 'a1b2c3d4e5f6a7b8';
const HASH = scryptSync('Direction#2026', SALT, 32).toString('hex');
const TOTP_SECRET = 'JBSWY3DPEHPK3PXP'; // secret de test (base32)

process.env.ADMIN_USERS = JSON.stringify([
  { username: 'ceo', name: 'PDG ORION', role: 'ceo', salt: SALT, hash: HASH, totp: TOTP_SECRET },
  { username: 'cfo', name: 'Dir. Financier', role: 'cfo', salt: SALT, hash: HASH },
]);

test('2FA : mot de passe seul → mfaRequired ; code TOTP valide → session', async (t) => {
  const { buildApp } = await import('../src/app.js');
  const { totp } = await import('../src/modules/admin/auth.js');
  const { app } = await buildApp();
  t.after(() => app.close());

  // Étape 1 : mot de passe correct, pas de code → le serveur réclame la 2FA (pas de jeton).
  const step1 = await app.inject({ method: 'POST', url: '/admin/login', payload: { username: 'ceo', password: 'Direction#2026' } });
  assert.equal(step1.statusCode, 200);
  assert.equal(step1.json().mfaRequired, true);
  assert.equal(step1.json().token, undefined);

  // Code faux → 401.
  const bad = await app.inject({ method: 'POST', url: '/admin/login', payload: { username: 'ceo', password: 'Direction#2026', code: '000000' } });
  assert.equal(bad.statusCode, 401);

  // Code TOTP courant → jeton de session.
  const ok = await app.inject({ method: 'POST', url: '/admin/login', payload: { username: 'ceo', password: 'Direction#2026', code: totp(TOTP_SECRET) } });
  assert.equal(ok.statusCode, 200);
  const { token, account } = ok.json();
  assert.ok(typeof token === 'string' && token.split('.').length === 3);
  assert.equal(account.role, 'ceo');

  const me = await app.inject({ method: 'GET', url: '/admin/me', headers: { authorization: `Bearer ${token}` } });
  assert.equal(me.statusCode, 200);
  assert.equal(me.json().role, 'ceo');
});

test('2FA : compte sans secret TOTP → connexion directe (CFO)', async (t) => {
  const { buildApp } = await import('../src/app.js');
  const { app } = await buildApp();
  t.after(() => app.close());

  const res = await app.inject({ method: 'POST', url: '/admin/login', payload: { username: 'cfo', password: 'Direction#2026' } });
  assert.equal(res.statusCode, 200);
  assert.ok(res.json().token);
  assert.equal(res.json().account.role, 'cfo');
});

test('Sessions actives : visibles par la direction, révocation immédiate', async (t) => {
  const { buildApp } = await import('../src/app.js');
  const { totp } = await import('../src/modules/admin/auth.js');
  const { app } = await buildApp();
  t.after(() => app.close());

  // Le CEO se connecte (2FA) et voit les sessions actives.
  const login = await app.inject({ method: 'POST', url: '/admin/login', payload: { username: 'ceo', password: 'Direction#2026', code: totp(TOTP_SECRET) } });
  const ceoToken = login.json().token as string;

  // Le CFO se connecte aussi.
  const cfoLogin = await app.inject({ method: 'POST', url: '/admin/login', payload: { username: 'cfo', password: 'Direction#2026' } });
  const cfoToken = cfoLogin.json().token as string;

  const list = await app.inject({ method: 'GET', url: '/admin/sessions', headers: { authorization: `Bearer ${ceoToken}` } });
  assert.equal(list.statusCode, 200);
  const sessions = list.json().sessions as Array<{ id: string; username: string; revoked?: boolean }>;
  const cfoSession = sessions.find((s) => s.username === 'cfo' && !s.revoked);
  assert.ok(cfoSession, 'la session du CFO doit être visible');

  // Le CFO n'a PAS accès à la liste des sessions (réservé direction).
  const denied = await app.inject({ method: 'GET', url: '/admin/sessions', headers: { authorization: `Bearer ${cfoToken}` } });
  assert.equal(denied.statusCode, 403);

  // Le CEO révoque la session du CFO → son jeton est refusé immédiatement.
  const rev = await app.inject({ method: 'POST', url: `/admin/sessions/${cfoSession!.id}/revoke`, headers: { authorization: `Bearer ${ceoToken}` } });
  assert.equal(rev.statusCode, 200);
  const dead = await app.inject({ method: 'GET', url: '/admin/me', headers: { authorization: `Bearer ${cfoToken}` } });
  assert.equal(dead.statusCode, 401);
});
