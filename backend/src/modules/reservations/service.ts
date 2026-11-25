import { randomUUID } from 'node:crypto';
import type { LatLng } from '../../core/geo.js';
import type { Repository } from '../../core/db/repository.js';

/**
 * Réservations à l'avance (aéroports, hôtels, rendez-vous d'affaires).
 * Le client planifie ; la console suit le calendrier, assigne un chauffeur
 * (manuellement ou via le matching) et surveille la PONCTUALITÉ : une alerte
 * préventive est levée 30 minutes avant l'heure si aucun chauffeur n'est prêt.
 */
export type ReservationStatus = 'planifiee' | 'assignee' | 'lancee' | 'annulee';

export interface Reservation {
  id: string;
  clientId: string;
  origin: LatLng;
  destination: LatLng;
  category: string;
  /** Heure de prise en charge prévue (ISO). */
  scheduledFor: string;
  status: ReservationStatus;
  driverId?: string;
  /** Chauffeur favori du client (proposé en priorité 12 h à l'avance). */
  favoriteDriverId?: string;
  /** Mise à disposition à l'heure (Abidjan) : le chauffeur reste `heures` heures avec le client. */
  miseADisposition?: { heures: number };
  createdAt: string;
}

export class ReservationService {
  private readonly items = new Map<string, Reservation>();

  constructor(private readonly repo?: Repository<Reservation>) {
    for (const r of repo?.all() ?? []) this.items.set(r.id, r);
  }

  create(input: { clientId: string; origin: LatLng; destination: LatLng; category: string; scheduledFor: string; favoriteDriverId?: string; miseADisposition?: { heures: number } }): Reservation {
    const r: Reservation = {
      id: randomUUID().slice(0, 8),
      status: 'planifiee',
      createdAt: new Date().toISOString(),
      ...input,
    };
    this.items.set(r.id, r);
    this.repo?.put(r);
    return r;
  }

  get(id: string): Reservation | undefined { return this.items.get(id); }

  assign(id: string, driverId: string): Reservation | undefined {
    const r = this.items.get(id);
    if (!r) return undefined;
    r.driverId = driverId;
    r.status = 'assignee';
    this.repo?.put(r);
    return r;
  }

  setStatus(id: string, status: ReservationStatus): Reservation | undefined {
    const r = this.items.get(id);
    if (!r) return undefined;
    r.status = status;
    this.repo?.put(r);
    return r;
  }

  /** Calendrier chronologique (les prochaines d'abord). */
  list(): Reservation[] {
    return [...this.items.values()].sort((a, b) => a.scheduledFor.localeCompare(b.scheduledFor));
  }

  listByClient(clientId: string): Reservation[] {
    return this.list().filter((r) => r.clientId === clientId);
  }
}
