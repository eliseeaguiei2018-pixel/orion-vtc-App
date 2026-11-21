import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSign, generateKeyPairSync } from 'node:crypto';

/**
 * API GATEWAY OBLIGATOIRE (GCP_GATEWAY_REQUIRED=true) : tout ce qui n'arrive pas par la
 * passerelle est refusé, sauf les chemins dispensés (GCP_GATEWAY_EXEMPT) : sonde de santé,
 * canaux temps réel et console, qui passent par l'équilibreur, derrière Cloud Armor.
 */
const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const PEM = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
const PASSERELLE = 'orion-passerelle@projet-orion.iam.gserviceaccount.com';
const SERVEUR = 'https://orion-api-abcdefgh-ew.a.run.app';
Object.assign(process.env, { GCP_GATEWAY_SERVICE_ACCOUNT: PASSERELLE, GCP_GATEWAY_AUDIENCE: SERVEUR, GCP_GATEWAY_REQUIRED: 'true' });
globalThis.fetch = (async (entree: string | URL | Request) => {
  const url = String(entree instanceof Request ? entree.url : entree);
  if (url === 'https://www.googleapis.com/oauth2/v3/certs') {
    return new Response(JSON.stringify({ keys: [{ ...publicKey.export({ format: 'jwk' }), kid: 'cle-1', alg: 'RS256' }] }), { headers: { 'cache-control': 'max-age=3600' } });
  }
  throw new Error(`Appel réseau inattendu : ${url}`);
}) as typeof fetch;
const b64 = (v: unknown) => Buffer.from(JSON.stringify(v)).toString('base64url');
const sec = Math.floor(Date.now() / 1000);
function jetonPasserelle(): string {
  const debut = `${b64({ alg: 'RS256', kid: 'cle-1' })}.${b64({ iss: 'https://accounts.google.com', aud: SERVEUR, sub: '42', email: PASSERELLE, email_verified: true, iat: sec - 5, exp: sec + 3600 })}`;
  return `${debut}.${createSign('RSA-SHA256').update(debut).sign(PEM).toString('base64url')}`;
}
const { buildApp } = await import('../src/app.js');

test('passerelle obligatoire : une requête directe est refusée, la santé reste joignable', async (t) => {
  const { app } = await buildApp();
  t.after(() => app.close());
  const devis = { method: 'POST' as const, url: '/pricing/estimate', payload: { origin: { lat: 5.3237, lng: -4.017 }, destination: { lat: 5.3596, lng: -3.9903 }, category: 'argent' } };

  const direct = await app.inject(devis);
  assert.equal(direct.statusCode, 403);
  assert.equal(direct.json().error.code, 'PASSERELLE_REQUISE');
  assert.equal((await app.inject({ ...devis, headers: { authorization: `Bearer ${jetonPasserelle()}` } })).statusCode, 200, 'par la passerelle');
  assert.equal((await app.inject({ method: 'GET', url: '/health/live' })).statusCode, 200, 'sonde de santé');
  // Canal temps réel : il n'est pas arrêté par la règle de passerelle (il échoue plus loin, faute de WebSocket ici).
  const ws = await app.inject({ method: 'GET', url: '/ws/config' });
  assert.ok(!ws.body.includes('PASSERELLE_REQUISE'), `canal temps réel : ${ws.statusCode}`);
});
