/**
 * AUDIT DE SÉCURITÉ — constats corrigés et verrouillés par des tests.
 *
 * S1 : les boîtiers télématiques s'authentifient (jeton partagé).
 * S2 : les données d'un client inscrit ne s'atteignent qu'avec SA session (courses,
 *      locations, mariage, abonnement, profil, support, suivi d'alerte). Un passager
 *      invité (identifiant d'appareil sans compte) reste servi sans session.
 * S3 : en production, le serveur refuse de démarrer avec un secret public.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const JETON_BOITIER = 'boitier-orion-test-0123456789abcdef';
process.env.TELEMATIQUE_TOKEN = JETON_BOITIER;

const { buildApp } = await import('../src/app.js');
const { issueClientToken } = await import('../src/modules/clients/auth.js');

const session = (id: string) => ({ authorization: `Bearer ${issueClientToken(id).token}` });
/** Un COMPTE : numéro vérifié par code SMS (c'est ce qui le distingue d'un invité). */
const compte = (container: { clients: { touch: (id: string, i?: { name?: string; phone?: string }) => unknown; updateProfile: (id: string, p: { phoneVerifiedAt?: string }) => unknown } }, id: string, name: string, phone: string) => {
  container.clients.touch(id, { name, phone });
  container.clients.updateProfile(id, { phoneVerifiedAt: new Date().toISOString() });
};

test('S1 · télématique : sans jeton ou avec un faux jeton, la position est refusée', async (t) => {
  const { app } = await buildApp();
  t.after(() => app.close());
  const pos = { lat: 5.32, lng: -4.02, vitesseKmh: 0, contact: false };
  const sans = await app.inject({ method: 'POST', url: '/rental/telematique/aito-m9', payload: pos });
  assert.equal(sans.statusCode, 401);
  const faux = await app.inject({ method: 'POST', url: '/rental/telematique/aito-m9', payload: pos, headers: { authorization: 'Bearer pas-le-bon-jeton-du-tout-123' } });
  assert.equal(faux.statusCode, 401);
  const bon = await app.inject({ method: 'POST', url: '/rental/telematique/aito-m9', payload: pos, headers: { authorization: `Bearer ${JETON_BOITIER}` } });
  assert.equal(bon.statusCode, 200, bon.body);
  assert.ok(bon.json().position.zone, 'la position porte un quartier');
});

test('S2 · un compte inscrit : ses données exigent SA session (401 sans, 403 avec celle d’un autre)', async (t) => {
  const { app, container } = await buildApp();
  t.after(() => app.close());
  compte(container, 'cli-awa', 'Awa Koné', '+2250700000001');
  compte(container, 'cli-intrus', 'Intrus', '+2250700000002');
  const awa = session('cli-awa');
  const intrus = session('cli-intrus');

  const cas: Array<{ method: 'GET' | 'POST'; url: string; payload?: Record<string, unknown> }> = [
    { method: 'GET', url: '/rental/mes-locations/cli-awa' },
    { method: 'GET', url: '/wedding/cli-awa' },
    { method: 'GET', url: '/subscriptions/cli-awa' },
    { method: 'POST', url: '/subscriptions/cli-awa/cancel', payload: {} },
    { method: 'POST', url: '/subscriptions/cli-awa/renouveler', payload: {} },
    { method: 'POST', url: '/subscriptions', payload: { userId: 'cli-awa', plan: 'bronze' } },
    { method: 'POST', url: '/clients/profile', payload: { clientId: 'cli-awa', phone: '0799999999' } },
    { method: 'POST', url: '/support/messages', payload: { clientId: 'cli-awa', text: 'Bonjour' } },
    { method: 'POST', url: '/reservations', payload: { clientId: 'cli-awa', origin: { lat: 5.3, lng: -4 }, destination: { lat: 5.35, lng: -3.99 }, scheduledFor: new Date(Date.now() + 3_600_000).toISOString() } },
  ];
  for (const c of cas) {
    const sans = await app.inject({ method: c.method, url: c.url, payload: c.payload });
    assert.equal(sans.statusCode, 401, `${c.method} ${c.url} sans session : ${sans.statusCode}`);
    const autre = await app.inject({ method: c.method, url: c.url, payload: c.payload, headers: intrus });
    assert.equal(autre.statusCode, 403, `${c.method} ${c.url} avec la session d’un autre : ${autre.statusCode}`);
  }
  // Le numéro du client n'a pas été détourné par les tentatives ci-dessus.
  assert.equal(container.clients.get('cli-awa')?.phone, '+2250700000001');
  // Le titulaire, lui, est servi.
  const lui = await app.inject({ method: 'GET', url: '/subscriptions/cli-awa', headers: awa });
  assert.equal(lui.statusCode, 200, lui.body);
});

test('S2 · courses d’un compte inscrit : annulation et aperçu exigent sa session', async (t) => {
  const { app, container } = await buildApp();
  t.after(() => app.close());
  compte(container, 'cli-bintou', 'Bintou', '+2250700000003');
  const est = await app.inject({ method: 'POST', url: '/pricing/estimate', payload: { origin: { lat: 5.3237, lng: -4.0186 }, destination: { lat: 5.3540, lng: -3.989 }, category: 'bronze', clientId: 'cli-bintou' } });
  assert.equal(est.statusCode, 200, est.body);
  const lockId = est.json().quote?.lockId ?? est.json().lockId;
  const sans = await app.inject({ method: 'POST', url: '/rides', payload: { clientId: 'cli-bintou', lockId, origin: { lat: 5.3237, lng: -4.0186 }, destination: { lat: 5.354, lng: -3.989 }, category: 'bronze', paymentMethod: 'cash' } });
  assert.equal(sans.statusCode, 401, `commande sans session : ${sans.statusCode}`);
  const cree = await app.inject({ method: 'POST', url: '/rides', headers: session('cli-bintou'), payload: { clientId: 'cli-bintou', lockId, origin: { lat: 5.3237, lng: -4.0186 }, destination: { lat: 5.354, lng: -3.989 }, category: 'bronze', paymentMethod: 'cash' } });
  assert.equal(cree.statusCode, 201, cree.body);
  const id = cree.json().ride.id as string;
  const apercu = await app.inject({ method: 'GET', url: `/rides/${id}/cancel-preview?clientId=cli-bintou` });
  assert.equal(apercu.statusCode, 401);
  const annul = await app.inject({ method: 'POST', url: `/rides/${id}/cancel`, payload: { clientId: 'cli-bintou', motif: 'changement_plan' }, headers: session('cli-intrus') });
  assert.equal(annul.statusCode, 403);
  assert.notEqual(container.rides.get(id)?.status, 'cancelled', 'la course n’a pas été annulée par un tiers');
});

test('S2 · un passager invité (sans compte) reste servi sans session', async (t) => {
  const { app, container } = await buildApp();
  t.after(() => app.close());
  // Une fiche existe dès la première course d'un invité : elle n'en fait pas un compte.
  container.clients.incrementRides('appareil-invite-7f3a');
  const hist = await app.inject({ method: 'GET', url: '/clients/appareil-invite-7f3a/rides' });
  assert.equal(hist.statusCode, 200, `historique d’un invité après une course : ${hist.statusCode}`);
  const r = await app.inject({ method: 'GET', url: '/subscriptions/appareil-invite-7f3a' });
  assert.equal(r.statusCode, 200, r.body);
  const loc = await app.inject({ method: 'GET', url: '/rental/mes-locations/appareil-invite-7f3a' });
  assert.equal(loc.statusCode, 200, loc.body);
});

test('S2 · un SOS se déclenche TOUJOURS, même sans session', async (t) => {
  const { app, container } = await buildApp();
  t.after(() => app.close());
  compte(container, 'cli-sos', 'Koffi', '+2250700000004');
  const r = await app.inject({ method: 'POST', url: '/safety/sos', payload: { userId: 'cli-sos', location: { lat: 5.33, lng: -4.02 } } });
  assert.equal(r.statusCode, 201, r.body);
  // …mais son suivi (messages de l'agent) est réservé à son auteur.
  const suivi = await app.inject({ method: 'GET', url: `/safety/sos/${r.json().alert.id}?userId=cli-sos` });
  assert.equal(suivi.statusCode, 401);
  const lui = await app.inject({ method: 'GET', url: `/safety/sos/${r.json().alert.id}?userId=cli-sos`, headers: session('cli-sos') });
  assert.equal(lui.statusCode, 200, lui.body);
});

test('S3 · production : refus de démarrer avec les secrets publics du dépôt', () => {
  const racine = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const env = { ...process.env, NODE_ENV: 'production' } as Record<string, string | undefined>;
  for (const k of ['ADMIN_JWT_SECRET', 'DRIVER_JWT_SECRET', 'CLIENT_JWT_SECRET', 'ADMIN_TOKEN', 'ADMIN_PASSWORD', 'ADMIN_USERS']) delete env[k];
  const r = spawnSync(process.execPath, ['--import', 'tsx', '-e', "await import('./src/config/index.ts')"], { cwd: racine, env, encoding: 'utf8' });
  assert.equal(r.status, 1, `le serveur aurait dû refuser de démarrer : ${r.stdout}${r.stderr}`);
  for (const k of ['ADMIN_JWT_SECRET', 'ADMIN_TOKEN', 'ADMIN_PASSWORD']) assert.match(r.stderr, new RegExp(k));

  // Avec de vrais secrets, la configuration est acceptée.
  const ok = spawnSync(process.execPath, ['--import', 'tsx', '-e', "await import('./src/config/index.ts'); console.log('CONFIG_OK')"], {
    cwd: racine, encoding: 'utf8',
    env: { ...env, ADMIN_JWT_SECRET: 'a'.repeat(48), DRIVER_JWT_SECRET: 'b'.repeat(48), CLIENT_JWT_SECRET: 'c'.repeat(48), ADMIN_TOKEN: 'd'.repeat(32), ADMIN_PASSWORD: 'Un-vrai-mot-de-passe-2026' },
  });
  assert.match(ok.stdout, /CONFIG_OK/, ok.stderr);
});
