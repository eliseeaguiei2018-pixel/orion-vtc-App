import { DEFAULT_PRICING, type PricingSettings } from '../services/ride/pricing.js';
import type { Repository } from '../../core/db/repository.js';

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

export class SettingsService {
  private pricing: PricingSettings;

  constructor(private readonly repo?: Repository<PricingRecord>) {
    const saved = repo?.get(PRICING_ID);
    this.pricing = saved ? stripId(saved) : { ...DEFAULT_PRICING };
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
