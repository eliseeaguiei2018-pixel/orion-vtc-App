import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildApp } from '../src/app.js';
import { lirePeriode } from '../src/modules/assistant/service.js';

/**
 * ASSISTANT ORION.
 *
 * La console annonçait un « copilote génératif » pour trois expressions régulières :
 * trois questions comprises, tout le reste renvoyé à un « reformulez ». Une promesse
 * non tenue affichée à des employés est pire qu'une absence de fonctionnalité — on
 * cesse d'essayer, puis on cesse d'y croire.
 *
 * Ces tests vérifient le contrat réel : douze sujets couverts sur les données réelles,
 * des chiffres justes, la bonne session visée, et un aveu explicite quand la question
 * n'est pas comprise.
 */
const A = { 'x-admin-token': 'orion-admin-dev' };

const demander = async (app: Awaited<ReturnType<typeof buildApp>>['app'], q: string) => {
  const r = await app.inject({ method: 'POST', url: '/admin/copilot', headers: A, payload: { q } });
  assert.equal(r.statusCode, 200, `${q} → ${r.statusCode}`);
  return r.json();
};

test('chaque sujet annoncé répond vraiment à son propre exemple', async (t) => {
  const { app } = await buildApp();
  t.after(() => app.close());

  const liste = await app.inject({ method: 'GET', url: '/admin/copilot/sujets', headers: A });
  assert.equal(liste.statusCode, 200);
  const sujets: Array<{ id: string; exemple: string }> = liste.json().sujets;
  assert.ok(sujets.length >= 12, `${sujets.length} sujets annoncés`);

  // Le piège classique : afficher des exemples qui ne marchent pas. On les joue tous.
  for (const s of sujets) {
    const b = await demander(app, s.exemple);
    assert.equal(b.incompris, false, `l'exemple « ${s.exemple} » du sujet ${s.id} n'est pas compris`);
    assert.ok(b.answer.length > 20, `réponse trop courte pour ${s.id} : ${b.answer}`);
    assert.ok(Array.isArray(b.sources) && b.sources.length > 0, `aucune session indiquée pour ${s.id}`);
  }
});

test('une question hors sujet est avouée, et l’assistant dit ce qu’il sait faire', async (t) => {
  const { app } = await buildApp();
  t.after(() => app.close());

  const b = await demander(app, 'quelle est la capitale du Japon');
  assert.equal(b.incompris, true);
  assert.ok(Array.isArray(b.data) && b.data.length >= 12, 'la liste des sujets doit être renvoyée');
  assert.ok(!/reformulez/i.test(b.answer), 'ne plus se contenter d’un « reformulez »');
});

test('« chiffre d’affaires des locations » part vers la location, pas vers la finance', async (t) => {
  const { app } = await buildApp();
  t.after(() => app.close());

  // Première version : le premier `if` qui matchait l'emportait, et « chiffre
  // d'affaires » renvoyait systématiquement la finance globale.
  const loc = await demander(app, 'quel chiffre d’affaires pour les locations ce mois-ci');
  assert.ok(loc.sources.includes('rental'), `sources=${loc.sources}`);

  const fin = await demander(app, 'quel chiffre d’affaires global sur 7 jours');
  assert.ok(fin.sources.includes('direction'), `sources=${fin.sources}`);

  const abo = await demander(app, 'combien rapportent les abonnements');
  assert.ok(abo.sources.includes('subscriptions'), `sources=${abo.sources}`);
});

test('les chiffres viennent des données réelles, pas d’un texte figé', async (t) => {
  const { app, container } = await buildApp();
  t.after(() => app.close());

  const avant = await demander(app, 'combien de chauffeurs sont en ligne');
  assert.match(avant.answer, /0 chauffeur\(s\) enregistré/);

  const d = container.drivers.upsert({
    id: 'asst-1', name: 'Konan Yao', matricule: 'AB-001-CI', category: 'or',
    kycStatus: 'active', availability: 'offline', ratingAvg: 4.9, ratingCount: 10,
  });
  await container.drivers.goOnline(d.id, { lat: 5.33, lng: -4.02 });

  const apres = await demander(app, 'combien de chauffeurs sont en ligne');
  assert.match(apres.answer, /1 chauffeur\(s\) enregistré/);
  assert.match(apres.answer, /1 en ligne/);
  assert.equal((apres.data as { enLigne: number }).enLigne, 1);
});

test('la période demandée est comprise et rappelée dans la réponse', async (t) => {
  assert.equal(lirePeriode('ca d’aujourd’hui').jours, 1);
  assert.equal(lirePeriode('ca d’hier').jours, 1);
  assert.equal(lirePeriode('ca de la semaine').jours, 7);
  assert.equal(lirePeriode('ca du trimestre').jours, 90);
  assert.equal(lirePeriode('ca de l’année').jours, 365);
  assert.equal(lirePeriode('ca').jours, 30, 'défaut : 30 jours');

  const { app } = await buildApp();
  t.after(() => app.close());
  const b = await demander(app, 'quel chiffre d’affaires sur les 7 derniers jours');
  assert.match(b.answer, /sur les 7 derniers jours/, 'la période doit être rappelée à l’écran');
});

test('l’assistant signale ce qui ne va pas et renvoie vers la session qui le traite', async (t) => {
  const { app, container } = await buildApp();
  t.after(() => app.close());

  const sain = await demander(app, 'est-ce que la plateforme va bien');
  assert.match(sain.answer, /Sain|sain/);

  // Un chauffeur en service avec une assurance expirée : constat critique connu.
  const d = container.drivers.upsert({
    id: 'asst-2', name: 'Awa Diomandé', matricule: 'AB-002-CI', category: 'argent',
    kycStatus: 'active', availability: 'offline', ratingAvg: 4.8, ratingCount: 10,
    insuranceExpiry: '2020-01-01',
  });
  await container.drivers.goOnline(d.id, { lat: 5.34, lng: -4.01 });

  const b = await demander(app, 'qu’est-ce qui ne va pas sur la plateforme');
  assert.ok(b.data.parSeverite.critique >= 1, 'le constat critique doit remonter');
  assert.ok(b.sources.includes('vigilance'));

  const urgent = await demander(app, 'qu’est-ce qui est urgent aujourd’hui');
  assert.match(urgent.answer, /assurance/i, `réponse : ${urgent.answer}`);
});

test('un agent sans droit « vue d’ensemble » ne peut pas interroger l’assistant', async (t) => {
  const { app } = await buildApp();
  t.after(() => app.close());

  const r = await app.inject({ method: 'POST', url: '/admin/copilot', payload: { q: 'ca du mois' } });
  assert.equal(r.statusCode, 401, 'sans jeton : refus');
});
