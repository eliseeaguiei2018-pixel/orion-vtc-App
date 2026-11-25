import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { FastifyInstance } from 'fastify';

/**
 * IDENTIFIANT CONSOLE AUTOMATIQUE ET PHOTO PROTÉGÉE.
 *  - Tout chauffeur a son identifiant console (inscription dans l'app, ajout à une flotte) :
 *    son chef d'équipe lui écrit et lui demande un rapport sans démarche préalable.
 *  - Le chauffeur choisit son mot de passe console depuis l'app, puis ouvre « Mon poste ».
 *  - La photo d'un chauffeur n'est servie qu'avec une adresse signée et expirante, au
 *    chauffeur lui-même ou au personnel habilité — plus à quiconque connaît son identifiant.
 */
const A = { 'x-admin-token': 'orion-admin-dev' };
const JPEG = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAAA//EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AN//Z';

async function appDriver(app: FastifyInstance, phone: string, name: string) {
  const otp = (await app.inject({ method: 'POST', url: '/drivers/auth/otp', payload: { phone } })).json();
  const v = (await app.inject({ method: 'POST', url: '/drivers/auth/verify', payload: { phone, code: otp.devCode, name } })).json();
  return { id: v.driver.id as string, headers: { authorization: `Bearer ${v.token}` } };
}

test('Identifiant console : créé à l’inscription, mot de passe choisi dans l’app, connexion console', async (t) => {
  const { buildApp } = await import('../src/app.js');
  const { app, container } = await buildApp();
  t.after(() => app.close());
  const d = await appDriver(app, '0191000001', 'Mariam Kouassi');
  const acces = container.accounts.parChauffeur(d.id);
  assert.ok(acces, 'identifiant créé dès l’inscription');
  assert.equal(acces!.role, 'chauffeur');
  assert.ok(container.audit.list(50).some((e) => e.action === 'account.chauffeur_auto'));

  const court = await app.inject({ method: 'POST', url: `/drivers/${d.id}/console/mot-de-passe`, headers: d.headers, payload: { motDePasse: 'court' } });
  assert.equal(court.statusCode, 400);
  const ok = await app.inject({ method: 'POST', url: `/drivers/${d.id}/console/mot-de-passe`, headers: d.headers, payload: { motDePasse: 'Plateau-2026-orion' } });
  assert.equal(ok.statusCode, 200, ok.body);
  assert.equal(ok.json().identifiant, acces!.username);
  // Un autre chauffeur ne peut pas changer ce mot de passe.
  const autre = await appDriver(app, '0191000002', 'Autre Chauffeur');
  assert.equal((await app.inject({ method: 'POST', url: `/drivers/${d.id}/console/mot-de-passe`, headers: autre.headers, payload: { motDePasse: 'Piratage-2026-xx' } })).statusCode, 403);

  // Le chauffeur ouvre la console avec SON identifiant : son poste, et rien d'autre.
  const login = await app.inject({ method: 'POST', url: '/admin/login', payload: { username: acces!.username, password: 'Plateau-2026-orion' } });
  assert.equal(login.statusCode, 200, login.body);
  const H = { authorization: `Bearer ${login.json().token}` };
  const crew = await app.inject({ method: 'GET', url: '/admin/crew', headers: H });
  assert.equal(crew.statusCode, 200, crew.body);
  assert.equal(crew.json().moi, d.id);
});

test('Chef d’équipe : écrit et demande un rapport à un chauffeur de sa flotte, sans démarche préalable', async (t) => {
  const { buildApp } = await import('../src/app.js');
  const { app, container } = await buildApp();
  t.after(() => app.close());
  const c = await app.inject({ method: 'POST', url: '/admin/accounts', headers: A, payload: { name: 'Serge Kouadio', role: 'manager', phone: '0700000001' } });
  const { account, motDePasseProvisoire } = c.json();
  const l = await app.inject({ method: 'POST', url: '/admin/login', payload: { username: account.username, password: motDePasseProvisoire } });
  const chef = { authorization: `Bearer ${l.json().token}` };

  // Un chauffeur ajouté par la console (sans app) : son identifiant naît avec la flotte.
  const d = container.drivers.upsert({ id: 'drv-flotte-1', name: 'Konan Yao', matricule: 'AB-200-CI', category: 'or', kycStatus: 'active', availability: 'offline', ratingAvg: 4.8, ratingCount: 10, phone: '+2250701020304' });
  container.teams.upsert({ id: 'flotte-sud', name: 'Flotte Sud', managerUsername: account.username, managerName: 'Serge Kouadio', driverIds: [d.id] });
  const id = container.accounts.parChauffeur(d.id)?.username;
  assert.ok(id, 'identifiant créé à l’ajout dans la flotte');

  // Le poste du chef montre l'identifiant, la photo et les annulations de chaque chauffeur.
  const poste = (await app.inject({ method: 'GET', url: '/admin/teams/flotte-sud/poste', headers: chef })).json().poste;
  assert.equal(poste.flotte[0].identifiant, id);
  assert.equal(poste.flotte[0].annulations, 0);
  assert.equal(poste.membres.length, 0, 'les chauffeurs restent dans la flotte, pas parmi les membres');

  const m = await app.inject({ method: 'POST', url: '/admin/teams/flotte-sud/messages', headers: chef, payload: { a: id, texte: 'Révision du véhicule jeudi.', reponseAttendue: true } });
  assert.equal(m.statusCode, 201, m.body);
  const r = await app.inject({ method: 'POST', url: '/admin/teams/flotte-sud/rapports', headers: chef, payload: { destinataire: id, titre: 'Bilan semaine', consigne: 'Courses et incidents', echeance: new Date(Date.now() + 86_400_000).toISOString() } });
  assert.equal(r.statusCode, 201, r.body);
  assert.equal(container.staffComms.recus(id!).length, 1);
});

test('Photo : adresse signée et expirante ; refus sans signature ; console et chauffeur autorisés', async (t) => {
  const { buildApp } = await import('../src/app.js');
  const { app, container } = await buildApp();
  t.after(() => app.close());
  const d = await appDriver(app, '0191000003', 'Grace Photo');
  const put = await app.inject({ method: 'PUT', url: `/drivers/${d.id}/photo`, headers: d.headers, payload: { photo: JPEG } });
  assert.equal(put.statusCode, 200, put.body);
  const url = put.json().photoUrl as string;
  assert.match(url, /&exp=\d+&sig=/, 'adresse signée');

  assert.equal((await app.inject({ method: 'GET', url })).statusCode, 200, 'adresse signée valable');
  const nue = `/drivers/${d.id}/photo`;
  assert.equal((await app.inject({ method: 'GET', url: nue })).statusCode, 403, 'l’identifiant seul ne suffit plus');
  assert.equal((await app.inject({ method: 'GET', url: url.replace(/sig=[^&]+/, 'sig=AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA') })).statusCode, 403, 'signature falsifiée');
  const passee = url.replace(/exp=\d+/, `exp=${Date.now() - 1000}`);
  assert.equal((await app.inject({ method: 'GET', url: passee })).statusCode, 403, 'adresse expirée');
  // Une signature pour un autre chauffeur ne vaut rien ici.
  const autre = await appDriver(app, '0191000004', 'Autre');
  assert.equal((await app.inject({ method: 'GET', url: url.replace(d.id, autre.id) })).statusCode, 403);
  assert.equal((await app.inject({ method: 'GET', url: nue, headers: d.headers })).statusCode, 200, 'le chauffeur lui-même');
  assert.equal((await app.inject({ method: 'GET', url: nue, headers: A })).statusCode, 200, 'le personnel habilité');

  // Console : photo (signée) et annulations dans la liste, la fiche et le dossier Équipages.
  const liste = (await app.inject({ method: 'GET', url: '/admin/drivers?limit=200', headers: A })).json().drivers as Array<{ id: string; photoUrl: string | null; cancellations: number }>;
  const ligne = liste.find((x) => x.id === d.id)!;
  assert.match(ligne.photoUrl!, /sig=/);
  assert.equal(ligne.cancellations, 0);
  const fiche = (await app.inject({ method: 'GET', url: `/admin/drivers/${d.id}`, headers: A })).json();
  const f = fiche.driver ?? fiche;
  assert.match(f.photoUrl, /sig=/);
  const dossier = (await app.inject({ method: 'GET', url: `/admin/crew/${d.id}`, headers: A })).json().dossier;
  assert.match(dossier.identite.photoUrl, /sig=/);
  assert.equal(dossier.identite.annulationsChauffeur, 0);
  void container;
});
