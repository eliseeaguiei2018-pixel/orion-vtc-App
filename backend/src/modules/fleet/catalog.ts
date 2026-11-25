/**
 * Catalogue de la flotte ORION — source de vérité unique.
 *
 * TROIS gammes de course, de la plus accessible à la plus haut de gamme :
 *   Argent → Or → Diamant
 * (la gamme Bronze a été supprimée : sa grille tarifaire est devenue celle de l'Argent,
 * et ses véhicules ont rejoint la flotte Argent).
 *
 * PRIX : l'Argent est le prix de référence (grille et multiplicateur). L'Or coûte 5 % de
 * plus que l'Argent sur le même trajet, le Diamant 15 % de plus (`majorationPct`) : un écart
 * léger, proportionnel au prix de la course, qui a remplacé les suppléments fixes (trop
 * lourds sur les petites courses face à la concurrence). Il se règle depuis la console.
 * Chaque gamme a aussi son tarif de location mariage (à la journée).
 */
export type Tier = 'argent' | 'or' | 'diamant';

/** Les gammes, de la plus accessible à la plus haut de gamme. */
export const TIER_ORDER: readonly Tier[] = ['argent', 'or', 'diamant'];

export interface TierDefinition {
  tier: Tier;
  label: string;
  /** Multiplicateur appliqué au tarif de base (course). */
  multiplier: number;
  /** Majoration du prix par rapport à l'Argent, en pour cent ; nulle pour l'Argent, la référence. */
  majorationPct: number;
  capacity: number;
  /** ETA indicatif (min) — disponibilité moyenne. */
  eta: number;
  /** Modèles disponibles dans ce niveau. */
  cars: string[];
  /** Prix de location pour mariage, à la journée (FCFA). */
  weddingDayPrice: number;
  /** Accent couleur (charte). */
  accent: string;
}

/** Multiplicateur de la grille de référence (l'ancienne grille Bronze, devenue Argent). */
const GRILLE_REFERENCE = 0.9;

export const FLEET: Record<Tier, TierDefinition> = {
  argent: {
    tier: 'argent',
    label: 'Argent',
    multiplier: GRILLE_REFERENCE,
    majorationPct: 0,
    capacity: 4,
    eta: 3,
    cars: ['Geely Galaxy E8', 'Dongfeng 007', 'Changan Qiyuan A07', 'Deepal S07', 'AVATR 06'],
    weddingDayPrice: 60_000,
    accent: '#c8d2dc',
  },
  or: {
    tier: 'or',
    label: 'Or',
    multiplier: GRILLE_REFERENCE,
    majorationPct: 5,
    capacity: 4,
    eta: 4,
    cars: ['AVATR 11', 'AVATR 12', 'Xiaomi YU7', 'XPENG G9'],
    weddingDayPrice: 110_000,
    accent: '#f5c451',
  },
  diamant: {
    tier: 'diamant',
    label: 'Diamant',
    multiplier: GRILLE_REFERENCE,
    majorationPct: 15,
    capacity: 4,
    eta: 5,
    cars: ['XPENG GX 750 Ultra', 'Huawei Stelato S9', 'NIO ET9', 'NIO ES9', 'Zeekr 8X'],
    weddingDayPrice: 190_000,
    accent: '#7fe7ff',
  },
};

export const TIERS: Tier[] = ['argent', 'or', 'diamant'];

/**
 * Rang d'une gamme (Argent 0 < Or 1 < Diamant 2). Les données antérieures à la
 * suppression du Bronze (chauffeurs, courses archivées) sont lues comme de l'Argent.
 */
export const TIER_RANK: Record<string, number> = { bronze: 0, argent: 0, or: 1, diamant: 2 };

/** Gamme d'une donnée ancienne ou saisie : « bronze » devient « argent ». */
export function normaliserGamme(v: string | undefined | null): Tier {
  return v === 'or' || v === 'diamant' ? v : 'argent';
}

export const isTier = (v: string): v is Tier => (TIERS as string[]).includes(v);

/** Un véhicule attribué (marque) tiré de la flotte du niveau. */
export function pickCar(tier: Tier, seed = Math.random()): string {
  const cars = FLEET[tier].cars;
  return cars[Math.floor(seed * cars.length) % cars.length]!;
}
