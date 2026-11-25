import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildApp } from '../src/app.js';

/**
 * POSTE DE TRAVAIL DU CHEF D'ÉQUIPE, et ce que « Mon poste » en montre.
 *
 * La session Équipes montrait des équipes : un nom, un manager, des chauffeurs. On
 * pouvait la regarder, pas y travailler. Ces tests vérifient qu'un chef peut
 * réellement diriger — écrire, demander un bilan, voir ce qui n'a pas été rendu —
 * et que chaque membre retrouve tout cela sur son propre poste.
 */
const A = { 'x-admin-token': 'orion-admin-dev' };
type App = Awaited<ReturnType<typeof buildApp>>['app'];

async function compte(app: App, payload: Record<string, unknown>) {
  const c = await app.inject({ method: 'POST', url: '/admin/accounts', headers: A, payload });
  assert.equal(c.statusCode, 200, c.body);
  const { account, motDePasseProvisoire } = c.json();
  const l = await app.inject({ method: 'POST', url: '/admin/login', payload: { username: account.username, password: motDePasseProvisoire } });
  assert.equal(l.statusCode, 200, l.body);
  return { username: account.username as string, headers: { authorization: `Bearer ${l.json().token}` } };
}

test('un chef dirige : il voit ses membres, leur écrit et leur demande un bilan', async (t) => {
  const { app, container } = await buildApp();
  t.after(() => app.close());

  const chef = await compte(app, { name: 'Serge Kouadio', role: 'manager' });
  container.teams.upsert({
    id: 'flotte-nord', name: 'Flotte Nord', managerUsername: chef.username,
    managerName: 'Serge Kouadio', mission: 'Cocody, Riviera et Deux-Plateaux',
  });
  const membre = await compte(app, { name: 'Prisca Akissi', role: 'agent', teamId: 'flotte-nord', phone: '0708091011' });

  const d = container.drivers.upsert({
    id: 'drv-nord-1', name: 'Konan Yao', matricule: 'AB-114-CI', category: 'or',
    kycStatus: 'active', availability: 'online', ratingAvg: 4.9, ratingCount: 40, phone: '+2250701020304',
  });
  container.teams.setDrivers('flotte-nord', [d.id]);

  const poste = await app.inject({ method: 'GET', url: '/admin/teams/flotte-nord/poste', headers: chef.headers });
  assert.equal(poste.statusCode, 200, poste.body);
  const p = poste.json().poste;
  assert.equal(p.equipe.mission, 'Cocody, Riviera et Deux-Plateaux');
  assert.equal(p.membres.length, 1);
  assert.equal(p.membres[0].name, 'Prisca Akissi');
  assert.equal(p.membres[0].phone, '0708091011', 'un chef doit pouvoir appeler son monde');
  assert.equal(p.flotte.length, 1);
  assert.equal(p.flotte[0].matricule, 'AB-114-CI');

  // Il écrit dans la console, pas sur le téléphone personnel de l'agent.
  const msg = await app.inject({
    method: 'POST', url: '/admin/teams/flotte-nord/messages', headers: chef.headers,
    payload: { a: membre.username, sujet: 'Contrôle technique', texte: 'Peux-tu caler le passage de AB-114-CI cette semaine ?', reponseAttendue: true },
  });
  assert.equal(msg.statusCode, 201, msg.body);

  // Et il demande un livrable daté, pas un message de plus.
  const rapport = await app.inject({
    method: 'POST', url: '/admin/teams/flotte-nord/rapports', headers: chef.headers,
    payload: { destinataire: membre.username, titre: 'Bilan hebdomadaire flotte Nord', consigne: 'État des véhicules, incidents, kilométrage.', echeance: '2026-11-14' },
  });
  assert.equal(rapport.statusCode, 201, rapport.body);

  // Le membre retrouve les deux sur SON poste, sans rien chercher.
  const monPoste = await app.inject({ method: 'GET', url: '/admin/mon-poste', headers: membre.headers });
  assert.equal(monPoste.statusCode, 200, monPoste.body);
  const mp = monPoste.json();
  assert.equal(mp.messages.length, 1);
  assert.equal(mp.messages[0].lu, false);
  assert.equal(mp.bilan.messagesNonLus, 1);
  assert.equal(mp.rapports.length, 1);
  assert.equal(mp.bilan.rapportsARendre, 1);
  assert.equal(mp.flotte.length, 1, 'l’agent voit la flotte qui lui est accréditée');
  assert.equal(mp.flotte[0].matricule, 'AB-114-CI');
});

test('un rapport se rend, se refuse, se refait — et l’absence se voit', async (t) => {
  const { app, container } = await buildApp();
  t.after(() => app.close());

  const chef = await compte(app, { name: 'Idrissa Barry', role: 'manager' });
  container.teams.upsert({ id: 'eq', name: 'Équipe Ouest', managerUsername: chef.username });
  const membre = await compte(app, { name: 'Odette Assi', role: 'agent', teamId: 'eq' });

  const r = await app.inject({
    method: 'POST', url: '/admin/teams/eq/rapports', headers: chef.headers,
    payload: { destinataire: membre.username, titre: 'Point hebdo', consigne: 'Trois lignes suffisent.', echeance: '2020-01-01' },
  });
  const id = r.json().rapport.id;

  // Échéance dépassée : cela doit se voir sur le poste du chef comme sur celui du membre.
  const posteChef = (await app.inject({ method: 'GET', url: '/admin/teams/eq/poste', headers: chef.headers })).json().poste;
  assert.equal(posteChef.bilan.rapportsEnRetard, 1);
  assert.equal(posteChef.membres[0].rapportsEnRetard, 1);

  // Le chef ne rend pas le rapport à la place du membre.
  const usurpation = await app.inject({ method: 'POST', url: `/admin/rapports/${id}/rendre`, headers: chef.headers, payload: { texte: 'Je le fais moi-même.' } });
  assert.equal(usurpation.statusCode, 403);

  const rendu = await app.inject({ method: 'POST', url: `/admin/rapports/${id}/rendre`, headers: membre.headers, payload: { texte: 'RAS cette semaine.' } });
  assert.equal(rendu.statusCode, 200, rendu.body);
  assert.equal(rendu.json().rapport.statut, 'rendu');

  // Le membre ne statue pas sur son propre rendu.
  const autoAccept = await app.inject({ method: 'POST', url: `/admin/rapports/${id}/statuer`, headers: membre.headers, payload: { decision: 'accepte' } });
  assert.equal(autoAccept.statusCode, 403);

  const revoir = await app.inject({
    method: 'POST', url: `/admin/rapports/${id}/statuer`, headers: chef.headers,
    payload: { decision: 'a_revoir', texte: 'Il manque le kilométrage et les incidents.' },
  });
  assert.equal(revoir.statusCode, 200, revoir.body);
  assert.equal(revoir.json().rapport.statut, 'a_revoir');

  // Un rapport à revoir reste sur le poste du membre tant qu'il n'est pas accepté.
  const mp = (await app.inject({ method: 'GET', url: '/admin/mon-poste', headers: membre.headers })).json();
  assert.equal(mp.rapports.length, 1);
  assert.equal(mp.rapports[0].statut, 'a_revoir');
  assert.equal(mp.rapports[0].retour.texte, 'Il manque le kilométrage et les incidents.');

  await app.inject({ method: 'POST', url: `/admin/rapports/${id}/rendre`, headers: membre.headers, payload: { texte: '142 km, aucun incident, pneu avant droit à surveiller.' } });
  const accepte = await app.inject({ method: 'POST', url: `/admin/rapports/${id}/statuer`, headers: chef.headers, payload: { decision: 'accepte' } });
  assert.equal(accepte.json().rapport.statut, 'accepte');

  // Accepté : il disparaît de ce qui reste à faire.
  const apres = (await app.inject({ method: 'GET', url: '/admin/mon-poste', headers: membre.headers })).json();
  assert.equal(apres.rapports.length, 0);
});

test('un chef n’ouvre pas l’équipe d’un autre, ni n’écrit hors de la sienne', async (t) => {
  const { app, container } = await buildApp();
  t.after(() => app.close());

  const chefA = await compte(app, { name: 'Chef A', role: 'manager' });
  const chefB = await compte(app, { name: 'Chef B', role: 'manager' });
  container.teams.upsert({ id: 'eq-a', name: 'Équipe A', managerUsername: chefA.username });
  container.teams.upsert({ id: 'eq-b', name: 'Équipe B', managerUsername: chefB.username });
  const membreB = await compte(app, { name: 'Membre B', role: 'agent', teamId: 'eq-b' });

  assert.equal((await app.inject({ method: 'GET', url: '/admin/teams/eq-b/poste', headers: chefA.headers })).statusCode, 403);

  const hors = await app.inject({
    method: 'POST', url: '/admin/teams/eq-a/messages', headers: chefA.headers,
    payload: { a: membreB.username, texte: 'Bonjour.' },
  });
  assert.equal(hors.statusCode, 403, 'on écrit aux gens de son équipe, pas à toute l’entreprise');
});

test('une trésorière retrouve sa caisse ouverte sur son propre poste', async (t) => {
  const { app } = await buildApp();
  t.after(() => app.close());

  const t1 = await compte(app, { name: 'Rose Aké', role: 'tresorier', service: 'Finances' });
  const caisse = (await app.inject({ method: 'POST', url: '/admin/caisses', headers: t1.headers, payload: { fondDeCaisse: 50_000, emplacement: 'Siège — Plateau' } })).json().caisse;
  await app.inject({ method: 'POST', url: `/admin/caisses/${caisse.id}/encaisser`, headers: t1.headers, payload: { montant: 30_000, origine: 'commission_chauffeur', tiers: 'Konan Yao' } });

  const mp = (await app.inject({ method: 'GET', url: '/admin/mon-poste', headers: t1.headers })).json();
  assert.ok(mp.caisse, 'sa caisse doit être sur son poste, pas à trois clics');
  assert.equal(mp.caisse.emplacement, 'Siège — Plateau');
  assert.equal(mp.caisse.soldeTheorique, 80_000);
  assert.equal(mp.caisse.nbMouvements, 1);
});

test('un chauffeur a un poste de travail, et il n’y voit que lui', async (t) => {
  const { app, container } = await buildApp();
  t.after(() => app.close());

  const d = container.drivers.upsert({
    id: 'drv-poste', name: 'Awa Diomandé', matricule: 'AB-220-CI', category: 'argent',
    kycStatus: 'active', availability: 'online', ratingAvg: 4.7, ratingCount: 20, phone: '+2250709182736',
  });
  const chauffeur = await compte(app, { name: d.name, role: 'chauffeur', driverId: d.id, matricule: d.matricule });

  await app.inject({
    method: 'POST', url: `/admin/crew/${d.id}/requetes`, headers: chauffeur.headers,
    payload: { type: 'materiel', montant: 25_000, motif: 'Chargeur de téléphone hors service.' },
  });

  // Un compte qui n'ouvre sur rien n'est pas un compte : son poste doit répondre.
  const mp = await app.inject({ method: 'GET', url: '/admin/mon-poste', headers: chauffeur.headers });
  assert.equal(mp.statusCode, 200, mp.body);
  const p = mp.json();
  assert.ok(p.monDossier, 'le chauffeur doit voir son propre dossier');
  assert.equal(p.monDossier.matricule, 'AB-220-CI');
  assert.equal(p.monDossier.requetes.length, 1);
  assert.equal(p.monDossier.requetes[0].type, 'Matériel');

  // Et rien de l'entreprise : ni équipes, ni flotte, ni caisse.
  assert.deepEqual(p.equipes, []);
  assert.deepEqual(p.flotte, []);
  assert.equal(p.caisse, null);
});
