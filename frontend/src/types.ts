export interface LatLng {
  lat: number;
  lng: number;
}

export interface Place {
  id: string;
  name: string;
  area: string;
  location: LatLng;
  kind?: 'home' | 'work' | 'recent' | 'hub';
  /** Catégorie du lieu (pictogramme) : restaurant, bank, religious_muslim, road… */
  categorie?: string;
  /** Lieu venu de la recherche Google : son identifiant chez Google. */
  googleId?: string;
  /** Suggestion Google sans position encore connue : à résoudre au moment du choix. */
  aResoudre?: boolean;
}

export type TierId = 'argent' | 'or' | 'diamant';

export interface TierOption {
  id: TierId;
  /** Clé i18n du libellé (tier_argent, …). */
  key: string;
  multiplier: number;
  capacity: number;
  eta: number; // minutes
  cars: string[];
  accent: string;
  weddingDayPrice: number;
}

export interface PaymentMethod {
  method: string;
  label: string;
  kind: 'cash' | 'mobile_money' | 'card';
}

export type TrafficLevel = 'fluid' | 'dense' | 'jam';

export interface Quote {
  lockId: string;
  amount: number;
  currency: string;
  distanceMeters: number;
  etaSeconds: number;
  trafficLevel: TrafficLevel;
  breakdown: {
    base: number; distance: number; time: number; surge: number; traffic: number;
    discount: number; subtotal: number; tva: number; fee: number; insurance: number;
    /* APK de test temps réel (voir tempsReel.ts) : trafic et approche réels. */
    approche?: number; approcheKm?: number; approcheMin?: number; approcheGoogle?: boolean;
    minutesTrafic?: number; minutesFluide?: number; traficReel?: number; traficFacteur?: number; traficNiveau?: 'fluid' | 'dense' | 'jam';
  };
}

export interface Driver {
  name: string;
  matricule: string;
  rating: number;
  trips: number;
  plate: string;
  car: string;
  color: string;
  /** Photo du chauffeur (adresse complète), si le backend en a une. */
  photo?: string | null;
}

export interface SubPlan {
  id: 'bronze' | 'argent' | 'gold';
  key: string;
  ridesPerDay: number;
  monthlyPrice: number;
  benefits: string[];
  accent: string;
}

export interface Country {
  code: string;
  name: string;
  flag: string;
  currency: string;
  dialCode: string;
  status: 'active' | 'coming_soon';
}

export type WeddingDuration = 'halfday' | 'fullday' | 'weekend';

/* ------------------------- LOCATION ORION (Signature) ------------------------- */

export type RentalFormula = 'evenement' | 'entreprise' | 'mise_a_disposition';
export type RentalDuree = 'heures' | 'journee' | 'weekend' | 'semaine' | 'mois';

/** Véhicule de la gamme Signature (réservé à la location). */
export interface PrestigeVehicle {
  id: string;
  name: string;
  marque: string;
  classe: 'signature' | 'presidentielle';
  places: number;
  prixJour: number;
  autonomieKm: number;
  atouts: string[];
  exemplaires: number;
}

export interface RentalOptions {
  decoration?: boolean;
  tapisRouge?: boolean;
  cortege?: number;
  hotesses?: number;
  escorte?: boolean;
  plaque?: boolean;
  kilometrageIllimite?: boolean;
  secondChauffeur?: boolean;
  rafraichissements?: boolean;
}

export interface RentalAvailability {
  vehicleId: string;
  total: number;
  reserves: number;
  restants: number;
  disponible: boolean;
  /** Mise à disposition le jour même : délai réel en minutes. */
  delaiMinutes: number;
}

export interface RentalQuote {
  formula: RentalFormula;
  vehicleId: string;
  vehicle: Pick<PrestigeVehicle, 'id' | 'name' | 'marque' | 'classe' | 'places' | 'prixJour' | 'autonomieKm'>;
  debut: string;
  fin: string;
  duree: RentalDuree;
  heures?: number;
  /** Forfait mensuel : nombre de mois, reconduction et montant réglé chaque mois. */
  mois?: number;
  renouvelable?: boolean;
  mensualite?: number;
  /** Ce que la durée fait gagner face au tarif journalier plein. */
  remiseDuree?: { taux: number; montant: number };
  heuresService: number;
  jours: number;
  options: Required<RentalOptions>;
  secondChauffeurRequis: boolean;
  kmInclus: number | null;
  prixKmSupp: number;
  breakdown: {
    vehicule: number; kilometrageIllimite: number; cortege: number; options: number;
    majorationJourJ: number; remiseAbonnement: number; ht: number; tva: number;
  };
  total: number;
  caution: number;
  jourJ: boolean;
  disponibilite: RentalAvailability;
  currency: string;
}

export type RentalStatus = 'devis' | 'reservee' | 'confirmee' | 'en_cours' | 'terminee' | 'annulee';

export interface RentalReservation extends RentalQuote {
  id: string;
  userId: string;
  status: RentalStatus;
  contact?: { nom: string; telephone: string; email?: string };
  societe?: { nom: string; bonCommande?: string; contribuable?: string };
  lieu?: string;
  driverId?: string;
  events: Array<{ type: string; at: string; note?: string }>;
  createdAt: string;
  updatedAt: string;
}

/* ---------------------------- ABONNEMENT ORION ---------------------------- */

/** Ce que l'abonnement fait sur une course donnée (aperçu ou application). */
export interface SubCoverage {
  covered: boolean;
  plan?: string;
  montantCouvert: number;
  remise: number;
  aPayer: number;
  remaining: number;
  raison: string;
}

export interface SubInvoice {
  id: string;
  userId: string;
  plan: string;
  amount: number;
  periodeDebut: string;
  periodeFin: string;
  status: 'en_attente' | 'payee' | 'echouee';
  method?: string;
  emiseLe: string;
  payeeLe?: string;
  motifEchec?: string;
}

/** Un forfait tel que le serveur le décrit (source de vérité des avantages). */
export interface SubPlanInfo {
  id: string; label: string; ridesPerDay: number; monthlyPrice: number; perRideCap: number;
  tiers: string[]; remiseHorsQuota: number; remiseLocation: number; priorite: number;
  annulationGratuite: boolean; benefits: string[]; accent: string;
}

export interface SubState {
  subscription: {
    id: string; userId: string; plan: string; startedAt: string; renewsAt: string;
    ridesPerDay: number; usedToday: number; active: boolean; autoRenew: boolean;
    totalCouvert: number; coursesCouvertes: number; cancelledAt?: string;
  } | null;
  plan: SubPlanInfo | null;
  echu: boolean;
  joursRestants: number;
  restantesAujourdhui: number;
  factureEnAttente: SubInvoice | null;
  invoices?: SubInvoice[];
}

export type Screen =
  | 'serveur'
  | 'splash'
  | 'onboarding'
  | 'auth'
  | 'otp'
  | 'permissions'
  | 'home'
  | 'destination'
  | 'delivery'
  | 'estimate'
  | 'confirm'
  | 'searching'
  | 'tracking'
  | 'payment'
  | 'rating'
  | 'settings'
  | 'preferences'
  | 'securite'
  | 'adresses'
  | 'carteFond'
  | 'subscription'
  | 'wedding'
  | 'rental'
  | 'myRentals'
  | 'wallet'
  | 'history'
  | 'help'
  | 'support'
  | 'photo'
  | 'profile'
  | 'sosHistory'
  | 'legal'
  | 'assurance'
  | 'messages'
  | 'choixLieu'
  // Volets et écrans du compte (version 1.5.7).
  | 'services' | 'controle' | 'parrainage' | 'famille' | 'contacts' | 'groupes' | 'business' | 'entreprise' | 'revenus';
