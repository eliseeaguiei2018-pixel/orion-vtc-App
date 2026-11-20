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
  /** Arrêts intermédiaires (courses multi-arrêts). */
  stops?: LatLng[];
  category?: string;
  /** Carrosserie souhaitée : 'suv' | 'berline'. */
  bodyType?: string;
  /** ORION Assurance activée (cotisation 2% de la course). */
  insurance?: boolean;
  promoCode?: string;
  /** Identifiant du demandeur : sert à ne compter qu'une fois la même personne
   *  dans le calcul du surge (un client qui compare les gammes = UNE demande). */
  clientId?: string;
}

/** Détail transparent du prix (le client sait pourquoi sa course coûte ce montant). */
export interface QuoteBreakdown {
  base: number;
  distance: number;
  time: number;
  /** Coefficient de demande (zone/heure). */
  surge: number;
  /** Supplément trafic (embouteillages) en FCFA. */
  traffic: number;
  discount: number;
  /** Sous-total course avant taxes. */
  subtotal: number;
  /** TVA État de Côte d'Ivoire (5%). */
  tva: number;
  /** Frais de service ORION (10%). */
  fee: number;
  /** Cotisation ORION Assurance (2%), 0 si non activée. */
  insurance: number;
}

export type TrafficLevel = 'fluid' | 'dense' | 'jam';

export interface Quote {
  lockId: string;
  serviceType: ServiceType;
  category: string;
  amount: number;
  currency: string;
  origin: LatLng;
  destination: LatLng;
  stops?: LatLng[];
  distanceMeters: number;
  etaSeconds: number;
  trafficLevel: TrafficLevel;
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
