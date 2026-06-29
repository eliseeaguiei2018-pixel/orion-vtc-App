import { randomUUID } from 'node:crypto';
import { badRequest } from '../../core/errors.js';
import { FLEET, isTier, type Tier } from '../fleet/catalog.js';

/**
 * Location de voiture pour mariage. Le prix dépend du NIVEAU (qualité du véhicule), de la
 * durée et des options (décoration florale, cortège de véhicules, chauffeur en tenue).
 */
export type Duration = 'halfday' | 'fullday' | 'weekend';

const DURATION_FACTOR: Record<Duration, number> = { halfday: 0.6, fullday: 1, weekend: 1.8 };

export interface WeddingOptions {
  decoration?: boolean; // décoration florale + rubans
  convoy?: number; // nombre de véhicules supplémentaires pour le cortège
  chauffeur?: boolean; // chauffeur en tenue (inclus par défaut)
}

export const WEDDING_FEES = {
  decoration: 35_000,
  convoyPerCar: 40_000,
  chauffeur: 0, // inclus
};

export interface WeddingQuote {
  tier: Tier;
  car?: string;
  date: string;
  duration: Duration;
  options: Required<WeddingOptions>;
  breakdown: { vehicle: number; decoration: number; convoy: number };
  total: number;
  currency: 'XOF';
}

export interface WeddingReservation extends WeddingQuote {
  id: string;
  userId: string;
  status: 'quote' | 'reserved';
  createdAt: string;
}

export function quoteWedding(input: {
  tier: string;
  date: string;
  duration?: Duration;
  car?: string;
  options?: WeddingOptions;
}): WeddingQuote {
  if (!isTier(input.tier)) throw badRequest('Niveau de véhicule inconnu');
  const duration = input.duration ?? 'fullday';
  const def = FLEET[input.tier];
  const opts: Required<WeddingOptions> = {
    decoration: input.options?.decoration ?? false,
    convoy: Math.max(0, input.options?.convoy ?? 0),
    chauffeur: input.options?.chauffeur ?? true,
  };
  const vehicle = Math.round(def.weddingDayPrice * DURATION_FACTOR[duration]);
  const decoration = opts.decoration ? WEDDING_FEES.decoration : 0;
  const convoy = opts.convoy * WEDDING_FEES.convoyPerCar;
  const total = vehicle + decoration + convoy;
  return {
    tier: input.tier,
    car: input.car,
    date: input.date,
    duration,
    options: opts,
    breakdown: { vehicle, decoration, convoy },
    total,
    currency: 'XOF',
  };
}

export class WeddingService {
  private readonly reservations = new Map<string, WeddingReservation>();

  reserve(userId: string, q: WeddingQuote): WeddingReservation {
    const res: WeddingReservation = {
      ...q,
      id: randomUUID(),
      userId,
      status: 'reserved',
      createdAt: new Date().toISOString(),
    };
    this.reservations.set(res.id, res);
    return res;
  }

  listByUser(userId: string): WeddingReservation[] {
    return [...this.reservations.values()].filter((r) => r.userId === userId);
  }
}
