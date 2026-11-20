import type { GeoIndex, LatLng } from '../../core/geo.js';
import type { Repository } from '../../core/db/repository.js';

export type Availability = 'offline' | 'online' | 'on_trip' | 'paused';
export type KycStatus = 'draft' | 'docs_submitted' | 'manual_review' | 'approved' | 'active' | 'suspended';

export interface Driver {
  id: string;
  name: string;
  /** Matricule ORION (identifiant lisible) — permet à ORION d'intervenir/identifier le chauffeur. */
  matricule: string;
  kycStatus: KycStatus;
  availability: Availability;
  category: string;
  ratingAvg: number;
  ratingCount: number;
  /** Début de la période d'attente courante (équité du dispatch FIFO). */
  idleSince?: string;
  /** Avertissements qualité reçus (note sous le seuil, comportement). */
  warnings?: number;
  /** Motorisation (flotte verte) : électrique ou hybride. */
  engine?: 'electric' | 'hybrid';
  /** Niveau de batterie % (SoC) remonté par l'app chauffeur — flotte électrique. */
  batteryPct?: number;
  /** Cantonnement : chauffeur épinglé à une zone (il n'est matché que dans celle-ci). */
  zoneLockId?: string;
  /** Dossier véhicule (CRM flotte). */
  vehicleModel?: string;
  /** Expiration de l'assurance (ISO) — alerte console < 30 jours. */
  insuranceExpiry?: string;
  /** Module éco-conduite validé (vidéo + QCM ≥ 80 %). */
  trained?: boolean;
  /** Top Driver (top 5 %) : statut privilégié (priorité dispatch, commission réduite). */
  vip?: boolean;
  /** Santé de la batterie (SoH %) — suivi de dégradation long terme (flotte verte). */
  batteryHealthPct?: number;
  /* --- Dossier d'identification (transmission SAMU / police) --- */
  phone?: string;
  licenseNo?: string;
  birthDate?: string;
  vehiclePlate?: string;
  vehicleColor?: string;
  /* --- Cycle de vie (session Chauffeur S12) --- */
  /** Motif obligatoire de suspension (trace légale). */
  suspensionReason?: string;
  /** Palier de fidélité (ancienneté / volume). */
  loyaltyTier?: 'bronze' | 'silver' | 'gold';
  /** Commission plateforme personnalisée (fidélité) — remplace le taux global si défini (0..1). */
  commissionOverride?: number;
  /** Nombre de courses électriques réalisées (fidélité verte). */
  electricRides?: number;
  /* --- Conformité éco-responsable (fleet compliance) --- */
  /** Capacité nominale de la batterie (kWh). */
  batteryKwh?: number;
  /** Type de prise de recharge (Type 2, CCS…). */
  plugType?: string;
  /** Câbles de recharge réglementaires confirmés (photo de preuve). */
  cablesConfirmed?: boolean;
  /** RIB/IBAN vérifié (virements débloqués). */
  ribVerified?: boolean;
  /** Numéro d'identification fiscale (déclaration des revenus). */
  nif?: string;
  /* --- App Chauffeur --- */
  /** Première connexion à l'app chauffeur : les offres passent alors par l'app (compte à rebours). */
  appLinkedAt?: string;
  /** Statistiques d'offres (taux d'acceptation affiché au chauffeur et à la console). */
  offersReceived?: number;
  offersAccepted?: number;
  offersDeclined?: number;
  offersExpired?: number;
  /** Courses annulées par le chauffeur lui-même (qualité de service, hors motif de sécurité). */
  cancellations?: number;
  /** Date de la photo du chauffeur (l'image elle-même est rangée à part : poste.ts). */
  photoUpdatedAt?: string;
}

/** Génère un matricule ORION lisible, ex. ORION-CI-4821. */
export function genMatricule(): string {
  return `ORION-CI-${Math.floor(1000 + Math.random() * 9000)}`;
}

/**
 * Magasin de chauffeurs. En production : PostgreSQL (état durable) + Redis (présence/geo).
 * Ici en mémoire pour tourner sans infra. L'index géo est injecté afin que la présence
 * (online + position) alimente directement le matching.
 */
export class DriverStore {
  private readonly drivers = new Map<string, Driver>();
  /** Notifié à chaque changement de fiche (app chauffeur synchronisée en direct). */
  private changeHandler?: (driver: Driver) => void;

  constructor(
    private readonly geo: GeoIndex,
    private readonly repo: Repository<Driver>,
  ) {
    // Réhydratation : recharge les chauffeurs persistés au démarrage.
    for (const d of repo.all()) this.drivers.set(d.id, d);
  }

  /**
   * Enregistre le handler de diffusion (appelé une fois au démarrage, cf. container) :
   * toute décision de la console (suspension motivée, avertissement, VIP, fidélité,
   * cantonnement…) est ainsi poussée en temps réel vers l'app du chauffeur concerné.
   */
  onChange(handler: (driver: Driver) => void): void {
    this.changeHandler = handler;
  }

  private changed(d: Driver): void {
    try {
      this.changeHandler?.(d);
    } catch {
      /* la diffusion ne doit jamais faire échouer une écriture */
    }
  }

  /** Persiste l'état courant d'un chauffeur (write-through). */
  persist(id: string): void {
    const d = this.drivers.get(id);
    if (d) {
      this.repo.put(d);
      this.changed(d);
    }
  }

  upsert(driver: Driver): Driver {
    this.drivers.set(driver.id, driver);
    this.repo.put(driver);
    this.changed(driver);
    return driver;
  }

  /** Recherche par téléphone (connexion app chauffeur). Comparaison sur chiffres seuls. */
  findByPhone(phone: string): Driver | undefined {
    const digits = phone.replace(/\D/g, '');
    if (!digits) return undefined;
    return [...this.drivers.values()].find((d) => d.phone !== undefined && d.phone.replace(/\D/g, '') === digits);
  }

  get(id: string): Driver | undefined {
    return this.drivers.get(id);
  }

  /** Tous les chauffeurs (supervision admin / flotte). */
  list(): Driver[] {
    return [...this.drivers.values()];
  }

  /** Le chauffeur passe en ligne et publie sa position dans l'index géo. */
  async goOnline(id: string, pos: LatLng): Promise<void> {
    const d = this.drivers.get(id);
    if (!d) return;
    d.availability = 'online';
    d.idleSince = new Date().toISOString(); // entre dans la file d'attente (dispatch FIFO)
    this.repo.put(d);
    this.changed(d);
    await this.geo.upsert({ id, lat: pos.lat, lng: pos.lng, meta: { category: d.category } });
  }

  async goOffline(id: string): Promise<void> {
    const d = this.drivers.get(id);
    if (d) {
      d.availability = 'offline';
      this.repo.put(d);
      this.changed(d);
    }
    await this.geo.remove(id);
  }

  /** Rafraîchit la position (heartbeat) — renouvelle le TTL de présence. */
  async updateLocation(id: string, pos: LatLng): Promise<void> {
    const d = this.drivers.get(id);
    if (!d || d.availability === 'offline') return;
    await this.geo.upsert({ id, lat: pos.lat, lng: pos.lng, meta: { category: d.category } });
  }

  setAvailability(id: string, availability: Availability): void {
    const d = this.drivers.get(id);
    if (d) {
      d.availability = availability;
      if (availability === 'online') d.idleSince = new Date().toISOString(); // re-entre dans la file
      this.repo.put(d);
      this.changed(d);
    }
  }
}
