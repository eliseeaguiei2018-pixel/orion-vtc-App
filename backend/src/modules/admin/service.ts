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
