import { randomUUID } from 'node:crypto';
import type { Repository } from '../../core/db/repository.js';

/**
 * Litiges & réclamations : objets trouvés, contestation de trajet, erreur de
 * facturation, signalement de comportement. Ouverts par le client (app) ou par
 * un agent, instruits dans la console (tracé GPS + tarification de la course à
 * l'appui), résolus avec note de résolution et remboursement éventuel
 * (crédité sur le portefeuille client, tracé dans l'audit).
 */
export type DisputeKind = 'objet_perdu' | 'trajet' | 'facturation' | 'comportement';
export type DisputeStatus = 'open' | 'investigating' | 'resolved' | 'rejected';

/** Catégorie d'ESCALADE (litiges N2/N3) — niveau de risque financier/légal. */
export type EscalationKind = 'sinistre' | 'chargeback' | 'harcelement' | 'degradation';

export interface Dispute {
  id: string;
  rideId: string;
  clientId: string;
  kind: DisputeKind;
  description: string;
  status: DisputeStatus;
  createdAt: string;
  decidedBy?: string;
  resolution?: string;
  refund?: number;       // FCFA remboursés (0 = aucun)
  decidedAt?: string;
  /* --- Escalade N2/N3 (session Litiges) --- */
  /** Catégorie d'escalade si le dossier est passé en niveau expert. */
  escalation?: EscalationKind;
  /** Verrou du dossier (claim lock) : un seul expert gestionnaire. */
  lockedBy?: string;
  /** Quarantaine préventive active (comptes suspendus, fonds gelés). */
  quarantined?: boolean;
  /** Notes d'investigation horodatées. */
  notes?: { author: string; text: string; at: string }[];
}

export class DisputeService {
  private readonly disputes = new Map<string, Dispute>();

  constructor(private readonly repo?: Repository<Dispute>) {
    for (const d of repo?.all() ?? []) this.disputes.set(d.id, d);
  }

  open(input: { rideId: string; clientId: string; kind: DisputeKind; description: string }): Dispute {
    const d: Dispute = {
      id: randomUUID().slice(0, 8),
      status: 'open',
      createdAt: new Date().toISOString(),
      ...input,
    };
    this.disputes.set(d.id, d);
    this.repo?.put(d);
    return d;
  }

  get(id: string): Dispute | undefined {
    return this.disputes.get(id);
  }

  /**
   * Escalade N2/N3 + VERROU du dossier (claim lock) : le premier expert qui ouvre
   * le dossier le verrouille à son nom. 'locked' si déjà pris par un autre.
   */
  escalate(id: string, kind: EscalationKind, expert: string): Dispute | 'locked' | null {
    const d = this.disputes.get(id);
    if (!d) return null;
    if (d.lockedBy && d.lockedBy !== expert) return 'locked';
    d.escalation = kind;
    d.lockedBy = expert;
    if (d.status === 'open') d.status = 'investigating';
    this.repo?.put(d);
    return d;
  }

  /** Active/lève la quarantaine préventive (gel des comptes/fonds). */
  setQuarantine(id: string, on: boolean): Dispute | null {
    const d = this.disputes.get(id);
    if (!d) return null;
    d.quarantined = on;
    this.repo?.put(d);
    return d;
  }

  /** Ajoute une note d'investigation (réservée à l'expert gestionnaire). */
  addNote(id: string, author: string, text: string): Dispute | null {
    const d = this.disputes.get(id);
    if (!d) return null;
    (d.notes ??= []).push({ author, text, at: new Date().toISOString() });
    this.repo?.put(d);
    return d;
  }

  /** Passage en instruction / résolution / rejet, avec note et remboursement éventuel. */
  decide(id: string, status: Exclude<DisputeStatus, 'open'>, by: string, resolution?: string, refund?: number): Dispute | null {
    const d = this.disputes.get(id);
    if (!d) return null;
    d.status = status;
    d.decidedBy = by;
    if (resolution !== undefined) d.resolution = resolution;
    if (refund !== undefined) d.refund = Math.max(0, Math.round(refund));
    if (status !== 'investigating') d.decidedAt = new Date().toISOString();
    this.repo?.put(d);
    return d;
  }

  list(status?: DisputeStatus): Dispute[] {
    const all = [...this.disputes.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    return status ? all.filter((d) => d.status === status) : all;
  }

  openCount(): number {
    return this.list().filter((d) => d.status === 'open' || d.status === 'investigating').length;
  }
}
