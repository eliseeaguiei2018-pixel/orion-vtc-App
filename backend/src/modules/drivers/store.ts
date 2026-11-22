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
  /* --- Chauffeur salarié : activité du mois et prime de performance --- */
  /** Minutes en service (en ligne ou en course) par jour, `AAAA-MM-JJ` → minutes. */
  minutesService?: Record<string, number>;
  /** Début de la période en service en cours (ms), absent hors service. */
  enServiceDepuis?: number;
  /** Offres par mois (`AAAA-MM`) : reçues, acceptées, refusées, expirées. */
  offresParMois?: Record<string, { recues: number; acceptees: number; refusees: number; expirees: number }>;
  /** Annulations du chauffeur par mois (`AAAA-MM`), hors motif de sécurité. */
  annulationsParMois?: Record<string, number>;
}

/** Statuts comptés « en service » pour la prime (en ligne ou en course). */
const EN_SERVICE: ReadonlySet<Availability> = new Set<Availability>(['online', 'on_trip']);
/** Sans signe de vie (position) depuis 2 min, le temps n'est plus compté en service. */
const SILENCE_MAX_MS = 120_000;
const jourDe = (ms: number) => new Date(ms).toISOString().slice(0, 10);
export const moisDe = (ms: number) => new Date(ms).toISOString().slice(0, 7);

/** Ajoute la période [debut, fin] (ms) aux minutes de service, jour par jour (heure d'Abidjan = UTC). */
function ajouterService(d: Driver, debut: number, fin: number): void {
  if (fin <= debut) return;
  const parJour = d.minutesService ?? (d.minutesService = {});
  let t = debut;
  while (t < fin) {
    const minuit = Date.UTC(new Date(t).getUTCFullYear(), new Date(t).getUTCMonth(), new Date(t).getUTCDate() + 1);
    const bout = Math.min(fin, minuit);
    const k = jourDe(t);
    parJour[k] = Math.round(((parJour[k] ?? 0) + (bout - t) / 60_000) * 10) / 10;
    t = bout;
  }
  // On ne garde que 13 mois d'historique (la prime porte sur le mois en cours ou passé).
  const cles = Object.keys(parJour);
  if (cles.length > 400) for (const k of cles.sort().slice(0, cles.length - 400)) delete parJour[k];
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
  /** Index téléphone (chiffres seuls) → chauffeur : la connexion ne parcourt plus toute la flotte. */
  private readonly parTelephone = new Map<string, string>();
  /** Dernier signe de vie (position reçue, ms) — mémoire seule, jamais persisté. */
  private readonly vuLe = new Map<string, number>();
  /** Notifié à chaque changement de fiche (app chauffeur synchronisée en direct). */
  private changeHandler?: (driver: Driver) => void;

  constructor(
    private readonly geo: GeoIndex,
    private readonly repo: Repository<Driver>,
  ) {
    // Réhydratation : recharge les chauffeurs persistés au démarrage.
    for (const d of repo.all()) {
      // Après un redémarrage, une période « en service » ouverte n'a plus de signe de vie :
      // elle est close (le chauffeur repassera en ligne depuis son app).
      if (d.enServiceDepuis) d.enServiceDepuis = undefined;
      this.drivers.set(d.id, d);
      this.indexerTelephone(d);
    }
  }

  private indexerTelephone(d: Driver): void {
    const chiffres = d.phone?.replace(/\D/g, '');
    if (chiffres) this.parTelephone.set(chiffres, d.id);
  }

  /**
   * Temps en service : ouvre la période quand le chauffeur passe en ligne ou en course,
   * la referme (et la compte jour par jour) quand il passe en pause ou hors ligne.
   */
  private noterService(d: Driver, apres: Availability): void {
    const maintenant = Date.now();
    if (EN_SERVICE.has(apres)) {
      d.enServiceDepuis ??= maintenant;
      return;
    }
    if (d.enServiceDepuis) {
      ajouterService(d, d.enServiceDepuis, this.finDeService(d.id, maintenant));
      d.enServiceDepuis = undefined;
    }
  }

  /** Fin réelle d'une période en service : sans position depuis 2 min, on s'arrête au dernier signe de vie. */
  private finDeService(id: string, maintenant: number): number {
    const vu = this.vuLe.get(id);
    return vu !== undefined && maintenant - vu > SILENCE_MAX_MS ? vu + 60_000 : maintenant;
  }

  /** Minutes en service entre deux instants (ms), période en cours comprise. */
  minutesDeService(id: string, debut: number, fin: number): { total: number; parJour: Record<string, number> } {
    const d = this.drivers.get(id);
    const parJour: Record<string, number> = {};
    if (!d) return { total: 0, parJour };
    const de = jourDe(debut), a = jourDe(fin - 1);
    for (const [k, m] of Object.entries(d.minutesService ?? {})) if (k >= de && k <= a) parJour[k] = m;
    if (d.enServiceDepuis) {
      const copie: Driver = { ...d, minutesService: {} };
      ajouterService(copie, Math.max(debut, d.enServiceDepuis), Math.min(fin, this.finDeService(id, Date.now())));
      for (const [k, m] of Object.entries(copie.minutesService ?? {})) parJour[k] = Math.round(((parJour[k] ?? 0) + m) * 10) / 10;
    }
    return { total: Object.values(parJour).reduce((s, m) => s + m, 0), parJour };
  }

  /** Compte une offre du mois (reçue, acceptée, refusée, expirée) — prime de performance. */
  noterOffre(id: string, quoi: 'recues' | 'acceptees' | 'refusees' | 'expirees'): void {
    const d = this.drivers.get(id);
    if (!d) return;
    const mois = moisDe(Date.now());
    const parMois = d.offresParMois ?? (d.offresParMois = {});
    const m = parMois[mois] ?? (parMois[mois] = { recues: 0, acceptees: 0, refusees: 0, expirees: 0 });
    m[quoi] += 1;
    const cles = Object.keys(parMois);
    if (cles.length > 13) for (const k of cles.sort().slice(0, cles.length - 13)) delete parMois[k];
  }

  /** Compte une annulation du chauffeur dans le mois en cours. */
  noterAnnulation(id: string): void {
    const d = this.drivers.get(id);
    if (!d) return;
    const mois = moisDe(Date.now());
    const parMois = d.annulationsParMois ?? (d.annulationsParMois = {});
    parMois[mois] = (parMois[mois] ?? 0) + 1;
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
    this.indexerTelephone(driver);
    this.repo.put(driver);
    this.changed(driver);
    return driver;
  }

  /** Recherche par téléphone (connexion app chauffeur). Comparaison sur chiffres seuls. */
  findByPhone(phone: string): Driver | undefined {
    const digits = phone.replace(/\D/g, '');
    if (!digits) return undefined;
    const id = this.parTelephone.get(digits);
    const indexe = id ? this.drivers.get(id) : undefined;
    if (indexe && indexe.phone?.replace(/\D/g, '') === digits) return indexe;
    // Numéro changé depuis l'indexation (fiche modifiée sans passer par upsert) : recherche complète.
    const trouve = [...this.drivers.values()].find((d) => d.phone !== undefined && d.phone.replace(/\D/g, '') === digits);
    if (trouve) this.indexerTelephone(trouve);
    return trouve;
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
    this.vuLe.set(id, Date.now());
    this.noterService(d, 'online');
    this.repo.put(d);
    this.changed(d);
    await this.geo.upsert({ id, lat: pos.lat, lng: pos.lng, meta: { category: d.category } });
  }

  async goOffline(id: string): Promise<void> {
    const d = this.drivers.get(id);
    if (d) {
      this.noterService(d, 'offline');
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
    const vu = this.vuLe.get(id);
    this.vuLe.set(id, Date.now());
    // Retour après un long silence (réseau coupé) : le temps muet n'est pas compté en service.
    if (d.enServiceDepuis && vu !== undefined && Date.now() - vu > SILENCE_MAX_MS) {
      ajouterService(d, d.enServiceDepuis, vu + 60_000);
      d.enServiceDepuis = Date.now();
    }
    await this.geo.upsert({ id, lat: pos.lat, lng: pos.lng, meta: { category: d.category } });
  }

  setAvailability(id: string, availability: Availability): void {
    const d = this.drivers.get(id);
    if (d) {
      this.noterService(d, availability);
      d.availability = availability;
      if (availability === 'online') d.idleSince = new Date().toISOString(); // re-entre dans la file
      this.repo.put(d);
      this.changed(d);
    }
  }
}
