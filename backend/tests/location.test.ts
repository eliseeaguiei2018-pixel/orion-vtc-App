import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PRESTIGE, prestigeById } from '../src/modules/fleet/prestige.js';
import { RentalService, finDeLocation, quoteRental } from '../src/modules/rental/service.js';
import { RentalSettingsService } from '../src/modules/rental/settings.js';
import { FRAIS, HEURES_PAR_JOURNEE } from '../src/modules/rental/tariff.js';
import { AppError } from '../src/core/errors.js';

/**
 * LOCATION ORION — gamme Signature, formules et mise à disposition.
 *
 * On vérifie ce qui est PROMIS au client : des véhicules ultra-premium introuvables
 * ailleurs, une mise à disposition possible le jour même, une course transformable
 * en location à l'heure ou à la journée, et un prix qui ne dépend que des options
 * réellement choisies.
 */
const TVA = 0.05;
/** Réglages par défaut : mêmes valeurs que le catalogue du code. */
const reglages = () => new RentalSettingsService();
/** Un service de location adossé à des réglages neufs (barème d'origine). */
const nouveauService = () => new RentalService(reglages());
const ctx = (s: RentalService, vehicleId: string, debut: Date, fin: Date, remise = 0, r = reglages()) => ({
  tvaRate: TVA,
  remiseAbonnement: remise,
  disponibilite: s.disponibilite(vehicleId, debut, fin),
  tarif: r.getTarif(),
  vehicle: r.vehicule(vehicleId) ?? r.vehicule('nio-es9')!,
});

/** Une date de début franchement future, pour écarter la majoration « jour J ». */
const PLUS_TARD = () => new Date(Date.now() + 20 * 86_400_000);

test('gamme Signature : les modèles ultra-premium annoncés sont au catalogue', () => {
  for (const nom of ['Huawei Maextro S800', 'Huawei AITO M9', 'NIO ES9', 'BYD Yangwang U7']) {
    assert.ok(PRESTIGE.some((v) => v.name === nom), `${nom} présent au catalogue`);
  }
  // Chaque véhicule est exploitable : places, prix, autonomie, exemplaires.
  for (const v of PRESTIGE) {
    assert.ok(v.places >= 3 && v.prixJour > 0 && v.autonomieKm > 0 && v.exemplaires > 0, v.name);
    assert.ok(v.atouts.length >= 2, `${v.name} : arguments renseignés`);
  }
  // La limousine présidentielle est bien la plus chère de la gamme.
  const plusCher = [...PRESTIGE].sort((a, b) => b.prixJour - a.prixJour)[0]!;
  assert.equal(plusCher.id, 'maextro-s800');
});

test('mise à disposition à l’heure : 3 h coûte moins qu’une journée', () => {
  const s = nouveauService();
  const debut = PLUS_TARD();
  const v = prestigeById('nio-es9')!;

  const fin3 = finDeLocation(debut, 'heures', 3);
  const q3 = quoteRental(
    { formula: 'mise_a_disposition', vehicleId: v.id, debut: debut.toISOString(), duree: 'heures', heures: 3 },
    ctx(s, v.id, debut, fin3),
  );
  const finJ = finDeLocation(debut, 'journee');
  const qJ = quoteRental(
    { formula: 'mise_a_disposition', vehicleId: v.id, debut: debut.toISOString(), duree: 'journee' },
    ctx(s, v.id, debut, finJ),
  );
  assert.ok(q3.total < qJ.total, '3 h moins cher que la journée');
  assert.equal(q3.heuresService, 3);
  assert.equal(qJ.heuresService, HEURES_PAR_JOURNEE);
});

test('à l’heure : jamais plus cher que la journée entière (coefficient plafonné)', () => {
  const s = nouveauService();
  const debut = PLUS_TARD();
  const v = prestigeById('aito-m9')!;
  // 12 h × 17 % = 2,04 journées si on ne plafonnait pas : le client serait pénalisé
  // pour avoir choisi l'heure. Le plafond à 1 l'en protège.
  const q12 = quoteRental(
    { formula: 'mise_a_disposition', vehicleId: v.id, debut: debut.toISOString(), duree: 'heures', heures: 12 },
    ctx(s, v.id, debut, finDeLocation(debut, 'heures', 12)),
  );
  assert.equal(q12.breakdown.vehicule, v.prixJour, 'poste véhicule plafonné au tarif journée');
  // Au-delà de 10 h de service, le relais chauffeur est imposé (et facturé).
  assert.equal(q12.secondChauffeurRequis, true);
  assert.equal(q12.options.secondChauffeur, true);
  assert.ok(q12.breakdown.options >= FRAIS.secondChauffeur);
});

test('privatiser la voiture : journée, week-end, semaine et mois sont dégressifs', () => {
  const s = nouveauService();
  const debut = PLUS_TARD();
  const v = prestigeById('nio-et9')!;
  const prix = (duree: 'journee' | 'weekend' | 'semaine' | 'mois') =>
    quoteRental(
      { formula: 'entreprise', vehicleId: v.id, debut: debut.toISOString(), duree },
      ctx(s, v.id, debut, finDeLocation(debut, duree)),
    );

  const j = prix('journee');
  const sem = prix('semaine');
  const mois = prix('mois');
  assert.ok(prix('weekend').total > j.total);
  assert.ok(sem.total > j.total);
  // Dégressivité : la semaine coûte moins que 7 journées, le mois moins que 30.
  assert.ok(sem.breakdown.vehicule < j.breakdown.vehicule * 7, 'semaine dégressive');
  assert.ok(mois.breakdown.vehicule < j.breakdown.vehicule * 30, 'mois dégressif');
});

test('jour J : la mise à disposition reste possible, en quelques dizaines de minutes', () => {
  const s = nouveauService();
  const maintenant = new Date();
  const v = prestigeById('maextro-s800')!;
  const q = quoteRental(
    { formula: 'evenement', vehicleId: v.id, debut: maintenant.toISOString(), duree: 'journee' },
    ctx(s, v.id, maintenant, finDeLocation(maintenant, 'journee')),
  );
  assert.equal(q.jourJ, true);
  assert.equal(q.disponibilite.disponible, true, 'un véhicule reste mobilisable le jour même');
  assert.ok(q.disponibilite.delaiMinutes >= 25 && q.disponibilite.delaiMinutes <= 45, `délai ${q.disponibilite.delaiMinutes} min`);
  // La mobilisation express est facturée de façon transparente, pas refusée.
  assert.equal(q.breakdown.majorationJourJ, Math.round(q.breakdown.vehicule * FRAIS.majorationJourJ));

  // Une réservation planifiée n'a, elle, aucun délai express ni majoration.
  const tard = PLUS_TARD();
  const planifie = quoteRental(
    { formula: 'evenement', vehicleId: v.id, debut: tard.toISOString(), duree: 'journee' },
    ctx(s, v.id, tard, finDeLocation(tard, 'journee')),
  );
  assert.equal(planifie.jourJ, false);
  assert.equal(planifie.disponibilite.delaiMinutes, 0);
  assert.equal(planifie.breakdown.majorationJourJ, 0);
  assert.ok(planifie.total < q.total);
});

test('cortège : chaque véhicule est facturé à SON prix, remisé — jamais au forfait', () => {
  const s = nouveauService();
  const debut = PLUS_TARD();
  const v = prestigeById('aito-m9')!; // 4 exemplaires
  const q = quoteRental(
    { formula: 'evenement', vehicleId: v.id, debut: debut.toISOString(), duree: 'journee', options: { cortege: 2 } },
    ctx(s, v.id, debut, finDeLocation(debut, 'journee')),
  );
  assert.equal(q.breakdown.cortege, 2 * Math.round(v.prixJour * (1 - FRAIS.remiseCortege)));
  // Un forfait unique serait absurde : la limousine présidentielle coûte deux fois
  // plus cher à la journée que ce SUV. Le poste cortège doit donc différer.
  const limo = prestigeById('maextro-s800')!;
  const qLimo = quoteRental(
    { formula: 'evenement', vehicleId: limo.id, debut: debut.toISOString(), duree: 'journee', options: { cortege: 1 } },
    ctx(s, limo.id, debut, finDeLocation(debut, 'journee')),
  );
  assert.ok(qLimo.breakdown.cortege > q.breakdown.cortege / 2);
});

test('cortège : on ne vend pas plus de véhicules que la flotte n’en compte', () => {
  const s = nouveauService();
  const debut = PLUS_TARD();
  const v = prestigeById('maextro-s800')!; // 2 exemplaires
  assert.throws(
    () => quoteRental(
      { formula: 'evenement', vehicleId: v.id, debut: debut.toISOString(), duree: 'journee', options: { cortege: 5 } },
      ctx(s, v.id, debut, finDeLocation(debut, 'journee')),
    ),
    AppError,
  );
});

test('options : chaque option choisie — et elle seule — augmente le prix', () => {
  const s = nouveauService();
  const debut = PLUS_TARD();
  const v = prestigeById('stelato-s9')!;
  const prix = (options: Record<string, unknown>) =>
    quoteRental(
      { formula: 'evenement', vehicleId: v.id, debut: debut.toISOString(), duree: 'journee', options },
      ctx(s, v.id, debut, finDeLocation(debut, 'journee')),
    );
  const nu = prix({});
  assert.equal(nu.breakdown.options, 0);
  assert.equal(prix({ decoration: true }).breakdown.options, FRAIS.decoration);
  assert.equal(prix({ tapisRouge: true }).breakdown.options, FRAIS.tapisRouge);
  assert.equal(prix({ hotesses: 2 }).breakdown.options, 2 * FRAIS.hotesse);
  assert.equal(prix({ escorte: true }).breakdown.options, FRAIS.escorte);
  assert.equal(prix({ plaque: true }).breakdown.options, FRAIS.plaque);
  assert.equal(prix({ rafraichissements: true }).breakdown.options, FRAIS.rafraichissements);
  // Kilométrage illimité : majoration du poste véhicule, et plus de forfait km.
  const illimite = prix({ kilometrageIllimite: true });
  assert.equal(illimite.breakdown.kilometrageIllimite, Math.round(v.prixJour * FRAIS.majorationKmIllimite));
  assert.equal(illimite.kmInclus, null);
  assert.equal(nu.kmInclus, FRAIS.kmInclusParJour);
});

test('caution et TVA : la caution n’est jamais ajoutée au total', () => {
  const s = nouveauService();
  const debut = PLUS_TARD();
  const v = prestigeById('zeekr-8x')!;
  const q = quoteRental(
    { formula: 'entreprise', vehicleId: v.id, debut: debut.toISOString(), duree: 'journee' },
    ctx(s, v.id, debut, finDeLocation(debut, 'journee')),
  );
  assert.equal(q.breakdown.tva, Math.round(q.breakdown.ht * TVA));
  assert.equal(q.total, q.breakdown.ht + q.breakdown.tva);
  assert.equal(q.caution, Math.round(q.breakdown.ht * FRAIS.tauxCaution));
  assert.ok(q.caution < q.total);
});

test('remise d’abonné ORION appliquée au devis de location', () => {
  const s = nouveauService();
  const debut = PLUS_TARD();
  const v = prestigeById('nio-es9')!;
  const sans = quoteRental(
    { formula: 'evenement', vehicleId: v.id, debut: debut.toISOString(), duree: 'journee' },
    ctx(s, v.id, debut, finDeLocation(debut, 'journee'), 0),
  );
  const avec = quoteRental(
    { formula: 'evenement', vehicleId: v.id, debut: debut.toISOString(), duree: 'journee' },
    ctx(s, v.id, debut, finDeLocation(debut, 'journee'), 0.1),
  );
  assert.equal(avec.breakdown.remiseAbonnement, Math.round(sans.breakdown.vehicule * 0.1));
  assert.ok(avec.total < sans.total);
});

test('disponibilité : une réservation immobilise réellement les exemplaires', () => {
  const s = nouveauService();
  const debut = PLUS_TARD();
  const v = prestigeById('maextro-s800')!; // 2 exemplaires
  const fin = finDeLocation(debut, 'journee');

  assert.equal(s.disponibilite(v.id, debut, fin).restants, 2);
  const q = quoteRental(
    { formula: 'evenement', vehicleId: v.id, debut: debut.toISOString(), duree: 'journee' },
    ctx(s, v.id, debut, fin),
  );
  s.reserve('u1', q);
  assert.equal(s.disponibilite(v.id, debut, fin).restants, 1);

  // Un autre jour, la flotte est de nouveau entière (pas de blocage permanent).
  const autreJour = new Date(debut.getTime() + 5 * 86_400_000);
  assert.equal(s.disponibilite(v.id, autreJour, finDeLocation(autreJour, 'journee')).restants, 2);

  // Deuxième réservation : le dernier exemplaire part.
  s.reserve('u2', q);
  assert.equal(s.disponibilite(v.id, debut, fin).restants, 0);
  // La troisième est refusée — on ne survend pas la flotte.
  assert.throws(() => s.reserve('u3', q), AppError);
});

test('annulation : les frais dépendent du délai de prévenance', () => {
  const s = nouveauService();
  const v = prestigeById('nio-et9')!;
  const reserverDans = (heures: number) => {
    const debut = new Date(Date.now() + heures * 3_600_000);
    const fin = finDeLocation(debut, 'journee');
    const q = quoteRental(
      { formula: 'evenement', vehicleId: v.id, debut: debut.toISOString(), duree: 'journee' },
      ctx(s, v.id, debut, fin),
    );
    return s.reserve(`u-${heures}`, q);
  };

  assert.equal(s.annuler(reserverDans(96).id).taux, 0, 'plus de 48 h : sans frais');
  assert.equal(s.annuler(reserverDans(36).id).taux, 0.5, 'entre 24 et 48 h : moitié');
  assert.equal(s.annuler(reserverDans(2).id).taux, 1, 'moins de 24 h : totalité');

  // On n'annule pas deux fois.
  const r = reserverDans(96);
  s.annuler(r.id);
  assert.throws(() => s.annuler(r.id), AppError);
});

test('suivi console : statuts, chauffeur affecté et indicateurs', () => {
  const s = nouveauService();
  const debut = PLUS_TARD();
  const v = prestigeById('aito-m9')!;
  const q = quoteRental(
    { formula: 'entreprise', vehicleId: v.id, debut: debut.toISOString(), duree: 'semaine' },
    ctx(s, v.id, debut, finDeLocation(debut, 'semaine')),
  );
  const r = s.reserve('societe-1', q, { societe: { nom: 'Ministère des Transports', bonCommande: 'BC-2026-118' } });
  assert.equal(r.status, 'reservee');
  assert.equal(r.societe?.bonCommande, 'BC-2026-118');

  s.assign(r.id, 'driver-7');
  assert.equal(s.get(r.id)!.driverId, 'driver-7');
  s.setStatus(r.id, 'confirmee', 'contrat signé');
  s.setStatus(r.id, 'en_cours');
  const fini = s.setStatus(r.id, 'terminee');
  assert.equal(fini.status, 'terminee');
  // Chaque étape est journalisée (traçabilité pour le support et la facturation).
  assert.ok(fini.events.length >= 5);

  const st = s.stats();
  assert.equal(st.total, 1);
  assert.equal(st.parFormule['entreprise'], 1);
  assert.equal(st.chiffreAffaires, q.total);
  // Une location terminée n'immobilise plus la flotte.
  assert.equal(st.tauxOccupation, 0);
});

test('entrées invalides refusées (véhicule, formule, durée, heures)', () => {
  const s = nouveauService();
  const debut = PLUS_TARD();
  const fin = finDeLocation(debut, 'journee');
  const c = ctx(s, 'nio-es9', debut, fin);
  assert.throws(() => quoteRental({ formula: 'evenement', vehicleId: 'tesla-x' }, c), AppError);
  assert.throws(() => quoteRental({ formula: 'navette', vehicleId: 'nio-es9' }, c), AppError);
  assert.throws(() => quoteRental({ formula: 'evenement', vehicleId: 'nio-es9', duree: 'trimestre' }, c), AppError);
  assert.throws(() => quoteRental({ formula: 'evenement', vehicleId: 'nio-es9', duree: 'heures', heures: 1 }, c), AppError);
  assert.throws(() => quoteRental({ formula: 'evenement', vehicleId: 'nio-es9', duree: 'heures', heures: 30 }, c), AppError);
  assert.throws(() => quoteRental({ formula: 'evenement', vehicleId: 'nio-es9', debut: 'pas-une-date' }, c), AppError);
});

test('tarifs pilotés par la console : un prix ajusté s’applique au devis suivant', () => {
  const r = reglages();
  const s = new RentalService(r);
  const debut = PLUS_TARD();
  const fin = finDeLocation(debut, 'journee');
  const prix = () => quoteRental(
    { formula: 'evenement', vehicleId: 'nio-es9', debut: debut.toISOString(), duree: 'journee' },
    { tvaRate: TVA, disponibilite: s.disponibilite('nio-es9', debut, fin), tarif: r.getTarif(), vehicle: r.vehicule('nio-es9')! },
  );

  const avant = prix();
  assert.equal(avant.breakdown.vehicule, 480_000, 'prix du catalogue de départ');

  // L'équipe commerciale ajuste le prix journée. Aucun redéploiement.
  r.update({ vehicules: { 'nio-es9': { prixJour: 525_000 } }, acteur: 'Direction commerciale' });
  const apres = prix();
  assert.equal(apres.breakdown.vehicule, 525_000, 'le nouveau prix s’applique immédiatement');
  assert.ok(apres.total > avant.total);
  assert.equal(r.getOrigine().modifiePar, 'Direction commerciale', 'l’auteur du changement est tracé');
});

test('tarifs : le barème des options et les majorations sont réglables', () => {
  const r = reglages();
  const s = new RentalService(r);
  const debut = PLUS_TARD();
  const fin = finDeLocation(debut, 'journee');
  const devis = () => quoteRental(
    { formula: 'evenement', vehicleId: 'aito-m9', debut: debut.toISOString(), duree: 'journee', options: { decoration: true } },
    { tvaRate: TVA, disponibilite: s.disponibilite('aito-m9', debut, fin), tarif: r.getTarif(), vehicle: r.vehicule('aito-m9')! },
  );
  assert.equal(devis().breakdown.options, FRAIS.decoration);
  r.update({ tarif: { decoration: 50_000 } });
  assert.equal(devis().breakdown.options, 50_000);

  // Le coefficient d'une durée aussi.
  r.update({ tarif: { coefs: { semaine: 4 } } });
  assert.equal(r.getTarif().coefs.semaine, 4);
});

test('tarifs : les valeurs aberrantes sont bornées, jamais appliquées telles quelles', () => {
  const r = reglages();
  // Une faute de frappe ne doit ni brader la flotte ni la rendre inaccessible.
  r.update({ vehicules: { 'nio-es9': { prixJour: 1 } } });
  assert.equal(r.vehicule('nio-es9')!.prixJour, 10_000, 'plancher appliqué');
  r.update({ tarif: { majorationJourJ: 7, tauxCaution: -2, remiseCortege: 0.9 } });
  assert.equal(r.getTarif().majorationJourJ, 1);
  assert.equal(r.getTarif().tauxCaution, 0);
  assert.equal(r.getTarif().remiseCortege, 0.5);
  // Un maximum sous le minimum rendrait la location à l'heure impossible.
  r.update({ tarif: { minHeures: 6, maxHeures: 3 } });
  assert.ok(r.getTarif().maxHeures >= r.getTarif().minHeures);
});

test('tarifs : un modèle retiré de la vente cesse d’être disponible', () => {
  const r = reglages();
  const s = new RentalService(r);
  const debut = PLUS_TARD();
  const fin = finDeLocation(debut, 'journee');
  assert.equal(s.disponibilite('zeekr-8x', debut, fin).restants, 3);
  assert.ok(s.disponibilites(debut, fin).some((d) => d.vehicleId === 'zeekr-8x'));

  r.update({ vehicules: { 'zeekr-8x': { actif: false } } });
  assert.equal(s.disponibilite('zeekr-8x', debut, fin).restants, 0, 'plus un seul exemplaire vendable');
  assert.ok(!s.disponibilites(debut, fin).some((d) => d.vehicleId === 'zeekr-8x'), 'retiré du catalogue proposé');

  // Et le stock aussi : trois exemplaires partis en maintenance.
  r.update({ vehicules: { 'zeekr-8x': { actif: true, exemplaires: 1 } } });
  assert.equal(s.disponibilite('zeekr-8x', debut, fin).restants, 1);
});

test('tarifs : la remise à zéro restaure le barème d’origine', () => {
  const r = reglages();
  r.update({ vehicules: { 'maextro-s800': { prixJour: 1_200_000 } }, tarif: { decoration: 99_000 } });
  assert.equal(r.vehicule('maextro-s800')!.prixJour, 1_200_000);
  r.reset('DG');
  assert.equal(r.vehicule('maextro-s800')!.prixJour, 900_000);
  assert.equal(r.getTarif().decoration, FRAIS.decoration);
});
