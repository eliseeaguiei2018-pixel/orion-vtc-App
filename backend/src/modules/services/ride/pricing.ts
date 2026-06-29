import type { EstimateRequest, QuoteBreakdown } from '../types.js';
import { haversineMeters } from '../../../core/geo.js';

/**
 * Stratégie de tarification (pattern Strategy) : chaque service injecte la sienne.
 * Pour le VTC : base + distance + temps, modulé par un coefficient de surge (zone/heure),
 * puis remise éventuelle. Le détail (breakdown) est renvoyé pour la TRANSPARENCE des prix.
 */
export interface CategoryTariff {
  category: string;
  currency: string;
  baseFare: number;
  perKm: number;
  perMinute: number;
  minFare: number;
  /** Vitesse moyenne urbaine présumée (km/h) pour estimer le temps. */
  avgSpeedKmh: number;
}

/**
 * Tarifs en FCFA (XOF) calibrés pour le marché ivoirien (Abidjan).
 * Vitesse moyenne abaissée (22 km/h) pour refléter le trafic abidjanais.
 */
export const DEFAULT_TARIFFS: Record<string, CategoryTariff> = {
  eco: { category: 'eco', currency: 'XOF', baseFare: 500, perKm: 250, perMinute: 35, minFare: 1000, avgSpeedKmh: 22 },
  green: { category: 'green', currency: 'XOF', baseFare: 600, perKm: 280, perMinute: 40, minFare: 1200, avgSpeedKmh: 22 },
  comfort: { category: 'comfort', currency: 'XOF', baseFare: 900, perKm: 380, perMinute: 55, minFare: 1800, avgSpeedKmh: 22 },
  van: { category: 'van', currency: 'XOF', baseFare: 1300, perKm: 520, perMinute: 75, minFare: 3000, avgSpeedKmh: 20 },
};

export interface PriceResult {
  category: string;
  currency: string;
  amount: number;
  distanceMeters: number;
  etaSeconds: number;
  breakdown: QuoteBreakdown;
}

const round2 = (n: number) => Math.round(n * 100) / 100;
/** Le FCFA n'a pas de centimes : on arrondit au multiple de 50 le plus proche. */
const roundFcfa = (n: number) => Math.round(n / 50) * 50;

export interface PricingContext {
  /** Coefficient multiplicateur de demande (1 = normal). Fourni par la tarification dynamique. */
  surgeMultiplier?: number;
  /** Remise relative issue d'un code promo (0..1). */
  discountRate?: number;
}

export function estimatePrice(
  req: EstimateRequest,
  ctx: PricingContext = {},
): PriceResult {
  const category = req.category ?? 'green';
  const tariff = DEFAULT_TARIFFS[category] ?? DEFAULT_TARIFFS.green!;
  const surge = Math.max(1, ctx.surgeMultiplier ?? 1);
  const discountRate = Math.min(1, Math.max(0, ctx.discountRate ?? 0));

  const distanceMeters = haversineMeters(req.origin, req.destination);
  const distanceKm = distanceMeters / 1000;
  const etaSeconds = Math.round((distanceKm / tariff.avgSpeedKmh) * 3600);
  const minutes = etaSeconds / 60;

  const base = tariff.baseFare;
  const distanceCost = distanceKm * tariff.perKm;
  const timeCost = minutes * tariff.perMinute;
  const subtotal = (base + distanceCost + timeCost) * surge;
  const beforeDiscount = Math.max(subtotal, tariff.minFare);
  const discount = beforeDiscount * discountRate;
  const amount = roundFcfa(beforeDiscount - discount);

  return {
    category,
    currency: tariff.currency,
    amount,
    distanceMeters: Math.round(distanceMeters),
    etaSeconds,
    breakdown: {
      base: Math.round(base),
      distance: Math.round(distanceCost),
      time: Math.round(timeCost),
      surge: round2(surge),
      discount: Math.round(discount),
    },
  };
}
