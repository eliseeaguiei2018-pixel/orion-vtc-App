import type { EstimateRequest, QuoteBreakdown, TrafficLevel } from '../types.js';
import { haversineMeters, type LatLng } from '../../../core/geo.js';
import { FLEET, TIER_ORDER, isTier, type Tier } from '../../fleet/catalog.js';
import { PEAGES, dansDistrictAbidjan, sortDAbidjan, type Peage } from '../../geo-ci/abidjan.js';

/** Taxes & frais appliqués à chaque course (transparence). */
export const TVA_RATE = 0.05; // TVA État de Côte d'Ivoire
export const APP_FEE_RATE = 0.1; // Frais de service ORION
export const INSURANCE_RATE = 0.04; // ORION Assurance (optionnelle) : 4 % depuis la version 1.6
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
   * Majoration de chaque gamme par rapport à l'Argent, en POUR CENT du prix de la course :
   * Or + 5 %, Diamant + 15 %. Proportionnelle, donc légère sur une petite course.
   */
  majorationsPct: Record<Tier, number>;
  /**
   * Même majoration quand la course SORT du district d'Abidjan (départ, arrêt ou arrivée hors
   * des 13 communes) : l'écart entre gammes passe à 10 % — Or + 10 %, Diamant + 20 %.
   */
  majorationsPctHorsAbidjan: Record<Tier, number>;
  /** Postes de péage (montant véhicule léger) : ajoutés au prix quand l'itinéraire choisi les franchit. */
  peages: Peage[];
  /**
   * Mise à disposition à l'heure (courses VTC, Abidjan seulement) : le chauffeur reste avec le
   * client le temps choisi. `tarifHeure` : prix TTC d'une heure en Argent (les gammes suivent
   * la grille d'Abidjan) ; durée entre `minHeures` et `maxHeures`.
   */
  miseADisposition: { tarifHeure: number; minHeures: number; maxHeures: number };
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
  /**
   * APPROCHE DU CHAUFFEUR dans le prix (comme Yango) : le trajet du chauffeur libre le plus
   * proche jusqu'au client est offert jusqu'à `offerteKm` et `offerteMin` ; au-delà, chaque
   * kilomètre et chaque minute d'approche s'ajoutent au prix fixe (hors taxes).
   */
  approche: ApprocheTarif;
  /**
   * AJUSTEMENT GÉNÉRAL DES PRIX décidé par la direction (Mon poste du PDG), en % : +10 monte
   * toutes les courses de 10 %, −5 les baisse de 5 %. Appliqué au prix TTC de l'Argent, AVANT
   * les majorations de gamme : Or et Diamant gardent leur écart de la grille (+5 %, +15 %).
   * Péages non concernés (reversés tels quels).
   */
  ajustementPct: number;
  /** Qui a réglé l'ajustement, et quand (affiché dans Mon poste). */
  ajustementModifie?: { le: string; par: string };
}

export const AJUSTEMENT_MIN = -50;
export const AJUSTEMENT_MAX = 100;
/** Coefficient de l'ajustement de la direction (borné, 1 = aucun). */
export function coefAjustement(s: Pick<PricingSettings, 'ajustementPct'>): number {
  const p = Number.isFinite(s.ajustementPct) ? s.ajustementPct : 0;
  return 1 + Math.min(AJUSTEMENT_MAX, Math.max(AJUSTEMENT_MIN, p)) / 100;
}

export interface ApprocheTarif { actif: boolean; offerteKm: number; offerteMin: number; parKm: number; parMin: number }

/**
 * GRILLE ORION : environ 40 % moins chère que Yango à Abidjan. La flotte ORION est 100 %
 * électrique : pas de carburant (environ 15 F d'énergie au km contre 60 F d'essence), donc
 * pas de hausse liée aux prix à la pompe, et pas de commission de 18 à 25 % prélevée sur le
 * chauffeur. Repère (estimations publiques de Yango Standard : 500 F + 250 F/km, minimum
 * 1 000 F) : l'Argent coûte environ 40 % de moins ; l'Or (+5 %) et le Diamant (+15 %) suivent
 * la grille au-dessus de l'Argent. Hors taxes, avant le coefficient de gamme de 0,9. Le tout se
 * règle depuis la console (Tarification, Mon poste du PDG) : effet immédiat sur toutes les apps.
 */
export const DEFAULT_PRICING: PricingSettings = {
  baseFare: 300, perKm: 100, perMinute: 15, minFare: 600, avgSpeedKmh: 24,
  tvaRate: TVA_RATE, feeRate: APP_FEE_RATE, insuranceRate: INSURANCE_RATE, trafficWeight: 0.6, stopFee: 250,
  multipliers: { argent: FLEET.argent.multiplier, or: FLEET.or.multiplier, diamant: FLEET.diamant.multiplier },
  majorationsPct: { argent: FLEET.argent.majorationPct, or: FLEET.or.majorationPct, diamant: FLEET.diamant.majorationPct },
  majorationsPctHorsAbidjan: { argent: 0, or: 10, diamant: 20 },
  peages: PEAGES.map((p) => ({ ...p })),
  miseADisposition: { tarifHeure: 5000, minHeures: 2, maxHeures: 12 },
  bodySurcharge: { berline: 1.0, suv: 1.08 },
  freeWaitMinutes: 5, cancelGraceMinutes: 2, cancelFee: 500,
  cleaningLight: 10_000, cleaningMajor: 50_000,
  longPickupPerKm: 100, longPickupThresholdKm: 5,
  approche: { actif: true, offerteKm: 2, offerteMin: 5, parKm: 100, parMin: 18 },
  ajustementPct: 0,
};

/** Coût hors taxes de l'approche (0 tant qu'elle reste dans la part offerte). */
export function coutApproche(a: { km: number; minutes: number } | null | undefined, s: PricingSettings = DEFAULT_PRICING): number {
  const r = s.approche ?? DEFAULT_PRICING.approche;
  if (!a || !r.actif) return 0;
  return Math.max(0, a.km - r.offerteKm) * r.parKm + Math.max(0, a.minutes - r.offerteMin) * r.parMin;
}

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
 * Supplément TTC d'une gamme sur un trajet dont l'Argent coûte `montantArgent` (déjà arrondi) :
 * le pourcentage de la gamme, arrondi à 50 F comme tous les prix. Deux gammes ne tombent
 * jamais au même prix : chacune coûte au moins 50 F de plus que celle qu'elle dépasse, même
 * sur la plus petite course. Une course gratuite (code promo) le reste dans toutes les gammes.
 * L'application en garde une copie exacte (frontend/src/tarifServeur.ts).
 */
export function supplementGamme(
  category: Tier, montantArgent: number,
  s: Pick<PricingSettings, 'majorationsPct'> & Partial<Pick<PricingSettings, 'majorationsPctHorsAbidjan'>> = DEFAULT_PRICING,
  horsAbidjan = false,
): number {
  if (montantArgent <= 0) return 0;
  const grille = horsAbidjan ? (s.majorationsPctHorsAbidjan ?? DEFAULT_PRICING.majorationsPctHorsAbidjan) : s.majorationsPct;
  let supplement = 0, pctPrecedent = 0;
  for (const gamme of TIER_ORDER) {
    const pct = Math.max(0, grille?.[gamme] ?? 0);
    const calcule = roundFcfa((montantArgent * pct) / 100);
    supplement = pct > pctPrecedent ? Math.max(calcule, supplement + 50) : calcule;
    pctPrecedent = pct;
    if (gamme === category) break;
  }
  return supplement;
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
  /** Approche du chauffeur libre le plus proche de la gamme (null : aucun en ligne). */
  approche?: { km: number; minutes: number } | null;
}

/** Nombre d'heures de mise à disposition, ramené dans les bornes de la console (par demi-heure). */
export function heuresMiseADisposition(heures: number, s: PricingSettings = DEFAULT_PRICING): number {
  const m = s.miseADisposition ?? DEFAULT_PRICING.miseADisposition;
  const h = Number.isFinite(heures) ? Math.round(heures * 2) / 2 : m.minHeures;
  return Math.min(m.maxHeures, Math.max(m.minHeures, h));
}

/** Péages de l'itinéraire choisi : ceux que la console connaît, aucun sur la voie normale. */
export function peagesRetenus(req: Pick<EstimateRequest, 'itineraire' | 'peages'>, s: PricingSettings = DEFAULT_PRICING): Peage[] {
  if (req.itineraire === 'normal' || !req.peages?.length) return [];
  const liste = s.peages ?? DEFAULT_PRICING.peages;
  return liste.filter((p) => req.peages!.includes(p.id));
}

/**
 * MISE À DISPOSITION À L'HEURE (Abidjan) : le chauffeur reste avec le client le temps choisi.
 * Prix = heures × tarif horaire TTC de l'Argent, puis la majoration de la gamme (grille
 * d'Abidjan) ; ORION Assurance s'ajoute comme sur une course.
 */
function estimateMiseADisposition(req: EstimateRequest, s: PricingSettings, category: Tier): PriceResult {
  const heures = heuresMiseADisposition(req.miseADisposition!.heures, s);
  const tauxSansAssurance = 1 + s.tvaRate + s.feeRate;
  const tauxTtc = tauxSansAssurance + (req.insurance ? s.insuranceRate : 0);
  const horsTaxes = (heures * (s.miseADisposition ?? DEFAULT_PRICING.miseADisposition).tarifHeure) / tauxSansAssurance;
  const montantArgent = roundFcfa(horsTaxes * tauxTtc * coefAjustement(s));
  const amount = montantArgent + supplementGamme(category, montantArgent, s, false);
  const subtotal = amount / tauxTtc;
  return {
    category, currency: 'XOF', amount, distanceMeters: 0, etaSeconds: Math.round(heures * 3600), trafficLevel: 'fluid',
    breakdown: {
      base: Math.round(subtotal), distance: 0, time: 0, surge: 1, traffic: 0, discount: 0, subtotal: Math.round(subtotal),
      tva: Math.round(subtotal * s.tvaRate), fee: Math.round(subtotal * s.feeRate),
      insurance: req.insurance ? Math.round(subtotal * s.insuranceRate) : 0, heures,
    },
  };
}

export function estimatePrice(req: EstimateRequest, ctx: PricingContext = {}): PriceResult {
  const s = ctx.settings ?? DEFAULT_PRICING;
  const category = req.category && isTier(req.category) ? req.category : DEFAULT_TIER;
  if (req.miseADisposition) {
    if (!dansDistrictAbidjan(req.origin)) throw new Error('MISE_A_DISPOSITION_HORS_ABIDJAN');
    return estimateMiseADisposition(req, s, category);
  }
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
  // Approche du chauffeur le plus proche : offerte jusqu'au seuil, puis au km et à la minute.
  const approche = coutApproche(ctx.approche, s);
  const metered = (base + distanceCost + timeCost + stopsCost) * trafficMult * zoneFactor * surge + pickupFee + approche;
  const raw = (ctx.flatAmount && ctx.flatAmount > 0 ? ctx.flatAmount * surge : metered) + extraFee;
  // Prix plancher : minFare, ou plancher premium majoré du secteur s'il est plus élevé.
  const floored = Math.max(raw, tariff.minFare, ctx.premiumFloor ?? 0);
  // Remise : code promo (montant calculé) prioritaire, sinon taux de remise éventuel.
  const promo = ctx.promoDiscount ? ctx.promoDiscount(floored) : 0;
  const discount = Math.min(floored, promo > 0 ? promo : floored * discountRate);

  // Le prix TTC de l'Argent, arrondi à 50 F, puis la majoration de la gamme (Or + 5 %,
  // Diamant + 15 %) calculée sur ce montant : elle suit donc tout ce qui fait le prix de la
  // course (zone, forfait, trafic, carrosserie, assurance, remise). Le détail (sous-total,
  // TVA, frais, assurance) est recalculé à partir du montant final, pour rester juste.
  const tauxTtc = 1 + s.tvaRate + s.feeRate + (req.insurance ? s.insuranceRate : 0);
  // Ajustement général décidé par la direction (Mon poste du PDG), avant la majoration de gamme.
  const montantArgent = roundFcfa((floored - discount) * tauxTtc * coefAjustement(s));
  // Hors d'Abidjan (départ, arrêt ou arrivée hors du district), l'écart entre gammes passe à 10 %.
  const horsAbidjan = sortDAbidjan([req.origin, ...stops, req.destination]);
  // Péages de l'itinéraire choisi (pont HKB, 4ᵉ pont…) : reversés tels quels, sans majoration.
  const peage = peagesRetenus(req, s).reduce((t, p) => t + p.montant, 0);
  const prixCourse = montantArgent + supplementGamme(category, montantArgent, s, horsAbidjan);
  const amount = prixCourse + peage;
  const subtotal = prixCourse / tauxTtc;
  const tva = subtotal * s.tvaRate;
  const fee = subtotal * s.feeRate;
  const insurance = req.insurance ? subtotal * s.insuranceRate : 0;
  // PRIX FIXE GARANTI : `amount` est exactement ce que le client paiera (péages compris).

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
      ...(peage > 0 ? { peage } : {}),
      ...(horsAbidjan ? { horsAbidjan: true } : {}),
      ...(ctx.approche ? { approche: Math.round(approche), approcheKm: ctx.approche.km, approcheMin: ctx.approche.minutes } : {}),
    },
  };
}
