import { randomUUID } from 'node:crypto';
import { badRequest, notFound } from '../../core/errors.js';
import type { Repository } from '../../core/db/repository.js';

/**
 * Abonnements mensuels ORION. Chaque pack offre un nombre de courses incluses par jour
 * (dans une limite de distance/plafond) + des avantages. Le quota se réinitialise chaque
 * jour. En production : stockage en base + facturation récurrente.
 */
export type PlanId = 'bronze' | 'argent' | 'gold';

export interface Plan {
  id: PlanId;
  label: string;
  ridesPerDay: number;
  monthlyPrice: number; // FCFA
  /** Plafond pris en charge par course incluse (au-delà : complément payé). */
  perRideCap: number;
  benefits: string[];
  accent: string;
}

export const PLANS: Record<PlanId, Plan> = {
  bronze: {
    id: 'bronze',
    label: 'Pack Bronze',
    ridesPerDay: 2,
    monthlyPrice: 25_000,
    perRideCap: 2_500,
    benefits: ['2 courses incluses / jour', 'Niveaux Bronze & Argent', 'Support standard'],
    accent: '#cd7f4d',
  },
  argent: {
    id: 'argent',
    label: 'Pack Argent',
    ridesPerDay: 3,
    monthlyPrice: 38_000,
    perRideCap: 3_500,
    benefits: ['3 courses incluses / jour', 'Niveaux jusqu’à Or', 'Priorité de mise en relation', '-10% au-delà du quota'],
    accent: '#c8d2dc',
  },
  gold: {
    id: 'gold',
    label: 'Pack Gold',
    ridesPerDay: 4,
    monthlyPrice: 55_000,
    perRideCap: 5_000,
    benefits: ['4 courses incluses / jour', 'Tous les niveaux (jusqu’à Diamant)', 'Priorité maximale', '-15% au-delà du quota', 'Annulation gratuite'],
    accent: '#f5c451',
  },
};

export const PLAN_IDS: PlanId[] = ['bronze', 'argent', 'gold'];
export const isPlan = (v: string): v is PlanId => (PLAN_IDS as string[]).includes(v);

export interface Subscription {
  id: string;
  userId: string;
  plan: PlanId;
  startedAt: string;
  renewsAt: string;
  ridesPerDay: number;
  usedToday: number;
  usageDate: string; // YYYY-MM-DD
  active: boolean;
}

const today = () => new Date().toISOString().slice(0, 10);
const addDays = (d: Date, n: number) => new Date(d.getTime() + n * 86400000);

export class SubscriptionService {
  private readonly subs = new Map<string, Subscription>(); // par userId

  constructor(private readonly repo?: Repository<Subscription>) {
    for (const s of repo?.all() ?? []) this.subs.set(s.userId, s);
  }

  subscribe(userId: string, plan: string): Subscription {
    if (!isPlan(plan)) throw badRequest('Forfait inconnu');
    const p = PLANS[plan];
    const now = new Date();
    const sub: Subscription = {
      id: randomUUID(),
      userId,
      plan,
      startedAt: now.toISOString(),
      renewsAt: addDays(now, 30).toISOString(),
      ridesPerDay: p.ridesPerDay,
      usedToday: 0,
      usageDate: today(),
      active: true,
    };
    this.subs.set(userId, sub);
    this.repo?.put(sub);
    return sub;
  }

  get(userId: string): Subscription | undefined {
    const s = this.subs.get(userId);
    if (s && s.usageDate !== today()) {
      s.usageDate = today();
      s.usedToday = 0; // réinitialisation quotidienne du quota
    }
    return s;
  }

  /** Consomme une course incluse si le quota du jour le permet. */
  consumeRide(userId: string): { covered: boolean; remaining: number } {
    const s = this.get(userId);
    if (!s || !s.active) return { covered: false, remaining: 0 };
    if (s.usedToday >= s.ridesPerDay) return { covered: false, remaining: 0 };
    s.usedToday += 1;
    this.repo?.put(s);
    return { covered: true, remaining: s.ridesPerDay - s.usedToday };
  }

  cancel(userId: string): Subscription {
    const s = this.subs.get(userId);
    if (!s) throw notFound('Aucun abonnement');
    s.active = false;
    this.repo?.put(s);
    return s;
  }
}
