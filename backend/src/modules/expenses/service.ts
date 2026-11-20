import { randomUUID } from 'node:crypto';
import type { Repository } from '../../core/db/repository.js';

/**
 * SESSION FINANCES (S14) — Hub des AVANCES, NOTES DE FRAIS et DÉCAISSEMENTS.
 *
 * Interface à double niveau :
 *  - Employé / chauffeur (self-service) : ouvre un « ticket de financement »
 *    (montant, catégorie, date de besoin, justification).
 *  - Département financier (CFO) : approuve / rejette / demande un complément.
 *
 * Cycle : demande → approbation → CRÉDIT INSTANTANÉ du portefeuille interne du
 * demandeur → cash-out (Wave/OM/MTN/Moov/banque) → soumission du justificatif
 * (OCR : le montant doit concorder) → restitution du reliquat au compte central.
 * BLOCAGE de sécurité si le justificatif n'est pas fourni dans le délai (48 h).
 */
export type ExpenseStatus = 'pending' | 'info_requested' | 'approved' | 'rejected';
export type ExpenseCategory = 'marketing' | 'recharge' | 'deplacement' | 'materiel' | 'autre';
export type RequesterType = 'employee' | 'driver';

export interface ExpenseTicket {
  id: string;
  requesterType: RequesterType;
  requesterId: string;       // username employé ou id chauffeur
  requesterName: string;
  amount: number;            // montant demandé (F CFA)
  category: ExpenseCategory;
  neededDate: string;
  description: string;
  status: ExpenseStatus;
  createdAt: string;
  decidedBy?: string;
  decidedAt?: string;
  decisionNote?: string;
  /* --- Après approbation --- */
  /** Fonds crédités sur le wallet interne du demandeur. */
  credited?: boolean;
  /** Retrait effectué vers le monde réel (canal + montant). */
  cashOut?: { channel: string; amount: number; at: string };
  /** Justificatif soumis (OCR : montant lu). */
  receipt?: { amount: number; at: string; matches: boolean };
  /** Reliquat restitué au compte central ORION. */
  refunded?: number;
  /** Compte gelé (justificatif non fourni à temps) → nouvelles demandes bloquées. */
  blocked?: boolean;
}

/** Délai légal de soumission du justificatif après la date de besoin (heures). */
export const RECEIPT_DEADLINE_HOURS = 48;

export class ExpenseService {
  private readonly tickets = new Map<string, ExpenseTicket>();
  /** Solde du portefeuille interne (avances créditées non encore décaissées). */
  private readonly wallet = new Map<string, number>();

  constructor(private readonly repo?: Repository<ExpenseTicket>) {
    for (const t of repo?.all() ?? []) this.tickets.set(t.id, t);
  }

  private key(t: RequesterType, id: string): string { return `${t}:${id}`; }

  /** Solde du portefeuille interne d'un demandeur. */
  balance(type: RequesterType, id: string): number { return this.wallet.get(this.key(type, id)) ?? 0; }

  /** Le demandeur est-il bloqué (justificatif en retard) ? */
  isBlocked(type: RequesterType, id: string): boolean {
    return [...this.tickets.values()].some((t) => t.requesterType === type && t.requesterId === id && t.blocked);
  }

  /** Ouvre un ticket de financement (self-service). Refusé si le compte est bloqué. */
  request(input: { requesterType: RequesterType; requesterId: string; requesterName: string; amount: number; category: ExpenseCategory; neededDate: string; description: string }): ExpenseTicket | 'blocked' {
    if (this.isBlocked(input.requesterType, input.requesterId)) return 'blocked';
    const t: ExpenseTicket = {
      id: randomUUID().slice(0, 8),
      status: 'pending',
      createdAt: new Date().toISOString(),
      ...input,
      amount: Math.round(input.amount),
    };
    this.tickets.set(t.id, t);
    this.repo?.put(t);
    return t;
  }

  /** Décision du CFO : approuve (crédit instantané), rejette, ou demande un complément. */
  decide(id: string, decision: 'approve' | 'reject' | 'info', by: string, note?: string): ExpenseTicket | null {
    const t = this.tickets.get(id);
    if (!t) return null;
    t.decidedBy = by;
    t.decidedAt = new Date().toISOString();
    t.decisionNote = note;
    if (decision === 'approve') {
      t.status = 'approved';
      t.credited = true;
      const k = this.key(t.requesterType, t.requesterId);
      this.wallet.set(k, (this.wallet.get(k) ?? 0) + t.amount); // crédit instantané (internal routing)
    } else if (decision === 'reject') {
      t.status = 'rejected';
    } else {
      t.status = 'info_requested';
    }
    this.repo?.put(t);
    return t;
  }

  /** Cash-out : le demandeur transfère l'avance vers le monde réel (débite le wallet). */
  cashOut(id: string, channel: string): ExpenseTicket | 'not_approved' | 'no_funds' | null {
    const t = this.tickets.get(id);
    if (!t) return null;
    if (t.status !== 'approved' || !t.credited) return 'not_approved';
    const k = this.key(t.requesterType, t.requesterId);
    const bal = this.wallet.get(k) ?? 0;
    if (bal < t.amount) return 'no_funds';
    this.wallet.set(k, bal - t.amount);
    t.cashOut = { channel, amount: t.amount, at: new Date().toISOString() };
    this.repo?.put(t);
    return t;
  }

  /**
   * Soumission du justificatif (OCR). Vérifie la concordance du montant, restitue
   * automatiquement le reliquat au compte central si la dépense est inférieure.
   */
  submitReceipt(id: string, spentAmount: number): ExpenseTicket | null {
    const t = this.tickets.get(id);
    if (!t) return null;
    const spent = Math.max(0, Math.round(spentAmount));
    t.receipt = { amount: spent, at: new Date().toISOString(), matches: spent <= t.amount };
    // Reliquat : différence rapatriée vers ORION.
    if (spent < t.amount) t.refunded = t.amount - spent;
    t.blocked = false; // justificatif fourni → déblocage
    this.repo?.put(t);
    return t;
  }

  /**
   * Balaye les tickets approuvés sans justificatif au-delà du délai → gèle le compte
   * du demandeur (nouvelles demandes bloquées) + renvoie les tickets concernés.
   */
  enforceDeadlines(now = Date.now()): ExpenseTicket[] {
    const overdue: ExpenseTicket[] = [];
    for (const t of this.tickets.values()) {
      if (t.status === 'approved' && t.cashOut && !t.receipt) {
        const deadline = Date.parse(t.neededDate) + RECEIPT_DEADLINE_HOURS * 3_600_000;
        if (now > deadline && !t.blocked) { t.blocked = true; this.repo?.put(t); overdue.push(t); }
      }
    }
    return overdue;
  }

  get(id: string): ExpenseTicket | undefined { return this.tickets.get(id); }

  /** File d'attente (CFO) : demandes en attente d'abord, plus récentes ensuite. */
  list(filter?: { requesterId?: string }): ExpenseTicket[] {
    let all = [...this.tickets.values()];
    if (filter?.requesterId) all = all.filter((t) => t.requesterId === filter.requesterId);
    const rank = (t: ExpenseTicket) => (t.status === 'pending' ? 0 : t.status === 'info_requested' ? 1 : 2);
    return all.sort((a, b) => rank(a) - rank(b) || b.createdAt.localeCompare(a.createdAt));
  }

  pendingCount(): number {
    return [...this.tickets.values()].filter((t) => t.status === 'pending').length;
  }
}
