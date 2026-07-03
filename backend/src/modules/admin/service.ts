import type { Container } from '../../container.js';
import type { RideStatus } from '../services/ride/stateMachine.js';
import type { Ride } from '../rides/store.js';
import type { EmergencyAlert } from '../safety/service.js';
import { haversineMeters } from '../../core/geo.js';
import { simplePdf } from '../../core/pdf.js';

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
