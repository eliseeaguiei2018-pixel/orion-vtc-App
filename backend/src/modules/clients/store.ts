import type { Repository } from '../../core/db/repository.js';

export type ClientStatus = 'active' | 'blocked';

/**
 * Fiche client (minimale tant que l'auth réelle n'est pas branchée).
 * Enregistrée automatiquement à la 1re course/SOS. Le support peut bloquer un client.
 */
export interface Client {
  id: string;
  name?: string;
  phone?: string;
  status: ClientStatus;
  rides: number;
  /** Annulations cumulées (détection d'abus). */
  cancellations?: number;
  /** Avertissements automatiques (annulations abusives : 1 par palier de 3). */
  warnings?: number;
  /** Points Carbone (fidélisation verte) : 1 point par km 100 % électrique payé. */
  greenPoints?: number;
  createdAt: string;
  lastSeenAt: string;
}

export class ClientStore {
  private readonly clients = new Map<string, Client>();

  constructor(private readonly repo?: Repository<Client>) {
    for (const c of repo?.all() ?? []) this.clients.set(c.id, c);
  }

  /** Enregistre / met à jour un client vu dans le système (idempotent). */
  touch(id: string, info: { name?: string; phone?: string } = {}): Client {
    const now = new Date().toISOString();
    const existing = this.clients.get(id);
    const c: Client = existing
      ? { ...existing, name: info.name ?? existing.name, phone: info.phone ?? existing.phone, lastSeenAt: now }
      : { id, name: info.name, phone: info.phone, status: 'active', rides: 0, createdAt: now, lastSeenAt: now };
    this.clients.set(id, c);
    this.repo?.put(c);
    return c;
  }

  incrementRides(id: string): void {
    const c = this.touch(id);
    c.rides += 1;
    this.repo?.put(c);
  }

  /**
   * Compte une annulation ; tous les 3 cumuls, un avertissement automatique
   * est posé (anti-abus). Renvoie true si un avertissement vient d'être émis.
   */
  incrementCancellations(id: string): boolean {
    const c = this.touch(id);
    c.cancellations = (c.cancellations ?? 0) + 1;
    let warned = false;
    if (c.cancellations % 3 === 0) {
      c.warnings = (c.warnings ?? 0) + 1;
      warned = true;
    }
    this.repo?.put(c);
    return warned;
  }

  /** Crédite des Points Carbone (course 100 % électrique payée). */
  addGreenPoints(id: string, points: number): number {
    const c = this.touch(id);
    c.greenPoints = (c.greenPoints ?? 0) + Math.max(0, Math.round(points));
    this.repo?.put(c);
    return c.greenPoints;
  }

  get(id: string): Client | undefined { return this.clients.get(id); }

  setStatus(id: string, status: ClientStatus): Client | undefined {
    const c = this.clients.get(id);
    if (!c) return undefined;
    c.status = status;
    this.repo?.put(c);
    return c;
  }

  list(): Client[] {
    return [...this.clients.values()].sort((a, b) => b.lastSeenAt.localeCompare(a.lastSeenAt));
  }
}
