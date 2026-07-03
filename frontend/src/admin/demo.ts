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
  { id: 'a1', kind: 'crash', level: 'rouge', status: 'dispatched', source: 'systeme', userId: 'client-8842', location: { lat: 5.348, lng: -4.002 }, zoneName: 'Adjamé', impactG: 6.2, dispatchedTo: ['185', '170'], createdAt: iso(2), slaSeconds: 122, note: 'Accident détecté automatiquement (capteurs)' },
  { id: 'a2', kind: 'sos', level: 'rouge', status: 'acknowledged', source: 'client', agent: 'Aya (SAMU)', userId: 'client-1190', location: { lat: 5.335, lng: -3.99 }, zoneName: 'Cocody', dispatchedTo: ['185', '170'], createdAt: iso(9), slaSeconds: 540, note: 'SOS déclenché par le client', chat: [{ from: 'agent', author: 'Aya (SAMU)', text: 'Êtes-vous en danger ? Répondez par Oui ou Non.', at: iso(8) }, { from: 'usager', text: 'Non, fausse manip', at: iso(7) }] },
  { id: 'a4', kind: 'deviation', level: 'orange', status: 'dispatched', source: 'systeme', userId: 'client-3312', location: { lat: 5.34, lng: -4.005 }, zoneName: 'Plateau', dispatchedTo: ['185', '170'], createdAt: iso(4), slaSeconds: 240, note: 'Déviation majeure inexpliquée (itinéraire réel très supérieur au prévu)' },
  { id: 'a5', kind: 'immobilisation', level: 'jaune', status: 'raised', source: 'systeme', userId: 'client-7781', location: { lat: 5.30, lng: -3.99 }, zoneName: 'Marcory', dispatchedTo: ['185'], createdAt: iso(6), slaSeconds: 360, note: 'Véhicule anormalement immobilisé (course figée)' },
  { id: 'a3', kind: 'sos', level: 'rouge', status: 'resolved', source: 'client', agent: 'Ben (SAMU)', sealed: true, closingNote: 'Fausse alerte confirmée par le passager, aucune menace. Course reprise normalement.', userId: 'client-4521', location: { lat: 5.31, lng: -4.01 }, zoneName: 'Treichville', dispatchedTo: ['185'], createdAt: iso(41) },
];
const sosPresets = [
  'Êtes-vous en danger ? Répondez par Oui ou Non.',
  'Les secours sont prévenus. Restez calme, nous suivons votre position.',
  'Pouvez-vous parler librement ?',
  'Restez dans le véhicule si vous êtes en sécurité, sinon éloignez-vous.',
];
/** Dossier SAMU d'une alerte (démo). */
function sosDossier(id: string) {
  const a = alerts.find((x) => x.id === id) ?? alerts[0]!;
  const o = { lat: 5.325, lng: -4.02 }, dst = { lat: 5.36, lng: -3.985 };
  const trace: { lat: number; lng: number }[] = [];
  for (let i = 0; i <= 30; i++) {
    const t = i / 30;
    trace.push({ lat: o.lat + (dst.lat - o.lat) * t + Math.sin(t * 7) * 0.006, lng: o.lng + (dst.lng - o.lng) * t + Math.cos(t * 5) * 0.005 });
  }
  return {
    alert: a, presets: sosPresets,
    ride: { id: 'r-sos-' + a.id, status: 'in_progress', origin: o, destination: dst, trace, createdAt: a.createdAt },
    vehicle: { plate: '4821 CI 01', model: 'BYD Dolphin 2024', color: 'Blanc nacré', engine: 'electric' },
    driver: { id: 'd2', name: 'Awa Diomandé', matricule: 'ORION-CI-2210', phone: '+225 07 11 22 33 44', licenseNo: 'CI-2019-448210', birthDate: '1990-05-14', phoneBatteryPct: 68, batteryPct: 57 },
    passenger: { id: a.userId, name: 'Awa Koffi', phone: '+225 07 08 09 10 11', phoneBatteryPct: 41, lastRides: [{ id: 'r1', status: 'rated', createdAt: iso(60) }, { id: 'r2', status: 'paid', createdAt: iso(300) }] },
    telemetry: { speedEstimateKmh: 54, points: trace.length, refreshSeconds: 1 },
    emergencyNumbers: { samu: '185', police: '170', pompiers: '180' },
  };
}
/** Alertes sécurité interne (tentatives d'accès non autorisé) — démo. */
const security = [
  { id: 's1', username: 'jean.support', name: 'Jean (Support)', role: 'support', section: 'treasury', ip: '154.12.9.90', at: iso(12), notified: ['DG', 'CFO', 'DAA'] },
  { id: 's2', username: 'awa.ops', name: 'Awa (Dispatch)', role: 'ops', permission: 'finance:read', path: '/admin/finance', ip: '154.12.9.87', at: iso(140), notified: ['DG', 'CFO', 'DAA'] },
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
  kycStatus: i === 8 ? 'manual_review' : i === 6 ? 'docs_submitted' : i === 7 ? 'draft' : 'active',
  availability: f.availability, rating: 4.7 + (i % 3) * 0.1, trips: 800 + i * 137, balance: 15000 + i * 4200,
  vip: i === 2, loyaltyTier: i === 2 ? 'gold' : i === 4 ? 'silver' : null,
  electricRides: 200 + i * 110, suspensionReason: null,
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
  { id: 'riviera-golf', name: 'Riviera Golf', factor: 1.15, lat: 5.3742, lng: -3.9721, radiusKm: 1.4, active: true, waitMaxMin: 5, driverBonus: 300, minStandard: 'argent', pickupFee: 200, dedicated: true },
  { id: 'deux-plateaux-vallon', name: 'Deux-Plateaux Vallon', factor: 1.1, lat: 5.3689, lng: -4.0004, radiusKm: 1.3, active: true, waitMaxMin: 5, driverBonus: 200, minStandard: 'argent', pickupFee: 150 },
  { id: 'cite-des-arts', name: 'Cocody Centre — Cité des Arts', factor: 1.08, lat: 5.3488, lng: -3.9962, radiusKm: 1.1, active: true, waitMaxMin: 6, driverBonus: 150, pickupFee: 100 },
  { id: 'cocody-danga', name: 'Cocody Danga', factor: 1.1, lat: 5.3391, lng: -4.0011, radiusKm: 1.0, active: true, waitMaxMin: 5, driverBonus: 200, minStandard: 'argent', pickupFee: 150 },
  { id: 'riviera-beverly-hills', name: 'Riviera Beverly Hills', factor: 1.18, lat: 5.3808, lng: -3.9611, radiusKm: 1.2, active: true, waitMaxMin: 5, driverBonus: 300, minStandard: 'or', pickupFee: 250, dedicated: true },
  { id: 'marcory-zone4', name: 'Marcory Zone 4', factor: 1.08, lat: 5.2942, lng: -3.9846, radiusKm: 1.6, active: true, waitMaxMin: 6, driverBonus: 150, pickupFee: 100 },
];

const me = {
  name: 'PDG ORION',
  role: 'ceo',
  roleLabel: 'CEO — Président Directeur Général',
  permissions: ['overview:read', 'rides:read', 'rides:write', 'drivers:read', 'drivers:write', 'clients:read', 'clients:write', 'alerts:read', 'alerts:write', 'pricing:read', 'pricing:write', 'promos:read', 'promos:write', 'services:read', 'services:write', 'support:read', 'support:write', 'finance:read', 'treasury:read', 'treasury:request', 'treasury:approve', 'sessions:read', 'sessions:write', 'teams:read', 'teams:write', 'search:read', 'notify:read', 'notify:write', 'audit:read', 'security:read', 'roles:read'],
};

/** Réglages dispatch & qualité (démo). */
const ops = {
  strategy: 'nearest', minRating: 4.5, autoWarn: true, maxEtaMinutes: 7, offerTimeoutSec: 12,
  surgeEnabled: true, surgeCapGreen: 1.3, waitFeePerMin: 100,
  radiusKm: 1.5, radiusMaxKm: 6, offerMode: 'cascade', weightRating: 0, weightIdle: 0, greenPriority: false,
  surgeThreshold: 1.3, surgeSmoothingMin: 10, refundCap: 5000, offPeakBonus: 500, offPeakStart: 22, offPeakEnd: 6,
  cashDebtLimit: 30000, commissionStandard: 0.20, commissionGreen: 0.12, loyaltyRideThreshold: 1000, commissionLoyalty: 0.10,
};
/** Support : indicateurs SLA/CSAT + macros (démo). */
const supportStats = { open: 2, resolvedToday: 5, avgFirstReplyMin: 3.4, csat: 4.6 };
const macros = [
  { title: 'Objet oublié', text: 'Nous avons contacté votre chauffeur au sujet de l’objet oublié. Votre objet vous sera restitué sans frais.' },
  { title: 'Procédure d’annulation', text: 'Vous pouvez annuler sans frais tant que le chauffeur n’est pas arrivé au point de rendez-vous.' },
  { title: 'Erreur de facturation', text: 'Après vérification du trajet GPS et du devis verrouillé, la différence sera recréditée sous 24 h.' },
  { title: 'Prix fixe garanti', text: 'Le prix affiché avant la course est FIXE et garanti : trafic déjà intégré, aucun supplément surprise.' },
];
/** Déclencheurs automatisés (démo). */
const triggers = {
  lowBattery: [
    { id: 'd5', name: 'Mamadou Bamba', matricule: 'ORION-CI-9034', batteryPct: 14, station: 'Borne Cocody — Riviera 2' },
    { id: 'd8', name: 'Serge Aka', matricule: 'ORION-CI-4820', batteryPct: 11, station: 'Borne Plateau — Rue du Commerce' },
  ],
  winback: [
    { id: 'client-2793', name: 'Sékou Traoré', rides: 28, lastSeenAt: iso(60 * 24 * 33) },
    { id: 'client-2427', name: 'Nadia Cissé', rides: 15, lastSeenAt: iso(60 * 24 * 41) },
  ],
  offPeak: { start: 22, end: 6, bonus: 500 },
};
/** Courbe CSAT 7 jours + taux (démo). */
const csat = {
  series: Array.from({ length: 7 }, (_, i) => {
    const d = new Date(); d.setUTCDate(d.getUTCDate() - (6 - i));
    return { date: d.toISOString().slice(0, 10), avg: Math.round((4.5 + Math.sin(i) * 0.25) * 100) / 100, count: 40 + i * 6 };
  }),
  csat7d: 4.82, acceptRate: 94, cancelRate: 6,
};
/** Top drivers (VIP top 5 %) — démo. */
const qualityTop = [
  { id: 'd3', name: 'Aïcha Touré', matricule: 'ORION-CI-1207', rating: 4.95, trips: 1284, vip: true },
  { id: 'd7', name: 'Fatou Koné', matricule: 'ORION-CI-7788', rating: 4.93, trips: 1102, vip: false },
];
/** Réservations à l'avance (démo). */
const reservations = [
  { id: 'rs-01', clientId: 'client-8842', origin: { lat: 5.35, lng: -4.0 }, destination: { lat: 5.26, lng: -3.93 }, category: 'or', scheduledFor: iso(-90), status: 'assignee', driverName: 'Serge Aka', minutesToGo: 90, punctualityAlert: false, createdAt: iso(600) },
  { id: 'rs-02', clientId: 'client-1190', origin: { lat: 5.36, lng: -3.98 }, destination: { lat: 5.26, lng: -3.93 }, category: 'diamant', scheduledFor: iso(-20), status: 'planifiee', minutesToGo: 20, punctualityAlert: true, createdAt: iso(400) },
  { id: 'rs-03', clientId: 'client-3345', origin: { lat: 5.33, lng: -4.01 }, destination: { lat: 5.35, lng: -4.02 }, category: 'argent', scheduledFor: iso(-60 * 12), status: 'planifiee', minutesToGo: 720, punctualityAlert: false, createdAt: iso(200) },
];
/** Shadow mode (démo). */
function simulate(patch: { maxEtaMinutes?: number; radiusMaxKm?: number }) {
  const wider = (patch.radiusMaxKm ?? 6) > 6 || (patch.maxEtaMinutes ?? 7) > 7;
  return {
    current: { sampled: 60, matched: 52, matchRate: 87, avgEtaMin: 4.6 },
    proposed: { sampled: 60, matched: wider ? 57 : 50, matchRate: wider ? 95 : 83, avgEtaMin: wider ? 5.8 : 4.2 },
  };
}

/* --- S8 Équipes / RH (démo) --- */
const staffKpis = [
  { actor: 'Jean (Support)', role: 'support', total: 42, support: 38, moderation: 2, finance: 0, promos: 2, lastAt: iso(4) },
  { actor: 'Awa (Dispatch)', role: 'ops', total: 31, support: 6, moderation: 19, finance: 0, promos: 6, lastAt: iso(1) },
  { actor: 'Koffi (Qualité)', role: 'ops', total: 24, support: 3, moderation: 21, finance: 0, promos: 0, lastAt: iso(9) },
];
const shifts = [
  { id: 'sh1', username: 'awa.ops', name: 'Awa (Dispatch)', date: new Date().toISOString().slice(0, 10), slot: 'nuit', zoneId: 'cocody', createdAt: iso(120) },
  { id: 'sh2', username: 'jean.support', name: 'Jean (Support)', date: new Date().toISOString().slice(0, 10), slot: 'matin', createdAt: iso(120) },
  { id: 'sh3', username: 'koffi.q', name: 'Koffi (Qualité)', date: new Date().toISOString().slice(0, 10), slot: 'soir', zoneId: 'riviera-golf', createdAt: iso(120) },
];
const maintenance = [
  { id: 'mt1', driverId: 'd5', kind: 'batterie_soh', title: 'Baisse anormale de capacité batterie (SoH 79 %)', status: 'ouvert', assignee: undefined, createdAt: iso(60) },
  { id: 'mt2', driverId: 'd1', kind: 'controle_technique', title: 'Contrôle technique requis dans 15 jours', status: 'assigne', assignee: 'Agent X', createdAt: iso(300) },
  { id: 'mt3', driverId: 'd3', kind: 'nettoyage', title: 'Nettoyage intérieur après incident', status: 'resolu', createdAt: iso(900) },
];
function squadPnl(_teamId: string) {
  return { vehicles: 3, active: 2, grounded: 1, activityRate: 67, revenue: 842500, rides: 128, roi: 42 };
}

/* --- S9 IA (démo) --- */
const fraud = {
  ghostRides: [
    { clientId: 'client-collusion', driverId: 'd8', driverName: 'Serge Aka', count: 7 },
    { clientId: 'client-2214', driverId: 'd2', driverName: 'Awa Diomandé', count: 4 },
  ],
  gpsSpoof: [
    { rideId: 'r55aa120e', driverId: 'd5', jumpMeters: 3400 },
  ],
  txRisk: [
    { id: 'client-4521', name: 'Fatou N’Dri', cancellations: 5, warnings: 1 },
  ],
};
const elasticity = [
  { cell: '743:-556', lat: 5.3496, lng: -4.0032, sessions: 220, rate: 70, recommended: 1.5 },
  { cell: '737:-554', lat: 5.3064, lng: -3.9888, sessions: 145, rate: 26, recommended: 1 },
  { cell: '742:-561', lat: 5.3424, lng: -4.0392, sessions: 98, rate: 48, recommended: 1.25 },
];
function copilot(q: string) {
  const s = q.toLowerCase();
  if (/électr|electr|thermi/.test(s)) return { query: q, answer: '86 % des trajets sont 100 % électriques (128 400 km), 14 % hybrides. CO2 évité : 18 425 kg. Revenu total encaissé : 1 263 500 F CFA.', data: null };
  if (/flotte|chauffeur/.test(s)) return { query: q, answer: '10 chauffeurs (8 en ligne, 4 en course). 12 courses actives.', data: null };
  return { query: q, answer: 'GMV 1 263 500 F CFA · revenu encaissé 1 263 500 F CFA · commission ORION 227 430 F CFA.', data: null };
}

/* --- S12-S15 (démo) --- */
const expiring = [
  { id: 'd5', name: 'Mamadou Bamba', matricule: 'ORION-CI-9034', insuranceExpiry: iso(-60 * 24 * -12), daysLeft: 12 },
  { id: 'd9', name: 'Yao N’Guessan', matricule: 'ORION-CI-6120', insuranceExpiry: iso(-60 * 24 * -5), daysLeft: 5 },
];
const cashDebt = [
  { id: 'd8', name: 'Serge Aka', matricule: 'ORION-CI-4820', balance: -38900, limit: 30000 },
];
const gateways = [
  { method: 'orange_money', enabled: true }, { method: 'mtn_momo', enabled: true },
  { method: 'moov_money', enabled: true }, { method: 'wave', enabled: true },
  { method: 'card', enabled: true }, { method: 'cash', enabled: true },
];
const expenses = [
  { id: 'ex-01', requesterType: 'employee', requesterId: 'awa.ops', requesterName: 'Awa (Dispatch)', amount: 50000, category: 'marketing', neededDate: iso(-60 * 24), description: 'Campagne terrain quartier Cocody', status: 'pending', createdAt: iso(30) },
  { id: 'ex-02', requesterType: 'driver', requesterId: 'd1', requesterName: 'Konan Yao', amount: 25000, category: 'recharge', neededDate: iso(-60 * 48), description: 'Achat câbles de recharge Type 2', status: 'approved', credited: true, cashOut: { channel: 'wave', amount: 25000, at: iso(120) }, receipt: { amount: 22000, at: iso(60), matches: true }, refunded: 3000, createdAt: iso(300) },
  { id: 'ex-03', requesterType: 'employee', requesterId: 'jean.support', requesterName: 'Jean (Support)', amount: 15000, category: 'deplacement', neededDate: iso(-60 * 24 * 3), description: 'Frais de déplacement inspection', status: 'approved', credited: true, blocked: true, createdAt: iso(60 * 24 * 4) },
];
const liquidity = {
  currency: 'XOF', cashOnHand: 120_000_000, escrow: 50_000_000, virtualHeld: 34_500_000,
  backingRatio: 145, backingOk: true, monthlyOpex: 8_000_000, netMonthly: 4_200_000,
  burnRate: 3_800_000, runwayMonths: 31.6,
};
const amortization = {
  vehicles: 3, totalBookValue: 42_600_000,
  rows: [
    { id: 'd3', matricule: 'ORION-CI-1207', km: 42000, purchase: 18000000, depreciation: 5040000, bookValue: 12960000 },
    { id: 'd7', matricule: 'ORION-CI-7788', km: 51000, purchase: 18000000, depreciation: 6120000, bookValue: 11880000 },
    { id: 'd8', matricule: 'ORION-CI-4820', km: 38000, purchase: 18000000, depreciation: 4560000, bookValue: 13440000 },
  ],
};

/** Modération des notes (démo) : dérivée de la flotte, avec deux cas sous le seuil. */
function quality() {
  const rows = drivers.map((d, i) => ({
    id: d.id, name: d.name, matricule: d.matricule, category: d.category,
    rating: i === 2 ? 4.12 : i === 8 ? 4.38 : d.rating, trips: d.trips,
    warnings: i === 2 ? 2 : i === 8 ? 1 : 0, kycStatus: d.kycStatus,
    vip: d.id === 'd3', below: i === 2 || i === 8,
  })).sort((a, b) => a.rating - b.rating);
  return { threshold: 4.5, autoWarn: true, drivers: rows, top: qualityTop };
}

/** Litiges de démonstration. */
const disputes = [
  { id: 'lt-01a', rideId: 'r55aa120e', clientId: 'client-3345', kind: 'objet_perdu', description: 'Téléphone Samsung oublié sur la banquette arrière, coque bleue.', status: 'open', createdAt: iso(35) },
  { id: 'lt-02b', rideId: 'r7c3390fd', clientId: 'client-9902', kind: 'facturation', description: 'Débité 2 650 F sur Wave ET Orange Money pour la même course. Le client conteste auprès de sa banque (carte volée).', status: 'investigating', escalation: 'chargeback', lockedBy: 'Expert Litiges A', quarantined: true, notes: [{ author: 'Expert Litiges A', text: 'Device fingerprint concordant, IP habituelle. Bonne foi douteuse.', at: iso(120) }], createdAt: iso(160), decidedBy: undefined },
  { id: 'lt-03c', rideId: 'r10a2f9c1', clientId: 'client-8842', kind: 'comportement', description: 'Dégradation du véhicule (siège taché). Photos à l’appui du chauffeur.', status: 'investigating', escalation: 'degradation', lockedBy: 'Expert Litiges B', createdAt: iso(60 * 26) },
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
    electric: 8, hybrid: 2, lowBattery: 1, avgSoh: 89,
    batteries: [
      { id: 'd1', name: 'Konan Yao', matricule: 'ORION-CI-1042', batteryPct: 84, batteryHealthPct: 94, availability: 'online' },
      { id: 'd2', name: 'Awa Diomandé', matricule: 'ORION-CI-2210', batteryPct: 57, batteryHealthPct: 88, availability: 'on_trip' },
      { id: 'd3', name: 'Aïcha Touré', matricule: 'ORION-CI-1207', batteryPct: 92, batteryHealthPct: 96, availability: 'online' },
      { id: 'd5', name: 'Mamadou Bamba', matricule: 'ORION-CI-9034', batteryPct: 14, batteryHealthPct: 79, availability: 'online' },
      { id: 'd7', name: 'Fatou Koné', matricule: 'ORION-CI-7788', batteryPct: 66, batteryHealthPct: 91, availability: 'on_trip' },
    ],
  },
  topGreenClients: [
    { id: 'client-8842', name: 'Awa Koffi', greenPoints: 1284 },
    { id: 'client-1190', name: 'Jean Brou', greenPoints: 642 },
    { id: 'client-2793', name: 'Sékou Traoré', greenPoints: 511 },
  ],
  chargingStations: [
    { id: 'cs-plateau', name: 'Borne Plateau — Rue du Commerce', lat: 5.3236, lng: -4.0187, fast: true },
    { id: 'cs-cocody', name: 'Borne Cocody — Riviera 2', lat: 5.3601, lng: -3.9788, fast: true },
    { id: 'cs-marcory', name: 'Borne Marcory — Bd VGE', lat: 5.3009, lng: -3.9812, fast: false },
    { id: 'cs-aeroport', name: 'Borne Aéroport FHB', lat: 5.2606, lng: -3.9296, fast: true },
  ],
};

/** Équipes de démonstration (managers + flottes affiliées). */
const teams = [
  { id: 'tm-cocody', name: 'Équipe Cocody', managerUsername: 'chef.awa', managerName: 'Awa Koné', driverIds: ['d1', 'd3', 'd5'], createdAt: iso(60 * 24 * 12),
    drivers: [
      { id: 'd1', name: 'Konan Yao', matricule: 'ORION-CI-1042', availability: 'online', rating: 4.7 },
      { id: 'd3', name: 'Aïcha Touré', matricule: 'ORION-CI-1207', availability: 'online', rating: 4.9 },
      { id: 'd5', name: 'Mamadou Bamba', matricule: 'ORION-CI-9034', availability: 'online', rating: 4.8 },
    ] },
  { id: 'tm-marcory', name: 'Équipe Marcory — Zone 4', managerUsername: 'chef.yao', managerName: 'Yao N’Dri', driverIds: ['d2', 'd7'], createdAt: iso(60 * 24 * 8),
    drivers: [
      { id: 'd2', name: 'Awa Diomandé', matricule: 'ORION-CI-2210', availability: 'on_trip', rating: 4.8 },
      { id: 'd7', name: 'Fatou Koné', matricule: 'ORION-CI-7788', availability: 'on_trip', rating: 4.9 },
    ] },
];

/** Intelligence (démo) : prédiction, conversion, churn. */
const predict = {
  hour: (new Date().getHours() + 1) % 24,
  cells: [
    { cell: '743:-556', lat: 5.3496, lng: -4.0032, expected: 14, supply: 6, gap: 8 },
    { cell: '745:-553', lat: 5.364, lng: -3.9816, expected: 9, supply: 7, gap: 2 },
    { cell: '731:-546', lat: 5.2632, lng: -3.9312, expected: 11, supply: 12, gap: 0 },
  ],
};
const conversion = [
  { cell: '743:-556', lat: 5.3496, lng: -4.0032, sessions: 220, orders: 154, rate: 70 },
  { cell: '737:-554', lat: 5.3064, lng: -3.9888, sessions: 145, orders: 38, rate: 26 },
  { cell: '742:-561', lat: 5.3424, lng: -4.0392, sessions: 98, orders: 61, rate: 62 },
];
const churn = {
  clients: [
    { id: 'client-2793', name: 'Sékou Traoré', rides: 28, lastSeenAt: iso(60 * 24 * 18) },
    { id: 'client-2427', name: 'Nadia Cissé', rides: 15, lastSeenAt: iso(60 * 24 * 21) },
  ],
  drivers: [
    { id: 'd9', name: 'Yao N’Guessan', matricule: 'ORION-CI-6120', idleSince: iso(60 * 24 * 9) },
  ],
};

/** Comptes entreprises (démo). */
const corporate = [
  { id: 'hotel-ivoire', name: 'Hôtel Ivoire', contactEmail: 'compta@hotelivoire.ci', nif: 'CI-778120', creditLimit: 1_500_000, balanceUsed: 842_500, active: true, kickbackRate: 0.05, members: ['client-8842', 'client-1190'], createdAt: iso(60 * 24 * 45) },
  { id: 'sgci-siege', name: 'SGCI — Siège', contactEmail: 'achats@sgci.ci', nif: 'CI-004521', creditLimit: 3_000_000, balanceUsed: 1_120_000, active: true, policy: { hourStart: 7, hourEnd: 20, zoneIds: ['plateau', 'cocody'], maxTier: 'or' }, members: ['client-2214', 'client-3345', 'client-9902'], createdAt: iso(60 * 24 * 30) },
  { id: 'sgci-rh', name: 'SGCI — Département RH', parentId: 'sgci-siege', creditLimit: 500_000, balanceUsed: 88_000, active: true, createdAt: iso(60 * 24 * 20) },
  { id: 'ambassade-fr', name: 'Ambassade de France', contactEmail: 'intendance@amba-fr.ci', creditLimit: 800_000, balanceUsed: 96_000, active: true, createdAt: iso(60 * 24 * 12) },
];

/** Sessions actives de démonstration (qui est connecté à la console). */
const sessions = [
  { id: 'sess-ceo-1', username: 'pdg', name: 'PDG ORION', role: 'ceo', ip: '102.64.18.4', userAgent: 'Chrome 138 · MacBook Pro', createdAt: iso(95), lastSeenAt: iso(0), expiresAt: iso(-600) },
  { id: 'sess-cfo-1', username: 'cfo', name: 'Directeur Financier', role: 'cfo', ip: '102.64.18.11', userAgent: 'Edge 138 · Windows 11', createdAt: iso(220), lastSeenAt: iso(3), expiresAt: iso(-500) },
  { id: 'sess-ops-1', username: 'awa.ops', name: 'Awa (Dispatch)', role: 'ops', ip: '154.12.9.87', userAgent: 'Chrome 138 · Windows 10', createdAt: iso(410), lastSeenAt: iso(1), expiresAt: iso(-300) },
  { id: 'sess-sup-1', username: 'jean.support', name: 'Jean (Support)', role: 'support', ip: '154.12.9.90', userAgent: 'Firefox 141 · Ubuntu', createdAt: iso(75), lastSeenAt: iso(12), expiresAt: iso(-640) },
];

const clients = [
  { id: 'client-8842', name: 'Awa Koffi', phone: '+225 07 08 09 10 11', status: 'active', rides: 34, greenPoints: 1284, vipTier: 'platinum', createdAt: iso(60 * 24 * 40), lastSeenAt: iso(120) },
  { id: 'client-1190', name: 'Jean Brou', phone: '+225 05 44 22 11 00', status: 'active', rides: 12, greenPoints: 642, vipTier: 'gold', createdAt: iso(60 * 24 * 15), lastSeenAt: iso(300) },
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

export const DEMO = {
  overview, stats, alerts, fleet, rides, drivers, pricing, zones, me, clients, promos, services, support, audit,
  finance, broadcasts, treasury, sessions, search, driverDetail, clientDetail, ops, quality, disputes, rideForensic,
  green, teams, predict, conversion, churn, corporate,
  sos: alerts, sosPresets, sosDossier, security, supportStats, macros, triggers, reservations, csat, qualityTop, simulate,
  staffKpis, shifts, maintenance, squadPnl, fraud, elasticity, copilot,
  expiring, cashDebt, gateways, expenses, liquidity, amortization,
};
