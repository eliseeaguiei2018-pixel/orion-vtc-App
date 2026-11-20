import type { Repository } from '../../core/db/repository.js';

export type PromoKind = 'percent' | 'amount';

/** Code promo piloté depuis la console (marketing / support). */
export interface Promo {
  id: string;          // = code en MAJUSCULES
  kind: PromoKind;     // 'percent' (0..100) ou 'amount' (FCFA)
  value: number;
  active: boolean;
  uses: number;
  maxUses?: number;    // 0/undefined = illimité
  /** Date d'expiration (ISO) — codes de dédommagement / win-back à durée courte. */
  expiresAt?: string;
  /** Code réservé à un client précis (dédommagement personnalisé). */
  clientId?: string;
  createdAt: string;
}

const norm = (code: string) => code.trim().toUpperCase();

export class PromoService {
  private readonly promos = new Map<string, Promo>();

  constructor(private readonly repo?: Repository<Promo>) {
    for (const p of repo?.all() ?? []) this.promos.set(p.id, p);
  }

  list(): Promo[] {
    return [...this.promos.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  upsert(input: { code: string; kind: PromoKind; value: number; maxUses?: number; active?: boolean; expiresAt?: string; clientId?: string }): Promo {
    const id = norm(input.code);
    const existing = this.promos.get(id);
    const promo: Promo = {
      id,
      kind: input.kind,
      value: input.value,
      active: input.active ?? existing?.active ?? true,
      uses: existing?.uses ?? 0,
      maxUses: input.maxUses ?? existing?.maxUses,
      expiresAt: input.expiresAt ?? existing?.expiresAt,
      clientId: input.clientId ?? existing?.clientId,
      createdAt: existing?.createdAt ?? new Date().toISOString(),
    };
    this.promos.set(id, promo);
    this.repo?.put(promo);
    return promo;
  }

  /**
   * Code de DÉDOMMAGEMENT personnalisé (support) : code unique, usage unique,
   * date d'expiration courte, réservé au client compensé.
   */
  compensation(input: { clientId?: string; percent: number; days: number; prefix?: string }): Promo {
    const code = `${input.prefix ?? 'DESOLE'}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
    return this.upsert({
      code,
      kind: 'percent',
      value: Math.min(50, Math.max(5, Math.round(input.percent))),
      maxUses: 1,
      clientId: input.clientId,
      expiresAt: new Date(Date.now() + Math.min(30, Math.max(1, input.days)) * 86_400_000).toISOString(),
    });
  }

  setActive(code: string, active: boolean): Promo | undefined {
    const p = this.promos.get(norm(code));
    if (!p) return undefined;
    p.active = active;
    this.repo?.put(p);
    return p;
  }

  remove(code: string): void {
    const id = norm(code);
    this.promos.delete(id);
    this.repo?.delete(id);
  }

  /** Valide un code et renvoie la remise applicable à un sous-total (FCFA). */
  evaluate(code: string | undefined, subtotal: number): { code: string; discount: number } | null {
    if (!code) return null;
    const p = this.promos.get(norm(code));
    if (!p || !p.active) return null;
    if (p.maxUses && p.uses >= p.maxUses) return null;
    if (p.expiresAt && Date.parse(p.expiresAt) < Date.now()) return null; // code expiré
    const discount = p.kind === 'percent'
      ? Math.round(subtotal * Math.min(100, Math.max(0, p.value)) / 100)
      : Math.min(subtotal, Math.max(0, p.value));
    return { code: p.id, discount };
  }

  markUsed(code: string): void {
    const p = this.promos.get(norm(code));
    if (p) { p.uses += 1; this.repo?.put(p); }
  }
}
