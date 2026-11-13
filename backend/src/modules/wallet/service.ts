import { randomUUID } from 'node:crypto';
import { IndexChrono } from '../../core/chrono.js';
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
  /**
   * VOLUME : soldes et totaux tenus à chaque écriture, écritures indexées par date. Un
   * solde, un total plateforme ou les mouvements du mois se lisent sans reparcourir les
   * millions d'écritures du grand livre.
   */
  private readonly soldes = new Map<string, number>();
  private readonly cumul = { earnings: 0, commission: 0, payouts: 0 };
  private readonly chrono = new IndexChrono<LedgerEntry>();
  /** Retraits seuls (sorties de caisse) : le grand livre ne relit pas toutes les écritures. */
  private readonly retraits = new IndexChrono<LedgerEntry>();

  constructor(private readonly repo?: Repository<LedgerEntry>) {
    // Réhydratation : regroupe les écritures persistées par chauffeur.
    for (const e of repo?.all() ?? []) this.indexer(e);
  }

  private indexer(e: LedgerEntry): void {
    const list = this.ledger.get(e.driverId) ?? [];
    list.push(e);
    this.ledger.set(e.driverId, list);
    if (e.type !== 'commission') this.soldes.set(e.driverId, (this.soldes.get(e.driverId) ?? 0) + e.amount);
    if (e.type === 'ride_earning') this.cumul.earnings += e.amount;
    else if (e.type === 'commission') this.cumul.commission += -e.amount;
    else if (e.type === 'payout') this.cumul.payouts += -e.amount;
    this.chrono.ajouter(Date.parse(e.at), e);
    if (e.type === 'payout') this.retraits.ajouter(Date.parse(e.at), e);
  }

  /** Retraits datés de `t` (ms) ou après, du plus ancien au plus récent. */
  payoutsSince(t: number): LedgerEntry[] {
    return this.retraits.depuis(t);
  }

  private push(entry: Omit<LedgerEntry, 'id' | 'at' | 'currency'>): LedgerEntry {
    const full: LedgerEntry = { id: randomUUID(), at: new Date().toISOString(), currency: 'XOF', ...entry };
    this.indexer(full);
    this.repo?.put(full);
    return full;
  }

  /**
   * Reprise d'historique (migration, import d'une autre base) : l'écriture garde sa date.
   * Réservé aux outils d'import, jamais aux opérations courantes.
   */
  importer(entry: Omit<LedgerEntry, 'id' | 'currency'> & { id?: string }): LedgerEntry {
    const full: LedgerEntry = { currency: 'XOF', ...entry, id: entry.id ?? randomUUID() };
    this.indexer(full);
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
    return this.soldes.get(driverId) ?? 0;
  }

  /**
   * TOUTES les écritures, tous chauffeurs confondus, plus récentes d'abord — exports et
   * contrôles de fond. Pour une période, `entriesSince` ne lit que la fenêtre.
   */
  allEntries(): LedgerEntry[] {
    return this.chrono.tous().reverse();
  }

  /** Écritures datées de `t` (ms) ou après, plus récentes d'abord. */
  entriesSince(t: number): LedgerEntry[] {
    return this.chrono.depuis(t).reverse();
  }

  /** Nombre total d'écritures du grand livre (sans copie). */
  get nombreEcritures(): number {
    return this.chrono.taille;
  }

  history(driverId: string): LedgerEntry[] {
    // Dates ISO : la comparaison directe suffit (localeCompare est cent fois plus lent).
    return [...(this.ledger.get(driverId) ?? [])].sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0));
  }

  /** Les écritures d'un chauffeur, sans copie ni tri : pour les cumuls qui n'ont pas besoin d'ordre. */
  ecritures(driverId: string): readonly LedgerEntry[] {
    return this.ledger.get(driverId) ?? [];
  }

  /** Totaux plateforme (reporting admin) : gains bruts distribués et commissions perçues. */
  totals(): { earnings: number; commission: number; payouts: number } {
    return { earnings: Math.round(this.cumul.earnings), commission: Math.round(this.cumul.commission), payouts: Math.round(this.cumul.payouts) };
  }

  /* --- Quarantaine (litige) : gel/dégel des fonds, blocage des retraits --- */
  freeze(ownerId: string): void { this.frozen.add(ownerId); }
  unfreeze(ownerId: string): void { this.frozen.delete(ownerId); }
  isFrozen(ownerId: string): boolean { return this.frozen.has(ownerId); }

  /** Somme des soldes détenus par tous les propriétaires (argent virtuel à couvrir). */
  totalBalance(): number {
    let sum = 0;
    for (const v of this.soldes.values()) sum += v;
    return Math.round(sum);
  }

  /** Soldes positifs : ce que la plateforme doit aux propriétaires (sans relire les écritures). */
  totalPositiveBalances(ids?: Iterable<string>): number {
    let sum = 0;
    if (ids) { for (const id of ids) { const v = this.soldes.get(id) ?? 0; if (v > 0) sum += v; } }
    else for (const v of this.soldes.values()) if (v > 0) sum += v;
    return sum;
  }

  /** Soldes négatifs (dette espèces) au-delà d'un plafond → recouvrement. */
  debtorsOver(limit: number): { driverId: string; balance: number }[] {
    const out: { driverId: string; balance: number }[] = [];
    for (const [id, b] of this.soldes) {
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
