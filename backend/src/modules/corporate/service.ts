import { randomUUID } from 'node:crypto';
import type { Repository } from '../../core/db/repository.js';

/**
 * Comptes Entreprises (B2B) : hôtels, sociétés, ambassades. L'entreprise dispose
 * d'une LIGNE DE CRÉDIT mensuelle : ses employés/invités commandent avec le code
 * société sans paiement immédiat ; le crédit est réservé à la commande, puis la
 * facture consolidée du mois est émise et réglée (settle).
 */
export interface CorporateAccount {
  id: string;            // code société (saisi à la commande)
  name: string;
  contactEmail?: string;
  creditLimit: number;   // plafond mensuel (F CFA)
  balanceUsed: number;   // crédit consommé sur la période en cours
  active: boolean;
  createdAt: string;
}

export class CorporateService {
  private readonly accounts = new Map<string, CorporateAccount>();

  constructor(private readonly repo?: Repository<CorporateAccount>) {
    for (const a of repo?.all() ?? []) this.accounts.set(a.id, a);
  }

  upsert(input: { id?: string; name: string; contactEmail?: string; creditLimit: number; active?: boolean }): CorporateAccount {
    const id = (input.id ?? input.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 24) + '-' + randomUUID().slice(0, 4));
    const existing = this.accounts.get(id);
    const acc: CorporateAccount = {
      id,
      name: input.name,
      contactEmail: input.contactEmail ?? existing?.contactEmail,
      creditLimit: Math.max(0, Math.round(input.creditLimit)),
      balanceUsed: existing?.balanceUsed ?? 0,
      active: input.active ?? existing?.active ?? true,
      createdAt: existing?.createdAt ?? new Date().toISOString(),
    };
    this.accounts.set(id, acc);
    this.repo?.put(acc);
    return acc;
  }

  get(id: string): CorporateAccount | undefined {
    return this.accounts.get(id);
  }

  list(): CorporateAccount[] {
    return [...this.accounts.values()].sort((a, b) => a.name.localeCompare(b.name));
  }

  /**
   * Réserve le montant d'une course sur la ligne de crédit.
   * Renvoie 'inactive' | 'over_limit' | l'account mis à jour.
   */
  charge(id: string, amount: number): CorporateAccount | 'inactive' | 'over_limit' | null {
    const acc = this.accounts.get(id);
    if (!acc) return null;
    if (!acc.active) return 'inactive';
    if (acc.balanceUsed + amount > acc.creditLimit) return 'over_limit';
    acc.balanceUsed += Math.round(amount);
    this.repo?.put(acc);
    return acc;
  }

  /** Facture réglée : remet le crédit consommé à zéro (nouvelle période). */
  settle(id: string): CorporateAccount | null {
    const acc = this.accounts.get(id);
    if (!acc) return null;
    acc.balanceUsed = 0;
    this.repo?.put(acc);
    return acc;
  }
}
