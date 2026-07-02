import { config } from '../../config/index.js';
import type { LatLng } from '../../core/geo.js';
import { rideRoom, type RealtimeHub } from '../realtime/hub.js';
import { rideStateMachine, type RideStatus } from '../services/ride/stateMachine.js';
import type { Ride, RideStore } from './store.js';

const lerp = (a: LatLng, b: LatLng, t: number): LatLng => ({
  lat: a.lat + (b.lat - a.lat) * t,
  lng: a.lng + (b.lng - a.lng) * t,
});

/**
 * Simulateur de course (aide de développement).
 *
 * En attendant l'application chauffeur (projet séparé), le serveur simule le déplacement
 * du chauffeur assigné et publie les mêmes événements temps réel qu'une vraie app
 * chauffeur produirait : `driver.location` (position) et `ride.status` (transitions).
 * L'app cliente reçoit donc un tracking 100% piloté par le serveur via WebSocket.
 *
 * Quand l'app chauffeur sera là, il suffira de couper `SIMULATE_RIDES` : le reste du
 * système (WebSocket, rooms, états) ne change pas.
 */
export interface SimulatorOptions {
  enabled: boolean;
  tickMs: number;
  enrouteMs: number;
  tripMs: number;
  pauseMs: number;
}

export class RideSimulator {
  private readonly timers = new Set<ReturnType<typeof setInterval>>();
  private readonly opts: SimulatorOptions;

  constructor(
    private readonly rides: RideStore,
    private readonly realtime: RealtimeHub,
    opts: Partial<SimulatorOptions> = {},
  ) {
    this.opts = {
      enabled: config.SIMULATE_RIDES,
      tickMs: config.SIM_TICK_MS,
      enrouteMs: config.SIM_ENROUTE_MS,
      tripMs: config.SIM_TRIP_MS,
      pauseMs: 1500,
      ...opts,
    };
  }

  /** Démarre la simulation d'une course déjà acceptée (chauffeur assigné). */
  start(ride: Ride): void {
    if (!this.opts.enabled || !ride.driverId) return;

    // Le chauffeur démarre à proximité, puis rejoint le point de départ.
    const driverStart: LatLng = { lat: ride.origin.lat - 0.012, lng: ride.origin.lng - 0.009 };

    this.transition(ride, 'driver_en_route');
    this.animate(ride, driverStart, ride.origin, this.opts.enrouteMs, () => {
      this.transition(ride, 'arrived');
      // Courte pause "à l'arrêt" puis départ.
      const pause = setTimeout(() => {
        this.transition(ride, 'in_progress');
        this.animate(ride, ride.origin, ride.destination, this.opts.tripMs, () => {
          this.transition(ride, 'completed');
        });
      }, this.opts.pauseMs);
      pause.unref?.();
    });
  }

  /** Interpole la position entre deux points et publie `driver.location`. */
  private animate(ride: Ride, from: LatLng, to: LatLng, durationMs: number, onDone: () => void): void {
    const startedAt = Date.now();
    const timer = setInterval(() => {
      // La course peut avoir été annulée entre-temps.
      const current = this.rides.get(ride.id);
      if (!current || current.status === 'cancelled') {
        this.clear(timer);
        return;
      }
      const t = Math.min(1, (Date.now() - startedAt) / durationMs);
      const pos = lerp(from, to, t);
      // Tracé GPS conservé sur la course (borné) — sert à l'instruction des litiges.
      current.trace ??= [];
      if (current.trace.length < 200) current.trace.push({ lat: pos.lat, lng: pos.lng });
      this.realtime.publish(rideRoom(ride.id), 'driver.location', { driverId: ride.driverId, position: pos });
      if (t >= 1) {
        this.clear(timer);
        onDone();
      }
    }, this.opts.tickMs);
    timer.unref?.();
    this.timers.add(timer);
  }

  private transition(ride: Ride, to: RideStatus): void {
    const current = this.rides.get(ride.id);
    if (!current || !rideStateMachine.canTransition(current.status, to)) return;
    current.status = to;
    current.events.push({ type: to, at: new Date().toISOString() });
    this.rides.persist(current);
    this.realtime.publish(rideRoom(ride.id), 'ride.status', { rideId: ride.id, status: to });
  }

  private clear(timer: ReturnType<typeof setInterval>): void {
    clearInterval(timer);
    this.timers.delete(timer);
  }

  /** Arrête tous les timers (arrêt en douceur). */
  stopAll(): void {
    for (const t of this.timers) clearInterval(t);
    this.timers.clear();
  }
}
