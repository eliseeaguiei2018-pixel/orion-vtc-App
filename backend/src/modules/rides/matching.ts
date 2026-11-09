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
  /** Filtre ETA (minutes) : chauffeur exclu si son temps d'approche dépasse ce seuil. */
  maxEtaMinutes?: number;
  /** Micro-zonage : zone de prise en charge (id + standard minimal exigé). */
  originZone?: { id: string; minStandard?: string } | null;
  /** Rayons de recherche évolutifs (m) — pilotés par la console (radiusKm → radiusMaxKm). */
  radiiMeters?: number[];
  /** Pondération du scoring d'attribution (0 = distance pure, comportement historique). */
  weightRating?: number;
  weightIdle?: number;
  /** Priorisation écologique absolue : l'électrique passe d'abord à ETA comparable. */
  greenPriority?: boolean;
}

/** Rang des niveaux (standard minimal de secteur). */
const TIER_RANK: Record<string, number> = { bronze: 0, argent: 1, or: 2, diamant: 3 };

/** Vitesse d'approche urbaine présumée pour l'ETA chauffeur (km/h). */
const APPROACH_SPEED_KMH = 28;

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
  /** Désappariement (qualité) : paires client|chauffeur plus jamais mises en relation. */
  private readonly blockedPairs = new Set<string>();

  constructor(
    private readonly geo: GeoIndex,
    private readonly drivers: DriverStore,
    private readonly radiiMeters: number[] = [1500, 3000, 6000],
    /** Fourni par le conteneur — la stratégie courante est relue à CHAQUE course. */
    private readonly dispatchCtx?: (origin: LatLng) => DispatchContext,
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

  /** Après une note 1–2★, ces deux usagers ne seront plus jamais mis en relation. */
  blockPair(clientId: string, driverId: string): void {
    this.blockedPairs.add(`${clientId}|${driverId}`);
  }

  isBlockedPair(clientId: string, driverId: string): boolean {
    return this.blockedPairs.has(`${clientId}|${driverId}`);
  }

  async findDriver(
    origin: LatLng,
    category?: string,
    rideDistanceMeters?: number,
    clientId?: string,
    /** Filtre d'éligibilité supplémentaire (ex. plafond de dette espèces). */
    eligible?: (driver: Driver) => boolean,
  ): Promise<MatchResult | null> {
    const ctx = this.dispatchCtx?.(origin);
    const strategy = ctx?.strategy ?? 'nearest';
    const baseRadii = ctx?.radiiMeters?.length ? ctx.radiiMeters : this.radiiMeters;
    // Règles d'ÉQUITÉ (FIFO) : le rayon max est considéré d'emblée, sinon un chauffeur
    // qui attend depuis longtemps mais un peu plus loin ne serait jamais servi.
    const fifo = strategy === 'longest_idle' || (strategy === 'zone_queue' && ctx?.inQueueZone(origin) === true);
    const radii = fifo ? [baseRadii[baseRadii.length - 1]!] : baseRadii;

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
        // Désappariement qualité : jamais réapparier après une note 1–2★.
        if (clientId && this.blockedPairs.has(`${clientId}|${c.id}`)) continue;
        if (eligible && !eligible(driver)) continue; // ex. dette espèces au-delà du plafond
        // Cantonnement : un chauffeur épinglé à une zone n'est matché QUE dans celle-ci.
        if (driver.zoneLockId && ctx?.originZone?.id !== driver.zoneLockId) continue;
        // Standard minimal du secteur (Riviera Golf exige ≥ argent, Beverly Hills ≥ or…).
        if (ctx?.originZone?.minStandard) {
          const need = TIER_RANK[ctx.originZone.minStandard] ?? 0;
          if ((TIER_RANK[driver.category] ?? 0) < need) continue;
        }
        // Filtre ETA : au-delà du seuil (console), le client attendrait trop.
        if (ctx?.maxEtaMinutes !== undefined) {
          const etaMin = (c.distanceMeters / 1000 / APPROACH_SPEED_KMH) * 60;
          if (etaMin > ctx.maxEtaMinutes) continue;
        }
        candidates.push({ id: c.id, distanceMeters: c.distanceMeters, driver });
      }
      if (candidates.length === 0) continue;

      const chosen = this.pick(candidates, fifo, ctx);
      this.assignmentLocks.add(chosen.id);
      return {
        driverId: chosen.id,
        distanceMeters: Math.round(chosen.distanceMeters),
        etaSeconds: Math.round((chosen.distanceMeters / 1000 / APPROACH_SPEED_KMH) * 3600),
      };
    }
    return null;
  }

  /** Applique la règle d'attribution configurée (console → OpsConfig). */
  private pick(candidates: Candidate[], fifo: boolean, ctx?: DispatchContext): Candidate {
    if (fifo) {
      // FIFO : le plus ancien en attente d'abord (équité de revenus).
      return [...candidates].sort((a, b) => (a.driver.idleSince ?? '9999').localeCompare(b.driver.idleSince ?? '9999'))[0]!;
    }
    // SCORING PONDÉRÉ (console) : distance de base, moins des bonus note / ancienneté
    // d'attente / motorisation propre. Poids à 0 → distance pure (comportement historique).
    const wr = ctx?.weightRating ?? 0;
    const wi = ctx?.weightIdle ?? 0;
    const score = (c: Candidate): number => {
      const etaMin = (c.distanceMeters / 1000 / APPROACH_SPEED_KMH) * 60;
      const idleMin = c.driver.idleSince ? Math.max(0, (Date.now() - Date.parse(c.driver.idleSince)) / 60_000) : 0;
      let s = etaMin;
      s -= wr * (c.driver.ratingAvg - 4.5) * 2;                 // privilégie un 4.9 face à un 4.2
      s -= wi * Math.min(idleMin, 120) / 30;                    // favorise le chauffeur inactif (lissage revenus)
      if (ctx?.greenPriority && (c.driver.engine ?? 'electric') === 'electric') s -= 2; // priorité écologique absolue
      if (c.driver.vip) s -= 0.5;                               // Top Driver : priorité dispatch
      return s;
    };
    return [...candidates].sort((a, b) => score(a) - score(b))[0]!;
  }

  /** Libère le verrou (refus, timeout, ou fin de course). */
  releaseLock(driverId: string): void {
    this.assignmentLocks.delete(driverId);
  }
}
