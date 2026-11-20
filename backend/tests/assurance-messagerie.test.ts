import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildApp } from '../src/app.js';
import { CoffreMedical, chargerCle } from '../src/modules/assurance/chiffrement.js';
import { CONSENTEMENT_VERSION } from '../src/modules/assurance/dossier.js';
import { controlerCoursesEnCours } from '../src/container.js';

/**
 * ORION ASSURANCE ET MESSAGERIE.
 *
 * Le dossier de premiers secours contient des données de santé : il doit être chiffré,
 * lisible par son seul titulaire, et ouvert par ORION seulement pendant une alerte, par
 * l'agent qui la gère, avec une trace que le client voit. Une réponse « je ne me sens
 * pas en sécurité » doit valoir un SOS.
 */
const A = { 'x-admin-token': 'orion-admin-dev' };
const ABIDJAN = { lat: 5.3236, lng: -4.0217 };
type App = Awaited<ReturnType<typeof buildApp>>['app'];

const dansUnAn = new Date(Date.now() + 365 * 86_400_000).toISOString().slice(0, 10);
const FICHE = {
  identite: { nom: 'Kouassi', prenoms: 'Aya Marie', dateNaissance: '1994-03-12', sexe: 'F' },
  piece: { type: 'cni', numero: 'CI0123456789', expiration: dansUnAn },
  cmu: '1234567890',
  sante: {
    groupeSanguin: 'O+', antecedents: ['asthme', 'drepanocytose'], allergies: 'Pénicilline', traitements: 'Ventoline',
    anticoagulants: false, stimulateurCardiaque: false, reactionAllergiqueGrave: true,
  },
  urgence: { nom: 'Koffi Kouassi', lien: 'Frère', telephone: '+2250701020304' },
};
const CONSENTEMENT = { version: CONSENTEMENT_VERSION, lu: true, accepte: true };

async function inscrire(app: App, clientId: string, phone: string) {
  const otp = await app.inject({ method: 'POST', url: '/clients/auth/otp', payload: { phone } });
  const v = await app.inject({ method: 'POST', url: '/clients/auth/verify', payload: { clientId, phone, code: otp.json().devCode, name: 'Aya Kouassi' } });
  assert.equal(v.statusCode, 200, v.body);
  return { authorization: `Bearer ${v.json().token as string}` };
}

test('chiffrement : illisible sans la clé, lié à son titulaire, toute altération refusée', () => {
  const coffre = new CoffreMedical(chargerCle(Buffer.alloc(32, 7).toString('base64'), true));
  const c = coffre.chiffrer('client-aya', FICHE);
  assert.ok(!c.data.includes('Kouassi') && !Buffer.from(c.data, 'base64').toString().includes('asthme'), 'aucune donnée en clair');
  assert.deepEqual(coffre.dechiffrer('client-aya', c), FICHE);
  assert.throws(() => coffre.dechiffrer('client-ben', c), 'le dossier d’Aya recopié sur la fiche de Ben est illisible');
  const altere = { ...c, data: Buffer.from(Buffer.from(c.data, 'base64').map((o, i) => (i === 3 ? o ^ 1 : o))).toString('base64') };
  assert.throws(() => coffre.dechiffrer('client-aya', altere), 'un octet modifié en base est refusé');
  assert.equal(chargerCle(undefined, true), null, 'en production sans clé : aucun chiffrement avec une clé connue');
  assert.throws(() => chargerCle(Buffer.alloc(16).toString('base64'), false), 'une clé de mauvaise taille est refusée');
});

test('dossier : réservé au titulaire, consentement et pièce valide exigés', async (t) => {
  const { app } = await buildApp();
  t.after(() => app.close());
  const aya = await inscrire(app, 'client-aya', '0711111111');
  const ben = await inscrire(app, 'client-ben', '0722222222');
  const url = '/clients/client-aya/assurance/dossier';

  assert.equal((await app.inject({ method: 'GET', url })).statusCode, 401, 'sans session');
  assert.equal((await app.inject({ method: 'GET', url, headers: ben })).statusCode, 403, 'session d’un autre client');
  assert.equal((await app.inject({ method: 'PUT', url, headers: aya, payload: { fiche: FICHE } })).statusCode, 400, 'sans consentement');
  assert.equal((await app.inject({ method: 'PUT', url, headers: aya, payload: { fiche: FICHE, consentement: { ...CONSENTEMENT, accepte: false } } })).statusCode, 400);
  const expiree = { ...FICHE, piece: { ...FICHE.piece, expiration: '2020-01-01' } };
  const refus = await app.inject({ method: 'PUT', url, headers: aya, payload: { fiche: expiree, consentement: CONSENTEMENT } });
  assert.equal(refus.statusCode, 400, 'pièce expirée');
  assert.match(refus.body, /expirée/);

  const ok = await app.inject({ method: 'PUT', url, headers: aya, payload: { fiche: FICHE, consentement: CONSENTEMENT } });
  assert.equal(ok.statusCode, 200, ok.body);
  assert.equal(ok.json().statut.inscrit, true);
  assert.match(String(ok.headers['cache-control']), /no-store/, 'aucune mise en cache');

  const lu = await app.inject({ method: 'GET', url, headers: aya });
  assert.equal(lu.json().fiche.sante.groupeSanguin, 'O+');

  // Le journal dit QUE le dossier a changé, jamais ce qu'il contient.
  const journal = (await app.inject({ method: 'GET', url: '/admin/audit', headers: A })).body;
  assert.match(journal, /assurance\.inscription/);
  assert.doesNotMatch(journal, /Pénicilline|drepanocytose|CI0123456789/);

  assert.equal((await app.inject({ method: 'DELETE', url, headers: aya })).json().statut.inscrit, false, 'suppression à tout moment');
});

test('commande : l’option à 2 % exige l’inscription (gratuite) au dossier', async (t) => {
  const { app } = await buildApp();
  t.after(() => app.close());
  const aya = await inscrire(app, 'client-aya', '0711111111');
  const devis = (insurance: boolean) => app.inject({
    method: 'POST', url: '/pricing/estimate',
    payload: { origin: ABIDJAN, destination: { lat: 5.36, lng: -3.99 }, category: 'bronze', insurance, clientId: 'client-aya' },
  });
  const refus = await devis(true);
  assert.equal(refus.statusCode, 409);
  assert.equal(refus.json().error.code, 'ASSURANCE_NON_INSCRIT');
  assert.equal((await devis(false)).statusCode, 200, 'sans l’option, rien ne change');

  await app.inject({ method: 'PUT', url: '/clients/client-aya/assurance/dossier', headers: aya, payload: { fiche: FICHE, consentement: CONSENTEMENT } });
  const ok = await devis(true);
  assert.equal(ok.statusCode, 200, ok.body);
  assert.ok(ok.json().quote.breakdown.insurance > 0, 'cotisation de 2 % ajoutée');
});

test('SAMU : dossier ouvert seulement par l’agent qui gère une alerte EN COURS, et le client le sait', async (t) => {
  const { app } = await buildApp();
  t.after(() => app.close());
  const aya = await inscrire(app, 'client-aya', '0711111111');
  await app.inject({ method: 'PUT', url: '/clients/client-aya/assurance/dossier', headers: aya, payload: { fiche: FICHE, consentement: CONSENTEMENT } });
  const alerte = (await app.inject({ method: 'POST', url: '/safety/sos', payload: { userId: 'client-aya', location: ABIDJAN } })).json().alert;
  const url = `/admin/sos/${alerte.id}/dossier-medical`;

  const detail = await app.inject({ method: 'GET', url: `/admin/sos/${alerte.id}`, headers: A });
  assert.equal(detail.json().assurance.inscrit, true, 'la console sait qu’un dossier existe, sans le contenu');
  assert.doesNotMatch(detail.body, /Pénicilline/);

  const avantPriseEnCharge = await app.inject({ method: 'GET', url, headers: A });
  assert.equal(avantPriseEnCharge.statusCode, 403, 'il faut d’abord prendre l’alerte en charge');

  await app.inject({ method: 'POST', url: `/admin/sos/${alerte.id}/claim`, headers: A });
  const ouvert = await app.inject({ method: 'GET', url, headers: A });
  assert.equal(ouvert.statusCode, 200, ouvert.body);
  assert.equal(ouvert.json().fiche.sante.groupeSanguin, 'O+');
  assert.match(String(ouvert.headers['cache-control']), /no-store/);

  // Le client voit qui a ouvert son dossier, et reçoit un message.
  const statut = (await app.inject({ method: 'GET', url: '/clients/client-aya/assurance', headers: aya })).json().statut;
  assert.equal(statut.consultations.length, 1);
  assert.equal(statut.consultations[0].alerteId, alerte.id);
  const boite = (await app.inject({ method: 'GET', url: '/clients/client-aya/messages', headers: aya })).json();
  assert.match(boite.messages[0].titre, /consulté/);

  await app.inject({ method: 'POST', url: `/admin/sos/${alerte.id}/close`, headers: A, payload: { note: 'Cliente prise en charge, tout va bien.' } });
  assert.equal((await app.inject({ method: 'GET', url, headers: A })).statusCode, 403, 'alerte close : plus d’accès');
});

test('messagerie : consigne de la console, contrôle en course, « pas en sécurité » = SOS', async (t) => {
  const { app, container } = await buildApp();
  t.after(() => app.close());
  const aya = await inscrire(app, 'client-aya', '0711111111');

  assert.equal((await app.inject({ method: 'GET', url: '/clients/client-aya/messages' })).statusCode, 401, 'boîte réservée au titulaire');

  const consigne = await app.inject({
    method: 'POST', url: '/admin/messages', headers: A,
    payload: { cible: 'client', telephone: '0711111111', type: 'consigne', titre: 'Fortes pluies', texte: 'Évitez le boulevard de Marseille ce soir.' },
  });
  assert.equal(consigne.statusCode, 200, consigne.body);
  assert.equal(consigne.json().envoyes, 1);
  let boite = (await app.inject({ method: 'GET', url: '/clients/client-aya/messages', headers: aya })).json();
  assert.equal(boite.nonLus, 1);
  assert.deepEqual(boite.messages[0].reponses.map((r: { code: string }) => r.code), ['lu', 'question']);

  // Course en cours depuis assez longtemps : le contrôle automatique part une seule fois.
  const ride = {
    id: 'course-test', clientId: 'client-aya', status: 'in_progress', serviceType: 'ride', origin: ABIDJAN, destination: ABIDJAN,
    quote: {} as never, events: [{ type: 'in_progress', at: new Date(Date.now() - 600_000).toISOString() }], shareToken: 'x', createdAt: new Date().toISOString(),
  };
  container.rides.save(ride as never);
  assert.equal(controlerCoursesEnCours(container, 180), 1);
  assert.equal(controlerCoursesEnCours(container, 180), 0, 'une seule fois par course');
  boite = (await app.inject({ method: 'GET', url: '/clients/client-aya/messages', headers: aya })).json();
  const controle = boite.messages.find((m: { type: string }) => m.type === 'controle');
  assert.ok(controle, 'contrôle de sécurité reçu');

  const ok = await app.inject({ method: 'POST', url: `/clients/client-aya/messages/${controle.id}/reponse`, headers: aya, payload: { code: 'danger' } });
  assert.equal(ok.statusCode, 200, ok.body);
  assert.ok(ok.json().alerteId, 'une alerte SOS est levée');
  const file = (await app.inject({ method: 'GET', url: '/admin/sos', headers: A })).json().alerts;
  assert.ok(file.some((a: { id: string; note?: string }) => a.id === ok.json().alerteId && /pas en sécurité/.test(a.note ?? '')));

  const inconnu = await app.inject({ method: 'POST', url: `/clients/client-aya/messages/${controle.id}/reponse`, headers: aya, payload: { code: 'pirate' } });
  assert.equal(inconnu.statusCode, 404, 'seules les réponses proposées sont acceptées');

  // Course terminée : un contrôle resté sans réponse est clos, plus d'alerte possible par ce biais.
  const second = container.messages.controleSecurite('client-aya', 'course-test', 'Agent test');
  container.rides.save({ ...ride, status: 'completed' } as never);
  boite = (await app.inject({ method: 'GET', url: '/clients/client-aya/messages', headers: aya })).json();
  const clos = boite.messages.find((m: { id: string }) => m.id === second.id);
  assert.equal(clos.clos, true);
  assert.deepEqual(clos.reponses, []);
  const tardif = await app.inject({ method: 'POST', url: `/clients/client-aya/messages/${second.id}/reponse`, headers: aya, payload: { code: 'danger' } });
  assert.equal(tardif.statusCode, 404, 'contrôle d’une course terminée : plus de réponse');
});

test('données financières : portefeuille et cotisations réservés au titulaire', async (t) => {
  const { app } = await buildApp();
  t.after(() => app.close());
  const aya = await inscrire(app, 'client-aya', '0711111111');
  assert.equal((await app.inject({ method: 'GET', url: '/clients/client-aya/wallet' })).statusCode, 401);
  assert.equal((await app.inject({ method: 'POST', url: '/clients/client-aya/wallet/transfer', payload: { amount: 1000, method: 'wave' } })).statusCode, 401);
  assert.equal((await app.inject({ method: 'GET', url: '/clients/client-aya/insurance' })).statusCode, 401);
  assert.equal((await app.inject({ method: 'GET', url: '/clients/client-aya/rides' })).statusCode, 401);
  assert.equal((await app.inject({ method: 'GET', url: '/clients/client-aya/wallet', headers: aya })).statusCode, 200);
});

test('dossier : numéros saisis avec espaces acceptés et stockés sans espaces', async () => {
  const { ficheSchema } = await import('../src/modules/assurance/dossier.js');
  const ok = ficheSchema.safeParse({ ...FICHE, urgence: { ...FICHE.urgence, telephone: '+225 07 58 42 19 63' }, medecin: { nom: 'Dr Bamba', telephone: '27 22 41 00 00' } });
  assert.ok(ok.success, JSON.stringify(!ok.success && ok.error.issues));
  assert.equal(ok.data.urgence.telephone, '+2250758421963');
  assert.equal(ok.data.medecin?.telephone, '2722410000');
  assert.equal(ficheSchema.safeParse({ ...FICHE, urgence: { ...FICHE.urgence, telephone: '07 58' } }).success, false);
});
