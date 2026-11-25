import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scryptSync } from 'node:crypto';

/**
 * LECTURES GROUPÉES DE LA CONSOLE : une requête au lieu d'une soixantaine, avec exactement les
 * mêmes droits que les lectures une à une (refus signalés à la direction compris).
 * La config capture process.env au chargement → comptes définis AVANT les imports.
 */
const SALT = 'f1e2d3c4b5a69788';
const HASH = scryptSync('Lot#2026', SALT, 32).toString('hex');
process.env.ADMIN_USERS = JSON.stringify([
  { username: 'dg.lot', name: 'Direction (lot)', role: 'dg', salt: SALT, hash: HASH },
  { username: 'support.lot', name: 'Support (lot)', role: 'support', salt: SALT, hash: HASH },
]);
const { buildApp } = await import('../src/app.js');

const AUTH = { 'x-admin-token': 'orion-admin-dev' };
type App = Awaited<ReturnType<typeof buildApp>>['app'];
async function login(app: App, username: string) {
  const res = await app.inject({ method: 'POST', url: '/admin/login', payload: { username, password: 'Lot#2026' } });
  assert.equal(res.statusCode, 200, res.body);
  return { authorization: `Bearer ${res.json().token}` };
}

test('lot : mêmes réponses que les lectures une à une, en une seule requête', async () => {
  const { app } = await buildApp();
  const chemins = ['/admin/me', '/admin/overview', '/admin/pricing', '/admin/zones', '/admin/rides?page=1&limit=25', '/admin/drivers?page=1&limit=25'];
  const lot = await app.inject({ method: 'POST', url: '/admin/lot', headers: AUTH, payload: { chemins } });
  assert.equal(lot.statusCode, 200, lot.body);
  const r = lot.json().r as Record<string, { s: number; b: unknown }>;
  for (const c of chemins) {
    const seul = await app.inject({ method: 'GET', url: c, headers: AUTH });
    assert.equal(r[c]!.s, seul.statusCode, c);
    if (c !== '/admin/overview') assert.deepEqual(r[c]!.b, seul.json(), c); // la vue d'ensemble porte l'heure
  }
  await app.close();
});

test('lot : sans session, refusé ; une page interdite reste interdite et signalée à la direction', async () => {
  const { app } = await buildApp();
  const sans = await app.inject({ method: 'POST', url: '/admin/lot', payload: { chemins: ['/admin/me'] } });
  assert.equal(sans.statusCode, 401);

  const support = await login(app, 'support.lot');
  const lot = await app.inject({ method: 'POST', url: '/admin/lot', headers: support, payload: { chemins: ['/admin/me', '/admin/treasury'] } });
  assert.equal(lot.statusCode, 200, lot.body);
  const r = lot.json().r as Record<string, { s: number; b: { error?: { message?: string } } | null }>;
  assert.equal(r['/admin/me']!.s, 200);
  assert.equal(r['/admin/treasury']!.s, 403);
  assert.match(String(r['/admin/treasury']!.b?.error?.message), /signalée à la direction/);

  const dg = await login(app, 'dg.lot');
  const alertes = (await app.inject({ method: 'GET', url: '/admin/security-alerts', headers: dg })).json().attempts as Array<{ name: string; path?: string }>;
  assert.ok(alertes.some((a) => a.name === 'Support (lot)' && String(a.path).startsWith('/admin/treasury')), 'tentative signalée');
  await app.close();
});

test('lot : seulement des lectures de pages /admin/, sans lot dans le lot', async () => {
  const { app } = await buildApp();
  for (const chemin of ['/drivers', 'https://exemple.com/admin/me', '/admin/../drivers', '/admin/lot', '/admin//me']) {
    const r = await app.inject({ method: 'POST', url: '/admin/lot', headers: AUTH, payload: { chemins: [chemin] } });
    assert.equal(r.statusCode, 400, `${chemin} → ${r.statusCode}`);
  }
  const trop = await app.inject({ method: 'POST', url: '/admin/lot', headers: AUTH, payload: { chemins: Array.from({ length: 101 }, (_, i) => `/admin/me?i=${i}`) } });
  assert.equal(trop.statusCode, 400);
  // Une marque de lot venue de l'extérieur n'exempte de rien et n'est pas relayée.
  const faux = await app.inject({ method: 'GET', url: '/admin/me', headers: { ...AUTH, 'x-orion-lot': 'invente' } });
  assert.equal(faux.statusCode, 200);
  await app.close();
});
