import type { AppConfig } from '../api';
import type { DriverBackend } from './backend';
import { ApiError } from './errors';
import { saveSession, loadSession } from './session';
import { Capacitor } from '@capacitor/core';
import {
  clientRecent, etatBus, majChauffeur, majCourse, type CourseBus, type FicheChauffeurBus, type StatutBus,
} from '../busTest';
import type { SosSuivi } from '../api';
import type {
  EtapeLocation, LocationChauffeur, MessagesChef, Poste, RequeteVue,
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
  /**
   * Course venue de l'app client du même téléphone (serveur de test partagé) : son code de
   * prise en charge, à vérifier au démarrage. Absent pour une course simulée.
   */
  bus?: { code: string };
  /** Part prise en charge par l'abonnement du client (démo : une course sur six). */
  couvert?: number;
}

interface DemoState {
  driver: DriverProfile | null;
  phone: string | null;
  ledger: LedgerEntry[];
  rides: DemoRide[];
  activeRideId: string | null;
  offer: { rideId: string; expiresAt: string; timeoutSec: number } | null;
  /* --- Alignement écosystème (champs absents des anciens états : complétés au chargement) --- */
  requetes?: RequeteVue[];
  messages?: MessagesChef['messages'];
  rapports?: MessagesChef['rapports'];
  rentals?: LocationChauffeur[];
  photo?: string | null;
  sos?: SosSuivi[];
  /** Mot de passe console choisi depuis l'app (démo : seul le fait compte, jamais le mot de passe). */
  mdpConsoleChoisi?: boolean;
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
  /** Abonnés au suivi d'une alerte SOS (démo). */
  const sosEcoutes = new Map<string, Set<(s: SosSuivi) => void>>();
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
  /** Même calcul que le serveur : prix fixe + attente facturée − part de l'abonnement. */
  const encaissement = (r: DemoRide) => {
    const attente = Math.max(0, r.waitMinutes - DEMO_DRIVER_CONFIG.wait.freeMinutes) * DEMO_DRIVER_CONFIG.wait.feePerMin;
    const brut = r.amount + attente;
    const prisEnCharge = Math.min(brut, r.couvert ?? 0);
    return { brut, attente, prisEnCharge, aEncaisser: brut - prisEnCharge, abonnement: r.couvert ? { plan: 'ORION Confort', raison: 'Course incluse dans le forfait du client' } : null };
  };
  const view = (r: DemoRide): RideView => {
    const sum = (types: string[]) => st.ledger.filter((e) => e.rideId === r.id && types.includes(e.type)).reduce((s, e) => s + e.amount, 0);
    const { events: _e, clientName: _n, clientPhone: _p, couvert: _c, bus: _b, ...rest } = r;
    return {
      ...rest, encaissement: encaissement(r), liberee: false,
      // Course de l'app client : le chauffeur démarre avec le code affiché chez le passager.
      ...(r.bus ? { codeRequis: true } : {}),
      earnings: { net: sum(['ride_earning']), bonus: sum(['adjustment']), commission: -sum(['commission']), cashCollected: -sum(['cash_collected']) },
    };
  };
  const active = (): ActiveRide | null => {
    const r = st.rides.find((x) => x.id === st.activeRideId);
    if (!r) return null;
    const offer = st.offer && st.offer.rideId === r.id ? { expiresAt: st.offer.expiresAt, timeoutSec: st.offer.timeoutSec } : null;
    return { ...view(r), events: r.events, client: { id: `client-${r.id}`, name: r.clientName.split(' ')[0] ?? r.clientName, phone: r.clientPhone, rides: 3 + Math.floor(Math.random() * 20), photo: null }, pickupZone: null, offer };
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
      // Relié à l'app client (serveur de test) : seules ses vraies commandes arrivent.
      if (modeTest) { scheduleOffer(20_000); return; }
      const origin = { lat: lastPos.lat + (Math.random() - 0.5) * 0.012, lng: lastPos.lng + (Math.random() - 0.5) * 0.012 };
      const destination = pick(PLACES.filter((p) => haversine(p, origin) > 2500)) ?? PLACES[0]!;
      const meters = Math.round(haversine(origin, destination) * 1.3);
      const km = meters / 1000;
      const amount = Math.max(1000, round50((300 + km * 130 + (km / 24) * 60 * 18) * 1.15 * 1.15));
      const ride: DemoRide = {
        id: `demo-${uid()}`, status: 'accepted', serviceType: 'ride', category: d.category, origin, destination, stops: [],
        distanceMeters: meters, etaSeconds: Math.round((km / 24) * 3600), amount, waitMinutes: 0,
        paymentMethod: pick(METHODS), paidAmount: null, earnings: { net: 0, bonus: 0, commission: 0, cashCollected: 0 },
        couvert: Math.random() < 1 / 6 ? amount : undefined,
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
    void free;
    const { brut: total, aEncaisser } = encaissement(r);
    const rt = rate(d);
    const commission = Math.round((total * rt) / 5) * 5;
    ledger('ride_earning', total - commission, 'Gain course (net)', r.id);
    ledger('commission', -commission, `Commission ${Math.round(rt * 100)}%`, r.id);
    if (method === 'cash' && aEncaisser > 0) ledger('cash_collected', -aEncaisser, 'Espèces encaissées (commission due à ORION)', r.id);
    r.paymentMethod = method;
    r.paidAmount = aEncaisser;
    if ((d.engine ?? 'electric') === 'electric') d.electricRides = (d.electricRides ?? 0) + 1;
    d.availability = 'online';
    st.activeRideId = null;
    setStatus(r, 'paid');
    emit('payment.received', { rideId: r.id, amount: aEncaisser, method });
    driverChanged();
    versBus(r, { statut: 'payee', paiementRegle: method });
    publierPresence(true);
    // Note du client quelques secondes plus tard (course de test : c'est le vrai client qui note).
    if (!r.bus) later(3500, () => {
      const stars = Math.random() < 0.8 ? 5 : 4;
      r.rating = stars;
      setStatus(r, 'rated');
      emit('ride.rated', { rideId: r.id, stars, tags: stars === 5 ? ['#Courtoisie'] : [] });
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
      // Brut = ce qui rémunère le chauffeur (net + commission), même couvert par un abonnement.
      gross: rows.reduce((s, v) => s + v.earnings.net + v.earnings.commission, 0),
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

  /* ===================== SERVEUR DE TEST PARTAGÉ (voir ../busTest.ts) =====================
   * Avec l'app client ORION sur le même téléphone (ou un onglet client sur la page
   * partagée), les courses ne sont plus simulées : celles que le client commande arrivent
   * ici, et chaque geste du chauffeur (accepter, arriver, démarrer, terminer) lui revient.
   */
  let modeTest = false;
  const refusees = new Set<string>();
  const fiche = (d: DriverProfile): FicheChauffeurBus => ({
    id: d.id, nom: d.name, matricule: d.matricule, gamme: d.category,
    vehicule: d.vehicleModel ?? '', plaque: d.vehiclePlate ?? '', couleur: d.vehicleColor ?? '',
    telephone: d.phone ?? st.phone ?? '', note: d.ratingAvg || 5, nbCourses: d.ratingCount,
  });
  let presenceEcrite = 0;
  const publierPresence = (forcer = false) => {
    const d = st.driver;
    if (!d || (!forcer && Date.now() - presenceEcrite < 4000)) return;
    presenceEcrite = Date.now();
    void majChauffeur({ ...fiche(d), enLigne: d.availability === 'online' || d.availability === 'on_trip', occupe: Boolean(st.activeRideId), position: lastPos });
  };
  const STATUT_BUS: Partial<Record<RideStatus, StatutBus>> = { arrived: 'arrivee', in_progress: 'en_cours', completed: 'terminee', paid: 'payee' };
  const versBus = (r: DemoRide, patch: Partial<CourseBus>) => { if (r.bus) void majCourse(r.id, patch); };

  /** Une course commandée dans l'app client devient une offre, comme celles de la console. */
  const offrirCourseBus = (c: CourseBus) => {
    const d = st.driver;
    if (!d) return;
    const timeoutSec = Math.max(5, Math.round(((c.offreJusqua ?? Date.now() + 60_000) - Date.now()) / 1000));
    const r: DemoRide = {
      id: c.id, status: 'accepted', serviceType: 'ride', category: c.gamme, origin: { lat: c.origine.lat, lng: c.origine.lng },
      destination: { lat: c.destination.lat, lng: c.destination.lng }, stops: c.arrets.map((a) => ({ lat: a.lat, lng: a.lng })),
      distanceMeters: c.distanceMetres, etaSeconds: c.dureeSecondes, amount: c.montant, waitMinutes: 0,
      paymentMethod: c.paiement, paidAmount: null, earnings: { net: 0, bonus: 0, commission: 0, cashCollected: 0 },
      rating: null, createdAt: now(), updatedAt: now(), events: [{ type: 'accepted', at: now() }],
      clientName: c.client.nom || 'Client ORION', clientPhone: c.client.telephone || '', bus: { code: c.code },
      // Choix du client : pont à péage ou voie normale ; chauffeur à l'heure.
      ...(c.itineraire ? { itineraire: c.itineraire } : {}),
      ...(c.miseADisposition ? { miseADisposition: c.miseADisposition } : {}),
    };
    st.rides = [r, ...st.rides.filter((x) => x.id !== r.id)];
    st.activeRideId = r.id;
    st.offer = { rideId: r.id, expiresAt: new Date(Date.now() + timeoutSec * 1000).toISOString(), timeoutSec };
    d.availability = 'on_trip';
    d.offersReceived = (d.offersReceived ?? 0) + 1;
    persist();
    publierPresence(true);
    emit('ride.assigned', { ride: view(r), offer: { expiresAt: st.offer.expiresAt, timeoutSec }, etaToPickupSeconds: 240 });
    emit('driver.update', { driver: d });
    notify('Nouvelle course', `${r.clientName} · ${c.origine.nom} → ${c.destination.nom}`);
    later(timeoutSec * 1000, () => {
      if (st.offer?.rideId !== r.id) return;
      st.offer = null;
      st.activeRideId = null;
      st.rides = st.rides.filter((x) => x.id !== r.id);
      d.availability = 'online';
      d.offersExpired = (d.offersExpired ?? 0) + 1;
      persist();
      void majCourse(r.id, { statut: 'expiree' });
      emit('ride.withdrawn', { rideId: r.id, reason: 'expired' });
      driverChanged();
      publierPresence(true);
    });
  };

  /** Le client a annulé : la course quitte l'écran du chauffeur. */
  const clientAAnnule = (r: DemoRide) => {
    const d = st.driver;
    st.activeRideId = null;
    st.offer = null;
    st.rides = st.rides.filter((x) => x.id !== r.id);
    if (d) d.availability = 'online';
    persist();
    emit('ride.withdrawn', { rideId: r.id, reason: 'client_annule' });
    driverChanged();
    publierPresence(true);
    notify('Course annulée', 'Le client a annulé la course.');
  };

  const surveiller = async () => {
    const d = st.driver;
    if (!d) return;
    const etat = await etatBus();
    const natif = Capacitor.isNativePlatform();
    // Sur le téléphone : l'app client est installée (registre joignable). Sur la page
    // partagée : un onglet client a été ouvert depuis moins de 30 minutes.
    modeTest = etat.disponible && (natif || etat.clients.some(clientRecent));
    if (!etat.disponible) return;
    // Relié à l'app client : une offre simulée encore sans réponse (arrivée avant que l'app
    // client soit ouverte) laisse la place aux vraies commandes, sans pénalité pour le chauffeur.
    if (modeTest && st.offer && !st.rides.find((x) => x.id === st.offer!.rideId)?.bus) {
      const id = st.offer.rideId;
      st.offer = null;
      st.activeRideId = null;
      st.rides = st.rides.filter((x) => x.id !== id);
      d.availability = 'online';
      persist();
      emit('ride.withdrawn', { rideId: id, reason: 'expired' });
      driverChanged();
      publierPresence(true);
    }
    publierPresence();
    const active = st.rides.find((x) => x.id === st.activeRideId);
    if (active?.bus) {
      const c = etat.courses.find((x) => x.id === active.id);
      if (c?.statut === 'annulee' && c.annuleePar === 'client') clientAAnnule(active);
      // Le client a réglé dans son application (Wave, Orange Money, carte…).
      else if (active.status === 'completed' && c?.paiementRegle && c.paiementRegle !== 'cash') settle(active, c.paiementRegle);
    } else if (!st.activeRideId && (d.availability === 'online')) {
      const c = etat.courses.find((x) => x.statut === 'demandee' && (!x.chauffeurId || x.chauffeurId === d.id)
        && (x.offreJusqua ?? 0) > Date.now() && !refusees.has(x.id));
      if (c) offrirCourseBus(c);
    }
    // Note donnée par le client après la course.
    for (const r of st.rides) {
      if (!r.bus || r.rating !== null || (r.status !== 'paid' && r.status !== 'completed')) continue;
      const c = etat.courses.find((x) => x.id === r.id);
      if (!c?.note) continue;
      r.rating = c.note;
      setStatus(r, 'rated');
      emit('ride.rated', { rideId: r.id, stars: c.note, tags: [] });
      d.ratingAvg = Math.round(((d.ratingAvg * d.ratingCount + c.note) / (d.ratingCount + 1)) * 100) / 100;
      d.ratingCount += 1;
      driverChanged();
    }
  };
  window.setInterval(() => { void surveiller(); }, 1500);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') void surveiller(); });
  void surveiller();

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
    async appairerEcran(code: string) {
      if (code.trim() !== DEMO_CODE) throw new ApiError(401, 'Code d\'appairage incorrect (démo : 123456)');
      if (!st.driver) throw new ApiError(401, 'Aucun chauffeur en démonstration');
      return { driverId: st.driver.id };
    },
    async codeEcranVehicule() {
      return { code: DEMO_CODE, expireLe: new Date(now() + 180_000).toISOString(), dureeSecondes: 180 };
    },
    async annulerCodeEcranVehicule() { /* démo : rien à annuler */ },
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
          kycStatus: 'draft', availability: 'offline', category: category ?? 'argent', ratingAvg: 0, ratingCount: 0,
          phone: full, engine: 'electric', batteryPct: 82, appLinkedAt: now(), electricRides: 0,
        };
        // Petit historique de bienvenue (bonus d'activation).
        ledger('adjustment', 2000, 'Bonus de bienvenue ORION');
        st.requetes = [];
        st.rapports = [];
        st.photo = null;
        st.sos = [];
        // Démo : le chef d'équipe souhaite la bienvenue, une location Signature est prévue.
        st.messages = [{
          id: `msg-${uid()}`, de: 'serge.kone', deNom: 'Serge Koné (chef d’équipe)', texte: 'Bienvenue dans l’équipe Plateau ! Passe au bureau quand ton dossier est validé.',
          urgent: false, reponseAttendue: true, at: now(), reponses: [],
        }];
        st.rentals = [{
          id: `loc-${uid()}`, formula: 'evenement', duree: 'journee', heuresService: 10,
          vehicle: { id: 'maextro-s800', name: 'Huawei Maextro S800', marque: 'Huawei', classe: 'Berline prestige', places: 4, autonomieKm: 702 },
          debut: new Date(Date.now() + 3 * 86_400_000).toISOString(), fin: new Date(Date.now() + 4 * 86_400_000).toISOString(),
          lieu: 'Église Sainte-Jeanne-d’Arc, Cocody', contact: { nom: 'Aya Konan', telephone: '+2250102030405' }, societe: null,
          status: 'confirmee', options: { decoration: true, tapisRouge: true, rafraichissements: true, cortege: 0, hotesses: 0 },
          jourJ: false, kmInclus: 100, secondChauffeurRequis: false, etapes: [],
        }];
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
      publierPresence(true);
      if (!st.activeRideId) scheduleOffer();
    },
    async goOffline() {
      const d = drv();
      d.availability = 'offline';
      driverChanged();
      publierPresence(true);
    },
    async sendLocation(position) { lastPos = position; publierPresence(); },
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
        notify('Dossier validé', 'ORION a validé votre dossier. Vous pouvez passer en ligne.');
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
      const r = ride(rideId);
      r.events.push({ type: 'driver_confirmed', at: now() });
      driverChanged();
      // Course de l'app client : le client voit le chauffeur et son véhicule, pour de vrai.
      if (r.bus) await majCourse(r.id, { statut: 'acceptee', chauffeurId: d.id, chauffeur: fiche(d) });
      publierPresence(true);
      return active();
    },
    async declineOffer(rideId) {
      if (!st.offer || st.offer.rideId !== rideId) throw new ApiError(409, 'Cette offre n’est plus d’actualité');
      const d = drv();
      const refuseeBus = Boolean(st.rides.find((x) => x.id === rideId)?.bus);
      st.offer = null;
      st.activeRideId = null;
      st.rides = st.rides.filter((x) => x.id !== rideId);
      d.availability = 'online';
      d.offersDeclined = (d.offersDeclined ?? 0) + 1;
      driverChanged();
      if (refuseeBus) { refusees.add(rideId); void majCourse(rideId, { statut: 'refusee' }); }
      publierPresence(true);
      emit('ride.withdrawn', { rideId, reason: 'declined' });
      scheduleOffer(8000);
    },
    async start(rideId, code) {
      if (!/^\d{4}$/.test(code)) throw new ApiError(400, 'Le code compte 4 chiffres');
      // Course de l'app client : le code est celui affiché chez le passager. (Course simulée :
      // le passager fictif donne toujours un code valide.)
      const r = ride(rideId);
      if (r.bus && code !== r.bus.code) throw new ApiError(400, 'Code incorrect : demandez au passager le code affiché dans son application.');
      await this.transition(rideId, 'in_progress');
      versBus(r, { codeVerifie: true });
    },
    async transition(rideId, to) {
      const r = ride(rideId);
      const allowed: Record<string, RideStatus[]> = {
        accepted: ['driver_en_route', 'cancelled'], driver_en_route: ['arrived', 'cancelled'],
        arrived: ['in_progress', 'cancelled'], in_progress: ['completed'],
      };
      if (!allowed[r.status]?.includes(to)) throw new ApiError(409, `Transition interdite : ${r.status} → ${to}`);
      setStatus(r, to);
      const statutBus = to === 'cancelled' ? 'annulee' : STATUT_BUS[to];
      if (statutBus) versBus(r, { statut: statutBus, ...(to === 'cancelled' ? { annuleePar: 'chauffeur' as const } : {}) });
      if (to === 'cancelled') {
        st.activeRideId = null;
        st.offer = null;
        drv().availability = 'online';
        driverChanged();
        scheduleOffer(9000);
      }
      // Paiement électronique : le client règle depuis son app. Course de l'app client du
      // même téléphone : on attend son vrai paiement (voir surveiller), sans rien simuler.
      if (to === 'completed' && r.paymentMethod && r.paymentMethod !== 'cash' && !r.bus) later(2500, () => settle(r, r.paymentMethod!));
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
    // SOS : même circuit que la console. Rien n'est annoncé avant d'avoir eu lieu —
    // la prise en charge et les messages de l'agent arrivent quand l'agent agit.
    async sos(rideId, position, note) {
      const a: SosSuivi = {
        id: `sos-${uid()}`, kind: 'sos', status: 'raised', createdAt: now(), location: position, zoneName: 'Abidjan',
        priseEnCharge: null, chat: note ? [{ from: 'usager', text: note, at: now() }] : [], secours: [], clotureeA: null,
      } as SosSuivi;
      st.sos = [a, ...(st.sos ?? [])].slice(0, 10);
      persist();
      void rideId;
      const pousser = () => { persist(); sosEcoutes.get(a.id)?.forEach((f) => f({ ...a, chat: [...a.chat], secours: [...a.secours] })); };
      later(3000, () => { a.status = 'acknowledged'; a.priseEnCharge = { agent: 'Céline', at: now() }; pousser(); });
      later(5500, () => { a.chat.push({ from: 'agent', author: 'Céline', text: 'Je suis avec vous. Pouvez-vous me dire ce qui se passe ?', at: now() }); pousser(); });
      return a.id;
    },
    async sosSuivi(alertId) { return (st.sos ?? []).find((a) => a.id === alertId) ?? null; },
    async sosRepondre(alertId, text) {
      const a = (st.sos ?? []).find((x) => x.id === alertId);
      if (!a) return null;
      a.chat.push({ from: 'usager', text, at: now() });
      persist();
      sosEcoutes.get(a.id)?.forEach((f) => f({ ...a, chat: [...a.chat] }));
      return a;
    },
    sosSubscribe(alertId, onSuivi, onLink) {
      const set = sosEcoutes.get(alertId) ?? new Set();
      set.add(onSuivi);
      sosEcoutes.set(alertId, set);
      onLink(true);
      const a = (st.sos ?? []).find((x) => x.id === alertId);
      if (a) onSuivi(a);
      return () => { set.delete(onSuivi); };
    },
    async cancelRide(rideId, motif) {
      const r = ride(rideId);
      if (!['accepted', 'driver_en_route', 'arrived'].includes(r.status)) throw new ApiError(400, 'La course est en cours : terminez-la, ou utilisez le SOS en cas de danger.');
      if (motif === 'client_absent') {
        const arrivee = [...r.events].reverse().find((e) => e.type === 'arrived');
        const min = arrivee ? (Date.now() - Date.parse(arrivee.at)) / 60_000 : 0;
        if (r.status !== 'arrived' || min < DEMO_DRIVER_CONFIG.wait.freeMinutes) {
          throw new ApiError(400, `« Client absent » : possible après ${DEMO_DRIVER_CONFIG.wait.freeMinutes} min d’attente au point de prise en charge.`);
        }
      }
      const d = drv();
      if (motif !== 'securite') d.cancellations = (d.cancellations ?? 0) + 1;
      versBus(r, { statut: 'annulee', annuleePar: 'chauffeur', motif });
      st.activeRideId = null;
      st.offer = null;
      st.rides = st.rides.filter((x) => x.id !== rideId);
      d.availability = motif === 'vehicule_panne' ? 'offline' : 'online';
      driverChanged();
      emit('ride.withdrawn', { rideId, reason: 'chauffeur_annule' });
      if (d.availability === 'online') scheduleOffer(9000);
      return motif === 'client_absent' ? { reattribuee: false, frais: DEMO_DRIVER_CONFIG.cancel.fee } : { reattribuee: true, frais: 0 };
    },
    async settleCovered(rideId) {
      const r = ride(rideId);
      if (r.status !== 'completed') throw new ApiError(400, 'La course doit être terminée avant paiement');
      settle(r, 'card');
    },

    async rentals() { return [...(st.rentals ?? [])]; },
    async rentalStep(rentalId, etape: EtapeLocation, note) {
      const r = (st.rentals ?? []).find((x) => x.id === rentalId);
      if (!r) throw new ApiError(404, 'Location introuvable');
      if (r.etapes.some((e) => e.etape === etape)) throw new ApiError(409, 'Étape déjà déclarée');
      if (etape === 'fin_service' && !r.etapes.some((e) => e.etape === 'debut_service')) throw new ApiError(400, 'Déclarez d’abord le début de service');
      r.etapes.push({ etape, at: now(), note: note ?? null });
      if (etape === 'debut_service') r.status = 'en_cours';
      if (etape === 'fin_service') r.status = 'terminee';
      persist();
      return { ...r, etapes: [...r.etapes] };
    },
    async poste(): Promise<Poste> {
      const d = drv();
      const payees = st.rides.filter((r) => r.paidAmount !== null);
      const notes = st.rides.map((r) => r.rating).filter((n): n is number => n !== null);
      const b = Math.round(balance());
      return {
        activite: {
          periodeJours: 30, courses: payees.length, coursesAnnulees: d.cancellations ?? 0,
          kilometres: Math.round(payees.reduce((n, r) => n + r.distanceMeters, 0) / 1000),
          revenus: st.ledger.filter((e) => e.type === 'ride_earning').reduce((n, e) => n + e.amount, 0),
          commissionVersee: -st.ledger.filter((e) => e.type === 'commission').reduce((n, e) => n + e.amount, 0),
          noteMoyenne: notes.length ? Math.round((notes.reduce((a, n) => a + n, 0) / notes.length) * 10) / 10 : d.ratingAvg,
          nbNotes: notes.length, joursTravailles: new Set(payees.map((r) => r.createdAt.slice(0, 10))).size,
        },
        argent: {
          solde: b, detteEspeces: b < 0 ? -b : 0, plafondDette: DEMO_DRIVER_CONFIG.cashDebtLimit,
          resteDu: (st.requetes ?? []).filter((r) => (r.type === 'pret' || r.type === 'avance') && r.statut === 'versee').reduce((n, r) => n + (r.montantAccorde ?? 0) - r.rembourse, 0),
        },
        equipe: { name: 'Équipe Plateau', mission: 'Secteur Plateau & Adjamé', chef: 'Serge Koné', chefTelephone: '+2250700000001' },
        acces: { identifiant: d.name.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, '.'), actif: true, aChangerMotDePasse: !st.mdpConsoleChoisi },
        requetes: [...(st.requetes ?? [])],
        litiges: [],
        maintenance: [],
        alertes: d.insuranceExpiry && Date.parse(d.insuranceExpiry) < Date.now() ? [{ severite: 'critique', texte: 'Assurance expirée — le passager n’est pas couvert.' }] : [],
        typesRequete: [
          { code: 'pret', label: 'Prêt', financiere: true }, { code: 'avance', label: 'Avance sur revenus', financiere: true },
          { code: 'conge', label: 'Congé', financiere: false }, { code: 'materiel', label: 'Matériel', financiere: true },
          { code: 'reparation', label: 'Réparation', financiere: true }, { code: 'reclamation', label: 'Réclamation', financiere: false },
          { code: 'document', label: 'Document administratif', financiere: false },
        ],
        plafonds: { avance: 150_000, pret: 1_000_000, echeancesMax: 12 },
        messagesNonLus: (st.messages ?? []).filter((m) => !m.luLe).length,
      };
    },
    async deposerRequete(input) {
      const financiere = ['pret', 'avance', 'materiel', 'reparation'].includes(input.type);
      if (financiere && !input.montant) throw new ApiError(400, 'Indiquez le montant demandé.');
      if (input.type === 'avance' && (input.montant ?? 0) > 150_000) throw new ApiError(400, 'Montant au-dessus du plafond (avance 150 000 F, prêt 1 000 000 F).');
      if (input.type === 'pret' && (input.montant ?? 0) > 1_000_000) throw new ApiError(400, 'Montant au-dessus du plafond (avance 150 000 F, prêt 1 000 000 F).');
      if (input.type === 'conge' && (!input.du || !input.au)) throw new ApiError(400, 'Indiquez les dates du congé (du … au …)');
      const labels: Record<string, string> = { pret: 'Prêt', avance: 'Avance sur revenus', conge: 'Congé', materiel: 'Matériel', reparation: 'Réparation', reclamation: 'Réclamation', document: 'Document administratif' };
      const r: RequeteVue = {
        id: uid().slice(0, 8), type: input.type, typeLabel: labels[input.type] ?? input.type, statut: 'deposee', statutLabel: 'Déposée',
        montant: input.montant ?? null, montantAccorde: null, echeances: input.type === 'pret' ? (input.echeances ?? 3) : null,
        du: input.du ?? null, au: input.au ?? null, motif: input.motif, createdAt: now(),
        instruiteLe: null, decideLe: null, decisionNote: null, verseLe: null, canalVersement: null, plan: null, rembourse: 0, clotureLe: null,
      };
      st.requetes = [r, ...(st.requetes ?? [])];
      persist();
      emit('crew.request', { requete: r, evenement: 'depot' });
      // Démo : le circuit console avance tout seul (chef, puis direction financière).
      later(5000, () => { r.statut = 'instruite'; r.statutLabel = 'Instruite par le chef d’équipe'; r.instruiteLe = now(); persist(); emit('crew.request', { requete: r, evenement: 'instruction' }); });
      later(10_000, () => {
        r.statut = 'accordee'; r.statutLabel = 'Accordée'; r.decideLe = now(); r.montantAccorde = r.montant; r.decisionNote = 'Accord de la direction financière';
        persist();
        emit('crew.request', { requete: r, evenement: 'accord' });
        notify('Votre requête ORION', `Requête ${r.id} accordée.`);
      });
      return r;
    },
    async messages(): Promise<MessagesChef> {
      const m = st.messages ?? [];
      return { messages: [...m], rapports: [...(st.rapports ?? [])], nonLus: m.filter((x) => !x.luLe).length, identifiant: 'demo' };
    },
    async lireMessage(mid) { const m = (st.messages ?? []).find((x) => x.id === mid); if (m && !m.luLe) { m.luLe = now(); persist(); } },
    async repondreMessage(mid, texte) {
      const m = (st.messages ?? []).find((x) => x.id === mid);
      if (!m) throw new ApiError(404, 'Message introuvable');
      m.reponses.push({ de: 'moi', deNom: drv().name, texte, at: now() });
      persist();
    },
    async definirMotDePasseConsole(motDePasse) {
      if (motDePasse.length < 10) throw new ApiError(400, 'Au moins 10 caractères');
      st.mdpConsoleChoisi = true;
      persist();
      return { identifiant: drv().name.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, '.') };
    },
    async rendreRapport(rid, texte) {
      const r = (st.rapports ?? []).find((x) => x.id === rid);
      if (!r) throw new ApiError(404, 'Rapport introuvable');
      r.statut = 'rendu'; r.statutLabel = 'Rendu, en attente de lecture'; r.rendu = { texte, at: now() };
      persist();
    },
    async setPhoto(dataUrl) { st.photo = dataUrl; drv().photoUpdatedAt = now(); driverChanged(); return dataUrl; },
    async deletePhoto() { st.photo = null; delete drv().photoUpdatedAt; driverChanged(); },
    photoSrc: (d) => (d.photoUpdatedAt ? st.photo ?? null : null),

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
