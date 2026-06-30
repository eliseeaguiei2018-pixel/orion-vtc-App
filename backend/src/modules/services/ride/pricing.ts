import type { EstimateRequest, QuoteBreakdown, TrafficLevel } from '../types.js';
import { haversineMeters, type LatLng } from '../../../core/geo.js';
import { FLEET, isTier, type Tier } from '../../fleet/catalog.js';

/** Taxes & frais appliqués à chaque course (transparence). */
export const TVA_RATE = 0.05; // TVA État de Côte d'Ivoire
export const APP_FEE_RATE = 0.1; // Frais de service ORION
export const INSURANCE_RATE = 0.02; // ORION Assurance (optionnelle)
/** Supplément carrosserie : un SUV coûte un peu plus qu'une berline. */
export const BODY_SURCHARGE: Record<string, number> = { berline: 1.0, suv: 1.08 };

/**
 * Stratégie de tarification (pattern Strategy) : chaque service injecte la sienne.
 * Pour le VTC : base + distance + temps, modulé par le NIVEAU choisi (Bronze→Diamant),
 * un coefficient de surge (zone/heure), puis remise éventuelle. Le détail (breakdown) est
 * renvoyé pour la TRANSPARENCE des prix.
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

/** Tarif de base FCFA (Abidjan), modulé ensuite par le multiplicateur du niveau. */
const BASE_TARIFF = { baseFare: 500, perKm: 250, perMinute: 35, minFare: 1000, avgSpeedKmh: 22 };

export const DEFAULT_TIER: Tier = 'bronze';

/** Construit le tarif d'un niveau à partir du tarif de base × multiplicateur. */
export function tariffForTier(tier: Tier): CategoryTariff {
  const m = FLEET[tier].multiplier;
  return {
    category: tier,
    currency: 'XOF',
    baseFare: BASE_TARIFF.baseFare * m,
    perKm: BASE_TARIFF.perKm * m,
    perMinute: BASE_TARIFF.perMinute * m,
    minFare: BASE_TARIFF.minFare * m,
    avgSpeedKmh: BASE_TARIFF.avgSpeedKmh,
  };
}

export interface PriceResult {
  category: string;
  currency: string;
  amount: number;
  distanceMeters: number;
  etaSeconds: number;
  trafficLevel: TrafficLevel;
  breakdown: QuoteBreakdown;
}

/** Distance totale d'un trajet origine → arrêts → destination (mètres). */
function routeDistanceMeters(origin: LatLng, destination: LatLng, stops: LatLng[]): number {
  const pts = [origin, ...stops, destination];
  let total = 0;
  for (let i = 1; i < pts.length; i++) total += haversineMeters(pts[i - 1]!, pts[i]!);
  return total;
}

const round2 = (n: number) => Math.round(n * 100) / 100;
/** Le FCFA n'a pas de centimes : on arrondit au multiple de 50 le plus proche. */
const roundFcfa = (n: number) => Math.round(n / 50) * 50;

export interface PricingContext {
  /** Coefficient multiplicateur de demande (1 = normal). Fourni par la tarification dynamique. */
  surgeMultiplier?: number;
  /** Facteur de trafic (≥ 1) issu de la détection d'embouteillages. */
  trafficFactor?: number;
  /** Niveau de trafic affiché (fluid/dense/jam). */
  trafficLevel?: TrafficLevel;
  /** Remise relative issue d'un code promo (0..1). */
  discountRate?: number;
}

export function estimatePrice(req: EstimateRequest, ctx: PricingContext = {}): PriceResult {
  const category = req.category && isTier(req.category) ? req.category : DEFAULT_TIER;
  const tariff = tariffForTier(category);
  const bodyFactor = BODY_SURCHARGE[req.bodyType ?? 'berline'] ?? 1;
  const surge = Math.max(1, ctx.surgeMultiplier ?? 1);
  const trafficFactor = Math.max(1, ctx.trafficFactor ?? 1);
  const discountRate = Math.min(1, Math.max(0, ctx.discountRate ?? 0));

  const stops = req.stops ?? [];
  const distanceMeters = routeDistanceMeters(req.origin, req.destination, stops);
  const distanceKm = distanceMeters / 1000;
  // Le trafic allonge le temps de trajet → ETA majoré.
  const etaSeconds = Math.round((distanceKm / tariff.avgSpeedKmh) * 3600 * trafficFactor);
  const minutes = (distanceKm / tariff.avgSpeedKmh) * 60;

  const base = tariff.baseFare * bodyFactor;
  const distanceCost = distanceKm * tariff.perKm * bodyFactor;
  const timeCost = minutes * tariff.perMinute * bodyFactor;
  // Chaque arrêt intermédiaire ajoute un forfait d'attente.
  const stopsCost = stops.length * 300 * FLEET[category].multiplier;

  const afterSurge = (base + distanceCost + timeCost + stopsCost) * surge;
  const floored = Math.max(afterSurge, tariff.minFare);
  const trafficSurcharge = floored * (trafficFactor - 1);
  const discount = (floored + trafficSurcharge) * discountRate;

  const subtotal = floored + trafficSurcharge - discount;
  const tva = subtotal * TVA_RATE;
  const fee = subtotal * APP_FEE_RATE;
  const insurance = req.insurance ? subtotal * INSURANCE_RATE : 0;
  const amount = roundFcfa(subtotal + tva + fee + insurance);

  return {
    category,
    currency: tariff.currency,
    amount,
    distanceMeters: Math.round(distanceMeters),
    etaSeconds,
    trafficLevel: ctx.trafficLevel ?? 'fluid',
    breakdown: {
      base: Math.round(base + stopsCost),
      distance: Math.round(distanceCost),
      time: Math.round(timeCost),
      surge: round2(surge),
      traffic: Math.round(trafficSurcharge),
      discount: Math.round(discount),
      subtotal: Math.round(subtotal),
      tva: Math.round(tva),
      fee: Math.round(fee),
      insurance: Math.round(insurance),
    },
  };
}
