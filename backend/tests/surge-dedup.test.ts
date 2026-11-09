import { test } from 'node:test';
import assert from 'node:assert/strict';

/**
 * Surge : une demande = une INTENTION DE TRAJET, pas un appel HTTP.
 *
 * L'app cliente ré-estime à chaque changement (gamme, assurance, arrêt, code promo).
 * Sans dédoublonnage, une seule personne qui comparait trois gammes atteignait le
 * seuil de surge et faisait monter SON PROPRE prix avant même de commander.
 */
const ORIGIN = { lat: 5.3236, lng: -4.0217 };   // Plateau
const DEST = { lat: 5.3599, lng: -3.9876 };     // Cocody

test('Surge : comparer les gammes ne fait PAS monter son propre prix', async (t) => {
  const { buildApp } = await import('../src/app.js');
  const { app } = await buildApp();
  t.after(() => app.close());

  const devis = async (category: string, clientId?: string) => (await app.inject({
    method: 'POST', url: '/pricing/estimate',
    payload: { origin: ORIGIN, destination: DEST, category, clientId },
  })).json().quote;

  // Une MÊME personne parcourt les quatre gammes, puis revient sur la première.
  const premier = await devis('bronze', 'client-unique');
  await devis('argent', 'client-unique');
  await devis('or', 'client-unique');
  await devis('diamant', 'client-unique');
  const retour = await devis('bronze', 'client-unique');

  assert.equal(retour.breakdown.surge, 1, 'aucun surge déclenché par sa propre navigation');
  assert.equal(retour.amount, premier.amount,
    `le prix de la gamme bronze ne doit pas bouger (${premier.amount} -> ${retour.amount})`);
});

test('Surge : des personnes DIFFÉRENTES comptent bien, chacune pour une demande', async (t) => {
  const { buildApp } = await import('../src/app.js');
  const { app, container } = await buildApp();
  t.after(() => app.close());

  const devis = async (clientId: string) => app.inject({
    method: 'POST', url: '/pricing/estimate',
    payload: { origin: ORIGIN, destination: DEST, category: 'bronze', clientId },
  });

  // Une seule personne, cinq consultations -> une seule demande.
  for (let i = 0; i < 5; i++) await devis('ali');
  assert.equal(container.demand.demandAt(ORIGIN), 1, 'cinq consultations d’une personne = 1 demande');

  // Quatre personnes distinctes -> quatre demandes.
  for (const qui of ['awa', 'kofi', 'mariam', 'yao']) await devis(qui);
  assert.equal(container.demand.demandAt(ORIGIN), 5, 'ali + quatre autres = 5 demandes');
});

test('Surge : une demande anonyme reste comptée (appels serveur, tests)', async (t) => {
  const { buildApp } = await import('../src/app.js');
  const { app, container } = await buildApp();
  t.after(() => app.close());

  for (let i = 0; i < 3; i++) {
    await app.inject({ method: 'POST', url: '/pricing/estimate',
      payload: { origin: ORIGIN, destination: DEST, category: 'bronze' } });
  }
  assert.equal(container.demand.demandAt(ORIGIN), 3, 'sans identifiant, chaque devis compte');
});

/**
 * Démonstration du défaut corrigé. Les appels NON identifiés reproduisent exactement
 * l'ancien comportement (chaque devis = une demande) : le prix grimpe en cours de
 * navigation. Les mêmes consultations, identifiées, laissent le prix stable.
 */
test('Surge : le défaut est bien celui-là — non identifié le prix monte, identifié il ne bouge pas', async (t) => {
  const { buildApp } = await import('../src/app.js');

  const parcours = async (clientId?: string) => {
    const { app } = await buildApp();             // instance neuve : aucune demande héritée
    const devis = async () => (await app.inject({
      method: 'POST', url: '/pricing/estimate',
      payload: { origin: ORIGIN, destination: DEST, category: 'bronze', clientId },
    })).json().quote;
    const premier = await devis();
    for (let i = 0; i < 4; i++) await devis();    // la personne compare / ajuste
    const dernier = await devis();
    await app.close();
    return { premier, dernier };
  };

  // Ancien comportement (pas d'identifiant) : la navigation déclenche le surge.
  const anonyme = await parcours();
  assert.ok(anonyme.dernier.breakdown.surge > 1,
    'sans identifiant, la navigation seule déclenche le surge (le défaut d’origine)');
  assert.ok(anonyme.dernier.amount > anonyme.premier.amount,
    `sans identifiant le prix monte (${anonyme.premier.amount} -> ${anonyme.dernier.amount})`);

  // Comportement corrigé : la même navigation, identifiée, ne coûte rien de plus.
  const identifie = await parcours('awa');
  assert.equal(identifie.dernier.breakdown.surge, 1, 'identifié : aucun surge');
  assert.equal(identifie.dernier.amount, identifie.premier.amount,
    `identifié, le prix reste identique (${identifie.premier.amount})`);
});

test('Surge : une personne qui revient reste comptée une fois (horodatage rafraîchi)', async (t) => {
  const { buildApp } = await import('../src/app.js');
  const { app, container } = await buildApp();
  t.after(() => app.close());

  container.demand.record(ORIGIN, 'awa');
  container.demand.record(ORIGIN, 'awa');
  container.demand.record(ORIGIN, 'kofi');
  assert.equal(container.demand.demandAt(ORIGIN), 2, 'awa compte une fois, kofi une fois');

  // La cellule reste « chaude » tant que les personnes y sont (console : affecter des chauffeurs).
  const chaudes = await container.demand.hotCells();
  const ici = chaudes.find((c) => c.cell === container.demand.keyFor(ORIGIN));
  assert.ok(ici && ici.demand === 2, 'la console voit 2 demandes réelles, pas 3 appels');
});
