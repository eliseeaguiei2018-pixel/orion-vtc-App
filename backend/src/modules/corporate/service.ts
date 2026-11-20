import { randomUUID } from 'node:crypto';
import type { Repository } from '../../core/db/repository.js';

/**
 * Comptes Entreprises (B2B) : hôtels, sociétés, ambassades. L'entreprise dispose
 * d'une LIGNE DE CRÉDIT mensuelle : ses employés/invités commandent avec le code
 * société sans paiement immédiat ; le crédit est réservé à la commande, puis la
 * facture consolidée du mois est émise et réglée (settle).
 */
/** Politique de déplacement (contrôle de l'usage du budget transport). */
export interface TravelPolicy {
  /** Jours autorisés (0 = dimanche … 6 = samedi). Vide = tous. */
  days?: number[];
  /** Heures autorisées (locales) : de hourStart à hourEnd inclus. */
  hourStart?: number;
  hourEnd?: number;
  /** Zones autorisées (ids de zones console) ; vide = toutes. */
  zoneIds?: string[];
  /** Gamme maximale autorisée pour les employés standard. */
  maxTier?: 'bronze' | 'argent' | 'or' | 'diamant';
}

export interface CorporateAccount {
  id: string;            // code société (saisi à la commande)
  name: string;
  contactEmail?: string;
  /**
   * Téléphone du donneur d'ordre. Un compte entreprise se relance au téléphone, pas
   * par courriel : sans ce champ, la console affichait une société en dépassement de
   * ligne de crédit sans aucun moyen de la joindre.
   */
  contactPhone?: string;
  creditLimit: number;   // plafond mensuel (F CFA)
  balanceUsed: number;   // crédit consommé sur la période en cours
  active: boolean;
  createdAt: string;
  /* --- CRM B2B avancé (session Entreprises) --- */
  /** Numéro d'identification fiscale (facturation). */
  nif?: string;
  billingAddress?: string;
  /** Compte parent (entité mère) — filiales/départements rattachés. */
  parentId?: string;
  /** Politique de déplacement (restrictions horaires/zones/gammes). */
  policy?: TravelPolicy;
  /** Rétrocommission d'apport d'affaires (kickback %) reversée au partenaire (hôtel). */
  kickbackRate?: number;
  /** Employés rattachés (import de masse) — ids clients ORION. */
  members?: string[];
}

export class CorporateService {
  private readonly accounts = new Map<string, CorporateAccount>();

  constructor(private readonly repo?: Repository<CorporateAccount>) {
    for (const a of repo?.all() ?? []) this.accounts.set(a.id, a);
  }

  upsert(input: {
    id?: string; name: string; contactEmail?: string; contactPhone?: string; creditLimit: number; active?: boolean;
    nif?: string; billingAddress?: string; parentId?: string; policy?: TravelPolicy; kickbackRate?: number;
  }): CorporateAccount {
    const id = (input.id ?? input.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 24) + '-' + randomUUID().slice(0, 4));
    const existing = this.accounts.get(id);
    const acc: CorporateAccount = {
      id,
      name: input.name,
      contactEmail: input.contactEmail ?? existing?.contactEmail,
      contactPhone: input.contactPhone ?? existing?.contactPhone,
      creditLimit: Math.max(0, Math.round(input.creditLimit)),
      balanceUsed: existing?.balanceUsed ?? 0,
      active: input.active ?? existing?.active ?? true,
      createdAt: existing?.createdAt ?? new Date().toISOString(),
      nif: input.nif ?? existing?.nif,
      billingAddress: input.billingAddress ?? existing?.billingAddress,
      parentId: input.parentId ?? existing?.parentId,
      policy: input.policy ?? existing?.policy,
      kickbackRate: input.kickbackRate ?? existing?.kickbackRate,
      members: existing?.members ?? [],
    };
    this.accounts.set(id, acc);
    this.repo?.put(acc);
    return acc;
  }

  /** Filiales / départements rattachés à une entité mère. */
  children(parentId: string): CorporateAccount[] {
    return this.list().filter((a) => a.parentId === parentId);
  }

  /**
   * Import de masse : rattache une liste d'employés (ids clients ORION) au compte.
   * Renvoie le compte mis à jour + le nombre de nouveaux membres.
   */
  importMembers(id: string, memberIds: string[]): { account: CorporateAccount; added: number } | null {
    const acc = this.accounts.get(id);
    if (!acc) return null;
    const set = new Set(acc.members ?? []);
    const before = set.size;
    for (const m of memberIds) if (m.trim()) set.add(m.trim());
    acc.members = [...set];
    this.repo?.put(acc);
    return { account: acc, added: set.size - before };
  }

  /**
   * Vérifie la POLITIQUE de déplacement au moment d'une commande société :
   * horaires, jours et zone autorisés. Renvoie null si conforme, sinon le motif.
   */
  checkPolicy(id: string, ctx: { at?: Date; zoneId?: string }): string | null {
    const acc = this.accounts.get(id);
    if (!acc?.policy) return null;
    const p = acc.policy;
    const now = ctx.at ?? new Date();
    if (p.days && p.days.length && !p.days.includes(now.getDay())) return 'Jour non autorisé par la politique entreprise';
    if (p.hourStart !== undefined && p.hourEnd !== undefined) {
      const h = now.getHours();
      if (h < p.hourStart || h > p.hourEnd) return 'Hors des heures autorisées par la politique entreprise';
    }
    if (p.zoneIds && p.zoneIds.length && ctx.zoneId && !p.zoneIds.includes(ctx.zoneId)) {
      return 'Zone non autorisée par la politique entreprise';
    }
    return null;
  }

  /** Rétrocommission d'apport d'affaires due au partenaire sur une base de CA. */
  kickback(id: string, revenue: number): number {
    const acc = this.accounts.get(id);
    if (!acc?.kickbackRate) return 0;
    return Math.round(revenue * acc.kickbackRate);
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
