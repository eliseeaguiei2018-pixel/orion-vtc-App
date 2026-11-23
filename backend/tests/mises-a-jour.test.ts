import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, createPublicKey, generateKeyPairSync, verify } from 'node:crypto';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { scryptSync } from 'node:crypto';

/**
 * MISES À JOUR À CHAUD : la direction publie un paquet, le serveur le signe, les apps le
 * reçoivent en direct et peuvent vérifier qu'il vient bien d'ORION avant de l'installer.
 * La config capture process.env au chargement → clé, dossier et comptes AVANT les imports.
 */
const { privateKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
process.env.OTA_SIGNING_KEY = privateKey.export({ format: 'der', type: 'pkcs8' }).toString('base64');
process.env.PAQUETS_DIR = mkdtempSync(join(tmpdir(), 'orion-paquets-test-'));
const SALT = '0a1b2c3d4e5f6071';
const HASH = scryptSync('Maj#2026', SALT, 32).toString('hex');
process.env.ADMIN_USERS = JSON.stringify([{ username: 'support.maj', name: 'Support (maj)', role: 'support', salt: SALT, hash: HASH }]);
const { buildApp } = await import('../src/app.js');
const { messageASigner, MisesAJour } = await import('../src/modules/mises-a-jour/service.js');
const { CONFIG_ROOM } = await import('../src/modules/realtime/hub.js');

const AUTH = { 'x-admin-token': 'orion-admin-dev' };
/** Paquet minimal : en-tête zip et page d'accueil à la racine. */
const paquet = (texte: string) => Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.from(`index.html ${texte} `.padEnd(64, '.'))]);

test('publication : manifeste signé, paquet servi tel quel, annonce en direct aux apps', async () => {
  const { app, container } = await buildApp();
  const annonces: Array<{ room: string; type: string; data: unknown }> = [];
  container.realtime.subscribeAll((m) => { if (m.type === 'apps.maj') annonces.push(m as never); });

  const avant = await app.inject({ method: 'GET', url: '/apps/client/manifeste' });
  assert.equal(avant.statusCode, 404);

  const zip = paquet('v1');
  const pub = await app.inject({ method: 'PUT', url: '/admin/mises-a-jour/client?version=1.9.0-a&natifMin=25&notes=Essai', headers: { ...AUTH, 'content-type': 'application/zip' }, payload: zip });
  assert.equal(pub.statusCode, 200, pub.body);

  const m = (await app.inject({ method: 'GET', url: '/apps/client/manifeste' })).json();
  assert.equal(m.version, '1.9.0-a');
  assert.equal(m.natifMin, 25);
  assert.equal(m.sha256, createHash('sha256').update(zip).digest('hex'));
  // La signature se vérifie avec la clé publique (celle que portent les APK).
  const ok = verify('sha256', Buffer.from(messageASigner(m)), { key: createPublicKey(privateKey), dsaEncoding: 'ieee-p1363' }, Buffer.from(m.signature, 'base64'));
  assert.ok(ok, 'signature valide');
  // Un manifeste modifié (autre empreinte) ne se vérifie plus.
  const truque = verify('sha256', Buffer.from(messageASigner({ ...m, sha256: '0'.repeat(64) })), { key: createPublicKey(privateKey), dsaEncoding: 'ieee-p1363' }, Buffer.from(m.signature, 'base64'));
  assert.equal(truque, false);

  const z = await app.inject({ method: 'GET', url: m.chemin });
  assert.equal(z.statusCode, 200);
  assert.deepEqual(z.rawPayload, zip);
  assert.match(String(z.headers['cache-control']), /immutable/);

  // Canal `config` : apps client et console ; le canal du chauffeur le relaie aussi.
  assert.deepEqual(annonces.map((a) => [a.room, (a.data as { app: string }).app]), [[CONFIG_ROOM, 'client']]);

  // Même version une seconde fois : refusée (une version publiée ne change jamais).
  const double = await app.inject({ method: 'PUT', url: '/admin/mises-a-jour/client?version=1.9.0-a', headers: { ...AUTH, 'content-type': 'application/zip' }, payload: paquet('autre') });
  assert.equal(double.statusCode, 409);
  const etat = (await app.inject({ method: 'GET', url: '/admin/mises-a-jour', headers: AUTH })).json();
  assert.equal(etat.apps.client.version, '1.9.0-a');
  assert.equal(etat.apps.chauffeur, null);
  await app.close();
});

test('publication réservée à la direction, paquets et versions contrôlés', async () => {
  const { app } = await buildApp();
  const zip = paquet('v2');
  const sans = await app.inject({ method: 'PUT', url: '/admin/mises-a-jour/console?version=2', headers: { 'content-type': 'application/zip' }, payload: zip });
  assert.equal(sans.statusCode, 401);
  const login = await app.inject({ method: 'POST', url: '/admin/login', payload: { username: 'support.maj', password: 'Maj#2026' } });
  const support = { authorization: `Bearer ${login.json().token}` };
  const refus = await app.inject({ method: 'PUT', url: '/admin/mises-a-jour/console?version=2', headers: { ...support, 'content-type': 'application/zip' }, payload: zip });
  assert.equal(refus.statusCode, 403);

  const cas: Array<[string, Buffer, number]> = [
    ['/admin/mises-a-jour/inconnue?version=2', zip, 400],
    ['/admin/mises-a-jour/console?version=../x', zip, 400],
    ['/admin/mises-a-jour/console?version=3', Buffer.from('pas un zip, pas de page'), 400],
  ];
  for (const [url, corps, attendu] of cas) {
    const r = await app.inject({ method: 'PUT', url, headers: { ...AUTH, 'content-type': 'application/zip' }, payload: corps });
    assert.equal(r.statusCode, attendu, `${url} → ${r.statusCode} ${r.body}`);
  }
  // Aucun chemin hors du dossier des paquets.
  for (const url of ['/apps/console/paquets/..%2F..%2Fetc%2Fpasswd', '/apps/console/paquets/manifeste.json', '/apps/inconnue/manifeste']) {
    assert.equal((await app.inject({ method: 'GET', url })).statusCode, 404, url);
  }
  await app.close();
});

test('sans clé de signature, le serveur refuse de publier', () => {
  const sansCle = new MisesAJour(mkdtempSync(join(tmpdir(), 'orion-paquets-sanscle-')), undefined);
  assert.equal(sansCle.signatureDisponible, false);
  assert.throws(() => sansCle.publier('client', paquet('x'), { version: '1' }), /OTA_SIGNING_KEY/);
});

test('sans clé fournie, le serveur crée la sienne sur son disque, la garde, et publie sa clé publique', async () => {
  const dossier = mkdtempSync(join(tmpdir(), 'orion-paquets-cle-'));
  const a = new MisesAJour(dossier, undefined, { creerCle: true });
  assert.equal(a.signatureDisponible, true);
  const b = new MisesAJour(dossier, undefined, { creerCle: true });
  assert.equal(b.clePublique(), a.clePublique(), 'même clé après redémarrage');
  const { statSync } = await import('node:fs');
  assert.equal(statSync(join(dossier, 'cle-signature.pk8')).mode & 0o777, 0o600, 'lisible par le serveur seul');

  const { app, container } = await buildApp();
  const r = await app.inject({ method: 'GET', url: '/apps/cle-publique' });
  assert.equal(r.statusCode, 200);
  assert.equal(r.json().clePublique, container.misesAJour.clePublique());
  await app.close();
});
