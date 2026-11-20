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
  /** `joignables` : en ligne ET position récente ; `muets` : en ligne mais invisibles du dispatch. */
  drivers: { total: number; online: number; onTrip: number; joignables?: number; muets?: number };
  finance: { gmv: number; revenue: number; commission: number; payouts: number };
  safety: { total: number; open: number };
  generatedAt: string;
}
export interface Alert {
  id: string; kind: string; status: string; rideId?: string; userId: string;
  /** Qui est derrière l'alerte, résolu côté serveur : un identifiant ne se compose pas. */
  userName?: string | null; userPhone?: string | null; userKind?: 'client' | 'chauffeur' | 'inconnu';
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
/** Une ligne joignable depuis le poste SAMU. */
export interface ContactLigne {
  id: string; label: string; numero: string;
  categorie: 'secours' | 'interne' | 'partenaire' | 'course';
  note?: string | null;
}
/** Gestionnaire de mise en relation, partagé par toutes les sessions. */
export type ContactHandler = (p: {
  dossierType: string; dossierId: string;
  canal: 'appel' | 'sms' | 'whatsapp'; numero: string; label: string; message?: string;
}) => void;

/** Une tentative de contact consignée. */
export interface ContactJournal {
  id: string; alertId: string; agent: string; contactId: string; label: string; numero: string;
  canal: 'appel' | 'sms' | 'whatsapp';
  issue: 'tentative' | 'joint' | 'non_joint' | 'messagerie';
  message?: string; at: string;
}
/** Entrée du répertoire d'urgence (session Répertoire). */
export interface ContactUrgence extends ContactLigne {
  categorie: 'secours' | 'interne' | 'partenaire' | 'course';
  ordre: number; actif: boolean;
}

export interface SosDossier {
  alert: Alert; presets: string[];
  ride: { id: string; status: string; origin: { lat: number; lng: number }; destination: { lat: number; lng: number }; trace: { lat: number; lng: number }[]; createdAt: string } | null;
  vehicle: { plate: string; model: string; color: string; engine: string } | null;
  driver: { id: string; name: string; matricule: string; phone: string | null; photoUrl?: string | null; licenseNo: string | null; birthDate: string | null; phoneBatteryPct: number; batteryPct: number | null } | null;
  passenger: { id: string; name: string | null; phone: string | null; photo?: string | null; phoneBatteryPct: number; lastRides: { id: string; status: string; createdAt: string }[] };
  telemetry: { speedEstimateKmh: number | null; points: number; refreshSeconds: number };
  emergencyNumbers: Record<string, string>;
  /** Poste de contact : répertoire + numéros propres au dossier. */
  contacts?: ContactLigne[];
  /** Tout ce qui a déjà été tenté sur ce dossier. */
  journalContacts?: ContactJournal[];
  /** Le passager a un dossier ORION Assurance : l'agent gestionnaire peut l'ouvrir. */
  assurance?: { inscrit: boolean };
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
export interface CopilotAnswer {
  query: string; answer: string; data: unknown;
  /** Sessions de la console où creuser la réponse. */
  sources: string[];
  /** Vrai quand la question n'a pas été comprise : `data` porte alors la liste des sujets. */
  incompris: boolean;
}
export interface AssistantSujet { id: string; exemple: string }
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
export interface RideRow {
  id: string; clientId: string; clientName?: string | null; clientPhone?: string | null;
  driverId?: string | null; driverName: string | null; driverPhone?: string | null; matricule: string | null;
  status: string; amount: number; currency: string; trafficLevel: string;
  anomaly?: string | null; paymentMethod?: string | null;
  trustedContact?: { name: string; phone: string } | null;
  /** Départ et arrivée en clair : « Riviéra 2, Cocody » (quartier réel, commune OSM). */
  depart?: string; arrivee?: string;
  createdAt: string;
}
export interface DriverRow { id: string; name: string; matricule: string; category: string; kycStatus: string; availability: string; rating: number; trips: number; balance: number; vip?: boolean; loyaltyTier?: string | null; electricRides?: number; suspensionReason?: string | null; phone?: string | null; photoUrl?: string | null; cancellations?: number; }
export interface Pricing {
  baseFare: number; perKm: number; perMinute: number; minFare: number; avgSpeedKmh: number;
  tvaRate: number; feeRate: number; insuranceRate: number; trafficWeight: number; stopFee: number;
  multipliers: Record<string, number>; bodySurcharge: Record<string, number>;
  freeWaitMinutes?: number; cancelGraceMinutes?: number; cancelFee?: number;
  cleaningLight?: number; cleaningMajor?: number; longPickupPerKm?: number; longPickupThresholdKm?: number;
}
export interface ShadowPricing { sampled: number; realRevenue: number; simulatedRevenue: number; impactPercent: number }
export interface Me {
  name: string; role: string; roleLabel: string; permissions: string[];
  username?: string; service?: string; teamId?: string;
  /** Compte chauffeur : la fiche à laquelle il donne accès. */
  driverId?: string;
  /** Mot de passe provisoire non encore remplacé — la console exige le changement. */
  mustChangePassword?: boolean;
}
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
  /** La recherche libre a atteint son budget de temps : d'autres fiches peuvent correspondre. */
  partiel?: boolean;
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
  id: string; name: string; contactEmail?: string; contactPhone?: string; creditLimit: number; balanceUsed: number; active: boolean; createdAt: string;
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
  /** Photo (adresse signée), annulations faites par le chauffeur et statistiques d'offres. */
  photoUrl?: string | null; cancellations?: number;
  offres?: { recues: number; acceptees: number; refusees: number; expirees: number };
}
export interface ClientDetail {
  id: string; name: string | null; phone: string | null; status: string; rides: number; createdAt: string | null;
  spent: number; greenPoints?: number;
  recentRides: Array<DetailRide & { annulation?: { par: string; motif: string | null; frais: number } }>;
  conversations: { id: string; subject: string; status: string; messages: number }[];
  /** Compte client : photo (fiche uniquement, jamais dans les listes), e-mail, numéro vérifié. */
  email?: string | null; photo?: string | null; phoneVerifiedAt?: string | null; deletedAt?: string | null;
  cancellations?: number; warnings?: number; terminees?: number;
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
/* -------------------- « Mon poste » (par employé) -------------------- */
export interface TacheAssignee {
  id: string; type: 'sos' | 'support' | 'litige' | 'location' | 'maintenance';
  titre: string; detail: string; depuis: string; section: string; priorite: number;
}
export interface DemandePersonnelle {
  id: string; type: 'note_de_frais' | 'virement';
  libelle: string; montant: number; statut: string; depuis: string; section: string;
}
export interface MonPoste {
  identite: {
    nom: string; role: string; roleLabel: string; permissions: string[];
    username?: string; service?: string; teamId?: string; driverId?: string;
    mustChangePassword?: boolean;
  };
  service: { date: string; slot: string; zoneId?: string } | null;
  mesDossiers: TacheAssignee[];
  mesDemandes: DemandePersonnelle[];
  aTraiter: Array<{ id: string; severite: string; titre: string; action: string; section: string }>;
  monActivite: Array<{ at: string; action: string; target?: string }>;
  /** Messages internes reçus — ce que son chef ou un collègue lui a écrit. */
  messages: Array<{
    id: string; deNom: string; sujet?: string; texte: string; at: string;
    urgent: boolean; reponseAttendue: boolean; lu: boolean; reponses: number;
  }>;
  /** Rapports qu'on lui a demandés et qu'il doit rendre. */
  rapports: Array<{
    id: string; titre: string; consigne: string; echeance: string; statut: string;
    statutLabel: string; demandeParNom: string; enRetard: boolean;
    rendu?: { texte: string; at: string }; retour?: { texte: string; at: string };
  }>;
  /** Sa caisse, s'il en tient une. */
  caisse: {
    id: string; emplacement?: string; ouverteLe: string;
    fondDeCaisse: number; entrees: number; sorties: number; soldeTheorique: number; nbMouvements: number;
  } | null;
  /** Ses équipes, s'il en dirige. */
  equipes: Array<{
    id: string; name: string; mission?: string; membres: number; flotte: number;
    rapportsEnRetard: number; requetesOuvertes: number; alertesFlotte: number;
  }>;
  /** Sa flotte accréditée, triée par ce qui demande une attention. */
  flotte: Array<{
    driverId: string; matricule: string; name: string; phone: string | null;
    availability: string; requetesOuvertes: number; alertes: number;
  }>;
  /** Son propre dossier, s'il est chauffeur : sa seule vue de la plateforme. */
  monDossier: {
    matricule: string; courses: number; revenus: number; solde: number; resteDu: number;
    requetes: Array<{ id: string; type: string; statut: string; montant?: number; createdAt: string }>;
    alertes: Array<{ severite: string; texte: string }>;
    driverId: string;
    profil: { name: string; category: string; availability: string; kycStatus: string; rating: number; trips: number; insuranceExpiry?: string };
    vehicule: { model?: string; plate?: string; color?: string; engine: string; batteryPct?: number };
    equipe: { name: string; mission?: string; managerName?: string; managerPhone?: string | null } | null;
    activite: { periodeJours: number; coursesAnnulees: number; kilometres: number; commissionVersee: number; noteMoyenne: number; nbNotes: number; joursTravailles: number };
    argent: { detteEspeces: number; plafondDette: number; dernieresEcritures: Array<{ at: string; type: string; amount: number; note: string }> };
    dernieresCourses: Array<{ id: string; at: string; trajet: string; montant: number; paiement: string; statut: string; note?: number }>;
    typesRequete: Array<{ code: string; label: string; financiere: boolean }>;
    plafonds: { avance: number; pret: number; echeancesMax: number };
  } | null;
  bilan: {
    dossiers: number; demandes: number; aTraiter: number; actionsAujourdhui: number;
    messagesNonLus: number; rapportsARendre: number;
  };
  genereA: string;
}

/* ----------------------- Moteur de vigilance ----------------------- */
export type Severite = 'critique' | 'eleve' | 'moyen' | 'info';
export interface Constat {
  id: string; severite: Severite; domaine: string; titre: string;
  constat: string; consequence: string; action: string; section: string;
  elements?: string[]; detecteA: string;
}
export interface SanteVigilance {
  score: number;
  etat: 'sain' | 'surveiller' | 'degrade' | 'critique';
  parSeverite: Record<Severite, number>;
  parDomaine: Record<string, number>;
  constats: Constat[];
}

/* ------------------ Direction Générale (poste du PDG) ------------------ */
export interface Mouvement {
  id: string; at: string; sens: 'entree' | 'sortie'; categorie: string;
  libelle: string; montant: number; reference?: string; contrepartie?: string;
  statut?: string; enCaisse: boolean;
}
export interface MouvementPage {
  mouvements: Mouvement[]; total: number; page: number; pages: number;
  entrees: number; sorties: number;
}
export interface ConsolidationFinanciere {
  currency: string; gmv: number; gmvParActivite: { mobilite: number; location: number; abonnement: number }; revenu: number; entrees: number; sorties: number; solde: number;
  parCategorie: Record<string, { entrees: number; sorties: number; nombre: number }>;
  mrr: number; tvaCollectee: number; dusChauffeurs: number;
  especesChauffeurs: number; dettesEspeces: number;
  encoursEntreprises: number; impayesAbonnements: number;
}
export interface DecisionEnAttente {
  id: string; type: string; libelle: string; montant?: number;
  priorite: number; depuis: string; section: string; reference?: string;
}
export interface AlerteDirection {
  id: string; gravite: 'critique' | 'attention' | 'info'; titre: string; detail: string; section?: string;
}
export interface ExecutiveBoard {
  consolidation: ConsolidationFinanciere;
  serie: Array<{ date: string; entrees: number; sorties: number; solde: number }>;
  decisions: DecisionEnAttente[];
  alertes: AlerteDirection[];
  recentes: Array<{ at: string; actor: string; role: string; action: string; details?: Record<string, unknown> }>;
  effectif: { employes: number; chauffeurs: number; chauffeursEnLigne: number; clients: number; abonnes: number };
  /** Résultat du moteur de vigilance, repris dans la session du PDG. */
  vigilance?: { score: number; etat: string; critiques: number; eleves: number };
  generatedAt: string;
}

/** Barème de location réglé depuis la console. */
export interface RentalTarif {
  coefs: { journee: number; weekend: number; semaine: number; mois: number };
  ratioHeure: number; minHeures: number; maxHeures: number;
  decoration: number; tapisRouge: number; hotesse: number; escorte: number; plaque: number;
  secondChauffeur: number; rafraichissements: number;
  remiseCortege: number; kmInclusParJour: number; prixKmSupp: number;
  majorationKmIllimite: number; majorationJourJ: number; tauxCaution: number;
  delaiExpressMin: number; delaiExpressMax: number;
}
export interface RentalTarifEtat {
  tarif: RentalTarif;
  vehicules: Array<PrestigeUnit & { actif: boolean }>;
  origine: { modifiePar: string | null; modifieLe: string | null };
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

/* --- Annuaire du personnel : un identifiant par employé et par chauffeur --- */
export interface StaffAccountRow {
  username: string; name: string; role: string; roleLabel: string;
  service?: string; phone?: string; email?: string; matricule?: string;
  teamId?: string; driverId?: string;
  active: boolean; mustChangePassword: boolean;
  createdAt: string; createdBy: string; updatedAt?: string; lastLoginAt?: string;
  disabledReason?: string; has2fa: boolean; permissions: number;
}
export interface AccountsStats { total: number; actifs: number; parRole: Record<string, number>; aChangerMdp: number }
export interface RoleOption { id: string; label: string; permissions: number }

/* --- Session Équipages --- */
export interface EquipageRow {
  driverId: string; matricule: string; name: string; phone: string | null;
  category: string; kycStatus: string; availability: string; rating: number;
  teamId?: string; teamName?: string;
  courses: number; revenus: number; solde: number; resteDu: number;
  requetesOuvertes: number; aUnAcces: boolean;
}
export interface EcheancePret { numero: number; montant: number; dueDate: string; payeeLe?: string }
export interface RequeteChauffeur {
  id: string; driverId: string; driverName: string; matricule: string;
  type: string; typeLabel: string; statut: string; statutLabel: string;
  montant?: number; montantAccorde?: number; echeances?: number;
  du?: string; au?: string; motif: string; createdAt: string; teamId?: string;
  avis?: string; avisPar?: string; avisNote?: string; avisAt?: string;
  decidePar?: string; decisionNote?: string; decideAt?: string;
  verseLe?: string; versePar?: string; canalVersement?: string;
  plan?: EcheancePret[]; rembourse?: number; clotureLe?: string;
}
export interface DossierEquipage {
  identite: {
    driverId: string; matricule: string; name: string; phone: string | null;
    category: string; kycStatus: string; availability: string; rating: number; trips: number;
    licenseNo?: string; birthDate?: string; insuranceExpiry?: string; appLinkedAt?: string;
    photoUrl?: string | null; annulationsChauffeur?: number;
  };
  vehicule: { model?: string; plate?: string; color?: string; engine: string; batteryPct?: number; batteryHealthPct?: number };
  equipe: { id: string; name: string; mission?: string; managerName?: string; managerUsername: string } | null;
  acces: { username: string; active: boolean; lastLoginAt?: string; mustChangePassword: boolean } | null;
  activite: {
    periodeJours: number; courses: number; coursesAnnulees: number; kilometres: number;
    revenus: number; commissionVersee: number; noteMoyenne: number; nbNotes: number; joursTravailles: number;
  };
  argent: {
    solde: number; detteEspeces: number; resteDu: number;
    dernieresEcritures: Array<{ at: string; type: string; amount: number; note: string }>;
  };
  requetes: RequeteChauffeur[];
  litiges: Array<{ id: string; kind: string; status: string; createdAt: string; description: string }>;
  maintenance: Array<{ id: string; kind: string; title: string; status: string; dueDate?: string }>;
  alertes: Array<{ severite: string; texte: string }>;
  genereA: string;
}
export interface CrewTableau {
  effectif: { total: number; enService: number; avecAcces: number; kycEnAttente: number };
  requetes: {
    total: number; parStatut: Record<string, number>; parType: Record<string, number>;
    encours: number; verseeCeMois: number; delaiMoyenHeures: number;
  };
  attente: { aInstruire: RequeteChauffeur[]; aDecider: RequeteChauffeur[]; aVerser: RequeteChauffeur[] };
  encoursPrets: number; sansEquipe: number;
}

/* --- Caisse nominative (Trésorerie) --- */
export interface MouvementCaisse {
  id: string; caisseId: string; sens: 'entree' | 'sortie'; montant: number;
  origine?: string; sortie?: string; tiers?: string; reference?: string; note?: string;
  at: string; par: string;
}
export interface CaisseEtat {
  id: string; titulaire: string; titulaireNom: string; emplacement?: string;
  statut: 'ouverte' | 'arretee'; fondDeCaisse: number; ouverteLe: string; arreteeLe?: string;
  comptage?: Record<string, number>; montantCompte?: number; montantAttendu?: number;
  ecart?: number; motifEcart?: string; verseEnBanque?: number;
  valideLe?: string; validePar?: string;
  mouvements: MouvementCaisse[]; entrees: number; sorties: number;
  soldeTheorique: number; parOrigine: Record<string, number>;
}
export interface CaisseConsolidation {
  caissesOuvertes: number; especesEnCaisse: number; encaisseSurPeriode: number;
  verseEnBanque: number; ecartCumule: number; arretesNonValides: number;
  parOrigine: Record<string, number>;
  parTresorier: Array<{ titulaire: string; titulaireNom: string; encaisse: number; ecart: number; arretes: number }>;
}
export interface CaisseReferentiel {
  coupures: number[]; ecartTolere: number;
  origines: Record<string, string>; sorties: Record<string, string>;
}

/* --- Poste de travail du chef d'équipe --- */
export interface MembreEquipe {
  username: string; name: string; role: string; roleLabel: string;
  phone?: string; email?: string; service?: string;
  active: boolean; lastLoginAt?: string; mustChangePassword: boolean;
  actionsAujourdhui: number; derniereAction?: { at: string; action: string };
  rapportsAttendus: number; rapportsEnRetard: number; messagesNonLus: number;
  service_du_jour?: { slot: string; zoneId?: string };
}
export interface DemandeRapport {
  id: string; teamId: string; demandePar: string; demandeParNom: string;
  destinataire: string; destinataireNom: string;
  titre: string; consigne: string; echeance: string; statut: string; createdAt: string;
  rendu?: { texte: string; at: string }; retour?: { texte: string; at: string; par: string };
}
export interface MessageInterne {
  id: string; de: string; deNom: string; a: string; aNom: string;
  teamId?: string; sujet?: string; texte: string; urgent: boolean;
  reponseAttendue: boolean; at: string; luLe?: string;
  reponses: Array<{ de: string; deNom: string; texte: string; at: string }>;
}
export interface PosteEquipe {
  equipe: { id: string; name: string; mission?: string; managerUsername: string; managerName?: string; createdAt: string };
  membres: MembreEquipe[];
  flotte: Array<{
    driverId: string; matricule: string; name: string; phone: string | null;
    category: string; kycStatus: string; availability: string;
    coursesPeriode: number; revenusPeriode: number; requetesOuvertes: number; alertes: number;
    /** Photo (adresse signée), annulations, identifiant console (pour lui écrire). */
    photoUrl?: string | null; annulations?: number; identifiant?: string | null;
  }>;
  bilan: {
    periodeJours: number; courses: number; revenusChauffeurs: number; commissionOrion: number;
    noteMoyenne: number; chauffeursEnService: number; requetesOuvertes: number;
    rapportsEnRetard: number; ticketsMaintenance: number;
  };
  rapports: DemandeRapport[];
  messages: MessageInterne[];
  genereA: string;
}

/* --- Télématique des véhicules de location --- */
export interface PositionVehicule {
  lat: number; lng: number; vitesseKmh: number; cap?: number;
  contact: boolean; batteriePct?: number; autonomieKm?: number; zone?: string; at: string;
}
export interface Immobilisation {
  id: string; vehiculeId: string; vehiculeNom?: string; reservationId?: string;
  motif: string; commentaire: string; etat: 'aucune' | 'armee' | 'appliquee' | 'levee';
  armeePar: string; armeeLe: string; confirmeePar?: string; confirmeeLe?: string;
  appliqueeLe?: string; positionApplication?: { lat: number; lng: number };
  leveePar?: string; leveeLe?: string; motifLevee?: string;
}
export interface DeclarationVol {
  id: string; vehiculeId: string; reservationId: string;
  /** Nom commercial résolu par le serveur : « Huawei AITO M9 », pas « aito-m9 ». */
  vehiculeNom?: string;
  declarePar: string; declareLe: string; circonstances: string;
  dernierePosition?: PositionVehicule; referencePlainte?: string;
  transmisLe?: string; transmisPar?: string; transmisA?: string;
  statut: 'declare' | 'transmis' | 'retrouve' | 'clos'; retrouveLe?: string; note?: string;
}
export interface VehiculeSuivi {
  reservationId: string; vehiculeId: string; vehiculeNom: string; statut: string;
  debut: string; fin: string;
  locataire: { nom: string; telephone: string | null; societe: string | null };
  chauffeurId: string | null;
  position: PositionVehicule | null;
  immobilisation: { id: string; etat: string; motif: string; motifLabel: string } | null;
  vol: { id: string; statut: string; declareLe: string } | null;
  silencieux: boolean;
}
export interface SuiviFlotte {
  vehicules: VehiculeSuivi[]; vols: DeclarationVol[]; immobilisations: Immobilisation[];
  vitesseCoupureMax: number; motifs: Record<string, string>;
}
