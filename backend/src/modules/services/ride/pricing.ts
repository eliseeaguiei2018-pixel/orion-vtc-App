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
 * Paramètres de tarification PILOTABLES depuis la console Admin (centre de contrôle ORION).
 * Modifier ces valeurs (via /admin/pricing) change le prix de TOUTES les nouvelles courses,
 * sans redéploiement. C'est le levier « augmenter / réduire les prix ».
 */
export interface PricingSettings {
  baseFare: number; perKm: number; perMinute: number; minFare: number; avgSpeedKmh: number;
  tvaRate: number; feeRate: number; insuranceRate: number; trafficWeight: number; stopFee: number;
  multipliers: Record<Tier, number>;
  bodySurcharge: Record<string, number>;
}

export const DEFAULT_PRICING: PricingSettings = {
  baseFare: 300, perKm: 130, perMinute: 18, minFare: 600, avgSpeedKmh: 24,
  tvaRate: TVA_RATE, feeRate: APP_FEE_RATE, insuranceRate: INSURANCE_RATE, trafficWeight: 0.6, stopFee: 250,
  multipliers: {
    bronze: FLEET.bronze.multiplier, argent: FLEET.argent.multiplier,
    or: FLEET.or.multiplier, diamant: FLEET.diamant.multiplier,
  },
  bodySurcharge: { berline: 1.0, suv: 1.08 },
};

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

export const DEFAULT_TIER: Tier = 'bronze';

/** Construit le tarif d'un niveau à partir des paramètres pilotables × multiplicateur. */
export function tariffForTier(tier: Tier, s: PricingSettings = DEFAULT_PRICING): CategoryTariff {
  const m = s.multipliers[tier] ?? 1;
  return {
    category: tier,
    currency: 'XOF',
    baseFare: s.baseFare * m,
    perKm: s.perKm * m,
    perMinute: s.perMinute * m,
    minFare: s.minFare * m,
    avgSpeedKmh: s.avgSpeedKmh,
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
  /** Paramètres de prix pilotables (console Admin). Par défaut : DEFAULT_PRICING. */
  settings?: PricingSettings;
}

export function estimatePrice(req: EstimateRequest, ctx: PricingContext = {}): PriceResult {
  const s = ctx.settings ?? DEFAULT_PRICING;
  const category = req.category && isTier(req.category) ? req.category : DEFAULT_TIER;
  const tariff = tariffForTier(category, s);
  const bodyFactor = s.bodySurcharge[req.bodyType ?? 'berline'] ?? 1;
  const trafficFactor = Math.max(1, ctx.trafficFactor ?? 1);
  const discountRate = Math.min(1, Math.max(0, ctx.discountRate ?? 0));

  const stops = req.stops ?? [];
  const distanceMeters = routeDistanceMeters(req.origin, req.destination, stops);
  const distanceKm = distanceMeters / 1000;
  // ETA affichée : le trafic allonge la durée réelle (info au client, sans surfacturation).
  const etaSeconds = Math.round((distanceKm / tariff.avgSpeedKmh) * 3600 * trafficFactor);
  // Temps FACTURÉ : calculé à vitesse libre → on NE facture PAS le temps passé dans les
  // embouteillages. Le trafic n'agit que via un léger facteur intégré au prix fixe.
  const minutes = (distanceKm / tariff.avgSpeedKmh) * 60;

  const base = tariff.baseFare * bodyFactor;
  const distanceCost = distanceKm * tariff.perKm * bodyFactor;
  const timeCost = minutes * tariff.perMinute * bodyFactor;
  // Chaque arrêt intermédiaire ajoute un forfait d'attente.
  const stopsCost = stops.length * s.stopFee * (s.multipliers[category] ?? 1);

  // Trafic intégré (adouci) dans le prix — PAS de ligne « supplément » séparée.
  const trafficMult = 1 + (trafficFactor - 1) * s.trafficWeight;
  const raw = (base + distanceCost + timeCost + stopsCost) * trafficMult;
  const floored = Math.max(raw, tariff.minFare);
  const discount = floored * discountRate;

  const subtotal = floored - discount;
  const tva = subtotal * s.tvaRate;
  const fee = subtotal * s.feeRate;
  const insurance = req.insurance ? subtotal * s.insuranceRate : 0;
  // PRIX FIXE GARANTI : ce montant arrondi est exactement ce que le client paiera.
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
      surge: 1,
      traffic: 0, // trafic intégré au prix fixe (aucune surfacturation séparée)
      discount: Math.round(discount),
      subtotal: Math.round(subtotal),
      tva: Math.round(tva),
      fee: Math.round(fee),
      insurance: Math.round(insurance),
    },
  };
}
