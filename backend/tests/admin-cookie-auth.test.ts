import { test } from 'node:test';
import assert from 'node:assert/strict';

/**
 * Session de la console en cookie HttpOnly + protection CSRF.
 *
 * Le jeton vivait dans localStorage : lisible par tout script de la page, donc
 * exfiltrable par une faille XSS. Il est désormais posé en cookie HttpOnly, hors
 * de portée de JavaScript. Comme un cookie part tout seul avec chaque requête, y
 * compris depuis un site tiers, les écritures exigent en plus une preuve
 * anti-CSRF (double soumission) qu'un autre site ne peut pas forger.
 */
const IDENT = { username: 'admin', password: 'orion-admin-dev' };

/** Extrait un cookie précis des en-têtes Set-Cookie d'une réponse. */
function cookieDe(entetes: unknown, nom: string): string | undefined {
  const liste = Array.isArray(entetes) ? entetes : [entetes];
  for (const brut of liste) {
    const ligne = String(brut ?? '');
    const m = ligne.match(new RegExp(`^${nom}=([^;]*)`));
    if (m) return decodeURIComponent(m[1] ?? '');
  }
  return undefined;
}
const lignesCookies = (entetes: unknown): string[] =>
  (Array.isArray(entetes) ? entetes : [entetes]).map((x) => String(x ?? ''));

async function connecter(app: { inject: (o: object) => Promise<any> }) {
  const r = await app.inject({ method: 'POST', url: '/admin/login', payload: IDENT });
  return r;
}

test('Connexion : le jeton part en cookie HttpOnly, la preuve CSRF en cookie lisible', async (t) => {
  const { buildApp } = await import('../src/app.js');
  const { app } = await buildApp();
  t.after(() => app.close());

  const r = await connecter(app);
  assert.equal(r.statusCode, 200, r.body.slice(0, 200));

  const lignes = lignesCookies(r.headers['set-cookie']);
  const session = lignes.find((l) => l.startsWith('orion_admin='));
  const csrf = lignes.find((l) => l.startsWith('orion_csrf='));
  assert.ok(session, 'cookie de session posé');
  assert.ok(csrf, 'cookie anti-CSRF posé');

  // Le cookie de session doit être inaccessible à JavaScript.
  assert.match(session!, /HttpOnly/, 'le cookie de session est HttpOnly');
  // Celui-ci doit au contraire être lisible : la console recopie sa valeur en en-tête.
  assert.doesNotMatch(csrf!, /HttpOnly/, 'le cookie anti-CSRF reste lisible');
  assert.match(session!, /SameSite=/, 'SameSite défini');
  assert.match(session!, /Path=\//);

  assert.ok(r.json().csrfToken, 'la preuve anti-CSRF est aussi renvoyée dans le corps');
});

test('Le cookie seul authentifie une lecture (plus besoin de jeton côté page)', async (t) => {
  const { buildApp } = await import('../src/app.js');
  const { app } = await buildApp();
  t.after(() => app.close());

  const login = await connecter(app);
  const session = cookieDe(login.headers['set-cookie'], 'orion_admin')!;

  const r = await app.inject({ method: 'GET', url: '/admin/overview', headers: { cookie: `orion_admin=${session}` } });
  assert.equal(r.statusCode, 200, 'lecture autorisée par le seul cookie');

  // Sans cookie ni jeton : refusé.
  const sans = await app.inject({ method: 'GET', url: '/admin/overview' });
  assert.equal(sans.statusCode, 401);
});

test('CSRF : une écriture par cookie SANS preuve est refusée', async (t) => {
  const { buildApp } = await import('../src/app.js');
  const { app } = await buildApp();
  t.after(() => app.close());

  const login = await connecter(app);
  const session = cookieDe(login.headers['set-cookie'], 'orion_admin')!;
  const csrf = cookieDe(login.headers['set-cookie'], 'orion_csrf')!;

  // Scénario CSRF : un site tiers déclenche la requête. Le navigateur joint le
  // cookie, mais le site ne peut pas lire le cookie lisible, donc pas d'en-tête.
  const sansPreuve = await app.inject({
    method: 'PUT', url: '/admin/services',
    headers: { cookie: `orion_admin=${session}; orion_csrf=${csrf}` },
    payload: { open: false },
  });
  assert.equal(sansPreuve.statusCode, 403, 'écriture sans en-tête anti-CSRF refusée');

  // Une valeur inventée ne passe pas davantage.
  const mauvaisePreuve = await app.inject({
    method: 'PUT', url: '/admin/services',
    headers: { cookie: `orion_admin=${session}; orion_csrf=${csrf}`, 'x-csrf-token': 'inventé' },
    payload: { open: false },
  });
  assert.equal(mauvaisePreuve.statusCode, 403, 'preuve anti-CSRF incorrecte refusée');

  // Avec la bonne preuve, l'écriture passe.
  const avecPreuve = await app.inject({
    method: 'PUT', url: '/admin/services',
    headers: { cookie: `orion_admin=${session}; orion_csrf=${csrf}`, 'x-csrf-token': csrf },
    payload: { open: false },
  });
  assert.equal(avecPreuve.statusCode, 200, 'écriture autorisée avec la preuve');

  // On remet ORION ouvert pour ne pas polluer la suite.
  await app.inject({
    method: 'PUT', url: '/admin/services',
    headers: { cookie: `orion_admin=${session}; orion_csrf=${csrf}`, 'x-csrf-token': csrf },
    payload: { open: true },
  });
});

test('Bearer et jeton statique continuent de fonctionner sans preuve CSRF', async (t) => {
  const { buildApp } = await import('../src/app.js');
  const { app } = await buildApp();
  t.after(() => app.close());

  // Ces modes ne sont jamais joints automatiquement par le navigateur : pas de
  // risque CSRF, donc pas de preuve exigée (automatisation, app chauffeur, tests).
  const login = await connecter(app);
  const jeton = login.json().token as string;

  const bearer = await app.inject({
    method: 'PUT', url: '/admin/services',
    headers: { authorization: `Bearer ${jeton}` }, payload: { open: true },
  });
  assert.equal(bearer.statusCode, 200, 'Bearer accepté sans preuve anti-CSRF');

  const statique = await app.inject({
    method: 'PUT', url: '/admin/services',
    headers: { 'x-admin-token': 'orion-admin-dev' }, payload: { open: true },
  });
  assert.equal(statique.statusCode, 200, 'jeton statique accepté sans preuve anti-CSRF');
});

test('Déconnexion : les cookies sont effacés et la session révoquée', async (t) => {
  const { buildApp } = await import('../src/app.js');
  const { app } = await buildApp();
  t.after(() => app.close());

  const login = await connecter(app);
  const session = cookieDe(login.headers['set-cookie'], 'orion_admin')!;

  const out = await app.inject({ method: 'POST', url: '/admin/logout', headers: { cookie: `orion_admin=${session}` } });
  assert.equal(out.statusCode, 200);
  // Les deux cookies sont expirés côté navigateur.
  for (const ligne of lignesCookies(out.headers['set-cookie'])) {
    assert.match(ligne, /Max-Age=0/, `cookie effacé : ${ligne.slice(0, 40)}`);
  }

  // Et le jeton copié ailleurs ne vaut plus rien : la session est révoquée.
  const apres = await app.inject({ method: 'GET', url: '/admin/overview', headers: { cookie: `orion_admin=${session}` } });
  assert.equal(apres.statusCode, 401, 'le jeton révoqué ne rouvre pas la session');
});
