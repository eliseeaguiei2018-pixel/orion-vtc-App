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

  constructor(
    private readonly geo: GeoIndex,
    private readonly repo: Repository<Driver>,
  ) {
    // Réhydratation : recharge les chauffeurs persistés au démarrage.
    for (const d of repo.all()) this.drivers.set(d.id, d);
  }

  /** Persiste l'état courant d'un chauffeur (write-through). */
  persist(id: string): void {
    const d = this.drivers.get(id);
    if (d) this.repo.put(d);
  }

  upsert(driver: Driver): Driver {
    this.drivers.set(driver.id, driver);
    this.repo.put(driver);
    return driver;
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
    await this.geo.upsert({ id, lat: pos.lat, lng: pos.lng, meta: { category: d.category } });
  }

  async goOffline(id: string): Promise<void> {
    const d = this.drivers.get(id);
    if (d) {
      d.availability = 'offline';
      this.repo.put(d);
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
    }
  }
}
