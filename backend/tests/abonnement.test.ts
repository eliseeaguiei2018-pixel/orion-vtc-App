import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SubscriptionService, PLANS } from '../src/modules/subscriptions/service.js';

/**
 * ABONNEMENT ORION — ce que l'audit a trouvé, et ce qui est maintenant vérifié.
 *
 * Avant : `consumeRide()` n'était appelé par personne, `perRideCap` par rien du tout,
 * les niveaux autorisés et les remises n'existaient que dans la liste d'arguments
 * commerciale. L'abonnement était donc un écran, pas un service.
 *
 * Ces tests verrouillent chacun des avantages ANNONCÉS, pour qu'aucun ne puisse
 * redevenir décoratif.
 */

test('abonnement : quota quotidien consommable (comportement historique préservé)', () => {
  const s = new SubscriptionService();
  s.subscribe('u1', 'argent');
  assert.equal(PLANS.argent.ridesPerDay, 3);
  const a = s.consumeRide('u1');
  s.consumeRide('u1');
  const c = s.consumeRide('u1');
  const d = s.consumeRide('u1');
  assert.equal(a.covered, true);
  assert.equal(c.covered, true);
  assert.equal(d.covered, false);
});

test('consulter ne consomme PAS le quota (apercu vs consumeRide)', () => {
  const s = new SubscriptionService();
  s.subscribe('u1', 'bronze'); // 2 courses / jour
  // Dix consultations : le client compare les gammes, cela ne doit rien lui coûter.
  for (let i = 0; i < 10; i += 1) {
    const vu = s.apercu('u1', { amount: 2_000, tier: 'bronze' });
    assert.equal(vu.covered, true, 'l’aperçu annonce bien une course incluse');
  }
  assert.equal(s.get('u1')!.usedToday, 0, 'aucune course consommée par la consultation');
  // Seule la commande consomme.
  s.consumeRide('u1', { amount: 2_000, tier: 'bronze' });
  assert.equal(s.get('u1')!.usedToday, 1);
});

test('plafond par course : le dépassement reste à la charge du client', () => {
  const s = new SubscriptionService();
  s.subscribe('u1', 'bronze'); // plafond 2 500 F
  const r = s.consumeRide('u1', { amount: 9_000, tier: 'bronze' });
  assert.equal(r.covered, true);
  assert.equal(r.montantCouvert, PLANS.bronze.perRideCap);
  assert.equal(r.aPayer, 9_000 - PLANS.bronze.perRideCap);
  // Le cumul de valeur réellement rendue est tracé (argument de rétention).
  assert.equal(s.get('u1')!.totalCouvert, PLANS.bronze.perRideCap);
  assert.equal(s.get('u1')!.coursesCouvertes, 1);
});

test('niveaux autorisés : un Bronze ne voyage pas en Diamant aux frais du forfait', () => {
  const s = new SubscriptionService();
  s.subscribe('u1', 'bronze'); // niveaux bronze & argent uniquement
  const refus = s.consumeRide('u1', { amount: 5_000, tier: 'diamant' });
  assert.equal(refus.covered, false);
  assert.equal(refus.montantCouvert, 0);
  assert.equal(refus.aPayer, 5_000);
  assert.match(refus.raison, /non inclus/);
  // Le quota n'a pas été entamé pour rien.
  assert.equal(s.get('u1')!.usedToday, 0);

  // Le Gold, lui, couvre le Diamant.
  s.subscribe('u2', 'gold');
  assert.equal(s.consumeRide('u2', { amount: 5_000, tier: 'diamant' }).covered, true);
});

test('hors quota : la remise d’abonné annoncée est réellement appliquée', () => {
  const s = new SubscriptionService();
  s.subscribe('u1', 'gold'); // 4 courses/jour, -15 % au-delà
  for (let i = 0; i < 4; i += 1) s.consumeRide('u1', { amount: 3_000, tier: 'or' });
  const horsQuota = s.consumeRide('u1', { amount: 10_000, tier: 'or' });
  assert.equal(horsQuota.covered, false);
  assert.equal(horsQuota.remise, 1_500, '-15 % sur 10 000 F');
  assert.equal(horsQuota.aPayer, 8_500);

  // Le Bronze n'annonce aucune remise : il ne doit pas en inventer une.
  s.subscribe('u2', 'bronze');
  for (let i = 0; i < 2; i += 1) s.consumeRide('u2', { amount: 2_000, tier: 'bronze' });
  assert.equal(s.consumeRide('u2', { amount: 10_000, tier: 'bronze' }).remise, 0);
});

test('abonnement échu ou suspendu : plus aucun avantage', () => {
  const s = new SubscriptionService();
  const sub = s.subscribe('u1', 'gold');
  // On force l'échéance dans le passé (fin de période).
  sub.renewsAt = new Date(Date.now() - 86_400_000).toISOString();
  const r = s.consumeRide('u1', { amount: 4_000, tier: 'or' });
  assert.equal(r.covered, false);
  assert.match(r.raison, /échéance/);
  assert.equal(s.remiseLocation('u1'), 0, 'plus de remise location');
  assert.equal(s.priorite('u1'), 0, 'plus de priorité dispatch');
  assert.equal(s.annulationGratuite('u1'), false);
  assert.equal(s.etat('u1').echu, true);

  // Le renouvellement rétablit tout et émet une nouvelle facture.
  const { facture } = s.renew('u1');
  assert.equal(facture.status, 'en_attente');
  assert.equal(s.consumeRide('u1', { amount: 4_000, tier: 'or' }).covered, true);
  assert.equal(s.remiseLocation('u1'), PLANS.gold.remiseLocation);
});

test('facturation : souscrire émet une facture, le règlement la solde', () => {
  const s = new SubscriptionService();
  s.subscribe('u1', 'argent', { paymentMethod: 'wave' });
  const factures = s.facturesDe('u1');
  assert.equal(factures.length, 1);
  assert.equal(factures[0]!.amount, PLANS.argent.monthlyPrice);
  assert.equal(factures[0]!.status, 'en_attente');
  assert.equal(s.stats().montantImpaye, PLANS.argent.monthlyPrice);

  const payee = s.payerFacture(factures[0]!.id, { method: 'wave', reference: 'WAVE-1' });
  assert.equal(payee.status, 'payee');
  assert.ok(payee.payeeLe);
  assert.equal(s.stats().montantImpaye, 0);
  assert.equal(s.stats().mrr, PLANS.argent.monthlyPrice);
});

test('impayé : suspension après le délai de grâce, réactivation au règlement', () => {
  const s = new SubscriptionService();
  s.subscribe('u1', 'gold');
  const f = s.facturesDe('u1')[0]!;
  // On vieillit la facture au-delà du délai de tolérance.
  f.emiseLe = new Date(Date.now() - 10 * 86_400_000).toISOString();

  const bilan = s.traiterEcheances();
  assert.deepEqual(bilan.suspendus, ['u1']);
  assert.equal(s.get('u1')!.active, false);
  const r = s.consumeRide('u1', { amount: 3_000, tier: 'or' });
  assert.equal(r.covered, false);
  assert.match(r.raison, /suspendu/);

  // Le règlement rouvre l'accès sans re-souscription.
  s.payerFacture(f.id);
  assert.equal(s.get('u1')!.active, true);
  assert.equal(s.consumeRide('u1', { amount: 3_000, tier: 'or' }).covered, true);
});

test('changement de formule : le quota déjà consommé n’est pas remis à zéro', () => {
  const s = new SubscriptionService();
  s.subscribe('u1', 'bronze');
  s.consumeRide('u1', { amount: 1_000, tier: 'bronze' });
  s.consumeRide('u1', { amount: 1_000, tier: 'bronze' }); // quota bronze épuisé (2)
  s.subscribe('u1', 'gold'); // montée en gamme le même jour
  assert.equal(s.get('u1')!.usedToday, 2, 'les 2 courses du jour restent comptées');
  assert.equal(s.get('u1')!.ridesPerDay, 4);
  // Il reste donc 2 courses incluses, pas 4.
  assert.equal(s.etat('u1').restantesAujourdhui, 2);
});

test('résiliation : plus de couverture, et pas de réactivation par un paiement', () => {
  const s = new SubscriptionService();
  s.subscribe('u1', 'argent');
  const f = s.facturesDe('u1')[0]!;
  s.cancel('u1', 'déménagement');
  assert.equal(s.get('u1')!.active, false);
  assert.ok(s.get('u1')!.cancelledAt);
  assert.equal(s.consumeRide('u1', { amount: 2_000, tier: 'bronze' }).covered, false);
  // Régler une ancienne facture ne doit pas ressusciter un abonnement résilié.
  s.payerFacture(f.id);
  assert.equal(s.get('u1')!.active, false);
});

test('sans abonnement : aucune couverture et un message clair', () => {
  const s = new SubscriptionService();
  const r = s.apercu('inconnu', { amount: 3_000, tier: 'bronze' });
  assert.equal(r.covered, false);
  assert.equal(r.aPayer, 3_000);
  assert.match(r.raison, /Aucun abonnement/);
  assert.equal(s.etat('inconnu').subscription, null);
});
