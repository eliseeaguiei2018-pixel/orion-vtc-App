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
}

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
];

/** Disponibilité des services & de la ville — pilotée depuis la console. */
export interface ServicesConfig {
  city: string;
  open: boolean; // ORION ouvert/fermé (maintenance)
  services: Record<string, boolean>; // course, delivery, food, shop, market, colis
}
export const DEFAULT_SERVICES: ServicesConfig = {
  city: 'Abidjan',
  open: true,
  services: { course: true, delivery: true, food: false, shop: false, market: false, colis: false },
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
export interface PricingPatch extends Partial<Omit<PricingSettings, 'multipliers' | 'bodySurcharge'>> {
  multipliers?: Partial<Record<string, number>>;
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

export class SettingsService {
  private pricing: PricingSettings;
  private services: ServicesConfig;
  private zones: Zone[];

  constructor(
    private readonly repo?: Repository<PricingRecord>,
    private readonly servicesRepo?: Repository<ServicesRecord>,
    private readonly zonesRepo?: Repository<ZonesRecord>,
  ) {
    const saved = repo?.get(PRICING_ID);
    this.pricing = saved ? stripId(saved) : { ...DEFAULT_PRICING };
    const savedSvc = servicesRepo?.get(SERVICES_ID);
    this.services = savedSvc ? { city: savedSvc.city, open: savedSvc.open, services: savedSvc.services } : { ...DEFAULT_SERVICES, services: { ...DEFAULT_SERVICES.services } };
    const savedZones = zonesRepo?.get(ZONES_ID);
    this.zones = savedZones ? savedZones.zones.map((z) => ({ ...z })) : DEFAULT_ZONES.map((z) => ({ ...z }));
  }

  /* ------------------------------- Zones ------------------------------- */
  getZones(): Zone[] { return this.zones; }

  private persistZones(): void { this.zonesRepo?.put({ id: ZONES_ID, zones: this.zones }); }

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

  getServices(): ServicesConfig { return this.services; }

  updateServices(patch: Partial<ServicesConfig>): ServicesConfig {
    this.services = {
      ...this.services,
      ...patch,
      services: { ...this.services.services, ...(patch.services ?? {}) },
    };
    this.servicesRepo?.put({ id: SERVICES_ID, ...this.services });
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
      bodySurcharge: { ...this.pricing.bodySurcharge, ...(patch.bodySurcharge ?? {}) },
    };
    this.repo?.put({ id: PRICING_ID, ...this.pricing });
    return this.pricing;
  }

  /** Réinitialise aux valeurs par défaut. */
  resetPricing(): PricingSettings {
    this.pricing = { ...DEFAULT_PRICING };
    this.repo?.put({ id: PRICING_ID, ...this.pricing });
    return this.pricing;
  }
}
