import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { FastifyInstance } from 'fastify';
import type { RealtimeMessage } from '../src/modules/realtime/hub.js';

/**
 * POSTE DU CHAUFFEUR DANS SON APP : dossier 30 jours, requêtes (même circuit que la
 * console), messages et rapports du chef d'équipe, photo vue par le passager.
 */
const AUTH = { 'x-admin-token': 'orion-admin-dev' };
// Plus petit JPEG valide (signature FF D8 FF), encodé en base64.
const JPEG = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAAA//EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AN//Z';

async function appDriver(app: FastifyInstance, phone: string, name: string) {
  const otp = (await app.inject({ method: 'POST', url: '/drivers/auth/otp', payload: { phone } })).json();
  const v = (await app.inject({ method: 'POST', url: '/drivers/auth/verify', payload: { phone, code: otp.devCode, name } })).json();
  return { id: v.driver.id as string, headers: { authorization: `Bearer ${v.token}` } };
}

test('Poste : dossier, plafonds, requêtes et circuit de décision en direct', async (t) => {
  const { buildApp } = await import('../src/app.js');
  const { app, container } = await buildApp();
  t.after(() => app.close());
  const d = await appDriver(app, '0190000001', 'Yao Poste');
  const autre = await appDriver(app, '0190000002', 'Autre');

  const poste = await app.inject({ method: 'GET', url: `/drivers/${d.id}/poste`, headers: d.headers });
  assert.equal(poste.statusCode, 200, poste.body);
  const p = poste.json();
  assert.equal(p.activite.periodeJours, 30);
  assert.equal(p.plafonds.avance, 150_000);
  assert.ok(p.typesRequete.some((x: { code: string }) => x.code === 'pret'));
  assert.ok(p.acces?.identifiant, 'identifiant console créé dès l’inscription');
  // Jamais le poste d'un collègue.
  assert.equal((await app.inject({ method: 'GET', url: `/drivers/${d.id}/poste`, headers: autre.headers })).statusCode, 403);

  const { driverRoom } = await import('../src/modules/realtime/hub.js');
  const msgs: RealtimeMessage[] = [];
  container.realtime.subscribe(driverRoom(d.id), (m) => msgs.push(m));

  const depot = (payload: Record<string, unknown>) => app.inject({ method: 'POST', url: `/drivers/${d.id}/requetes`, headers: d.headers, payload });
  assert.equal((await depot({ type: 'avance', montant: 200_000, motif: 'Rentrée scolaire' })).statusCode, 400, 'plafond d’avance');
  assert.equal((await depot({ type: 'avance', motif: 'Sans montant' })).statusCode, 400, 'montant requis');
  assert.equal((await depot({ type: 'conge', motif: 'Mariage de ma sœur' })).statusCode, 400, 'dates du congé requises');
  const ok = await depot({ type: 'pret', montant: 300_000, echeances: 6, motif: 'Changement des pneus' });
  assert.equal(ok.statusCode, 201, ok.body);
  const req = ok.json().requete;
  assert.equal(req.statutLabel.length > 0, true);
  assert.ok(msgs.some((m) => m.type === 'crew.request'), 'dépôt poussé en direct');

  // Circuit console : avis du chef, accord de la direction financière → le chauffeur le voit.
  await app.inject({ method: 'POST', url: `/admin/crew/requetes/${req.id}/instruire`, headers: AUTH, payload: { avis: 'favorable' } });
  const dec = await app.inject({ method: 'POST', url: `/admin/crew/requetes/${req.id}/decider`, headers: AUTH, payload: { decision: 'accord', montantAccorde: 250_000, note: 'Accordé sur 6 mois' } });
  assert.equal(dec.statusCode, 200, dec.body);
  const apres = (await app.inject({ method: 'GET', url: `/drivers/${d.id}/poste`, headers: d.headers })).json();
  const vue = apres.requetes.find((r: { id: string }) => r.id === req.id);
  assert.equal(vue.statut, 'accordee');
  assert.equal(vue.montantAccorde, 250_000);
  assert.equal(vue.decisionNote, 'Accordé sur 6 mois');
  assert.equal('avisNote' in vue, false, 'l’avis interne du chef reste interne');
  assert.ok(msgs.some((m) => m.type === 'notification' && (m.data as { title: string }).title === 'Votre requête ORION'));
  // Prêt accordé = prêt en cours : pas de second prêt tant qu'il n'est pas remboursé.
  assert.equal((await depot({ type: 'pret', montant: 100_000, motif: 'Deuxième prêt' })).statusCode, 409, 'un seul prêt en cours');
});

test('Équipe et messages du chef : lecture, réponse et rapport depuis l’app', async (t) => {
  const { buildApp } = await import('../src/app.js');
  const { app, container } = await buildApp();
  t.after(() => app.close());
  const d = await appDriver(app, '0190000003', 'Awa Équipe');

  // L'identifiant console du chauffeur existe dès son inscription : personne n'a à le créer.
  const vide = (await app.inject({ method: 'GET', url: `/drivers/${d.id}/messages`, headers: d.headers })).json();
  assert.ok(vide.identifiant, 'identifiant automatique');
  assert.equal(vide.messages.length, 0);

  const chef = container.accounts.creer({ name: 'Serge Manager', role: 'manager', phone: '+2250700000001', createdBy: 'test' });
  assert.ok(chef.ok);
  const chefUser = chef.ok ? chef.account.username : '';
  container.teams.upsert({ name: 'Équipe Plateau', managerUsername: chefUser, managerName: 'Serge Manager', mission: 'Secteur Plateau', driverIds: [d.id] });
  const user = container.accounts.parChauffeur(d.id)!.username;
  assert.equal(user, vide.identifiant);

  const poste = (await app.inject({ method: 'GET', url: `/drivers/${d.id}/poste`, headers: d.headers })).json();
  assert.equal(poste.equipe.name, 'Équipe Plateau');
  assert.equal(poste.equipe.chefTelephone, '+2250700000001', 'le chauffeur peut appeler son chef');
  assert.equal(poste.acces.identifiant, user);

  const { driverRoom } = await import('../src/modules/realtime/hub.js');
  const msgs: RealtimeMessage[] = [];
  container.realtime.subscribe(driverRoom(d.id), (m) => msgs.push(m));
  const m = container.staffComms.ecrire({ de: chefUser, deNom: 'Serge Manager', a: user, aNom: 'Awa Équipe', texte: 'Passe au bureau demain 8 h.', reponseAttendue: true });
  assert.ok(msgs.some((x) => x.type === 'poste.message'));
  assert.ok(msgs.some((x) => x.type === 'notification' && (x.data as { title: string }).title === 'Message de Serge Manager'));

  const liste = (await app.inject({ method: 'GET', url: `/drivers/${d.id}/messages`, headers: d.headers })).json();
  assert.equal(liste.nonLus, 1);
  assert.equal(liste.messages[0].id, m.id);
  await app.inject({ method: 'POST', url: `/drivers/${d.id}/messages/${m.id}/lu`, headers: d.headers });
  const rep = await app.inject({ method: 'POST', url: `/drivers/${d.id}/messages/${m.id}/reponse`, headers: d.headers, payload: { texte: 'Bien reçu, j’y serai.' } });
  assert.equal(rep.statusCode, 200, rep.body);
  assert.equal(container.staffComms.getMessage(m.id)!.reponses[0]!.texte, 'Bien reçu, j’y serai.');
  assert.equal(container.staffComms.nonLus(user), 0);

  const r = container.staffComms.demanderRapport({ teamId: 'x', demandePar: chefUser, demandeParNom: 'Serge Manager', destinataire: user, destinataireNom: 'Awa Équipe', titre: 'Bilan de la semaine', consigne: 'Courses, incidents, carburant', echeance: new Date(Date.now() + 86_400_000).toISOString() });
  const rendu = await app.inject({ method: 'POST', url: `/drivers/${d.id}/rapports/${r.id}/rendre`, headers: d.headers, payload: { texte: '42 courses, aucun incident.' } });
  assert.equal(rendu.statusCode, 200, rendu.body);
  assert.equal(rendu.json().rapport.statut, 'rendu');
});

test('Photo du chauffeur : vérifiée, servie à part, visible du passager', async (t) => {
  const { buildApp } = await import('../src/app.js');
  const { app } = await buildApp();
  t.after(() => app.close());
  const d = await appDriver(app, '0190000004', 'Konan Photo');
  await app.inject({ method: 'POST', url: `/admin/drivers/${d.id}/kyc`, headers: AUTH, payload: { status: 'active' } });
  // Véhicule attribué par ORION (chauffeur salarié) : l'app chauffeur ne peut plus le saisir.
  const refus = await app.inject({ method: 'POST', url: `/drivers/${d.id}/profile`, headers: d.headers, payload: { vehicleModel: 'BYD Dolphin' } });
  assert.equal(refus.statusCode, 403);
  await app.inject({ method: 'POST', url: `/admin/drivers/${d.id}/attribution`, headers: AUTH, payload: { vehicleModel: 'BYD Dolphin', vehiclePlate: '4521 KL 01', vehicleColor: 'Blanc' } });

  assert.equal((await app.inject({ method: 'PUT', url: `/drivers/${d.id}/photo`, headers: d.headers, payload: { photo: 'data:image/jpeg;base64,AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' } })).statusCode, 400, 'contenu vérifié');
  const put = await app.inject({ method: 'PUT', url: `/drivers/${d.id}/photo`, headers: d.headers, payload: { photo: JPEG } });
  assert.equal(put.statusCode, 200, put.body);
  const url = put.json().photoUrl as string;
  assert.match(url, /^\/drivers\/.+\/photo\?v=/);
  const img = await app.inject({ method: 'GET', url });
  assert.equal(img.statusCode, 200);
  assert.equal(img.headers['content-type'], 'image/jpeg');
  // La fiche ne transporte pas l'image (elle circule sans cesse en temps réel).
  const me = (await app.inject({ method: 'GET', url: '/drivers/me', headers: d.headers })).json();
  assert.equal(me.driver.photo, undefined);
  assert.ok(me.driver.photoUpdatedAt);

  // Le passager reconnaît son chauffeur : photo, véhicule, VRAIE plaque.
  await app.inject({ method: 'POST', url: `/drivers/${d.id}/online`, headers: d.headers, payload: { position: { lat: 5.336, lng: -4.031 } } });
  const est = await app.inject({ method: 'POST', url: '/pricing/estimate', payload: { origin: { lat: 5.335, lng: -4.03 }, destination: { lat: 5.345, lng: -4.02 }, category: 'argent' } });
  const ride = (await app.inject({ method: 'POST', url: '/rides', headers: { 'idempotency-key': 'photo-1' }, payload: { clientId: 'client-photo', lockId: est.json().quote.lockId } })).json();
  assert.equal(ride.driver.photoUrl, url);
  assert.equal(ride.driver.vehiclePlate, '4521 KL 01');
  assert.equal(ride.driver.vehicleColor, 'Blanc');

  const del = await app.inject({ method: 'DELETE', url: `/drivers/${d.id}/photo`, headers: d.headers });
  assert.equal(del.json().photoUrl, null);
  assert.equal((await app.inject({ method: 'GET', url })).statusCode, 404);
});
