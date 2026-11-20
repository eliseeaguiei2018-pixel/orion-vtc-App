/**
 * Catalogue de la flotte ORION — source de vérité unique.
 *
 * Les niveaux de course (du plus accessible au plus haut de gamme) :
 *   Bronze → Argent → Or → Diamant
 * Chaque niveau a un multiplicateur tarifaire et une flotte de véhicules (100% électriques),
 * ainsi qu'un tarif de location pour mariage (à la journée).
 */
export type Tier = 'bronze' | 'argent' | 'or' | 'diamant';

export interface TierDefinition {
  tier: Tier;
  label: string;
  /** Multiplicateur appliqué au tarif de base (course). */
  multiplier: number;
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

export const FLEET: Record<Tier, TierDefinition> = {
  bronze: {
    tier: 'bronze',
    label: 'Bronze',
    multiplier: 0.9,
    capacity: 4,
    eta: 3,
    cars: ['Geely Galaxy E8', 'Dongfeng 007', 'Changan Qiyuan A07'],
    weddingDayPrice: 60_000,
    accent: '#cd7f4d',
  },
  argent: {
    tier: 'argent',
    label: 'Argent',
    multiplier: 1.25,
    capacity: 4,
    eta: 4,
    cars: ['Deepal S07', 'AVATR 06', 'AVATR 11'],
    weddingDayPrice: 110_000,
    accent: '#c8d2dc',
  },
  or: {
    tier: 'or',
    label: 'Or',
    multiplier: 1.7,
    capacity: 4,
    eta: 5,
    cars: ['AVATR 12', 'Xiaomi YU7', 'XPENG G9', 'XPENG GX 750 Ultra'],
    weddingDayPrice: 190_000,
    accent: '#f5c451',
  },
  diamant: {
    tier: 'diamant',
    label: 'Diamant',
    multiplier: 2.3,
    capacity: 4,
    eta: 6,
    cars: ['Huawei Stelato S9', 'NIO ET9', 'NIO ES9', 'Zeekr 8X'],
    weddingDayPrice: 320_000,
    accent: '#7fe7ff',
  },
};

export const TIERS: Tier[] = ['bronze', 'argent', 'or', 'diamant'];

export const isTier = (v: string): v is Tier => (TIERS as string[]).includes(v);

/** Un véhicule attribué (marque) tiré de la flotte du niveau. */
export function pickCar(tier: Tier, seed = Math.random()): string {
  const cars = FLEET[tier].cars;
  return cars[Math.floor(seed * cars.length) % cars.length]!;
}
