import { randomUUID } from 'node:crypto';
import { badRequest, notFound } from '../../core/errors.js';
import type { Repository } from '../../core/db/repository.js';
import { isTier, type Tier } from '../fleet/catalog.js';

/**
 * ABONNEMENTS MENSUELS ORION.
 *
 * Chaque pack offre un nombre de courses incluses par jour, dans la limite d'un
 * PLAFOND par course et d'une liste de NIVEAUX accessibles, plus des avantages
 * (remise hors quota, remise location, priorité de mise en relation, annulation
 * gratuite). Le quota se réinitialise chaque jour ; l'abonnement se renouvelle
 * tous les 30 jours sur facture.
 *
 * Deux règles de conception, apprises de l'audit :
 *   1. CONSULTER NE CONSOMME RIEN. `apercu()` calcule ce que l'abonnement couvrirait
 *      sans toucher au quota ; seule `consumeRide()`, appelée à la CRÉATION de la
 *      course, décrémente réellement. Confondre les deux revenait à vider le quota
 *      d'un client qui compare simplement les gammes.
 *   2. UN AVANTAGE ANNONCÉ DOIT ÊTRE APPLIQUÉ PAR LE CODE. Les plafonds, les niveaux
 *      autorisés et les remises sont désormais lus par la course et par la location,
 *      et non plus seulement affichés dans une liste d'arguments.
 */
export type PlanId = 'bronze' | 'argent' | 'gold';

export interface Plan {
  id: PlanId;
  label: string;
  ridesPerDay: number;
  monthlyPrice: number; // FCFA
  /** Plafond pris en charge par course incluse (au-delà : complément payé). */
  perRideCap: number;
  /** Niveaux de course couverts par les courses incluses. */
  tiers: Tier[];
  /** Remise sur les courses au-delà du quota quotidien. */
  remiseHorsQuota: number;
  /** Remise sur les LOCATIONS ORION (événement, entreprise, mise à disposition). */
  remiseLocation: number;
  /** Bonus de priorité à la mise en relation (0 = aucun). */
  priorite: number;
  /** Annulation sans frais. */
  annulationGratuite: boolean;
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
    tiers: ['argent'],
    remiseHorsQuota: 0,
    remiseLocation: 0,
    priorite: 0,
    annulationGratuite: false,
    benefits: ['2 courses incluses / jour', 'Gamme Argent', 'Plafond 2 500 F par course incluse', 'Support standard'],
    accent: '#cd7f4d',
  },
  argent: {
    id: 'argent',
    label: 'Pack Argent',
    ridesPerDay: 3,
    monthlyPrice: 38_000,
    perRideCap: 3_500,
    tiers: ['argent', 'or'],
    remiseHorsQuota: 0.1,
    remiseLocation: 0.05,
    priorite: 1,
    annulationGratuite: false,
    benefits: ['3 courses incluses / jour', 'Gammes Argent et Or', 'Plafond 3 500 F par course incluse', 'Priorité de mise en relation', '-10 % au-delà du quota', '-5 % sur les locations'],
    accent: '#c8d2dc',
  },
  gold: {
    id: 'gold',
    label: 'Pack Gold',
    ridesPerDay: 4,
    monthlyPrice: 55_000,
    perRideCap: 5_000,
    tiers: ['argent', 'or', 'diamant'],
    remiseHorsQuota: 0.15,
    remiseLocation: 0.1,
    priorite: 2,
    annulationGratuite: true,
    benefits: ['4 courses incluses / jour', 'Toutes les gammes (jusqu’à Diamant)', 'Plafond 5 000 F par course incluse', 'Priorité maximale', '-15 % au-delà du quota', '-10 % sur les locations', 'Annulation gratuite'],
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
  /** Renouvellement automatique à l'échéance (facture émise d'office). */
  autoRenew: boolean;
  /** Moyen de paiement mémorisé pour les échéances. */
  paymentMethod?: string;
  /** Résiliation : date et motif (traçabilité support). */
  cancelledAt?: string;
  cancelReason?: string;
  /** Cumul des montants effectivement pris en charge par l'abonnement. */
  totalCouvert: number;
  /** Nombre de courses couvertes depuis la souscription (valeur réelle rendue). */
  coursesCouvertes: number;
}

/** Facture d'abonnement : c'est elle qui rend l'abonnement RÉEL côté caisse. */
export interface SubscriptionInvoice {
  id: string;
  userId: string;
  plan: PlanId;
  amount: number;
  periodeDebut: string;
  periodeFin: string;
  status: 'en_attente' | 'payee' | 'echouee';
  method?: string;
  reference?: string;
  emiseLe: string;
  payeeLe?: string;
  /** Message d'échec de l'opérateur (relance support). */
  motifEchec?: string;
}

/** Ce que l'abonnement fait sur une course donnée. */
export interface CoverageResult {
  /** Une course incluse a été utilisée (ou le serait). */
  covered: boolean;
  plan?: PlanId;
  /** Montant pris en charge par ORION. */
  montantCouvert: number;
  /** Remise commerciale appliquée (courses hors quota). */
  remise: number;
  /** Reste à payer par le client. */
  aPayer: number;
  /** Courses incluses restantes aujourd'hui (après l'opération). */
  remaining: number;
  /** Explication affichée au client (toujours renseignée). */
  raison: string;
}

const today = () => new Date().toISOString().slice(0, 10);
const addDays = (d: Date, n: number) => new Date(d.getTime() + n * 86_400_000);
/** Jours de tolérance après l'échéance avant suspension pour impayé. */
export const JOURS_GRACE_IMPAYE = 5;

export class SubscriptionService {
  private readonly subs = new Map<string, Subscription>(); // par userId
  private readonly invoices = new Map<string, SubscriptionInvoice>();

  constructor(
    private readonly repo?: Repository<Subscription>,
    private readonly invoiceRepo?: Repository<SubscriptionInvoice>,
  ) {
    for (const s of repo?.all() ?? []) this.subs.set(s.userId, s);
    for (const f of invoiceRepo?.all() ?? []) this.invoices.set(f.id, f);
  }

  subscribe(userId: string, plan: string, opts: { paymentMethod?: string; autoRenew?: boolean } = {}): Subscription {
    if (!isPlan(plan)) throw badRequest('Forfait inconnu');
    const p = PLANS[plan];
    const now = new Date();
    const existant = this.subs.get(userId);
    const sub: Subscription = {
      id: existant?.id ?? randomUUID(),
      userId,
      plan,
      startedAt: now.toISOString(),
      renewsAt: addDays(now, 30).toISOString(),
      ridesPerDay: p.ridesPerDay,
      // Changement de formule en cours de journée : on conserve ce qui a déjà été
      // consommé, sinon il suffirait de re-souscrire pour remettre son quota à zéro.
      usedToday: existant?.usageDate === today() ? existant.usedToday : 0,
      usageDate: today(),
      active: true,
      autoRenew: opts.autoRenew ?? true,
      paymentMethod: opts.paymentMethod,
      totalCouvert: existant?.totalCouvert ?? 0,
      coursesCouvertes: existant?.coursesCouvertes ?? 0,
    };
    this.subs.set(userId, sub);
    this.repo?.put(sub);
    // Facture de la période : l'abonnement n'existe pas sans encaissement à suivre.
    this.emettreFacture(sub);
    return sub;
  }

  /** Émet la facture de la période en cours (statut « en attente » de règlement). */
  private emettreFacture(sub: Subscription): SubscriptionInvoice {
    const f: SubscriptionInvoice = {
      id: randomUUID().slice(0, 8).toUpperCase(),
      userId: sub.userId,
      plan: sub.plan,
      amount: PLANS[sub.plan].monthlyPrice,
      periodeDebut: sub.startedAt,
      periodeFin: sub.renewsAt,
      status: 'en_attente',
      method: sub.paymentMethod,
      emiseLe: new Date().toISOString(),
    };
    this.invoices.set(f.id, f);
    this.invoiceRepo?.put(f);
    return f;
  }

  /** Règlement confirmé par la passerelle (ou encaissé par le support). */
  payerFacture(invoiceId: string, info: { method?: string; reference?: string } = {}): SubscriptionInvoice {
    const f = this.invoices.get(invoiceId);
    if (!f) throw notFound('Facture d’abonnement introuvable');
    f.status = 'payee';
    f.payeeLe = new Date().toISOString();
    if (info.method) f.method = info.method;
    if (info.reference) f.reference = info.reference;
    delete f.motifEchec;
    this.invoiceRepo?.put(f);
    // Un règlement rouvre un abonnement suspendu pour impayé.
    const s = this.subs.get(f.userId);
    if (s && !s.active && !s.cancelledAt) { s.active = true; this.repo?.put(s); }
    return f;
  }

  /** Échec de prélèvement signalé par l'opérateur. */
  echecFacture(invoiceId: string, motif: string): SubscriptionInvoice {
    const f = this.invoices.get(invoiceId);
    if (!f) throw notFound('Facture d’abonnement introuvable');
    f.status = 'echouee';
    f.motifEchec = motif;
    this.invoiceRepo?.put(f);
    return f;
  }

  facturesDe(userId: string): SubscriptionInvoice[] {
    return [...this.invoices.values()]
      .filter((f) => f.userId === userId)
      .sort((a, b) => Date.parse(b.emiseLe) - Date.parse(a.emiseLe));
  }

  /** Vue console : toutes les factures, filtrables par statut. */
  factures(status?: SubscriptionInvoice['status']): SubscriptionInvoice[] {
    return [...this.invoices.values()]
      .filter((f) => !status || f.status === status)
      .sort((a, b) => Date.parse(b.emiseLe) - Date.parse(a.emiseLe));
  }

  get(userId: string): Subscription | undefined {
    const s = this.subs.get(userId);
    if (!s) return undefined;
    if (s.usageDate !== today()) {
      s.usageDate = today();
      s.usedToday = 0; // réinitialisation quotidienne du quota
      this.repo?.put(s);
    }
    return s;
  }

  /** L'échéance est-elle dépassée ? (un abonnement échu ne couvre plus rien) */
  private echu(s: Subscription): boolean {
    return Date.parse(s.renewsAt) <= Date.now();
  }

  /** État complet pour l'app cliente et la console. */
  etat(userId: string): {
    subscription: Subscription | null; plan: Plan | null; echu: boolean;
    joursRestants: number; restantesAujourdhui: number; factureEnAttente: SubscriptionInvoice | null;
  } {
    const s = this.get(userId);
    if (!s) return { subscription: null, plan: null, echu: false, joursRestants: 0, restantesAujourdhui: 0, factureEnAttente: null };
    const ms = Date.parse(s.renewsAt) - Date.now();
    return {
      subscription: s,
      plan: PLANS[s.plan],
      echu: this.echu(s),
      joursRestants: Math.max(0, Math.ceil(ms / 86_400_000)),
      restantesAujourdhui: s.active && !this.echu(s) ? Math.max(0, s.ridesPerDay - s.usedToday) : 0,
      factureEnAttente: this.facturesDe(userId).find((f) => f.status !== 'payee') ?? null,
    };
  }

  /**
   * Renouvellement de la période (manuel ou automatique à l'échéance). Émet la
   * facture suivante : sans facture, un « abonnement » n'est qu'un affichage.
   */
  renew(userId: string): { subscription: Subscription; facture: SubscriptionInvoice } {
    const s = this.subs.get(userId);
    if (!s) throw notFound('Aucun abonnement');
    if (s.cancelledAt) throw badRequest('Abonnement résilié — souscrivez à nouveau');
    const base = this.echu(s) ? new Date() : new Date(s.renewsAt);
    s.startedAt = base.toISOString();
    s.renewsAt = addDays(base, 30).toISOString();
    s.active = true;
    this.repo?.put(s);
    return { subscription: s, facture: this.emettreFacture(s) };
  }

  /**
   * Échéances à traiter (tâche périodique / bouton console) :
   * renouvelle les abonnements à renouvellement automatique, suspend ceux dont la
   * facture reste impayée au-delà du délai de grâce.
   */
  traiterEcheances(): { renouveles: string[]; suspendus: string[] } {
    const renouveles: string[] = [];
    const suspendus: string[] = [];
    for (const s of this.subs.values()) {
      if (s.cancelledAt) continue;
      const impayees = this.facturesDe(s.userId).filter((f) => f.status !== 'payee');
      const tropVieille = impayees.some((f) => Date.now() - Date.parse(f.emiseLe) > JOURS_GRACE_IMPAYE * 86_400_000);
      if (tropVieille && s.active) {
        s.active = false;
        this.repo?.put(s);
        suspendus.push(s.userId);
        continue;
      }
      if (this.echu(s) && s.autoRenew && s.active) {
        this.renew(s.userId);
        renouveles.push(s.userId);
      }
    }
    return { renouveles, suspendus };
  }

  /**
   * Ce que l'abonnement ferait sur cette course — SANS RIEN CONSOMMER.
   * Utilisé par l'estimation de prix : comparer les gammes ne doit pas coûter
   * une course incluse.
   */
  apercu(userId: string, course: { amount: number; tier?: string }): CoverageResult {
    return this.calculer(userId, course, false);
  }

  /**
   * Consomme une course incluse si toutes les conditions du forfait sont réunies
   * (abonnement actif et à jour, quota du jour, niveau autorisé). Appelée à la
   * CRÉATION de la course, jamais à l'estimation.
   */
  consumeRide(userId: string, course: { amount?: number; tier?: string } = {}): CoverageResult {
    return this.calculer(userId, { amount: course.amount ?? 0, tier: course.tier }, true);
  }

  private calculer(userId: string, course: { amount: number; tier?: string }, consommer: boolean): CoverageResult {
    const aucun = (raison: string): CoverageResult =>
      ({ covered: false, montantCouvert: 0, remise: 0, aPayer: Math.max(0, Math.round(course.amount)), remaining: 0, raison });

    const s = this.get(userId);
    if (!s) return aucun('Aucun abonnement ORION sur ce compte');
    const p = PLANS[s.plan];
    if (!s.active) return aucun('Abonnement suspendu — régularisez votre facture pour en profiter');
    if (this.echu(s)) return aucun('Abonnement arrivé à échéance — renouvelez-le pour en profiter');

    // Niveau non couvert : on applique quand même la remise d'abonné, sinon
    // l'avantage « priorité / remise » annoncé serait purement décoratif.
    const tier = course.tier;
    if (tier && isTier(tier) && !p.tiers.includes(tier)) {
      const remise = Math.round(course.amount * p.remiseHorsQuota);
      return {
        covered: false, plan: s.plan, montantCouvert: 0, remise,
        aPayer: Math.max(0, Math.round(course.amount) - remise),
        remaining: Math.max(0, s.ridesPerDay - s.usedToday),
        raison: `Niveau ${tier} non inclus dans le ${p.label}${remise > 0 ? ` — remise abonné de ${Math.round(p.remiseHorsQuota * 100)} % appliquée` : ''}`,
      };
    }

    const restantes = Math.max(0, s.ridesPerDay - s.usedToday);
    if (restantes === 0) {
      const remise = Math.round(course.amount * p.remiseHorsQuota);
      return {
        covered: false, plan: s.plan, montantCouvert: 0, remise,
        aPayer: Math.max(0, Math.round(course.amount) - remise),
        remaining: 0,
        raison: remise > 0
          ? `Quota du jour épuisé — remise abonné de ${Math.round(p.remiseHorsQuota * 100)} % appliquée`
          : 'Quota du jour épuisé',
      };
    }

    // PLAFOND PAR COURSE : ORION prend en charge jusqu'au plafond du forfait ; le
    // dépassement reste à la charge du client (c'est la règle annoncée).
    const montantCouvert = Math.min(Math.round(course.amount), p.perRideCap);
    const aPayer = Math.max(0, Math.round(course.amount) - montantCouvert);

    if (consommer) {
      s.usedToday += 1;
      s.totalCouvert += montantCouvert;
      s.coursesCouvertes += 1;
      this.repo?.put(s);
    }

    const apres = Math.max(0, s.ridesPerDay - s.usedToday - (consommer ? 0 : 1));
    return {
      covered: true,
      plan: s.plan,
      montantCouvert,
      remise: 0,
      aPayer,
      remaining: apres,
      raison: aPayer > 0
        ? `Course incluse — prise en charge plafonnée à ${p.perRideCap.toLocaleString('fr-FR')} F, complément à votre charge`
        : 'Course entièrement incluse dans votre abonnement ORION',
    };
  }

  /** Remise d'abonné applicable aux LOCATIONS (0 si aucun abonnement actif). */
  remiseLocation(userId: string): number {
    const s = this.get(userId);
    if (!s || !s.active || this.echu(s)) return 0;
    return PLANS[s.plan].remiseLocation;
  }

  /** Bonus de priorité au dispatch (0 si aucun abonnement actif). */
  priorite(userId: string): number {
    const s = this.get(userId);
    if (!s || !s.active || this.echu(s)) return 0;
    return PLANS[s.plan].priorite;
  }

  /** L'annulation est-elle sans frais pour ce client ? */
  annulationGratuite(userId: string): boolean {
    const s = this.get(userId);
    if (!s || !s.active || this.echu(s)) return false;
    return PLANS[s.plan].annulationGratuite;
  }

  cancel(userId: string, raison?: string): Subscription {
    const s = this.subs.get(userId);
    if (!s) throw notFound('Aucun abonnement');
    s.active = false;
    s.cancelledAt = new Date().toISOString();
    s.cancelReason = raison;
    this.repo?.put(s);
    return s;
  }

  /** Tous les abonnements (console). */
  list(): Subscription[] { return [...this.subs.values()]; }

  /** Indicateurs console : parc d'abonnés, revenu récurrent, valeur rendue. */
  stats(): {
    total: number; actifs: number; parPlan: Record<string, number>; mrr: number;
    impayees: number; montantImpaye: number; totalCouvert: number; coursesCouvertes: number;
  } {
    const parPlan: Record<string, number> = {};
    let actifs = 0;
    let mrr = 0;
    let totalCouvert = 0;
    let coursesCouvertes = 0;
    for (const s of this.subs.values()) {
      parPlan[s.plan] = (parPlan[s.plan] ?? 0) + 1;
      totalCouvert += s.totalCouvert;
      coursesCouvertes += s.coursesCouvertes;
      if (s.active && !this.echu(s)) { actifs += 1; mrr += PLANS[s.plan].monthlyPrice; }
    }
    const impayees = this.factures('en_attente').concat(this.factures('echouee'));
    return {
      total: this.subs.size, actifs, parPlan, mrr,
      impayees: impayees.length,
      montantImpaye: impayees.reduce((n, f) => n + f.amount, 0),
      totalCouvert, coursesCouvertes,
    };
  }
}
