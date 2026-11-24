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
  /** Gammes ouvertes par la direction en plus de celle du véhicule (courses reçues dans chacune). */
  categories?: string[];
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
  /** Courses annulées par le chauffeur lui-même. */
  cancellations?: number;
  /** Date de sa photo (l'image est servie par GET /drivers/:id/photo). */
  photoUpdatedAt?: string;
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

/** Ce que le client paie réellement (abonnement ORION déduit) ; le chauffeur est payé sur le brut. */
export interface Encaissement {
  brut: number;
  attente: number;
  prisEnCharge: number;
  aEncaisser: number;
  abonnement: { plan: string; raison: string } | null;
}

/** Course vue par le chauffeur. */
export interface RideView {
  id: string;
  status: RideStatus;
  serviceType: string;
  category: string;
  origin: LatLng;
  destination: LatLng;
  /** Noms réels du départ et de l'arrivée (quartier, commune) fournis par le serveur. */
  lieux?: { depart: string; arrivee: string };
  stops: LatLng[];
  distanceMeters: number;
  etaSeconds: number;
  amount: number;
  waitMinutes: number;
  paymentMethod: string | null;
  paidAmount: number | null;
  earnings: RideEarnings;
  rating: number | null;
  encaissement?: Encaissement;
  /** Terminée sans paiement après le délai console : chauffeur libéré, à régulariser. */
  liberee?: boolean;
  /**
   * Itinéraire choisi par le client : par le pont à péage (péage compris dans le prix, reversé
   * au chauffeur sans commission) ou par la voie normale. Le guidage suit ce choix.
   */
  itineraire?: { choix: 'peage' | 'normal'; peages: string[]; peage: number; trace?: LatLng[] };
  /** Mise à disposition à l'heure : le chauffeur reste `heures` heures avec le client. */
  miseADisposition?: { heures: number; debut?: string };
  /** La course sort du district d'Abidjan (grille des gammes à 10 %). */
  horsAbidjan?: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface Offer { expiresAt: string; timeoutSec: number }

/** Course en cours (mission) : client, secteur, offre éventuelle à confirmer. */
export interface ActiveRide extends RideView {
  events: { type: string; at: string }[];
  /** Prénom et photo du passager, le temps de la mission (politique de confidentialité). */
  client: { id: string; name: string | null; phone: string | null; rides: number; photo?: string | null };
  /** Arrêts prévus et demandés (compteur, minutes, montants) ; espèces autorisées par le chauffeur. */
  arrets?: { montant: number };
  especesAutorisees?: boolean;
  pickupZone: { id: string; name: string; driverBonus: number } | null;
  offer: Offer | null;
  /** Le passager doit donner son code à 4 chiffres pour démarrer (jamais sa valeur). */
  codeRequis?: boolean;
  codeVerifie?: boolean;
  /** Livraison à moto : le colis, son destinataire, et le code de remise à demander (jamais sa valeur). */
  livraison?: DetailsLivraison | null;
}

export interface DetailsLivraison {
  destinataire: { nom: string; telephone: string } | null;
  description: string | null;
  instructions: string | null;
  codeRemiseRequis: boolean;
}

export interface Totals { rides: number; gross: number; net: number; commission: number; cashCollected: number }

export interface RideHistory { rides: RideView[]; total: number; today: Totals; week: Totals; finance: Finance; aRegulariser?: RideView[] }

/** Motifs d'annulation côté chauffeur (le passager n'est jamais pénalisé, sauf absence). */
export type MotifAnnulationChauffeur = 'client_absent' | 'client_injoignable' | 'adresse_introuvable' | 'vehicule_panne' | 'securite' | 'autre';

/* ------------------------------ Locations Signature ------------------------------ */
export type EtapeLocation = 'vehicule_prepare' | 'en_route' | 'sur_place' | 'debut_service' | 'fin_service';
export interface LocationChauffeur {
  id: string;
  formula: 'evenement' | 'entreprise' | 'mise_a_disposition';
  duree: string;
  heures?: number;
  heuresService: number;
  vehicle: { id: string; name: string; marque: string; classe?: string; places: number; autonomieKm?: number };
  debut: string;
  fin: string;
  lieu: string | null;
  contact: { nom: string; telephone: string; email?: string } | null;
  societe: { nom: string; bonCommande?: string } | null;
  status: 'devis' | 'reservee' | 'confirmee' | 'en_cours' | 'terminee' | 'annulee';
  options: Record<string, boolean | number>;
  jourJ: boolean;
  kmInclus: number | null;
  secondChauffeurRequis?: boolean;
  etapes: { etape: EtapeLocation; at: string; note: string | null }[];
}

/* ------------------------------ Poste du chauffeur ------------------------------ */
export interface RequeteVue {
  id: string; type: string; typeLabel: string; statut: string; statutLabel: string;
  montant: number | null; montantAccorde: number | null; echeances: number | null;
  du: string | null; au: string | null; motif: string; createdAt: string;
  instruiteLe: string | null; decideLe: string | null; decisionNote: string | null;
  verseLe: string | null; canalVersement: string | null;
  plan: { numero: number; montant: number; dueDate: string; payeeLe?: string }[] | null;
  rembourse: number; clotureLe: string | null;
}
export interface Poste {
  activite: { periodeJours: number; courses: number; coursesAnnulees: number; kilometres: number; revenus: number; commissionVersee: number; noteMoyenne: number; nbNotes: number; joursTravailles: number };
  argent: { solde: number; detteEspeces: number; plafondDette: number; resteDu: number };
  equipe: { name: string; mission: string | null; chef: string | null; chefTelephone: string | null } | null;
  acces: { identifiant: string; actif: boolean; aChangerMotDePasse: boolean } | null;
  requetes: RequeteVue[];
  litiges: { id: string; kind: string; status: string; createdAt: string }[];
  maintenance: { id: string; kind: string; title: string; status: string; dueDate?: string }[];
  alertes: { severite: 'critique' | 'eleve' | 'moyen'; texte: string }[];
  typesRequete: { code: string; label: string; financiere: boolean }[];
  plafonds: { avance: number; pret: number; echeancesMax: number };
  messagesNonLus: number;
}
export interface MessageChef {
  id: string; de: string; deNom: string; sujet?: string; texte: string; urgent: boolean; reponseAttendue: boolean;
  at: string; luLe?: string; reponses: { de: string; deNom: string; texte: string; at: string }[];
}
export interface RapportDemande {
  id: string; demandeParNom: string; titre: string; consigne: string; echeance: string;
  statut: 'demande' | 'rendu' | 'accepte' | 'a_revoir'; statutLabel: string;
  rendu?: { texte: string; at: string }; retour?: { texte: string; at: string; par: string };
}
export interface MessagesChef { messages: MessageChef[]; rapports: RapportDemande[]; nonLus: number; identifiant: string | null }
export interface NouvelleRequete { type: string; montant?: number; echeances?: number; du?: string; au?: string; motif: string }

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

/** CARTE DE SERVICE (hors course) : zones à forte demande, zones habituelles de l'heure, sièges ORION. */
export type NiveauZone = 'forte' | 'elevee' | 'moderee';
export interface ZoneDemande { id: string; lat: number; lng: number; niveau: NiveauZone; demande: number; offre: number; majorationPct: number; nom: string; distanceMeters: number | null }
export interface ZonePrevue { id: string; lat: number; lng: number; attendu: number; nom: string; distanceMeters: number | null }
export interface BaseOrion { id: string; nom: string; adresse?: string; zone?: string; lat: number; lng: number; telephone?: string; horaires?: string; principale?: boolean; distanceMeters: number | null }
export interface CarteService { zones: ZoneDemande[]; prevues: ZonePrevue[]; bases: BaseOrion[]; baseConseillee: string | null; majLe: string }

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

/* -------------------- Météo (Google, via le serveur ORION) -------------------- */
export interface AlerteMeteo { niveau: 'pluie' | 'forte_pluie' | 'orage'; heure: string; dansMinutes: number; description: string; probabilite: number }
export interface Meteo { type: string; description: string; temperature: number | null; ressenti: number | null; humidite: number | null; jour: boolean; alerte: AlerteMeteo | null; majLe: string }
export interface MeteoChauffeur { commune: string; meteo: Meteo | null; alertes: Array<{ commune: string; alerte: AlerteMeteo }> }
