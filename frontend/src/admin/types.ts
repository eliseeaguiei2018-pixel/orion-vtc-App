/**
 * Types partagés de la console ORION.
 *
 * Extraits de Admin.tsx lors de l'audit : le fichier dépassait 3 600 lignes et
 * mélangeait types, couche réseau et 37 composants.
 */

/* ------------------------------- Types ------------------------------- */
export interface Overview {
  currency: string;
  rides: { total: number; active: number; completed: number; cancelled: number; byStatus: Record<string, number> };
  drivers: { total: number; online: number; onTrip: number };
  finance: { gmv: number; revenue: number; commission: number; payouts: number };
  safety: { total: number; open: number };
  generatedAt: string;
}
export interface Alert {
  id: string; kind: string; status: string; rideId?: string; userId: string;
  location: { lat: number; lng: number }; zoneName?: string; impactG?: number;
  dispatchedTo: string[]; createdAt: string; note?: string;
  /* --- Session SAMU : triage, prise en charge nominative, chat, scellement --- */
  level?: 'rouge' | 'orange' | 'jaune';
  source?: string;
  agent?: string;
  chat?: SosChat[];
  closingNote?: string;
  sealed?: boolean;
  slaSeconds?: number;
}
export interface SosChat { from: 'agent' | 'usager'; author?: string; text: string; at: string }
export interface SosDossier {
  alert: Alert; presets: string[];
  ride: { id: string; status: string; origin: { lat: number; lng: number }; destination: { lat: number; lng: number }; trace: { lat: number; lng: number }[]; createdAt: string } | null;
  vehicle: { plate: string; model: string; color: string; engine: string } | null;
  driver: { id: string; name: string; matricule: string; phone: string | null; licenseNo: string | null; birthDate: string | null; phoneBatteryPct: number; batteryPct: number | null } | null;
  passenger: { id: string; name: string | null; phone: string | null; phoneBatteryPct: number; lastRides: { id: string; status: string; createdAt: string }[] };
  telemetry: { speedEstimateKmh: number | null; points: number; refreshSeconds: number };
  emergencyNumbers: Record<string, string>;
}
export interface SecurityAttempt {
  id: string; username?: string; name: string; role: string;
  permission?: string; section?: string; path?: string; ip?: string; at: string; notified: string[];
}
export interface Reservation {
  id: string; clientId: string; origin: { lat: number; lng: number }; destination: { lat: number; lng: number };
  category: string; scheduledFor: string; status: string; driverId?: string; driverName?: string | null;
  minutesToGo?: number; punctualityAlert?: boolean; createdAt: string;
}
export interface SupportStats { open: number; resolvedToday: number; avgFirstReplyMin: number | null; csat: number | null }
export interface Macro { title: string; text: string }
export interface Triggers {
  lowBattery: { id: string; name: string; matricule: string; batteryPct?: number; station: string | null }[];
  winback: { id: string; name: string | null; rides: number; lastSeenAt: string }[];
  offPeak: { start: number; end: number; bonus: number };
}
export interface CsatReport { series: { date: string; avg: number | null; count: number }[]; csat7d: number | null; acceptRate: number; cancelRate: number }
export interface QualityTop { id: string; name: string; matricule: string; rating: number; trips: number; vip: boolean }
export interface SimResult { sampled: number; matched: number; matchRate: number; avgEtaMin: number | null }
/* --- S8 Équipes / RH --- */
export interface StaffKpi { actor: string; role: string; total: number; support: number; moderation: number; finance: number; promos: number; lastAt: string }
export interface Shift { id: string; username: string; name: string; date: string; slot: 'matin' | 'soir' | 'nuit'; zoneId?: string; createdAt: string }
export interface MaintenanceTicket { id: string; driverId: string; kind: string; title: string; status: string; teamId?: string; assignee?: string; dueDate?: string; createdAt: string }
export interface SquadPnl { vehicles: number; active: number; grounded: number; activityRate: number; revenue: number; rides: number; roi: number }
export interface TeamMessage { id: string; teamId: string; author: string; text: string; at: string }
/* --- S9 IA --- */
export interface FraudReport {
  ghostRides: { clientId: string; driverId: string; driverName: string | null; count: number }[];
  gpsSpoof: { rideId: string; driverId: string | null; jumpMeters: number }[];
  txRisk: { id: string; name: string | null; cancellations: number; warnings: number }[];
}
export interface ElasticityCell { cell: string; lat: number; lng: number; sessions: number; rate: number; recommended: number }
export interface CopilotAnswer { query: string; answer: string; data: unknown }
/* --- S10 B2B --- */
export interface TravelPolicy { days?: number[]; hourStart?: number; hourEnd?: number; zoneIds?: string[]; maxTier?: string }
/* --- S11 Litiges --- */
export interface Garage { id: string; name: string; electric: boolean; zone: string }
/* --- S12 Chauffeur --- */
export interface ExpiringDoc { id: string; name: string; matricule: string; insuranceExpiry: string; daysLeft: number }
/* --- S14 Finances --- */
export interface CashDebtor { id: string; name: string | null; matricule: string | null; balance: number; limit: number }
export interface GatewayStatus { method: string; enabled: boolean }
export interface ExpenseTicket {
  id: string; requesterType: string; requesterId: string; requesterName: string; amount: number;
  category: string; neededDate: string; description: string; status: string; createdAt: string;
  decidedBy?: string; decisionNote?: string; credited?: boolean;
  cashOut?: { channel: string; amount: number; at: string }; receipt?: { amount: number; at: string; matches: boolean };
  refunded?: number; blocked?: boolean;
}
/* --- S15 Trésorerie --- */
export interface Liquidity {
  currency: string; cashOnHand: number; escrow: number; virtualHeld: number;
  backingRatio: number; backingOk: boolean; monthlyOpex: number; netMonthly: number;
  burnRate: number; runwayMonths: number | null;
}
export interface Amortization { vehicles: number; totalBookValue: number; rows: { id: string; matricule: string; km: number; purchase: number; depreciation: number; bookValue: number }[] }
export interface FleetUnit { id: string; lat: number; lng: number; name: string; matricule: string | null; category: string; availability: string; }
export interface RideRow { id: string; clientId: string; driverName: string | null; matricule: string | null; status: string; amount: number; currency: string; trafficLevel: string; anomaly?: string | null; createdAt: string; }
export interface DriverRow { id: string; name: string; matricule: string; category: string; kycStatus: string; availability: string; rating: number; trips: number; balance: number; vip?: boolean; loyaltyTier?: string | null; electricRides?: number; suspensionReason?: string | null; }
export interface Pricing {
  baseFare: number; perKm: number; perMinute: number; minFare: number; avgSpeedKmh: number;
  tvaRate: number; feeRate: number; insuranceRate: number; trafficWeight: number; stopFee: number;
  multipliers: Record<string, number>; bodySurcharge: Record<string, number>;
  freeWaitMinutes?: number; cancelGraceMinutes?: number; cancelFee?: number;
  cleaningLight?: number; cleaningMajor?: number; longPickupPerKm?: number; longPickupThresholdKm?: number;
}
export interface ShadowPricing { sampled: number; realRevenue: number; simulatedRevenue: number; impactPercent: number }
export interface Me { name: string; role: string; roleLabel: string; permissions: string[] }
export interface Client { id: string; name?: string; phone?: string; status: string; rides: number; greenPoints?: number; vipTier?: string; noSurgeLock?: boolean; createdAt: string; lastSeenAt: string }
export interface Promo { id: string; kind: 'percent' | 'amount'; value: number; active: boolean; uses: number; maxUses?: number; createdAt: string }
export interface ServicesConfig { city: string; open: boolean; services: Record<string, boolean> }
export interface Zone {
  id: string; name: string; factor: number; lat: number; lng: number; radiusKm: number; active: boolean;
  waitMaxMin?: number; driverBonus?: number; minStandard?: string; pickupFee?: number; dedicated?: boolean;
  surgeManual?: number; flatRates?: { toZoneId: string; price: number }[]; emptyReturnFee?: number; premiumFloor?: number;
}
export interface SupportMsg { id: string; from: 'client' | 'agent'; author?: string; text: string; at: string }
export interface Conversation { id: string; clientId: string; subject: string; status: string; priority?: number; csat?: number; assignee?: string; messages: SupportMsg[]; createdAt: string; updatedAt: string }
export interface AuditEntry { id: string; at: string; actor: string; role: string; action: string; target?: string; details?: Record<string, unknown> }
export interface Finance { currency: string; gmv: number; revenue: number; commission: number; earnings: number; payouts: number; taxes?: number; byTier: Record<string, { count: number; revenue: number }> }
export interface Announcement {
  id: string; audience: string; title: string; body: string; author: string; at: string;
  channel?: 'push' | 'sms' | 'email'; segment?: string; zoneId?: string; scheduledAt?: string;
  stats?: { sent: number; delivered: number; opened: number; clicked: number; rides: number };
}
export interface StatsDay { date: string; rides: number; revenue: number; cancelled: number }
export interface Stats { currency: string; days: number; series: StatsDay[]; totals: { rides: number; revenue: number; cancelled: number } }
export interface Transfer {
  id: string; amount: number; currency: string; destination: string; reason: string;
  requestedBy: string; requestedRole: string; status: 'pending' | 'approved' | 'rejected';
  decidedBy?: string; decisionNote?: string; createdAt: string; decidedAt?: string; executedAt?: string;
}
export interface SearchResults {
  drivers: { id: string; name: string; matricule: string; category: string; availability: string }[];
  clients: { id: string; name: string | null; phone: string | null; status: string; rides: number }[];
  rides: { id: string; clientId: string; status: string; amount: number; createdAt: string }[];
}
export interface ActiveSession {
  id: string; username: string; name: string; role: string; ip?: string; userAgent?: string;
  createdAt: string; lastSeenAt: string; expiresAt: string; revoked?: boolean;
}
export interface PageMeta { total: number; page: number; pages: number }
export interface OpsConfig {
  strategy: 'nearest' | 'longest_idle' | 'zone_queue'; minRating: number; autoWarn: boolean;
  maxEtaMinutes: number; offerTimeoutSec: number; surgeEnabled: boolean; surgeCapGreen: number;
  waitFeePerMin: number;
  radiusKm: number; radiusMaxKm: number; offerMode: 'cascade' | 'broadcast';
  weightRating: number; weightIdle: number; greenPriority: boolean;
  surgeThreshold: number; surgeSmoothingMin: number;
  refundCap: number; offPeakBonus: number; offPeakStart: number; offPeakEnd: number;
  cashDebtLimit: number; commissionStandard: number; commissionGreen: number;
  loyaltyRideThreshold: number; commissionLoyalty: number;
}
export interface Team {
  id: string; name: string; managerUsername: string; managerName?: string; driverIds: string[]; createdAt: string;
  drivers?: { id: string; name: string; matricule: string; availability: string; rating: number }[];
}
export interface GreenReport {
  co2SavedKg: number; co2SavedTons: number; kmElectric: number; kmHybrid: number;
  electricShare: number; hybridShare: number;
  fleet: { electric: number; hybrid: number; lowBattery: number; batteries: { id: string; name: string; matricule: string; batteryPct?: number; batteryHealthPct?: number | null; availability: string }[]; avgSoh?: number | null };
  topGreenClients?: { id: string; name: string | null; greenPoints: number }[];
  chargingStations?: { id: string; name: string; lat: number; lng: number; fast: boolean }[];
}
export interface PredictCell { cell: string; lat: number; lng: number; expected: number; supply: number; gap: number }
export interface ConversionCell { cell: string; lat: number; lng: number; sessions: number; orders: number; rate: number }
export interface ChurnReport {
  clients: { id: string; name: string | null; rides: number; lastSeenAt: string }[];
  drivers: { id: string; name: string; matricule: string; idleSince?: string }[];
}
export interface CorporateAccount {
  id: string; name: string; contactEmail?: string; creditLimit: number; balanceUsed: number; active: boolean; createdAt: string;
  nif?: string; billingAddress?: string; parentId?: string; policy?: TravelPolicy; kickbackRate?: number; members?: string[];
}
export interface QualityRow { id: string; name: string; matricule: string; category: string; rating: number; trips: number; warnings: number; kycStatus: string; vip?: boolean; below: boolean }
export interface Dispute {
  id: string; rideId: string; clientId: string; kind: string; description: string;
  status: 'open' | 'investigating' | 'resolved' | 'rejected';
  createdAt: string; decidedBy?: string; resolution?: string; refund?: number; decidedAt?: string;
  escalation?: string; lockedBy?: string; quarantined?: boolean; notes?: { author: string; text: string; at: string }[];
}
export interface RideForensic {
  ride: {
    id: string; clientId: string; driverId?: string; status: string;
    origin: { lat: number; lng: number }; destination: { lat: number; lng: number };
    quote: { amount: number; currency: string; breakdown?: Record<string, number> };
    events: { type: string; at: string; payload?: Record<string, unknown> }[];
    trace?: { lat: number; lng: number }[];
    createdAt: string;
  };
  driverName: string | null; matricule: string | null;
}

export interface LedgerEntry { id?: string; type: string; amount: number; at?: string; createdAt?: string }
export interface DetailRide { id: string; status: string; amount: number; createdAt: string }
export interface DriverDetail {
  id: string; name: string; matricule: string; category: string; kycStatus: string; availability: string;
  rating: number; trips: number; balance: number; earnings: number; ledger: LedgerEntry[]; rides: DetailRide[];
}
export interface ClientDetail {
  id: string; name: string | null; phone: string | null; status: string; rides: number; createdAt: string | null;
  spent: number; greenPoints?: number; recentRides: DetailRide[]; conversations: { id: string; subject: string; status: string; messages: number }[];
}


/* --------------- Location Signature & abonnements (sessions console) --------------- */
export interface PrestigeUnit {
  id: string; name: string; marque: string; classe: 'signature' | 'presidentielle';
  places: number; prixJour: number; autonomieKm: number; atouts: string[]; exemplaires: number;
}
export interface RentalAvailabilityRow {
  vehicleId: string; total: number; reserves: number; restants: number; disponible: boolean; delaiMinutes: number;
}
export interface RentalRow {
  id: string; userId: string; formula: string; duree: string; heures?: number;
  vehicle: { id: string; name: string; classe: 'signature' | 'presidentielle'; places: number };
  debut: string; fin: string; total: number; caution: number; jourJ: boolean;
  status: string; driverId?: string; lieu?: string;
  options: { cortege: number; hotesses: number; decoration: boolean; escorte: boolean };
  breakdown: { vehicule: number; cortege: number; options: number; majorationJourJ: number; remiseAbonnement: number; ht: number; tva: number };
  contact?: { nom: string; telephone: string; email?: string };
  societe?: { nom: string; bonCommande?: string; contribuable?: string };
  events: { type: string; at: string; note?: string }[];
  createdAt: string;
}
export interface RentalStats {
  total: number; parStatut: Record<string, number>; parFormule: Record<string, number>;
  chiffreAffaires: number; aVenir: number; tauxOccupation: number;
}
export interface SubPlanRow {
  id: string; label: string; ridesPerDay: number; monthlyPrice: number; perRideCap: number;
  tiers: string[]; remiseHorsQuota: number; remiseLocation: number; benefits: string[]; accent: string;
}
export interface SubscriptionRow {
  id: string; userId: string; plan: string; startedAt: string; renewsAt: string;
  ridesPerDay: number; usedToday: number; active: boolean; autoRenew: boolean;
  totalCouvert: number; coursesCouvertes: number; cancelledAt?: string; cancelReason?: string;
}
export interface SubInvoiceRow {
  id: string; userId: string; plan: string; amount: number; periodeDebut: string; periodeFin: string;
  status: string; method?: string; reference?: string; emiseLe: string; payeeLe?: string; motifEchec?: string;
}
export interface SubStats {
  total: number; actifs: number; parPlan: Record<string, number>; mrr: number;
  impayees: number; montantImpaye: number; totalCouvert: number; coursesCouvertes: number;
}
