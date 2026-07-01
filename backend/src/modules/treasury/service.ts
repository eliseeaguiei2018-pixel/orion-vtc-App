import { randomUUID } from 'node:crypto';
import type { Repository } from '../../core/db/repository.js';

/**
 * Trésorerie ORION — virements plateforme → comptes bancaires avec DOUBLE
 * VALIDATION (maker-checker) :
 *
 *   1. Un rôle habilité (CFO) DEMANDE un virement (treasury:request) → `pending`.
 *   2. SEUL un dirigeant (CEO / DG / DAA / COO — treasury:approve) peut
 *      APPROUVER (→ exécution) ou REJETER. Personne ne peut approuver sa
 *      propre demande (séparation des tâches).
 *
 * Chaque étape est persistée et journalisée dans l'audit log. En production,
 * l'exécution branchera l'API bancaire / mobile money de l'établissement.
 */
export type TransferStatus = 'pending' | 'approved' | 'rejected';

export interface Transfer {
  id: string;
  amount: number;            // FCFA
  currency: 'XOF';
  destination: string;       // banque / IBAN / compte mobile money
  reason: string;            // motif du virement
  requestedBy: string;
  requestedRole: string;
  status: TransferStatus;
  decidedBy?: string;
  decisionNote?: string;
  createdAt: string;
  decidedAt?: string;
  executedAt?: string;       // renseigné à l'approbation (exécution du virement)
}

export class TreasuryService {
  private readonly transfers = new Map<string, Transfer>();

  constructor(private readonly repo?: Repository<Transfer>) {
    for (const t of repo?.all() ?? []) this.transfers.set(t.id, t);
  }

  /** Crée une demande de virement (statut `pending`, en attente d'un dirigeant). */
  request(input: { amount: number; destination: string; reason: string; requestedBy: string; requestedRole: string }): Transfer {
    const t: Transfer = {
      id: randomUUID().slice(0, 8),
      amount: Math.round(input.amount),
      currency: 'XOF',
      destination: input.destination,
      reason: input.reason,
      requestedBy: input.requestedBy,
      requestedRole: input.requestedRole,
      status: 'pending',
      createdAt: new Date().toISOString(),
    };
    this.transfers.set(t.id, t);
    this.repo?.put(t);
    return t;
  }

  /**
   * Approuve et exécute un virement. Refuse si le décideur est le demandeur
   * (séparation des tâches) — renvoie 'self' dans ce cas.
   */
  approve(id: string, decidedBy: string): Transfer | 'self' | null {
    const t = this.transfers.get(id);
    if (!t || t.status !== 'pending') return null;
    if (t.requestedBy === decidedBy) return 'self';
    const now = new Date().toISOString();
    t.status = 'approved';
    t.decidedBy = decidedBy;
    t.decidedAt = now;
    t.executedAt = now; // exécution simulée — brancher l'API bancaire en production
    this.repo?.put(t);
    return t;
  }

  /** Rejette une demande de virement (motif facultatif). */
  reject(id: string, decidedBy: string, note?: string): Transfer | null {
    const t = this.transfers.get(id);
    if (!t || t.status !== 'pending') return null;
    t.status = 'rejected';
    t.decidedBy = decidedBy;
    t.decisionNote = note;
    t.decidedAt = new Date().toISOString();
    this.repo?.put(t);
    return t;
  }

  /** Tous les virements, plus récents d'abord. */
  list(): Transfer[] {
    return [...this.transfers.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  /** Nombre de demandes en attente de décision. */
  pendingCount(): number {
    return this.list().filter((t) => t.status === 'pending').length;
  }
}
