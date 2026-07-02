import type { GeoIndex, LatLng } from '../../core/geo.js';
import type { DriverStore, Driver } from '../drivers/store.js';

export interface MatchResult {
  driverId: string;
  distanceMeters: number;
  etaSeconds: number;
}

/** Contexte de dispatch fourni par la console (règles d'attribution pilotables). */
export interface DispatchContext {
  /** 'nearest' | 'longest_idle' | 'zone_queue' — cf. OpsConfig (console Admin). */
  strategy: string;
  /** Vrai si le point de prise en charge est dans une zone à file d'attente (aéroport…). */
  inQueueZone: (p: LatLng) => boolean;
}

interface Candidate { id: string; distanceMeters: number; driver: Driver }

/**
 * Moteur de matching géolocalisé (cf. docs/05 §3).
 *
 * Points clés de robustesse / scalabilité :
 *  - recherche par rayon croissant (on n'élargit que si nécessaire) ;
 *  - verrou d'assignation (lock NX) : un chauffeur ne peut être proposé qu'à une course à
 *    la fois → pas de double assignation en concurrence ;
 *  - s'appuie sur l'index géo abstrait (mémoire en dev, Redis en prod) ;
 *  - RÈGLE D'ATTRIBUTION PILOTABLE depuis la console :
 *      nearest       → minimise l'attente client (défaut) ;
 *      longest_idle  → le chauffeur qui attend depuis le plus longtemps (équité de revenus) ;
 *      zone_queue    → FIFO dans les zones denses (aéroport, gares), plus proche ailleurs.
 */
export class MatchingEngine {
  private readonly assignmentLocks = new Set<string>();

  constructor(
    private readonly geo: GeoIndex,
    private readonly drivers: DriverStore,
    private readonly radiiMeters: number[] = [1500, 3000, 6000],
    /** Fourni par le conteneur — la stratégie courante est relue à CHAQUE course. */
    private readonly dispatchCtx?: () => DispatchContext,
  ) {}

  /**
   * Priorisation technique (flotte verte) : un véhicule électrique n'est éligible
   * que si sa batterie couvre la distance estimée (~1 % par km + réserve de 10 %).
   */
  private hasRangeFor(driver: Driver, rideDistanceMeters?: number): boolean {
    if (driver.engine !== 'electric' || driver.batteryPct === undefined || !rideDistanceMeters) return true;
    const neededPct = 10 + (rideDistanceMeters / 1000) * 1;
    return driver.batteryPct >= neededPct;
  }

  async findDriver(origin: LatLng, category?: string, rideDistanceMeters?: number): Promise<MatchResult | null> {
    const ctx = this.dispatchCtx?.();
    const strategy = ctx?.strategy ?? 'nearest';
    // Règles d'ÉQUITÉ (FIFO) : le rayon max est considéré d'emblée, sinon un chauffeur
    // qui attend depuis longtemps mais un peu plus loin ne serait jamais servi.
    const fifo = strategy === 'longest_idle' || (strategy === 'zone_queue' && ctx?.inQueueZone(origin) === true);
    const radii = fifo ? [this.radiiMeters[this.radiiMeters.length - 1]!] : this.radiiMeters;

    for (const radius of radii) {
      const nearby = await this.geo.nearby(origin, radius, 20);
      // Tous les candidats éligibles du rayon courant (pas seulement le premier).
      const candidates: Candidate[] = [];
      for (const c of nearby) {
        if (category && c.meta?.['category'] !== category) continue;
        const driver = this.drivers.get(c.id);
        if (!driver || driver.availability !== 'online') continue;
        if (this.assignmentLocks.has(c.id)) continue; // déjà réservé (lock)
        if (!this.hasRangeFor(driver, rideDistanceMeters)) continue; // batterie insuffisante
        candidates.push({ id: c.id, distanceMeters: c.distanceMeters, driver });
      }
      if (candidates.length === 0) continue;

      const chosen = this.pick(candidates, fifo);
      this.assignmentLocks.add(chosen.id);
      return {
        driverId: chosen.id,
        distanceMeters: Math.round(chosen.distanceMeters),
        etaSeconds: Math.round((chosen.distanceMeters / 1000 / 28) * 3600),
      };
    }
    return null;
  }

  /** Applique la règle d'attribution configurée (console → OpsConfig). */
  private pick(candidates: Candidate[], fifo: boolean): Candidate {
    if (fifo) {
      // FIFO : le plus ancien en attente d'abord (équité de revenus).
      return [...candidates].sort((a, b) => (a.driver.idleSince ?? '9999').localeCompare(b.driver.idleSince ?? '9999'))[0]!;
    }
    return [...candidates].sort((a, b) => a.distanceMeters - b.distanceMeters)[0]!;
  }

  /** Libère le verrou (refus, timeout, ou fin de course). */
  releaseLock(driverId: string): void {
    this.assignmentLocks.delete(driverId);
  }
}
