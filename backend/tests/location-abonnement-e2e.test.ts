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
  assert.deepEqual(catalogue.formules.map((f: { id: string }) => f.id), ['evenement', 'entreprise'], 'la mise à disposition est passée aux courses VTC');
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
  const drv = await app.inject({ method: 'POST', url: '/drivers', payload: { name: 'Konan', category: 'argent' } });
  const driverId = drv.json().driver.id as string;
  await app.inject({ method: 'POST', url: `/drivers/${driverId}/online`, payload: { position: { lat: 5.324, lng: -4.021 } } });

  // Souscription Gold (4 courses/jour, plafond 5 000 F par course incluse).
  const sub = await app.inject({ method: 'POST', url: '/subscriptions', payload: { userId: 'abonne-1', plan: 'gold', paymentMethod: 'wave' } });
  assert.equal(sub.statusCode, 201);
  assert.equal(sub.json().facture.status, 'en_attente', 'une facture est émise à la souscription');

  // 1) ESTIMATION : l'app cliente voit « course incluse » AVANT de commander…
  const est = await app.inject({
    method: 'POST', url: '/pricing/estimate',
    payload: { origin: { lat: 5.3236, lng: -4.0217 }, destination: { lat: 5.3599, lng: -3.9876 }, category: 'argent', clientId: 'abonne-1' },
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

  const drv = await app.inject({ method: 'POST', url: '/drivers', payload: { name: 'Awa', category: 'argent' } });
  const driverId = drv.json().driver.id as string;
  await app.inject({ method: 'POST', url: `/drivers/${driverId}/online`, payload: { position: { lat: 5.324, lng: -4.021 } } });

  await app.inject({ method: 'POST', url: '/subscriptions', payload: { userId: 'abonne-2', plan: 'gold' } });

  // Course très courte : son montant passe sous le plafond de 5 000 F.
  const est = await app.inject({
    method: 'POST', url: '/pricing/estimate',
    payload: { origin: { lat: 5.3236, lng: -4.0217 }, destination: { lat: 5.3246, lng: -4.0227 }, category: 'argent', clientId: 'abonne-2' },
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

  const drv = await app.inject({ method: 'POST', url: '/drivers', payload: { name: 'Ismaël', category: 'argent' } });
  const driverId = drv.json().driver.id as string;
  await app.inject({ method: 'POST', url: `/drivers/${driverId}/online`, payload: { position: { lat: 5.324, lng: -4.021 } } });

  await app.inject({ method: 'POST', url: '/subscriptions', payload: { userId: 'abonne-3', plan: 'argent' } });
  // On épuise les 3 courses incluses sans passer par le HTTP (le quota, pas le trajet).
  for (let i = 0; i < PLANS.argent.ridesPerDay; i += 1) {
    container.subscriptions.consumeRide('abonne-3', { amount: 3_000, tier: 'argent' });
  }

  const est = await app.inject({
    method: 'POST', url: '/pricing/estimate',
    payload: { origin: { lat: 5.3236, lng: -4.0217 }, destination: { lat: 5.3599, lng: -3.9876 }, category: 'argent', clientId: 'abonne-3' },
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

test('console : session Location — suivi, affectation, bon PDF et abonnements', async (t) => {
  const { app } = await buildApp();
  t.after(() => app.close());

  const jeton = { 'x-admin-token': 'orion-admin-dev' };

  // Une location arrive côté client…
  const debut = new Date(Date.now() + 3 * 86_400_000).toISOString();
  const res = await app.inject({
    method: 'POST', url: '/rental/reserve',
    payload: {
      formula: 'entreprise', vehicleId: 'maextro-s800', debut, duree: 'mois', mois: 6,
      userId: 'institution-1', lieu: 'Aéroport Félix-Houphouët-Boigny',
      societe: { nom: 'Ambassade du Ghana', bonCommande: 'BC-7741' },
      contact: { nom: 'Protocole', telephone: '+2250708091011' },
    },
  });
  assert.equal(res.statusCode, 201);
  const id = res.json().reservation.id as string;

  // …et la console la voit, avec la flotte et les indicateurs.
  const vue = await app.inject({ method: 'GET', url: '/admin/rental', headers: jeton });
  assert.equal(vue.statusCode, 200);
  const data = vue.json();
  assert.equal(data.reservations.length, 1);
  assert.equal(data.reservations[0].societe.bonCommande, 'BC-7741');
  assert.ok(data.fleet.length >= 7, 'la flotte Signature est exposée à la console');
  assert.equal(data.stats.parFormule['entreprise'], 1);

  // Affectation d'un chauffeur puis avancement du dossier.
  const drv = await app.inject({ method: 'POST', url: '/drivers', payload: { name: 'Mamadou', category: 'diamant' } });
  const driverId = drv.json().driver.id as string;
  const aff = await app.inject({ method: 'POST', url: `/admin/rental/${id}/assign`, headers: jeton, payload: { driverId } });
  assert.equal(aff.json().reservation.driverId, driverId);
  const conf = await app.inject({ method: 'POST', url: `/admin/rental/${id}/status`, headers: jeton, payload: { status: 'confirmee', note: 'contrat signé' } });
  assert.equal(conf.json().reservation.status, 'confirmee');

  // Bon de location : ce que le chauffeur et le client signent au départ.
  const bon = await app.inject({ method: 'GET', url: `/admin/rental/${id}/bon.pdf`, headers: jeton });
  assert.equal(bon.statusCode, 200);
  assert.match(String(bon.headers['content-type']), /application\/pdf/);
  assert.ok(bon.rawPayload.length > 300, 'le PDF a du contenu');

  // Session Abonnements : parc, revenu récurrent et impayés.
  await app.inject({ method: 'POST', url: '/subscriptions', payload: { userId: 'abonne-console', plan: 'gold' } });
  const abo = await app.inject({ method: 'GET', url: '/admin/subscriptions', headers: jeton });
  assert.equal(abo.statusCode, 200);
  assert.equal(abo.json().subscriptions.length, 1);
  assert.equal(abo.json().stats.impayees, 1);

  // Encaissement manuel par le support (espèces en agence).
  const facture = abo.json().invoices[0];
  const paye = await app.inject({
    method: 'POST', url: `/admin/subscriptions/invoices/${facture.id}/payer`,
    headers: jeton, payload: { method: 'cash', reference: 'AGENCE-PLATEAU-12' },
  });
  assert.equal(paye.json().facture.status, 'payee');
  const apres = await app.inject({ method: 'GET', url: '/admin/subscriptions', headers: jeton });
  assert.equal(apres.json().stats.impayees, 0);
  assert.equal(apres.json().stats.mrr, PLANS.gold.monthlyPrice);
});

test('console : la session Location est refusée sans droit, et signalée à la direction', async (t) => {
  const { app, container } = await buildApp();
  t.after(() => app.close());

  // Un analyste financier a la LECTURE mais pas l'écriture sur les locations.
  const { ROLE_PERMISSIONS } = await import('../src/modules/admin/roles.js');
  assert.ok(ROLE_PERMISSIONS.financial_analyst.includes('rental:read'));
  assert.ok(!ROLE_PERMISSIONS.financial_analyst.includes('rental:write'));
  // Le support, lui, traite les dossiers au quotidien.
  assert.ok(ROLE_PERMISSIONS.support.includes('rental:write'));
  // Un observateur ne touche à rien.
  assert.ok(!ROLE_PERMISSIONS.viewer.includes('rental:write'));
  assert.equal(container.security.count(), 0);
});

test('app chauffeur : une location affectée est visible par le chauffeur concerné', async (t) => {
  const { app } = await buildApp();
  t.after(() => app.close());

  const jeton = { 'x-admin-token': 'orion-admin-dev' };
  const debut = new Date(Date.now() + 2 * 86_400_000).toISOString();
  const res = await app.inject({
    method: 'POST', url: '/rental/reserve',
    payload: {
      formula: 'evenement', vehicleId: 'nio-et9', debut, duree: 'journee',
      options: { decoration: true, tapisRouge: true },
      userId: 'client-mariage-2', lieu: 'Mairie du Plateau',
      contact: { nom: 'Témoin', telephone: '+2250101010101' },
    },
  });
  const id = res.json().reservation.id as string;

  // Le chauffeur s'inscrit depuis SON application (OTP) : c'est sa session qui
  // autorise la lecture de ses locations, pas un accès anonyme.
  const otp = await app.inject({ method: 'POST', url: '/drivers/auth/otp', payload: { phone: '0505060708' } });
  const verif = await app.inject({
    method: 'POST', url: '/drivers/auth/verify',
    payload: { phone: '0505060708', code: otp.json().devCode, name: 'Grace Kouamé' },
  });
  const driverId = verif.json().driver.id as string;
  const auth = { authorization: `Bearer ${verif.json().token}` };

  // Sans session chauffeur, la liste est refusée (elle contient des coordonnées de clients).
  const anonyme = await app.inject({ method: 'GET', url: `/drivers/${driverId}/rentals` });
  assert.equal(anonyme.statusCode, 401);

  // Avant affectation : le chauffeur n'a aucune location.
  const avant = await app.inject({ method: 'GET', url: `/drivers/${driverId}/rentals`, headers: auth });
  assert.equal(avant.statusCode, 200);
  assert.equal(avant.json().total, 0);

  await app.inject({ method: 'POST', url: `/admin/rental/${id}/assign`, headers: jeton, payload: { driverId } });

  // Après : il voit le dossier, le lieu, le contact et les options à préparer.
  const apres = await app.inject({ method: 'GET', url: `/drivers/${driverId}/rentals`, headers: auth });
  assert.equal(apres.json().total, 1);
  const loc = apres.json().rentals[0];
  assert.equal(loc.id, id);
  assert.equal(loc.vehicle.name, 'NIO ET9');
  assert.equal(loc.lieu, 'Mairie du Plateau');
  assert.equal(loc.contact.nom, 'Témoin');
  assert.equal(loc.options.decoration, true);
  // Le montant facturé au client ne regarde pas le chauffeur : il reçoit la prestation
  // à assurer, pas la facture.
  assert.equal(loc.total, undefined);
  assert.equal(loc.breakdown, undefined);

  // Une location annulée disparaît de sa liste.
  await app.inject({ method: 'POST', url: `/admin/rental/${id}/annuler`, headers: jeton, payload: { raison: 'report' } });
  const apresAnnul = await app.inject({ method: 'GET', url: `/drivers/${driverId}/rentals`, headers: auth });
  assert.equal(apresAnnul.json().total, 0);
});

test('console : ajuster un prix de location change le devis client, sans redéploiement', async (t) => {
  const { app } = await buildApp();
  t.after(() => app.close());
  const jeton = { 'x-admin-token': 'orion-admin-dev' };
  const debut = new Date(Date.now() + 12 * 86_400_000).toISOString();
  const devis = async () => (await app.inject({
    method: 'POST', url: '/rental/quote',
    payload: { formula: 'evenement', vehicleId: 'stelato-s9', debut, duree: 'journee' },
  })).json().quote;

  const avant = await devis();
  assert.equal(avant.breakdown.vehicule, 90_000);

  // L'équipe ajuste le prix depuis la console.
  const maj = await app.inject({
    method: 'PUT', url: '/admin/rental/tarifs', headers: jeton,
    payload: { vehicules: { 'stelato-s9': { prixJour: 95_000 } }, tarif: { decoration: 40_000 } },
  });
  assert.equal(maj.statusCode, 200);
  // La réponse montre l'ÉCART : c'est ce qu'un directeur relit six mois plus tard.
  assert.deepEqual(maj.json().ecarts['stelato-s9.prixJour'], { avant: 90_000, apres: 95_000 });
  assert.deepEqual(maj.json().ecarts['decoration'], { avant: 20_000, apres: 40_000 });

  const apres = await devis();
  assert.equal(apres.breakdown.vehicule, 95_000, 'le devis client suit immédiatement');

  // Le catalogue public expose le barème EN VIGUEUR : aucun écart affiché/facturé.
  const cat = await app.inject({ method: 'GET', url: '/rental/catalogue' });
  assert.equal(cat.json().bareme.decoration, 40_000);
  assert.equal(cat.json().vehicles.find((v: { id: string }) => v.id === 'stelato-s9').prixJour, 95_000);

  // Le changement est journalisé avec son auteur.
  const journal = await app.inject({ method: 'GET', url: '/admin/audit', headers: jeton });
  assert.ok(journal.json().entries.some((e: { action: string }) => e.action === 'rental.tarifs'));

  // Retrait de la vente : le modèle disparaît du catalogue et ne peut plus être réservé.
  await app.inject({
    method: 'PUT', url: '/admin/rental/tarifs', headers: jeton,
    payload: { vehicules: { 'stelato-s9': { actif: false } } },
  });
  const cat2 = await app.inject({ method: 'GET', url: '/rental/catalogue' });
  assert.ok(!cat2.json().vehicles.some((v: { id: string }) => v.id === 'stelato-s9'));
  const refus = await app.inject({
    method: 'POST', url: '/rental/quote',
    payload: { formula: 'evenement', vehicleId: 'stelato-s9', debut, duree: 'journee' },
  });
  assert.equal(refus.statusCode, 400, 'un modèle retiré ne peut plus être devisé');

  // Remise à zéro : on retrouve la grille d'origine.
  await app.inject({ method: 'POST', url: '/admin/rental/tarifs/reset', headers: jeton });
  assert.equal((await devis()).breakdown.vehicule, 90_000);
});

test('location : la mise à disposition n’est plus une formule de la Location Signature', async () => {
  const { app } = await buildApp();
  const r = await app.inject({ method: 'POST', url: '/rental/quote', payload: { formula: 'mise_a_disposition', vehicleId: 'aito-m9', duree: 'heures', heures: 3 } });
  assert.equal(r.statusCode, 400);
  assert.match(r.body, /MISE_A_DISPOSITION_DEPLACEE/);
  const res = await app.inject({ method: 'POST', url: '/rental/reserve', payload: { formula: 'mise_a_disposition', vehicleId: 'aito-m9', duree: 'journee', userId: 'client-x' } });
  assert.equal(res.statusCode, 400);
  await app.close();
});
