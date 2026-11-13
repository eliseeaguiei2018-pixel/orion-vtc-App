/* Types de l'app Chauffeur — miroir des réponses du backend (module driver-app). */
export interface LatLng { lat: number; lng: number }

export type KycStatus = 'draft' | 'docs_submitted' | 'manual_review' | 'approved' | 'active' | 'suspended';
export type Availability = 'offline' | 'online' | 'on_trip' | 'paused';
export type RideStatus =
  | 'searching' | 'accepted' | 'driver_en_route' | 'arrived' | 'in_progress'
  | 'completed' | 'paid' | 'rated' | 'cancelled' | 'no_driver';

/** Fiche chauffeur (sa propre fiche : données complètes). */
export interface DriverProfile {
  id: string;
  name: string;
  matricule: string;
  kycStatus: KycStatus;
  availability: Availability;
  category: string;
  ratingAvg: number;
  ratingCount: number;
  warnings?: number;
  engine?: 'electric' | 'hybrid';
  batteryPct?: number;
  batteryHealthPct?: number;
  zoneLockId?: string;
  vehicleModel?: string;
  insuranceExpiry?: string;
  trained?: boolean;
  vip?: boolean;
  phone?: string;
  licenseNo?: string;
  birthDate?: string;
  vehiclePlate?: string;
  vehicleColor?: string;
  suspensionReason?: string;
  loyaltyTier?: 'bronze' | 'silver' | 'gold';
  commissionOverride?: number;
  electricRides?: number;
  batteryKwh?: number;
  plugType?: string;
  cablesConfirmed?: boolean;
  ribVerified?: boolean;
  nif?: string;
  appLinkedAt?: string;
  offersReceived?: number;
  offersAccepted?: number;
  offersDeclined?: number;
  offersExpired?: number;
}

/** Réglages console utiles au chauffeur (GET /drivers/config, `driver-config.update`). */
export interface DriverConfig {
  currency: 'XOF';
  offer: { timeoutSec: number; mode: 'cascade' | 'broadcast' };
  wait: { freeMinutes: number; feePerMin: number };
  cancel: { graceMinutes: number; fee: number };
  quality: { minRating: number; autoWarn: boolean };
  commission: { standard: number; green: number; loyalty: number; loyaltyRideThreshold: number };
  cashDebtLimit: number;
  offPeak: { bonus: number; start: number; end: number };
  longPickup: { thresholdKm: number; perKm: number };
  dispatch: { strategy: string; greenPriority: boolean; maxEtaMinutes: number };
  zones: Zone[];
}

export interface Zone {
  id: string; name: string; lat: number; lng: number; radiusKm: number;
  driverBonus: number; minStandard: string | null; waitMaxMin: number | null;
  dedicated: boolean; surgeManual: number | null;
}

/** Situation financière synthétique. */
export interface Finance {
  balance: number;
  cashDebt: number;
  cashDebtLimit: number;
  cashBlocked: boolean;
  commissionRate: number;
  frozen: boolean;
}

export interface RideEarnings { net: number; bonus: number; commission: number; cashCollected: number }

/** Course vue par le chauffeur. */
export interface RideView {
  id: string;
  status: RideStatus;
  serviceType: string;
  category: string;
  origin: LatLng;
  destination: LatLng;
  stops: LatLng[];
  distanceMeters: number;
  etaSeconds: number;
  amount: number;
  waitMinutes: number;
  paymentMethod: string | null;
  paidAmount: number | null;
  earnings: RideEarnings;
  rating: number | null;
  createdAt: string;
  updatedAt: string;
}

export interface Offer { expiresAt: string; timeoutSec: number }

/** Course en cours (mission) : client, secteur, offre éventuelle à confirmer. */
export interface ActiveRide extends RideView {
  events: { type: string; at: string }[];
  client: { id: string; name: string | null; phone: string | null; rides: number };
  pickupZone: { id: string; name: string; driverBonus: number } | null;
  offer: Offer | null;
  /** Le passager doit donner son code à 4 chiffres pour démarrer (jamais sa valeur). */
  codeRequis?: boolean;
  codeVerifie?: boolean;
}

export interface Totals { rides: number; gross: number; net: number; commission: number; cashCollected: number }

export interface RideHistory { rides: RideView[]; total: number; today: Totals; week: Totals; finance: Finance }

export interface LedgerEntry {
  id: string;
  type: 'ride_earning' | 'commission' | 'payout' | 'adjustment' | 'insurance_refund' | 'cash_collected';
  amount: number;
  rideId?: string;
  at: string;
  note?: string;
}

export interface Wallet { balance: number; currency: string; history: LedgerEntry[] }

export interface Announcement { id: string; title: string; body: string; at: string; audience?: string }

export interface DemandCell { cell: string; lat: number; lng: number; demand: number; supply: number; surge: number }

export interface Training { title: string; videoUrl: string; questions: { q: string; options: string[] }[]; passScore: number }

export interface TrainingResult { score: number; total: number; passed: boolean; trained: boolean }

export interface QueueInfo { inQueue: boolean; position: number | null; total: number }

export interface WaitResult { waitMinutes: number; freeMinutes: number; billableMinutes: number; waitFee: number; perMinute: number }

/** Champs modifiables du dossier (POST /drivers/:id/profile). */
export interface ProfilePatch {
  vehicleModel?: string; insuranceExpiry?: string; phone?: string; licenseNo?: string; birthDate?: string;
  vehiclePlate?: string; vehicleColor?: string; batteryKwh?: number; plugType?: string;
  cablesConfirmed?: boolean; nif?: string;
}

/** Session chauffeur (jeton signé par le backend). */
export interface Session { token: string; driverId: string; expiresAt: string }

/** Trame temps réel reçue (canal chauffeur ou canal config). */
export interface DriverEvent {
  type: string;
  data?: unknown;
  [key: string]: unknown;
}

export type LinkState = 'connecting' | 'online' | 'offline';
