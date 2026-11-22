import type { EstimateRequest, QuoteBreakdown, TrafficLevel } from '../types.js';
import { haversineMeters, type LatLng } from '../../../core/geo.js';
import { FLEET, TIER_ORDER, isTier, type EcartGamme, type Tier } from '../../fleet/catalog.js';

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
  /**
   * Écart TTC de chaque gamme avec la gamme PRÉCÉDENTE, en F CFA : Or = Argent + 100 à 200,
   * Diamant = Or + 500 à 1 000. Le minimum vaut pour un trajet court, le maximum pour un
   * trajet long (`ecartKm`) ; entre les deux, l'écart monte avec la distance.
   */
  ecarts: Record<Tier, EcartGamme>;
  /** Distances (km) du trajet « court » et du trajet « long » qui bornent ces écarts. */
  ecartKm: { court: number; long: number };
  bodySurcharge: Record<string, number>;
  /* --- Frais annexes & pénalités (session Tarification S16) --- */
  /** Minutes d'attente offertes à l'arrivée du chauffeur (courtoisie). */
  freeWaitMinutes: number;
  /** Délai d'annulation gratuite après la commande (minutes). */
  cancelGraceMinutes: number;
  /** Frais d'annulation appliqués au-delà du délai de grâce (F CFA). */
  cancelFee: number;
  /** Barème de nettoyage : salissure légère / majeure (F CFA). */
  cleaningLight: number;
  cleaningMajor: number;
  /** Prime « prise en charge longue » : F CFA par km d'approche à vide au-delà du seuil. */
  longPickupPerKm: number;
  longPickupThresholdKm: number;
}

export const DEFAULT_PRICING: PricingSettings = {
  baseFare: 300, perKm: 130, perMinute: 18, minFare: 600, avgSpeedKmh: 24,
  tvaRate: TVA_RATE, feeRate: APP_FEE_RATE, insuranceRate: INSURANCE_RATE, trafficWeight: 0.6, stopFee: 250,
  multipliers: { argent: FLEET.argent.multiplier, or: FLEET.or.multiplier, diamant: FLEET.diamant.multiplier },
  ecarts: { argent: { ...FLEET.argent.ecart }, or: { ...FLEET.or.ecart }, diamant: { ...FLEET.diamant.ecart } },
  ecartKm: { court: 2, long: 20 },
  bodySurcharge: { berline: 1.0, suv: 1.08 },
  freeWaitMinutes: 5, cancelGraceMinutes: 2, cancelFee: 500,
  cleaningLight: 10_000, cleaningMajor: 50_000,
  longPickupPerKm: 100, longPickupThresholdKm: 5,
};

/**
 * Stratégie de tarification (pattern Strategy) : chaque service injecte la sienne.
 * Pour le VTC : base + distance + temps, selon la GAMME choisie (Argent, Or, Diamant),
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

export const DEFAULT_TIER: Tier = 'argent';

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

/** Distance à vol d'oiseau d'un trajet origine → arrêts → destination (mètres). */
function routeDistanceMeters(origin: LatLng, destination: LatLng, stops: LatLng[]): number {
  const pts = [origin, ...stops, destination];
  let total = 0;
  for (let i = 1; i < pts.length; i++) total += haversineMeters(pts[i - 1]!, pts[i]!);
  return total;
}

/**
 * Sans itinéraire calculé, la route est estimée à 1,3 fois le vol d'oiseau : le même facteur
 * que le tracé de repli du module de routage et que l'application hors connexion.
 */
export const SINUOSITE = 1.3;

/**
 * DISTANCE FACTURÉE : celle du trajet par la route. Une course se paie sur ce que la voiture
 * roule (routes, ponts de la lagune, sens de circulation), pas sur la ligne droite entre le
 * départ et l'arrivée — à Abidjan l'écart atteint souvent la moitié. `routeMeters` vient du
 * calcul d'itinéraire ; il est écarté s'il est plus court que la ligne droite ou démesuré.
 */
export function distanceFacturee(origin: LatLng, destination: LatLng, stops: LatLng[], routeMeters?: number): number {
  const vol = routeDistanceMeters(origin, destination, stops);
  const plausible = routeMeters !== undefined && Number.isFinite(routeMeters) && routeMeters >= vol * 0.98 && routeMeters <= vol * 6 + 3000;
  return plausible ? routeMeters! : vol * SINUOSITE;
}

/** Le FCFA n'a pas de centimes : on arrondit au multiple de 50 le plus proche. */
const roundFcfa = (n: number) => Math.round(n / 50) * 50;

/**
 * Supplément TTC d'une gamme par rapport à l'Argent, pour un trajet de `distanceKm`.
 * Chaque gamme ajoute son écart à celui de la gamme précédente ; l'écart va de son minimum
 * (trajet court) à son maximum (trajet long), par pas de 50 F comme tous les prix.
 * L'application en garde une copie exacte (frontend/src/tarifServeur.ts).
 */
export function supplementGamme(category: Tier, distanceKm: number, s: Pick<PricingSettings, 'ecarts' | 'ecartKm'> = DEFAULT_PRICING): number {
  const { court, long } = s.ecartKm;
  const part = long > court ? Math.min(1, Math.max(0, (distanceKm - court) / (long - court))) : distanceKm >= long ? 1 : 0;
  let total = 0;
  for (const gamme of TIER_ORDER) {
    const e = s.ecarts[gamme];
    if (e) {
      const min = Math.max(0, e.min);
      total += roundFcfa(min + (Math.max(min, e.max) - min) * part);
    }
    if (gamme === category) break;
  }
  return total;
}

export interface PricingContext {
  /** Coefficient multiplicateur de demande (1 = normal). Fourni par la tarification dynamique. */
  surgeMultiplier?: number;
  /** Facteur de trafic (≥ 1) issu de la détection d'embouteillages. */
  trafficFactor?: number;
  /** Niveau de trafic affiché (fluid/dense/jam). */
  trafficLevel?: TrafficLevel;
  /** Remise relative issue d'un code promo (0..1). */
  discountRate?: number;
  /** Remise FCFA calculée depuis un code promo (prioritaire), en fonction du sous-total. */
  promoDiscount?: (subtotal: number) => number;
  /** Paramètres de prix pilotables (console Admin). Par défaut : DEFAULT_PRICING. */
  settings?: PricingSettings;
  /** Distance du trajet par la route (calcul d'itinéraire), en mètres. Absente : estimation 1,3 × vol d'oiseau. */
  routeMeters?: number;
  /** Facteur de zone (commune de prise en charge) intégré au prix fixe. 1 = neutre. */
  zoneFactor?: number;
  /** Frais de prise en charge du micro-secteur (F CFA), intégrés au prix fixe. */
  zonePickupFee?: number;
  /** Forfait plat (aéroport / hub A→B) : remplace la tarification au km/min. */
  flatAmount?: number;
  /** Supplément fixe ajouté au devis (retour à vide zone périphérique). */
  extraFee?: number;
  /** Prix plancher majoré du secteur premium (remplace minFare s'il est supérieur). */
  premiumFloor?: number;
}

export function estimatePrice(req: EstimateRequest, ctx: PricingContext = {}): PriceResult {
  const s = ctx.settings ?? DEFAULT_PRICING;
  const category = req.category && isTier(req.category) ? req.category : DEFAULT_TIER;
  const tariff = tariffForTier(category, s);
  const bodyFactor = s.bodySurcharge[req.bodyType ?? 'berline'] ?? 1;
  const trafficFactor = Math.max(1, ctx.trafficFactor ?? 1);
  const discountRate = Math.min(1, Math.max(0, ctx.discountRate ?? 0));

  const stops = req.stops ?? [];
  const distanceMeters = distanceFacturee(req.origin, req.destination, stops, ctx.routeMeters);
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
  // Facteur de zone (commune de départ) intégré au prix fixe — levier ops par quartier.
  const zoneFactor = Math.max(0.1, ctx.zoneFactor ?? 1);
  // Surge encadré (demande > offre) — appliqué AVANT le verrouillage : le devis
  // affiché reste un PRIX FIXE garanti. Plafonné sur la flotte verte (console).
  const surge = Math.max(1, ctx.surgeMultiplier ?? 1);
  // Frais de prise en charge du micro-secteur (Riviera Golf, Zone 4…) : forfait
  // ajouté APRÈS les multiplicateurs — montant net, lisible, intégré au prix fixe.
  const pickupFee = Math.max(0, ctx.zonePickupFee ?? 0);
  const extraFee = Math.max(0, ctx.extraFee ?? 0); // retour à vide (zone périphérique)
  // Forfait plat (hub aéroport / A→B) : remplace le calcul au km/min mais garde
  // le surge/zone et les suppléments intégrés au prix fixe garanti.
  const metered = (base + distanceCost + timeCost + stopsCost) * trafficMult * zoneFactor * surge + pickupFee;
  const raw = (ctx.flatAmount && ctx.flatAmount > 0 ? ctx.flatAmount * surge : metered) + extraFee;
  // Prix plancher : minFare, ou plancher premium majoré du secteur s'il est plus élevé.
  const floored = Math.max(raw, tariff.minFare, ctx.premiumFloor ?? 0);
  // Remise : code promo (montant calculé) prioritaire, sinon taux de remise éventuel.
  const promo = ctx.promoDiscount ? ctx.promoDiscount(floored) : 0;
  const discount = Math.min(floored, promo > 0 ? promo : floored * discountRate);

  // Supplément de gamme (Or, Diamant) : un écart TTC par rapport à l'Argent, qui monte avec
  // la distance entre ses deux bornes. Il est ajouté après l'arrondi du prix Argent pour que
  // l'écart affiché soit exact, puis réparti hors taxes dans le détail (sous-total, TVA,
  // frais, assurance) qui reste juste.
  const supplementTtc = supplementGamme(category, distanceKm, s);
  const tauxTtc = 1 + s.tvaRate + s.feeRate + (req.insurance ? s.insuranceRate : 0);
  const sansSupplement = floored - discount;
  const montantArgent = roundFcfa(sansSupplement * tauxTtc);
  const amount = montantArgent + supplementTtc;
  const subtotal = amount / tauxTtc;
  const tva = subtotal * s.tvaRate;
  const fee = subtotal * s.feeRate;
  const insurance = req.insurance ? subtotal * s.insuranceRate : 0;
  // PRIX FIXE GARANTI : `amount` est exactement ce que le client paiera.

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
      surge,
      traffic: 0, // trafic intégré au prix fixe (aucune surfacturation séparée)
      discount: Math.round(discount),
      subtotal: Math.round(subtotal),
      tva: Math.round(tva),
      fee: Math.round(fee),
      insurance: Math.round(insurance),
    },
  };
}
