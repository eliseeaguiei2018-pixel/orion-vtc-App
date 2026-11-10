import type { Container } from '../../container.js';
import type { RideStatus } from '../services/ride/stateMachine.js';
import type { Ride } from '../rides/store.js';
import type { EmergencyAlert } from '../safety/service.js';
import { haversineMeters } from '../../core/geo.js';
import { simplePdf } from '../../core/pdf.js';
import { config } from '../../config/index.js';

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

/** Formatage court F CFA pour les documents générés (PDF/textes). */
const fcfaLite = (n: number): string => `${Math.round(n).toLocaleString('fr-FR')} F CFA`;

/** Garages partenaires agréés (dont habilitation électrique haute tension). */
export const GARAGES = [
  { id: 'gar-cocody', name: 'Garage ORION Cocody (agréé VE)', electric: true, zone: 'Cocody' },
  { id: 'gar-marcory', name: 'Garage Partenaire Marcory', electric: false, zone: 'Marcory' },
  { id: 'gar-yopougon', name: 'Garage Yopougon Auto (agréé VE)', electric: true, zone: 'Yopougon' },
];

/** Bornes de recharge partenaires (Abidjan) — affichées sur la carte console. */
export const CHARGING_STATIONS = [
  { id: 'cs-plateau', name: 'Borne Plateau — Rue du Commerce', lat: 5.3236, lng: -4.0187, fast: true },
  { id: 'cs-cocody', name: 'Borne Cocody — Riviera 2', lat: 5.3601, lng: -3.9788, fast: true },
  { id: 'cs-marcory', name: 'Borne Marcory — Bd VGE', lat: 5.3009, lng: -3.9812, fast: false },
  { id: 'cs-yopougon', name: 'Borne Yopougon — Niangon', lat: 5.3341, lng: -4.0899, fast: false },
  { id: 'cs-aeroport', name: 'Borne Aéroport FHB', lat: 5.2606, lng: -3.9296, fast: true },
];

/** Pagination serveur : découpe une liste et renvoie les métadonnées (page 1-indexée). */
export interface PageMeta { total: number; page: number; pages: number; limit: number }
export function paginate<T>(list: T[], pageOpt?: number, limitOpt?: number): { items: T[]; meta: PageMeta } {
  const limit = Math.min(200, Math.max(1, Math.round(limitOpt ?? 25)));
  const total = list.length;
  const pages = Math.max(1, Math.ceil(total / limit));
  const page = Math.min(pages, Math.max(1, Math.round(pageOpt ?? 1)));
  return { items: list.slice((page - 1) * limit, page * limit), meta: { total, page, pages, limit } };
}

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

  /**
   * Détection d'ANOMALIES (Smart Alerts) : la course est mise en surbrillance dans
   * le board si un signal opérationnel sort du cadre (détour majeur, attente
   * excessive, recherche de chauffeur qui traîne, course figée).
   */
  rideAnomaly(r: Ride): string | null {
    const ageMin = (Date.now() - Date.parse(r.createdAt)) / 60_000;
    if ((r.status === 'searching' || r.status === 'no_driver') && ageMin > 5) return 'sans_chauffeur';
    if ((r.waitMinutes ?? 0) >= 10) return 'attente_longue';
    if (r.status === 'accepted' && ageMin > 15) return 'immobile';
    if (r.status === 'in_progress' && r.trace && r.trace.length >= 8) {
      const direct = haversineMeters(r.origin, r.destination);
      let path = 0;
      for (let i = 1; i < r.trace.length; i++) path += haversineMeters(r.trace[i - 1]!, r.trace[i]!);
      if (direct > 500 && path > direct * 1.9) return 'detour';
    }
    return null;
  }

  rides(opts: { status?: string; page?: number; limit?: number } = {}) {
    let list = this.c.rides.listAll();
    if (opts.status) list = list.filter((r) => r.status === opts.status);
    const { items, meta } = paginate(list, opts.page, opts.limit);
    const rides = items.map((r) => {
      const driver = r.driverId ? this.c.drivers.get(r.driverId) : undefined;
      const client = this.c.clients.get(r.clientId);
      return {
        id: r.id,
        clientId: r.clientId,
        // Le dispatcher voyait le chauffeur mais pas le passager, et ne pouvait
        // joindre ni l'un ni l'autre : une course en difficulté se règle au téléphone.
        clientName: client?.name ?? null,
        clientPhone: client?.phone ?? null,
        driverId: r.driverId ?? null,
        driverName: driver?.name ?? null,
        driverPhone: driver?.phone ?? null,
        matricule: driver?.matricule ?? null,
        /** Contact de confiance désigné par le passager (partage de course). */
        trustedContact: r.trustedContact ?? null,
        paymentMethod: r.paymentMethod ?? null,
        status: r.status,
        amount: r.quote.amount,
        currency: r.quote.currency,
        trafficLevel: r.quote.trafficLevel,
        origin: r.origin,
        destination: r.destination,
        anomaly: this.rideAnomaly(r),
        createdAt: r.createdAt,
      };
    });
    return { rides, ...meta };
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
    // Split payment : la TVA collectée pour l'État est isolée du revenu plateforme.
    let taxes = 0;
    for (const r of rides) if (REVENUE.has(r.status)) taxes += r.quote.breakdown.tva;
    const wallet = this.c.wallet.totals();
    return {
      currency: 'XOF',
      gmv: Math.round(gmv), revenue: Math.round(revenue),
      commission: wallet.commission, earnings: wallet.earnings, payouts: wallet.payouts,
      taxes: Math.round(taxes),
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

  /**
   * Indicateurs de MOBILITÉ VERTE : CO2 économisé vs flotte thermique et part
   * des trajets 100 % électriques vs hybrides. Hypothèses (ADEME, arrondies) :
   * thermique ~150 g CO2/km ; électrique ~20 g/km (mix + fabrication) ;
   * hybride ~90 g/km. Basé sur les courses terminées (distance du devis).
   */
  green() {
    const G_THERMAL = 150, G_ELECTRIC = 20, G_HYBRID = 90; // g CO2 / km
    let kmElectric = 0, kmHybrid = 0, ridesElectric = 0, ridesHybrid = 0;
    for (const r of this.c.rides.listAll()) {
      if (!REVENUE.has(r.status)) continue;
      const km = (r.quote.distanceMeters ?? 0) / 1000;
      const engine = r.driverId ? this.c.drivers.get(r.driverId)?.engine ?? 'electric' : 'electric';
      if (engine === 'hybrid') { kmHybrid += km; ridesHybrid += 1; }
      else { kmElectric += km; ridesElectric += 1; } // flotte ORION : électrique par défaut
    }
    const savedKg = (kmElectric * (G_THERMAL - G_ELECTRIC) + kmHybrid * (G_THERMAL - G_HYBRID)) / 1000;
    const totalRides = ridesElectric + ridesHybrid;
    const fleet = this.c.drivers.list();
    return {
      co2SavedKg: Math.round(savedKg * 10) / 10,
      co2SavedTons: Math.round(savedKg / 10) / 100,
      kmElectric: Math.round(kmElectric), kmHybrid: Math.round(kmHybrid),
      electricShare: totalRides ? Math.round((ridesElectric / totalRides) * 100) : 100,
      hybridShare: totalRides ? Math.round((ridesHybrid / totalRides) * 100) : 0,
      fleet: {
        electric: fleet.filter((d) => (d.engine ?? 'electric') === 'electric').length,
        hybrid: fleet.filter((d) => d.engine === 'hybrid').length,
        lowBattery: fleet.filter((d) => d.batteryPct !== undefined && d.batteryPct < 20).length,
        batteries: fleet.filter((d) => d.batteryPct !== undefined)
          .map((d) => ({ id: d.id, name: d.name, matricule: d.matricule, batteryPct: d.batteryPct, batteryHealthPct: d.batteryHealthPct ?? null, availability: d.availability })),
        /** Santé moyenne des batteries (SoH) — planification maintenance. */
        avgSoh: (() => {
          const soh = fleet.filter((d) => d.batteryHealthPct !== undefined).map((d) => d.batteryHealthPct!);
          return soh.length ? Math.round(soh.reduce((a, b) => a + b, 0) / soh.length) : null;
        })(),
      },
      /** Top Points Carbone : passagers les plus engagés (fidélisation verte). */
      topGreenClients: this.c.clients.list()
        .filter((cl) => (cl.greenPoints ?? 0) > 0)
        .sort((a, b) => (b.greenPoints ?? 0) - (a.greenPoints ?? 0))
        .slice(0, 5)
        .map((cl) => ({ id: cl.id, name: cl.name ?? null, greenPoints: cl.greenPoints ?? 0 })),
      chargingStations: CHARGING_STATIONS,
    };
  }

  /**
   * BILAN CARBONE PDF (communication institutionnelle / subventions) :
   * certificat d'économie de CO2 généré sans dépendance (PDF 1.4 minimal).
   */
  greenReportPdf(): Buffer {
    const g = this.green();
    const today = new Date().toLocaleDateString('fr-FR');
    const lines = [
      'ORION - CERTIFICAT D’ECONOMIE DE CO2',
      `Genere le ${today} · Abidjan, Cote d’Ivoire`,
      '',
      `CO2 economise vs flotte thermique : ${g.co2SavedTons >= 1 ? g.co2SavedTons + ' tonnes' : g.co2SavedKg + ' kg'}`,
      `Kilometres 100% electriques : ${g.kmElectric.toLocaleString('fr-FR')} km (${g.electricShare} % des trajets)`,
      `Kilometres hybrides : ${g.kmHybrid.toLocaleString('fr-FR')} km (${g.hybridShare} % des trajets)`,
      `Flotte : ${g.fleet.electric} vehicules electriques · ${g.fleet.hybrid} hybrides`,
      '',
      'Hypotheses : thermique ~150 g CO2/km, electrique ~20 g/km, hybride ~90 g/km.',
      'Base : courses terminees, distances des devis verrouilles (auditables).',
      '',
      'ORION — Green Mobility · Document destine aux partenaires institutionnels.',
    ];
    // PDF 1.4 minimal : une page A4, texte Helvetica (echappement () et \).
    const esc = (s: string) => s.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
    const content = ['BT /F1 12 Tf 50 780 Td 18 TL', ...lines.map((l, i) => `${i === 0 ? '' : 'T* '}(${esc(l)}) Tj`), 'ET'].join('\n');
    const objs = [
      '<< /Type /Catalog /Pages 2 0 R >>',
      '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
      '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
      `<< /Length ${Buffer.byteLength(content)} >>\nstream\n${content}\nendstream`,
      '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    ];
    let pdf = '%PDF-1.4\n';
    const offsets: number[] = [];
    objs.forEach((o, i) => { offsets.push(Buffer.byteLength(pdf)); pdf += `${i + 1} 0 obj\n${o}\nendobj\n`; });
    const xref = Buffer.byteLength(pdf);
    pdf += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n`;
    for (const off of offsets) pdf += `${String(off).padStart(10, '0')} 00000 n \n`;
    pdf += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
    return Buffer.from(pdf);
  }

  /**
   * HEATMAP PRÉDICTIVE (30–60 min) : moyenne historique des courses par cellule
   * pour l'heure à venir (même heure les jours précédents). Comparée à l'offre
   * actuelle → recommandation d'affectation de chauffeurs EN AVANCE.
   */
  async predict() {
    const nextHour = (new Date().getUTCHours() + 1) % 24;
    const byCellDays = new Map<string, Map<string, number>>(); // cell → jour → courses à cette heure
    for (const r of this.c.rides.listAll()) {
      const d = new Date(r.createdAt);
      if (d.getUTCHours() !== nextHour) continue;
      const cell = this.c.demand.keyFor(r.origin);
      const day = r.createdAt.slice(0, 10);
      const days = byCellDays.get(cell) ?? new Map<string, number>();
      days.set(day, (days.get(day) ?? 0) + 1);
      byCellDays.set(cell, days);
    }
    const cells = [] as { cell: string; lat: number; lng: number; expected: number; supply: number; gap: number }[];
    for (const [cell, days] of byCellDays) {
      const expected = Math.round([...days.values()].reduce((a, b) => a + b, 0) / days.size);
      if (expected === 0) continue;
      const [la, ln] = cell.split(':').map(Number);
      const lat = (la ?? 0) * 0.0072, lng = (ln ?? 0) * 0.0072;
      const supply = (await this.c.geo.nearby({ lat, lng }, 1200, 50)).length;
      cells.push({ cell, lat, lng, expected, supply, gap: Math.max(0, expected - supply) });
    }
    cells.sort((a, b) => b.gap - a.gap || b.expected - a.expected);
    return { hour: nextHour, cells: cells.slice(0, 12) };
  }

  /**
   * PRÉDICTION D'ATTRITION (churn) : clients réguliers silencieux depuis 14 jours,
   * chauffeurs inactifs depuis 7 jours → cibles des campagnes de réengagement.
   */
  churn() {
    const now = Date.now();
    const DAY = 86_400_000;
    const clients = this.c.clients.list()
      .filter((cl) => cl.rides >= 3 && now - Date.parse(cl.lastSeenAt) > 14 * DAY)
      .map((cl) => ({ id: cl.id, name: cl.name ?? null, rides: cl.rides, lastSeenAt: cl.lastSeenAt }))
      .slice(0, 50);
    const drivers = this.c.drivers.list()
      .filter((d) => d.availability === 'offline' && d.idleSince && now - Date.parse(d.idleSince) > 7 * DAY)
      .map((d) => ({ id: d.id, name: d.name, matricule: d.matricule, idleSince: d.idleSince }))
      .slice(0, 50);
    return { clients, drivers };
  }

  /** Export CSV des courses (comptabilité) — anti-injection de formule tableur. */
  ridesCsv(): string {
    const clean = (v: unknown) => {
      let s = String(v ?? '').replace(/[",\n]/g, ' ');
      if (/^[=+\-@]/.test(s)) s = `'${s}`;
      return s;
    };
    const head = 'id,clientId,driverName,matricule,status,amount,currency,trafficLevel,createdAt';
    const rows = this.c.rides.listAll().map((r) => {
      const d = r.driverId ? this.c.drivers.get(r.driverId) : undefined;
      return [r.id, r.clientId, d?.name ?? '', d?.matricule ?? '', r.status, r.quote.amount, r.quote.currency, r.quote.trafficLevel, r.createdAt]
        .map(clean).join(',');
    });
    return [head, ...rows].join('\n');
  }

  drivers(opts: { page?: number; limit?: number } = {}) {
    const { items, meta } = paginate(this.c.drivers.list(), opts.page, opts.limit);
    const drivers = items.map((d) => ({
      id: d.id,
      name: d.name,
      matricule: d.matricule,
      category: d.category,
      kycStatus: d.kycStatus,
      availability: d.availability,
      rating: d.ratingAvg,
      trips: d.ratingCount,
      balance: this.c.wallet.balance(d.id),
      vehicleModel: d.vehicleModel ?? null,
      insuranceExpiry: d.insuranceExpiry ?? null,
      trained: d.trained ?? false,
      zoneLockId: d.zoneLockId ?? null,
      vip: d.vip ?? false,
      loyaltyTier: d.loyaltyTier ?? null,
      electricRides: d.electricRides ?? 0,
      suspensionReason: d.suspensionReason ?? null,
      // Numéro : sans lui, la console affiche un chauffeur qu'on ne peut pas joindre.
      phone: d.phone ?? null,
    }));
    return { drivers, ...meta };
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
      greenPoints: c?.greenPoints ?? 0,
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

  /* ==================== SESSION SAMU : réquisitions & télémétrie ==================== */

  /**
   * RAPPORT DE RÉQUISITION PDF : compile l'incident (identités, tracé, chat,
   * note de synthèse) — horodaté, prêt pour le procureur / la police.
   */
  sosReportPdf(alert: EmergencyAlert): Buffer {
    const ride = alert.rideId ? this.c.rides.get(alert.rideId) : undefined;
    const driver = ride?.driverId ? this.c.drivers.get(ride.driverId) : undefined;
    const client = ride ? this.c.clients.get(ride.clientId) : this.c.clients.get(alert.userId);
    const lines = [
      'ORION - RAPPORT DE REQUISITION (SUPERVISION SAMU)',
      `Dossier ${alert.id} · genere le ${new Date().toLocaleString('fr-FR')}`,
      '',
      `Niveau : ${alert.level.toUpperCase()} · Type : ${alert.kind} · Statut : ${alert.status}`,
      `Declenchee le ${new Date(alert.createdAt).toLocaleString('fr-FR')} (${alert.source ?? 'inconnu'})`,
      `Position : ${alert.location.lat.toFixed(5)}, ${alert.location.lng.toFixed(5)} ${alert.zoneName ? `(${alert.zoneName})` : ''}`,
      `Agent gestionnaire : ${alert.agent ?? 'non pris en charge'}`,
      '',
      '--- VEHICULE / CHAUFFEUR ---',
      driver
        ? `${driver.name} · matricule ${driver.matricule} · tel ${driver.phone ?? 'n/c'} · permis ${driver.licenseNo ?? 'n/c'} · ne(e) le ${driver.birthDate ?? 'n/c'}`
        : 'Aucun chauffeur associe',
      driver ? `Vehicule : ${driver.vehicleModel ?? 'n/c'} · plaque ${driver.vehiclePlate ?? 'n/c'} · couleur ${driver.vehicleColor ?? 'n/c'} · motorisation ${driver.engine ?? 'electrique'}` : '',
      '',
      '--- PASSAGER ---',
      client ? `${client.name ?? client.id} · tel ${client.phone ?? 'n/c'} · ${client.rides} course(s) au compteur` : `Identifiant : ${alert.userId}`,
      '',
      '--- COURSE ---',
      ride ? `Course ${ride.id} · statut ${ride.status} · ${((ride.quote.distanceMeters ?? 0) / 1000).toFixed(1)} km · ${ride.trace?.length ?? 0} points GPS` : 'Hors course',
      '',
      '--- ECHANGES (CHAT SECURISE) ---',
      ...(alert.chat ?? []).slice(0, 8).map((m) => `[${new Date(m.at).toLocaleTimeString('fr-FR')}] ${m.from === 'agent' ? m.author ?? 'Agent' : 'Usager'} : ${m.text.slice(0, 70)}`),
      (alert.chat?.length ?? 0) === 0 ? '(aucun message)' : '',
      '',
      '--- NOTE DE SYNTHESE ---',
      alert.closingNote ?? '(dossier non cloture)',
      '',
      alert.sealed ? `Dossier SCELLE numeriquement le ${new Date(alert.sealedAt!).toLocaleString('fr-FR')}.` : 'Dossier en cours.',
      'Document certifie ORION - transmission autorites competentes uniquement.',
    ];
    return simplePdf(lines);
  }

  /** Export EXCEL/CSV des logs bruts de télémétrie (analyse des enquêteurs). */
  sosTelemetryCsv(alert: EmergencyAlert): string {
    const ride = alert.rideId ? this.c.rides.get(alert.rideId) : undefined;
    const trace = ride?.trace ?? [];
    const head = 'point,lat,lng,segment_m,vitesse_estimee_kmh';
    const rows: string[] = [];
    for (let i = 0; i < trace.length; i++) {
      const seg = i === 0 ? 0 : Math.round(haversineMeters(trace[i - 1]!, trace[i]!));
      rows.push([i + 1, trace[i]!.lat.toFixed(6), trace[i]!.lng.toFixed(6), seg, Math.round(seg * 3.6)].join(','));
    }
    return [`"Telemetrie ORION - dossier ${alert.id} - course ${alert.rideId ?? 'n/a'}"`, head, ...rows].join('\n');
  }

  /* ==================== SESSION DISPATCH : simulateur & exports ==================== */

  /**
   * SHADOW MODE : rejoue les origines des dernières courses contre la flotte
   * actuelle avec une configuration hypothétique — AUCUN impact sur le réseau réel.
   */
  async simulateDispatch(patch: { maxEtaMinutes?: number; radiusMaxKm?: number }) {
    const APPROACH_KMH = 28;
    const ops = this.c.settings.getOps();
    const run = async (maxEta: number, radiusKm: number) => {
      const sample = this.c.rides.listAll().slice(0, 60);
      let matched = 0, etaSum = 0;
      for (const r of sample) {
        const nearby = await this.c.geo.nearby(r.origin, radiusKm * 1000, 20);
        const etas = nearby
          .filter((n) => this.c.drivers.get(n.id)?.availability !== 'offline')
          .map((n) => (n.distanceMeters / 1000 / APPROACH_KMH) * 60)
          .filter((eta) => eta <= maxEta);
        if (etas.length) { matched += 1; etaSum += Math.min(...etas); }
      }
      return {
        sampled: sample.length,
        matched,
        matchRate: sample.length ? Math.round((matched / sample.length) * 100) : 0,
        avgEtaMin: matched ? Math.round((etaSum / matched) * 10) / 10 : null,
      };
    };
    return {
      current: await run(ops.maxEtaMinutes, ops.radiusMaxKm),
      proposed: await run(patch.maxEtaMinutes ?? ops.maxEtaMinutes, patch.radiusMaxKm ?? ops.radiusMaxKm),
    };
  }

  /** Documentation technique PDF : tous les paramètres algorithmiques actifs. */
  dispatchConfigPdf(): Buffer {
    const o = this.c.settings.getOps();
    const zones = this.c.settings.getZones();
    return simplePdf([
      'ORION - CONFIGURATION DU MOTEUR DE DISPATCH',
      `Genere le ${new Date().toLocaleString('fr-FR')} - document d'audit technique`,
      '',
      `Strategie d'attribution : ${o.strategy}`,
      `Rayon de recherche : ${o.radiusKm} km, elargi jusqu'a ${o.radiusMaxKm} km`,
      `Filtre ETA : ${o.maxEtaMinutes} min · Cascade : ${o.offerTimeoutSec} s (${o.offerMode})`,
      `Ponderation scoring : note x${o.weightRating} · inactivite x${o.weightIdle}`,
      `Priorisation ecologique absolue : ${o.greenPriority ? 'OUI' : 'non'}`,
      '',
      `Surge : ${o.surgeEnabled ? 'actif' : 'coupe'} · seuil demande/offre ${o.surgeThreshold} · plafond vert x${o.surgeCapGreen} · lissage ${o.surgeSmoothingMin} min`,
      `Attente facturee : ${o.waitFeePerMin} F/min · Plafond remboursement support : ${o.refundCap} F`,
      `Qualite : seuil ${o.minRating}/5 · avertissement auto ${o.autoWarn ? 'ON' : 'OFF'}`,
      `Heures creuses recharge : ${o.offPeakStart}h-${o.offPeakEnd}h · bonus ${o.offPeakBonus} F`,
      '',
      `--- ZONES (${zones.length}) ---`,
      ...zones.slice(0, 20).map((z) => `${z.name} : x${z.factor}${z.surgeManual ? ` · surge manuel x${z.surgeManual}` : ''}${z.minStandard ? ` · standard ${z.minStandard}+` : ''}${z.dedicated ? ' · cantonnement' : ''}${z.waitMaxMin ? ` · attente garantie ${z.waitMaxMin} min` : ''}`),
    ]);
  }

  /** Matrice tarifaire (Excel/CSV) : grille complète pour le business plan. */
  pricingMatrixCsv(): string {
    const p = this.c.settings.getPricing();
    const zones = this.c.settings.getZones();
    const cats = Object.keys(p.multipliers ?? { bronze: 1 });
    const head = 'zone,facteur_zone,frais_prise_en_charge,categorie,multiplicateur,base_fcfa,par_km,par_min,exemple_5km_15min';
    const rows: string[] = [];
    for (const z of zones) {
      for (const cat of cats) {
        const mult = (p.multipliers as Record<string, number>)[cat] ?? 1;
        const example = Math.round((p.baseFare + 5 * p.perKm + 15 * p.perMinute) * mult * z.factor + (z.pickupFee ?? 0));
        rows.push([z.name.replace(/,/g, ' '), z.factor, z.pickupFee ?? 0, cat, mult, p.baseFare, p.perKm, p.perMinute, example].join(','));
      }
    }
    return [head, ...rows].join('\n');
  }

  /* ==================== SESSION QUALITÉ : CSAT, matrices, fiches ==================== */

  /** CSAT 7 jours (courbe) + taux d'acceptation / d'annulation du réseau. */
  qualityCsat() {
    const days = new Map<string, { sum: number; count: number }>();
    const today = new Date();
    for (let i = 6; i >= 0; i--) {
      const d = new Date(today);
      d.setUTCDate(today.getUTCDate() - i);
      days.set(d.toISOString().slice(0, 10), { sum: 0, count: 0 });
    }
    let total = 0, accepted = 0, cancelled = 0;
    for (const r of this.c.rides.listAll()) {
      total += 1;
      if (r.status !== 'no_driver' && r.status !== 'searching') accepted += 1;
      if (r.status === 'cancelled') cancelled += 1;
      const rated = r.events.find((e) => e.type === 'rated');
      if (rated && typeof rated.payload?.['stars'] === 'number') {
        const b = days.get(rated.at.slice(0, 10));
        if (b) { b.sum += rated.payload['stars'] as number; b.count += 1; }
      }
    }
    const series = [...days.entries()].map(([date, b]) => ({
      date, avg: b.count ? Math.round((b.sum / b.count) * 100) / 100 : null, count: b.count,
    }));
    const all = series.reduce((s, d) => ({ sum: s.sum + (d.avg ?? 0) * d.count, count: s.count + d.count }), { sum: 0, count: 0 });
    return {
      series,
      csat7d: all.count ? Math.round((all.sum / all.count) * 100) / 100 : null,
      acceptRate: total ? Math.round((accepted / total) * 100) : 100,
      cancelRate: total ? Math.round((cancelled / total) * 100) : 0,
    };
  }

  /** Matrice de performance (Excel) : corrélation note ↔ chiffre d'affaires. */
  qualityCsv(): string {
    const clean = (v: unknown) => {
      let s = String(v ?? '').replace(/[",\n]/g, ' ');
      if (/^[=+\-@]/.test(s)) s = `'${s}`;
      return s;
    };
    const revenueBy = new Map<string, number>();
    for (const r of this.c.rides.listAll()) {
      if (r.driverId && REVENUE.has(r.status)) revenueBy.set(r.driverId, (revenueBy.get(r.driverId) ?? 0) + r.quote.amount);
    }
    const head = 'matricule,nom,categorie,note,courses,avertissements,vip,forme_eco,ca_fcfa';
    const rows = this.c.drivers.list()
      .sort((a, b) => b.ratingAvg - a.ratingAvg)
      .map((d) => [d.matricule, d.name, d.category, d.ratingAvg, d.ratingCount, d.warnings ?? 0, d.vip ? 'oui' : 'non', d.trained ? 'oui' : 'non', Math.round(revenueBy.get(d.id) ?? 0)].map(clean).join(','));
    return [head, ...rows].join('\n');
  }

  /** Bilan qualité individuel (PDF) : synthèse mensuelle d'un chauffeur. */
  driverQualityPdf(id: string): Buffer | null {
    const d = this.c.drivers.get(id);
    if (!d) return null;
    const rides = this.c.rides.listAll().filter((r) => r.driverId === id);
    const revenue = rides.filter((r) => REVENUE.has(r.status)).reduce((s, r) => s + r.quote.amount, 0);
    const stars = rides.map((r) => r.events.find((e) => e.type === 'rated')?.payload?.['stars']).filter((s): s is number => typeof s === 'number');
    const fiveStars = stars.filter((s) => s === 5).length;
    const oneStars = stars.filter((s) => s === 1).length;
    return simplePdf([
      'ORION - BILAN QUALITE CHAUFFEUR',
      `Genere le ${new Date().toLocaleDateString('fr-FR')}`,
      '',
      `${d.name} · matricule ${d.matricule} · gamme ${d.category}${d.vip ? ' · TOP DRIVER (VIP)' : ''}`,
      `Vehicule : ${d.vehicleModel ?? 'n/c'} · ${d.engine ?? 'electrique'}`,
      '',
      `Note moyenne : ${d.ratingAvg}/5 sur ${d.ratingCount} courses notees`,
      `Notes 5 etoiles : ${fiveStars} · notes 1 etoile : ${oneStars}`,
      `Avertissements qualite : ${d.warnings ?? 0}`,
      `Eco-conduite certifiee : ${d.trained ? 'OUI' : 'non'}`,
      `Chiffre d'affaires genere : ${Math.round(revenue).toLocaleString('fr-FR')} F CFA (${rides.length} courses)`,
      '',
      'Points forts : ponctualite, proprete du vehicule.',
      'Axes d\'amelioration : voir les tags des commentaires clients.',
      '',
      'Document interne ORION - entretien qualite / ressources humaines.',
    ]);
  }

  /* ==================== SESSION MOBILITÉ VERTE : exports énergie & ESG ==================== */

  /** Export DATA ÉNERGIE (Excel) : km électriques, kWh, coûts de recharge estimés. */
  energyCsv(): string {
    const kmBy = new Map<string, number>();
    for (const r of this.c.rides.listAll()) {
      if (r.driverId && REVENUE.has(r.status)) {
        kmBy.set(r.driverId, (kmBy.get(r.driverId) ?? 0) + (r.quote.distanceMeters ?? 0) / 1000);
      }
    }
    const head = 'matricule,nom,motorisation,soc_pct,soh_pct,km_factures,kwh_estimes,cout_recharge_fcfa,co2_economise_kg';
    const rows = this.c.drivers.list()
      .filter((d) => (d.engine ?? 'electric') === 'electric')
      .map((d) => {
        const km = Math.round((kmBy.get(d.id) ?? 0) * 10) / 10;
        const kwh = Math.round(km * 0.15 * 10) / 10;   // ~15 kWh / 100 km
        return [d.matricule, d.name.replace(/,/g, ' '), 'electrique', d.batteryPct ?? '', d.batteryHealthPct ?? '', km, kwh, Math.round(kwh * 125), Math.round(km * 0.13 * 10) / 10].join(',');
      });
    return [head, ...rows].join('\n');
  }

  /** Rapport ESG/RSE PDF pour un compte entreprise (bilan carbone client B2B). */
  esgPdf(corporateId: string): Buffer | null {
    const acc = this.c.corporate.get(corporateId);
    if (!acc) return null;
    const rides = this.c.rides.listAll().filter((r) => r.corporateId === corporateId);
    const km = rides.reduce((s, r) => s + (r.quote.distanceMeters ?? 0) / 1000, 0);
    const savedKg = Math.round(km * 0.13 * 10) / 10; // 150 g/km thermique − 20 g/km électrique
    return simplePdf([
      'ORION - RAPPORT ESG / RSE (MOBILITE VERTE)',
      `Client : ${acc.name} · genere le ${new Date().toLocaleDateString('fr-FR')}`,
      '',
      `Deplacements ORION sur la periode : ${rides.length} courses · ${Math.round(km)} km`,
      `Flotte utilisee : 100 % electrique (mobilite verte ORION)`,
      `CO2 evite vs flotte thermique : ${savedKg} kg`,
      `Equivalent carburant economise : ${Math.round(km * 0.07)} litres`,
      '',
      'Methodologie : thermique ~150 g CO2/km, electrique ~20 g/km (mix + fabrication).',
      'Base auditables : devis verrouilles et courses terminees de la periode.',
      '',
      'Certificat destine au bilan RSE annuel du client.',
      'ORION - Green Mobility · Abidjan, Cote d\'Ivoire.',
    ]);
  }

  /* ==================== SESSION ÉQUIPES : productivité & anomalies internes ==================== */

  /**
   * PRODUCTIVITÉ INTERNE (KPIs employés) dérivée du journal d'audit : nombre
   * d'actions par employé sur les dernières 24 h, réparties par nature.
   */
  staffProductivity() {
    const since = Date.now() - 86_400_000;
    const byActor = new Map<string, { actor: string; role: string; total: number; support: number; moderation: number; finance: number; promos: number; lastAt: string }>();
    for (const e of this.c.audit.list(1000)) {
      if (Date.parse(e.at) < since) continue;
      const k = e.actor;
      const row = byActor.get(k) ?? { actor: e.actor, role: e.role, total: 0, support: 0, moderation: 0, finance: 0, promos: 0, lastAt: e.at };
      row.total += 1;
      if (e.action.startsWith('support.') || e.action.startsWith('dispute.')) row.support += 1;
      if (e.action.startsWith('driver.') || e.action.startsWith('client.')) row.moderation += 1;
      if (e.action.startsWith('treasury.') || e.action.startsWith('corporate.') || e.action.startsWith('pricing.')) row.finance += 1;
      if (e.action.startsWith('promo.')) row.promos += 1;
      if (e.at > row.lastAt) row.lastAt = e.at;
      byActor.set(k, row);
    }
    return [...byActor.values()].sort((a, b) => b.total - a.total);
  }

  /**
   * ANOMALIES DE COMPORTEMENT DU PERSONNEL (fraude interne) : un employé qui émet
   * un volume inhabituel de codes promo, ou modère/consulte un volume anormal de
   * dossiers dans la même heure → à signaler à la direction.
   */
  staffAnomalies() {
    const hourAgo = Date.now() - 3_600_000;
    const promoBy = new Map<string, number>();
    const modBy = new Map<string, number>();
    for (const e of this.c.audit.list(1000)) {
      if (Date.parse(e.at) < hourAgo) continue;
      if (e.action.startsWith('promo.')) promoBy.set(e.actor, (promoBy.get(e.actor) ?? 0) + 1);
      if (e.action === 'client.status' || e.action.startsWith('driver.')) modBy.set(e.actor, (modBy.get(e.actor) ?? 0) + 1);
    }
    const out: { actor: string; reason: string; count: number }[] = [];
    for (const [actor, n] of promoBy) if (n >= 5) out.push({ actor, reason: 'Volume inhabituel de codes promo (1 h)', count: n });
    for (const [actor, n] of modBy) if (n >= 20) out.push({ actor, reason: 'Volume inhabituel de dossiers modérés (1 h)', count: n });
    return out;
  }

  /** Matrice des heures (Excel/CSV) : planning + pointage, alimente l'OPEX salarial. */
  staffHoursCsv(shifts: { username: string; name: string; date: string; slot: string; zoneId?: string }[]): string {
    const clean = (v: unknown) => { let s = String(v ?? '').replace(/[",\n]/g, ' '); if (/^[=+\-@]/.test(s)) s = `'${s}`; return s; };
    const head = 'employe,identifiant,date,tranche,zone';
    const rows = shifts.map((s) => [s.name, s.username, s.date, s.slot, s.zoneId ?? ''].map(clean).join(','));
    return [head, ...rows].join('\n');
  }

  /** Micro P&L d'une sous-flotte (squad manager) : CA, immobilisation, ROI. */
  squadPnl(driverIds: string[]) {
    const drivers = driverIds.map((id) => this.c.drivers.get(id)).filter((d): d is NonNullable<typeof d> => Boolean(d));
    let revenue = 0, rides = 0;
    for (const r of this.c.rides.listAll()) {
      if (r.driverId && driverIds.includes(r.driverId) && REVENUE.has(r.status)) { revenue += r.quote.amount; rides += 1; }
    }
    const active = drivers.filter((d) => d.availability !== 'offline').length;
    const grounded = drivers.filter((d) => d.kycStatus === 'suspended').length; // immobilisés
    const activityRate = drivers.length ? Math.round((active / drivers.length) * 100) : 0;
    // ROI simplifié : revenu net estimé rapporté à un coût d'immobilisation fictif.
    const estCost = drivers.length * 5000 + grounded * 3000;
    return {
      vehicles: drivers.length, active, grounded, activityRate,
      revenue: Math.round(revenue), rides,
      roi: estCost ? Math.round(((revenue - estCost) / estCost) * 100) : 0,
    };
  }

  /** Fiche d'évaluation mensuelle d'un employé (PDF). */
  staffEvalPdf(username: string) {
    const prod = this.staffProductivity().find((p) => p.actor.toLowerCase().includes(username.toLowerCase()) || p.actor === username);
    return simplePdf([
      'ORION - FICHE D EVALUATION EMPLOYE',
      `Employe : ${username} · genere le ${new Date().toLocaleDateString('fr-FR')}`,
      '',
      `Actions enregistrees (24 h) : ${prod?.total ?? 0}`,
      `- Support / litiges : ${prod?.support ?? 0}`,
      `- Moderation (chauffeurs/clients) : ${prod?.moderation ?? 0}`,
      `- Operations financieres : ${prod?.finance ?? 0}`,
      `- Codes promo emis : ${prod?.promos ?? 0}`,
      `Derniere activite : ${prod ? new Date(prod.lastAt).toLocaleString('fr-FR') : 'n/c'}`,
      '',
      'Assiduite et statistiques issues du journal d audit (traçabilite immuable).',
      'Document RH interne ORION.',
    ]);
  }

  /* ==================== SESSION IA : anti-fraude, élasticité, copilote ==================== */

  /**
   * MOTEUR ANTI-FRAUDE : détecte les courses fantômes (collusion chauffeur/passager),
   * le spoofing GPS (téléportation dans le tracé) et un risque transactionnel simple.
   */
  fraudSignals() {
    const rides = this.c.rides.listAll();
    // Collusion / ghost rides : mêmes paires (client, chauffeur) répétées.
    const pairCount = new Map<string, { clientId: string; driverId: string; count: number }>();
    for (const r of rides) {
      if (!r.driverId) continue;
      const k = `${r.clientId}|${r.driverId}`;
      const row = pairCount.get(k) ?? { clientId: r.clientId, driverId: r.driverId, count: 0 };
      row.count += 1;
      pairCount.set(k, row);
    }
    const ghostRides = [...pairCount.values()].filter((p) => p.count >= 3)
      .map((p) => ({ ...p, driverName: this.c.drivers.get(p.driverId)?.name ?? null }))
      .sort((a, b) => b.count - a.count).slice(0, 10);

    // Spoofing GPS : saut de position irréaliste entre deux points (> 2 km d'un coup).
    const gpsSpoof: { rideId: string; driverId: string | null; jumpMeters: number }[] = [];
    for (const r of rides) {
      if (!r.trace || r.trace.length < 2) continue;
      let maxJump = 0;
      for (let i = 1; i < r.trace.length; i++) maxJump = Math.max(maxJump, haversineMeters(r.trace[i - 1]!, r.trace[i]!));
      if (maxJump > 2000) gpsSpoof.push({ rideId: r.id, driverId: r.driverId ?? null, jumpMeters: Math.round(maxJump) });
    }
    gpsSpoof.sort((a, b) => b.jumpMeters - a.jumpMeters);

    // Risque transactionnel : clients avec un fort taux d'annulation (card testing / abus).
    const txRisk = this.c.clients.list()
      .filter((c) => (c.cancellations ?? 0) >= 3)
      .map((c) => ({ id: c.id, name: c.name ?? null, cancellations: c.cancellations ?? 0, warnings: c.warnings ?? 0 }))
      .slice(0, 10);

    return { ghostRides, gpsSpoof: gpsSpoof.slice(0, 10), txRisk };
  }

  /**
   * ÉLASTICITÉ-PRIX (surge neural simplifié) : à partir de la conversion par
   * cellule, recommande un multiplicateur qui maximise le revenu sans casser le
   * taux de conversion. Zone à forte conversion + forte demande → léger surge.
   */
  elasticity() {
    return this.c.demand.conversion(12).map((cell) => {
      let recommended = 1;
      if (cell.sessions >= 5) {
        if (cell.rate >= 60) recommended = 1.5;
        else if (cell.rate >= 40) recommended = 1.25;
        else recommended = 1; // conversion faible : ne pas majorer (ferait fuir)
      }
      return { cell: cell.cell, lat: cell.lat, lng: cell.lng, sessions: cell.sessions, rate: cell.rate, recommended };
    });
  }

  /**
   * COPILOTE (génératif, heuristique) : synthèse courte d'un litige, ou réponse à
   * une requête en langage naturel simple (« CA électrique vs thermique »).
   */
  copilotSummary(disputeId: string): string | null {
    const d = this.c.disputes.get(disputeId);
    if (!d) return null;
    const ride = this.c.rides.get(d.rideId);
    const km = ride ? Math.round((ride.quote.distanceMeters ?? 0) / 1000) : 0;
    const kindLabel: Record<string, string> = { objet_perdu: 'objet oublié', trajet: 'contestation de trajet', facturation: 'erreur de facturation', comportement: 'comportement' };
    return `Litige ${kindLabel[d.kind] ?? d.kind} sur la course ${d.rideId.slice(0, 8)} (${km} km, ${ride ? fcfaLite(ride.quote.amount) : 'n/c'}). `
      + `Statut : ${d.status}${d.escalation ? ` · escaladé (${d.escalation})` : ''}${d.refund ? ` · remboursement ${fcfaLite(d.refund)}` : ''}. `
      + `${d.description.slice(0, 120)}`;
  }

  copilotQuery(q: string) {
    const s = q.toLowerCase();
    if (/électr|electr|thermi|hybrid/.test(s)) {
      const g = this.green();
      const fin = this.finance();
      return {
        query: q,
        answer: `Sur la période : ${g.electricShare} % des trajets sont 100 % électriques (${g.kmElectric.toLocaleString('fr-FR')} km), ${g.hybridShare} % hybrides. `
          + `CO2 évité : ${g.co2SavedKg} kg. Revenu total encaissé : ${fcfaLite(fin.revenue)}.`,
        data: { electricShare: g.electricShare, hybridShare: g.hybridShare, co2SavedKg: g.co2SavedKg, revenue: fin.revenue },
      };
    }
    if (/chiffre|revenu|ca\b|commission|gmv/.test(s)) {
      const fin = this.finance();
      return { query: q, answer: `GMV ${fcfaLite(fin.gmv)} · revenu encaissé ${fcfaLite(fin.revenue)} · commission ORION ${fcfaLite(fin.commission)} · TVA collectée ${fcfaLite(fin.taxes)}.`, data: fin };
    }
    if (/chauffeur|driver|flotte/.test(s)) {
      const ov = this.overview();
      return { query: q, answer: `${ov.drivers.total} chauffeurs (${ov.drivers.online} en ligne, ${ov.drivers.onTrip} en course). ${ov.rides.active} courses actives.`, data: ov.drivers };
    }
    return { query: q, answer: 'Reformulez : essayez « CA électrique vs thermique », « chiffre d’affaires du mois », « état de la flotte ».', data: null };
  }

  /* ==================== SESSION LITIGES : chargeback, sinistres, pertes ==================== */

  /** Perte d'exploitation journalière moyenne d'un véhicule (indemnisation sinistre). */
  lossOfUse(driverId: string): { dailyAvg: number; days: number } {
    const rides = this.c.rides.listAll().filter((r) => r.driverId === driverId && REVENUE.has(r.status));
    if (rides.length === 0) return { dailyAvg: 0, days: 0 };
    const days = new Set(rides.map((r) => r.createdAt.slice(0, 10)));
    const total = rides.reduce((s, r) => s + r.quote.amount, 0);
    return { dailyAvg: Math.round(total / Math.max(1, days.size)), days: days.size };
  }

  /** Dossier de contestation bancaire (chargeback) — Evidence Package PDF (normes Visa/MC). */
  chargebackPackPdf(disputeId: string): Buffer | null {
    const d = this.c.disputes.get(disputeId);
    if (!d) return null;
    const ride = this.c.rides.get(d.rideId);
    const client = this.c.clients.get(d.clientId);
    const trips = this.c.rides.listByClient(d.clientId);
    return simplePdf([
      'ORION - DOSSIER DE CONTESTATION (CHARGEBACK / EVIDENCE PACKAGE)',
      `Dossier ${d.id} · genere le ${new Date().toLocaleString('fr-FR')}`,
      'Format destine a la banque acquereuse (normes Visa / Mastercard).',
      '',
      `Course contestee : ${d.rideId} · ${ride ? new Date(ride.createdAt).toLocaleString('fr-FR') : 'n/c'}`,
      `Montant : ${ride ? fcfaLite(ride.quote.amount) : 'n/c'}`,
      `Depart : ${ride ? `${ride.origin.lat.toFixed(4)}, ${ride.origin.lng.toFixed(4)}` : 'n/c'}`,
      `Arrivee : ${ride ? `${ride.destination.lat.toFixed(4)}, ${ride.destination.lng.toFixed(4)}` : 'n/c'}`,
      '',
      '--- PREUVES DE CONCORDANCE ---',
      `Client : ${client?.name ?? d.clientId} · ${client?.phone ?? 'tel n/c'}`,
      `Historique : ${trips.length} course(s) sur le compte (comportement habituel).`,
      `Courses terminees dans la meme zone : ${trips.filter((t) => ride && haversineMeters(t.destination, ride.destination) < 1500).length} (habitude de deplacement).`,
      `Points GPS enregistres pour la course : ${ride?.trace?.length ?? 0} (tracee reelle).`,
      '',
      'Conclusion : les elements ci-dessus etablissent la realite de la course et',
      'la concordance avec les habitudes du titulaire du compte. ORION demande le',
      'rejet de la contestation et la restitution des fonds.',
    ]);
  }

  /** Dossier d'instruction légal complet (PDF) — bout en bout, format juridique. */
  legalDossierPdf(disputeId: string): Buffer | null {
    const d = this.c.disputes.get(disputeId);
    if (!d) return null;
    const ride = this.c.rides.get(d.rideId);
    const driver = ride?.driverId ? this.c.drivers.get(ride.driverId) : undefined;
    return simplePdf([
      'ORION - DOSSIER D INSTRUCTION (LITIGE)',
      `Dossier ${d.id} · genere le ${new Date().toLocaleString('fr-FR')} · horodate`,
      '',
      `Categorie : ${d.escalation ?? d.kind} · statut ${d.status}`,
      `Expert gestionnaire : ${d.lockedBy ?? 'non verrouille'}`,
      `Quarantaine : ${d.quarantined ? 'ACTIVE (comptes suspendus, fonds geles)' : 'non'}`,
      '',
      '--- COURSE ---',
      `Reference : ${d.rideId} · ${ride ? new Date(ride.createdAt).toLocaleString('fr-FR') : 'n/c'}`,
      `Chauffeur : ${driver ? `${driver.name} (${driver.matricule})` : 'n/c'}`,
      `Client : ${d.clientId}`,
      `Distance : ${ride ? Math.round((ride.quote.distanceMeters ?? 0) / 1000) : 0} km · ${ride?.trace?.length ?? 0} points GPS`,
      '',
      '--- FAITS ---',
      d.description,
      '',
      '--- NOTES D INVESTIGATION ---',
      ...((d.notes ?? []).slice(0, 10).map((n) => `[${new Date(n.at).toLocaleString('fr-FR')}] ${n.author} : ${n.text.slice(0, 90)}`)),
      (d.notes?.length ?? 0) === 0 ? '(aucune note)' : '',
      '',
      `Resolution : ${d.resolution ?? 'en cours'}${d.refund ? ` · remboursement ${fcfaLite(d.refund)}` : ''}`,
      'Document a valeur probante - production devant juridiction competente.',
    ]);
  }

  /** Matrice financière des pertes (Excel/CSV) : remboursements, fraudes, indemnisations. */
  lossMatrixCsv(): string {
    const clean = (v: unknown) => { let s = String(v ?? '').replace(/[",\n]/g, ' '); if (/^[=+\-@]/.test(s)) s = `'${s}`; return s; };
    const head = 'dossier,categorie,statut,client,course,remboursement_fcfa,quarantaine';
    const rows = this.c.disputes.list().map((d) => [d.id, d.escalation ?? d.kind, d.status, d.clientId, d.rideId, d.refund ?? 0, d.quarantined ? 'oui' : 'non'].map(clean).join(','));
    const totalRefund = this.c.disputes.list().reduce((s, d) => s + (d.refund ?? 0), 0);
    return [head, ...rows, `"TOTAL",,,,,"${totalRefund}",`].join('\n');
  }

  /* ==================== SESSION B2B : facture consolidée & kickbacks ==================== */

  /** Facture consolidée mensuelle (PDF) : toutes les courses d'un compte + TVA. */
  consolidatedInvoicePdf(corporateId: string, month: string): Buffer | null {
    const acc = this.c.corporate.get(corporateId);
    if (!acc) return null;
    const rides = this.c.rides.listAll().filter((r) => r.corporateId === corporateId && r.createdAt.startsWith(month));
    const total = rides.reduce((s, r) => s + r.quote.amount, 0);
    const tva = rides.reduce((s, r) => s + (r.quote.breakdown?.tva ?? 0), 0);
    const kickback = this.c.corporate.kickback(corporateId, total);
    return simplePdf([
      'ORION - FACTURE CONSOLIDEE B2B',
      `${acc.name} · ${acc.nif ? `NIF ${acc.nif} · ` : ''}${month}`,
      acc.billingAddress ? `Adresse : ${acc.billingAddress}` : '',
      `Genere le ${new Date().toLocaleDateString('fr-FR')}`,
      '',
      `Nombre de courses : ${rides.length}`,
      `Montant total TTC : ${fcfaLite(total)}`,
      `dont TVA : ${fcfaLite(Math.round(tva))}`,
      kickback ? `Retrocommission d apport d affaires (${Math.round((acc.kickbackRate ?? 0) * 100)} %) : ${fcfaLite(kickback)}` : '',
      '',
      'Detail ligne par ligne fourni en annexe Excel (export CSV).',
      'Document comptable ORION - pret pour integration ERP.',
    ]);
  }

  /* ==================== SESSION CHAUFFEUR (S12) ==================== */

  /** Documents expirant sous 30 jours (assurance / contrôle technique). */
  driverExpiring(days = 30) {
    const soon = Date.now() + days * 86_400_000;
    return this.c.drivers.list()
      .filter((d) => d.insuranceExpiry && Date.parse(d.insuranceExpiry) <= soon)
      .map((d) => ({
        id: d.id, name: d.name, matricule: d.matricule, insuranceExpiry: d.insuranceExpiry!,
        daysLeft: Math.round((Date.parse(d.insuranceExpiry!) - Date.now()) / 86_400_000),
      }))
      .sort((a, b) => a.daysLeft - b.daysLeft);
  }

  /** Contrat de partenariat PDF (données du profil + commission + espace signature). */
  driverContractPdf(id: string): Buffer | null {
    const d = this.c.drivers.get(id);
    if (!d) return null;
    const ops = this.c.settings.getOps();
    const rate = d.commissionOverride ?? ((d.engine ?? 'electric') === 'electric' ? ops.commissionGreen : ops.commissionStandard);
    return simplePdf([
      'ORION - CONTRAT DE PARTENARIAT CHAUFFEUR',
      `Genere le ${new Date().toLocaleDateString('fr-FR')}`,
      '',
      `Entre ORION Green Mobility (la Plateforme) et :`,
      `${d.name} · matricule ${d.matricule}${d.nif ? ` · NIF ${d.nif}` : ''}`,
      `Vehicule : ${d.vehicleModel ?? 'n/c'} · plaque ${d.vehiclePlate ?? 'n/c'} · ${d.engine ?? 'electrique'}`,
      d.batteryKwh ? `Batterie : ${d.batteryKwh} kWh · prise ${d.plugType ?? 'n/c'}` : '',
      '',
      'ARTICLE 1 - OBJET : mise en relation via la plateforme ORION.',
      `ARTICLE 2 - COMMISSION : la Plateforme preleve ${Math.round(rate * 100)} % sur chaque course.`,
      `ARTICLE 3 - FIDELITE : commission reduite au-dela de ${ops.loyaltyRideThreshold} courses electriques.`,
      'ARTICLE 4 - REVERSEMENT : les gains nets sont credites sur le portefeuille du Chauffeur.',
      'ARTICLE 5 - CONFORMITE : assurance transport de personnes et controle technique a jour.',
      '',
      `Fait a Abidjan, le ${new Date().toLocaleDateString('fr-FR')}.`,
      '',
      'Signature du Chauffeur : _______________________',
      'Signature ORION : _______________________',
    ]);
  }

  /** Matrice de la flotte (Excel/CSV) : amortissement + projections. */
  fleetMatrixCsv(): string {
    const clean = (v: unknown) => { let s = String(v ?? '').replace(/[",\n]/g, ' '); if (/^[=+\-@]/.test(s)) s = `'${s}`; return s; };
    const revenueBy = new Map<string, number>();
    for (const r of this.c.rides.listAll()) {
      if (r.driverId && REVENUE.has(r.status)) revenueBy.set(r.driverId, (revenueBy.get(r.driverId) ?? 0) + r.quote.amount);
    }
    const head = 'matricule,nom,motorisation,modele,plaque,batterie_kwh,assurance_expire,kyc,courses_elec,ca_fcfa';
    const rows = this.c.drivers.list().map((d) => [
      d.matricule, d.name, d.engine ?? 'electrique', d.vehicleModel ?? '', d.vehiclePlate ?? '',
      d.batteryKwh ?? '', d.insuranceExpiry ?? '', d.kycStatus, d.electricRides ?? 0, Math.round(revenueBy.get(d.id) ?? 0),
    ].map(clean).join(','));
    return [head, ...rows].join('\n');
  }

  /* ==================== SESSION CLIENT (S13) ==================== */

  /** Matrice d'acquisition (Excel/CSV) : CAC, LTV, usage promo par client. */
  clientLtvCsv(): string {
    const clean = (v: unknown) => { let s = String(v ?? '').replace(/[",\n]/g, ' '); if (/^[=+\-@]/.test(s)) s = `'${s}`; return s; };
    const spentBy = new Map<string, number>();
    for (const r of this.c.rides.listAll()) {
      if (REVENUE.has(r.status)) spentBy.set(r.clientId, (spentBy.get(r.clientId) ?? 0) + r.quote.amount);
    }
    const head = 'client,nom,statut,vip,courses,depense_ltv_fcfa,points_verts,co2_kg';
    const rows = this.c.clients.list().map((c) => [
      c.id, c.name ?? '', c.status, c.vipTier ?? 'standard', c.rides, Math.round(spentBy.get(c.id) ?? 0),
      c.greenPoints ?? 0, c.co2SavedKg ?? 0,
    ].map(clean).join(','));
    return [head, ...rows].join('\n');
  }

  /** Rapport comportement consommateur (PDF) — annexe business plan. */
  clientBehaviorPdf(): Buffer {
    const clients = this.c.clients.list();
    const rides = this.c.rides.listAll().filter((r) => REVENUE.has(r.status));
    const revenue = rides.reduce((s, r) => s + r.quote.amount, 0);
    const basket = rides.length ? Math.round(revenue / rides.length) : 0;
    const vip = clients.filter((c) => c.vipTier && c.vipTier !== 'standard').length;
    const green = clients.filter((c) => (c.greenPoints ?? 0) > 0).length;
    return simplePdf([
      'ORION - RAPPORT COMPORTEMENT CONSOMMATEUR',
      `Genere le ${new Date().toLocaleDateString('fr-FR')}`,
      '',
      `Base clients : ${clients.length} passagers inscrits`,
      `Clients VIP (Gold/Platinum) : ${vip}`,
      `Clients engages mobilite verte : ${green} (${clients.length ? Math.round((green / clients.length) * 100) : 0} %)`,
      `Panier moyen par course : ${fcfaLite(basket)}`,
      `Volume de courses (payees) : ${rides.length}`,
      `Chiffre d affaires cumule : ${fcfaLite(Math.round(revenue))}`,
      '',
      'Tendance : adoption croissante de la flotte 100 % electrique.',
      'Document destine aux annexes du business plan ORION.',
    ]);
  }

  /* ==================== SESSION FINANCES (S14) ==================== */

  /** Chauffeurs dont la dette espèces dépasse le plafond (recouvrement, courses carte). */
  cashDebt() {
    const limit = this.c.settings.getOps().cashDebtLimit;
    return this.c.wallet.debtorsOver(limit).map((row) => {
      const d = this.c.drivers.get(row.driverId);
      return { id: row.driverId, name: d?.name ?? null, matricule: d?.matricule ?? null, balance: row.balance, limit };
    });
  }

  /** Statut des passerelles de paiement (monitoring). */
  gatewaysStatus() {
    const gw = this.c.settings.getServices().gateways ?? {};
    return Object.entries(gw).map(([method, enabled]) => ({ method, enabled }));
  }

  /** Fichier de virement de masse (payouts chauffeurs) — CSV format bancaire. */
  payoutsCsv(): string {
    const clean = (v: unknown) => { let s = String(v ?? '').replace(/[",\n]/g, ' '); if (/^[=+\-@]/.test(s)) s = `'${s}`; return s; };
    const head = 'matricule,nom,solde_a_verser_fcfa,rib_verifie';
    const rows = this.c.drivers.list()
      .map((d) => ({ d, bal: this.c.wallet.balance(d.id) }))
      .filter((x) => x.bal > 0)
      .map(({ d, bal }) => [d.matricule, d.name, Math.round(bal), d.ribVerified ? 'oui' : 'non'].map(clean).join(','));
    return [head, ...rows].join('\n');
  }

  /* ==================== SESSION TRÉSORERIE (S15) ==================== */

  /**
   * Ratio de couverture des portefeuilles (Wallet Backing) : l'argent virtuel
   * détenu doit être couvert à 100 % par le compte séquestre (anti bank-run).
   * + burn rate / runway + BFR.
   */
  liquidity() {
    const virtualHeld = Math.max(0, this.c.wallet.totalBalance()) + Math.max(0, this.c.clientWallet.totalBalance());
    const escrow = config.TREASURY_ESCROW_XOF;
    const ratio = virtualHeld > 0 ? Math.round((escrow / virtualHeld) * 100) : 100;
    const monthlyOpex = config.TREASURY_MONTHLY_OPEX_XOF;
    const cash = config.TREASURY_CASH_XOF;
    // Burn = OPEX − revenu net mensuel estimé (commission des 30 derniers jours).
    const since = Date.now() - 30 * 86_400_000;
    let revenue30 = 0;
    for (const r of this.c.rides.listAll()) if (REVENUE.has(r.status) && Date.parse(r.createdAt) >= since) revenue30 += r.quote.amount;
    const netMonthly = Math.round(revenue30 * this.c.settings.getOps().commissionStandard);
    const burn = monthlyOpex - netMonthly; // positif = on consomme du capital
    const runway = burn > 0 ? Math.round((cash / burn) * 10) / 10 : Infinity;
    return {
      currency: 'XOF',
      cashOnHand: cash, escrow, virtualHeld,
      backingRatio: ratio, backingOk: escrow >= virtualHeld,
      monthlyOpex, netMonthly, burnRate: burn,
      runwayMonths: runway === Infinity ? null : runway,
    };
  }

  /** Amortissement de la flotte électrique détenue en propre (CAPEX). */
  fleetAmortization() {
    // Hypothèse : véhicules VIP/dédiés = propriété ORION. Amortissement linéaire 5 ans.
    const owned = this.c.drivers.list().filter((d) => d.vip || d.zoneLockId);
    const rows = owned.map((d) => {
      const km = this.c.rides.listAll().filter((r) => r.driverId === d.id && REVENUE.has(r.status))
        .reduce((s, r) => s + (r.quote.distanceMeters ?? 0) / 1000, 0);
      const purchase = 18_000_000; // valeur d'acquisition présumée d'un VE
      const deprec = Math.min(purchase, Math.round(km * 120)); // ~120 F/km de dépréciation
      return { id: d.id, matricule: d.matricule, km: Math.round(km), purchase, depreciation: deprec, bookValue: purchase - deprec };
    });
    return { vehicles: rows.length, totalBookValue: rows.reduce((s, r) => s + r.bookValue, 0), rows };
  }

  /** Reporting exécutif mensuel de trésorerie (PDF) — conseil d'administration. */
  treasuryReportPdf(): Buffer {
    const l = this.liquidity();
    const a = this.fleetAmortization();
    return simplePdf([
      'ORION - REPORTING EXECUTIF DE TRESORERIE',
      `Genere le ${new Date().toLocaleDateString('fr-FR')} · confidentiel conseil d administration`,
      '',
      '--- LIQUIDITE ---',
      `Cash on hand : ${fcfaLite(l.cashOnHand)}`,
      `Argent virtuel detenu (wallets) : ${fcfaLite(l.virtualHeld)}`,
      `Compte sequestre (escrow) : ${fcfaLite(l.escrow)}`,
      `Ratio de couverture : ${l.backingRatio} % (${l.backingOk ? 'CONFORME' : 'SOUS-CAPITALISE - ALERTE'})`,
      '',
      '--- RENTABILITE ---',
      `Revenu net mensuel (commission) : ${fcfaLite(l.netMonthly)}`,
      `OPEX mensuel : ${fcfaLite(l.monthlyOpex)}`,
      `Burn rate : ${fcfaLite(l.burnRate)} / mois`,
      `Runway : ${l.runwayMonths === null ? 'positif (rentable)' : `${l.runwayMonths} mois`}`,
      '',
      '--- FLOTTE (CAPEX) ---',
      `Vehicules en propre : ${a.vehicles} · valeur nette comptable ${fcfaLite(a.totalBookValue)}`,
      '',
      'Document destine aux actionnaires, banquiers et fonds d investissement.',
    ]);
  }

  /* ==================== SESSION TARIFICATION (S16) : shadow pricing ==================== */

  /**
   * SHADOW PRICING : rejoue les courses passées avec une grille tarifaire
   * hypothétique (multiplicateurs) et compare le revenu réel au revenu simulé —
   * sans impacter les utilisateurs.
   */
  shadowPricing(patch: { baseFactor?: number; perKmFactor?: number }) {
    const bf = patch.baseFactor ?? 1;
    const kf = patch.perKmFactor ?? 1;
    const sample = this.c.rides.listAll().filter((r) => REVENUE.has(r.status)).slice(0, 200);
    let real = 0, simulated = 0;
    for (const r of sample) {
      real += r.quote.amount;
      const bd = r.quote.breakdown;
      // Recompose un montant simulé : base ajustée + distance ajustée + reste inchangé.
      const newBase = (bd.base ?? 0) * bf;
      const newDist = (bd.distance ?? 0) * kf;
      const delta = (newBase - (bd.base ?? 0)) + (newDist - (bd.distance ?? 0));
      simulated += r.quote.amount + Math.round(delta * (1 + this.c.settings.getPricing().tvaRate + this.c.settings.getPricing().feeRate));
    }
    const impact = real > 0 ? Math.round(((simulated - real) / real) * 1000) / 10 : 0;
    return { sampled: sample.length, realRevenue: Math.round(real), simulatedRevenue: Math.round(simulated), impactPercent: impact };
  }

  /**
   * MATRICE TARIFAIRE PAR ZONE (Excel/CSV) : forfaits croisés A→B + règles
   * géographiques (retour à vide, plancher premium, surge manuel).
   */
  zoneMatrixCsv(): string {
    const clean = (v: unknown) => { let s = String(v ?? '').replace(/[",\n]/g, ' '); if (/^[=+\-@]/.test(s)) s = `'${s}`; return s; };
    const zones = this.c.settings.getZones();
    const byId = new Map(zones.map((z) => [z.id, z.name]));
    const head = 'zone_depart,zone_arrivee,forfait_fcfa,facteur_zone,plancher_premium,retour_a_vide,surge_manuel,active';
    const rows: string[] = [];
    for (const z of zones) {
      const flats = z.flatRates ?? [];
      if (flats.length === 0) {
        rows.push([z.name, '', '', z.factor, z.premiumFloor ?? '', z.emptyReturnFee ?? '', z.surgeManual ?? '', z.active ? 'oui' : 'non'].map(clean).join(','));
      }
      for (const f of flats) {
        rows.push([z.name, byId.get(f.toZoneId) ?? f.toZoneId, f.price, z.factor, z.premiumFloor ?? '', z.emptyReturnFee ?? '', z.surgeManual ?? '', z.active ? 'oui' : 'non'].map(clean).join(','));
      }
    }
    return [head, ...rows].join('\n');
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
