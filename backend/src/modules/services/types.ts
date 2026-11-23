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
  /** ORION Assurance activée (cotisation 4 % de la course). */
  insurance?: boolean;
  /** Itinéraire choisi quand un pont à péage est sur le trajet : par le pont, ou par la voie normale. */
  itineraire?: 'peage' | 'normal';
  /** Péages franchis par l'itinéraire choisi (identifiants : hkb, pont4, bassam…). */
  peages?: string[];
  /** Distance de l'itinéraire choisi, calculée par l'application (contrôlée par le serveur). */
  routeMeters?: number;
  /** Mise à disposition à l'heure (Abidjan) : le chauffeur reste avec le client `heures` heures. */
  miseADisposition?: { heures: number; debut?: string };
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
  /** Cotisation ORION Assurance (4 %), 0 si non activée. */
  insurance: number;
  /** Péages de l'itinéraire choisi (F CFA), reversés tels quels. */
  peage?: number;
  /** La course sort du district d'Abidjan : écart de 10 % entre les gammes. */
  horsAbidjan?: boolean;
  /** Mise à disposition : nombre d'heures facturées. */
  heures?: number;
  /** Approche du chauffeur le plus proche : coût ajouté (HT, 0 si offerte), distance et minutes. */
  approche?: number;
  approcheKm?: number;
  approcheMin?: number;
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
  /** Itinéraire choisi par le client (pont à péage ou voie normale) et péages franchis. */
  itineraire?: { choix: 'peage' | 'normal'; peages: string[] };
  /** Mise à disposition à l'heure : durée et heure de début choisies par le client. */
  miseADisposition?: { heures: number; debut?: string };
  /** Chauffeur libre le plus proche de la gamme : distance et minutes d'approche ; null si aucun. */
  approche?: { km: number; minutes: number } | null;
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
