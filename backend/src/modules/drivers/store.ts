import type { GeoIndex, LatLng } from '../../core/geo.js';
import type { Repository } from '../../core/db/repository.js';

export type Availability = 'offline' | 'online' | 'on_trip' | 'paused';
export type KycStatus = 'draft' | 'docs_submitted' | 'manual_review' | 'approved' | 'active' | 'suspended';

export interface Driver {
  id: string;
  name: string;
  kycStatus: KycStatus;
  availability: Availability;
  category: string;
  ratingAvg: number;
  ratingCount: number;
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

  /** Le chauffeur passe en ligne et publie sa position dans l'index géo. */
  async goOnline(id: string, pos: LatLng): Promise<void> {
    const d = this.drivers.get(id);
    if (!d) return;
    d.availability = 'online';
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
      this.repo.put(d);
    }
  }
}
