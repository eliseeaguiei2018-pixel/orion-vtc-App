import type { Quote } from '../services/types.js';
import type { LatLng } from '../../core/geo.js';
import type { RideStatus } from '../services/ride/stateMachine.js';

export interface Ride {
  id: string;
  clientId: string;
  driverId?: string;
  serviceType: string;
  status: RideStatus;
  origin: LatLng;
  destination: LatLng;
  quote: Quote;
  events: RideEvent[];
  createdAt: string;
}

export interface RideEvent {
  type: string;
  at: string;
  payload?: Record<string, unknown>;
}

/**
 * Magasin des courses + devis verrouillés. En production : PostgreSQL.
 * Les devis sont conservés par lockId pour garantir le prix verrouillé
 * (le client ne peut pas créer une course à un prix différent de l'estimation).
 */
export class RideStore {
  private readonly rides = new Map<string, Ride>();
  private readonly quotes = new Map<string, Quote>();

  saveQuote(quote: Quote): void {
    this.quotes.set(quote.lockId, quote);
  }

  getQuote(lockId: string): Quote | undefined {
    return this.quotes.get(lockId);
  }

  consumeQuote(lockId: string): Quote | undefined {
    const q = this.quotes.get(lockId);
    if (q) this.quotes.delete(lockId);
    return q;
  }

  save(ride: Ride): Ride {
    this.rides.set(ride.id, ride);
    return ride;
  }

  get(id: string): Ride | undefined {
    return this.rides.get(id);
  }

  listByClient(clientId: string): Ride[] {
    return [...this.rides.values()]
      .filter((r) => r.clientId === clientId)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }
}
