import type { Container } from '../../container.js';
import { config } from '../../config/index.js';

/**
 * MOTEUR DE VIGILANCE ORION.
 *
 * Une console peut afficher des chiffres parfaits et laisser passer une faille : un
 * chauffeur en ligne avec une assurance expirée, une alerte SOS rouge que personne n'a
 * acceptée, une zone active sans un seul véhicule, une location qui commence demain
 * sans chauffeur affecté. Personne ne regarde tous les écrans en même temps.
 *
 * Ce moteur inspecte en permanence l'ensemble de la plateforme et formule chaque
 * problème de la même façon :
 *   CONSTAT (ce qui est observé, chiffré) → CONSÉQUENCE (ce qui arrive si on ne fait
 *   rien) → ACTION (quoi faire) → SECTION (où le faire).
 *
 * Il n'y a là aucune magie et aucun modèle de langage : ce sont des règles explicites
 * sur les données réelles, vérifiables et testables. C'est précisément ce qui en fait
 * un outil de travail fiable — un contrôle qui se trompe ne serait jamais relu.
 */

export type Severite = 'critique' | 'eleve' | 'moyen' | 'info';

export type Domaine =
  | 'securite' | 'conformite' | 'flotte' | 'exploitation' | 'finance' | 'configuration' | 'client';

export interface Constat {
  id: string;
  severite: Severite;
  domaine: Domaine;
  titre: string;
  /** Ce qui est observé, avec les chiffres. */
  constat: string;
  /** Ce que cela produit si personne n'agit. */
  consequence: string;
  /** Ce qu'il faut faire. */
  action: string;
  /** Session de la console où le faire. */
  section: string;
  /** Identifiants concernés (chauffeurs, dossiers, zones…). */
  elements?: string[];
  detecteA: string;
}

const RANG: Record<Severite, number> = { critique: 0, eleve: 1, moyen: 2, info: 3 };
const MINUTE = 60_000;
const HEURE = 3_600_000;
const JOUR = 86_400_000;

export class VigilanceService {
  constructor(private readonly c: Container) {}

  /**
   * Tous les constats, du plus grave au plus bénin.
   *
   * Asynchrone parce que la présence des véhicules vit dans l'index géographique :
   * contrôler une zone sans lire les positions réelles reviendrait à deviner.
   */
  async constats(): Promise<Constat[]> {
    const now = Date.now();
    const at = new Date(now).toISOString();
    const out: Constat[] = [];
    const push = (x: Omit<Constat, 'detecteA'>) => out.push({ ...x, detecteA: at });

    /* ------------------------- CONFORMITÉ & FLOTTE ------------------------- */

    const drivers = this.c.drivers.list();
    const enService = drivers.filter((d) => d.availability === 'online' || d.availability === 'on_trip');

    const assuranceExpiree = enService.filter(
      (d) => d.insuranceExpiry && Date.parse(d.insuranceExpiry) < now,
    );
    if (assuranceExpiree.length > 0) {
      push({
        id: 'assurance-expiree', severite: 'critique', domaine: 'conformite',
        titre: 'Des chauffeurs roulent avec une assurance expirée',
        constat: `${assuranceExpiree.length} chauffeur(s) en service dont l'attestation d'assurance est périmée : ${assuranceExpiree.slice(0, 5).map((d) => d.matricule).join(', ')}.`,
        consequence: 'En cas d’accident, ORION engage sa responsabilité et le passager n’est pas couvert.',
        action: 'Suspendre ces chauffeurs jusqu’à présentation d’une attestation valide.',
        section: 'drivers', elements: assuranceExpiree.map((d) => d.id),
      });
    }

    const kycNonValide = enService.filter((d) => d.kycStatus !== 'active' && d.kycStatus !== 'approved');
    if (kycNonValide.length > 0) {
      push({
        id: 'kyc-non-valide', severite: 'eleve', domaine: 'conformite',
        titre: 'Des chauffeurs en ligne sans dossier validé',
        constat: `${kycNonValide.length} chauffeur(s) acceptent des courses alors que leur dossier KYC n'est pas validé : ${kycNonValide.slice(0, 5).map((d) => `${d.name} (${d.kycStatus})`).join(', ')}.`,
        consequence: 'Un conducteur non vérifié transporte des passagers — risque juridique et réputationnel direct.',
        action: 'Terminer la validation ou mettre ces comptes hors ligne.',
        section: 'drivers', elements: kycNonValide.map((d) => d.id),
      });
    }

    const batterieBasse = enService.filter(
      (d) => (d.engine ?? 'electric') === 'electric' && d.batteryPct !== undefined && d.batteryPct < 15,
    );
    if (batterieBasse.length > 0) {
      push({
        id: 'batterie-basse', severite: 'moyen', domaine: 'flotte',
        titre: 'Véhicules électriques en service sous 15 % de batterie',
        constat: `${batterieBasse.length} véhicule(s) : ${batterieBasse.slice(0, 5).map((d) => `${d.matricule} (${d.batteryPct} %)`).join(', ')}.`,
        consequence: 'Panne en course, passager immobilisé, course annulée et note dégradée.',
        action: 'Déclencher le guidage borne et retirer temporairement ces véhicules du dispatch.',
        section: 'green', elements: batterieBasse.map((d) => d.id),
      });
    }

    /* ---------------------------- EXPLOITATION ---------------------------- */

    const alertes = this.c.safety.list(0);
    const sansAgent = alertes.filter((a) => !a.agent && now - Date.parse(a.createdAt) > 3 * MINUTE);
    if (sansAgent.length > 0) {
      const pire = Math.round((now - Math.min(...sansAgent.map((a) => Date.parse(a.createdAt)))) / MINUTE);
      push({
        id: 'sos-sans-agent', severite: 'critique', domaine: 'exploitation',
        titre: 'Alerte SOS sans gestionnaire',
        constat: `${sansAgent.length} alerte(s) ouverte(s) que personne n'a acceptée, la plus ancienne depuis ${pire} min.`,
        consequence: 'Personne ne pilote la crise : les secours ne sont pas prévenus et l’usager reste seul.',
        action: 'Accepter l’alerte dans la file de triage et joindre les secours depuis le poste de contact.',
        section: 'alerts', elements: sansAgent.map((a) => a.id),
      });
    }

    const rougesLongues = alertes.filter(
      (a) => (a.level ?? 'rouge') === 'rouge' && now - Date.parse(a.createdAt) > 15 * MINUTE,
    );
    if (rougesLongues.length > 0) {
      push({
        id: 'sos-rouge-longue', severite: 'critique', domaine: 'exploitation',
        titre: 'Alerte rouge ouverte depuis plus de 15 minutes',
        constat: `${rougesLongues.length} alerte(s) de niveau rouge toujours ouverte(s) au-delà du délai de traitement.`,
        consequence: 'Un incident grave non clos signifie qu’aucune issue n’a été constatée.',
        action: 'Reprendre le dossier, consigner l’issue des contacts et clore avec une note de synthèse.',
        section: 'alerts', elements: rougesLongues.map((a) => a.id),
      });
    }

    const zonesActives = this.c.settings.getZones().filter((z) => z.active);
    // Positions vivantes : l'index géographique fait foi (un chauffeur « en ligne »
    // dont la position a expiré n'est plus joignable par le dispatch).
    const positions = await this.c.geo.snapshot();
    const zonesVides = zonesActives.filter((z) => !positions.some((p) => {
      const dLat = (p.lat - z.lat) * 111;
      const dLng = (p.lng - z.lng) * 111 * Math.cos((z.lat * Math.PI) / 180);
      return Math.sqrt(dLat * dLat + dLng * dLng) <= z.radiusKm;
    }));
    if (zonesVides.length > 0 && positions.length > 0) {
      push({
        id: 'zones-sans-offre', severite: 'eleve', domaine: 'exploitation',
        titre: 'Zones ouvertes sans aucun véhicule',
        constat: `${zonesVides.length} zone(s) active(s) sans un seul chauffeur présent : ${zonesVides.slice(0, 5).map((z) => z.name).join(', ')}.`,
        consequence: 'Les clients de ces quartiers commandent et n’obtiennent aucun chauffeur — ils essaient la concurrence.',
        action: 'Augmenter le bonus de zone, élargir le rayon de recherche, ou couper temporairement la zone.',
        section: 'zones', elements: zonesVides.map((z) => z.id),
      });
    }

    const reservationsProches = this.c.reservations.list?.() ?? [];
    const sansChauffeur = reservationsProches.filter(
      (r) => r.status === 'planifiee' && Date.parse(r.scheduledFor) - now < 30 * MINUTE && Date.parse(r.scheduledFor) > now,
    );
    if (sansChauffeur.length > 0) {
      push({
        id: 'reservation-sans-chauffeur', severite: 'eleve', domaine: 'exploitation',
        titre: 'Réservation imminente sans chauffeur',
        constat: `${sansChauffeur.length} réservation(s) à prendre en charge dans moins de 30 minutes, aucune n'est assignée.`,
        consequence: 'Le client a planifié son trajet : un retard ici est une promesse non tenue, pas un aléa.',
        action: 'Assigner un chauffeur depuis la carte des réservations.',
        section: 'rides', elements: sansChauffeur.map((r) => r.id),
      });
    }

    const locationsProches = this.c.rental.list({ status: 'reservee' })
      .concat(this.c.rental.list({ status: 'confirmee' }))
      .filter((l) => !l.driverId && Date.parse(l.debut) - now < JOUR && Date.parse(l.debut) > now);
    if (locationsProches.length > 0) {
      push({
        id: 'location-sans-chauffeur', severite: 'eleve', domaine: 'exploitation',
        titre: 'Location dans moins de 24 h sans chauffeur affecté',
        constat: `${locationsProches.length} dossier(s) : ${locationsProches.slice(0, 4).map((l) => `${l.id} (${l.vehicle.name})`).join(', ')}.`,
        consequence: 'Un mariage ou une délégation sans chauffeur le jour J est un échec public, pas un incident interne.',
        action: 'Affecter un chauffeur depuis la session Location Signature.',
        section: 'rental', elements: locationsProches.map((l) => l.id),
      });
    }

    // VOLUME : la fenêtre de 24 h se lit dans l'index chronologique.
    const recentes = this.c.rides.createdSince(now - 24 * HEURE);
    const sansOffre = recentes.filter((r) => r.status === 'no_driver');
    if (recentes.length >= 10 && sansOffre.length / recentes.length > 0.15) {
      push({
        id: 'taux-sans-chauffeur', severite: 'eleve', domaine: 'exploitation',
        titre: 'Trop de commandes sans chauffeur',
        constat: `${sansOffre.length} commandes sur ${recentes.length} (${Math.round((sansOffre.length / recentes.length) * 100)} %) n'ont trouvé aucun chauffeur en 24 h.`,
        consequence: 'Chaque commande sans réponse est un client qui réessaie ailleurs.',
        action: 'Élargir le rayon de recherche, relever le plafond d’ETA, ou lancer une incitation chauffeurs.',
        section: 'dispatch',
      });
    }

    /* -------------------------------- FINANCE -------------------------------- */

    const impayees = this.c.subscriptions.factures('echouee');
    if (impayees.length > 0) {
      push({
        id: 'abonnements-impayes', severite: 'moyen', domaine: 'finance',
        titre: 'Prélèvements d’abonnement en échec',
        constat: `${impayees.length} facture(s) refusée(s) par l'opérateur, soit ${impayees.reduce((n, f) => n + f.amount, 0).toLocaleString('fr-FR')} F.`,
        consequence: 'L’abonné continue de profiter de ses avantages sans payer sa cotisation.',
        action: 'Relancer le client, ou traiter les échéances pour suspendre après le délai de grâce.',
        section: 'subscriptions', elements: impayees.map((f) => f.id),
      });
    }

    const virementsVieux = this.c.treasury.list().filter(
      (t) => t.status === 'pending' && now - Date.parse(t.createdAt) > 2 * JOUR,
    );
    if (virementsVieux.length > 0) {
      push({
        id: 'virements-en-attente', severite: 'moyen', domaine: 'finance',
        titre: 'Virements en attente d’approbation depuis plus de 48 h',
        constat: `${virementsVieux.length} demande(s) bloquée(s), pour ${virementsVieux.reduce((n, t) => n + t.amount, 0).toLocaleString('fr-FR')} F.`,
        consequence: 'Les opérations attendent des fonds déjà demandés : le blocage est administratif, pas financier.',
        action: 'Approuver ou refuser ces demandes depuis la session Trésorerie.',
        section: 'treasury', elements: virementsVieux.map((t) => t.id),
      });
    }

    /* ------------------ Chauffeurs « en ligne » mais introuvables ------------------ */
    // Un chauffeur reste `online` tant qu'il ne se déconnecte pas, mais sa PRÉSENCE
    // dans l'index de dispatch expire sans position reçue (téléphone éteint, réseau
    // coupé, app fermée). La console affichait alors « 44 en ligne » pendant que
    // chaque commande partait en « aucun chauffeur ». Ce qui ment, c'est le compteur.
    const presents = new Set((await this.c.geo.snapshot()).map((e) => e.id));
    const muets = enService.filter((d) => !presents.has(d.id));
    if (muets.length > 0) {
      push({
        id: 'chauffeurs-en-ligne-muets', severite: muets.length >= enService.length / 2 ? 'critique' : 'eleve', domaine: 'exploitation',
        titre: 'Chauffeurs « en ligne » dont le dispatch n’a plus la position',
        constat: `${muets.length} chauffeur(s) sur ${enService.length} affichés en ligne n’ont envoyé aucune position depuis plus de ${config.PRESENCE_TTL_SECONDS} s : ${muets.slice(0, 5).map((d) => d.matricule).join(', ')}${muets.length > 5 ? '…' : ''}.`,
        consequence: 'Le dispatch ne peut pas les attribuer : les clients reçoivent « aucun chauffeur » alors que la flotte paraît disponible.',
        action: 'Les appeler : app fermée, téléphone éteint ou réseau coupé. S’ils ne roulent pas, les passer hors ligne.',
        section: 'dispatch', elements: muets.map((d) => d.id),
      });
    }

    /* ------------------- Courses terminées jamais réglées ------------------- */
    // Trouvé en enregistrant la démonstration : treize chauffeurs « en course »,
    // zéro course active. Le filet de sécurité les libère ; la vigilance montre
    // l'argent qui, lui, n'est pas rentré.
    const nonReglees = this.c.rideRelease.enAttenteDePaiement(now).filter((x) => x.depuisMin > 15);
    if (nonReglees.length > 0) {
      const total = nonReglees.reduce((n, x) => n + x.montant, 0);
      push({
        id: 'courses-terminees-non-reglees', severite: nonReglees.length >= 5 ? 'eleve' : 'moyen', domaine: 'finance',
        titre: 'Courses terminées sans paiement enregistré',
        constat: `${nonReglees.length} course(s) terminée(s) depuis plus de 15 min sans règlement, pour ${total.toLocaleString('fr-FR')} F.`,
        consequence: 'Le chauffeur a été libéré pour continuer à travailler, mais cet argent n’est pas rentré.',
        action: 'Vérifier chaque course depuis la session Courses : encaissement espèces non confirmé, ou client à relancer.',
        section: 'rides', elements: nonReglees.map((x) => x.rideId),
      });
    }

    /* ------------------------------- Caisses ------------------------------- */
    // Une caisse laissée ouverte d'un jour sur l'autre n'est plus comptable de rien :
    // on ne sait plus à quelle journée rattacher les espèces qu'elle contient.
    const caissesDormantes = this.c.caisses.list({ statut: 'ouverte' }).filter(
      (c) => now - Date.parse(c.ouverteLe) > 36 * 3_600_000,
    );
    if (caissesDormantes.length > 0) {
      push({
        id: 'caisse-non-arretee', severite: 'eleve', domaine: 'finance',
        titre: 'Caisses ouvertes depuis plus de 36 h',
        constat: `${caissesDormantes.length} caisse(s) jamais arrêtée(s) : ${caissesDormantes.map((c) => c.titulaireNom).join(', ')}.`,
        consequence: 'Les espèces ne sont rattachées à aucune journée comptable, et l’écart éventuel devient introuvable.',
        action: 'Demander l’arrêté de caisse aux titulaires concernés depuis la session Trésorerie.',
        section: 'treasury', elements: caissesDormantes.map((c) => c.id),
      });
    }

    const arretes = this.c.caisses.list({ statut: 'arretee' });
    const manquants = arretes.filter((c) => (c.ecart ?? 0) < -500);
    if (manquants.length > 0) {
      const total = manquants.reduce((n, c) => n + Math.abs(c.ecart ?? 0), 0);
      push({
        id: 'caisse-manquants', severite: total > 50_000 ? 'eleve' : 'moyen', domaine: 'finance',
        titre: 'Manquants constatés en caisse',
        constat: `${manquants.length} arrêté(s) en manquant, pour ${total.toLocaleString('fr-FR')} F au total.`,
        consequence: 'Un manquant répété chez la même personne n’est plus une erreur de comptage.',
        action: 'Examiner les motifs saisis et rapprocher avec les mouvements de la journée.',
        section: 'treasury', elements: manquants.map((c) => c.id),
      });
    }

    const nonValides = arretes.filter((c) => !c.valideLe && now - Date.parse(c.arreteeLe ?? c.ouverteLe) > 3 * JOUR);
    if (nonValides.length > 0) {
      push({
        id: 'arretes-non-valides', severite: 'moyen', domaine: 'finance',
        titre: 'Arrêtés de caisse non validés depuis plus de 3 jours',
        constat: `${nonValides.length} arrêté(s) attendent la validation d’un supérieur.`,
        consequence: 'Sans contrôle de second niveau, la caisse n’est auditée par personne.',
        action: 'Valider ou contester ces arrêtés depuis la session Trésorerie.',
        section: 'treasury', elements: nonValides.map((c) => c.id),
      });
    }

    /* ------------------------ Requêtes des chauffeurs ------------------------ */
    const requetesOubliees = this.c.crewRequests.list({ statut: 'deposee' }).filter(
      (r) => now - Date.parse(r.createdAt) > 5 * JOUR,
    );
    if (requetesOubliees.length > 0) {
      push({
        id: 'requetes-chauffeurs-dormantes', severite: 'moyen', domaine: 'client',
        titre: 'Requêtes de chauffeurs sans réponse depuis plus de 5 jours',
        constat: `${requetesOubliees.length} demande(s) déposée(s) et jamais instruite(s).`,
        consequence: 'Un chauffeur sans réponse cesse de demander, puis cesse de faire confiance.',
        action: 'Instruire ces requêtes depuis la session Équipages.',
        section: 'crew', elements: requetesOubliees.map((r) => r.id),
      });
    }

    const echeancesEnRetard = this.c.crewRequests.list({ statut: 'versee' }).filter(
      (r) => r.plan?.some((e) => !e.payeeLe && Date.parse(e.dueDate) < now),
    );
    if (echeancesEnRetard.length > 0) {
      push({
        id: 'prets-en-retard', severite: 'moyen', domaine: 'finance',
        titre: 'Échéances de prêt chauffeur en retard',
        constat: `${echeancesEnRetard.length} prêt(s) avec au moins une échéance dépassée.`,
        consequence: 'Un encours qui ne rentre pas finit par être passé en perte.',
        action: 'Régulariser avec les chauffeurs concernés depuis la session Équipages.',
        section: 'crew', elements: echeancesEnRetard.map((r) => r.id),
      });
    }

    const litigesVieux = this.c.disputes.list().filter(
      (d) => (d.status === 'open' || d.status === 'investigating') && now - Date.parse(d.createdAt) > 7 * JOUR,
    );
    if (litigesVieux.length > 0) {
      push({
        id: 'litiges-dormants', severite: 'moyen', domaine: 'client',
        titre: 'Litiges sans décision depuis plus de 7 jours',
        constat: `${litigesVieux.length} dossier(s) ouverts et non tranchés.`,
        consequence: 'Un litige qui traîne devient une contestation bancaire, bien plus coûteuse.',
        action: 'Instruire et trancher depuis la session Litiges.',
        section: 'disputes', elements: litigesVieux.map((d) => d.id),
      });
    }

    const cons = this.c.executive.consolidation(30);
    if (cons.dusChauffeurs > cons.entrees && cons.entrees > 0) {
      push({
        id: 'couverture-retraits', severite: 'critique', domaine: 'finance',
        titre: 'Les sommes dues aux chauffeurs dépassent les encaissements',
        constat: `${cons.dusChauffeurs.toLocaleString('fr-FR')} F dus pour ${cons.entrees.toLocaleString('fr-FR')} F entrés en caisse sur 30 jours.`,
        consequence: 'Si tous les chauffeurs demandent leur retrait, ORION ne peut pas payer.',
        action: 'Vérifier la couverture en trésorerie et le rythme des reversements.',
        section: 'treasury',
      });
    }

    const plafondDette = this.c.settings.getOps().cashDebtLimit;
    const endettes = drivers.filter((d) => this.c.wallet.balance(d.id) < -plafondDette);
    if (endettes.length > 0) {
      push({
        id: 'dette-especes', severite: 'eleve', domaine: 'finance',
        titre: 'Chauffeurs au-delà du plafond de dette espèces',
        constat: `${endettes.length} chauffeur(s) dépassent le plafond de ${plafondDette.toLocaleString('fr-FR')} F : ${endettes.slice(0, 5).map((d) => d.matricule).join(', ')}.`,
        consequence: 'Les commissions encaissées en main propre ne reviennent pas à ORION.',
        action: 'Recouvrer les commissions dues ; ces chauffeurs ne reçoivent déjà plus de course en espèces.',
        section: 'finance', elements: endettes.map((d) => d.id),
      });
    }

    /* ----------------------------- CONFIGURATION ----------------------------- */

    const services = this.c.settings.getServices();
    const enCours = this.c.rides.listActives().filter((r) => ['accepted', 'driver_en_route', 'arrived', 'in_progress'].includes(r.status));
    if (!services.open && enCours.length > 0) {
      push({
        id: 'ferme-avec-courses', severite: 'eleve', domaine: 'configuration',
        titre: 'ORION est fermé alors que des courses sont en cours',
        constat: `${enCours.length} course(s) en cours pendant la maintenance.`,
        consequence: 'Ces clients ne pourront ni payer ni ouvrir un litige tant que la plateforme est fermée.',
        action: 'Attendre la fin des courses avant de fermer, ou rouvrir le temps de les terminer.',
        section: 'services',
      });
    }

    const passerelles = Object.entries(services.gateways ?? {});
    const actives = passerelles.filter(([, on]) => on);
    if (passerelles.length > 0 && actives.length === 0) {
      push({
        id: 'aucune-passerelle', severite: 'critique', domaine: 'configuration',
        titre: 'Aucun moyen de paiement actif',
        constat: 'Toutes les passerelles de paiement sont coupées.',
        consequence: 'Aucune course ne peut être réglée : le service tourne sans encaisser.',
        action: 'Réactiver au moins une passerelle depuis la session Services & ville.',
        section: 'services',
      });
    }

    const p = this.c.settings.getPricing();
    if (p.perKm <= 0 || p.baseFare < 0 || p.minFare < 0) {
      push({
        id: 'tarif-incoherent', severite: 'critique', domaine: 'configuration',
        titre: 'Grille tarifaire incohérente',
        constat: `Prix au km : ${p.perKm} F · prise en charge : ${p.baseFare} F · minimum : ${p.minFare} F.`,
        consequence: 'Les courses sont facturées à un prix absurde, voire nul.',
        action: 'Corriger la grille, ou la réinitialiser depuis la session Tarification.',
        section: 'pricing',
      });
    }

    const ops = this.c.settings.getOps();
    if (ops.commissionGreen > ops.commissionStandard) {
      push({
        id: 'commission-verte-incoherente', severite: 'moyen', domaine: 'configuration',
        titre: 'La commission « verte » est plus élevée que la standard',
        constat: `Verte ${Math.round(ops.commissionGreen * 100)} % contre ${Math.round(ops.commissionStandard * 100)} % en standard.`,
        consequence: 'L’incitation écologique est inversée : rouler électrique coûte plus cher au chauffeur.',
        action: 'Ramener la commission verte sous la commission standard.',
        section: 'dispatch',
      });
    }

    const catalogue = this.c.rentalSettings.etat().vehicules;
    const enVenteSansStock = catalogue.filter((v) => v.actif && v.exemplaires === 0);
    if (enVenteSansStock.length > 0) {
      push({
        id: 'location-sans-stock', severite: 'moyen', domaine: 'configuration',
        titre: 'Véhicules proposés à la location sans aucun exemplaire',
        constat: `${enVenteSansStock.map((v) => v.name).join(', ')}.`,
        consequence: 'Le client voit le modèle, demande un devis, et se heurte à un refus au moment de réserver.',
        action: 'Renseigner le stock réel, ou retirer ces modèles de la vente.',
        section: 'rentalTarifs', elements: enVenteSansStock.map((v) => v.id),
      });
    }

    const secoursCoupes = this.c.contacts.list().filter((x) => x.categorie === 'secours' && !x.actif);
    if (secoursCoupes.length > 0) {
      push({
        id: 'secours-desactives', severite: 'critique', domaine: 'securite',
        titre: 'Des numéros de secours sont désactivés',
        constat: `${secoursCoupes.map((x) => x.label).join(', ')} ne sont plus proposés au poste SOS.`,
        consequence: 'En situation de crise, l’opérateur n’a plus le numéro sous la main.',
        action: 'Réactiver ces lignes dans le répertoire d’urgence.',
        section: 'alerts', elements: secoursCoupes.map((x) => x.id),
      });
    }

    /* -------------------------------- SÉCURITÉ -------------------------------- */

    const tentatives = this.c.security.list();
    const recentesTentatives = tentatives.filter((t) => now - Date.parse(t.at) < 7 * JOUR);
    if (recentesTentatives.length > 0) {
      push({
        id: 'acces-non-autorises', severite: recentesTentatives.length >= 5 ? 'eleve' : 'moyen', domaine: 'securite',
        titre: 'Tentatives d’accès à des sessions non autorisées',
        constat: `${recentesTentatives.length} tentative(s) en 7 jours, par ${new Set(recentesTentatives.map((t) => t.name)).size} compte(s).`,
        consequence: 'Soit des droits mal attribués gênent le travail, soit quelqu’un cherche à voir ce qui ne le regarde pas.',
        action: 'Examiner les tentatives : ajuster le rôle si l’accès est légitime, convoquer sinon.',
        section: 'security', elements: recentesTentatives.slice(0, 10).map((t) => t.id),
      });
    }

    return out.sort((a, b) => RANG[a.severite] - RANG[b.severite]);
  }

  /**
   * État de santé global. Le score part de 100 et retire des points selon la gravité :
   * un seul point critique doit suffire à faire sortir la plateforme du vert.
   */
  async sante(): Promise<{
    score: number;
    etat: 'sain' | 'surveiller' | 'degrade' | 'critique';
    parSeverite: Record<Severite, number>;
    parDomaine: Record<string, number>;
    constats: Constat[];
  }> {
    const constats = await this.constats();
    const parSeverite: Record<Severite, number> = { critique: 0, eleve: 0, moyen: 0, info: 0 };
    const parDomaine: Record<string, number> = {};
    let malus = 0;
    const POIDS: Record<Severite, number> = { critique: 30, eleve: 12, moyen: 5, info: 1 };
    for (const c of constats) {
      parSeverite[c.severite] += 1;
      parDomaine[c.domaine] = (parDomaine[c.domaine] ?? 0) + 1;
      malus += POIDS[c.severite];
    }
    const score = Math.max(0, 100 - malus);
    const etat = parSeverite.critique > 0 ? 'critique'
      : score < 60 ? 'degrade'
        : score < 90 ? 'surveiller' : 'sain';
    return { score, etat, parSeverite, parDomaine, constats };
  }
}
