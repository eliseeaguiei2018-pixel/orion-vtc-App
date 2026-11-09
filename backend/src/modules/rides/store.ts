import type { Quote } from '../services/types.js';
import type { LatLng } from '../../core/geo.js';
import type { RideStatus } from '../services/ride/stateMachine.js';
import type { Repository } from '../../core/db/repository.js';

export interface TrustedContact {
  name: string;
  phone: string;
}

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
  /** Jeton public de partage de la course (contact de confiance). */
  shareToken?: string;
  /** Contact de confiance prévenu au départ — ORION peut le joindre en cas d'accident. */
  trustedContact?: TrustedContact;
  /** Tracé GPS de la course (échantillonné, borné à 200 points) — instruction des litiges. */
  trace?: LatLng[];
  /** Minutes d'attente facturables (pauses demandées par le client en course). */
  waitMinutes?: number;
  /** Compte Entreprise (B2B) : course imputée à la ligne de crédit société. */
  corporateId?: string;
  /** Moyen de paiement annoncé par le client à la commande (affiché au chauffeur). */
  paymentMethod?: string;
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
  // Les devis sont transitoires (TTL) → mémoire uniquement.
  private readonly quotes = new Map<string, Quote>();

  constructor(private readonly repo: Repository<Ride>) {
    for (const r of repo.all()) this.rides.set(r.id, r);
  }

  /** Persiste l'état courant d'une course (write-through après mutation en place). */
  persist(ride: Ride): void {
    this.repo.put(ride);
  }

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
    this.repo.put(ride);
    return ride;
  }

  get(id: string): Ride | undefined {
    return this.rides.get(id);
  }

  /** Course active (non terminale) d'un chauffeur, pour router sa position vers la room. */
  findActiveByDriver(driverId: string): Ride | undefined {
    const active = new Set(['accepted', 'driver_en_route', 'arrived', 'in_progress']);
    return [...this.rides.values()].find((r) => r.driverId === driverId && active.has(r.status));
  }

  findByShareToken(token: string): Ride | undefined {
    return [...this.rides.values()].find((r) => r.shareToken === token);
  }

  /** Courses d'un chauffeur (historique app chauffeur), plus récentes d'abord. */
  listByDriver(driverId: string): Ride[] {
    return [...this.rides.values()]
      .filter((r) => r.driverId === driverId)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  listByClient(clientId: string): Ride[] {
    return [...this.rides.values()]
      .filter((r) => r.clientId === clientId)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  /** Toutes les courses (supervision admin), plus récentes d'abord. */
  listAll(): Ride[] {
    return [...this.rides.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }
}
