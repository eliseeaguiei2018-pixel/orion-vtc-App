/**
 * Barème de LOCATION ORION — source de vérité unique des prix de location.
 *
 * Trois formules, un seul barème :
 *   • « evenement »        — mariages, cérémonies, baptêmes, anniversaires.
 *   • « entreprise »       — sociétés, institutions, ambassades, délégations (facture TVA).
 *     UNIQUEMENT en forfait mensuel, six mois minimum, renouvelable ou non.
 *   • « mise_a_disposition » — la COURSE sous forme de location : le client garde la
 *     voiture et son chauffeur pour N heures, ou privatise le véhicule toute la journée.
 *
 * Tout est exprimé par rapport au prix JOURNÉE du véhicule (voir fleet/prestige.ts),
 * chauffeur en tenue et recharge électrique inclus.
 */
export type RentalFormula = 'evenement' | 'entreprise' | 'mise_a_disposition';

/** Durées proposées. « heures » est la seule qui demande un nombre d'heures. */
export type RentalDuree = 'heures' | 'journee' | 'weekend' | 'semaine' | 'mois';

export const DUREES: RentalDuree[] = ['heures', 'journee', 'weekend', 'semaine', 'mois'];
export const isDuree = (v: string): v is RentalDuree => (DUREES as string[]).includes(v);

/**
 * Coefficient appliqué au prix journée. Les longues durées sont dégressives : une
 * semaine coûte 5,5 journées (et non 7), un mois 21 (et non 30, soit −30 %).
 */
export const COEF_DUREE: Record<Exclude<RentalDuree, 'heures'>, number> = {
  journee: 1,
  weekend: 1.8,
  semaine: 5.5,
  mois: 21,
};

/** Un mois de location = 30 jours d'immobilisation. */
export const JOURS_PAR_MOIS = 30;

/** Forfait mensuel : engagement minimal d'une entreprise, et plafond de tout contrat. */
export const MOIS_MIN_ENTREPRISE = 6;
export const MOIS_MAX = 36;

/**
 * Remises d'ENGAGEMENT du forfait mensuel, par rapport à 30 journées au tarif plein.
 * Le premier palier (1 à 2 mois) découle du coefficient « mois » ci-dessus (−30 %) ;
 * les suivants récompensent la durée du contrat.
 */
export const REMISE_ENGAGEMENT = { mois3: 0.35, mois6: 0.4, mois12: 0.45 } as const;

/** Barème minimal nécessaire au calcul de la remise mensuelle. */
export interface BaremeMensuel {
  coefs: { mois: number };
  remiseMois3: number;
  remiseMois6: number;
  remiseMois12: number;
}

/**
 * Remise appliquée à chaque mois d'un forfait de `mois` mois. Un palier long n'est
 * jamais moins avantageux qu'un palier court, même si la console les règle à l'envers.
 */
export function remiseMensuelle(t: BaremeMensuel, mois: number): number {
  const base = Math.min(0.9, Math.max(0, 1 - t.coefs.mois / JOURS_PAR_MOIS));
  const p3 = Math.max(base, t.remiseMois3);
  const p6 = Math.max(p3, t.remiseMois6);
  const p12 = Math.max(p6, t.remiseMois12);
  if (mois >= 12) return p12;
  if (mois >= 6) return p6;
  if (mois >= 3) return p3;
  return base;
}

/** Durées qu'une formule a le droit de vendre. */
export function dureesPermises(formula: RentalFormula): RentalDuree[] {
  return formula === 'entreprise' ? ['mois'] : DUREES;
}

/** Nombre de jours d'immobilisation du véhicule par durée (calcul de disponibilité). */
export const JOURS_DUREE: Record<Exclude<RentalDuree, 'heures'>, number> = {
  journee: 1,
  weekend: 2,
  semaine: 7,
  mois: 30,
};

/** Une journée de mise à disposition = 10 h de service du chauffeur. */
export const HEURES_PAR_JOURNEE = 10;

/** Location à l'heure : 17 % du prix journée par heure, 3 h minimum, 12 h maximum. */
export const RATIO_HEURE = 0.17;
export const MIN_HEURES = 3;
export const MAX_HEURES = 12;

/**
 * Coefficient horaire — PLAFONNÉ À 1. Au-delà de ~6 h, louer à l'heure coûterait plus
 * cher que la journée entière : le client ne doit jamais être pénalisé pour avoir
 * choisi l'heure, on lui applique au pire le tarif journée.
 */
export function coefHeures(heures: number): number {
  return Math.min(heures * RATIO_HEURE, 1);
}

/** Options facturables (prix en F CFA, par location sauf mention). */
export interface RentalOptions {
  /** Décoration florale + rubans (mariages, cérémonies). */
  decoration?: boolean;
  /** Tapis rouge à la descente du véhicule. */
  tapisRouge?: boolean;
  /** Véhicules SUPPLÉMENTAIRES du même modèle pour le cortège. */
  cortege?: number;
  /** Hôtesses d'accueil en tenue (par hôtesse). */
  hotesses?: number;
  /** Véhicule ouvreur + agent de sécurité (délégations, VIP). */
  escorte?: boolean;
  /** Plaque personnalisée (mariés, délégation, logo société). */
  plaque?: boolean;
  /** Kilométrage illimité (sinon 100 km/jour inclus, puis supplément au km). */
  kilometrageIllimite?: boolean;
  /** Second chauffeur de relais (obligatoire au-delà de 10 h de service). */
  secondChauffeur?: boolean;
  /** Rafraîchissements à bord (eau, jus, serviettes fraîches). */
  rafraichissements?: boolean;
}

export const FRAIS = {
  decoration: 20_000,
  tapisRouge: 15_000,
  /** Par hôtesse et par jour. */
  hotesse: 25_000,
  escorte: 60_000,
  plaque: 10_000,
  secondChauffeur: 20_000,
  rafraichissements: 10_000,
  /** Remise sur chaque véhicule supplémentaire du cortège. */
  remiseCortege: 0.15,
  /** Kilomètres inclus par jour de location. */
  kmInclusParJour: 100,
  /** Supplément au-delà du forfait kilométrique. */
  prixKmSupp: 300,
  /** Kilométrage illimité : majoration du poste véhicule. */
  majorationKmIllimite: 0.18,
  /**
   * MOBILISATION EXPRESS « jour J » : ORION garantit la mise à disposition en
   * quelques minutes le jour même. Cela mobilise une équipe (préparation, lavage,
   * chauffeur d'astreinte) — d'où une majoration transparente plutôt qu'un refus.
   */
  majorationJourJ: 0.12,
  /** Caution restituée à la restitution du véhicule (jamais ajoutée au total). */
  tauxCaution: 0.15,
} as const;

/** Délai de mise à disposition le jour même : 25 min à vide, 45 min flotte chargée. */
export const DELAI_EXPRESS_MIN = 25;
export const DELAI_EXPRESS_MAX = 45;

/** Barème d'annulation : plus c'est tardif, plus la flotte immobilisée est perdue. */
export const ANNULATION = [
  { avantHeures: 48, taux: 0 },
  { avantHeures: 24, taux: 0.5 },
  { avantHeures: 0, taux: 1 },
] as const;

/** Frais d'annulation dus pour une location commençant dans `heuresAvantDebut`. */
export function tauxAnnulation(heuresAvantDebut: number): number {
  for (const palier of ANNULATION) if (heuresAvantDebut >= palier.avantHeures) return palier.taux;
  return 1;
}

/** Libellés affichés dans l'app cliente et la console. */
export const LABEL_FORMULE: Record<RentalFormula, string> = {
  evenement: 'Événement & mariage',
  entreprise: 'Entreprise & institution — forfait mensuel',
  mise_a_disposition: 'Course en mise à disposition',
};

export const LABEL_DUREE: Record<RentalDuree, string> = {
  heures: 'À l’heure (3 h min.)',
  journee: 'Journée (10 h de service)',
  weekend: 'Week-end (2 jours)',
  semaine: 'Semaine (7 jours)',
  mois: 'Forfait mensuel (30 jours)',
};

export const LABEL_OPTION: Record<keyof RentalOptions, string> = {
  decoration: 'Décoration florale & rubans',
  tapisRouge: 'Tapis rouge',
  cortege: 'Véhicules de cortège (même modèle)',
  hotesses: 'Hôtesses d’accueil',
  escorte: 'Véhicule ouvreur & sécurité',
  plaque: 'Plaque personnalisée',
  kilometrageIllimite: 'Kilométrage illimité',
  secondChauffeur: 'Second chauffeur (relais)',
  rafraichissements: 'Rafraîchissements à bord',
};
