import type { LatLng } from '../../core/geo.js';

/**
 * Contrat commun à tous les services Orion. Le cœur ne connaît QUE ce contrat ;
 * ajouter la livraison de colis ou la micro-mobilité = fournir une nouvelle
 * implémentation de ServiceModule, sans toucher au cœur (cf. docs/04).
 */
export type ServiceType = 'ride' | 'delivery' | 'micromobility';
export type SupplyKind = 'driver' | 'courier' | 'asset';

export interface EstimateRequest {
  origin: LatLng;
  destination: LatLng;
  category?: string;
  promoCode?: string;
}

export interface QuoteBreakdown {
  base: number;
  distance: number;
  time: number;
  surge: number;
  discount: number;
}

export interface Quote {
  lockId: string;
  serviceType: ServiceType;
  category: string;
  amount: number;
  currency: string;
  distanceMeters: number;
  etaSeconds: number;
  breakdown: QuoteBreakdown;
  expiresAt: string;
}

export interface SupplyMatch {
  supplyId: string;
  distanceMeters: number;
  etaSeconds: number;
}

export interface ServiceModule {
  readonly type: ServiceType;
  readonly supplyKind: SupplyKind;
  /** Calcule un devis verrouillable (prix transparent, figé avant validation). */
  estimate(req: EstimateRequest): Promise<Quote>;
}
