import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createPublicKey, generateKeyPairSync } from 'node:crypto';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MisesAJour } from '../src/modules/mises-a-jour/service.js';

/**
 * L'APPLICATION accepte la signature du SERVEUR, et refuse tout manifeste modifié ou signé par
 * une autre clé (vérification WebCrypto de frontend/src/miseAJourSignature.ts, celle des APK).
 */
interface Appli {
  signatureValide(m: unknown, clePublique?: string): Promise<boolean>;
}
const appli = (await import(new URL('../../frontend/src/miseAJourSignature.ts', import.meta.url).href)) as Appli;

test('signature du serveur vérifiée par l’application ; modification ou autre clé refusées', async () => {
  const { privateKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
  const cle = privateKey.export({ format: 'der', type: 'pkcs8' }).toString('base64');
  const service = new MisesAJour(mkdtempSync(join(tmpdir(), 'orion-maj-app-')), cle);
  const publique = createPublicKey(privateKey).export({ format: 'der', type: 'spki' }).toString('base64');
  assert.equal(service.clePublique(), publique);

  const zip = Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.from('index.html'.padEnd(80, '.'))]);
  const m = service.publier('chauffeur', zip, { version: '1.9.0-test', natifMin: 25 });
  assert.equal(await appli.signatureValide(m, publique), true);
  for (const truque of [{ ...m, sha256: 'f'.repeat(64) }, { ...m, version: '9.9.9' }, { ...m, natifMin: 0 }, { ...m, app: 'client' }, { ...m, taille: m.taille + 1 }]) {
    assert.equal(await appli.signatureValide(truque, publique), false, JSON.stringify(truque).slice(0, 80));
  }
  const autre = generateKeyPairSync('ec', { namedCurve: 'P-256' }).publicKey.export({ format: 'der', type: 'spki' }).toString('base64');
  assert.equal(await appli.signatureValide(m, autre), false, 'autre clé');
});
