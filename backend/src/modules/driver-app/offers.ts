import type { Container } from '../../container.js';
import { badRequest, conflict, notFound } from '../../core/errors.js';
import { driverRoom, rideRoom } from '../realtime/hub.js';
import type { Ride } from '../rides/store.js';
import { driverRideView } from './views.js';
import { categorieDeFlotte } from '../rides/matching.js';

/**
 * OFFRES DE COURSE (app chauffeur).
 *
 * L'attribution immédiate existante est CONSERVÉE (le client voit un chauffeur tout de
 * suite). Si ce chauffeur utilise l'app, la course lui est présentée comme une OFFRE à
 * confirmer dans le délai réglé en console (`offerTimeoutSec`, 10–15 s) :
 *  - il accepte → la course est confirmée (événement `driver_confirmed`) ;
 *  - il refuse, ou laisse expirer → réattribution AUTOMATIQUE au chauffeur suivant
 *    (cascade, en excluant ceux qui ont déjà refusé) ; le client est prévenu en direct
 *    (`ride.reassigned`). Sans aucun chauffeur disponible, la course est annulée sans frais.
 * Un chauffeur qui laisse expirer une offre est mis en PAUSE (il n'est plus sollicité tant
 * qu'il ne se remet pas en ligne). Les chauffeurs démo (sans app) gardent le comportement
 * historique (simulateur).
 */
export interface Offer {
  rideId: string;
  driverId: string;
  expiresAt: string;
  timeoutSec: number;
  status: 'pending' | 'accepted' | 'declined' | 'expired' | 'withdrawn';
}

const registry = new WeakMap<Container, OfferService>();

/** Service d'offres associé à un conteneur (une instance par application). */
export function offersOf(container: Container): OfferService {
  let s = registry.get(container);
  if (!s) {
    s = new OfferService(container);
    registry.set(container, s);
  }
  return s;
}

/** Le chauffeur utilise-t-il l'app (s'est connecté au moins une fois) ? */
export const isAppDriver = (container: Container, driverId: string | undefined): boolean =>
  Boolean(driverId && container.drivers.get(driverId)?.appLinkedAt);

export class OfferService {
  private readonly offers = new Map<string, Offer>();
  private readonly timers = new Map<string, ReturnType<typeof setTimeout>>();
  /** Chauffeurs ayant déjà refusé / laissé expirer une course (jamais re-sollicités). */
  private readonly declined = new Map<string, Set<string>>();

  constructor(private readonly c: Container) {}

  get(rideId: string): Offer | undefined {
    return this.offers.get(rideId);
  }

  /** Offre en attente pour ce chauffeur (reprise de l'app). */
  pendingFor(driverId: string): Offer | undefined {
    return [...this.offers.values()].find((o) => o.driverId === driverId && o.status === 'pending');
  }

  /** Ouvre une offre au chauffeur affecté (si app chauffeur) et arme le compte à rebours. */
  open(ride: Ride): Offer | null {
    if (!ride.driverId || !isAppDriver(this.c, ride.driverId)) return null;
    this.clearTimer(ride.id);
    const timeoutSec = this.c.settings.getOps().offerTimeoutSec;
    const offer: Offer = {
      rideId: ride.id, driverId: ride.driverId, timeoutSec, status: 'pending',
      expiresAt: new Date(Date.now() + timeoutSec * 1000).toISOString(),
    };
    this.offers.set(ride.id, offer);
    ride.events.push({ type: 'offered', at: new Date().toISOString(), payload: { driverId: ride.driverId, timeoutSec } });
    this.c.rides.persist(ride);
    this.bump(ride.driverId, 'offersReceived');
    const timer = setTimeout(() => { void this.expire(ride.id); }, timeoutSec * 1000);
    timer.unref?.();
    this.timers.set(ride.id, timer);
    return offer;
  }

  /** Le chauffeur accepte : course confirmée. */
  accept(driverId: string, rideId: string): Offer {
    const { offer, ride } = this.pending(driverId, rideId);
    this.clearTimer(rideId);
    offer.status = 'accepted';
    ride.events.push({ type: 'driver_confirmed', at: new Date().toISOString(), payload: { driverId } });
    this.c.rides.persist(ride);
    this.bump(driverId, 'offersAccepted');
    this.c.realtime.publish(rideRoom(rideId), 'ride.driver_confirmed', { rideId, driverId });
    return offer;
  }

  /** Le chauffeur refuse : réattribution en cascade. Il reste en ligne. */
  async decline(driverId: string, rideId: string, reason?: string): Promise<{ reassignedTo: string | null }> {
    const { offer, ride } = this.pending(driverId, rideId);
    this.clearTimer(rideId);
    offer.status = 'declined';
    this.bump(driverId, 'offersDeclined');
    this.c.matching.releaseLock(driverId);
    this.c.drivers.setAvailability(driverId, 'online');
    return this.reassign(ride, driverId, 'declined', reason);
  }

  /** Délai écoulé sans réponse : chauffeur mis en pause, réattribution. */
  private async expire(rideId: string): Promise<void> {
    this.timers.delete(rideId);
    const offer = this.offers.get(rideId);
    const ride = this.c.rides.get(rideId);
    if (!offer || offer.status !== 'pending' || !ride) return;
    // La course a avancé (le chauffeur est en route) ou a été annulée : rien à faire.
    if (ride.status !== 'accepted' || ride.driverId !== offer.driverId) {
      offer.status = ride.status === 'cancelled' ? 'withdrawn' : 'accepted';
      return;
    }
    offer.status = 'expired';
    this.bump(offer.driverId, 'offersExpired');
    this.c.matching.releaseLock(offer.driverId);
    this.c.drivers.setAvailability(offer.driverId, 'paused');
    this.c.notifications.notify({ driverId: offer.driverId }, 'Offre manquée',
      'Vous avez été mis en pause faute de réponse. Repassez en ligne pour recevoir des courses.');
    await this.reassign(ride, offer.driverId, 'expired');
  }

  /** Retire l'offre (console : réassignation manuelle, annulation). */
  withdraw(rideId: string, reason: string): void {
    const offer = this.offers.get(rideId);
    this.clearTimer(rideId);
    if (offer && offer.status === 'pending') offer.status = 'withdrawn';
    if (offer) this.c.realtime.publish(driverRoom(offer.driverId), 'ride.withdrawn', { rideId, reason });
  }

  /** Cherche le chauffeur suivant (cascade) en excluant ceux qui ont déjà décliné. */
  private async reassign(ride: Ride, previous: string, why: 'declined' | 'expired', reason?: string): Promise<{ reassignedTo: string | null }> {
    const excluded = this.declined.get(ride.id) ?? new Set<string>();
    excluded.add(previous);
    this.declined.set(ride.id, excluded);
    this.c.realtime.publish(driverRoom(previous), 'ride.withdrawn', { rideId: ride.id, reason: why });

    const cashCap = ride.paymentMethod === 'cash' ? this.c.settings.getOps().cashDebtLimit : undefined;
    const match = await this.c.matching.findDriver(
      ride.origin, categorieDeFlotte(ride.serviceType, ride.quote.category), ride.quote.distanceMeters, ride.clientId,
      (d) => !excluded.has(d.id) && (cashCap === undefined || this.c.wallet.balance(d.id) >= -cashCap),
    );
    const now = new Date().toISOString();
    if (!match) {
      // Personne d'autre : annulation SANS frais, le client est prévenu.
      ride.driverId = undefined;
      ride.status = 'cancelled';
      ride.events.push({ type: 'no_driver', at: now, payload: { previous, why, reason } });
      this.c.rides.persist(ride);
      this.c.realtime.publish(rideRoom(ride.id), 'ride.status', { rideId: ride.id, status: 'cancelled', reason: 'no_driver' });
      return { reassignedTo: null };
    }
    ride.driverId = match.driverId;
    this.c.drivers.setAvailability(match.driverId, 'on_trip');
    ride.events.push({ type: 'reassigned', at: now, payload: { previous, next: match.driverId, why, reason, etaSeconds: match.etaSeconds } });
    this.c.rides.persist(ride);
    const d = this.c.drivers.get(match.driverId);
    this.c.realtime.publish(rideRoom(ride.id), 'ride.reassigned', {
      rideId: ride.id,
      driver: d ? { name: d.name, matricule: d.matricule, ratingAvg: d.ratingAvg, ratingCount: d.ratingCount } : null,
      etaSeconds: match.etaSeconds,
    });
    // Nouveau chauffeur : offre (app) ou comportement historique (démo / simulateur).
    publishAssignment(this.c, ride, match.etaSeconds);
    if (!isAppDriver(this.c, match.driverId)) this.c.simulator.start(ride);
    return { reassignedTo: match.driverId };
  }

  private pending(driverId: string, rideId: string): { offer: Offer; ride: Ride } {
    const offer = this.offers.get(rideId);
    const ride = this.c.rides.get(rideId);
    if (!offer || !ride) throw notFound('Offre introuvable');
    if (offer.driverId !== driverId) throw badRequest('Cette offre ne vous est pas destinée');
    if (offer.status !== 'pending') throw conflict(`Offre déjà traitée (${offer.status})`);
    // Offre plus d'actualité : course annulée, retirée ou déjà démarrée par ce chauffeur.
    if (ride.driverId !== driverId || ride.status !== 'accepted') {
      offer.status = ride.driverId === driverId && ride.status !== 'cancelled' ? 'accepted' : 'withdrawn';
      this.clearTimer(rideId);
      throw conflict('Cette offre n’est plus d’actualité');
    }
    return { offer, ride };
  }

  private bump(driverId: string, key: 'offersReceived' | 'offersAccepted' | 'offersDeclined' | 'offersExpired'): void {
    const d = this.c.drivers.get(driverId);
    if (!d) return;
    d[key] = (d[key] ?? 0) + 1;
    this.c.drivers.persist(driverId);
  }

  private clearTimer(rideId: string): void {
    const t = this.timers.get(rideId);
    if (t) clearTimeout(t);
    this.timers.delete(rideId);
  }

  /** Arrêt en douceur : coupe tous les comptes à rebours. */
  stopAll(): void {
    for (const t of this.timers.values()) clearTimeout(t);
    this.timers.clear();
  }
}

/**
 * Diffuse l'affectation d'une course au chauffeur (room personnelle) et, s'il utilise
 * l'app, ouvre l'OFFRE à confirmer avec le compte à rebours réglé en console.
 */
export function publishAssignment(container: Container, ride: Ride, etaSeconds?: number): void {
  if (!ride.driverId) return;
  const offer = offersOf(container).open(ride);
  container.realtime.publish(driverRoom(ride.driverId), 'ride.assigned', {
    ride: driverRideView(ride, container, ride.driverId),
    etaToPickupSeconds: etaSeconds ?? null,
    offer: offer ? { expiresAt: offer.expiresAt, timeoutSec: offer.timeoutSec } : null,
    // Le suivi de la course (positions, statuts, annulation client) reste le canal
    // existant /ws/rides/:id, partagé avec l'app cliente.
    rideChannel: `/ws/rides/${ride.id}`,
  });
}

/**
 * Réassignation MANUELLE depuis la console : l'ancien chauffeur est prévenu que la course
 * lui est retirée, le client voit le nouveau chauffeur, le nouveau reçoit l'offre.
 */
export function consoleReassigned(container: Container, ride: Ride, previous: string | null): void {
  const service = offersOf(container);
  const offer = service.get(ride.id);
  service.withdraw(ride.id, 'console');
  if (previous && offer?.driverId !== previous) {
    container.realtime.publish(driverRoom(previous), 'ride.withdrawn', { rideId: ride.id, reason: 'console' });
  }
  const d = ride.driverId ? container.drivers.get(ride.driverId) : undefined;
  container.realtime.publish(rideRoom(ride.id), 'ride.reassigned', {
    rideId: ride.id,
    driver: d ? { name: d.name, matricule: d.matricule, ratingAvg: d.ratingAvg, ratingCount: d.ratingCount } : null,
    etaSeconds: null,
  });
  publishAssignment(container, ride);
}

/** Clôture FORCÉE depuis la console : offre retirée, client et chauffeur prévenus. */
export function consoleForced(container: Container, ride: Ride): void {
  offersOf(container).withdraw(ride.id, 'console');
  container.realtime.publish(rideRoom(ride.id), 'ride.status', { rideId: ride.id, status: ride.status, reason: 'console' });
}
