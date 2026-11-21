import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSign, createVerify, generateKeyPairSync } from 'node:crypto';
import { AccesGoogle, ErreurGoogle, assertionCompteService, type Recuperer } from '../src/modules/gcp/acces.js';
import { chargerSecretsGoogle, referencesSecrets } from '../src/modules/gcp/secrets.js';
import { ClesGoogle, JetonRefuse, verifierJetonGoogle } from '../src/modules/gcp/jetons.js';
import { IdentitePlateforme } from '../src/modules/gcp/identite.js';
import { Recaptcha } from '../src/modules/gcp/recaptcha.js';
import { auditerCles, constatCle } from '../src/modules/gcp/cles.js';

/**
 * SÉCURITÉ GOOGLE CLOUD — les modules, face à des réponses Google simulées.
 * Aucun appel réseau : `recuperer` est remplacé par un faux Google qui répond comme la
 * documentation des API le décrit. Ces tests prouvent la logique du serveur, pas le réglage
 * d'un projet Google réel.
 */
const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const PEM = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
const JWK = { ...publicKey.export({ format: 'jwk' }), kid: 'cle-1', alg: 'RS256', use: 'sig' };
const json = (corps: unknown, statut = 200, entetes: Record<string, string> = {}) =>
  new Response(JSON.stringify(corps), { status: statut, headers: { 'content-type': 'application/json', ...entetes } });
const b64 = (v: unknown) => Buffer.from(JSON.stringify(v)).toString('base64url');
function signer(corps: Record<string, unknown>, entete: Record<string, unknown> = { alg: 'RS256', kid: 'cle-1', typ: 'JWT' }, cle = PEM): string {
  const debut = `${b64(entete)}.${b64(corps)}`;
  return `${debut}.${createSign('RSA-SHA256').update(debut).sign(cle).toString('base64url')}`;
}
const T0 = Date.UTC(2026, 10, 21, 12, 0, 0);
const maintenant = () => T0;
const sec = Math.floor(T0 / 1000);

/* ------------------------------- Identification ------------------------------- */

test('compte de service : assertion RS256 signée, jeton gardé en mémoire', async () => {
  const compte = { client_email: 'orion-api@projet-orion.iam.gserviceaccount.com', private_key: PEM, project_id: 'projet-orion' };
  const assertion = assertionCompteService(compte, T0);
  const [e, c, s] = assertion.split('.');
  assert.ok(createVerify('RSA-SHA256').update(`${e}.${c}`).verify(publicKey, Buffer.from(s!, 'base64url')), 'signature vérifiable avec la clé publique');
  const corps = JSON.parse(Buffer.from(c!, 'base64url').toString());
  assert.deepEqual([corps.iss, corps.aud, corps.exp - corps.iat], [compte.client_email, 'https://oauth2.googleapis.com/token', 3600]);

  let demandes = 0;
  const recuperer: Recuperer = async (url, init) => {
    assert.equal(url, 'https://oauth2.googleapis.com/token');
    assert.match(String(init?.body), /grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion=/);
    demandes++;
    return json({ access_token: 'jeton-acces', expires_in: 3600 });
  };
  const acces = new AccesGoogle({ env: { GCP_SERVICE_ACCOUNT_JSON: Buffer.from(JSON.stringify(compte)).toString('base64') }, recuperer, maintenant });
  assert.deepEqual(await Promise.all([acces.jeton(), acces.jeton(), acces.jeton()]), ['jeton-acces', 'jeton-acces', 'jeton-acces']);
  assert.equal(demandes, 1, 'une seule demande pour trois appels simultanés');
  assert.equal(await acces.projet(), 'projet-orion');
});

test('sur Cloud Run : jeton et projet lus auprès de l’instance, sans aucune clé', async () => {
  const vus: string[] = [];
  const recuperer: Recuperer = async (url, init) => {
    vus.push(url);
    assert.equal((init?.headers as Record<string, string>)['metadata-flavor'], 'Google');
    return url.endsWith('/token') ? json({ access_token: 'jeton-instance', expires_in: 1800 }) : new Response('projet-orion');
  };
  const acces = new AccesGoogle({ env: {}, recuperer, maintenant });
  assert.equal(await acces.jeton(), 'jeton-instance');
  assert.equal(await acces.projet(), 'projet-orion');
  assert.ok(vus.every((u) => u.startsWith('http://metadata.google.internal/computeMetadata/v1/')));
});

/* ------------------------------- Secret Manager ------------------------------- */

const faussesMetadonnees = (suite: Recuperer): Recuperer => async (url, init) => {
  if (url.includes('metadata.google.internal')) return url.endsWith('/token') ? json({ access_token: 'jeton', expires_in: 3600 }) : new Response('projet-orion');
  assert.equal((init?.headers as Record<string, string>).authorization, 'Bearer jeton', 'appel authentifié');
  return suite(url, init);
};

test('Secret Manager : les références sm:// sont remplacées par la valeur du secret', async () => {
  const env: Record<string, string | undefined> = {
    CLIENT_JWT_SECRET: 'sm://orion-client-jwt', ADMIN_JWT_SECRET: 'sm://orion-admin-jwt#3',
    MEDICAL_DATA_KEY: 'sm://projects/autre-projet/secrets/orion-medical/versions/latest', PORT: '3000',
  };
  assert.deepEqual(referencesSecrets(env).map((r) => [r.variable, r.projet, r.secret, r.version]), [
    ['CLIENT_JWT_SECRET', undefined, 'orion-client-jwt', 'latest'], ['ADMIN_JWT_SECRET', undefined, 'orion-admin-jwt', '3'],
    ['MEDICAL_DATA_KEY', 'autre-projet', 'orion-medical', 'latest'],
  ]);
  const lus: string[] = [];
  const charges = await chargerSecretsGoogle(env, { recuperer: faussesMetadonnees(async (url) => {
    lus.push(url.replace('https://secretmanager.googleapis.com/v1/', ''));
    return json({ payload: { data: Buffer.from(`valeur-de-${url.split('/secrets/')[1]!.split('/')[0]}\n`).toString('base64') } });
  }) });
  assert.deepEqual(charges, ['CLIENT_JWT_SECRET', 'ADMIN_JWT_SECRET', 'MEDICAL_DATA_KEY']);
  assert.deepEqual(lus.sort(), [
    'projects/autre-projet/secrets/orion-medical/versions/latest:access',
    'projects/projet-orion/secrets/orion-admin-jwt/versions/3:access',
    'projects/projet-orion/secrets/orion-client-jwt/versions/latest:access',
  ]);
  assert.equal(env.CLIENT_JWT_SECRET, 'valeur-de-orion-client-jwt', 'le retour à la ligne final est retiré');
  assert.equal(env.PORT, '3000', 'les autres variables ne bougent pas');
});

test('Secret Manager : sans référence, Google n’est pas contacté ; un secret refusé arrête le démarrage', async () => {
  assert.deepEqual(await chargerSecretsGoogle({ PORT: '3000' }, { recuperer: async () => { throw new Error('aucun appel attendu'); } }), []);
  const env = { CLIENT_JWT_SECRET: 'sm://orion-client-jwt' };
  await assert.rejects(
    chargerSecretsGoogle(env, { recuperer: faussesMetadonnees(async () => json({ error: { message: 'Permission denied on secret' } }, 403)) }),
    (e: Error) => /CLIENT_JWT_SECRET/.test(e.message) && /403/.test(e.message),
  );
  assert.equal(env.CLIENT_JWT_SECRET, 'sm://orion-client-jwt', 'aucune valeur partielle n’est écrite');
  assert.throws(() => referencesSecrets({ X: 'sm://nom avec espace' }), /référence de secret invalide/);
});

/* ---------------------------- Jetons signés par Google ---------------------------- */

const clesLocales = (compteur = { n: 0 }) => new ClesGoogle('https://exemple/cles', async () => { compteur.n++; return json({ keys: [JWK] }, 200, { 'cache-control': 'public, max-age=3600' }); }, maintenant);
const valide = { iss: 'https://securetoken.google.com/projet-orion', aud: 'projet-orion', sub: 'uid-123', iat: sec - 10, exp: sec + 3600, auth_time: sec - 10, phone_number: '+2250707070707', firebase: { sign_in_provider: 'phone' } };

test('jeton Google : signature, émetteur, destinataire et dates sont tous exigés', async () => {
  const compteur = { n: 0 };
  const attendu = { cles: clesLocales(compteur), emetteurs: [valide.iss], destinataires: ['projet-orion'], maintenant };
  assert.equal((await verifierJetonGoogle(signer(valide), attendu)).sub, 'uid-123');
  await verifierJetonGoogle(signer(valide), attendu);
  assert.equal(compteur.n, 1, 'les clés publiques sont gardées en mémoire');

  const autre = generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
  const refus: [string, string, string][] = [
    ['signé par une autre clé', signer(valide, undefined, autre), 'signature'],
    ['autre projet', signer({ ...valide, aud: 'projet-pirate' }), 'destinataire'],
    ['autre émetteur', signer({ ...valide, iss: 'https://securetoken.google.com/projet-pirate' }), 'émetteur'],
    ['expiré', signer({ ...valide, exp: sec - 3600 }), 'expiré'],
    ['émis dans le futur', signer({ ...valide, iat: sec + 3600 }), 'futur'],
    ['sans sujet', signer({ ...valide, sub: '' }), 'sujet'],
    ['algorithme « none »', `${b64({ alg: 'none', kid: 'cle-1' })}.${b64(valide)}.`, 'algorithme'],
    ['algorithme symétrique', signer(valide, { alg: 'HS256', kid: 'cle-1' }), 'algorithme'],
    ['clé inconnue', signer(valide, { alg: 'RS256', kid: 'cle-inconnue' }), 'clé de signature'],
    ['contenu modifié après signature', signer(valide).replace(/\.[^.]+\./, `.${b64({ ...valide, phone_number: '+2250101010101' })}.`), 'signature'],
    ['pas un jeton', 'bonjour', 'format'],
  ];
  for (const [cas, jeton, raison] of refus) {
    await assert.rejects(verifierJetonGoogle(jeton, attendu), (e: Error) => e instanceof JetonRefuse && e.raison.includes(raison), cas);
  }
});

test('Identity Platform : le numéro vérifié par Google est rendu, le mauvais locataire refusé', async () => {
  const recuperer: Recuperer = async () => json({ keys: [JWK] }, 200, { 'cache-control': 'max-age=600' });
  const idp = new IdentitePlateforme({ projet: 'projet-orion', recuperer, maintenant });
  assert.deepEqual(await idp.verifier(signer(valide)), { uid: 'uid-123', telephone: '+2250707070707', email: undefined, emailVerifie: false, fournisseur: 'phone' });
  await assert.rejects(idp.verifier(signer({ ...valide, auth_time: sec + 3600 })), JetonRefuse);
  const locataire = new IdentitePlateforme({ projet: 'projet-orion', locataire: 'orion-clients', recuperer, maintenant });
  await assert.rejects(locataire.verifier(signer(valide)), (e: Error) => e instanceof JetonRefuse && e.raison === 'locataire');
  assert.equal((await locataire.verifier(signer({ ...valide, firebase: { sign_in_provider: 'phone', tenant: 'orion-clients' } }))).uid, 'uid-123');
});

/* ------------------------------ reCAPTCHA Enterprise ------------------------------ */

test('reCAPTCHA Enterprise : jeton valide, bonne action et score suffisant, sinon refus motivé', async () => {
  let recu: { event?: Record<string, unknown> } = {};
  let reponse: unknown = {};
  const acces = new AccesGoogle({ env: {}, maintenant, recuperer: faussesMetadonnees(async (url, init) => {
    assert.equal(url, 'https://recaptchaenterprise.googleapis.com/v1/projects/projet-orion/assessments');
    recu = JSON.parse(String(init?.body));
    return reponse instanceof Response ? reponse : json(reponse);
  }) });
  const r = new Recaptcha({ acces, cleSite: 'cle-de-site-orion-0000000', seuil: 0.5, mode: 'enforce' });
  const demande = { jeton: 'jeton-app', action: 'connexion_client', ip: '196.201.1.1', agent: 'ORION/1.5' };

  reponse = { tokenProperties: { valid: true, action: 'connexion_client' }, riskAnalysis: { score: 0.9 } };
  assert.deepEqual(await r.evaluer(demande), { ok: true, score: 0.9 });
  assert.deepEqual(recu.event, { token: 'jeton-app', siteKey: 'cle-de-site-orion-0000000', expectedAction: 'connexion_client', userIpAddress: '196.201.1.1', userAgent: 'ORION/1.5' });

  reponse = { tokenProperties: { valid: true, action: 'connexion_client' }, riskAnalysis: { score: 0.1, reasons: ['AUTOMATION'] } };
  assert.deepEqual(await r.evaluer(demande), { ok: false, score: 0.1, raison: 'score', motifs: ['AUTOMATION'] });
  reponse = { tokenProperties: { valid: true, action: 'page_accueil' }, riskAnalysis: { score: 0.9 } };
  assert.equal((await r.evaluer(demande)).raison, 'action');
  reponse = { tokenProperties: { valid: false, invalidReason: 'EXPIRED' } };
  assert.deepEqual(await r.evaluer(demande), { ok: false, raison: 'invalide', motifs: ['EXPIRED'] });
  reponse = json({ error: { message: 'backend error' } }, 503);
  assert.equal((await r.evaluer(demande)).raison, 'indisponible');
  assert.equal((await r.evaluer({ ...demande, jeton: undefined })).raison, 'absent');
});

/* ----------------------------------- API Keys ----------------------------------- */

test('API Keys : une clé sans restriction est signalée, une clé restreinte ne l’est pas', async () => {
  assert.deepEqual(constatCle({ displayName: 'Maps Android', uid: 'k1', restrictions: {
    apiTargets: [{ service: 'maps-backend.googleapis.com' }, { service: 'places.googleapis.com' }],
    androidKeyRestrictions: { allowedApplications: [{ packageName: 'ci.orion.app', sha1Fingerprint: 'AA:BB' }] },
  } }), { nom: 'Maps Android', identifiant: 'k1', creee: undefined, api: ['maps-backend.googleapis.com', 'places.googleapis.com'], application: 'android', alertes: [] });
  assert.equal(constatCle({ displayName: 'Clé ouverte', uid: 'k2' }).alertes.length, 2);
  assert.equal(constatCle({ uid: 'k3', restrictions: { apiTargets: [{ service: 'routes.googleapis.com' }], browserKeyRestrictions: { allowedReferrers: ['*'] } } }).alertes.length, 1);

  const pages: string[] = [];
  const acces = new AccesGoogle({ env: {}, maintenant, recuperer: faussesMetadonnees(async (url) => {
    pages.push(url.replace('https://apikeys.googleapis.com/v2/', ''));
    return url.includes('pageToken') ? json({ keys: [{ displayName: 'B', uid: 'b' }] }) : json({ keys: [{ displayName: 'A', uid: 'a' }], nextPageToken: 'suite' });
  }) });
  assert.deepEqual((await auditerCles(acces)).map((c) => c.nom), ['A', 'B']);
  assert.deepEqual(pages, ['projects/projet-orion/locations/global/keys?pageSize=100', 'projects/projet-orion/locations/global/keys?pageSize=100&pageToken=suite']);
});

test('une erreur de Google porte le service et le statut, jamais le jeton', async () => {
  const acces = new AccesGoogle({ env: {}, maintenant, recuperer: faussesMetadonnees(async () => json({ error: { message: 'API has not been used in project' } }, 403)) });
  await assert.rejects(acces.appel('API Keys', 'https://apikeys.googleapis.com/v2/x'), (e: Error) => e instanceof ErreurGoogle && e.statut === 403 && !e.message.includes('jeton') && /API Keys : 403/.test(e.message));
});
