import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scryptSync } from 'node:crypto';

/**
 * TABLEAU DE BORD : accès réservé.
 *  - De droit : PDG, DG, DAA, directeur des opérations, directeur financier, DAF,
 *    trésorier(ère), service informatique, comptable.
 *  - Managers : seulement sur habilitation individuelle, demandée par le manager (ou
 *    inscrite par le service informatique), transmise par l'informatique, accordée par la
 *    direction. Jamais accordée par celui qui l'a transmise ; révocable ; avec une fin.
 * La config capture process.env au chargement : comptes définis AVANT les imports.
 */
const SALT = '0a1b2c3d4e5f6071';
const HASH = scryptSync('Tableau#2026', SALT, 32).toString('hex');
const COMPTES = [
  ['dg', 'Directeur Général', 'dg'], ['ceo', 'PDG', 'ceo'], ['daa', 'Dir. Affaires Administratives', 'daa'],
  ['coo', 'Directrice des Opérations', 'coo'], ['cfo', 'Directeur Financier', 'cfo'], ['daf', 'DAF', 'daf'],
  ['tresoriere', 'Rose Aké', 'tresorier'], ['dsi', 'Ibrahim Traoré', 'informatique'], ['compta', 'Comptable Koné', 'comptable'],
  ['mgr', 'Manager Yao', 'manager'], ['flotte', 'Gestionnaire Flotte', 'fleet_manager'],
  ['ops', 'Agent Dispatch', 'ops'], ['support', 'Agent Support', 'support'], ['agent', 'Agent Terrain', 'agent'],
  ['viewer', 'Observateur', 'viewer'], ['finance', 'Équipe Finance', 'finance'], ['analyste', 'Analyste', 'financial_analyst'],
] as const;
process.env.ADMIN_USERS = JSON.stringify(COMPTES.map(([username, name, role]) => ({ username, name, role, salt: SALT, hash: HASH })));

const { buildApp } = await import('../src/app.js');
type App = Awaited<ReturnType<typeof buildApp>>['app'];
async function login(app: App, username: string) {
  const res = await app.inject({ method: 'POST', url: '/admin/login', payload: { username, password: 'Tableau#2026' } });
  assert.equal(res.statusCode, 200, `connexion ${username} : ${res.body}`);
  return { authorization: `Bearer ${res.json().token}` };
}

test('tableau de bord : de droit pour la direction, la trésorerie, la comptabilité et l’informatique, refusé aux autres', async (t) => {
  const { app, container } = await buildApp();
  t.after(() => app.close());

  for (const u of ['dg', 'ceo', 'daa', 'coo', 'cfo', 'daf', 'tresoriere', 'dsi', 'compta']) {
    const h = await login(app, u);
    for (const url of ['/admin/dashboard', '/admin/dashboard/analyse', '/admin/objectifs']) {
      const r = await app.inject({ method: 'GET', url, headers: h });
      assert.equal(r.statusCode, 200, `${u} doit ouvrir ${url}`);
    }
    const me = (await app.inject({ method: 'GET', url: '/admin/me', headers: h })).json();
    assert.ok(me.permissions.includes('dashboard:read'), `${u} : dashboard:read`);
  }

  for (const u of ['mgr', 'flotte', 'ops', 'support', 'agent', 'viewer', 'finance', 'analyste']) {
    const h = await login(app, u);
    for (const url of ['/admin/dashboard', '/admin/dashboard/analyse', '/admin/objectifs']) {
      const r = await app.inject({ method: 'GET', url, headers: h });
      assert.equal(r.statusCode, 403, `${u} ne doit pas ouvrir ${url}`);
    }
    const me = (await app.inject({ method: 'GET', url: '/admin/me', headers: h })).json();
    assert.equal(me.permissions.includes('dashboard:read'), false, `${u} : pas de dashboard:read`);
  }
  // Chaque tentative est journalisée et signalée à la direction.
  assert.ok(container.audit.list(200).some((e) => e.action === 'access.denied' && e.actor === 'Manager Yao'));
  assert.ok(container.security.list().some((a) => a.name === 'Agent Dispatch' && a.permission === 'dashboard:read'));
});

test('habilitation d’un manager : demande, transmission par l’informatique, décision de la direction, révocation', async (t) => {
  const { app, container } = await buildApp();
  t.after(() => app.close());
  const mgr = await login(app, 'mgr');
  const dsi = await login(app, 'dsi');
  const dg = await login(app, 'dg');
  const agent = await login(app, 'agent');

  // Le manager voit qu'il peut demander l'accès.
  let moi = (await app.inject({ method: 'GET', url: '/admin/habilitations/moi', headers: mgr })).json();
  assert.deepEqual([moi.acces, moi.habilitable, moi.habilitation], [false, true, null]);
  // Un agent ne peut pas : seuls les managers sont habilitables.
  assert.equal((await app.inject({ method: 'POST', url: '/admin/habilitations/demande', headers: agent, payload: { motif: 'Je voudrais voir les chiffres' } })).statusCode, 400);
  // Une demande doit être motivée.
  assert.equal((await app.inject({ method: 'POST', url: '/admin/habilitations/demande', headers: mgr, payload: { motif: 'svp' } })).statusCode, 400);

  const demande = await app.inject({ method: 'POST', url: '/admin/habilitations/demande', headers: mgr, payload: { motif: 'Suivre les commandes de mon équipe aux heures de pointe' } });
  assert.equal(demande.statusCode, 200, demande.body);
  const id = demande.json().habilitation.id as string;
  assert.equal(demande.json().habilitation.statut, 'demandee');
  assert.equal((await app.inject({ method: 'POST', url: '/admin/habilitations/demande', headers: mgr, payload: { motif: 'Une deuxième demande identique' } })).statusCode, 409);

  // La direction ne peut pas statuer avant la transmission par l'informatique.
  assert.equal((await app.inject({ method: 'POST', url: `/admin/habilitations/${id}/decision`, headers: dg, payload: { accorder: true } })).statusCode, 409);
  // Le manager ne transmet pas lui-même, et la direction ne transmet pas à la place de l'informatique.
  assert.equal((await app.inject({ method: 'POST', url: `/admin/habilitations/${id}/transmettre`, headers: mgr, payload: {} })).statusCode, 403);
  assert.equal((await app.inject({ method: 'POST', url: `/admin/habilitations/${id}/transmettre`, headers: dg, payload: {} })).statusCode, 403);

  const fin = new Date(Date.now() + 30 * 86_400_000).toISOString();
  const transmise = await app.inject({ method: 'POST', url: `/admin/habilitations/${id}/transmettre`, headers: dsi, payload: { expireLe: fin } });
  assert.equal(transmise.statusCode, 200, transmise.body);
  assert.equal(transmise.json().habilitation.statut, 'transmise');
  // L'informatique ne peut pas accorder : c'est la direction qui décide.
  assert.equal((await app.inject({ method: 'POST', url: `/admin/habilitations/${id}/decision`, headers: dsi, payload: { accorder: true } })).statusCode, 403);
  // Toujours pas d'accès tant que la direction n'a pas accordé.
  assert.equal((await app.inject({ method: 'GET', url: '/admin/dashboard', headers: mgr })).statusCode, 403);

  const accordee = await app.inject({ method: 'POST', url: `/admin/habilitations/${id}/decision`, headers: dg, payload: { accorder: true } });
  assert.equal(accordee.statusCode, 200, accordee.body);
  assert.equal(accordee.json().habilitation.statut, 'accordee');
  assert.equal(accordee.json().habilitation.decisionPar, 'Directeur Général (Directeur Général)');

  // Le manager habilité ouvre le tableau de bord, et seulement lui.
  assert.equal((await app.inject({ method: 'GET', url: '/admin/dashboard', headers: mgr })).statusCode, 200);
  assert.equal((await app.inject({ method: 'GET', url: '/admin/dashboard/analyse', headers: mgr })).statusCode, 200);
  moi = (await app.inject({ method: 'GET', url: '/admin/habilitations/moi', headers: mgr })).json();
  assert.equal(moi.acces, true);
  const me = (await app.inject({ method: 'GET', url: '/admin/me', headers: mgr })).json();
  assert.ok(me.permissions.includes('dashboard:read'));
  // Il ne peut pas pour autant changer les objectifs.
  assert.equal((await app.inject({ method: 'PUT', url: '/admin/objectifs', headers: mgr, payload: { jour: 1 } })).statusCode, 403);
  // L'autre manager, lui, n'a rien.
  assert.equal((await app.inject({ method: 'GET', url: '/admin/dashboard', headers: await login(app, 'flotte') })).statusCode, 403);

  // Chaque étape est journalisée, et chacun est prévenu par la messagerie interne.
  const actions = container.audit.list(200).map((e) => e.action);
  for (const a of ['habilitation.demande', 'habilitation.transmise', 'habilitation.accordee']) assert.ok(actions.includes(a), a);
  assert.ok(container.staffComms.recus('dsi').some((m) => m.sujet === 'Demande d’accès au tableau de bord'));
  assert.ok(container.staffComms.recus('dg').some((m) => m.sujet === 'Habilitation au tableau de bord à décider'));
  assert.ok(container.staffComms.recus('mgr').some((m) => m.sujet === 'Accès au tableau de bord accordé'));

  // Révocation motivée : l'accès tombe aussitôt.
  assert.equal((await app.inject({ method: 'POST', url: `/admin/habilitations/${id}/revoquer`, headers: dsi, payload: { raison: '' } })).statusCode, 400);
  const revoquee = await app.inject({ method: 'POST', url: `/admin/habilitations/${id}/revoquer`, headers: dsi, payload: { raison: 'Changement de poste' } });
  assert.equal(revoquee.statusCode, 200, revoquee.body);
  assert.equal((await app.inject({ method: 'GET', url: '/admin/dashboard', headers: mgr })).statusCode, 403);
  assert.ok(container.staffComms.recus('mgr').some((m) => m.sujet === 'Accès au tableau de bord retiré'));

  // Liste des habilitations : informatique et direction, pas les autres.
  assert.equal((await app.inject({ method: 'GET', url: '/admin/habilitations', headers: dsi })).statusCode, 200);
  const liste = (await app.inject({ method: 'GET', url: '/admin/habilitations', headers: dg })).json();
  assert.equal(liste.habilitations[0].statut, 'revoquee');
  assert.ok(liste.managers.some((m: { username: string }) => m.username === 'mgr'));
  assert.ok(liste.deDroit.includes('Comptable') && liste.deDroit.includes('Service informatique'));
  assert.equal((await app.inject({ method: 'GET', url: '/admin/habilitations', headers: mgr })).statusCode, 403);
});

test('habilitation : inscription par l’informatique, refus motivé, séparation des tâches, date de fin', async (t) => {
  const { app } = await buildApp();
  t.after(() => app.close());
  const dsi = await login(app, 'dsi');
  const daf = await login(app, 'daf');
  const flotte = await login(app, 'flotte');
  const superAdmin = { 'x-admin-token': 'orion-admin-dev' };

  // Seul un manager peut être inscrit.
  assert.equal((await app.inject({ method: 'POST', url: '/admin/habilitations', headers: dsi, payload: { username: 'agent', motif: 'Accès demandé par son chef' } })).statusCode, 400);
  // Une date de fin passée est refusée.
  assert.equal((await app.inject({ method: 'POST', url: '/admin/habilitations', headers: dsi, payload: { username: 'flotte', motif: 'Pilotage de la flotte', expireLe: '2020-01-01' } })).statusCode, 400);

  const inscrite = await app.inject({ method: 'POST', url: '/admin/habilitations', headers: dsi, payload: { username: 'flotte', motif: 'Pilotage de la flotte en heures de pointe' } });
  assert.equal(inscrite.statusCode, 200, inscrite.body);
  const id = inscrite.json().habilitation.id as string;
  assert.equal(inscrite.json().habilitation.statut, 'transmise', 'part directement à la direction');

  // Un refus doit être motivé ; il ferme la demande.
  assert.equal((await app.inject({ method: 'POST', url: `/admin/habilitations/${id}/decision`, headers: daf, payload: { accorder: false } })).statusCode, 400);
  const refus = await app.inject({ method: 'POST', url: `/admin/habilitations/${id}/decision`, headers: daf, payload: { accorder: false, raison: 'Les rapports hebdomadaires suffisent' } });
  assert.equal(refus.statusCode, 200, refus.body);
  assert.equal(refus.json().habilitation.statut, 'refusee');
  assert.equal((await app.inject({ method: 'GET', url: '/admin/dashboard', headers: flotte })).statusCode, 403);
  const moi = (await app.inject({ method: 'GET', url: '/admin/habilitations/moi', headers: flotte })).json();
  assert.equal(moi.habilitation.raison, 'Les rapports hebdomadaires suffisent');

  // Le super administrateur technique qui transmet ne peut pas accorder lui-même.
  const parAdmin = await app.inject({ method: 'POST', url: '/admin/habilitations', headers: superAdmin, payload: { username: 'flotte', motif: 'Nouvelle demande, périmètre réduit', expireLe: new Date(Date.now() + 86_400_000).toISOString() } });
  assert.equal(parAdmin.statusCode, 200, parAdmin.body);
  const id2 = parAdmin.json().habilitation.id as string;
  const auto = await app.inject({ method: 'POST', url: `/admin/habilitations/${id2}/decision`, headers: superAdmin, payload: { accorder: true } });
  assert.equal(auto.statusCode, 403, 'séparation des tâches');
  assert.equal((await app.inject({ method: 'POST', url: `/admin/habilitations/${id2}/decision`, headers: daf, payload: { accorder: true } })).statusCode, 200);
  assert.equal((await app.inject({ method: 'GET', url: '/admin/dashboard', headers: flotte })).statusCode, 200);
});

test('habilitation échue : l’accès tombe à la date de fin', async (t) => {
  const { app, container } = await buildApp();
  t.after(() => app.close());
  const mgr = await login(app, 'mgr');
  const dsi = await login(app, 'dsi');
  const coo = await login(app, 'coo');
  const id = (await app.inject({ method: 'POST', url: '/admin/habilitations', headers: dsi, payload: { username: 'mgr', motif: 'Intérim de la direction des opérations', expireLe: new Date(Date.now() + 60_000).toISOString() } })).json().habilitation.id as string;
  assert.equal((await app.inject({ method: 'POST', url: `/admin/habilitations/${id}/decision`, headers: coo, payload: { accorder: true } })).statusCode, 200);
  assert.equal((await app.inject({ method: 'GET', url: '/admin/dashboard', headers: mgr })).statusCode, 200);
  // On avance l'horloge de l'habilitation : la date de fin est passée.
  container.habilitations.get(id)!.expireLe = new Date(Date.now() - 1000).toISOString();
  assert.equal((await app.inject({ method: 'GET', url: '/admin/dashboard', headers: mgr })).statusCode, 403);
  const liste = (await app.inject({ method: 'GET', url: '/admin/habilitations', headers: dsi })).json();
  assert.equal(liste.habilitations[0].expiree, true);
  // Échue, elle ne bloque pas une nouvelle demande.
  const encore = await app.inject({ method: 'POST', url: '/admin/habilitations/demande', headers: mgr, payload: { motif: 'Prolongation de l’intérim d’un mois' } });
  assert.equal(encore.statusCode, 200, encore.body);
});
