import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { buildApp } from '../src/app.js';
import { config } from '../src/config/index.js';
import { empreinteCodeSynchro, normaliserCode, verifierCodeSynchro } from '../src/modules/appareils/code.js';

/**
 * CODE DE SYNCHRONISATION ORION : enrôlement des appareils de la console et du tableau
 * de bord (Windows, macOS, tablettes, téléphones, navigateur).
 *
 * Le code de ces tests est un code d'exemple : le vrai code d'ORION n'est écrit nulle part
 * dans le dépôt, seule son empreinte vit dans la configuration du serveur.
 */
const CODE = 'Exemple-Synchro-Test-2026-0001';
const reglages = config as unknown as { ORION_CODE_SYNCHRO_EMPREINTE?: string; APPAREILS_EXIGES: boolean };

test('Empreinte : vérifiable, salée, tolérante à la saisie, jamais le code en clair', async () => {
  const e1 = await empreinteCodeSynchro(CODE);
  const e2 = await empreinteCodeSynchro(CODE);
  assert.notEqual(e1, e2, 'sel aléatoire : deux empreintes du même code diffèrent');
  assert.ok(!e1.toLowerCase().includes(normaliserCode(CODE)), 'le code n’apparaît pas dans l’empreinte');
  assert.equal(await verifierCodeSynchro(CODE, e1), true);
  assert.equal(await verifierCodeSynchro(' exemple synchro test 2026 0001 ', e1), true, 'majuscules et espaces ignorés');
  assert.equal(await verifierCodeSynchro('Exemple-Synchro-Test-2026-0002', e1), false);
  assert.equal(await verifierCodeSynchro(CODE, 'pas-une-empreinte'), false);
});

test('Le vrai code de synchronisation n’est écrit dans aucun fichier du dépôt', () => {
  // Contrôle sur un motif : le code ne doit jamais être commité, même dans un test.
  const motif = /orionvtcpremium\d{6,}/i;
  const racine = join(import.meta.dirname, '..', '..');
  const ignores = new Set(['node_modules', '.git', 'dist', 'build', '.tmp', 'data', 'Pods', '.gradle']);
  const fautifs: string[] = [];
  const parcourir = (dossier: string) => {
    for (const nom of readdirSync(dossier)) {
      if (ignores.has(nom)) continue;
      const chemin = join(dossier, nom);
      const st = statSync(chemin);
      if (st.isDirectory()) parcourir(chemin);
      else if (st.size < 2_000_000 && /\.(ts|tsx|js|mjs|json|md|yml|yaml|env|example|html|txt|plist|xml|sh)$/.test(nom)) {
        if (motif.test(readFileSync(chemin, 'utf8'))) fautifs.push(chemin);
      }
    }
  };
  parcourir(racine);
  assert.deepEqual(fautifs, []);
});

test('Enrôlement, essais limités, appareil exigé, révocation immédiate', async (t) => {
  const avant = { ...reglages };
  reglages.ORION_CODE_SYNCHRO_EMPREINTE = await empreinteCodeSynchro(CODE);
  t.after(() => { reglages.ORION_CODE_SYNCHRO_EMPREINTE = avant.ORION_CODE_SYNCHRO_EMPREINTE; reglages.APPAREILS_EXIGES = avant.APPAREILS_EXIGES; });
  const { app, container } = await buildApp();
  t.after(() => app.close());
  const AUTH = { 'x-admin-token': 'orion-admin-dev' };
  const ip = (n: number) => ({ remoteAddress: `10.0.0.${n}` });

  const etat = await app.inject({ method: 'GET', url: '/appareils/etat' });
  assert.deepEqual(etat.json(), { configure: true, exige: false, appareil: null });

  // Bon code : l'appareil reçoit sa clé, en cookie HttpOnly et une fois dans la réponse.
  const ok = await app.inject({
    method: 'POST', url: '/appareils/enroler', ...ip(1),
    payload: { code: 'exemple synchro test 2026 0001', nom: 'PC Windows · Direction', plateforme: 'windows', application: 'console' },
  });
  assert.equal(ok.statusCode, 200, ok.body);
  const cle = ok.json().cle as string;
  assert.ok(cle.length >= 40);
  const cookie = String(ok.headers['set-cookie']);
  assert.match(cookie, /orion_appareil=/);
  assert.match(cookie, /HttpOnly/);
  const appareilId = ok.json().appareil.id as string;
  assert.equal(ok.json().appareil.empreinteCle, undefined, 'l’empreinte de la clé ne sort jamais');

  // Mauvais code : refusé, journalisé ; au sixième essai depuis la même adresse, attente.
  for (let i = 0; i < 5; i += 1) {
    const ko = await app.inject({ method: 'POST', url: '/appareils/enroler', ...ip(9), payload: { code: `essai-${i}-0000000000`, nom: 'Inconnu', plateforme: 'web', application: 'console' } });
    assert.equal(ko.statusCode, 401);
  }
  const bloque = await app.inject({ method: 'POST', url: '/appareils/enroler', ...ip(9), payload: { code: CODE, nom: 'Inconnu', plateforme: 'web', application: 'console' } });
  assert.equal(bloque.statusCode, 429, 'même le bon code attend, une fois le quota d’essais épuisé');
  assert.ok(Number(bloque.headers['retry-after']) > 0);
  // Une autre adresse n'est pas pénalisée.
  const autre = await app.inject({ method: 'POST', url: '/appareils/enroler', ...ip(2), payload: { code: CODE, nom: 'iPad · Supervision', plateforme: 'ios', application: 'tableau' } });
  assert.equal(autre.statusCode, 200);
  assert.ok(container.audit.list().filter((e) => e.action === 'appareil.refus.code_invalide').length >= 5);

  // Politique « appareil exigé » : sans appareil, ni connexion ni console.
  reglages.APPAREILS_EXIGES = true;
  const sansAppareil = await app.inject({ method: 'POST', url: '/admin/login', payload: { username: 'admin', password: 'x' } });
  assert.equal(sansAppareil.statusCode, 403);
  assert.equal(sansAppareil.json().error.code, 'APPAREIL_NON_ENROLE');

  const login = await app.inject({ method: 'POST', url: '/admin/login', headers: { 'x-orion-appareil': cle }, payload: { username: config.ADMIN_USERNAME, password: config.ADMIN_PASSWORD } });
  assert.equal(login.statusCode, 200, login.body);
  const session = { authorization: `Bearer ${login.json().token}` };
  const vue = await app.inject({ method: 'GET', url: '/admin/overview', headers: { ...session, 'x-orion-appareil': cle } });
  assert.equal(vue.statusCode, 200);
  // Même session, sans l'appareil : refus.
  assert.equal((await app.inject({ method: 'GET', url: '/admin/overview', headers: session })).statusCode, 403);
  // Le cookie posé à l'enrôlement suffit (navigateur, application de bureau).
  const parCookie = await app.inject({ method: 'GET', url: '/admin/overview', headers: { ...session, cookie: `orion_appareil=${encodeURIComponent(cle)}` } });
  assert.equal(parCookie.statusCode, 200);

  // La console liste les appareils, avec leur dernière activité et le dernier compte.
  const liste = await app.inject({ method: 'GET', url: '/admin/appareils', headers: AUTH });
  const pc = liste.json().appareils.find((a: { id: string }) => a.id === appareilId);
  assert.equal(pc.nom, 'PC Windows · Direction');
  assert.equal(pc.actif, true);
  assert.equal(pc.dernierCompte, config.ADMIN_USERNAME);

  // Révocation : l'accès est coupé dès la requête suivante, session encore valide ou non.
  const rev = await app.inject({ method: 'POST', url: `/admin/appareils/${appareilId}/revoquer`, headers: AUTH });
  assert.equal(rev.statusCode, 200);
  assert.equal(rev.json().appareil.actif, false);
  assert.equal((await app.inject({ method: 'GET', url: '/admin/overview', headers: { ...session, 'x-orion-appareil': cle } })).statusCode, 403);
  assert.ok(container.audit.list().some((e) => e.action === 'appareil.revoque' && e.target === appareilId));
});

test('Sans empreinte configurée : enrôlement indisponible (503), rien d’autre ne change', async (t) => {
  const avant = reglages.ORION_CODE_SYNCHRO_EMPREINTE;
  reglages.ORION_CODE_SYNCHRO_EMPREINTE = undefined;
  t.after(() => { reglages.ORION_CODE_SYNCHRO_EMPREINTE = avant; });
  const { app } = await buildApp();
  t.after(() => app.close());
  const r = await app.inject({ method: 'POST', url: '/appareils/enroler', payload: { code: CODE, nom: 'PC', plateforme: 'web', application: 'console' } });
  assert.equal(r.statusCode, 503);
  assert.equal((await app.inject({ method: 'GET', url: '/admin/overview', headers: { 'x-admin-token': 'orion-admin-dev' } })).statusCode, 200);
});
