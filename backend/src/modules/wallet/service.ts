import { randomUUID } from 'node:crypto';
import { config } from '../../config/index.js';
import { badRequest } from '../../core/errors.js';
import type { Repository } from '../../core/db/repository.js';

/**
 * Wallet chauffeur & commissions.
 *
 * À la fin d'une course payée, le gain net du chauffeur (montant − commission plateforme)
 * crédite son wallet. Le chauffeur peut demander un retrait (payout) vers son mobile money.
 *
 * En production : ledger en base (PostgreSQL) avec écritures comptables en double entrée.
 * Ici : ledger en mémoire, même logique métier (testable et déterministe).
 */
export type LedgerType = 'ride_earning' | 'commission' | 'payout' | 'adjustment' | 'insurance_refund'
  /** Espèces encaissées en main propre par le chauffeur : la commission devient une dette. */
  | 'cash_collected';

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

/**
 * Taux de commission EFFECTIF d'un chauffeur (logique pure, partagée par le paiement et
 * l'app chauffeur) : personnalisé (fidélité console) > fidélité verte au-delà du seuil
 * de courses électriques > taux vert réduit > taux standard.
 */
export function effectiveCommissionRate(
  drv: { engine?: 'electric' | 'hybrid'; electricRides?: number; commissionOverride?: number } | undefined,
  ops: { commissionStandard: number; commissionGreen: number; commissionLoyalty: number; loyaltyRideThreshold: number },
): number {
  const isElectric = (drv?.engine ?? 'electric') === 'electric';
  return drv?.commissionOverride
    ?? (isElectric && (drv?.electricRides ?? 0) >= ops.loyaltyRideThreshold ? ops.commissionLoyalty : undefined)
    ?? (isElectric ? ops.commissionGreen : ops.commissionStandard);
}

export class WalletService {
  private readonly ledger = new Map<string, LedgerEntry[]>();
  /** Comptes gelés (mise en quarantaine litige) : aucun retrait possible. */
  private readonly frozen = new Set<string>();

  constructor(private readonly repo?: Repository<LedgerEntry>) {
    // Réhydratation : regroupe les écritures persistées par chauffeur.
    for (const e of repo?.all() ?? []) {
      const list = this.ledger.get(e.driverId) ?? [];
      list.push(e);
      this.ledger.set(e.driverId, list);
    }
  }

  private push(entry: Omit<LedgerEntry, 'id' | 'at' | 'currency'>): LedgerEntry {
    const full: LedgerEntry = { id: randomUUID(), at: new Date().toISOString(), currency: 'XOF', ...entry };
    const list = this.ledger.get(entry.driverId) ?? [];
    list.push(full);
    this.ledger.set(entry.driverId, list);
    this.repo?.put(full);
    return full;
  }

  /** Crédit générique (utilisé aussi pour le portefeuille client : remboursement assurance…). */
  credit(ownerId: string, amount: number, type: LedgerType, note: string, rideId?: string): LedgerEntry {
    return this.push({ driverId: ownerId, type, amount, note, rideId });
  }

  /** Crédite le gain net d'une course et journalise la commission (taux optionnel). */
  creditRide(driverId: string, rideId: string, gross: number, rate?: number): CommissionResult {
    const c = computeCommission(gross, rate);
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

  /** Totaux plateforme (reporting admin) : gains bruts distribués et commissions perçues. */
  totals(): { earnings: number; commission: number; payouts: number } {
    let earnings = 0, commission = 0, payouts = 0;
    for (const list of this.ledger.values()) {
      for (const e of list) {
        if (e.type === 'ride_earning') earnings += e.amount;
        else if (e.type === 'commission') commission += -e.amount;
        else if (e.type === 'payout') payouts += -e.amount;
      }
    }
    return { earnings: Math.round(earnings), commission: Math.round(commission), payouts: Math.round(payouts) };
  }

  /* --- Quarantaine (litige) : gel/dégel des fonds, blocage des retraits --- */
  freeze(ownerId: string): void { this.frozen.add(ownerId); }
  unfreeze(ownerId: string): void { this.frozen.delete(ownerId); }
  isFrozen(ownerId: string): boolean { return this.frozen.has(ownerId); }

  /** Somme des soldes détenus par tous les propriétaires (argent virtuel à couvrir). */
  totalBalance(): number {
    let sum = 0;
    for (const id of this.ledger.keys()) sum += this.balance(id);
    return Math.round(sum);
  }

  /** Soldes négatifs (dette espèces) au-delà d'un plafond → recouvrement. */
  debtorsOver(limit: number): { driverId: string; balance: number }[] {
    const out: { driverId: string; balance: number }[] = [];
    for (const id of this.ledger.keys()) {
      const b = this.balance(id);
      if (b < -Math.abs(limit)) out.push({ driverId: id, balance: Math.round(b) });
    }
    return out.sort((a, b) => a.balance - b.balance);
  }

  /** Demande de retrait vers mobile money. Refuse si solde insuffisant ou compte gelé. */
  requestPayout(driverId: string, amount: number): LedgerEntry {
    if (this.frozen.has(driverId)) throw badRequest('Compte gelé (mise en quarantaine — litige en cours)');
    if (amount <= 0) throw badRequest('Montant de retrait invalide');
    if (amount > this.balance(driverId)) throw badRequest('Solde insuffisant');
    return this.push({ driverId, type: 'payout', amount: -amount, note: 'Retrait mobile money' });
  }
}
