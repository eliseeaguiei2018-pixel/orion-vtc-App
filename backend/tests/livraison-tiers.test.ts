import { test } from 'node:test';
import assert from 'node:assert/strict';

/**
 * LIVRAISON 2.6 : formules moto et voiture, délai de remise (moins cher quand on n'est pas
 * pressé), options payantes, et commande pour d'autres (expéditeur et destinataire tiers).
 */
const ORIGIN = { lat: 5.3236, lng: -4.0217 };       // Plateau
const DEST = { lat: 5.3599, lng: -3.9876 };         // Cocody Riviera

// Chaque devis sur une instance neuve : un devis compte comme une demande (surge).
async function devis(payload: object) {
  const { buildApp } = await import('../src/app.js');
  const { app } = await buildApp();
  const r = await app.inject({ method: 'POST', url: '/pricing/estimate', payload: { serviceType: 'delivery', origin: ORIGIN, destination: DEST, ...payload } });
  await app.close();
  assert.equal(r.statusCode, 200, r.body);
  return r.json().quote;
}

test('Livraison : la voiture coûte plus que la moto et va plus lentement', async () => {
  const moto = await devis({ category: 'moto' });
  const voiture = await devis({ category: 'voiture' });
  assert.equal(moto.livraison.formule, 'moto');
  assert.equal(voiture.livraison.formule, 'voiture');
  assert.ok(voiture.amount > moto.amount, `voiture ${voiture.amount} > moto ${moto.amount}`);
  assert.ok(voiture.etaSeconds > moto.etaSeconds, 'la moto se faufile');
});

test('Livraison : sous 1 h et sous 2 h moins chères qu’express ; options ajoutées au prix', async () => {
  const express = await devis({ category: 'moto' });
  const heure = await devis({ category: 'moto', livraison: { delai: 'heure' } });
  const deux = await devis({ category: 'moto', livraison: { delai: 'deux_heures' } });
  assert.ok(heure.amount < express.amount, `sous 1 h ${heure.amount} < express ${express.amount}`);
  assert.ok(deux.amount < heure.amount, `sous 2 h ${deux.amount} < sous 1 h ${heure.amount}`);
  assert.ok(deux.breakdown.remiseDelai > 0, 'la remise du délai est détaillée');
  const options = await devis({ category: 'moto', livraison: { portePorte: true, isotherme: true, fragile: true } });
  assert.equal(options.breakdown.options, 250, 'porte-à-porte 150 F + sac isotherme 100 F (hors taxes)');
  assert.ok(options.amount > express.amount);
  assert.deepEqual({ p: options.livraison.portePorte, i: options.livraison.isotherme, f: options.livraison.fragile }, { p: true, i: true, f: true });
  // Le sac isotherme est une option de la moto : sans effet en voiture.
  const voiture = await devis({ category: 'voiture', livraison: { isotherme: true } });
  assert.equal(voiture.breakdown.options ?? 0, 0);
  assert.equal(voiture.livraison.isotherme, undefined);
});

test('Livraison pour d’autres : expéditeur et destinataire tiers, options du devis, voiture servie par un chauffeur Argent', async (t) => {
  const { buildApp } = await import('../src/app.js');
  const { activeRideFor } = await import('../src/modules/driver-app/views.js');
  const { app, container } = await buildApp();
  t.after(() => app.close());
  const moto = (await app.inject({ method: 'POST', url: '/drivers', payload: { name: 'Coursier Moto', category: 'moto' } })).json().driver.id;
  await app.inject({ method: 'POST', url: `/drivers/${moto}/online`, payload: { position: { lat: 5.3240, lng: -4.0220 } } });
  const argent = (await app.inject({ method: 'POST', url: '/drivers', payload: { name: 'Berline Argent', category: 'argent' } })).json().driver.id;
  await app.inject({ method: 'POST', url: `/drivers/${argent}/online`, payload: { position: { lat: 5.3241, lng: -4.0221 } } });

  const q = (await app.inject({ method: 'POST', url: '/pricing/estimate', payload: {
    serviceType: 'delivery', origin: ORIGIN, destination: DEST, category: 'voiture', livraison: { delai: 'heure', portePorte: true, fragile: true },
  } })).json().quote;
  const r = await app.inject({ method: 'POST', url: '/rides', headers: { 'idempotency-key': 'liv-tiers-1' }, payload: {
    clientId: 'c-tiers', lockId: q.lockId, paymentMethod: 'cash',
    livraison: {
      expediteur: { nom: 'Boutique Kady', telephone: '07 08 09 10 11' },
      destinataire: { nom: 'Awa Traoré', telephone: '0505050505' },
      retrait: { batiment: 'Immeuble Alpha', etage: '2', repere: 'face à la pharmacie' },
      depot: { porte: '12B', repere: '' },
      description: 'Robe de cérémonie',
      prevenirDestinataire: true, prevenirExpediteur: true,
    },
  } });
  assert.equal(r.statusCode, 201, r.body);
  const ride = r.json().ride;
  assert.equal(ride.driverId, argent, 'le colis volumineux part en voiture, pas à moto');
  const l = ride.livraison;
  assert.equal(l.expediteur.nom, 'Boutique Kady');
  assert.equal(l.expediteur.telephone, '+2250708091011', 'numéro rendu composable (+225)');
  assert.equal(l.destinataire.telephone, '+2250505050505');
  assert.deepEqual(l.retrait, { batiment: 'Immeuble Alpha', etage: '2', repere: 'face à la pharmacie' });
  assert.deepEqual(l.depot, { porte: '12B' }, 'les précisions vides ne sont pas gardées');
  assert.equal(l.formule, 'voiture');
  assert.equal(l.delai, 'heure');
  assert.equal(l.portePorte, true);
  assert.equal(l.fragile, true);
  const restant = (Date.parse(l.livrerAvant) - Date.now()) / 60_000;
  assert.ok(restant > 60 && restant < 60 + 20 + q.etaSeconds / 60 + 1, `livrer avant : dans ${restant.toFixed(0)} min`);

  // Le chauffeur voit qui appeler au retrait (l'expéditeur) et à la remise (le destinataire).
  const vue = activeRideFor(container, argent) as unknown as { livraison: Record<string, unknown> & { expediteur: { nom: string }; destinataire: { nom: string } } };
  assert.equal(vue.livraison.expediteur.nom, 'Boutique Kady');
  assert.equal(vue.livraison.destinataire.nom, 'Awa Traoré');
  assert.equal(vue.livraison.formule, 'voiture');
  assert.equal(vue.livraison.portePorte, true);
  assert.equal(vue.livraison.codeRemiseRequis, true);
});

test('Livraison : numéro d’expéditeur invalide refusé', async (t) => {
  const { buildApp } = await import('../src/app.js');
  const { app } = await buildApp();
  t.after(() => app.close());
  const q = (await app.inject({ method: 'POST', url: '/pricing/estimate', payload: { serviceType: 'delivery', origin: ORIGIN, destination: DEST, category: 'moto' } })).json().quote;
  const r = await app.inject({ method: 'POST', url: '/rides', headers: { 'idempotency-key': 'liv-tiers-2' }, payload: {
    clientId: 'c-tiers-2', lockId: q.lockId,
    livraison: { expediteur: { nom: 'X', telephone: 'abcdef' }, destinataire: { nom: 'Awa', telephone: '0505050505' } },
  } });
  assert.equal(r.statusCode, 400);
});

test('Mon poste du PDG : la hausse ou la baisse des prix vaut aussi pour les livraisons', async (t) => {
  const { buildApp } = await import('../src/app.js');
  const { app, container } = await buildApp();
  t.after(() => app.close());
  // Sans majoration de la demande : seul le réglage de la direction change le prix.
  container.settings.updateOps({ surgeEnabled: false });
  const H = { 'x-admin-token': 'orion-admin-dev' };
  const prix = async (livraison?: object) => (await app.inject({ method: 'POST', url: '/pricing/estimate', payload: { serviceType: 'delivery', origin: ORIGIN, destination: DEST, category: 'moto', ...(livraison ? { livraison } : {}) } })).json().quote;
  const avant = await prix();
  const avantOptions = await prix({ portePorte: true });

  const r = await app.inject({ method: 'POST', url: '/admin/direction/prix', headers: H, payload: { ajustementPct: 20 } });
  assert.equal(r.statusCode, 200, r.body);
  const etat = r.json();
  const ex = etat.livraisons[0];
  assert.ok(ex.prix.moto > ex.sansAjustement.moto && ex.prix.voiture > ex.sansAjustement.voiture, 'la console montre les livraisons ajustées');

  const apres = await prix();
  assert.ok(Math.abs(apres.amount - avant.amount * 1.2) <= 50, `livraison +20 % (${avant.amount} → ${apres.amount})`);
  const apresOptions = await prix({ portePorte: true });
  assert.equal(apresOptions.breakdown.options, 180, 'les options suivent le réglage (150 F → 180 F)');
  assert.ok(apresOptions.amount > avantOptions.amount);

  await app.inject({ method: 'POST', url: '/admin/direction/prix', headers: H, payload: { ajustementPct: -10 } });
  const baisse = await prix();
  assert.ok(Math.abs(baisse.amount - avant.amount * 0.9) <= 50, `livraison −10 % (${avant.amount} → ${baisse.amount})`);
});
