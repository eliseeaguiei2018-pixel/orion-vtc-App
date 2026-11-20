import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildApp } from '../src/app.js';

/**
 * SESSION ÉQUIPAGES.
 *
 * Le dossier des chauffeurs était éparpillé sur six sessions, et leurs demandes se
 * réglaient par téléphone « avec quelqu'un qui connaît quelqu'un » : aucune trace,
 * aucune équité, et une demande oubliée n'existait tout simplement plus.
 *
 * Ces tests vérifient le contrat : un matricule suffit à tout retrouver, la chaîne
 * de décision est tracée de bout en bout, et un chauffeur ne voit jamais le dossier
 * d'un collègue.
 */
const A = { 'x-admin-token': 'orion-admin-dev' };
type App = Awaited<ReturnType<typeof buildApp>>['app'];

async function chauffeur(app: App, container: Awaited<ReturnType<typeof buildApp>>['container'], nom: string, matricule: string) {
  return container.drivers.upsert({
    id: `drv-${matricule.toLowerCase()}`, name: nom, matricule, category: 'or',
    kycStatus: 'active', availability: 'online', ratingAvg: 4.8, ratingCount: 30,
    phone: '+2250701020304',
  });
}

const deposer = (app: App, driverId: string, payload: Record<string, unknown>, headers: Record<string, string> = A) =>
  app.inject({ method: 'POST', url: `/admin/crew/${driverId}/requetes`, headers, payload });

test('un matricule suffit à retrouver un chauffeur et tout son dossier', async (t) => {
  const { app, container } = await buildApp();
  t.after(() => app.close());

  const d = await chauffeur(app, container, 'Konan Yao', 'AB-114-CI');
  container.teams.upsert({ id: 'flotte-nord', name: 'Flotte Nord', managerUsername: 'chef.nord', managerName: 'Serge Kouadio', mission: 'Cocody et Riviera', driverIds: [d.id] });

  const r = await app.inject({ method: 'GET', url: '/admin/crew?q=ab-114', headers: A });
  assert.equal(r.statusCode, 200, r.body);
  const lignes = r.json().equipages;
  assert.equal(lignes.length, 1);
  assert.equal(lignes[0].name, 'Konan Yao');
  assert.equal(lignes[0].teamName, 'Flotte Nord');

  const dossier = (await app.inject({ method: 'GET', url: `/admin/crew/${d.id}`, headers: A })).json().dossier;
  assert.equal(dossier.identite.matricule, 'AB-114-CI');
  assert.equal(dossier.equipe.mission, 'Cocody et Riviera');
  // Un chauffeur ajouté à une équipe reçoit automatiquement son identifiant console
  // (son chef peut lui écrire) ; il en choisit le mot de passe depuis son app.
  assert.equal(dossier.acces.username, 'konan.yao', 'identifiant créé automatiquement');
  assert.equal(dossier.acces.mustChangePassword, true);
});

test('la chaîne d’un prêt va du dépôt au remboursement, tracée à chaque étape', async (t) => {
  const { app, container } = await buildApp();
  t.after(() => app.close());

  const d = await chauffeur(app, container, 'Awa Diomandé', 'AB-220-CI');

  const depot = await deposer(app, d.id, { type: 'pret', montant: 300_000, echeances: 3, motif: 'Réparation de la toiture avant les pluies.' });
  assert.equal(depot.statusCode, 200, depot.body);
  const id = depot.json().requete.id;
  assert.equal(depot.json().requete.statut, 'deposee');

  // On ne verse pas ce qui n'a pas été accordé.
  const tropTot = await app.inject({ method: 'POST', url: `/admin/crew/requetes/${id}/verser`, headers: A, payload: { canal: 'orange_money' } });
  assert.equal(tropTot.statusCode, 409);

  const avis = await app.inject({
    method: 'POST', url: `/admin/crew/requetes/${id}/instruire`, headers: A,
    payload: { avis: 'favorable', note: 'Chauffeur régulier depuis deux ans, aucune dette.' },
  });
  assert.equal(avis.statusCode, 200, avis.body);
  assert.equal(avis.json().requete.statut, 'instruite');

  // La finance peut accorder MOINS que demandé : refuser en bloc 300 000 F quand on
  // peut en donner 200 000 est une réponse administrative, pas une décision.
  const accord = await app.inject({
    method: 'POST', url: `/admin/crew/requetes/${id}/decider`, headers: A,
    payload: { decision: 'accord', montantAccorde: 200_000, note: 'Accordé à hauteur de 200 000 F.' },
  });
  assert.equal(accord.statusCode, 200, accord.body);
  const accordee = accord.json().requete;
  assert.equal(accordee.statut, 'accordee');
  assert.equal(accordee.montantAccorde, 200_000);
  assert.equal(accordee.plan.length, 3);
  assert.equal(accordee.plan.reduce((n: number, e: { montant: number }) => n + e.montant, 0), 200_000, 'l’échéancier doit couvrir exactement le montant');

  const verse = await app.inject({ method: 'POST', url: `/admin/crew/requetes/${id}/verser`, headers: A, payload: { canal: 'wave' } });
  assert.equal(verse.statusCode, 200);
  assert.equal(verse.json().requete.statut, 'versee');

  // Le reste dû apparaît dans le dossier — pas dans la tête du comptable.
  let dossier = (await app.inject({ method: 'GET', url: `/admin/crew/${d.id}`, headers: A })).json().dossier;
  assert.equal(dossier.argent.resteDu, 200_000);

  // Deux échéances remboursées, puis la troisième solde le prêt.
  await app.inject({ method: 'POST', url: `/admin/crew/requetes/${id}/rembourser`, headers: A, payload: { montant: 133_334 } });
  dossier = (await app.inject({ method: 'GET', url: `/admin/crew/${d.id}`, headers: A })).json().dossier;
  assert.ok(dossier.argent.resteDu > 0 && dossier.argent.resteDu < 200_000, `reste ${dossier.argent.resteDu}`);

  const solde = await app.inject({ method: 'POST', url: `/admin/crew/requetes/${id}/rembourser`, headers: A, payload: { montant: 200_000 } });
  assert.equal(solde.json().requete.statut, 'cloturee');
  dossier = (await app.inject({ method: 'GET', url: `/admin/crew/${d.id}`, headers: A })).json().dossier;
  assert.equal(dossier.argent.resteDu, 0);
});

test('on ne prête pas à quelqu’un pour qu’il rembourse le prêt précédent', async (t) => {
  const { app, container } = await buildApp();
  t.after(() => app.close());

  const d = await chauffeur(app, container, 'Mamadou Bamba', 'AB-330-CI');
  const un = await deposer(app, d.id, { type: 'pret', montant: 100_000, motif: 'Frais de scolarité.' });
  const id = un.json().requete.id;
  await app.inject({ method: 'POST', url: `/admin/crew/requetes/${id}/decider`, headers: A, payload: { decision: 'accord' } });

  const deux = await deposer(app, d.id, { type: 'pret', montant: 50_000, motif: 'Autre chose.' });
  assert.equal(deux.statusCode, 409);
  assert.match(deux.json().error, /prêt est déjà en cours/);
});

test('les plafonds d’avance et de prêt sont tenus par le serveur', async (t) => {
  const { app, container } = await buildApp();
  t.after(() => app.close());

  const d = await chauffeur(app, container, 'Fatou Koné', 'AB-440-CI');
  const trop = await deposer(app, d.id, { type: 'avance', montant: 500_000, motif: 'Besoin urgent.' });
  assert.equal(trop.statusCode, 400);
  assert.match(trop.json().error, /plafond/);

  const sansMontant = await deposer(app, d.id, { type: 'reparation', motif: 'Pneu arrière à changer.' });
  assert.equal(sansMontant.statusCode, 400);
  assert.match(sansMontant.json().error, /montant/);
});

test('un congé accordé se clôt seul : il n’y a rien à verser', async (t) => {
  const { app, container } = await buildApp();
  t.after(() => app.close());

  const d = await chauffeur(app, container, 'Grace Kouamé', 'AB-550-CI');
  const r = await deposer(app, d.id, { type: 'conge', du: '2026-12-20', au: '2026-12-27', motif: 'Fêtes de fin d’année au village.' });
  const id = r.json().requete.id;
  const accord = await app.inject({ method: 'POST', url: `/admin/crew/requetes/${id}/decider`, headers: A, payload: { decision: 'accord' } });
  assert.equal(accord.json().requete.statut, 'cloturee');
});

test('un chauffeur connecté ne voit que son dossier, et ne dépose que pour lui', async (t) => {
  const { app, container } = await buildApp();
  t.after(() => app.close());

  const moi = await chauffeur(app, container, 'Ismaël Cissé', 'AB-660-CI');
  const autre = await chauffeur(app, container, 'Serge Gbagbo', 'AB-770-CI');

  const creation = await app.inject({
    method: 'POST', url: '/admin/accounts', headers: A,
    payload: { name: moi.name, role: 'chauffeur', driverId: moi.id, matricule: moi.matricule },
  });
  assert.equal(creation.statusCode, 200, creation.body);
  const { account, motDePasseProvisoire } = creation.json();
  const login = await app.inject({ method: 'POST', url: '/admin/login', payload: { username: account.username, password: motDePasseProvisoire } });
  const h = { authorization: `Bearer ${login.json().token}` };

  // Sa liste ne contient que lui : jamais l'annuaire de ses collègues.
  const liste = await app.inject({ method: 'GET', url: '/admin/crew', headers: h });
  assert.equal(liste.statusCode, 200, liste.body);
  assert.equal(liste.json().equipages.length, 1);
  assert.equal(liste.json().equipages[0].driverId, moi.id);

  // Son dossier : autorisé. Celui du collègue : refusé.
  assert.equal((await app.inject({ method: 'GET', url: `/admin/crew/${moi.id}`, headers: h })).statusCode, 200);
  const espion = await app.inject({ method: 'GET', url: `/admin/crew/${autre.id}`, headers: h });
  assert.equal(espion.statusCode, 403);

  // Il dépose sa requête…
  const sienne = await deposer(app, moi.id, { type: 'materiel', montant: 25_000, motif: 'Chargeur de téléphone hors service.' }, h);
  assert.equal(sienne.statusCode, 200, sienne.body);

  // …mais pas au nom d'un autre.
  const usurpation = await deposer(app, autre.id, { type: 'avance', montant: 50_000, motif: 'Pour un ami.' }, h);
  assert.equal(usurpation.statusCode, 403);

  // Et il ne statue pas lui-même sur sa demande.
  const id = sienne.json().requete.id;
  const autoDecision = await app.inject({ method: 'POST', url: `/admin/crew/requetes/${id}/decider`, headers: h, payload: { decision: 'accord' } });
  assert.equal(autoDecision.statusCode, 403);
});

test('un agent ne travaille que sur la flotte que son manager lui a accréditée', async (t) => {
  const { app, container } = await buildApp();
  t.after(() => app.close());

  const mien = await chauffeur(app, container, 'Adama Sanogo', 'AB-880-CI');
  const voisin = await chauffeur(app, container, 'Rokia Camara', 'AB-990-CI');
  container.teams.upsert({ id: 'eq-a', name: 'Équipe A', managerUsername: 'chef.a', driverIds: [mien.id] });
  container.teams.upsert({ id: 'eq-b', name: 'Équipe B', managerUsername: 'chef.b', driverIds: [voisin.id] });

  const c = await app.inject({
    method: 'POST', url: '/admin/accounts', headers: A,
    payload: { name: 'Prisca Akissi', role: 'agent', teamId: 'eq-a' },
  });
  const { account, motDePasseProvisoire } = c.json();
  const login = await app.inject({ method: 'POST', url: '/admin/login', payload: { username: account.username, password: motDePasseProvisoire } });
  const h = { authorization: `Bearer ${login.json().token}` };

  const liste = await app.inject({ method: 'GET', url: '/admin/crew', headers: h });
  assert.deepEqual(liste.json().equipages.map((l: { matricule: string }) => l.matricule), ['AB-880-CI']);

  assert.equal((await app.inject({ method: 'GET', url: `/admin/crew/${mien.id}`, headers: h })).statusCode, 200);
  assert.equal((await app.inject({ method: 'GET', url: `/admin/crew/${voisin.id}`, headers: h })).statusCode, 403);
});

test('le dossier signale ce qui cloche chez ce chauffeur, sans aller voir ailleurs', async (t) => {
  const { app, container } = await buildApp();
  t.after(() => app.close());

  const d = container.drivers.upsert({
    id: 'drv-alerte', name: 'Youssouf Doumbia', matricule: 'AB-111-CI', category: 'argent',
    kycStatus: 'docs_submitted', availability: 'online', ratingAvg: 4.2, ratingCount: 12,
    insuranceExpiry: '2020-01-01', batteryPct: 9,
  });

  const dossier = (await app.inject({ method: 'GET', url: `/admin/crew/${d.id}`, headers: A })).json().dossier;
  const textes = dossier.alertes.map((a: { texte: string }) => a.texte).join(' | ');
  assert.match(textes, /Assurance expirée/);
  assert.match(textes, /KYC/);
  assert.match(textes, /Batterie à 9 %/);
  assert.equal(dossier.alertes.find((a: { severite: string }) => a.severite === 'critique').severite, 'critique');
});
