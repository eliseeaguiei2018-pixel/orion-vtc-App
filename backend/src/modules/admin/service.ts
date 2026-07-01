import type { Container } from '../../container.js';
import type { RideStatus } from '../services/ride/stateMachine.js';

/**
 * Service d'agrégation pour le dashboard Admin / supervision SAMU.
 * Lecture seule sur les stores existants (courses, chauffeurs, sécurité, portefeuille).
 * En production, ces agrégats seraient calculés côté base (vues/matérialisées).
 */
const ACTIVE: ReadonlySet<RideStatus> = new Set([
  'searching', 'accepted', 'driver_en_route', 'arrived', 'in_progress',
]);
const REVENUE: ReadonlySet<RideStatus> = new Set(['completed', 'paid', 'rated']);
const ALERT_OPEN = new Set(['raised', 'dispatched', 'acknowledged']);

export class AdminService {
  constructor(private readonly c: Container) {}

  overview() {
    const rides = this.c.rides.listAll();
    const byStatus: Record<string, number> = {};
    let revenue = 0, gmv = 0;
    for (const r of rides) {
      byStatus[r.status] = (byStatus[r.status] ?? 0) + 1;
      gmv += r.quote.amount;
      if (REVENUE.has(r.status)) revenue += r.quote.amount;
    }
    const drivers = this.c.drivers.list();
    const online = drivers.filter((d) => d.availability !== 'offline').length;
    const onTrip = drivers.filter((d) => d.availability === 'on_trip').length;
    const alerts = this.c.safety.list();
    const openAlerts = alerts.filter((a) => ALERT_OPEN.has(a.status)).length;
    const wallet = this.c.wallet.totals();

    return {
      currency: 'XOF',
      rides: {
        total: rides.length,
        active: rides.filter((r) => ACTIVE.has(r.status)).length,
        completed: (byStatus.completed ?? 0) + (byStatus.paid ?? 0) + (byStatus.rated ?? 0),
        cancelled: (byStatus.cancelled ?? 0) + (byStatus.no_driver ?? 0),
        byStatus,
      },
      drivers: { total: drivers.length, online, onTrip },
      finance: { gmv: Math.round(gmv), revenue: Math.round(revenue), commission: wallet.commission, payouts: wallet.payouts },
      safety: { total: alerts.length, open: openAlerts },
      generatedAt: new Date().toISOString(),
    };
  }

  rides(opts: { status?: string; limit?: number } = {}) {
    let list = this.c.rides.listAll();
    if (opts.status) list = list.filter((r) => r.status === opts.status);
    return list.slice(0, opts.limit ?? 100).map((r) => {
      const driver = r.driverId ? this.c.drivers.get(r.driverId) : undefined;
      return {
        id: r.id,
        clientId: r.clientId,
        driverId: r.driverId ?? null,
        driverName: driver?.name ?? null,
        matricule: driver?.matricule ?? null,
        status: r.status,
        amount: r.quote.amount,
        currency: r.quote.currency,
        trafficLevel: r.quote.trafficLevel,
        origin: r.origin,
        destination: r.destination,
        createdAt: r.createdAt,
      };
    });
  }

  /** Agrégats financiers (reporting) : GMV, revenu, commission, payouts + par niveau. */
  finance() {
    const rides = this.c.rides.listAll();
    const byTier: Record<string, { count: number; revenue: number }> = {};
    let gmv = 0, revenue = 0;
    for (const r of rides) {
      gmv += r.quote.amount;
      const tier = r.quote.serviceType === 'delivery' ? 'livraison' : (r.driverId ? this.c.drivers.get(r.driverId)?.category ?? r.serviceType : r.serviceType);
      byTier[tier] ??= { count: 0, revenue: 0 };
      byTier[tier].count += 1;
      if (REVENUE.has(r.status)) { revenue += r.quote.amount; byTier[tier].revenue += r.quote.amount; }
    }
    const wallet = this.c.wallet.totals();
    return {
      currency: 'XOF',
      gmv: Math.round(gmv), revenue: Math.round(revenue),
      commission: wallet.commission, earnings: wallet.earnings, payouts: wallet.payouts,
      byTier,
    };
  }

  /**
   * Séries quotidiennes sur N jours (tendances) : courses, revenu, annulations.
   * Calculé depuis les courses (par jour UTC). Alimente les graphes de la console.
   */
  stats(days = 7) {
    const n = Math.min(90, Math.max(1, Math.round(days)));
    const dayKey = (d: Date) => d.toISOString().slice(0, 10);
    const buckets = new Map<string, { date: string; rides: number; revenue: number; cancelled: number }>();
    const today = new Date();
    for (let i = n - 1; i >= 0; i--) {
      const d = new Date(today);
      d.setUTCDate(today.getUTCDate() - i);
      buckets.set(dayKey(d), { date: dayKey(d), rides: 0, revenue: 0, cancelled: 0 });
    }
    for (const r of this.c.rides.listAll()) {
      const b = buckets.get(r.createdAt.slice(0, 10));
      if (!b) continue;
      b.rides += 1;
      if (REVENUE.has(r.status)) b.revenue += r.quote.amount;
      if (r.status === 'cancelled' || r.status === 'no_driver') b.cancelled += 1;
    }
    const series = [...buckets.values()].map((b) => ({ ...b, revenue: Math.round(b.revenue) }));
    return {
      currency: 'XOF', days: n, series,
      totals: {
        rides: series.reduce((s, b) => s + b.rides, 0),
        revenue: series.reduce((s, b) => s + b.revenue, 0),
        cancelled: series.reduce((s, b) => s + b.cancelled, 0),
      },
    };
  }

  /** Export CSV des courses (comptabilité). */
  ridesCsv(): string {
    const head = 'id,clientId,driverName,matricule,status,amount,currency,trafficLevel,createdAt';
    const rows = this.c.rides.listAll().map((r) => {
      const d = r.driverId ? this.c.drivers.get(r.driverId) : undefined;
      return [r.id, r.clientId, d?.name ?? '', d?.matricule ?? '', r.status, r.quote.amount, r.quote.currency, r.quote.trafficLevel, r.createdAt]
        .map((v) => String(v).replace(/[",\n]/g, ' ')).join(',');
    });
    return [head, ...rows].join('\n');
  }

  drivers() {
    return this.c.drivers.list().map((d) => ({
      id: d.id,
      name: d.name,
      matricule: d.matricule,
      category: d.category,
      kycStatus: d.kycStatus,
      availability: d.availability,
      rating: d.ratingAvg,
      trips: d.ratingCount,
      balance: this.c.wallet.balance(d.id),
    }));
  }

  /** Fiche détaillée d'un chauffeur : profil + gains + dernières courses. */
  driverDetail(id: string) {
    const d = this.c.drivers.get(id);
    if (!d) return null;
    const history = this.c.wallet.history(id);
    const rides = this.c.rides.listAll().filter((r) => r.driverId === id).slice(0, 20).map((r) => ({
      id: r.id, status: r.status, amount: r.quote.amount, createdAt: r.createdAt,
    }));
    const earnings = history.filter((e) => e.type === 'ride_earning').reduce((s, e) => s + e.amount, 0);
    return {
      id: d.id, name: d.name, matricule: d.matricule, category: d.category,
      kycStatus: d.kycStatus, availability: d.availability, rating: d.ratingAvg, trips: d.ratingCount,
      balance: this.c.wallet.balance(id), earnings: Math.round(earnings),
      ledger: history.slice(0, 20),
      rides,
    };
  }

  /** Fiche détaillée d'un client : profil + dépenses + courses + conversations. */
  clientDetail(id: string) {
    const c = this.c.clients.get(id);
    const rides = this.c.rides.listByClient(id).slice(0, 20).map((r) => ({
      id: r.id, status: r.status, amount: r.quote.amount, createdAt: r.createdAt,
    }));
    const spent = this.c.rides.listByClient(id).filter((r) => REVENUE.has(r.status)).reduce((s, r) => s + r.quote.amount, 0);
    const conversations = this.c.support.listByClient(id).map((cv) => ({ id: cv.id, subject: cv.subject, status: cv.status, messages: cv.messages.length }));
    return {
      id,
      name: c?.name ?? null, phone: c?.phone ?? null, status: c?.status ?? 'active',
      rides: c?.rides ?? rides.length, createdAt: c?.createdAt ?? null,
      spent: Math.round(spent),
      recentRides: rides,
      conversations,
    };
  }

  /**
   * Recherche globale de la console : chauffeurs, clients, courses.
   * `scope` limite chaque catégorie aux permissions du rôle appelant.
   */
  search(q: string, scope: { drivers: boolean; clients: boolean; rides: boolean }) {
    const needle = q.trim().toLowerCase();
    const LIMIT = 8;
    const out: {
      drivers: { id: string; name: string; matricule: string; category: string; availability: string }[];
      clients: { id: string; name: string | null; phone: string | null; status: string; rides: number }[];
      rides: { id: string; clientId: string; status: string; amount: number; createdAt: string }[];
    } = { drivers: [], clients: [], rides: [] };
    if (needle.length < 2) return out;

    if (scope.drivers) {
      out.drivers = this.c.drivers.list()
        .filter((d) => d.name.toLowerCase().includes(needle) || d.matricule.toLowerCase().includes(needle) || d.id.toLowerCase().includes(needle))
        .slice(0, LIMIT)
        .map((d) => ({ id: d.id, name: d.name, matricule: d.matricule, category: d.category, availability: d.availability }));
    }
    if (scope.clients) {
      out.clients = this.c.clients.list()
        .filter((cl) => cl.id.toLowerCase().includes(needle) || (cl.name ?? '').toLowerCase().includes(needle) || (cl.phone ?? '').toLowerCase().includes(needle))
        .slice(0, LIMIT)
        .map((cl) => ({ id: cl.id, name: cl.name ?? null, phone: cl.phone ?? null, status: cl.status, rides: cl.rides }));
    }
    if (scope.rides) {
      out.rides = this.c.rides.listAll()
        .filter((r) => r.id.toLowerCase().includes(needle) || r.clientId.toLowerCase().includes(needle))
        .slice(0, LIMIT)
        .map((r) => ({ id: r.id, clientId: r.clientId, status: r.status, amount: r.quote.amount, createdAt: r.createdAt }));
    }
    return out;
  }

  /** Positions vivantes de la flotte (carte de supervision). */
  async fleetLive() {
    const snap = await this.c.geo.snapshot();
    return snap.map((e) => {
      const d = this.c.drivers.get(e.id);
      return {
        id: e.id,
        lat: e.lat,
        lng: e.lng,
        name: d?.name ?? 'Chauffeur',
        matricule: d?.matricule ?? null,
        category: (e.meta?.category as string) ?? d?.category ?? 'bronze',
        availability: d?.availability ?? 'online',
      };
    });
  }
}
