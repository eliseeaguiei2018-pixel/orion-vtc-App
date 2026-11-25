import { randomUUID } from 'node:crypto';
import { badRequest, conflict, notFound } from '../../core/errors.js';
import type { Repository } from '../../core/db/repository.js';
import type { PrestigeVehicle } from '../fleet/prestige.js';
import {
  HEURES_PAR_JOURNEE, JOURS_DUREE, JOURS_PAR_MOIS, MOIS_MAX, isDuree, remiseMensuelle, tauxAnnulation,
  type RentalDuree, type RentalFormula, type RentalOptions,
} from './tariff.js';
import type { RentalSettingsService, RentalTarif } from './settings.js';

/**
 * LOCATION ORION — devis, disponibilité et réservations.
 *
 * Ce module couvre les trois besoins exprimés :
 *   1. louer un véhicule ultra-premium pour un ÉVÉNEMENT (mariage, cérémonie) ;
 *   2. louer pour une ENTREPRISE ou une INSTITUTION (contrat, facture TVA, bon de commande) ;
 *   3. transformer une COURSE en location : garder la voiture N heures, ou privatiser
 *      le véhicule pour la journée entière.
 *
 * Engagement commercial tenu côté code : la mise à disposition reste possible LE JOUR
 * MÊME. On ne refuse donc pas une demande du jour ; on calcule un délai réel (25 à
 * 45 min selon la charge de la flotte) et une majoration de mobilisation express.
 */
export type RentalStatus = 'devis' | 'reservee' | 'confirmee' | 'en_cours' | 'terminee' | 'annulee';

/** Statuts qui immobilisent réellement un véhicule (calcul de disponibilité). */
const STATUTS_BLOQUANTS: RentalStatus[] = ['reservee', 'confirmee', 'en_cours'];

export interface Disponibilite {
  vehicleId: string;
  /** Exemplaires de ce modèle dans la flotte. */
  total: number;
  /** Exemplaires déjà engagés sur la période demandée. */
  reserves: number;
  restants: number;
  disponible: boolean;
  /** Mise à disposition le jour même : délai réel en minutes (0 si réservation planifiée). */
  delaiMinutes: number;
}

export interface RentalBreakdown {
  vehicule: number;
  kilometrageIllimite: number;
  cortege: number;
  options: number;
  majorationJourJ: number;
  remiseAbonnement: number;
  ht: number;
  tva: number;
}

export interface RentalQuote {
  formula: RentalFormula;
  vehicleId: string;
  /** Instantané du véhicule : un changement de catalogue ne réécrit pas l'historique. */
  vehicle: Pick<PrestigeVehicle, 'id' | 'name' | 'marque' | 'classe' | 'places' | 'prixJour' | 'autonomieKm'>;
  debut: string;
  fin: string;
  duree: RentalDuree;
  heures?: number;
  /** Forfait mensuel : nombre de mois d'engagement. */
  mois?: number;
  /** Forfait mensuel : le contrat se reconduit-il à l'échéance ? */
  renouvelable?: boolean;
  /** Forfait mensuel : ce que le client règle CHAQUE mois, toutes taxes comprises. */
  mensualite?: number;
  /**
   * Ce que la durée fait gagner par rapport au tarif journalier plein : part (0–1) et
   * montant en F CFA. Zéro pour une journée ou une location à l'heure.
   */
  remiseDuree: { taux: number; montant: number };
  /** Heures de service du chauffeur couvertes par le devis. */
  heuresService: number;
  jours: number;
  options: Required<RentalOptions>;
  /** Relais imposé par la durée (plus de 10 h de service) — facturé d'office. */
  secondChauffeurRequis: boolean;
  kmInclus: number | null;
  prixKmSupp: number;
  breakdown: RentalBreakdown;
  total: number;
  /** Caution restituée à la restitution — NON comprise dans le total. */
  caution: number;
  /** Location commençant aujourd'hui : mobilisation express. */
  jourJ: boolean;
  disponibilite: Disponibilite;
  currency: 'XOF';
}

export interface RentalEvent { type: string; at: string; note?: string }

export interface RentalReservation extends RentalQuote {
  id: string;
  userId: string;
  status: RentalStatus;
  /** Coordonnées de l'organisateur (événement) ou du donneur d'ordre (entreprise). */
  contact?: { nom: string; telephone: string; email?: string };
  /** Formule entreprise : raison sociale, institution, bon de commande. */
  societe?: { nom: string; bonCommande?: string; contribuable?: string };
  /** Lieu de prise en charge (adresse libre : église, hôtel, siège social…). */
  lieu?: string;
  /** Chauffeur affecté par la console. */
  driverId?: string;
  events: RentalEvent[];
  createdAt: string;
  updatedAt: string;
}

const HEURE_MS = 3_600_000;
const JOUR_MS = 86_400_000;

/** Fin de la période d'immobilisation du véhicule. */
export function finDeLocation(debut: Date, duree: RentalDuree, heures = 3, mois = 1): Date {
  if (duree === 'heures') return new Date(debut.getTime() + heures * HEURE_MS);
  if (duree === 'mois') return new Date(debut.getTime() + Math.max(1, mois) * JOURS_PAR_MOIS * JOUR_MS);
  return new Date(debut.getTime() + JOURS_DUREE[duree] * JOUR_MS);
}

export interface PeriodeLocation {
  formula: RentalFormula;
  duree: RentalDuree;
  heures?: number;
  mois?: number;
  debut: Date;
  fin: Date;
}

/**
 * Période RÉELLEMENT vendue pour une demande. C'est ici que vivent les règles de
 * durée — une seule fois, pour que le devis, la réservation et le calcul de
 * disponibilité ne puissent pas diverger :
 *   • une ENTREPRISE ne loue qu'au forfait mensuel, six mois minimum ;
 *   • un PARTICULIER loue à l'heure, à la journée, au week-end, à la semaine ou au mois.
 */
export function periodeDeLocation(
  input: Pick<RentalQuoteInput, 'formula' | 'debut' | 'duree' | 'heures' | 'mois'>,
  tarif: Pick<RentalTarif, 'minHeures' | 'maxHeures' | 'moisMinEntreprise'>,
): PeriodeLocation {
  const formula = input.formula as RentalFormula;
  if (!['evenement', 'entreprise', 'mise_a_disposition'].includes(formula)) {
    throw badRequest('Formule de location inconnue');
  }
  const entreprise = formula === 'entreprise';
  const duree = (input.duree ?? (entreprise ? 'mois' : 'journee')) as RentalDuree;
  if (!isDuree(duree)) throw badRequest('Durée de location inconnue');
  if (entreprise && duree !== 'mois') {
    throw badRequest(`La location entreprise se fait uniquement en forfait mensuel, ${tarif.moisMinEntreprise} mois minimum`);
  }

  let heures: number | undefined;
  if (duree === 'heures') {
    heures = Math.round(input.heures ?? tarif.minHeures);
    if (heures < tarif.minHeures) throw badRequest(`Location à l’heure : ${tarif.minHeures} h minimum`);
    if (heures > tarif.maxHeures) throw badRequest(`Au-delà de ${tarif.maxHeures} h, choisissez la journée entière`);
  }

  let mois: number | undefined;
  if (duree === 'mois') {
    const minimum = entreprise ? tarif.moisMinEntreprise : 1;
    mois = Math.round(input.mois ?? minimum);
    if (mois < minimum) {
      throw badRequest(entreprise
        ? `Forfait entreprise : ${minimum} mois d’engagement minimum`
        : 'Forfait mensuel : 1 mois minimum');
    }
    if (mois > MOIS_MAX) throw badRequest(`Forfait mensuel : ${MOIS_MAX} mois maximum par contrat`);
  }

  const debut = input.debut ? new Date(input.debut) : new Date();
  if (Number.isNaN(debut.getTime())) throw badRequest('Date de début invalide');
  return { formula, duree, heures, mois, debut, fin: finDeLocation(debut, duree, heures, mois) };
}

const memeJour = (a: Date, b: Date) => a.toISOString().slice(0, 10) === b.toISOString().slice(0, 10);

/** Deux périodes [d1,f1[ et [d2,f2[ se chevauchent-elles ? */
const chevauche = (d1: number, f1: number, d2: number, f2: number) => d1 < f2 && d2 < f1;

export interface RentalQuoteInput {
  formula: string;
  vehicleId: string;
  /** Début de la location (ISO). Par défaut : maintenant (mise à disposition immédiate). */
  debut?: string;
  duree?: string;
  heures?: number;
  /** Forfait mensuel : nombre de mois (6 minimum pour une entreprise). */
  mois?: number;
  /** Forfait mensuel : reconduction à l'échéance (oui par défaut pour une entreprise). */
  renouvelable?: boolean;
  options?: RentalOptions;
}

export interface RentalQuoteContext {
  /** Taux de TVA en vigueur (réglages tarifaires de la console). */
  tvaRate: number;
  /** Remise liée à l'abonnement ORION du client (0 si aucun). */
  remiseAbonnement?: number;
  /** Disponibilité calculée par le service (injectée pour garder le devis pur). */
  disponibilite: Disponibilite;
  /** Barème EN VIGUEUR, tel que la console l'a réglé. */
  tarif: RentalTarif;
  /** Véhicule au prix EN VIGUEUR (le catalogue du code n'est qu'un point de départ). */
  vehicle: PrestigeVehicle;
}

/**
 * Calcul PUR du devis de location. Aucun effet de bord : consulter un prix ne réserve
 * rien et ne consomme rien (même principe que la correction appliquée au surge —
 * une simple consultation ne doit jamais modifier l'état du système).
 */
export function quoteRental(input: RentalQuoteInput, ctx: RentalQuoteContext): RentalQuote {
  const vehicle = ctx.vehicle;
  const T = ctx.tarif;
  if (!vehicle || vehicle.id !== input.vehicleId) throw badRequest('Véhicule de location inconnu');

  const { formula, duree, heures, mois, debut: debutDate, fin: finDate } = periodeDeLocation(input, T);
  const mensuel = duree === 'mois';

  // Coefficient horaire PLAFONNÉ à 1 : le client ne paie jamais plus cher à l'heure
  // que la journée entière, quel que soit le ratio réglé dans la console.
  // Forfait mensuel : chaque mois est remisé selon la durée de l'engagement (−30 % dès
  // le premier mois, jusqu'à −45 % à partir de douze).
  const coef = duree === 'heures'
    ? Math.min(heures! * T.ratioHeure, 1)
    : mensuel
      ? JOURS_PAR_MOIS * (1 - remiseMensuelle(T, mois!)) * mois!
      : T.coefs[duree];
  const jours = duree === 'heures' ? heures! / HEURES_PAR_JOURNEE : mensuel ? JOURS_PAR_MOIS * mois! : JOURS_DUREE[duree];
  const joursFactures = Math.max(1, Math.ceil(jours));

  // Au-delà de 10 h de service, un relais est imposé par la réglementation du temps
  // de conduite : on le facture d'office plutôt que de le laisser au choix du client.
  const heuresService = duree === 'heures' ? heures! : jours * HEURES_PAR_JOURNEE;
  const secondChauffeurRequis = (duree === 'heures' ? heures! : HEURES_PAR_JOURNEE) > HEURES_PAR_JOURNEE;

  const opts: Required<RentalOptions> = {
    decoration: input.options?.decoration ?? false,
    tapisRouge: input.options?.tapisRouge ?? false,
    cortege: Math.max(0, Math.min(10, Math.round(input.options?.cortege ?? 0))),
    hotesses: Math.max(0, Math.min(10, Math.round(input.options?.hotesses ?? 0))),
    escorte: input.options?.escorte ?? false,
    plaque: input.options?.plaque ?? false,
    kilometrageIllimite: input.options?.kilometrageIllimite ?? false,
    secondChauffeur: secondChauffeurRequis || (input.options?.secondChauffeur ?? false),
    rafraichissements: input.options?.rafraichissements ?? false,
  };

  // Le cortège mobilise d'autres exemplaires du MÊME modèle : chacun est facturé à son
  // propre tarif (remisé), jamais au forfait — un forfait unique serait absurde entre
  // un SUV à 60 000 F et une limousine présidentielle à 300 000 F la journée.
  if (opts.cortege > 0 && opts.cortege + 1 > ctx.disponibilite.total) {
    throw badRequest(`La flotte ne compte que ${ctx.disponibilite.total} exemplaire(s) de ce modèle`);
  }

  const vehiculeBase = Math.round(vehicle.prixJour * coef);
  const kilometrageIllimite = opts.kilometrageIllimite
    ? Math.round(vehiculeBase * T.majorationKmIllimite)
    : 0;
  const cortege = opts.cortege * Math.round(vehicle.prixJour * coef * (1 - T.remiseCortege));

  const options =
    (opts.decoration ? T.decoration : 0) +
    (opts.tapisRouge ? T.tapisRouge : 0) +
    opts.hotesses * T.hotesse * joursFactures +
    (opts.escorte ? T.escorte : 0) +
    (opts.plaque ? T.plaque : 0) +
    (opts.secondChauffeur ? T.secondChauffeur : 0) +
    (opts.rafraichissements ? T.rafraichissements : 0);

  const sousTotal = vehiculeBase + kilometrageIllimite + cortege + options;

  // Mobilisation express : elle rémunère la préparation en urgence du PREMIER jour. Sur
  // une semaine ou un forfait mensuel, la calculer sur tout le contrat reviendrait à
  // facturer douze fois la même équipe d'astreinte.
  const jourJ = memeJour(debutDate, new Date());
  const assietteExpress = duree === 'semaine' || mensuel ? Math.min(sousTotal, vehicle.prixJour * (1 + opts.cortege)) : sousTotal;
  const majorationJourJ = jourJ ? Math.round(assietteExpress * T.majorationJourJ) : 0;

  const tauxRemise = Math.max(0, Math.min(0.3, ctx.remiseAbonnement ?? 0));
  const remiseAbonnement = Math.round((sousTotal + majorationJourJ) * tauxRemise);

  const ht = sousTotal + majorationJourJ - remiseAbonnement;
  const tva = Math.round(ht * Math.max(0, ctx.tvaRate));
  const total = ht + tva;

  // Ce que la durée fait gagner face au tarif journalier plein (transparence du devis).
  const pleinTarif = duree === 'heures' ? vehiculeBase : Math.round(vehicle.prixJour * jours);
  const remiseDuree = {
    taux: pleinTarif > 0 ? Math.round((1 - vehiculeBase / pleinTarif) * 1000) / 1000 : 0,
    montant: Math.max(0, pleinTarif - vehiculeBase),
  };

  return {
    formula,
    vehicleId: vehicle.id,
    vehicle: {
      id: vehicle.id, name: vehicle.name, marque: vehicle.marque, classe: vehicle.classe,
      places: vehicle.places, prixJour: vehicle.prixJour, autonomieKm: vehicle.autonomieKm,
    },
    debut: debutDate.toISOString(),
    fin: finDate.toISOString(),
    duree,
    heures,
    mois,
    // Une entreprise reconduit par défaut ; un particulier doit le demander.
    renouvelable: mensuel ? (input.renouvelable ?? formula === 'entreprise') : undefined,
    mensualite: mensuel ? Math.round(total / mois!) : undefined,
    remiseDuree,
    heuresService,
    jours,
    options: opts,
    secondChauffeurRequis,
    kmInclus: opts.kilometrageIllimite ? null : T.kmInclusParJour * joursFactures,
    prixKmSupp: T.prixKmSupp,
    breakdown: { vehicule: vehiculeBase, kilometrageIllimite, cortege, options, majorationJourJ, remiseAbonnement, ht, tva },
    total,
    // Forfait mensuel : la caution garantit UN mois, pas le contrat entier.
    caution: Math.round((mensuel ? ht / mois! : ht) * T.tauxCaution),
    jourJ,
    disponibilite: ctx.disponibilite,
    currency: 'XOF',
  };
}

/** Étapes que le chauffeur déclare lui-même sur une location qui lui est confiée. */
export const ETAPES_CHAUFFEUR = ['vehicule_prepare', 'en_route', 'sur_place', 'debut_service', 'fin_service'] as const;
export type EtapeChauffeur = (typeof ETAPES_CHAUFFEUR)[number];

export class RentalService {
  private readonly items = new Map<string, RentalReservation>();
  /**
   * Écouteurs de changement (app chauffeur synchronisée) : affectation, statut console,
   * annulation, étape déclarée. `precedent` = chauffeur retiré lors d'une réaffectation.
   */
  private readonly ecouteurs: Array<(r: RentalReservation, evenement: string, precedent?: string) => void> = [];

  onChange(fn: (r: RentalReservation, evenement: string, precedent?: string) => void): void {
    this.ecouteurs.push(fn);
  }

  private signaler(r: RentalReservation, evenement: string, precedent?: string): void {
    for (const fn of this.ecouteurs) {
      try { fn(r, evenement, precedent); } catch { /* la diffusion ne bloque jamais une écriture */ }
    }
  }

  /**
   * Le CHAUFFEUR affecté déclare une étape (véhicule préparé, en route, sur place, début
   * puis fin de service). Le début et la fin de service font avancer le dossier
   * (en cours → terminée) : c'est le chauffeur qui est sur place, la console le voit.
   */
  etapeChauffeur(id: string, driverId: string, etape: EtapeChauffeur, note?: string): RentalReservation {
    const r = this.items.get(id);
    if (!r || r.driverId !== driverId) throw notFound('Location introuvable');
    if (r.status === 'annulee' || r.status === 'terminee') throw conflict('Cette location est close');
    if (r.events.some((e) => e.type === `chauffeur:${etape}`)) throw conflict('Étape déjà déclarée');
    if (etape === 'fin_service' && !r.events.some((e) => e.type === 'chauffeur:debut_service')) {
      throw badRequest('Déclarez d’abord le début de service');
    }
    r.updatedAt = new Date().toISOString();
    r.events.push({ type: `chauffeur:${etape}`, at: r.updatedAt, note });
    if (etape === 'debut_service' && r.status !== 'en_cours') {
      r.status = 'en_cours';
      r.events.push({ type: 'en_cours', at: r.updatedAt, note: 'Début de service déclaré par le chauffeur' });
    }
    if (etape === 'fin_service') {
      r.status = 'terminee';
      r.events.push({ type: 'terminee', at: r.updatedAt, note: 'Fin de service déclarée par le chauffeur' });
    }
    this.repo?.put(r);
    this.signaler(r, `etape:${etape}`);
    return r;
  }

  /**
   * `settings` porte les prix et les stocks RÉGLÉS DEPUIS LA CONSOLE. La disponibilité
   * doit s'appuyer dessus : si l'exploitation retire un véhicule de la flotte, il doit
   * cesser d'être vendu à la seconde, sans redéploiement.
   */
  constructor(
    private readonly settings: RentalSettingsService,
    private readonly repo?: Repository<RentalReservation>,
  ) {
    for (const r of repo?.all() ?? []) this.items.set(r.id, r);
  }

  /**
   * Disponibilité réelle d'un modèle sur une période : exemplaires de la flotte moins
   * ceux déjà engagés (une réservation avec cortège en immobilise plusieurs).
   */
  disponibilite(vehicleId: string, debut: Date, fin: Date): Disponibilite {
    const total = this.settings.exemplaires(vehicleId);
    const d = debut.getTime();
    const f = fin.getTime();
    let reserves = 0;
    for (const r of this.items.values()) {
      if (r.vehicleId !== vehicleId) continue;
      if (!STATUTS_BLOQUANTS.includes(r.status)) continue;
      if (!chevauche(Date.parse(r.debut), Date.parse(r.fin), d, f)) continue;
      reserves += 1 + r.options.cortege;
    }
    const restants = Math.max(0, total - reserves);
    const occupation = total > 0 ? Math.min(1, reserves / total) : 1;
    // Engagement « disponible en quelques minutes, même le jour J » : on chiffre le
    // délai réel au lieu de le promettre en l'air.
    const t = this.settings.getTarif();
    const delaiMinutes = memeJour(debut, new Date())
      ? t.delaiExpressMin + Math.round(occupation * (t.delaiExpressMax - t.delaiExpressMin))
      : 0;
    return { vehicleId, total, reserves, restants, disponible: restants > 0, delaiMinutes };
  }

  /** Disponibilité de TOUTE la gamme Signature sur une période (écran de choix). */
  disponibilites(debut: Date, fin: Date): Disponibilite[] {
    return this.settings.catalogue().map((v) => this.disponibilite(v.id, debut, fin));
  }

  reserve(
    userId: string,
    quote: RentalQuote,
    extra: Pick<RentalReservation, 'contact' | 'societe' | 'lieu'> = {},
  ): RentalReservation {
    // Re-vérification au moment de l'engagement : le devis a pu être consulté il y a
    // dix minutes et le dernier exemplaire être parti entre-temps.
    const dispo = this.disponibilite(quote.vehicleId, new Date(quote.debut), new Date(quote.fin));
    const besoin = 1 + quote.options.cortege;
    if (dispo.restants < besoin) {
      throw conflict(
        `Plus assez d’exemplaires disponibles sur cette période (${dispo.restants} restant(s) pour ${besoin} demandé(s))`,
      );
    }
    const now = new Date().toISOString();
    const res: RentalReservation = {
      ...quote,
      disponibilite: dispo,
      id: randomUUID().slice(0, 8).toUpperCase(),
      userId,
      status: 'reservee',
      ...extra,
      events: [{ type: 'reservee', at: now, note: `${quote.vehicle.name} — ${quote.total} F` }],
      createdAt: now,
      updatedAt: now,
    };
    this.items.set(res.id, res);
    this.repo?.put(res);
    return res;
  }

  get(id: string): RentalReservation | undefined { return this.items.get(id); }

  listByUser(userId: string): RentalReservation[] {
    return [...this.items.values()]
      .filter((r) => r.userId === userId)
      .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
  }

  /**
   * Locations confiées à un chauffeur. Sans cette liste, la console pouvait
   * « affecter » un chauffeur qui n'en saurait jamais rien : une affectation
   * invisible de l'autre côté n'est pas une affectation.
   */
  listByDriver(driverId: string): RentalReservation[] {
    return [...this.items.values()]
      .filter((r) => r.driverId === driverId && r.status !== 'annulee')
      .sort((a, b) => Date.parse(a.debut) - Date.parse(b.debut));
  }

  /** Vue console : filtrable par statut et par formule. */
  list(filtre: { status?: RentalStatus; formula?: RentalFormula } = {}): RentalReservation[] {
    return [...this.items.values()]
      .filter((r) => (!filtre.status || r.status === filtre.status) && (!filtre.formula || r.formula === filtre.formula))
      .sort((a, b) => Date.parse(a.debut) - Date.parse(b.debut));
  }

  setStatus(id: string, status: RentalStatus, note?: string): RentalReservation {
    const r = this.items.get(id);
    if (!r) throw notFound('Location introuvable');
    r.status = status;
    r.updatedAt = new Date().toISOString();
    r.events.push({ type: status, at: r.updatedAt, note });
    this.repo?.put(r);
    this.signaler(r, `statut:${status}`);
    return r;
  }

  /** Affectation d'un chauffeur depuis la console. */
  assign(id: string, driverId: string): RentalReservation {
    const r = this.items.get(id);
    if (!r) throw notFound('Location introuvable');
    const precedent = r.driverId && r.driverId !== driverId ? r.driverId : undefined;
    r.driverId = driverId;
    r.updatedAt = new Date().toISOString();
    r.events.push({ type: 'chauffeur_affecte', at: r.updatedAt, note: driverId });
    this.repo?.put(r);
    this.signaler(r, 'affectation', precedent);
    return r;
  }

  /**
   * Annulation : les frais dépendent du délai de prévenance, car un véhicule
   * immobilisé puis libéré tardivement ne se reloue plus.
   */
  annuler(id: string, raison?: string): { reservation: RentalReservation; frais: number; taux: number } {
    const r = this.items.get(id);
    if (!r) throw notFound('Location introuvable');
    if (r.status === 'annulee') throw conflict('Location déjà annulée');
    if (r.status === 'terminee') throw conflict('Location déjà terminée');
    const heuresAvant = (Date.parse(r.debut) - Date.now()) / HEURE_MS;
    const taux = tauxAnnulation(heuresAvant);
    const frais = Math.round(r.total * taux);
    r.status = 'annulee';
    r.updatedAt = new Date().toISOString();
    r.events.push({ type: 'annulee', at: r.updatedAt, note: `${raison ?? 'sans motif'} — frais ${frais} F (${Math.round(taux * 100)} %)` });
    this.repo?.put(r);
    this.signaler(r, 'annulation');
    return { reservation: r, frais, taux };
  }

  /** Indicateurs pour la console (session Location). */
  stats(): {
    total: number; parStatut: Record<string, number>; parFormule: Record<string, number>;
    chiffreAffaires: number; aVenir: number; tauxOccupation: number;
  } {
    const parStatut: Record<string, number> = {};
    const parFormule: Record<string, number> = {};
    let chiffreAffaires = 0;
    let aVenir = 0;
    let engages = 0;
    for (const r of this.items.values()) {
      parStatut[r.status] = (parStatut[r.status] ?? 0) + 1;
      parFormule[r.formula] = (parFormule[r.formula] ?? 0) + 1;
      if (r.status !== 'annulee') chiffreAffaires += r.total;
      if (STATUTS_BLOQUANTS.includes(r.status) && Date.parse(r.debut) > Date.now()) aVenir += 1;
      if (STATUTS_BLOQUANTS.includes(r.status)) engages += 1 + r.options.cortege;
    }
    const flotte = this.settings.catalogue().reduce((s, v) => s + v.exemplaires, 0);
    return {
      total: this.items.size, parStatut, parFormule, chiffreAffaires, aVenir,
      tauxOccupation: flotte > 0 ? Math.min(1, engages / flotte) : 0,
    };
  }
}
