import { DEFAULT_PRICING, type PricingSettings } from '../services/ride/pricing.js';
import type { Repository } from '../../core/db/repository.js';
import { haversineMeters } from '../../core/geo.js';

/**
 * Zone tarifaire (commune / quartier d'Abidjan). Le facteur module le PRIX FIXE selon
 * la zone de PRISE EN CHARGE (origine). 1 = neutre, < 1 = moins cher, > 1 = plus cher.
 * Levier ops pour ajuster la compétitivité quartier par quartier.
 */
export interface Zone {
  id: string;
  name: string;
  factor: number;
  lat: number;
  lng: number;
  radiusKm: number;
  active: boolean;
  /* --- Micro-zonage résidentiel (qualité de service) --- */
  /** Temps d'attente maximum garanti dans le secteur (minutes, affiché/objectif). */
  waitMaxMin?: number;
  /** Bonus versé au chauffeur qui se rend dans le secteur (F CFA, fidélisation offre). */
  driverBonus?: number;
  /** Standard minimal de véhicule exigé dans le secteur (argent < or < diamant). */
  minStandard?: 'argent' | 'or' | 'diamant';
  /** Frais de prise en charge propres au secteur (F CFA, intégrés au prix fixe). */
  pickupFee?: number;
  /** Cantonnement : les chauffeurs épinglés à cette zone n'en sortent pas (jamais en pénurie). */
  dedicated?: boolean;
  /** Surge MANUEL d'urgence (stade, concert…) forcé par la console — reste plafonné (cap vert). */
  surgeManual?: number;
  /* --- Zones & tarifs (session 17) --- */
  /** Forfaits plats vers d'autres zones (A→B) : remplace la tarification au km. */
  flatRates?: { toZoneId: string; price: number }[];
  /** Supplément retour à vide (F CFA) ajouté si la course se TERMINE dans cette zone périphérique. */
  emptyReturnFee?: number;
  /** Prix plancher majoré (F CFA) pour une course démarrant dans ce secteur premium. */
  premiumFloor?: number;
}

/** Rang des gammes pour le standard minimal de zone (source : catalogue de la flotte). */
export { TIER_RANK } from '../fleet/catalog.js';

/** Communes d'Abidjan avec un facteur neutre au départ (ajustable depuis la console). */
export const DEFAULT_ZONES: Zone[] = [
  { id: 'plateau', name: 'Plateau', factor: 1.05, lat: 5.3236, lng: -4.0217, radiusKm: 2.5, active: true },
  { id: 'cocody', name: 'Cocody', factor: 1.0, lat: 5.3596, lng: -3.9903, radiusKm: 5, active: true },
  { id: 'marcory', name: 'Marcory', factor: 1.0, lat: 5.3007, lng: -3.9877, radiusKm: 3.5, active: true },
  { id: 'treichville', name: 'Treichville', factor: 0.95, lat: 5.2925, lng: -4.0027, radiusKm: 2.5, active: true },
  { id: 'adjame', name: 'Adjamé', factor: 0.95, lat: 5.3644, lng: -4.0225, radiusKm: 2.5, active: true },
  { id: 'yopougon', name: 'Yopougon', factor: 0.92, lat: 5.3456, lng: -4.0864, radiusKm: 6, active: true },
  { id: 'abobo', name: 'Abobo', factor: 0.92, lat: 5.4204, lng: -4.0159, radiusKm: 6, active: true },
  { id: 'aeroport', name: 'Aéroport (Port-Bouët)', factor: 1.1, lat: 5.2614, lng: -3.9268, radiusKm: 4, active: true },
  /* Micro-secteurs résidentiels premium (qualité de service garantie). */
  { id: 'riviera-golf', name: 'Riviera Golf', factor: 1.15, lat: 5.3742, lng: -3.9721, radiusKm: 1.4, active: true, waitMaxMin: 5, driverBonus: 300, minStandard: 'argent', pickupFee: 200, dedicated: true },
  { id: 'deux-plateaux-vallon', name: 'Deux-Plateaux Vallon', factor: 1.1, lat: 5.3689, lng: -4.0004, radiusKm: 1.3, active: true, waitMaxMin: 5, driverBonus: 200, minStandard: 'argent', pickupFee: 150 },
  { id: 'cite-des-arts', name: 'Cocody Centre — Cité des Arts', factor: 1.08, lat: 5.3488, lng: -3.9962, radiusKm: 1.1, active: true, waitMaxMin: 6, driverBonus: 150, pickupFee: 100 },
  { id: 'cocody-danga', name: 'Cocody Danga', factor: 1.1, lat: 5.3391, lng: -4.0011, radiusKm: 1.0, active: true, waitMaxMin: 5, driverBonus: 200, minStandard: 'argent', pickupFee: 150 },
  { id: 'riviera-beverly-hills', name: 'Riviera Beverly Hills', factor: 1.18, lat: 5.3808, lng: -3.9611, radiusKm: 1.2, active: true, waitMaxMin: 5, driverBonus: 300, minStandard: 'or', pickupFee: 250, dedicated: true },
  { id: 'marcory-zone4', name: 'Marcory Zone 4', factor: 1.08, lat: 5.2942, lng: -3.9846, radiusKm: 1.6, active: true, waitMaxMin: 6, driverBonus: 150, pickupFee: 100 },
];

/** Disponibilité des services & de la ville — pilotée depuis la console. */
export interface ServicesConfig {
  city: string;
  open: boolean; // ORION ouvert/fermé (maintenance)
  services: Record<string, boolean>; // course, delivery, food, shop, market, colis
  /** Passerelles de paiement actives (monitoring / coupure en cas de panne). */
  gateways?: Record<string, boolean>;
}
export const DEFAULT_SERVICES: ServicesConfig = {
  city: 'Abidjan',
  open: true,
  services: { course: true, delivery: true, food: false, shop: false, market: false, colis: false },
  gateways: { orange_money: true, mtn_momo: true, moov_money: true, wave: true, card: true, cash: true },
};

/**
 * Paramètres globaux ORION pilotés depuis la console Admin (centre de contrôle).
 * Aujourd'hui : tarification (leviers augmenter/réduire les prix). Persisté → survit au
 * redémarrage. Toute nouvelle course lit ces valeurs.
 */
export interface PricingRecord extends PricingSettings {
  id: string;
}

/** Patch partiel (les multiplicateurs peuvent n'être fournis que partiellement). */
export interface PricingPatch extends Partial<Omit<PricingSettings, 'multipliers' | 'supplements' | 'bodySurcharge'>> {
  multipliers?: Partial<Record<string, number>>;
  supplements?: Partial<Record<string, number>>;
  bodySurcharge?: Record<string, number>;
}
const PRICING_ID = 'pricing';

const stripId = (r: PricingRecord): PricingSettings => {
  const { id: _id, ...rest } = r;
  return rest;
};

interface ServicesRecord extends ServicesConfig { id: string; }
const SERVICES_ID = 'services';

interface ZonesRecord { id: string; zones: Zone[]; }
const ZONES_ID = 'zones';

/**
 * Réglages OPÉRATIONS (pilotés depuis la console) :
 * - strategy : règle d'attribution des courses.
 *   'nearest'      → chauffeur le plus proche (défaut, minimise l'attente client) ;
 *   'longest_idle' → le plus ancien en attente (équité de revenus entre chauffeurs) ;
 *   'zone_queue'   → file d'attente FIFO dans les zones denses (aéroport, gares) —
 *                    dans une zone tarifaire active, le plus ancien en attente passe
 *                    d'abord ; hors zone, retour au plus proche.
 * - minRating / autoWarn : modération qualité (avertissement automatique sous le seuil).
 */
export type DispatchStrategy = 'nearest' | 'longest_idle' | 'zone_queue';
export interface OpsConfig {
  strategy: DispatchStrategy;
  minRating: number;        // seuil qualité (note moyenne)
  autoWarn: boolean;        // avertissement automatique sous le seuil
  /** Filtre ETA : un chauffeur n'est éligible que si son temps d'approche ≤ ce seuil. */
  maxEtaMinutes: number;
  /** Cascade d'attribution : délai d'acceptation d'une offre (10–15 s) avant bascule au suivant. */
  offerTimeoutSec: number;
  /** Surge par cellules : multiplicateur automatique quand la demande dépasse l'offre de 30 %. */
  surgeEnabled: boolean;
  /** Incitation verte : plafond du multiplicateur sur la flotte électrique (prix stable). */
  surgeCapGreen: number;
  /** Attente facturée (pause demandée par le client, en course) : F CFA / minute. */
  waitFeePerMin: number;
  /** Rayon de recherche INITIAL du matching (km) — élargi automatiquement si vide. */
  radiusKm: number;
  /** Rayon MAXIMAL d'élargissement automatique (km). */
  radiusMaxKm: number;
  /** Cascade (un chauffeur à la fois) ou broadcast (3 plus proches, 1er qui accepte). */
  offerMode: 'cascade' | 'broadcast';
  /** Pondération du scoring d'attribution : poids de la note chauffeur (0 = distance pure). */
  weightRating: number;
  /** Pondération du scoring : poids de l'ancienneté d'attente (lissage des revenus). */
  weightIdle: number;
  /** Priorisation écologique ABSOLUE : le véhicule le moins émetteur passe d'abord. */
  greenPriority: boolean;
  /** Déclencheur du surge : ratio demande/offre critique (ex. 1.3 = +30 %). */
  surgeThreshold: number;
  /** Lissage du retour à la normale du surge (minutes). */
  surgeSmoothingMin: number;
  /** Plafond de remboursement des agents support (au-delà : escalade superviseur). */
  refundCap: number;
  /** Incitation recharge en heures creuses (F CFA versés au chauffeur). */
  offPeakBonus: number;
  /** Heures creuses (recharge) : début et fin (heures locales). */
  offPeakStart: number;
  offPeakEnd: number;
  /** Plafond de dette espèces (F CFA) : au-delà, le chauffeur ne reçoit que des courses carte. */
  cashDebtLimit: number;
  /** Commission plateforme sur la flotte thermique/standard (0..1). */
  commissionStandard: number;
  /** Commission plateforme RÉDUITE sur la flotte 100 % électrique (0..1) — incitation verte. */
  commissionGreen: number;
  /** Seuil de courses électriques pour la commission fidélité réduite. */
  loyaltyRideThreshold: number;
  /** Commission fidélité (0..1) accordée au-delà du seuil de courses électriques. */
  commissionLoyalty: number;
}
export const DEFAULT_OPS: OpsConfig = {
  strategy: 'nearest', minRating: 4.5, autoWarn: true,
  maxEtaMinutes: 7, offerTimeoutSec: 12, surgeEnabled: true, surgeCapGreen: 1.3,
  waitFeePerMin: 100,
  radiusKm: 1.5, radiusMaxKm: 6, offerMode: 'cascade',
  weightRating: 0, weightIdle: 0, greenPriority: false,
  surgeThreshold: 1.3, surgeSmoothingMin: 10,
  refundCap: 5000,
  offPeakBonus: 500, offPeakStart: 22, offPeakEnd: 6,
  cashDebtLimit: 30_000, commissionStandard: 0.20, commissionGreen: 0.12,
  loyaltyRideThreshold: 1000, commissionLoyalty: 0.10,
};
interface OpsRecord extends OpsConfig { id: string; }
const OPS_ID = 'ops';

export class SettingsService {
  private pricing: PricingSettings;
  private services: ServicesConfig;
  private zones: Zone[];
  private ops: OpsConfig;
  /** Notifié à chaque changement de la config publique (services/gateways/open) —
   * branché sur le hub temps réel pour diffuser aux apps clientes (voir container). */
  private servicesChangeHandler?: (config: ServicesConfig) => void;
  /** Notifié à chaque changement d'un réglage qui concerne les chauffeurs (dispatch,
   * commissions, dette espèces, heures creuses, attente, zones) — diffusé à l'app chauffeur. */
  private driverConfigChangeHandler?: () => void;

  constructor(
    private readonly repo?: Repository<PricingRecord>,
    private readonly servicesRepo?: Repository<ServicesRecord>,
    private readonly zonesRepo?: Repository<ZonesRecord>,
    private readonly opsRepo?: Repository<OpsRecord>,
  ) {
    const saved = repo?.get(PRICING_ID);
    // Fusion avec les défauts : les enregistrements persistés avant l'ajout d'un
    // champ (frais annexes, forfaits) restent valides.
    this.pricing = saved ? { ...DEFAULT_PRICING, ...stripId(saved) } : { ...DEFAULT_PRICING };
    // Tarifs enregistrés avant la suppression de la gamme Bronze (quatre multiplicateurs) :
    // la grille a changé de modèle (Argent de référence + écarts fixes), on repart des
    // valeurs par défaut pour les gammes en gardant le reste des réglages de la console.
    if ('bronze' in (this.pricing.multipliers as Record<string, number>) || !this.pricing.supplements) {
      this.pricing = { ...this.pricing, multipliers: { ...DEFAULT_PRICING.multipliers }, supplements: { ...DEFAULT_PRICING.supplements } };
      this.repo?.put({ id: PRICING_ID, ...this.pricing });
    }
    const savedSvc = servicesRepo?.get(SERVICES_ID);
    this.services = savedSvc
      ? { city: savedSvc.city, open: savedSvc.open, services: savedSvc.services, gateways: savedSvc.gateways ?? { ...DEFAULT_SERVICES.gateways } }
      : { ...DEFAULT_SERVICES, services: { ...DEFAULT_SERVICES.services }, gateways: { ...DEFAULT_SERVICES.gateways } };
    const savedZones = zonesRepo?.get(ZONES_ID);
    this.zones = savedZones ? savedZones.zones.map((z) => ({ ...z })) : DEFAULT_ZONES.map((z) => ({ ...z }));
    const savedOps = opsRepo?.get(OPS_ID);
    if (savedOps) {
      // Fusion avec les défauts : les enregistrements persistés avant l'ajout
      // d'un champ (ETA, cascade, surge) restent valides.
      const { id: _opsId, ...rest } = savedOps;
      this.ops = { ...DEFAULT_OPS, ...rest };
    } else {
      this.ops = { ...DEFAULT_OPS };
    }
  }

  /** Enregistre le handler de diffusion « config chauffeur » (appelé une fois au démarrage). */
  onDriverConfigChanged(handler: () => void): void {
    this.driverConfigChangeHandler = handler;
  }

  private notifyDriverConfig(): void {
    try {
      this.driverConfigChangeHandler?.();
    } catch {
      /* la diffusion ne doit jamais faire échouer un réglage console */
    }
  }

  /* ---------------------- Dispatch & qualité (ops) ---------------------- */
  getOps(): OpsConfig { return this.ops; }

  updateOps(patch: Partial<OpsConfig>): OpsConfig {
    this.ops = {
      ...this.ops,
      ...patch,
      minRating: Math.min(5, Math.max(1, patch.minRating ?? this.ops.minRating)),
      maxEtaMinutes: Math.min(30, Math.max(2, patch.maxEtaMinutes ?? this.ops.maxEtaMinutes ?? 7)),
      offerTimeoutSec: Math.min(15, Math.max(10, patch.offerTimeoutSec ?? this.ops.offerTimeoutSec ?? 12)),
      surgeEnabled: patch.surgeEnabled ?? this.ops.surgeEnabled ?? true,
      surgeCapGreen: Math.min(2, Math.max(1, patch.surgeCapGreen ?? this.ops.surgeCapGreen ?? 1.3)),
      waitFeePerMin: Math.min(1000, Math.max(0, patch.waitFeePerMin ?? this.ops.waitFeePerMin ?? 100)),
      radiusKm: Math.min(10, Math.max(0.5, patch.radiusKm ?? this.ops.radiusKm ?? 1.5)),
      radiusMaxKm: Math.min(20, Math.max(1, patch.radiusMaxKm ?? this.ops.radiusMaxKm ?? 6)),
      offerMode: patch.offerMode ?? this.ops.offerMode ?? 'cascade',
      weightRating: Math.min(10, Math.max(0, patch.weightRating ?? this.ops.weightRating ?? 0)),
      weightIdle: Math.min(10, Math.max(0, patch.weightIdle ?? this.ops.weightIdle ?? 0)),
      greenPriority: patch.greenPriority ?? this.ops.greenPriority ?? false,
      surgeThreshold: Math.min(3, Math.max(1.1, patch.surgeThreshold ?? this.ops.surgeThreshold ?? 1.3)),
      surgeSmoothingMin: Math.min(30, Math.max(0, patch.surgeSmoothingMin ?? this.ops.surgeSmoothingMin ?? 10)),
      refundCap: Math.min(100_000, Math.max(0, patch.refundCap ?? this.ops.refundCap ?? 5000)),
      offPeakBonus: Math.min(5000, Math.max(0, patch.offPeakBonus ?? this.ops.offPeakBonus ?? 500)),
      offPeakStart: Math.min(23, Math.max(0, patch.offPeakStart ?? this.ops.offPeakStart ?? 22)),
      offPeakEnd: Math.min(23, Math.max(0, patch.offPeakEnd ?? this.ops.offPeakEnd ?? 6)),
      cashDebtLimit: Math.min(1_000_000, Math.max(0, patch.cashDebtLimit ?? this.ops.cashDebtLimit ?? 30_000)),
      commissionStandard: Math.min(0.5, Math.max(0, patch.commissionStandard ?? this.ops.commissionStandard ?? 0.20)),
      commissionGreen: Math.min(0.5, Math.max(0, patch.commissionGreen ?? this.ops.commissionGreen ?? 0.12)),
      loyaltyRideThreshold: Math.max(0, Math.round(patch.loyaltyRideThreshold ?? this.ops.loyaltyRideThreshold ?? 1000)),
      commissionLoyalty: Math.min(0.5, Math.max(0, patch.commissionLoyalty ?? this.ops.commissionLoyalty ?? 0.10)),
    };
    this.opsRepo?.put({ id: OPS_ID, ...this.ops });
    this.notifyDriverConfig();
    return this.ops;
  }

  /* ------------------------------- Zones ------------------------------- */
  getZones(): Zone[] { return this.zones; }

  private persistZones(): void {
    this.zonesRepo?.put({ id: ZONES_ID, zones: this.zones });
    // Bonus de secteur, standard minimal, surge manuel : visibles en direct côté chauffeur.
    this.notifyDriverConfig();
  }

  /** Crée ou met à jour une zone (par id). Renvoie la zone. */
  upsertZone(z: Zone): Zone {
    const zone: Zone = { ...z, factor: Math.max(0.1, z.factor), radiusKm: Math.max(0.1, z.radiusKm) };
    const i = this.zones.findIndex((x) => x.id === zone.id);
    if (i >= 0) this.zones[i] = zone; else this.zones.push(zone);
    this.persistZones();
    return zone;
  }

  setZoneActive(id: string, active: boolean): Zone | null {
    const z = this.zones.find((x) => x.id === id);
    if (!z) return null;
    z.active = active;
    this.persistZones();
    return z;
  }

  removeZone(id: string): void {
    this.zones = this.zones.filter((x) => x.id !== id);
    this.persistZones();
  }

  resetZones(): Zone[] {
    this.zones = DEFAULT_ZONES.map((z) => ({ ...z }));
    this.persistZones();
    return this.zones;
  }

  /** Zone active dont le centre est le plus proche du point ET dans son rayon. */
  zoneForPoint(point: { lat: number; lng: number }): Zone | undefined {
    let best: Zone | undefined;
    let bestDist = Infinity;
    for (const z of this.zones) {
      if (!z.active) continue;
      const d = haversineMeters(point, { lat: z.lat, lng: z.lng });
      if (d <= z.radiusKm * 1000 && d < bestDist) { best = z; bestDist = d; }
    }
    return best;
  }

  /** Facteur de prix de la zone de prise en charge (1 si hors zone). */
  zoneFactor(point: { lat: number; lng: number }): number {
    return this.zoneForPoint(point)?.factor ?? 1;
  }

  /**
   * Règles tarifaires géographiques d'un trajet (session Zones & tarifs) :
   *  - FORFAIT PLAT si la zone de départ a un tarif fixe vers la zone d'arrivée (A→B) ;
   *  - SUPPLÉMENT retour à vide si l'arrivée est dans une zone périphérique ;
   *  - PLANCHER premium majoré du secteur de départ.
   */
  tripPricing(origin: { lat: number; lng: number }, destination: { lat: number; lng: number }): { flatAmount?: number; extraFee: number; premiumFloor?: number } {
    const from = this.zoneForPoint(origin);
    const to = this.zoneForPoint(destination);
    let flatAmount: number | undefined;
    if (from?.flatRates && to) {
      const match = from.flatRates.find((f) => f.toZoneId === to.id);
      if (match) flatAmount = match.price;
    }
    const extraFee = to?.emptyReturnFee ?? 0;
    return { flatAmount, extraFee, premiumFloor: from?.premiumFloor };
  }

  getServices(): ServicesConfig { return this.services; }

  /** Enregistre le handler de diffusion temps réel (appelé une fois au démarrage). */
  onServicesChanged(handler: (config: ServicesConfig) => void): void {
    this.servicesChangeHandler = handler;
  }

  updateServices(patch: Partial<ServicesConfig>): ServicesConfig {
    this.services = {
      ...this.services,
      ...patch,
      services: { ...this.services.services, ...(patch.services ?? {}) },
      gateways: { ...this.services.gateways, ...(patch.gateways ?? {}) },
    };
    this.servicesRepo?.put({ id: SERVICES_ID, ...this.services });
    // Diffusion temps réel aux apps clientes connectées (maintenance, services, gateways).
    this.servicesChangeHandler?.(this.services);
    return this.services;
  }

  getPricing(): PricingSettings {
    return this.pricing;
  }

  /** Met à jour les paramètres (fusion) et persiste. Effet immédiat sur les nouveaux devis. */
  updatePricing(patch: PricingPatch): PricingSettings {
    this.pricing = {
      ...this.pricing,
      ...patch,
      multipliers: { ...this.pricing.multipliers, ...(patch.multipliers ?? {}) },
      supplements: { ...this.pricing.supplements, ...(patch.supplements ?? {}) } as PricingSettings['supplements'],
      bodySurcharge: { ...this.pricing.bodySurcharge, ...(patch.bodySurcharge ?? {}) },
    };
    this.repo?.put({ id: PRICING_ID, ...this.pricing });
    this.notifyDriverConfig();
    return this.pricing;
  }

  /** Réinitialise aux valeurs par défaut. */
  resetPricing(): PricingSettings {
    this.pricing = { ...DEFAULT_PRICING };
    this.repo?.put({ id: PRICING_ID, ...this.pricing });
    this.notifyDriverConfig();
    return this.pricing;
  }
}
