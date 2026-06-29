import type { GeoIndex, LatLng } from '../../core/geo.js';
import type { DriverStore } from '../drivers/store.js';

export interface MatchResult {
  driverId: string;
  distanceMeters: number;
  etaSeconds: number;
}

/**
 * Moteur de matching géolocalisé (cf. docs/05 §3).
 *
 * Points clés de robustesse / scalabilité :
 *  - recherche par rayon croissant (on n'élargit que si nécessaire) ;
 *  - verrou d'assignation (lock NX) : un chauffeur ne peut être proposé qu'à une course à
 *    la fois → pas de double assignation en concurrence ;
 *  - s'appuie sur l'index géo abstrait (mémoire en dev, Redis en prod).
 */
export class MatchingEngine {
  private readonly assignmentLocks = new Set<string>();

  constructor(
    private readonly geo: GeoIndex,
    private readonly drivers: DriverStore,
    private readonly radiiMeters: number[] = [1500, 3000, 6000],
  ) {}

  async findDriver(origin: LatLng, category?: string): Promise<MatchResult | null> {
    for (const radius of this.radiiMeters) {
      const candidates = await this.geo.nearby(origin, radius, 20);
      for (const c of candidates) {
        if (category && c.meta?.['category'] !== category) continue;
        const driver = this.drivers.get(c.id);
        if (!driver || driver.availability !== 'online') continue;
        if (this.assignmentLocks.has(c.id)) continue; // déjà réservé (lock)
        this.assignmentLocks.add(c.id);
        return {
          driverId: c.id,
          distanceMeters: Math.round(c.distanceMeters),
          etaSeconds: Math.round((c.distanceMeters / 1000 / 28) * 3600),
        };
      }
    }
    return null;
  }

  /** Libère le verrou (refus, timeout, ou fin de course). */
  releaseLock(driverId: string): void {
    this.assignmentLocks.delete(driverId);
  }
}
