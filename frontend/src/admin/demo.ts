import type { Overview, Alert, FleetUnit, RideRow, DriverRow, Client, DriverDetail, ClientDetail } from './Admin';

/** Jeu de données de démonstration (console autonome, sans backend). */
const iso = (minAgo: number) => new Date(Date.now() - minAgo * 60000).toISOString();

const fleet: FleetUnit[] = [
  { id: 'd1', name: 'Konan Yao', matricule: 'ORION-CI-1042', category: 'bronze', availability: 'online', lat: 5.3258, lng: -4.0205 },
  { id: 'd2', name: 'Awa Diomandé', matricule: 'ORION-CI-2210', category: 'bronze', availability: 'on_trip', lat: 5.331, lng: -4.012 },
  { id: 'd3', name: 'Aïcha Touré', matricule: 'ORION-CI-1207', category: 'argent', availability: 'online', lat: 5.3585, lng: -3.989 },
  { id: 'd4', name: 'Ismaël Cissé', matricule: 'ORION-CI-3391', category: 'argent', availability: 'on_trip', lat: 5.347, lng: -3.999 },
  { id: 'd5', name: 'Mamadou Bamba', matricule: 'ORION-CI-9034', category: 'or', availability: 'online', lat: 5.3402, lng: -4.0095 },
  { id: 'd6', name: 'Grace Kouamé', matricule: 'ORION-CI-5567', category: 'or', availability: 'online', lat: 5.353, lng: -3.995 },
  { id: 'd7', name: 'Fatou Koné', matricule: 'ORION-CI-7788', category: 'diamant', availability: 'on_trip', lat: 5.301, lng: -3.998 },
  { id: 'd8', name: 'Serge Aka', matricule: 'ORION-CI-4820', category: 'diamant', availability: 'online', lat: 5.3265, lng: -4.0185 },
  { id: 'd9', name: 'Yao N’Guessan', matricule: 'ORION-CI-6120', category: 'bronze', availability: 'online', lat: 5.362, lng: -4.02 },
  { id: 'd10', name: 'Adjoua Brou', matricule: 'ORION-CI-3055', category: 'argent', availability: 'online', lat: 5.312, lng: -3.978 },
];

const alerts: Alert[] = [
  { id: 'a1', kind: 'crash', status: 'dispatched', userId: 'client-8842', location: { lat: 5.348, lng: -4.002 }, zoneName: 'Adjamé', impactG: 6.2, dispatchedTo: ['185', '170'], createdAt: iso(2), note: 'Accident détecté automatiquement (capteurs)' },
  { id: 'a2', kind: 'sos', status: 'acknowledged', userId: 'client-1190', location: { lat: 5.335, lng: -3.99 }, zoneName: 'Cocody', dispatchedTo: ['185', '170'], createdAt: iso(9), note: 'SOS déclenché par le client' },
  { id: 'a3', kind: 'sos', status: 'resolved', userId: 'client-4521', location: { lat: 5.31, lng: -4.01 }, zoneName: 'Treichville', dispatchedTo: ['185'], createdAt: iso(41) },
];

const rides: RideRow[] = [
  { id: 'r10a2f9c1', clientId: 'client-8842', driverName: 'Awa Diomandé', matricule: 'ORION-CI-2210', status: 'in_progress', amount: 3150, currency: 'XOF', trafficLevel: 'dense', createdAt: iso(4) },
  { id: 'r22b7e004', clientId: 'client-1190', driverName: 'Ismaël Cissé', matricule: 'ORION-CI-3391', status: 'driver_en_route', amount: 5400, currency: 'XOF', trafficLevel: 'jam', createdAt: iso(6) },
  { id: 'r0091cd7a', clientId: 'client-7781', driverName: 'Fatou Koné', matricule: 'ORION-CI-7788', status: 'in_progress', amount: 12250, currency: 'XOF', trafficLevel: 'fluid', createdAt: iso(11) },
  { id: 'r55aa120e', clientId: 'client-3345', driverName: 'Mamadou Bamba', matricule: 'ORION-CI-9034', status: 'completed', amount: 7150, currency: 'XOF', trafficLevel: 'dense', createdAt: iso(20) },
  { id: 'r7c3390fd', clientId: 'client-9902', driverName: 'Konan Yao', matricule: 'ORION-CI-1042', status: 'paid', amount: 2650, currency: 'XOF', trafficLevel: 'fluid', createdAt: iso(33) },
  { id: 'r3e1180ab', clientId: 'client-2214', driverName: null, matricule: null, status: 'searching', amount: 4100, currency: 'XOF', trafficLevel: 'dense', createdAt: iso(1) },
];
// Volume réaliste pour la pagination (démo) : ~60 courses réparties sur 24 h.
{
  const statuses = ['rated', 'paid', 'completed', 'completed', 'rated', 'cancelled'] as const;
  const traffics = ['fluid', 'dense', 'jam'] as const;
  for (let i = 0; i < 54; i++) {
    const f = fleet[i % fleet.length]!;
    rides.push({
      id: 'r' + (1000 + i * 7).toString(16).padStart(8, '0'),
      clientId: 'client-' + (1000 + ((i * 137) % 9000)),
      driverName: f.name, matricule: f.matricule,
      status: statuses[i % statuses.length]!,
      amount: 1200 + ((i * 613) % 9800),
      currency: 'XOF',
      trafficLevel: traffics[i % traffics.length]!,
      createdAt: iso(40 + i * 25),
    });
  }
}

const drivers: DriverRow[] = fleet.map((f, i) => ({
  id: f.id, name: f.name, matricule: f.matricule!, category: f.category,
  kycStatus: i === 8 ? 'manual_review' : 'active',
  availability: f.availability, rating: 4.7 + (i % 3) * 0.1, trips: 800 + i * 137, balance: 15000 + i * 4200,
}));

const overview: Overview = {
  currency: 'XOF',
  rides: { total: 148, active: 12, completed: 129, cancelled: 7, byStatus: { in_progress: 8, driver_en_route: 3, searching: 1, completed: 129 } },
  drivers: { total: fleet.length, online: fleet.filter((f) => f.availability !== 'offline').length, onTrip: fleet.filter((f) => f.availability === 'on_trip').length },
  finance: { gmv: 1263500, revenue: 1263500, commission: 227430, payouts: 640000 },
  safety: { total: alerts.length, open: alerts.filter((a) => a.status !== 'resolved' && a.status !== 'cancelled').length },
  generatedAt: new Date().toISOString(),
};

const pricing = {
  baseFare: 300, perKm: 130, perMinute: 18, minFare: 600, avgSpeedKmh: 24,
  tvaRate: 0.05, feeRate: 0.1, insuranceRate: 0.02, trafficWeight: 0.6, stopFee: 250,
  multipliers: { bronze: 0.9, argent: 1.25, or: 1.7, diamant: 2.3 },
  bodySurcharge: { berline: 1, suv: 1.08 },
};

const zones = [
  { id: 'plateau', name: 'Plateau', factor: 1.05, lat: 5.3236, lng: -4.0217, radiusKm: 2.5, active: true },
  { id: 'cocody', name: 'Cocody', factor: 1.0, lat: 5.3596, lng: -3.9903, radiusKm: 5, active: true },
  { id: 'marcory', name: 'Marcory', factor: 1.0, lat: 5.3007, lng: -3.9877, radiusKm: 3.5, active: true },
  { id: 'treichville', name: 'Treichville', factor: 0.95, lat: 5.2925, lng: -4.0027, radiusKm: 2.5, active: true },
  { id: 'adjame', name: 'Adjamé', factor: 0.95, lat: 5.3644, lng: -4.0225, radiusKm: 2.5, active: true },
  { id: 'yopougon', name: 'Yopougon', factor: 0.92, lat: 5.3456, lng: -4.0864, radiusKm: 6, active: true },
  { id: 'abobo', name: 'Abobo', factor: 0.92, lat: 5.4204, lng: -4.0159, radiusKm: 6, active: true },
  { id: 'aeroport', name: 'Aéroport (Port-Bouët)', factor: 1.1, lat: 5.2614, lng: -3.9268, radiusKm: 4, active: true },
];

const me = {
  name: 'PDG ORION',
  role: 'ceo',
  roleLabel: 'CEO — Président Directeur Général',
  permissions: ['overview:read', 'rides:read', 'rides:write', 'drivers:read', 'drivers:write', 'clients:read', 'clients:write', 'alerts:read', 'alerts:write', 'pricing:read', 'pricing:write', 'promos:read', 'promos:write', 'services:read', 'services:write', 'support:read', 'support:write', 'finance:read', 'treasury:read', 'treasury:request', 'treasury:approve', 'sessions:read', 'sessions:write', 'search:read', 'notify:read', 'notify:write', 'audit:read', 'roles:read'],
};

/** Réglages dispatch & qualité (démo). */
const ops = { strategy: 'nearest', minRating: 4.5, autoWarn: true, maxEtaMinutes: 7, offerTimeoutSec: 12, surgeEnabled: true, surgeCapGreen: 1.3 };

/** Modération des notes (démo) : dérivée de la flotte, avec deux cas sous le seuil. */
function quality() {
  const rows = drivers.map((d, i) => ({
    id: d.id, name: d.name, matricule: d.matricule, category: d.category,
    rating: i === 2 ? 4.12 : i === 8 ? 4.38 : d.rating, trips: d.trips,
    warnings: i === 2 ? 2 : i === 8 ? 1 : 0, kycStatus: d.kycStatus,
    below: i === 2 || i === 8,
  })).sort((a, b) => a.rating - b.rating);
  return { threshold: 4.5, autoWarn: true, drivers: rows };
}

/** Litiges de démonstration. */
const disputes = [
  { id: 'lt-01a', rideId: 'r55aa120e', clientId: 'client-3345', kind: 'objet_perdu', description: 'Téléphone Samsung oublié sur la banquette arrière, coque bleue.', status: 'open', createdAt: iso(35) },
  { id: 'lt-02b', rideId: 'r7c3390fd', clientId: 'client-9902', kind: 'facturation', description: 'Débité 2 650 F sur Wave ET Orange Money pour la même course.', status: 'investigating', createdAt: iso(160), decidedBy: undefined },
  { id: 'lt-03c', rideId: 'r10a2f9c1', clientId: 'client-8842', kind: 'trajet', description: 'Le chauffeur a fait un détour par Adjamé, trajet plus long qu’annoncé.', status: 'resolved', resolution: 'Tracé GPS vérifié : détour imposé par un axe fermé. Geste commercial.', refund: 500, decidedBy: 'PDG ORION', createdAt: iso(60 * 26), decidedAt: iso(60 * 24) },
];

/** Fiche d'instruction d'une course (démo) : tracé GPS synthétique + tarif. */
function rideForensic(rideId: string) {
  const row = rides.find((r) => r.id === rideId) ?? rides[0]!;
  const o = { lat: 5.325, lng: -4.02 }, dst = { lat: 5.36, lng: -3.985 };
  const trace: { lat: number; lng: number }[] = [];
  for (let i = 0; i <= 40; i++) {
    const t = i / 40;
    trace.push({ lat: o.lat + (dst.lat - o.lat) * t + Math.sin(t * 6) * 0.004, lng: o.lng + (dst.lng - o.lng) * t + Math.cos(t * 4) * 0.003 });
  }
  const sub = Math.round(row.amount / 1.15);
  return {
    ride: {
      id: row.id, clientId: row.clientId, driverId: 'd1', status: row.status,
      origin: o, destination: dst,
      quote: { amount: row.amount, currency: 'XOF', breakdown: { base: 300, distance: Math.round(sub * 0.6), time: Math.round(sub * 0.25), subtotal: sub, tva: Math.round(sub * 0.05), fee: Math.round(sub * 0.1) } },
      events: [
        { type: 'created', at: row.createdAt }, { type: 'accepted', at: row.createdAt },
        { type: 'driver_en_route', at: row.createdAt }, { type: 'in_progress', at: row.createdAt },
        { type: row.status, at: row.createdAt },
      ],
      trace, createdAt: row.createdAt,
    },
    driverName: row.driverName, matricule: row.matricule,
  };
}

/** Mobilité verte (démo) : CO2 économisé, parts électrique/hybride, batteries SoC. */
const green = {
  co2SavedKg: 18425, co2SavedTons: 18.43, kmElectric: 128400, kmHybrid: 21500,
  electricShare: 86, hybridShare: 14,
  fleet: {
    electric: 8, hybrid: 2, lowBattery: 1,
    batteries: [
      { id: 'd1', name: 'Konan Yao', matricule: 'ORION-CI-1042', batteryPct: 84, availability: 'online' },
      { id: 'd2', name: 'Awa Diomandé', matricule: 'ORION-CI-2210', batteryPct: 57, availability: 'on_trip' },
      { id: 'd3', name: 'Aïcha Touré', matricule: 'ORION-CI-1207', batteryPct: 92, availability: 'online' },
      { id: 'd5', name: 'Mamadou Bamba', matricule: 'ORION-CI-9034', batteryPct: 14, availability: 'online' },
      { id: 'd7', name: 'Fatou Koné', matricule: 'ORION-CI-7788', batteryPct: 66, availability: 'on_trip' },
    ],
  },
};

/** Sessions actives de démonstration (qui est connecté à la console). */
const sessions = [
  { id: 'sess-ceo-1', username: 'pdg', name: 'PDG ORION', role: 'ceo', ip: '102.64.18.4', userAgent: 'Chrome 138 · MacBook Pro', createdAt: iso(95), lastSeenAt: iso(0), expiresAt: iso(-600) },
  { id: 'sess-cfo-1', username: 'cfo', name: 'Directeur Financier', role: 'cfo', ip: '102.64.18.11', userAgent: 'Edge 138 · Windows 11', createdAt: iso(220), lastSeenAt: iso(3), expiresAt: iso(-500) },
  { id: 'sess-ops-1', username: 'awa.ops', name: 'Awa (Dispatch)', role: 'ops', ip: '154.12.9.87', userAgent: 'Chrome 138 · Windows 10', createdAt: iso(410), lastSeenAt: iso(1), expiresAt: iso(-300) },
  { id: 'sess-sup-1', username: 'jean.support', name: 'Jean (Support)', role: 'support', ip: '154.12.9.90', userAgent: 'Firefox 141 · Ubuntu', createdAt: iso(75), lastSeenAt: iso(12), expiresAt: iso(-640) },
];

const clients = [
  { id: 'client-8842', name: 'Awa Koffi', phone: '+225 07 08 09 10 11', status: 'active', rides: 34, createdAt: iso(60 * 24 * 40), lastSeenAt: iso(120) },
  { id: 'client-1190', name: 'Jean Brou', phone: '+225 05 44 22 11 00', status: 'active', rides: 12, createdAt: iso(60 * 24 * 15), lastSeenAt: iso(300) },
  { id: 'client-4521', name: 'Fatou N’Dri', phone: '+225 01 22 33 44 55', status: 'blocked', rides: 3, createdAt: iso(60 * 24 * 5), lastSeenAt: iso(1400) },
];
// Volume réaliste pour la pagination (démo) : ~34 clients.
{
  const firsts = ['Koffi', 'Adjoua', 'Yao', 'Aminata', 'Sékou', 'Mariam', 'Didier', 'Nadia', 'Bakary', 'Chantal'];
  const lasts = ['Kouadio', 'Traoré', 'N’Guessan', 'Cissé', 'Bamba', 'Aka', 'Koné', 'Brou'];
  for (let i = 0; i < 31; i++) {
    clients.push({
      id: 'client-' + (2000 + i * 61),
      name: `${firsts[i % firsts.length]} ${lasts[i % lasts.length]}`,
      phone: `+225 0${(i % 6) + 1} ${String(10 + i).padStart(2, '0')} ${String(20 + i * 3 % 80).padStart(2, '0')} ${String((i * 17) % 100).padStart(2, '0')} ${String((i * 29) % 100).padStart(2, '0')}`,
      status: i % 13 === 7 ? 'blocked' : 'active',
      rides: (i * 5) % 60,
      createdAt: iso(60 * 24 * (2 + i)),
      lastSeenAt: iso(30 + i * 90),
    });
  }
}

const promos = [
  { id: 'BIENVENUE', kind: 'percent', value: 30, active: true, uses: 214, maxUses: 1000, createdAt: iso(60 * 24 * 10) },
  { id: 'ORION500', kind: 'amount', value: 500, active: true, uses: 88, createdAt: iso(60 * 24 * 4) },
  { id: 'NOEL', kind: 'percent', value: 15, active: false, uses: 0, createdAt: iso(60 * 24 * 2) },
];

const services = {
  city: 'Abidjan', open: true,
  services: { course: true, delivery: true, food: false, shop: false, market: false, colis: false },
};

const support = [
  { id: 'c1a2b3', clientId: 'client-8842', subject: 'Objet oublié', status: 'open', assignee: undefined, createdAt: iso(40), updatedAt: iso(6),
    messages: [
      { id: 'm1', from: 'client', text: 'Bonjour, j’ai oublié mon téléphone dans la voiture.', at: iso(40) },
      { id: 'm2', from: 'agent', author: 'Support ORION', text: 'Bonjour Awa, on contacte le chauffeur tout de suite.', at: iso(30) },
      { id: 'm3', from: 'client', text: 'Merci beaucoup 🙏', at: iso(6) },
    ] },
  { id: 'd4e5f6', clientId: 'client-1190', subject: 'Question paiement', status: 'pending', assignee: 'Support ORION', createdAt: iso(120), updatedAt: iso(55),
    messages: [
      { id: 'm4', from: 'client', text: 'Le paiement Wave a échoué mais j’ai été débité.', at: iso(120) },
      { id: 'm5', from: 'agent', author: 'Support ORION', text: 'On vérifie la transaction, un instant.', at: iso(55) },
    ] },
];

const audit = [
  { id: 'a1', at: iso(3), actor: 'Super Admin', role: 'super_admin', action: 'pricing.update', details: { perKm: 130 } },
  { id: 'a2', at: iso(25), actor: 'Awa (Finance)', role: 'finance', action: 'promo.upsert', target: 'BIENVENUE' },
  { id: 'a3', at: iso(90), actor: 'Support ORION', role: 'support', action: 'client.status', target: 'client-4521', details: { status: 'blocked' } },
];

const finance = {
  currency: 'XOF', gmv: 1263500, revenue: 1263500, commission: 227430, earnings: 1036070, payouts: 640000,
  byTier: { bronze: { count: 62, revenue: 214000 }, argent: { count: 34, revenue: 268000 }, or: { count: 21, revenue: 372500 }, diamant: { count: 9, revenue: 289000 }, livraison: { count: 22, revenue: 120000 } },
};

const broadcasts = [
  { id: 'b1', audience: 'clients', title: 'Wi-Fi gratuit à bord 🚀', body: 'Profitez du Wi-Fi illimité gratuit sur toutes vos courses ORION.', author: 'Support ORION', at: iso(120) },
  { id: 'b2', audience: 'all', title: 'Prix en baisse', body: 'ORION, toujours moins cher — profitez de nos nouveaux tarifs.', author: 'Awa (Finance)', at: iso(600) },
];

/** Trésorerie de démonstration : virements en attente / approuvés / rejetés. */
const treasury = [
  { id: 'tr-88f2', amount: 4_500_000, currency: 'XOF', destination: 'SGCI — CI93 SG01 0002 4518', reason: 'Salaires juillet (siège Abidjan)', requestedBy: 'Directeur Financier', requestedRole: 'cfo', status: 'pending', createdAt: iso(45) },
  { id: 'tr-51ab', amount: 1_200_000, currency: 'XOF', destination: 'NSIA Banque — CI042 0114 552', reason: 'Fournisseur flotte (pneus + entretien)', requestedBy: 'Directeur Financier', requestedRole: 'cfo', status: 'pending', createdAt: iso(180) },
  { id: 'tr-3c77', amount: 2_800_000, currency: 'XOF', destination: 'SGCI — CI93 SG01 0002 4518', reason: 'Loyer T3 + charges bureaux', requestedBy: 'Directeur Financier', requestedRole: 'cfo', status: 'approved', decidedBy: 'PDG ORION', createdAt: iso(60 * 24 * 3), decidedAt: iso(60 * 24 * 3 - 90), executedAt: iso(60 * 24 * 3 - 90) },
  { id: 'tr-9d10', amount: 9_000_000, currency: 'XOF', destination: 'Ecobank — CI059 8871 003', reason: 'Campagne marketing (à re-détailler)', requestedBy: 'Directeur Financier', requestedRole: 'cfo', status: 'rejected', decidedBy: 'PDG ORION', decisionNote: 'Budget à ventiler par canal avant aval', createdAt: iso(60 * 24 * 6), decidedAt: iso(60 * 24 * 6 - 200) },
];

/** Recherche globale de démonstration (filtre local sur les données simulées). */
function search(q: string) {
  const needle = q.trim().toLowerCase();
  if (needle.length < 2) return { drivers: [], clients: [], rides: [] };
  return {
    drivers: drivers.filter((d) => d.name.toLowerCase().includes(needle) || d.matricule.toLowerCase().includes(needle) || d.id.includes(needle)).slice(0, 8)
      .map((d) => ({ id: d.id, name: d.name, matricule: d.matricule, category: d.category, availability: d.availability })),
    clients: clients.filter((c) => c.id.includes(needle) || (c.name ?? '').toLowerCase().includes(needle) || (c.phone ?? '').includes(needle)).slice(0, 8)
      .map((c) => ({ id: c.id, name: c.name ?? null, phone: c.phone ?? null, status: c.status, rides: c.rides })),
    rides: rides.filter((r) => r.id.toLowerCase().includes(needle) || r.clientId.toLowerCase().includes(needle)).slice(0, 8)
      .map((r) => ({ id: r.id, clientId: r.clientId, status: r.status, amount: r.amount, createdAt: r.createdAt })),
  };
}

/** Séries quotidiennes de démonstration (tendances) — variation pseudo-aléatoire stable. */
function stats(days: number) {
  const n = Math.min(90, Math.max(1, Math.round(days)));
  const today = new Date();
  const series = [];
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(today);
    d.setUTCDate(today.getUTCDate() - i);
    const date = d.toISOString().slice(0, 10);
    const dow = d.getUTCDay();
    const weekend = dow === 0 || dow === 6 ? 1.35 : 1; // week-end plus chargé
    const wave = 1 + 0.25 * Math.sin(i / 2.3);
    const rides = Math.round((120 + ((i * 37) % 60)) * weekend * wave);
    const revenue = Math.round(rides * (3200 + ((i * 53) % 900)));
    const cancelled = Math.round(rides * 0.05 + (i % 3));
    series.push({ date, rides, revenue, cancelled });
  }
  return {
    currency: 'XOF', days: n, series,
    totals: {
      rides: series.reduce((s, b) => s + b.rides, 0),
      revenue: series.reduce((s, b) => s + b.revenue, 0),
      cancelled: series.reduce((s, b) => s + b.cancelled, 0),
    },
  };
}

/** Fiche chauffeur de démonstration (dérivée de la ligne + données factices cohérentes). */
function driverDetail(id: string, rows: DriverRow[]): DriverDetail {
  const d = rows.find((x) => x.id === id) ?? drivers[0]!;
  const earnings = Math.round(d.balance * 3.2);
  return {
    id: d.id, name: d.name, matricule: d.matricule, category: d.category, kycStatus: d.kycStatus,
    availability: d.availability, rating: d.rating, trips: d.trips, balance: d.balance, earnings,
    rides: [
      { id: 'r' + d.id + 'a1', status: 'rated', amount: 3200, createdAt: iso(30) },
      { id: 'r' + d.id + 'b2', status: 'paid', amount: 5400, createdAt: iso(180) },
      { id: 'r' + d.id + 'c3', status: 'completed', amount: 2650, createdAt: iso(420) },
      { id: 'r' + d.id + 'd4', status: 'cancelled', amount: 0, createdAt: iso(900) },
    ],
    ledger: [
      { id: 'l1', type: 'ride_earning', amount: 2880, at: iso(30) },
      { id: 'l2', type: 'commission', amount: -320, at: iso(30) },
      { id: 'l3', type: 'ride_earning', amount: 4860, at: iso(180) },
      { id: 'l4', type: 'payout', amount: -20000, at: iso(60 * 24) },
    ],
  };
}

/** Fiche client de démonstration. */
function clientDetail(id: string, rows: Client[]): ClientDetail {
  const c = rows.find((x) => x.id === id);
  const conv = support.filter((s) => s.clientId === id).map((s) => ({ id: s.id, subject: s.subject, status: s.status, messages: s.messages.length }));
  return {
    id, name: c?.name ?? null, phone: c?.phone ?? null, status: c?.status ?? 'active',
    rides: c?.rides ?? 3, createdAt: c?.createdAt ?? null, spent: (c?.rides ?? 3) * 3450,
    recentRides: [
      { id: 'r' + id + 'x1', status: 'rated', amount: 3150, createdAt: iso(50) },
      { id: 'r' + id + 'x2', status: 'paid', amount: 2650, createdAt: iso(320) },
      { id: 'r' + id + 'x3', status: 'completed', amount: 5400, createdAt: iso(720) },
    ],
    conversations: conv,
  };
}

export const DEMO = { overview, stats, alerts, fleet, rides, drivers, pricing, zones, me, clients, promos, services, support, audit, finance, broadcasts, treasury, sessions, search, driverDetail, clientDetail, ops, quality, disputes, rideForensic, green };
