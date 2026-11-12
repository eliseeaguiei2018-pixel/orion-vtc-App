import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scryptSync } from 'node:crypto';

/**
 * TABLEAU DE BORD : objectifs financiers (jour, semaine, mois, année) et niveau des
 * commandes (par heure, par jour, sur 30 jours, par mois), avec hausse ou baisse.
 * La config capture process.env au chargement : comptes définis AVANT les imports.
 */
const SALT = 'f1e2d3c4b5a69788';
const HASH = scryptSync('Objectif#2026', SALT, 32).toString('hex');
process.env.ADMIN_USERS = JSON.stringify([
  { username: 'daf', name: 'Directrice Financière', role: 'daf', salt: SALT, hash: HASH },
  { username: 'agent', name: 'Agent Terrain', role: 'agent', salt: SALT, hash: HASH },
  { username: 'compta', name: 'Comptable Koné', role: 'comptable', salt: SALT, hash: HASH },
]);

const { buildApp } = await import('../src/app.js');
const { analyser, historiqueDemo } = await import('../src/modules/dashboard/analyse.js');
const { OBJECTIFS_DEFAUT } = await import('../src/modules/dashboard/objectifs.js');

type App = Awaited<ReturnType<typeof buildApp>>['app'];
async function login(app: App, username: string) {
  const res = await app.inject({ method: 'POST', url: '/admin/login', payload: { username, password: 'Objectif#2026' } });
  return { authorization: `Bearer ${res.json().token}` };
}

// Mercredi 11 novembre 2026, 14 h 30 (heure locale du serveur).
const MAINTENANT = new Date(2026, 10, 11, 14, 30);
const a = (j: number, h: number, m = 0) => +new Date(2026, 10, j, h, m);

test('objectif du jour : réalisé, courbe cumulée, comparaison à hier au même moment', () => {
  const objectifs = { jour: 400_000, semaine: 2_800_000, mois: 12_000_000, annee: 150_000_000 };
  const sources = {
    revenus: [
      { t: a(11, 9, 10), v: 100_000 }, { t: a(11, 13, 45), v: 50_000 },
      { t: a(10, 9, 30), v: 80_000 }, { t: a(10, 18, 0), v: 200_000 },
      { t: a(11, 15, 10), v: 999_999 },   // dans le futur : ignoré
    ],
    commandes: [],
  };
  const r = analyser(sources, objectifs, MAINTENANT);
  const j = r.finances.jour;
  assert.equal(j.realise, 150_000);
  assert.equal(j.objectif, 400_000);
  assert.equal(j.precedentTotal, 280_000, 'hier, journée entière');
  assert.equal(j.precedentMemeMoment, 80_000, 'hier à 14 h 30');
  assert.ok(Math.abs(j.variation! - 0.875) < 1e-9, '+87,5 % sur hier au même moment');
  assert.equal(j.reste, 250_000);
  assert.equal(j.courbe.length, 24);
  assert.equal(j.courbe[9]!.courant, 100_000);
  assert.equal(j.courbe[14]!.courant, 150_000, 'heure en cours incluse');
  assert.equal(j.courbe[15]!.courant, null, 'pas de courbe dans le futur');
  assert.equal(j.courbe[23]!.precedent, 280_000);
  assert.equal(j.courbe[23]!.objectif, 400_000, 'le rythme attendu atteint l’objectif en fin de période');
  // La semaine commence le lundi : lundi 9, mardi 10, mercredi 11.
  assert.equal(r.finances.semaine.courbe[0]!.libelle, 'lun');
  assert.equal(r.finances.semaine.realise, 430_000);
  assert.equal(r.finances.mois.courbe.length, 30, 'novembre');
  assert.equal(r.finances.annee.courbe.length, 12);
  assert.equal(r.finances.annee.courbe[11]!.courant, null);
});

test('niveau des commandes : l’heure entamée se compare au même instant d’hier', () => {
  const commandes = [
    // Hier : 6 commandes à 8 h, 4 à 14 h (dont 2 avant 14 h 30).
    ...Array.from({ length: 6 }, (_, i) => ({ t: a(10, 8, i * 5), v: 1 })),
    { t: a(10, 14, 5), v: 1 }, { t: a(10, 14, 20), v: 1 }, { t: a(10, 14, 40), v: 1 }, { t: a(10, 14, 50), v: 1 },
    // Aujourd'hui : 3 à 8 h (baisse), 3 à 14 h avant 14 h 30 (hausse sur le même instant d'hier).
    { t: a(11, 8, 1), v: 1 }, { t: a(11, 8, 2), v: 1 }, { t: a(11, 8, 3), v: 1 },
    { t: a(11, 14, 1), v: 1 }, { t: a(11, 14, 10), v: 1 }, { t: a(11, 14, 25), v: 1 },
  ];
  const r = analyser({ revenus: [], commandes }, OBJECTIFS_DEFAUT, MAINTENANT);
  const h8 = r.commandes.parHeure[8]!;
  assert.deepEqual([h8.courant, h8.precedent, h8.variation], [3, 6, -0.5]);
  const h14 = r.commandes.parHeure[14]!;
  assert.equal(h14.enCours, true);
  assert.equal(h14.precedent, 4, 'hier, heure pleine');
  assert.equal(h14.variation, 0.5, 'comparée aux 2 commandes d’hier avant 14 h 30');
  assert.equal(r.commandes.parHeure[15]!.courant, null);
  assert.equal(r.commandes.parJour[2]!.enCours, true, 'mercredi en cours');
  assert.equal(r.commandes.trenteJours.length, 30);
  assert.equal(r.commandes.trenteJours[29]!.commandes, 6);
  assert.equal(r.commandes.trenteJours[28]!.commandes, 10);
  assert.equal(r.commandes.trenteJours[29]!.enCours, true);
  assert.equal(r.commandes.trenteJours[29]!.semainePrecedente, 0);
  assert.equal(r.commandes.jourCourant, 'mercredi');
  assert.ok(r.aRetenir.some((x) => x.genre === 'baisse' && x.texte.includes('8 h')), JSON.stringify(r.aRetenir));
});

test('historique de démonstration : stable, jamais dans le futur, proche des objectifs', () => {
  const h1 = historiqueDemo(60, MAINTENANT);
  const h2 = historiqueDemo(60, MAINTENANT);
  assert.deepEqual(h1, h2, 'mêmes chiffres d’un appel à l’autre');
  assert.ok(h1.commandes.every((e) => e.t <= +MAINTENANT));
  assert.ok(h1.revenus.every((e) => e.t <= +MAINTENANT));
  const r = analyser(h1, OBJECTIFS_DEFAUT, MAINTENANT, true);
  assert.equal(r.historiqueDemo, true);
  const hier = r.finances.jour.precedentTotal;
  assert.ok(hier > OBJECTIFS_DEFAUT.jour * 0.6 && hier < OBJECTIFS_DEFAUT.jour * 1.6, `CA d’hier plausible : ${hier}`);
  // Le rythme attendu suit le profil d'une journée : à 14 h 30, moins de 60 % du jour.
  assert.ok(r.finances.jour.rythmeAttendu < OBJECTIFS_DEFAUT.jour * 0.6);
  assert.ok(r.finances.jour.projection !== null);
});

test('objectifs : lus par les comptes habilités, fixés par la finance, journalisés', async (t) => {
  const { app, container } = await buildApp();
  t.after(() => app.close());

  assert.equal((await app.inject({ method: 'GET', url: '/admin/dashboard/analyse' })).statusCode, 401);
  assert.equal((await app.inject({ method: 'GET', url: '/admin/objectifs' })).statusCode, 401);

  const daf = await login(app, 'daf');
  const agent = await login(app, 'agent');
  const compta = await login(app, 'compta');

  // Un agent n'a pas accès au tableau de bord : ni courbes ni objectifs, et c'est signalé.
  assert.equal((await app.inject({ method: 'GET', url: '/admin/objectifs', headers: agent })).statusCode, 403);
  assert.equal((await app.inject({ method: 'GET', url: '/admin/dashboard/analyse', headers: agent })).statusCode, 403);
  assert.ok(container.audit.list(50).some((e) => e.action === 'access.denied' && e.actor === 'Agent Terrain'));

  // La comptabilité lit les objectifs, mais ne les fixe pas.
  const lu = (await app.inject({ method: 'GET', url: '/admin/objectifs', headers: compta })).json();
  assert.equal(lu.objectifs.jour, OBJECTIFS_DEFAUT.jour);
  const refus = await app.inject({ method: 'PUT', url: '/admin/objectifs', headers: compta, payload: { jour: 1 } });
  assert.equal(refus.statusCode, 403);

  assert.equal((await app.inject({ method: 'PUT', url: '/admin/objectifs', headers: daf, payload: { jour: -5 } })).statusCode, 400);
  assert.equal((await app.inject({ method: 'PUT', url: '/admin/objectifs', headers: daf, payload: {} })).statusCode, 400);

  const maj = await app.inject({ method: 'PUT', url: '/admin/objectifs', headers: daf, payload: { jour: 500_000, mois: 15_000_000 } });
  assert.equal(maj.statusCode, 200, maj.body);
  assert.equal(maj.json().objectifs.jour, 500_000);
  assert.equal(maj.json().objectifs.semaine, OBJECTIFS_DEFAUT.semaine, 'les autres objectifs ne bougent pas');
  assert.equal(maj.json().objectifs.majPar, 'Directrice Financière');
  const trace = container.audit.list(50).find((e) => e.action === 'objectifs.mise_a_jour');
  assert.ok(trace, 'changement journalisé');
  assert.deepEqual((trace!.details as { avant: { jour: number } }).avant.jour, OBJECTIFS_DEFAUT.jour);

  // Les courbes suivent aussitôt le nouvel objectif ; en test, aucun historique fictif.
  const analyse = (await app.inject({ method: 'GET', url: '/admin/dashboard/analyse', headers: compta })).json();
  assert.equal(analyse.finances.jour.objectif, 500_000);
  assert.equal(analyse.finances.mois.objectif, 15_000_000);
  assert.equal(analyse.historiqueDemo, false);
  assert.equal(analyse.commandes.parHeure.length, 24);
  assert.equal(analyse.finances.jour.realise, 0);
});
