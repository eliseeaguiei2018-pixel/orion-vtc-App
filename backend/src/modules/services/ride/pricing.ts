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

export const DEFAULT_TARIFFS: Record<string, CategoryTariff> = {
  green: { category: 'green', currency: 'EUR', baseFare: 2.0, perKm: 1.1, perMinute: 0.3, minFare: 5, avgSpeedKmh: 28 },
  comfort: { category: 'comfort', currency: 'EUR', baseFare: 3.0, perKm: 1.5, perMinute: 0.4, minFare: 7, avgSpeedKmh: 28 },
  van: { category: 'van', currency: 'EUR', baseFare: 5.0, perKm: 2.0, perMinute: 0.5, minFare: 10, avgSpeedKmh: 26 },
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
  const amount = round2(beforeDiscount - discount);

  return {
    category,
    currency: tariff.currency,
    amount,
    distanceMeters: Math.round(distanceMeters),
    etaSeconds,
    breakdown: {
      base: round2(base),
      distance: round2(distanceCost),
      time: round2(timeCost),
      surge: round2(surge),
      discount: round2(discount),
    },
  };
}
