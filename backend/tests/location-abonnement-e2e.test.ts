import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildApp } from '../src/app.js';
import { PLANS } from '../src/modules/subscriptions/service.js';

/**
 * Parcours RÉELS de bout en bout, via HTTP.
 *
 * Les tests unitaires prouvent que le calcul est juste ; ceux-ci prouvent que le
 * calcul est BRANCHÉ. C'est exactement ce qui manquait à l'abonnement : la logique
 * existait, personne ne l'appelait.
 */

test('location : catalogue → devis → réservation → suivi → annulation', async (t) => {
  const { app } = await buildApp();
  t.after(() => app.close());

  // 1) Le catalogue expose la gamme Signature et TOUT le barème (aucun prix dupliqué
  //    côté interface, donc aucun écart possible entre l'affiché et le facturé).
  const cat = await app.inject({ method: 'GET', url: '/rental/catalogue' });
  assert.equal(cat.statusCode, 200);
  const catalogue = cat.json();
  assert.ok(catalogue.vehicles.some((v: { name: string }) => v.name === 'Huawei Maextro S800'));
  assert.equal(catalogue.formules.length, 3);
  assert.ok(catalogue.bareme.decoration > 0 && catalogue.bareme.minHeures === 3);

  // 2) Disponibilités du jour : la flotte est mobilisable aujourd'hui même.
  const dispos = await app.inject({ method: 'GET', url: '/rental/disponibilites?duree=journee' });
  assert.equal(dispos.statusCode, 200);
  const liste = dispos.json().disponibilites as Array<{ vehicleId: string; disponible: boolean; delaiMinutes: number }>;
  const es9 = liste.find((d) => d.vehicleId === 'nio-es9')!;
  assert.equal(es9.disponible, true);
  assert.ok(es9.delaiMinutes >= 25, 'délai de mise à disposition annoncé pour le jour même');

  // 3) Devis pour un mariage, décoration + cortège de 2 véhicules.
  const debut = new Date(Date.now() + 10 * 86_400_000).toISOString();
  const devis = await app.inject({
    method: 'POST', url: '/rental/quote',
    payload: {
      formula: 'evenement', vehicleId: 'aito-m9', debut, duree: 'journee',
      options: { decoration: true, cortege: 2, tapisRouge: true },
    },
  });
  assert.equal(devis.statusCode, 200);
  const quote = devis.json().quote;
  assert.ok(quote.total > 0 && quote.breakdown.cortege > 0 && quote.breakdown.options > 0);
  assert.equal(quote.jourJ, false);

  // Consulter un devis ne réserve rien : la flotte est intacte.
  const apres = await app.inject({ method: 'GET', url: `/rental/disponibilites?debut=${encodeURIComponent(debut)}&duree=journee` });
  const m9 = (apres.json().disponibilites as Array<{ vehicleId: string; reserves: number }>).find((d) => d.vehicleId === 'aito-m9')!;
  assert.equal(m9.reserves, 0, 'aucune réservation créée par une simple consultation');

  // 4) Réservation ferme.
  const res = await app.inject({
    method: 'POST', url: '/rental/reserve',
    payload: {
      formula: 'evenement', vehicleId: 'aito-m9', debut, duree: 'journee',
      options: { decoration: true, cortege: 2, tapisRouge: true },
      userId: 'client-mariage', lieu: 'Cathédrale Saint-Paul, Plateau',
      contact: { nom: 'Famille Kouassi', telephone: '+2250102030405' },
    },
  });
  assert.equal(res.statusCode, 201);
  const reservation = res.json().reservation;
  assert.equal(reservation.status, 'reservee');
  assert.equal(reservation.total, quote.total, 'le prix réservé est celui du devis');

  // La flotte est maintenant engagée : 1 véhicule + 2 de cortège = 3 exemplaires.
  const apres2 = await app.inject({ method: 'GET', url: `/rental/disponibilites?debut=${encodeURIComponent(debut)}&duree=journee` });
  const m9b = (apres2.json().disponibilites as Array<{ vehicleId: string; reserves: number; restants: number }>).find((d) => d.vehicleId === 'aito-m9')!;
  assert.equal(m9b.reserves, 3);
  assert.equal(m9b.restants, 1);

  // 5) Suivi client.
  const mes = await app.inject({ method: 'GET', url: '/rental/mes-locations/client-mariage' });
  assert.equal(mes.json().reservations.length, 1);
  const detail = await app.inject({ method: 'GET', url: `/rental/reservation/${reservation.id}` });
  assert.equal(detail.json().reservation.lieu, 'Cathédrale Saint-Paul, Plateau');

  // 6) Annulation à 10 jours : sans frais.
  const annul = await app.inject({ method: 'POST', url: `/rental/reservation/${reservation.id}/annuler`, payload: { raison: 'report du mariage' } });
  assert.equal(annul.statusCode, 200);
  assert.equal(annul.json().frais, 0);
  // Et la flotte est libérée.
  const apres3 = await app.inject({ method: 'GET', url: `/rental/disponibilites?debut=${encodeURIComponent(debut)}&duree=journee` });
  const m9c = (apres3.json().disponibilites as Array<{ vehicleId: string; restants: number }>).find((d) => d.vehicleId === 'aito-m9')!;
  assert.equal(m9c.restants, 4);
});

test('location : la remise d’abonné Gold s’applique sans la demander', async (t) => {
  const { app } = await buildApp();
  t.after(() => app.close());

  const debut = new Date(Date.now() + 15 * 86_400_000).toISOString();
  const payload = { formula: 'evenement' as const, vehicleId: 'nio-es9', debut, duree: 'journee' as const };

  const sans = await app.inject({ method: 'POST', url: '/rental/quote', payload });
  await app.inject({ method: 'POST', url: '/subscriptions', payload: { userId: 'abonne-gold', plan: 'gold' } });
  const avec = await app.inject({ method: 'POST', url: '/rental/quote', payload: { ...payload, userId: 'abonne-gold' } });

  assert.ok(avec.json().quote.breakdown.remiseAbonnement > 0, 'remise abonné appliquée');
  assert.ok(avec.json().quote.total < sans.json().quote.total);
});

test('abonnement : estimation (aperçu) → course (quota consommé) → paiement (reste dû)', async (t) => {
  const { app, container } = await buildApp();
  t.after(() => app.close());

  // Un chauffeur en ligne, pour que la course soit réellement attribuée.
  const drv = await app.inject({ method: 'POST', url: '/drivers', payload: { name: 'Konan', category: 'bronze' } });
  const driverId = drv.json().driver.id as string;
  await app.inject({ method: 'POST', url: `/drivers/${driverId}/online`, payload: { position: { lat: 5.324, lng: -4.021 } } });

  // Souscription Gold (4 courses/jour, plafond 5 000 F par course incluse).
  const sub = await app.inject({ method: 'POST', url: '/subscriptions', payload: { userId: 'abonne-1', plan: 'gold', paymentMethod: 'wave' } });
  assert.equal(sub.statusCode, 201);
  assert.equal(sub.json().facture.status, 'en_attente', 'une facture est émise à la souscription');

  // 1) ESTIMATION : l'app cliente voit « course incluse » AVANT de commander…
  const est = await app.inject({
    method: 'POST', url: '/pricing/estimate',
    payload: { origin: { lat: 5.3236, lng: -4.0217 }, destination: { lat: 5.3599, lng: -3.9876 }, category: 'bronze', clientId: 'abonne-1' },
  });
  assert.equal(est.statusCode, 200);
  const abonnement = est.json().abonnement;
  assert.equal(abonnement.covered, true);
  assert.equal(abonnement.plan, 'gold');
  // …et cette consultation n'a RIEN consommé.
  assert.equal(container.subscriptions.get('abonne-1')!.usedToday, 0);

  const quote = est.json().quote;

  // 2) COMMANDE : c'est ici, et seulement ici, que le quota est débité.
  const ride = await app.inject({ method: 'POST', url: '/rides', payload: { clientId: 'abonne-1', lockId: quote.lockId } });
  assert.equal(ride.statusCode, 201);
  const course = ride.json().ride;
  assert.equal(course.subscription.plan, 'gold');
  assert.equal(course.subscription.montantCouvert, Math.min(quote.amount, PLANS.gold.perRideCap));
  assert.equal(container.subscriptions.get('abonne-1')!.usedToday, 1, 'une course incluse consommée');

  // 3) PAIEMENT : le client ne paie que le reste, le chauffeur est payé sur le BRUT.
  for (const to of ['driver_en_route', 'arrived', 'in_progress', 'completed']) {
    const r = await app.inject({ method: 'POST', url: `/rides/${course.id}/transition`, payload: { to } });
    assert.equal(r.statusCode, 200, `transition ${to}`);
  }
  const resteDu = quote.amount - course.subscription.montantCouvert;
  const initiate = await app.inject({ method: 'POST', url: `/rides/${course.id}/pay/initiate`, payload: { method: 'wave' } });
  assert.equal(initiate.json().amount, resteDu, 'le lien de paiement porte le reste dû, pas le brut');

  const pay = await app.inject({ method: 'POST', url: `/rides/${course.id}/pay`, payload: { method: 'card' } });
  assert.equal(pay.statusCode, 200);
  assert.equal(pay.json().payment.amount, resteDu, 'le client ne paie que le reste dû');
  assert.equal(pay.json().rideStatus, 'paid');
  // Le chauffeur, lui, est rémunéré sur le montant brut de la course : l'abonnement
  // est un effort commercial d'ORION, jamais une perte pour le chauffeur.
  assert.equal(pay.json().commission.gross, quote.amount);

  // 4) La valeur réellement rendue est tracée côté abonnement.
  const etat = await app.inject({ method: 'GET', url: '/subscriptions/abonne-1' });
  assert.equal(etat.json().subscription.coursesCouvertes, 1);
  assert.equal(etat.json().restantesAujourdhui, 3);
  assert.ok(etat.json().factureEnAttente, 'la facture reste à encaisser');
});

test('abonnement : une course entièrement couverte ne sollicite aucune passerelle', async (t) => {
  const { app, container } = await buildApp();
  t.after(() => app.close());

  const drv = await app.inject({ method: 'POST', url: '/drivers', payload: { name: 'Awa', category: 'bronze' } });
  const driverId = drv.json().driver.id as string;
  await app.inject({ method: 'POST', url: `/drivers/${driverId}/online`, payload: { position: { lat: 5.324, lng: -4.021 } } });

  await app.inject({ method: 'POST', url: '/subscriptions', payload: { userId: 'abonne-2', plan: 'gold' } });

  // Course très courte : son montant passe sous le plafond de 5 000 F.
  const est = await app.inject({
    method: 'POST', url: '/pricing/estimate',
    payload: { origin: { lat: 5.3236, lng: -4.0217 }, destination: { lat: 5.3246, lng: -4.0227 }, category: 'bronze', clientId: 'abonne-2' },
  });
  const quote = est.json().quote;
  assert.ok(quote.amount <= PLANS.gold.perRideCap, `course à ${quote.amount} F, sous le plafond`);

  const ride = await app.inject({ method: 'POST', url: '/rides', payload: { clientId: 'abonne-2', lockId: quote.lockId } });
  const course = ride.json().ride;
  assert.equal(course.subscription.aPayer, 0);

  for (const to of ['driver_en_route', 'arrived', 'in_progress', 'completed']) {
    await app.inject({ method: 'POST', url: `/rides/${course.id}/transition`, payload: { to } });
  }
  // Mobile money avec 0 F à encaisser : on n'appelle pas l'opérateur (il refuserait),
  // et aucun numéro de téléphone n'est exigé du client.
  const pay = await app.inject({ method: 'POST', url: `/rides/${course.id}/pay`, payload: { method: 'wave' } });
  assert.equal(pay.statusCode, 200);
  assert.equal(pay.json().payment.amount, 0);
  assert.equal(pay.json().rideStatus, 'paid', 'la course est soldée');
  assert.match(pay.json().payment.message, /abonnement/i);
  // Le chauffeur a bien été payé malgré le 0 F encaissé.
  assert.ok(container.wallet.balance(driverId) > 0);
});

test('abonnement : quota épuisé → remise d’abonné appliquée à la course suivante', async (t) => {
  const { app, container } = await buildApp();
  t.after(() => app.close());

  const drv = await app.inject({ method: 'POST', url: '/drivers', payload: { name: 'Ismaël', category: 'bronze' } });
  const driverId = drv.json().driver.id as string;
  await app.inject({ method: 'POST', url: `/drivers/${driverId}/online`, payload: { position: { lat: 5.324, lng: -4.021 } } });

  await app.inject({ method: 'POST', url: '/subscriptions', payload: { userId: 'abonne-3', plan: 'argent' } });
  // On épuise les 3 courses incluses sans passer par le HTTP (le quota, pas le trajet).
  for (let i = 0; i < PLANS.argent.ridesPerDay; i += 1) {
    container.subscriptions.consumeRide('abonne-3', { amount: 3_000, tier: 'bronze' });
  }

  const est = await app.inject({
    method: 'POST', url: '/pricing/estimate',
    payload: { origin: { lat: 5.3236, lng: -4.0217 }, destination: { lat: 5.3599, lng: -3.9876 }, category: 'bronze', clientId: 'abonne-3' },
  });
  const apercu = est.json().abonnement;
  assert.equal(apercu.covered, false);
  assert.ok(apercu.remise > 0, 'la remise -10 % annoncée est bien chiffrée');

  const quote = est.json().quote;
  const ride = await app.inject({ method: 'POST', url: '/rides', payload: { clientId: 'abonne-3', lockId: quote.lockId } });
  const course = ride.json().ride;
  assert.equal(course.subscription.montantCouvert, 0);
  assert.equal(course.subscription.remise, Math.round(quote.amount * PLANS.argent.remiseHorsQuota));
  assert.equal(course.subscription.aPayer, quote.amount - course.subscription.remise);
});
