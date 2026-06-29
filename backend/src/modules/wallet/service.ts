import { randomUUID } from 'node:crypto';
import { config } from '../../config/index.js';
import { badRequest } from '../../core/errors.js';

/**
 * Wallet chauffeur & commissions.
 *
 * À la fin d'une course payée, le gain net du chauffeur (montant − commission plateforme)
 * crédite son wallet. Le chauffeur peut demander un retrait (payout) vers son mobile money.
 *
 * En production : ledger en base (PostgreSQL) avec écritures comptables en double entrée.
 * Ici : ledger en mémoire, même logique métier (testable et déterministe).
 */
export type LedgerType = 'ride_earning' | 'commission' | 'payout' | 'adjustment';

export interface LedgerEntry {
  id: string;
  driverId: string;
  type: LedgerType;
  amount: number; // positif = crédit, négatif = débit (FCFA)
  currency: 'XOF';
  rideId?: string;
  at: string;
  note?: string;
}

export interface CommissionResult {
  gross: number;
  commission: number;
  net: number;
  rate: number;
}

/** Calcule la commission plateforme et le gain net (logique pure). */
export function computeCommission(gross: number, rate = config.PLATFORM_COMMISSION_RATE): CommissionResult {
  const commission = Math.round((gross * rate) / 5) * 5; // arrondi 5 FCFA
  const net = gross - commission;
  return { gross, commission, net, rate };
}

export class WalletService {
  private readonly ledger = new Map<string, LedgerEntry[]>();

  private push(entry: Omit<LedgerEntry, 'id' | 'at' | 'currency'>): LedgerEntry {
    const full: LedgerEntry = { id: randomUUID(), at: new Date().toISOString(), currency: 'XOF', ...entry };
    const list = this.ledger.get(entry.driverId) ?? [];
    list.push(full);
    this.ledger.set(entry.driverId, list);
    return full;
  }

  /** Crédite le gain net d'une course et journalise la commission. */
  creditRide(driverId: string, rideId: string, gross: number): CommissionResult {
    const c = computeCommission(gross);
    this.push({ driverId, type: 'ride_earning', amount: c.net, rideId, note: 'Gain course (net)' });
    this.push({ driverId, type: 'commission', amount: -c.commission, rideId, note: `Commission ${Math.round(c.rate * 100)}%` });
    return c;
  }

  balance(driverId: string): number {
    return (this.ledger.get(driverId) ?? []).reduce((sum, e) => sum + (e.type === 'commission' ? 0 : e.amount), 0);
  }

  /** Total des commissions prélevées (reporting plateforme). */
  history(driverId: string): LedgerEntry[] {
    return [...(this.ledger.get(driverId) ?? [])].sort((a, b) => b.at.localeCompare(a.at));
  }

  /** Demande de retrait vers mobile money. Refuse si solde insuffisant. */
  requestPayout(driverId: string, amount: number): LedgerEntry {
    if (amount <= 0) throw badRequest('Montant de retrait invalide');
    if (amount > this.balance(driverId)) throw badRequest('Solde insuffisant');
    return this.push({ driverId, type: 'payout', amount: -amount, note: 'Retrait mobile money' });
  }
}
