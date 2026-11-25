import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSign, generateKeyPairSync } from 'node:crypto';

/**
 * SÉCURITÉ GOOGLE CLOUD — le serveur entier, protections activées.
 * La configuration est posée AVANT de charger le serveur ; Google est simulé (aucun réseau) :
 * identification, évaluations reCAPTCHA, clés publiques des jetons.
 */
const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const PEM = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
const JWK = { ...publicKey.export({ format: 'jwk' }), kid: 'cle-1', alg: 'RS256', use: 'sig' };
const PASSERELLE = 'orion-passerelle@projet-orion.iam.gserviceaccount.com';
const SERVEUR = 'https://orion-api-abcdefgh-ew.a.run.app';

Object.assign(process.env, {
  GCP_PROJECT_ID: 'projet-orion',
  GCP_SERVICE_ACCOUNT_JSON: JSON.stringify({ client_email: 'orion-api@projet-orion.iam.gserviceaccount.com', private_key: PEM, project_id: 'projet-orion' }),
  RECAPTCHA_MODE: 'enforce', RECAPTCHA_SITE_KEY: 'cle-de-site-orion-000000000', RECAPTCHA_MIN_SCORE: '0.5',
  IDENTITY_PLATFORM: 'true',
  GCP_GATEWAY_SERVICE_ACCOUNT: PASSERELLE, GCP_GATEWAY_AUDIENCE: SERVEUR,
});

const json = (corps: unknown, statut = 200) => new Response(JSON.stringify(corps), { status: statut, headers: { 'content-type': 'application/json', 'cache-control': 'max-age=3600' } });
let evaluations = 0;
globalThis.fetch = (async (entree: string | URL | Request, init?: RequestInit) => {
  const url = String(entree instanceof Request ? entree.url : entree);
  if (url === 'https://oauth2.googleapis.com/token') return json({ access_token: 'jeton-acces', expires_in: 3600 });
  if (url.endsWith('/assessments')) {
    evaluations++;
    const jeton = (JSON.parse(String(init?.body)) as { event: { token: string; expectedAction: string } }).event;
    if (jeton.token === 'panne') return json({ error: { message: 'indisponible' } }, 503);
    return json({ tokenProperties: { valid: jeton.token !== 'faux', action: jeton.expectedAction }, riskAnalysis: { score: jeton.token === 'humain' ? 0.9 : 0.1 } });
  }
  if (url.includes('/jwk/securetoken@system.gserviceaccount.com') || url === 'https://www.googleapis.com/oauth2/v3/certs') return json({ keys: [JWK] });
  throw new Error(`Appel réseau inattendu : ${url}`);
}) as typeof fetch;

const b64 = (v: unknown) => Buffer.from(JSON.stringify(v)).toString('base64url');
function signer(corps: Record<string, unknown>): string {
  const debut = `${b64({ alg: 'RS256', kid: 'cle-1', typ: 'JWT' })}.${b64(corps)}`;
  return `${debut}.${createSign('RSA-SHA256').update(debut).sign(PEM).toString('base64url')}`;
}
const sec = () => Math.floor(Date.now() / 1000);
const jetonIdentite = (phone: string | undefined, projet = 'projet-orion') => signer({
  iss: `https://securetoken.google.com/${projet}`, aud: projet, sub: 'uid-awa', iat: sec() - 5, exp: sec() + 3600, auth_time: sec() - 5,
  ...(phone ? { phone_number: phone } : {}), firebase: { sign_in_provider: 'phone' },
});
const jetonPasserelle = (email = PASSERELLE, aud = SERVEUR) => signer({ iss: 'https://accounts.google.com', aud, sub: '1234567890', email, email_verified: true, iat: sec() - 5, exp: sec() + 3600 });

const { buildApp } = await import('../src/app.js');

test('reCAPTCHA Enterprise : pas de code SMS sans preuve d’humanité', async (t) => {
  const { app } = await buildApp();
  t.after(() => app.close());
  const demander = (jeton?: string, url = '/clients/auth/otp') => app.inject({ method: 'POST', url, payload: { phone: '+2250707070701' }, headers: jeton ? { 'x-recaptcha-token': jeton } : {} });

  const sans = await demander();
  assert.equal(sans.statusCode, 403);
  assert.equal(sans.json().error.code, 'RECAPTCHA_REFUSE');
  assert.equal((await demander('robot')).statusCode, 403, 'score trop bas');
  assert.equal((await demander('faux')).statusCode, 403, 'jeton invalide');
  const panne = await demander('panne');
  assert.equal(panne.statusCode, 503, 'Google indisponible : la demande est refusée, pas acceptée');
  assert.equal(panne.json().error.code, 'RECAPTCHA_INDISPONIBLE');
  const ok = await demander('humain');
  assert.equal(ok.statusCode, 200, ok.body);
  assert.equal(ok.json().sent, true);
  // Même règle pour les chauffeurs et pour la console.
  assert.equal((await demander('robot', '/drivers/auth/otp')).statusCode, 403);
  assert.equal((await demander('humain', '/drivers/auth/otp')).statusCode, 200);
  const console_ = await app.inject({ method: 'POST', url: '/admin/login', payload: { username: 'admin', password: 'orion-admin-dev' } });
  assert.equal(console_.statusCode, 403, 'connexion à la console sans jeton reCAPTCHA');
  const consoleOk = await app.inject({ method: 'POST', url: '/admin/login', payload: { username: 'admin', password: 'orion-admin-dev' }, headers: { 'x-recaptcha-token': 'humain' } });
  assert.equal(consoleOk.statusCode, 200, consoleOk.body);
  assert.ok(evaluations >= 7, 'chaque demande a été soumise à Google');
});

test('Identity Platform : un jeton d’identité valide ouvre le compte du numéro vérifié', async (t) => {
  const { app } = await buildApp();
  t.after(() => app.close());
  const ouvrir = (idToken: string, extra: Record<string, unknown> = { name: 'Awa Koné' }) => app.inject({ method: 'POST', url: '/clients/auth/identity', payload: { clientId: 'appareil-1', idToken, ...extra } });

  const cree = await ouvrir(jetonIdentite('+2250707070702'));
  assert.equal(cree.statusCode, 200, cree.body);
  assert.equal(cree.json().client.phone, '+2250707070702');
  assert.equal(cree.json().compteRetrouve, false);
  // Le jeton ORION délivré donne accès au profil, comme après un code SMS.
  const profil = await app.inject({ method: 'GET', url: `/clients/${cree.json().client.id}/profile`, headers: { authorization: `Bearer ${cree.json().token}` } });
  assert.equal(profil.statusCode, 200);
  // Même numéro depuis un autre appareil : le compte est retrouvé, pas dupliqué.
  const retrouve = await app.inject({ method: 'POST', url: '/clients/auth/identity', payload: { clientId: 'appareil-2', idToken: jetonIdentite('+2250707070702') } });
  assert.equal(retrouve.json().compteRetrouve, true);
  assert.equal(retrouve.json().client.id, cree.json().client.id);

  assert.equal((await ouvrir(jetonIdentite('+2250707070703', 'projet-pirate'))).statusCode, 401, 'jeton d’un autre projet');
  assert.equal((await ouvrir(jetonIdentite(undefined))).statusCode, 400, 'session sans numéro vérifié');
  assert.equal((await ouvrir(jetonIdentite('+33612345678'))).statusCode, 403, 'numéro hors de la zone de service');
  assert.equal((await ouvrir(jetonIdentite('+2250707070704'), {})).statusCode, 400, 'inscription sans nom');
  assert.equal((await ouvrir(`${jetonIdentite('+2250707070705').slice(0, -6)}AAAAAA`)).statusCode, 401, 'signature falsifiée');
});

test('API Gateway : le jeton de la passerelle est vérifié, celui de l’application reprend sa place', async (t) => {
  const { app } = await buildApp();
  t.after(() => app.close());
  const session = await app.inject({ method: 'POST', url: '/clients/auth/identity', payload: { clientId: 'appareil-3', idToken: jetonIdentite('+2250707070706'), name: 'Koffi Yao' } });
  const { token, client } = session.json() as { token: string; client: { id: string } };
  const profil = (headers: Record<string, string>) => app.inject({ method: 'GET', url: `/clients/${client.id}/profile`, headers });

  // Par la passerelle : Authorization porte le jeton Google, le jeton ORION est relayé.
  assert.equal((await profil({ authorization: `Bearer ${jetonPasserelle()}`, 'x-forwarded-authorization': `Bearer ${token}` })).statusCode, 200);
  // En direct (équilibreur) : le jeton ORION est à sa place habituelle.
  assert.equal((await profil({ authorization: `Bearer ${token}` })).statusCode, 200);
  // Usurpation : en-tête relayé sans jeton de passerelle valide.
  assert.equal((await profil({ 'x-forwarded-authorization': `Bearer ${token}` })).statusCode, 401, 'sans Authorization, l’en-tête relayé est ignoré');
  const faux = await profil({ authorization: `Bearer ${jetonPasserelle('pirate@projet-pirate.iam.gserviceaccount.com')}`, 'x-forwarded-authorization': `Bearer ${token}` });
  assert.equal(faux.statusCode, 403);
  assert.equal(faux.json().error.code, 'PASSERELLE_REFUSEE');
  assert.equal((await profil({ authorization: `Bearer ${jetonPasserelle(PASSERELLE, 'https://autre-service.run.app')}`, 'x-forwarded-authorization': `Bearer ${token}` })).statusCode, 403, 'jeton destiné à un autre service');
  // Par la passerelle sans jeton d'application : la requête est anonyme, donc refusée par la route.
  assert.equal((await profil({ authorization: `Bearer ${jetonPasserelle()}` })).statusCode, 401);
});
