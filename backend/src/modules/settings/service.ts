import { DEFAULT_PRICING, type PricingSettings } from '../services/ride/pricing.js';
import type { Repository } from '../../core/db/repository.js';

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

export class SettingsService {
  private pricing: PricingSettings;
  private services: ServicesConfig;

  constructor(
    private readonly repo?: Repository<PricingRecord>,
    private readonly servicesRepo?: Repository<ServicesRecord>,
  ) {
    const saved = repo?.get(PRICING_ID);
    this.pricing = saved ? stripId(saved) : { ...DEFAULT_PRICING };
    const savedSvc = servicesRepo?.get(SERVICES_ID);
    this.services = savedSvc ? { city: savedSvc.city, open: savedSvc.open, services: savedSvc.services } : { ...DEFAULT_SERVICES, services: { ...DEFAULT_SERVICES.services } };
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
