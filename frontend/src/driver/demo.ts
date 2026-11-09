import type { AppConfig } from '../api';
import type { DriverBackend } from './backend';
import { ApiError } from './errors';
import { saveSession, loadSession } from './session';
import type {
  ActiveRide, Announcement, DemandCell, DriverConfig, DriverEvent, DriverProfile, Finance, LatLng,
  LedgerEntry, RideHistory, RideStatus, RideView, Totals,
} from './types';

/**
 * MOTEUR DE DÉMONSTRATION (aucun backend) : simule la console ORION et les clients pour
 * que l'app Chauffeur soit pleinement utilisable en démo (GitHub Pages, revue de design).
 * Mêmes règles que le backend : validation du dossier, offres avec compte à rebours,
 * commissions (verte réduite), espèces = dette, attente facturée, QCM éco-conduite.
 * L'état est conservé sur l'appareil (localStorage).
 */

const KEY = 'orion.driver.demo';
const DEMO_CODE = '123456';

export const DEMO_DRIVER_CONFIG: DriverConfig = {
  currency: 'XOF',
  offer: { timeoutSec: 12, mode: 'cascade' },
  wait: { freeMinutes: 5, feePerMin: 100 },
  cancel: { graceMinutes: 2, fee: 500 },
  quality: { minRating: 4.5, autoWarn: true },
  commission: { standard: 0.2, green: 0.12, loyalty: 0.1, loyaltyRideThreshold: 1000 },
  cashDebtLimit: 30_000,
  offPeak: { bonus: 500, start: 22, end: 6 },
  longPickup: { thresholdKm: 5, perKm: 100 },
  dispatch: { strategy: 'nearest', greenPriority: false, maxEtaMinutes: 7 },
  zones: [
    { id: 'plateau', name: 'Plateau', lat: 5.3236, lng: -4.0217, radiusKm: 2.5, driverBonus: 0, minStandard: null, waitMaxMin: null, dedicated: false, surgeManual: null },
    { id: 'cocody', name: 'Cocody', lat: 5.3596, lng: -3.9903, radiusKm: 5, driverBonus: 0, minStandard: null, waitMaxMin: null, dedicated: false, surgeManual: null },
    { id: 'aeroport', name: 'Aéroport (Port-Bouët)', lat: 5.2614, lng: -3.9268, radiusKm: 4, driverBonus: 0, minStandard: null, waitMaxMin: null, dedicated: false, surgeManual: null },
    { id: 'riviera-golf', name: 'Riviera Golf', lat: 5.3742, lng: -3.9721, radiusKm: 1.4, driverBonus: 300, minStandard: 'argent', waitMaxMin: 5, dedicated: true, surgeManual: null },
    { id: 'deux-plateaux-vallon', name: 'Deux-Plateaux Vallon', lat: 5.3689, lng: -4.0004, radiusKm: 1.3, driverBonus: 200, minStandard: 'argent', waitMaxMin: 5, dedicated: false, surgeManual: null },
    { id: 'cite-des-arts', name: 'Cocody Centre — Cité des Arts', lat: 5.3488, lng: -3.9962, radiusKm: 1.1, driverBonus: 150, minStandard: null, waitMaxMin: 6, dedicated: false, surgeManual: null },
    { id: 'marcory-zone4', name: 'Marcory Zone 4', lat: 5.2942, lng: -3.9846, radiusKm: 1.6, driverBonus: 150, minStandard: null, waitMaxMin: 6, dedicated: false, surgeManual: null },
  ],
};

const DEMO_APP_CONFIG: AppConfig = {
  city: 'Abidjan', open: true, currency: 'XOF',
  services: { course: true, delivery: true, food: false, shop: false, market: false, colis: false },
  gateways: { orange_money: true, mtn_momo: true, moov_money: true, wave: true, card: true, cash: true },
};

const QCM = [
  { q: 'Pour préserver la batterie, la conduite idéale est…', options: ['Accélérations franches', 'Souple et anticipative', 'Vitesse maximale constante'], answer: 1 },
  { q: 'Le freinage régénératif sert à…', options: ['User les plaquettes', 'Recharger la batterie en décélérant', 'Faire du bruit'], answer: 1 },
  { q: 'Avant une course « Mobilité Verte », je vérifie…', options: ['Mon niveau de batterie (SoC)', 'La radio', 'Rien'], answer: 0 },
  { q: 'Le standard d’accueil ORION impose…', options: ['Téléphone au volant', 'Véhicule propre, salutation, aide bagages', 'Musique forte'], answer: 1 },
];

const CLIENTS = ['Aminata K.', 'Jean-Marc B.', 'Fatou D.', 'Yves A.', 'Mariam T.', 'Olivier N.', 'Salimata C.'];
const PLACES: LatLng[] = [
  { lat: 5.3236, lng: -4.0217 }, { lat: 5.3596, lng: -3.9903 }, { lat: 5.3007, lng: -3.9877 },
  { lat: 5.2925, lng: -4.0027 }, { lat: 5.3644, lng: -4.0225 }, { lat: 5.3456, lng: -4.0864 },
  { lat: 5.2614, lng: -3.9268 }, { lat: 5.3742, lng: -3.9721 },
];
const METHODS = ['cash', 'wave', 'orange_money', 'mtn_momo', 'card'];

interface DemoRide extends RideView {
  events: { type: string; at: string }[];
  clientName: string;
  clientPhone: string;
}

interface DemoState {
  driver: DriverProfile | null;
  phone: string | null;
  ledger: LedgerEntry[];
  rides: DemoRide[];
  activeRideId: string | null;
  offer: { rideId: string; expiresAt: string; timeoutSec: number } | null;
}

const now = () => new Date().toISOString();
const uid = () => Math.random().toString(36).slice(2, 10);
const round50 = (n: number) => Math.round(n / 50) * 50;
const pick = <T,>(arr: T[]): T => arr[Math.floor(Math.random() * arr.length)]!;

function haversine(a: LatLng, b: LatLng): number {
  const R = 6_371_000;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const h = Math.sin(dLat / 2) ** 2 + Math.sin(dLng / 2) ** 2 * Math.cos((a.lat * Math.PI) / 180) * Math.cos((b.lat * Math.PI) / 180);
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

function load(): DemoState {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return JSON.parse(raw) as DemoState;
  } catch { /* état neuf */ }
  return { driver: null, phone: null, ledger: [], rides: [], activeRideId: null, offer: null };
}

export function createDemoBackend(): DriverBackend {
  const st = load();
  const listeners = new Set<(e: DriverEvent) => void>();
  const timers = new Set<number>();
  let lastPos: LatLng = { lat: 5.336, lng: -4.026 };

  const persist = () => { try { localStorage.setItem(KEY, JSON.stringify(st)); } catch { /* ignore */ } };
  const emit = (type: string, data?: unknown) => listeners.forEach((l) => l({ type, data, at: now() }));
  const later = (ms: number, fn: () => void) => {
    const t = window.setTimeout(() => { timers.delete(t); fn(); }, ms);
    timers.add(t);
  };
  const drv = (): DriverProfile => {
    if (!st.driver) throw new ApiError(401, 'Session chauffeur absente — reconnectez-vous');
    return st.driver;
  };
  const driverChanged = () => { persist(); emit('driver.update', { driver: st.driver }); };
  const notify = (title: string, body: string) => emit('notification', { id: uid(), title, body, at: now() });

  const balance = () => st.ledger.reduce((s, e) => s + (e.type === 'commission' ? 0 : e.amount), 0);
  const rate = (d: DriverProfile) => d.commissionOverride
    ?? ((d.engine ?? 'electric') === 'electric'
      ? ((d.electricRides ?? 0) >= DEMO_DRIVER_CONFIG.commission.loyaltyRideThreshold ? DEMO_DRIVER_CONFIG.commission.loyalty : DEMO_DRIVER_CONFIG.commission.green)
      : DEMO_DRIVER_CONFIG.commission.standard);
  const finance = (): Finance => {
    const b = Math.round(balance());
    const debt = b < 0 ? -b : 0;
    return { balance: b, cashDebt: debt, cashDebtLimit: DEMO_DRIVER_CONFIG.cashDebtLimit, cashBlocked: debt > DEMO_DRIVER_CONFIG.cashDebtLimit, commissionRate: rate(drv()), frozen: false };
  };
  const view = (r: DemoRide): RideView => {
    const sum = (types: string[]) => st.ledger.filter((e) => e.rideId === r.id && types.includes(e.type)).reduce((s, e) => s + e.amount, 0);
    const { events: _e, clientName: _n, clientPhone: _p, ...rest } = r;
    return { ...rest, earnings: { net: sum(['ride_earning']), bonus: sum(['adjustment']), commission: -sum(['commission']), cashCollected: -sum(['cash_collected']) } };
  };
  const active = (): ActiveRide | null => {
    const r = st.rides.find((x) => x.id === st.activeRideId);
    if (!r) return null;
    const offer = st.offer && st.offer.rideId === r.id ? { expiresAt: st.offer.expiresAt, timeoutSec: st.offer.timeoutSec } : null;
    return { ...view(r), events: r.events, client: { id: `client-${r.id}`, name: r.clientName, phone: r.clientPhone, rides: 3 + Math.floor(Math.random() * 20) }, pickupZone: null, offer };
  };
  const ledger = (type: LedgerEntry['type'], amount: number, note: string, rideId?: string) => {
    st.ledger.unshift({ id: uid(), type, amount: Math.round(amount), rideId, at: now(), note });
  };
  const setStatus = (r: DemoRide, status: RideStatus) => {
    r.status = status;
    r.updatedAt = now();
    r.events.push({ type: status, at: r.updatedAt });
    persist();
    emit('ride.status', { rideId: r.id, status });
  };

  /** Offre simulée près du chauffeur (si en ligne et libre). */
  const scheduleOffer = (delay = 5000 + Math.random() * 4000) => {
    later(delay, () => {
      const d = st.driver;
      if (!d || d.availability !== 'online' || st.activeRideId) return;
      const origin = { lat: lastPos.lat + (Math.random() - 0.5) * 0.012, lng: lastPos.lng + (Math.random() - 0.5) * 0.012 };
      const destination = pick(PLACES.filter((p) => haversine(p, origin) > 2500)) ?? PLACES[0]!;
      const meters = Math.round(haversine(origin, destination) * 1.3);
      const km = meters / 1000;
      const amount = Math.max(1000, round50((300 + km * 130 + (km / 24) * 60 * 18) * 1.15 * 1.15));
      const ride: DemoRide = {
        id: `demo-${uid()}`, status: 'accepted', serviceType: 'ride', category: d.category, origin, destination, stops: [],
        distanceMeters: meters, etaSeconds: Math.round((km / 24) * 3600), amount, waitMinutes: 0,
        paymentMethod: pick(METHODS), paidAmount: null, earnings: { net: 0, bonus: 0, commission: 0, cashCollected: 0 },
        rating: null, createdAt: now(), updatedAt: now(), events: [{ type: 'accepted', at: now() }],
        clientName: pick(CLIENTS), clientPhone: `+22507${Math.floor(10_000_000 + Math.random() * 89_999_999)}`,
      };
      const timeoutSec = DEMO_DRIVER_CONFIG.offer.timeoutSec;
      st.rides.unshift(ride);
      st.activeRideId = ride.id;
      st.offer = { rideId: ride.id, expiresAt: new Date(Date.now() + timeoutSec * 1000).toISOString(), timeoutSec };
      d.availability = 'on_trip';
      d.offersReceived = (d.offersReceived ?? 0) + 1;
      persist();
      emit('ride.assigned', { ride: view(ride), offer: { expiresAt: st.offer.expiresAt, timeoutSec }, etaToPickupSeconds: 240 });
      emit('driver.update', { driver: d });
      later(timeoutSec * 1000, () => {
        if (st.offer?.rideId !== ride.id) return;
        // Offre expirée : retirée, chauffeur mis en pause (règle backend).
        st.offer = null;
        st.activeRideId = null;
        st.rides = st.rides.filter((x) => x.id !== ride.id);
        d.availability = 'paused';
        d.offersExpired = (d.offersExpired ?? 0) + 1;
        persist();
        emit('ride.withdrawn', { rideId: ride.id, reason: 'expired' });
        driverChanged();
        notify('Offre manquée', 'Vous avez été mis en pause faute de réponse. Repassez en ligne pour recevoir des courses.');
      });
    });
  };

  /** Encaissement : gain net + commission (+ espèces = dette), comme le backend. */
  const settle = (r: DemoRide, method: string) => {
    const d = drv();
    const free = DEMO_DRIVER_CONFIG.wait.freeMinutes;
    const total = r.amount + Math.max(0, r.waitMinutes - free) * DEMO_DRIVER_CONFIG.wait.feePerMin;
    const rt = rate(d);
    const commission = Math.round((total * rt) / 5) * 5;
    ledger('ride_earning', total - commission, 'Gain course (net)', r.id);
    ledger('commission', -commission, `Commission ${Math.round(rt * 100)}%`, r.id);
    if (method === 'cash') ledger('cash_collected', -total, 'Espèces encaissées (commission due à ORION)', r.id);
    r.paymentMethod = method;
    r.paidAmount = total;
    if ((d.engine ?? 'electric') === 'electric') d.electricRides = (d.electricRides ?? 0) + 1;
    d.availability = 'online';
    st.activeRideId = null;
    setStatus(r, 'paid');
    emit('payment.received', { rideId: r.id, amount: total, method });
    driverChanged();
    // Note du client quelques secondes plus tard.
    later(3500, () => {
      const stars = Math.random() < 0.8 ? 5 : 4;
      r.rating = stars;
      setStatus(r, 'rated');
      d.ratingAvg = Math.round(((d.ratingAvg * d.ratingCount + stars) / (d.ratingCount + 1)) * 100) / 100;
      d.ratingCount += 1;
      driverChanged();
    });
    scheduleOffer(9000);
  };

  const totals = (since: number): Totals => {
    const rows = st.rides.filter((r) => r.paidAmount !== null && Date.parse(r.updatedAt) >= since).map(view);
    return {
      rides: rows.length,
      gross: rows.reduce((s, v) => s + (v.paidAmount ?? 0), 0),
      net: rows.reduce((s, v) => s + v.earnings.net + v.earnings.bonus, 0),
      commission: rows.reduce((s, v) => s + v.earnings.commission, 0),
      cashCollected: rows.reduce((s, v) => s + v.earnings.cashCollected, 0),
    };
  };
  const ride = (id: string) => {
    const r = st.rides.find((x) => x.id === id);
    if (!r) throw new ApiError(404, 'Course introuvable');
    return r;
  };

  return {
    live: false,
    session: () => (st.driver ? loadSession() : null),
    logout() {
      timers.forEach((t) => window.clearTimeout(t));
      timers.clear();
      saveSession(null);
    },

    async requestOtp(phone) {
      const digits = phone.replace(/\D/g, '');
      if (digits.length < 8) throw new ApiError(400, 'Numéro de téléphone invalide');
      const full = digits.length === 10 ? `+225${digits}` : `+${digits}`;
      return { phone: full, registered: st.phone === full && st.driver !== null, devCode: DEMO_CODE };
    },
    async verifyOtp(phone, code, name, category) {
      if (code.trim() !== DEMO_CODE) throw new ApiError(401, 'Code incorrect (démo : 123456)');
      const digits = phone.replace(/\D/g, '');
      const full = digits.length === 10 ? `+225${digits}` : `+${digits}`;
      let created = false;
      if (!st.driver || st.phone !== full) {
        if (!name) throw new ApiError(400, 'Indiquez votre nom complet pour créer votre compte chauffeur');
        created = true;
        st.ledger = [];
        st.rides = [];
        st.activeRideId = null;
        st.offer = null;
        st.phone = full;
        st.driver = {
          id: `drv-${uid()}`, name, matricule: `ORION-CI-${Math.floor(1000 + Math.random() * 9000)}`,
          kycStatus: 'draft', availability: 'offline', category: category ?? 'bronze', ratingAvg: 0, ratingCount: 0,
          phone: full, engine: 'electric', batteryPct: 82, appLinkedAt: now(), electricRides: 0,
        };
        // Petit historique de bienvenue (bonus d'activation).
        ledger('adjustment', 2000, 'Bonus de bienvenue ORION');
      }
      persist();
      saveSession({ token: 'demo', driverId: st.driver.id, expiresAt: new Date(Date.now() + 30 * 86_400_000).toISOString() });
      return { driver: st.driver, created };
    },
    async me() { return { driver: drv(), finance: finance() }; },

    appConfig: async () => DEMO_APP_CONFIG,
    driverConfig: async () => DEMO_DRIVER_CONFIG,
    subscribe(onEvent, onLink) {
      listeners.add(onEvent);
      onLink('connecting');
      later(250, () => {
        onLink('online');
        if (!st.driver) return;
        onEvent({ type: 'connected', driver: st.driver, config: DEMO_APP_CONFIG, driverConfig: DEMO_DRIVER_CONFIG, finance: finance(), activeRide: active(), at: now() });
        if (st.driver.availability === 'online' && !st.activeRideId) scheduleOffer();
      });
      return () => { listeners.delete(onEvent); };
    },

    async goOnline(position) {
      const d = drv();
      lastPos = position;
      if (d.kycStatus === 'suspended') throw new ApiError(403, `Compte suspendu par ORION${d.suspensionReason ? ` : ${d.suspensionReason}` : ''}`);
      if (d.kycStatus !== 'approved' && d.kycStatus !== 'active') throw new ApiError(403, 'Dossier en cours de validation par ORION — mise en ligne possible après validation');
      d.availability = st.activeRideId ? 'on_trip' : 'online';
      driverChanged();
      if (!st.activeRideId) scheduleOffer();
    },
    async goOffline() {
      const d = drv();
      d.availability = 'offline';
      driverChanged();
    },
    async sendLocation(position) { lastPos = position; },
    async queue() {
      const d = drv();
      return d.availability === 'online' ? { inQueue: true, position: 2, total: 9 } : { inQueue: false, position: null, total: 9 };
    },
    async telemetry(body) {
      const d = drv();
      if (body.engine) d.engine = body.engine;
      if (body.batteryPct !== undefined) d.batteryPct = Math.round(body.batteryPct);
      if (body.batteryHealthPct !== undefined) d.batteryHealthPct = Math.round(body.batteryHealthPct);
      driverChanged();
    },
    async updateProfile(patch) {
      Object.assign(drv(), patch);
      driverChanged();
    },
    async submitKyc() {
      const d = drv();
      if (d.kycStatus !== 'draft' && d.kycStatus !== 'docs_submitted') throw new ApiError(400, 'Dossier déjà en cours d’examen ou validé');
      const labels: Array<[keyof DriverProfile, string]> = [
        ['phone', 'téléphone'], ['birthDate', 'date de naissance'], ['licenseNo', 'numéro de permis'],
        ['vehicleModel', 'modèle du véhicule'], ['vehiclePlate', 'immatriculation'],
        ['vehicleColor', 'couleur du véhicule'], ['insuranceExpiry', 'échéance de l’assurance'],
      ];
      const missing = labels.filter(([k]) => !d[k]).map(([, l]) => l);
      if (missing.length) throw new ApiError(400, `Dossier incomplet : ${missing.join(', ')}`);
      d.kycStatus = 'docs_submitted';
      driverChanged();
      // Démo : la « console » valide le dossier quelques secondes plus tard.
      later(6000, () => {
        if (!st.driver || st.driver.kycStatus !== 'docs_submitted') return;
        st.driver.kycStatus = 'active';
        driverChanged();
        notify('Dossier validé ✅', 'ORION a validé votre dossier. Vous pouvez passer en ligne.');
      });
      return d;
    },

    async history(): Promise<RideHistory> {
      const today = new Date();
      const start = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());
      const views = st.rides.map(view);
      return { rides: views.slice(0, 50), total: views.length, today: totals(start), week: totals(start - 6 * 86_400_000), finance: finance() };
    },
    activeRide: async () => active(),
    async acceptOffer(rideId) {
      if (!st.offer || st.offer.rideId !== rideId) throw new ApiError(409, 'Cette offre n’est plus d’actualité');
      st.offer = null;
      const d = drv();
      d.offersAccepted = (d.offersAccepted ?? 0) + 1;
      ride(rideId).events.push({ type: 'driver_confirmed', at: now() });
      driverChanged();
      return active();
    },
    async declineOffer(rideId) {
      if (!st.offer || st.offer.rideId !== rideId) throw new ApiError(409, 'Cette offre n’est plus d’actualité');
      const d = drv();
      st.offer = null;
      st.activeRideId = null;
      st.rides = st.rides.filter((x) => x.id !== rideId);
      d.availability = 'online';
      d.offersDeclined = (d.offersDeclined ?? 0) + 1;
      driverChanged();
      emit('ride.withdrawn', { rideId, reason: 'declined' });
      scheduleOffer(8000);
    },
    async transition(rideId, to) {
      const r = ride(rideId);
      const allowed: Record<string, RideStatus[]> = {
        accepted: ['driver_en_route', 'cancelled'], driver_en_route: ['arrived', 'cancelled'],
        arrived: ['in_progress', 'cancelled'], in_progress: ['completed'],
      };
      if (!allowed[r.status]?.includes(to)) throw new ApiError(409, `Transition interdite : ${r.status} → ${to}`);
      setStatus(r, to);
      if (to === 'cancelled') {
        st.activeRideId = null;
        st.offer = null;
        drv().availability = 'online';
        driverChanged();
        scheduleOffer(9000);
      }
      // Paiement électronique : le client règle depuis son app.
      if (to === 'completed' && r.paymentMethod && r.paymentMethod !== 'cash') later(2500, () => settle(r, r.paymentMethod!));
    },
    async wait(rideId, minutes) {
      const r = ride(rideId);
      if (r.status !== 'in_progress' && r.status !== 'arrived') throw new ApiError(400, 'L’attente ne se facture qu’en course (ou à l’arrivée)');
      r.waitMinutes += Math.round(minutes);
      persist();
      const free = DEMO_DRIVER_CONFIG.wait.freeMinutes;
      const billable = Math.max(0, r.waitMinutes - free);
      return { waitMinutes: r.waitMinutes, freeMinutes: free, billableMinutes: billable, waitFee: billable * DEMO_DRIVER_CONFIG.wait.feePerMin, perMinute: DEMO_DRIVER_CONFIG.wait.feePerMin };
    },
    async collectCash(rideId) {
      const r = ride(rideId);
      if (r.status !== 'completed') throw new ApiError(400, 'La course doit être terminée avant paiement');
      settle(r, 'cash');
    },
    async sos() {
      notify('Alerte SOS transmise 🚨', 'Le poste de supervision ORION et le SAMU (185) sont prévenus. Restez en sécurité.');
    },

    async wallet() { return { balance: Math.round(balance()), currency: 'XOF', history: [...st.ledger] }; },
    async payout(amount) {
      if (amount <= 0) throw new ApiError(400, 'Montant de retrait invalide');
      if (amount > balance()) throw new ApiError(400, 'Solde insuffisant');
      ledger('payout', -amount, 'Retrait mobile money');
      persist();
    },
    training: async () => ({ title: 'Standards ORION & éco-conduite', videoUrl: '', questions: QCM.map(({ q, options }) => ({ q, options })), passScore: 3 }),
    async submitTraining(answers) {
      const score = QCM.reduce((s, item, i) => s + (answers[i] === item.answer ? 1 : 0), 0);
      const passed = score >= 3;
      if (passed) { drv().trained = true; driverChanged(); }
      return { score, total: QCM.length, passed, trained: drv().trained ?? false };
    },
    announcements: async (): Promise<Announcement[]> => [
      { id: 'demo-1', title: 'Bienvenue sur ORION Chauffeur', body: 'Mode démo : les offres et la console sont simulées. Code de connexion : 123456.', at: now() },
    ],
    demand: async (): Promise<DemandCell[]> => PLACES.slice(0, 6).map((p, i) => ({
      cell: `demo-${i}`, lat: p.lat, lng: p.lng, demand: 2 + ((i * 3) % 7), supply: 1 + (i % 3), surge: i % 3 === 0 ? 1.3 : 1,
    })),
  };
}
