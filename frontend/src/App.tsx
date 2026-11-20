import { useEffect, useMemo, useRef, useState } from 'react';
import { Capacitor } from '@capacitor/core';
import { App as AppNative } from '@capacitor/app';
import { OrionMap } from './components/OrionMap';
import { Sheet, TopBar, Toast } from './components/ui';
import {
  IconBell, IconBolt, IconBriefcase, IconCalendar, IconCamera, IconCar, IconCheck, IconChevron, IconClock, IconCrown,
  IconFingerprint, IconGem, IconGlobe, IconHome, IconLeaf, IconLock, IconMinus,
  IconPhone, IconPin, IconPlane, IconPlus, IconRing, IconSearch, IconSettings, IconShare,
  IconShield, IconShieldCheck, IconMedical, IconStar, IconTraffic, IconWallet, IconWifi,
} from './icons';
import { LogoGlyph } from './components/Logo';
import { IllusFood, IllusShop, IllusMarket, IllusColis } from './components/Illustrations';
import { Voiture, Scooter, vehiculeDeGamme } from './components/Vehicules';
import { AssuranceScreen } from './components/AssuranceScreens';
import { BoutonMessages, ControleSecurite, MessagesScreen, useMessagerie } from './components/MessagesOrion';
import type { MessageOrion } from './api';
import { authenticateBiometric, isBiometricEnabled } from './security';
import type { TrustedContact } from './api';
import { numeroLisible, ouvrirClavier } from './telephone';
import {
  DEFAULT_ORIGIN, DRIVERS, SUB_PLANS, TIERS, WEDDING_DURATION_FACTOR,
  WEDDING_FEES, formatXOF, tierById,
} from './data';
import { urlApi, contactCourse, lireCodePriseEnCharge, AGENT_GENERIQUE, EMERGENCY_NUMBERS, chargerProfil, demanderCode, profilEnCache, seDeconnecter, sessionClient, supprimerCompte, verifierCode, type FraisAnnulation, type ProfilClient, cancelRide, cancelSubscription, clientId, configSocketUrl, createRide, estimateWithCoverage, fetchAppConfig, itineraire, statutAssurance, fetchSubPlans, fetchSubscription, isLiveBackend, listAnnouncements, listSupport, openSupport, estimateDelivery, notifyRentalTariffChange, paySubscriptionInvoice, previewDelivery, previewQuote, rateRide, rideSocketUrl, sos, sosRepondre, sosSocketUrl, sosSuivi, subscribePlan, type Announcement, type AppConfig, type PkgSize, type SafeDriver, type SosSuivi, type SupportMessage } from './api';
import { useI18n } from './i18n';
import type { Driver, LatLng, Place, Quote, Screen, SubCoverage, SubPlan, SubPlanInfo, SubState, TierOption, WeddingDuration } from './types';
import { MyRentalsScreen, RentalScreen } from './components/RentalScreens';
import { ChoixLieu, type ModeChoix } from './components/ChoixLieu';
import { LIEUX_POPULAIRES, enregistrerLieu, lieuEnregistre, lieuxRecents, memoriserRecent, useDepart, type EtatPosition } from './lieux';
import { Avatar, CancelSheet, HistoryScreen, LegalScreen, PhotoScreen, ProfileScreen, SettingsScreen, SosHistoryScreen } from './components/CompteScreens';

const PAYMENTS = [
  { method: 'orange_money', label: 'Orange Money' },
  { method: 'wave', label: 'Wave' },
  { method: 'mtn_momo', label: 'MTN MoMo' },
  { method: 'moov_money', label: 'Moov Money' },
  { method: 'cash', label: 'Espèces' },
  { method: 'card', label: 'Carte' },
];


const lerp = (a: LatLng, b: LatLng, t: number): LatLng => ({
  lat: a.lat + (b.lat - a.lat) * t,
  lng: a.lng + (b.lng - a.lng) * t,
});

const placeIcon = (kind?: Place['kind']) => {
  if (kind === 'home') return <IconHome size={20} />;
  if (kind === 'work') return <IconBriefcase size={20} />;
  if (kind === 'hub') return <IconPlane size={20} />;
  return <IconPin size={20} />;
};

/** Plaque d'immatriculation stable dérivée du matricule ORION (cohérente entre affichages). */
function plateFromMatricule(m: string): string {
  const n = (m.match(/\d+/)?.[0] ?? '0000').padStart(4, '0');
  const L = 'ABCDEFGHJKLMNPRSTUVWXYZ';
  const a = L[Number(n[0]) % L.length]!;
  const b = L[Number(n[1]) % L.length]!;
  return `CI-${n} ${a}${b}`;
}

/** Le véhicule de la gamme (silhouette et peinture : bronze, argent, or, nuit). */
function TierBadge({ tier, size = 50, suv = false }: { tier: string; size?: number; suv?: boolean }) {
  const v = vehiculeDeGamme(tier);
  return (
    <span className="veh-illus" style={{ width: size * 1.75, height: size }}>
      <Voiture modele={suv ? 'suv' : v.modele === 'suv' ? 'berline' : v.modele} peinture={v.peinture} largeur={size * 1.75} phares={false} />
    </span>
  );
}

type TripPhase = 'enroute' | 'arrived' | 'inprogress' | 'completed';

/** Position à la fraction `t` de la longueur d'un tracé (le véhicule suit la route). */
function pointSurTrace(trace: LatLng[], t: number): LatLng {
  if (trace.length < 2) return trace[0]!;
  const d = (a: LatLng, b: LatLng) => Math.hypot(a.lat - b.lat, (a.lng - b.lng) * Math.cos((a.lat * Math.PI) / 180));
  const cumul = [0];
  for (let i = 1; i < trace.length; i += 1) cumul.push(cumul[i - 1]! + d(trace[i - 1]!, trace[i]!));
  const total = cumul[cumul.length - 1]! || 1;
  const cible = Math.min(1, Math.max(0, t)) * total;
  let i = 1;
  while (i < cumul.length - 1 && cumul[i]! < cible) i += 1;
  const f = (cible - cumul[i - 1]!) / ((cumul[i]! - cumul[i - 1]!) || 1);
  return lerp(trace[i - 1]!, trace[i]!, f);
}

export function App() {
  const { t } = useI18n();
  const [screen, setScreen] = useState<Screen>('splash');
  /*
   * POINT DE PRISE EN CHARGE : la vraie position du téléphone (GPS) ou le point choisi
   * par le client. Avant l'audit, toutes les courses partaient du Plateau, affiché
   * « Position actuelle » : un chauffeur aurait été envoyé à la mauvaise adresse.
   */
  const position = useDepart({ maPosition: t('lieu_ma_position') });
  const origin = position.depart.place;
  const departAConfirmer = position.depart.source === 'defaut';
  /** Écran de choix d'un lieu : ce qu'on choisit, et où revenir ensuite. */
  const [choix, setChoix] = useState<{ mode: ModeChoix; retour: Screen } | null>(null);
  /** Livraison : point de dépôt choisi (il survit au passage par le choix du point de retrait). */
  const [depotLivraison, setDepotLivraison] = useState<Place | null>(null);
  const [destination, setDestination] = useState<Place | null>(null);
  const [mode, setMode] = useState<'ride' | 'delivery'>('ride');
  const [pkgSize, setPkgSize] = useState<'petit' | 'moyen' | 'grand'>('moyen');
  const [tier, setTier] = useState<TierOption>(TIERS[0]!);
  const [bodyType, setBodyType] = useState<'suv' | 'berline'>('berline');
  const [stops, setStops] = useState<Place[]>([]);
  const [scheduled, setScheduled] = useState(false);
  const [insurance, setInsurance] = useState(false);
  // ORION Assurance : l'option ne s'active qu'avec un dossier de premiers secours.
  const [assuranceInscrite, setAssuranceInscrite] = useState(false);
  const [assuranceRequise, setAssuranceRequise] = useState(false);
  const [retourAssurance, setRetourAssurance] = useState<Screen>('settings');
  // Messagerie ORION : messages de la supervision, contrôle de sécurité en course.
  const messagerie = useMessagerie();
  const [retourMessages, setRetourMessages] = useState<Screen>('home');
  const [payment, setPayment] = useState<string>('orange_money');
  const [quote, setQuote] = useState<Quote | null>(null);
  /** Nom saisi à l'inscription — enregistré côté serveur après vérification du numéro. */
  const [clientName, setClientName] = useState('');
  /*
   * COMPTE : le profil vérifié (nom, numéro, e-mail, photo). Conservé sur l'appareil
   * avec la session : on ne refait pas l'inscription à chaque ouverture de l'app.
   */
  const [profil, setProfil] = useState<ProfilClient | null>(() => (sessionClient() ? profilEnCache() : null));
  useEffect(() => {
    if (profil) void statutAssurance().then((st) => setAssuranceInscrite(Boolean(st?.inscrit)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profil?.id]);
  const [email, setEmail] = useState('');
  const [devCode, setDevCode] = useState<string | undefined>();
  const [erreurInscription, setErreurInscription] = useState<string | null>(null);
  const [annulationOuverte, setAnnulationOuverte] = useState(false);

  /*
   * BOUTON RETOUR ANDROID. Dans l'app native, il fermait ORION quel que soit l'écran :
   * un client dans ses paramètres perdait l'app d'un geste. Il revient désormais à
   * l'écran précédent ; il ferme d'abord une feuille ouverte ; il réduit l'alerte SOS
   * sans jamais la clore ; à la racine, il met l'app en arrière-plan.
   */
  const etatRetour = useRef<{ screen: Screen; sos: boolean; annulation: boolean }>({ screen: 'splash', sos: false, annulation: false });
  useEffect(() => { if (isLiveBackend() && sessionClient()) void chargerProfil().then((p) => { if (p) setProfil(p); }); }, []);
  // Les compteurs du profil (courses, annulations, points) suivent l'activité :
  // ils sont relus à chaque ouverture des paramètres.
  useEffect(() => {
    if (screen === 'settings' && isLiveBackend() && sessionClient()) void chargerProfil().then((p) => { if (p) setProfil(p); });
  }, [screen]);
  /** Ce que l'abonnement ORION couvrirait sur cette course (aperçu, rien n'est consommé). */
  const [coverage, setCoverage] = useState<SubCoverage | null>(null);
  const [locked, setLocked] = useState(isBiometricEnabled());
  const [trusted, setTrusted] = useState<TrustedContact | null>(() => {
    try { return JSON.parse(localStorage.getItem('orion.trusted') || 'null'); } catch { return null; }
  });
  const [shareRides, setShareRides] = useState(() => localStorage.getItem('orion.share') === '1');
  const [driver, setDriver] = useState<Driver | null>(null);
  const [carPos, setCarPos] = useState<LatLng | null>(null);
  const [tripPhase, setTripPhase] = useState<TripPhase>('enroute');
  const [rideId, setRideId] = useState<string | null>(null);
  const [live, setLive] = useState(false);
  const [rating, setRating] = useState(0);
  const [phone, setPhone] = useState('');
  const [toast, setToast] = useState<{ message: string; danger?: boolean } | null>(null);
  /** État de l'alerte SOS : envoi en cours, ou échec (le passager doit appeler lui-même). */
  const [sosState, setSosState] = useState<'sending' | 'failed' | null>(null);
  /**
   * Alerte SOS EN COURS, suivie en direct : prise en charge, messages de l'agent,
   * secours réellement prévenus. Avant, après l'envoi, le passager ne recevait
   * plus rien — alors que la console, elle, voyait tout.
   */
  const [sosLive, setSosLive] = useState<SosSuivi | null>(null);
  const [sosOuvert, setSosOuvert] = useState(false);
  const [sosNonLu, setSosNonLu] = useState(0);
  const [sosHorsLigne, setSosHorsLigne] = useState(false);
  const sosOuvertRef = useRef(false);
  /** Messages d'agent déjà connus : sert à compter les nouveaux quand le panneau est réduit. */
  const sosAgentVus = useRef(0);
  const nbAgent = (sv: SosSuivi) => sv.chat.filter((c) => c.from === 'agent').length;
  useEffect(() => { sosOuvertRef.current = sosOuvert; if (sosOuvert) setSosNonLu(0); }, [sosOuvert]);
  const sosId = sosLive?.id ?? null;

  // Reprise : une alerte ouverte survit à la fermeture de l'app.
  useEffect(() => {
    if (!isLiveBackend()) return;
    let id: string | null = null;
    try { id = localStorage.getItem('orion.sos'); } catch { /* stockage indisponible */ }
    if (!id) return;
    void sosSuivi(id, clientId()).then((sv) => {
      if (sv && !sv.clotureeA) { sosAgentVus.current = nbAgent(sv); setSosLive(sv); }
      else { try { localStorage.removeItem('orion.sos'); } catch { /* ignore */ } }
    });
  }, []);

  // Temps réel : chaque geste de la supervision arrive ici, sans recharger.
  useEffect(() => {
    if (!sosId) return;
    let ferme = false;
    let ws: WebSocket | null = null;
    let relance: number | undefined;
    const connecter = () => {
      const url = sosSocketUrl(sosId, clientId());
      if (!url) return;
      ws = new WebSocket(url);
      ws.onopen = () => setSosHorsLigne(false);
      ws.onmessage = (ev) => {
        try {
          const m = JSON.parse(ev.data as string) as { type: string; suivi?: SosSuivi; data?: SosSuivi };
          const sv = m.type === 'connected' ? m.suivi : m.type === 'sos.suivi' ? m.data : undefined;
          if (!sv) return;
          const nouveaux = nbAgent(sv) - sosAgentVus.current;
          sosAgentVus.current = nbAgent(sv);
          if (nouveaux > 0 && !sosOuvertRef.current) setSosNonLu((n) => n + nouveaux);
          setSosLive(sv);
        } catch { /* trame illisible */ }
      };
      ws.onclose = () => {
        if (ferme) return;
        setSosHorsLigne(true);
        relance = window.setTimeout(connecter, 3000);
      };
    };
    connecter();
    return () => { ferme = true; window.clearTimeout(relance); ws?.close(); };
  }, [sosId]);
  const [announce, setAnnounce] = useState<Announcement | null>(null);
  useEffect(() => { listAnnouncements().then((a) => setAnnounce(a[0] ?? null)); }, []);

  // Synchronisation avec la console Admin : services activés, maintenance, passerelles
  // de paiement en service. En mode démo (backend absent) → null, l'app garde ses défauts.
  const [appConfig, setAppConfig] = useState<AppConfig | null>(null);
  useEffect(() => { fetchAppConfig().then(setAppConfig); }, []);
  const [promo, setPromo] = useState('');

  // Temps réel : abonnement au canal WS `config`. Toute modification pilotée depuis la
  // console (maintenance, services, passerelles) est reçue et appliquée instantanément,
  // sans redémarrer l'app. Reconnexion automatique si le lien tombe.
  useEffect(() => {
    const url = configSocketUrl();
    if (!url) return; // mode démo : pas de backend
    let ws: WebSocket | null = null;
    let retry: number | undefined;
    let closed = false;
    const apply = (c: Partial<AppConfig> | undefined) => {
      if (!c) return;
      setAppConfig({
        city: c.city ?? 'Abidjan', open: c.open ?? true,
        services: c.services ?? {}, gateways: c.gateways ?? {}, currency: c.currency ?? 'XOF',
      });
    };
    const connect = () => {
      try { ws = new WebSocket(url); } catch { return; }
      ws.onmessage = (ev) => {
        try {
          const msg = JSON.parse(String(ev.data));
          // `connected` porte l'état courant (config) ; `config.update` la nouvelle (data).
          if (msg.type === 'connected') apply(msg.config);
          else if (msg.type === 'config.update') apply(msg.data);
          // Barème de location ajusté depuis la console : l'écran de location se
          // rafraîchit sans que le client ait à rouvrir l'application.
          else if (msg.type === 'rental-config.update') notifyRentalTariffChange();
        } catch { /* trame ignorée */ }
      };
      ws.onclose = () => { if (!closed) retry = window.setTimeout(connect, 4000); };
      ws.onerror = () => { try { ws?.close(); } catch { /* ignore */ } };
    };
    connect();
    return () => { closed = true; window.clearTimeout(retry); try { ws?.close(); } catch { /* ignore */ } };
  }, []);

  // Moyens de paiement réellement proposés : filtrés par les passerelles actives de la
  // console. Si aucune config (démo) ou aucune passerelle listée → tout le catalogue.
  const enabledPayments = useMemo(() => {
    const g = appConfig?.gateways;
    if (!g || Object.keys(g).length === 0) return PAYMENTS;
    const filtered = PAYMENTS.filter((p) => g[p.method] !== false);
    return filtered.length > 0 ? filtered : PAYMENTS;
  }, [appConfig]);
  // Si le moyen sélectionné n'est plus proposé (passerelle coupée), bascule sur le 1er actif.
  useEffect(() => {
    if (!enabledPayments.some((p) => p.method === payment)) setPayment(enabledPayments[0]!.method);
  }, [enabledPayments, payment]);

  // ORION fermé (maintenance pilotée depuis la console) : les commandes sont suspendues.
  const closed = appConfig !== null && !appConfig.open;
  const deliveryOff = appConfig !== null && appConfig.services?.delivery === false;

  const showToast = (message: string, danger?: boolean) => {
    setToast({ message, danger });
    window.setTimeout(() => setToast(null), 3200);
  };

  /** Garde de maintenance : bloque l'ouverture d'un flux de commande si ORION est fermé. */
  const guardOpen = (): boolean => {
    if (closed) { showToast(t('closed_toast'), true); return false; }
    return true;
  };

  useEffect(() => {
    if (screen === 'confirm' && destination) {
      void estimateWithCoverage(origin.location, destination.location, tier, { bodyType, stops: stops.map((s) => s.location), insurance, promoCode: promo || undefined })
        .then(({ quote: q, coverage: c }) => { setQuote(q); setCoverage(c); });
    }
  }, [screen, destination, tier, bodyType, stops, insurance, promo, origin.location]);

  const chooseDestination = (place: Place) => {
    memoriserRecent(place);
    setDestination(place);
    setScreen('estimate');
  };

  /** Ouvre le choix d'un lieu ; à la première demande de course, on se localise. */
  const ouvrirChoix = (mode: ModeChoix, retour: Screen) => {
    if ((mode === 'depart' || mode === 'destination') && position.etat === 'inconnue') position.localiser();
    setChoix({ mode, retour });
    setScreen('choixLieu');
  };
  const lieuChoisi = (p: Place) => {
    const c = choix;
    if (!c) return;
    setChoix(null);
    if (c.mode === 'destination') { chooseDestination(p); return; }
    if (c.mode === 'depart') { position.choisir(p); memoriserRecent(p); }
    else if (c.mode === 'livraison') { setDepotLivraison(p); memoriserRecent(p); }
    else if (c.mode === 'arret') { setStops((s) => (s.length < 3 ? [...s, p] : s)); memoriserRecent(p); }
    else { enregistrerLieu(c.mode === 'domicile' ? 'home' : 'work', p, t(c.mode === 'domicile' ? 'lieu_domicile' : 'lieu_bureau')); showToast(t('lieu_enregistre_ok')); }
    setScreen(c.retour);
  };

  const pickDriver = (): Driver => {
    const base = DRIVERS[Math.floor(Math.random() * DRIVERS.length)] ?? DRIVERS[0]!;
    const car = tier.cars[Math.floor(Math.random() * tier.cars.length)] ?? tier.cars[0]!;
    return { ...base, car };
  };

  /** Construit la fiche chauffeur à partir du VRAI chauffeur matché par le backend. */
  /** Le vrai véhicule du conducteur quand le serveur le connaît ; un coursier roule à moto. */
  const driverFromSafe = (s: SafeDriver, livraison = false): Driver => ({
    name: s.name,
    matricule: s.matricule,
    rating: s.ratingAvg,
    trips: s.ratingCount,
    // La VRAIE plaque et la couleur déclarées par le chauffeur ; à défaut, l'ancienne règle.
    plate: s.vehiclePlate ?? plateFromMatricule(s.matricule),
    car: s.vehicleModel ?? (livraison ? 'Scooter électrique' : tier.cars[Math.floor(Math.random() * tier.cars.length)] ?? tier.cars[0]!),
    color: s.vehicleColor ?? '',
    photo: urlApi(s.photoUrl),
  });

  const confirmRide = async () => {
    setScreen('searching');
    if (shareRides && trusted) showToast(t('toast_shared', { name: trusted.name }));
    if (isLiveBackend() && quote) {
      const res = await createRide(quote.lockId, clientId(), shareRides && trusted ? trusted : undefined, payment);
      if (res?.ride?.driverId) {
        setRideId(res.ride.id);
        setLive(true);
        setDriver(res.driver ? driverFromSafe(res.driver) : pickDriver());
        setCarPos(null);
        setTripPhase('enroute');
        setScreen('tracking');
        return;
      }
      // Backend connecté : ne JAMAIS fabriquer de chauffeur. Sans attribution (aucun
      // chauffeur disponible) ou si l'appel a échoué, on le dit au client et on libère
      // la course. Afficher un faux chauffeur ferait croire qu'une voiture arrive.
      if (res?.ride?.id) void cancelRide(res.ride.id);
      showToast(res ? t('toast_no_driver') : t('toast_ride_failed'), true);
      reset();
      return;
    }
    // Mode démo uniquement (pas de backend) : course simulée.
    window.setTimeout(() => {
      setRideId(null);
      setLive(false);
      setDriver(pickDriver());
      setTripPhase('enroute');
      setScreen('tracking');
    }, 2400);
  };

  /**
   * SOS. Fonction de sécurité : on n'annonce « secours prévenus » QUE si ORION a
   * réellement reçu l'alerte. Si l'envoi échoue (réseau coupé, serveur indisponible),
   * on le dit franchement et on propose d'appeler directement les secours — l'ancienne
   * version affichait toujours « SAMU notifié », même quand rien n'était parti.
   */
  const triggerSos = async () => {
    if (!isLiveBackend()) { showToast(t('toast_sos'), true); return; } // démo : simulation
    // Une alerte est déjà ouverte : on la rouvre au lieu d'en créer une seconde.
    if (sosLive && !sosLive.clotureeA) { setSosOuvert(true); return; }
    setSosState('sending');
    const res = await sos(clientId(), carPos ?? origin.location, rideId ?? undefined);
    if (res.delivered) {
      setSosState(null);
      if (res.suivi) {
        sosAgentVus.current = nbAgent(res.suivi);
        setSosLive(res.suivi);
        setSosOuvert(true);
        try { localStorage.setItem('orion.sos', res.suivi.id); } catch { /* ignore */ }
      } else showToast(t('toast_sos'), true);
      return;
    }
    setSosState('failed'); // échec : le passager doit appeler lui-même
  };

  const repondreSos = async (texte: string) => {
    if (!sosLive) return;
    const sv = await sosRepondre(sosLive.id, clientId(), texte);
    if (sv) setSosLive(sv);
  };
  const fermerSos = () => {
    setSosLive(null); setSosOuvert(false); setSosNonLu(0);
    try { localStorage.removeItem('orion.sos'); } catch { /* ignore */ }
  };

  const cancelCurrentRide = () => {
    // Course réelle : motif demandé et frais annoncés avant de confirmer.
    if (live && rideId) { setAnnulationOuverte(true); return; }
    showToast(t('toast_cancelled'));
    reset();
  };
  const annulationFaite = (f: FraisAnnulation) => {
    setAnnulationOuverte(false);
    showToast(f.montant > 0 ? t('cx_done_fee', { f: formatXOF(f.montant) }) : t('cx_done_free'), f.montant > 0);
    reset();
  };

  etatRetour.current = { screen, sos: sosOuvert, annulation: annulationOuverte };
  useEffect(() => {
    if (Capacitor.getPlatform() !== 'android') return;
    const PARENT: Partial<Record<Screen, Screen>> = {
      auth: 'onboarding', otp: 'auth', destination: 'home', delivery: 'home', estimate: 'home', confirm: 'estimate',
      settings: 'home', profile: 'settings', sosHistory: 'settings', legal: 'settings', history: 'settings',
      wallet: 'home', help: 'home', support: 'help', subscription: 'home', rental: 'home', myRentals: 'home', wedding: 'home', assurance: 'settings', messages: 'home', choixLieu: 'home',
    };
    const ecoute = AppNative.addListener('backButton', () => {
      const e = etatRetour.current;
      if (e.annulation) { setAnnulationOuverte(false); return; }
      if (e.sos) { setSosOuvert(false); return; }
      const parent = PARENT[e.screen];
      // Pendant une course (suivi, paiement, notation), le retour ne quitte pas le parcours.
      if (parent) setScreen(parent);
      else if (!['tracking', 'searching', 'payment', 'rating', 'photo', 'permissions'].includes(e.screen)) void AppNative.minimizeApp();
    });
    return () => { void ecoute.then((l) => l.remove()); };
  }, []);

  /* ------------------------------ Compte client ------------------------------ */
  const envoyerCode = async () => {
    setErreurInscription(null);
    if (!isLiveBackend()) { setScreen('otp'); return; } // démonstration sans serveur
    const r = await demanderCode(phone);
    if (!r.ok) { setErreurInscription(r.error); return; }
    setDevCode(r.devCode);
    setScreen('otp');
  };
  const verifierNumero = async (code: string): Promise<string | null> => {
    if (!isLiveBackend()) { setScreen('photo'); return null; }
    const r = await verifierCode(phone, code, clientName, email);
    if (!r.ok) return r.error;
    setProfil(r.client);
    if (r.compteRetrouve) showToast(t('welcome_back', { name: r.client.name ?? '' }));
    setScreen(r.client.photo ? 'permissions' : 'photo');
    return null;
  };
  const quitterCompte = (message: string) => {
    seDeconnecter();
    setProfil(null); setClientName(''); setPhone(''); setEmail(''); setDevCode(undefined);
    showToast(message);
    setScreen('onboarding');
  };

  /** Coursier moto (livraison) — démo. */
  const pickCourier = (): Driver => {
    const base = DRIVERS[Math.floor(Math.random() * DRIVERS.length)] ?? DRIVERS[0]!;
    return { ...base, car: 'Moto ORION · 100% électrique', plate: `CI-${(base.matricule.match(/\d+/)?.[0] ?? '0000')} M` };
  };

  /** Lance une livraison moto (retrait → dépôt), tarif coursier, suivi moto. */
  const startDelivery = async (dropoff: Place, size: PkgSize) => {
    setMode('delivery');
    setPkgSize(size);
    setDestination(dropoff);
    setScreen('searching');

    // Backend connecté : la livraison est une VRAIE commande (devis coursier verrouillé
    // puis création de la course), visible dans la console. Elle n'était jusqu'ici que
    // simulée, même en production : aucun colis n'était réellement enregistré.
    if (isLiveBackend()) {
      const q = await estimateDelivery(origin.location, dropoff.location, size, promo || undefined);
      if (q) {
        setQuote(q);
        const res = await createRide(q.lockId, clientId(), shareRides && trusted ? trusted : undefined, payment);
        if (res?.ride?.driverId) {
          setRideId(res.ride.id);
          setLive(true);
          setDriver(res.driver ? driverFromSafe(res.driver, true) : pickCourier());
          setCarPos(null);
          setTripPhase('enroute');
          setScreen('tracking');
          return;
        }
        if (res?.ride?.id) void cancelRide(res.ride.id);
      }
      showToast(q ? t('toast_no_driver') : t('toast_ride_failed'), true);
      reset();
      return;
    }

    // Mode démo (pas de backend) : coursier simulé.
    setQuote(previewDelivery(origin.location, dropoff.location, size));
    setLive(false);
    setRideId(null);
    window.setTimeout(() => { setDriver(pickCourier()); setTripPhase('enroute'); setScreen('tracking'); }, 2200);
  };

  const reset = () => {
    setDestination(null);
    setQuote(null);
    setCoverage(null);
    setDriver(null);
    setCarPos(null);
    setRideId(null);
    setLive(false);
    setRating(0);
    setTier(TIERS[0]!);
    setBodyType('berline');
    setStops([]);
    setScheduled(false);
    setInsurance(false);
    setPromo('');
    setMode('ride');
    setScreen('home');
  };

  return (
    <div className="app-shell">
      <div className="phone">
        {toast && <Toast message={toast.message} danger={toast.danger} />}
        {sosState && <SosOverlay state={sosState} onRetry={() => void triggerSos()} onClose={() => setSosState(null)} />}
        {sosLive && sosOuvert && (
          <SosLive suivi={sosLive} horsLigne={sosHorsLigne} onMinimize={() => setSosOuvert(false)} onClose={fermerSos} onSend={(x) => void repondreSos(x)} />
        )}
        {sosLive && !sosOuvert && <SosPill suivi={sosLive} nonLu={sosNonLu} onOpen={() => setSosOuvert(true)} />}
        {locked && <LockScreen onUnlock={() => setLocked(false)} />}

        {screen === 'splash' && <Splash onDone={() => setScreen(profil ? 'home' : 'onboarding')} />}
        {screen === 'onboarding' && <Onboarding onStart={() => setScreen('auth')} onLang={() => setScreen('settings')} />}
        {screen === 'auth' && <AuthScreen phone={phone} setPhone={setPhone} name={clientName} setName={setClientName} email={email} setEmail={setEmail} erreur={erreurInscription} onBack={() => setScreen('onboarding')} onNext={() => void envoyerCode()} onWhatsApp={(msg) => { showToast(msg); void envoyerCode(); }} />}
        {screen === 'otp' && (
          <OtpScreen
            phone={phone}
            devCode={devCode}
            onBack={() => setScreen('auth')}
            onResend={async () => { const r = await demanderCode(phone); if (r.ok) setDevCode(r.devCode); return r.ok ? null : r.error; }}
            onVerify={verifierNumero}
          />
        )}
        {screen === 'photo' && <PhotoScreen profil={profil} onDone={(p) => { if (p) setProfil(p); setScreen('permissions'); }} />}
        {screen === 'permissions' && <PermissionsScreen etat={position.etat} onLocaliser={position.localiser} onDone={() => setScreen('home')} />}

        {screen === 'home' && (
          <HomeScreen announce={announce} closed={closed} deliveryOff={deliveryOff} city={appConfig?.city ?? null} profil={profil}
            onSearch={() => { if (guardOpen()) { setMode('ride'); ouvrirChoix('destination', 'home'); } }}
            onCourse={() => { if (guardOpen()) { setMode('ride'); ouvrirChoix('destination', 'home'); } }}
            onDelivery={() => { if (guardOpen()) { setMode('delivery'); if (position.etat === 'inconnue') position.localiser(); setScreen('delivery'); } }}
            onQuick={(p) => { if (guardOpen()) { setMode('ride'); if (position.etat === 'inconnue') position.localiser(); chooseDestination(p); } }}
            onAjouterLieu={(quel) => ouvrirChoix(quel, 'home')}
            onNav={setScreen}
            nonLus={messagerie.nonLus} onMessages={messagerie.actif ? () => { setRetourMessages('home'); setScreen('messages'); } : undefined}
            onSoon={(name) => showToast(t('soon_toast', { name }))} />
        )}

        {screen === 'choixLieu' && choix && (
          <ChoixLieu mode={choix.mode} centre={origin.location} etatPosition={position.etat}
            onMaPosition={() => { position.revenirAuGps(); setChoix(null); setScreen(choix.retour); }}
            onChoose={lieuChoisi} onBack={() => { setChoix(null); setScreen(choix.retour); }} />
        )}

        {screen === 'delivery' && (
          <DeliveryScreen origin={origin} departAConfirmer={departAConfirmer} dropoff={depotLivraison} pkgSize={pkgSize}
            onPickup={() => ouvrirChoix('depart', 'delivery')} onDropoff={() => ouvrirChoix('livraison', 'delivery')}
            onBack={() => { setDepotLivraison(null); setScreen('home'); }} onConfirm={(d, s) => { setDepotLivraison(null); void startDelivery(d, s); }} />
        )}

        {screen === 'estimate' && destination && (
          <EstimateScreen origin={origin} destination={destination} tier={tier} onTier={setTier}
            bodyType={bodyType} onBody={setBodyType} stops={stops}
            onBack={() => setScreen('home')} onNext={() => setScreen('confirm')} />
        )}

        {screen === 'confirm' && destination && (
          <ConfirmScreen origin={origin} departAConfirmer={departAConfirmer} onDepart={() => ouvrirChoix('depart', 'confirm')} destination={destination} tier={tier} bodyType={bodyType} quote={quote} coverage={coverage} payment={payment}
            payments={enabledPayments} promo={promo} onPromo={setPromo}
            stops={stops} onAddStop={() => ouvrirChoix('arret', 'confirm')} onRemoveStop={(i) => setStops((s) => s.filter((_, j) => j !== i))}
            scheduled={scheduled} onSchedule={setScheduled} insurance={insurance} onInsurance={(v) => { if (v && !assuranceInscrite && isLiveBackend()) { setAssuranceRequise(true); return; } setInsurance(v); }}
            onPayment={setPayment} onBack={() => setScreen('estimate')}
            onConfirm={() => { if (scheduled) { showToast(t('toast_scheduled')); reset(); } else confirmRide(); }} />
        )}

        {screen === 'searching' && destination && (
          <SearchingScreen origin={origin} destination={destination} mode={mode} onCancel={reset} />
        )}

        {screen === 'tracking' && destination && driver && (
          <TrackingScreen onMessage={messagerie.recevoir} messages={messagerie.actif ? { nonLus: messagerie.nonLus, ouvrir: () => { setRetourMessages('tracking'); setScreen('messages'); } } : undefined} origin={origin} destination={destination} driver={driver} tier={tier} phase={tripPhase} mode={mode}
            carPos={carPos} setCarPos={setCarPos} setPhase={setTripPhase} live={live} rideId={rideId} stops={stops}
            onSos={triggerSos} onShare={() => showToast(t('toast_share'))} onArrived={() => setScreen('payment')}
            onCancel={cancelCurrentRide}
            onReassigned={(d) => {
              // Nouveau chauffeur (refus, délai, annulation du chauffeur, console) : il part
              // de sa propre position, le suivi repart donc de l'étape « en route ».
              setDriver(driverFromSafe(d)); setTripPhase('enroute'); setCarPos(null);
              showToast(t('toast_reassigned', { name: d.name }));
            }}
            onServerCancel={() => { showToast(t('toast_no_driver'), true); reset(); }} />
        )}

        {annulationOuverte && rideId && screen === 'tracking' && (
          <CancelSheet rideId={rideId} onClose={() => setAnnulationOuverte(false)} onCancelled={annulationFaite}
            onSos={() => { setAnnulationOuverte(false); void triggerSos(); }} />
        )}

        {screen === 'payment' && destination && driver && (
          <PaymentScreen quote={quote} coverage={coverage} payment={payment} driver={driver} rideId={rideId}
            onPaid={() => setScreen('rating')} />
        )}

        {screen === 'rating' && destination && driver && (
          <RatingScreen origin={origin} driver={driver} quote={quote} payment={payment} destination={destination} rating={rating} livraison={mode === 'delivery'}
            setRating={setRating} onDone={() => { if (live && rideId && rating) void rateRide(rideId, rating); showToast(t(mode === 'delivery' ? 'toast_done_liv' : 'toast_done')); reset(); }} />
        )}

        {assuranceRequise && screen === 'confirm' && (
          <div className="controle-voile" role="dialog" aria-modal="true" aria-label={t('as_requis_t')}>
            <div className="controle-carte">
              <span className="controle-ico"><IconMedical size={26} /></span>
              <h3>{t('as_requis_t')}</h3>
              <p>{t('as_requis')}</p>
              <button className="btn btn-primary" onClick={() => { setAssuranceRequise(false); setRetourAssurance('confirm'); setScreen('assurance'); }}>
                <IconShieldCheck size={18} /> {t('as_requis_cta')}
              </button>
              <button className="btn btn-ghost" style={{ marginTop: 8 }} onClick={() => setAssuranceRequise(false)}>{t('msg_plus_tard')}</button>
            </div>
          </div>
        )}
        {screen === 'tracking' && <ControleSecurite messagerie={messagerie} rideId={rideId} />}
        {screen === 'assurance' && (
          <AssuranceScreen nomClient={profil?.name} onToast={showToast}
            onBack={() => setScreen(retourAssurance)}
            onChange={(inscrit) => { setAssuranceInscrite(inscrit); if (inscrit && retourAssurance === 'confirm') { setInsurance(true); setScreen('confirm'); } }} />
        )}
        {screen === 'messages' && <MessagesScreen messagerie={messagerie} onBack={() => setScreen(retourMessages)} />}
        {screen === 'settings' && (
          <SettingsScreen profil={profil} onBack={() => setScreen(profil ? 'home' : 'onboarding')}
            assuranceActive={assuranceInscrite} onAssurance={() => { setRetourAssurance('settings'); setScreen('assurance'); }}
            onProfile={() => setScreen('profile')} onHistory={() => setScreen('history')} onSos={() => setScreen('sosHistory')}
            onWallet={() => setScreen('wallet')} onSubscription={() => setScreen('subscription')}
            onHelp={() => setScreen('help')} onLegal={() => setScreen('legal')} onCreate={() => setScreen('auth')}
            onLogout={() => quitterCompte(t('set_logged_out'))}
            onDelete={() => void supprimerCompte().then((r) => (r.ok ? quitterCompte(t('set_deleted')) : showToast(r.error, true)))}
            trusted={trusted} setTrusted={(c) => { setTrusted(c); localStorage.setItem('orion.trusted', JSON.stringify(c)); }}
            shareRides={shareRides} setShareRides={(v) => { setShareRides(v); localStorage.setItem('orion.share', v ? '1' : '0'); }} />
        )}
        {screen === 'profile' && <ProfileScreen profil={profil} onBack={() => setScreen('settings')} onSaved={setProfil} onToast={showToast} />}
        {screen === 'sosHistory' && <SosHistoryScreen onBack={() => setScreen('settings')} />}
        {screen === 'legal' && <LegalScreen onBack={() => setScreen('settings')} />}
        {screen === 'wallet' && <WalletScreen onBack={() => setScreen('home')} onToast={showToast} />}
        {screen === 'history' && <HistoryScreen onBack={() => setScreen(profil ? 'settings' : 'home')} onLogin={() => setScreen('auth')} />}
        {screen === 'help' && <HelpScreen onBack={() => setScreen('home')} onSupport={() => setScreen('support')} />}
        {screen === 'support' && <SupportChatScreen onBack={() => setScreen('help')} />}
        {screen === 'subscription' && (
          <SubscriptionScreen onBack={() => setScreen('home')} onToast={showToast} />
        )}
        {screen === 'rental' && (
          <RentalScreen onBack={() => setScreen('home')} onToast={showToast}
            onReserved={(id) => { showToast(t('rent_reserved', { id })); setScreen('myRentals'); }} />
        )}
        {screen === 'myRentals' && (
          <MyRentalsScreen onBack={() => setScreen('home')} onToast={showToast} />
        )}
        {screen === 'wedding' && (
          <WeddingScreen onBack={() => setScreen('home')} onReserve={() => { showToast(t('toast_reserved')); setScreen('home'); }} />
        )}
      </div>
    </div>
  );
}

/* --------------------------- SOS (sécurité) --------------------------- */
/**
 * Surcouche SOS. En cas d'échec d'envoi, elle NE laisse PAS croire que les secours
 * sont prévenus : elle l'annonce clairement et met les numéros d'urgence à portée
 * de pouce (appel direct), avec possibilité de réessayer l'alerte ORION.
 */
function SosOverlay({ state, onRetry, onClose }: { state: 'sending' | 'failed'; onRetry: () => void; onClose: () => void }) {
  const { t } = useI18n();
  const numeros: Array<[string, string]> = [
    ['SAMU', EMERGENCY_NUMBERS.samu],
    [t('help_police'), EMERGENCY_NUMBERS.police],
    [t('help_fire'), EMERGENCY_NUMBERS.pompiers],
  ];
  return (
    <div className="sos-wrap" role="alertdialog" aria-live="assertive">
      <div className="sos-card">
        {state === 'sending' ? (
          <>
            <div className="sos-pulse" aria-hidden="true" />
            <h2 className="sos-title">{t('sos_sending')}</h2>
            <p className="sos-sub">{t('sos_sending_sub')}</p>
          </>
        ) : (
          <>
            <h2 className="sos-title danger">⚠️ {t('sos_failed')}</h2>
            <p className="sos-sub">{t('sos_failed_sub')}</p>
            <div className="sos-nums">
              {numeros.map(([label, num]) => (
                <a key={num} className="sos-num" href={`tel:${num}`}>
                  <IconPhone size={18} /> <strong>{num}</strong> <span>{label}</span>
                </a>
              ))}
            </div>
            <button className="btn btn-primary" style={{ marginTop: 14 }} onClick={onRetry}>{t('sos_retry')}</button>
            <button className="btn btn-ghost" style={{ marginTop: 8 }} onClick={onClose}>{t('ins_got')}</button>
          </>
        )}
      </div>
    </div>
  );
}

/** Pastille du chauffeur : sa photo si elle existe, sinon son initiale. */
function PhotoChauffeur({ driver, style }: { driver: Driver; style?: React.CSSProperties }) {
  const [echec, setEchec] = useState(false);
  return (
    <span className="driver-photo" style={{ ...style, overflow: 'hidden' }}>
      {driver.photo && !echec
        ? <img src={driver.photo} alt={driver.name} onError={() => setEchec(true)} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
        : driver.name.charAt(0)}
    </span>
  );
}

/* ------------------------ SOS : suivi en direct ------------------------ */
const heure = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

/**
 * Ce que vit la personne en détresse après avoir appuyé sur SOS : chaque étape
 * réelle de sa prise en charge, au moment où elle a lieu dans la console. Rien
 * n'est affiché par anticipation — un secours n'apparaît « prévenu » que lorsqu'un
 * agent l'a effectivement appelé.
 */
function SosLive({ suivi, horsLigne, onMinimize, onClose, onSend }: {
  suivi: SosSuivi; horsLigne: boolean; onMinimize: () => void; onClose: () => void; onSend: (t: string) => void;
}) {
  const { t } = useI18n();
  const [texte, setTexte] = useState('');
  const finChat = useRef<HTMLDivElement>(null);
  useEffect(() => { finChat.current?.scrollIntoView({ behavior: 'smooth', block: 'end' }); }, [suivi.chat.length]);
  const close = suivi.clotureeA !== null;
  const envoyer = (x: string) => { const v = x.trim(); if (v) { onSend(v); setTexte(''); } };
  const libelleSecours = (s: SosSuivi['secours'][number]) =>
    s.issue === 'joint' ? t('sos_rescue_joint', { s: s.service, n: s.numero })
      : s.issue === 'tentative'
        // Un SMS ou un WhatsApp n'est pas un appel : c'est la position qui est partie.
        ? t(s.canal === 'appel' ? 'sos_rescue_calling' : 'sos_rescue_sent', { s: s.service, n: s.numero })
        : t('sos_rescue_failed', { s: s.service, n: s.numero });
  const numeros: Array<[string, string]> = [['SAMU', EMERGENCY_NUMBERS.samu], [t('help_police'), EMERGENCY_NUMBERS.police], [t('help_fire'), EMERGENCY_NUMBERS.pompiers]];

  return (
    <div className="sos-live" role="dialog" aria-live="polite" aria-label={t('sos_live_title')}>
      <div className={`sos-live-head${close ? ' done' : ''}`}>
        <div className="row between">
          <span className="sos-live-badge">{close ? '✓' : 'SOS'}</span>
          {!close && <button className="sos-live-min" onClick={onMinimize}>{t('sos_live_minimize')}</button>}
        </div>
        <h2>{close ? t('sos_step_closed') : t('sos_live_title')}</h2>
        <p>{t('sos_live_sent', { h: heure(suivi.createdAt) })}{suivi.zoneName ? ` · ${suivi.zoneName}` : ''}</p>
      </div>

      <div className="sos-live-body">
        {horsLigne && !close && <p className="sos-offline">{t('sos_live_offline')}</p>}
        <ol className="sos-steps">
          <li className="ok"><span className="dot" /><span className="grow">{t('sos_step_received')}</span><time>{heure(suivi.createdAt)}</time></li>
          {suivi.priseEnCharge
            ? <li className="ok"><span className="dot" /><span className="grow">{(suivi.priseEnCharge.agent === AGENT_GENERIQUE ? t('sos_step_agent_team') : t('sos_step_agent', { a: suivi.priseEnCharge.agent }))}</span><time>{heure(suivi.priseEnCharge.at)}</time></li>
            : !close && <li className="wait"><span className="dot" /><span className="grow">{t('sos_step_waiting_agent')}</span></li>}
          {suivi.secours.length > 0
            ? suivi.secours.map((s, i) => (
              <li key={i} className={s.issue === 'joint' || (s.issue === 'tentative' && s.canal !== 'appel') ? 'ok rescue' : s.issue === 'tentative' ? 'wait rescue' : 'warn'}>
                <span className="dot" /><span className="grow">{libelleSecours(s)}</span><time>{heure(s.at)}</time>
              </li>
            ))
            : !close && <li className="idle"><span className="dot" /><span className="grow">{t('sos_step_no_rescue')}</span></li>}
          {close && <li className="ok"><span className="dot" /><span className="grow">{t('sos_step_closed')}</span><time>{heure(suivi.clotureeA!)}</time></li>}
        </ol>

        {!close && <p className="sos-geo"><IconShield size={14} /> {t('sos_position')}</p>}

        <div className="sos-chat-box">
          <span className="eyebrow">{t('sos_chat_title')}</span>
          <div className="sos-chat">
            {suivi.chat.map((m, i) => (
              <div key={i} className={`sos-bubble ${m.from}`}>
                <span>{m.text}</span>
                <small>{m.from === 'agent' ? (m.author ?? 'ORION') : t('sos_you')} · {heure(m.at)}</small>
              </div>
            ))}
            <div ref={finChat} />
          </div>
          {!close && (
            <>
              <div className="sos-quick">
                {[t('sos_quick_safe'), t('sos_quick_cant_talk'), t('sos_quick_help')].map((q) => (
                  <button key={q} className="chip" onClick={() => envoyer(q)}>{q}</button>
                ))}
              </div>
              <div className="sos-input">
                <input value={texte} onChange={(e) => setTexte(e.target.value)} placeholder={t('sos_chat_placeholder')} onKeyDown={(e) => { if (e.key === 'Enter') envoyer(texte); }} />
                <button className="btn btn-primary" onClick={() => envoyer(texte)}>{t('sos_send')}</button>
              </div>
            </>
          )}
        </div>

        <span className="eyebrow" style={{ display: 'block', marginTop: 14 }}>{t('sos_call_direct')}</span>
        <div className="sos-direct">
          {numeros.map(([label, num]) => (
            <a key={num} href={`tel:${num}`}><IconPhone size={15} /> <strong>{num}</strong> <span>{label}</span></a>
          ))}
        </div>
        {close && <button className="btn btn-primary" style={{ marginTop: 14 }} onClick={onClose}>{t('sos_live_close')}</button>}
      </div>
    </div>
  );
}

/** Rappel permanent d'une alerte ouverte quand le panneau est réduit. */
function SosPill({ suivi, nonLu, onOpen }: { suivi: SosSuivi; nonLu: number; onOpen: () => void }) {
  const { t } = useI18n();
  const etape = suivi.clotureeA ? t('sos_step_closed')
    : suivi.secours.some((s) => s.issue === 'joint') ? t('sos_rescue_joint', { s: suivi.secours.find((s) => s.issue === 'joint')!.service, n: suivi.secours.find((s) => s.issue === 'joint')!.numero })
      : suivi.priseEnCharge ? (suivi.priseEnCharge.agent === AGENT_GENERIQUE ? t('sos_step_agent_team') : t('sos_step_agent', { a: suivi.priseEnCharge.agent })) : t('sos_step_received');
  return (
    <button className="sos-pill" onClick={onOpen}>
      <span className="sos-pill-dot" /> <strong>{t('sos_live_pill')}</strong> <span className="grow">{etape}</span>
      {nonLu > 0 && <span className="sos-pill-count">{nonLu}</span>}
    </button>
  );
}

/* ------------------------------- Splash ------------------------------ */
function Splash({ onDone }: { onDone: () => void }) {
  const { t } = useI18n();
  useEffect(() => {
    const id = window.setTimeout(onDone, 2400);
    return () => window.clearTimeout(id);
  }, [onDone]);
  return (
    <div className="splash" onClick={onDone}>
      <div className="splash-rings"><span /><span /><span /></div>
      <div className="splash-logo" style={{ color: '#fff' }}><LogoGlyph size={56} /></div>
      <div className="splash-word">ORION</div>
      <div className="splash-tag">{t('tagline')}</div>
    </div>
  );
}

/* --------------------------- Verrou biométrique ---------------------- */
function LockScreen({ onUnlock }: { onUnlock: () => void }) {
  const { t } = useI18n();
  const [busy, setBusy] = useState(false);
  const unlock = async () => {
    setBusy(true);
    const ok = await authenticateBiometric();
    setBusy(false);
    if (ok) onUnlock();
  };
  useEffect(() => { void unlock(); /* tente automatiquement à l'ouverture */ // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return (
    <div className="lock-screen">
      <div className="logo-mark" style={{ width: 64, height: 64, color: '#fff' }}><LogoGlyph size={36} /></div>
      <div className="lock-fp" onClick={unlock} role="button">
        <IconFingerprint size={56} />
      </div>
      <h2 className="h-title">{t('lock_title')}</h2>
      <p className="h-sub" style={{ textAlign: 'center' }}>{t('lock_hint')}</p>
      <button className="btn btn-primary" style={{ maxWidth: 240, marginTop: 18 }} disabled={busy} onClick={unlock}>
        <IconLock size={18} /> {t('lock_unlock')}
      </button>
    </div>
  );
}

/* ----------------------------- Onboarding ---------------------------- */
function Onboarding({ onStart, onLang }: { onStart: () => void; onLang: () => void }) {
  const { t } = useI18n();
  return (
    <div className="onb">
      <OrionMap origin={DEFAULT_ORIGIN.location} />
      <button className="avatar lang-fab" onClick={onLang} aria-label="Language"><IconGlobe size={20} /></button>
      <div style={{ position: 'relative', zIndex: 2 }} className="stack">
        <div className="logo-mark rise" style={{ color: '#fff' }}><LogoGlyph size={46} /></div>
        <div className="eyebrow rise rise-2">{t('onb_eyebrow')}</div>
        <h1 className="h-hero rise rise-2">{t('onb_title')}</h1>
        <p className="h-sub rise rise-3">{t('onb_subtitle')}</p>
        <div className="row gap-sm rise rise-3" style={{ marginTop: 6 }}>
          <span className="badge green"><IconLeaf size={13} /> {t('onb_electric')}</span>
          <span className="badge"><IconShield size={13} /> {t('onb_safety')}</span>
        </div>
        <button className="btn btn-primary rise rise-3" style={{ marginTop: 18 }} onClick={onStart}>
          {t('onb_start')} <IconChevron size={18} />
        </button>
        {!isLiveBackend() && <p className="faint" style={{ textAlign: 'center', fontSize: 12 }}>{t('demoMode')}</p>}
      </div>
    </div>
  );
}

/* --------------------------- Inscription ----------------------------- */
function AuthScreen({ phone, setPhone, name, setName, email, setEmail, erreur, onBack, onNext, onWhatsApp }: {
  phone: string; setPhone: (v: string) => void;
  name: string; setName: (v: string) => void;
  email: string; setEmail: (v: string) => void; erreur: string | null;
  onBack: () => void; onNext: () => void; onWhatsApp: (msg: string) => void;
}) {
  const { t } = useI18n();
  const valid = phone.replace(/\D/g, '').length >= 8 && name.trim().length >= 2
    && (!email.trim() || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()));
  /*
   * Touche « Suivant » du clavier : passe au champ suivant et l'amène au-dessus du clavier.
   * Sans cela, sur iPhone, le clavier ouvert recouvrait le champ suivant de la feuille.
   */
  const telRef = useRef<HTMLInputElement>(null);
  const mailRef = useRef<HTMLInputElement>(null);
  const suivant = (cible: React.RefObject<HTMLInputElement | null>) => (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    cible.current?.focus();
    cible.current?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  };
  return (
    <div className="screen page">
      <OrionMap origin={DEFAULT_ORIGIN.location} />
      <TopBar onBack={onBack} />
      <div style={{ flex: 1 }} />
      <Sheet>
        <div className="logo-mark" style={{ width: 56, height: 56, marginBottom: 12, color: '#fff' }}><LogoGlyph size={32} /></div>
        <h2 className="h-title">{t('reg_title')}</h2>
        <p className="h-sub" style={{ marginBottom: 16 }}>{t('reg_subtitle')}</p>
        <div className="field" style={{ marginBottom: 10 }}>
          <input aria-label={t('reg_name')} autoComplete="name" enterKeyHint="next" onKeyDown={suivant(telRef)} placeholder={t('reg_name')} value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div className="field" style={{ marginBottom: 10 }}>
          <span className="dialcode">🇨🇮 +225</span>
          <input ref={telRef} inputMode="tel" aria-label={t('reg_phone')} autoComplete="tel-national" enterKeyHint="next" onKeyDown={suivant(mailRef)} placeholder={t('reg_phone')} value={phone} onChange={(e) => setPhone(e.target.value)} />
        </div>
        <div className="field" style={{ marginBottom: 16 }}>
          <input ref={mailRef} type="email" inputMode="email" aria-label={t('reg_email')} autoComplete="email" enterKeyHint="send" onKeyDown={(e) => { if (e.key === 'Enter' && valid) { e.preventDefault(); (e.target as HTMLInputElement).blur(); onNext(); } }} placeholder={t('reg_email')} value={email} onChange={(e) => setEmail(e.target.value)} />
        </div>
        {erreur && <p className="photo-erreur" style={{ marginTop: -6 }}>{erreur}</p>}
        <button className="btn btn-primary" disabled={!valid} onClick={onNext}>{t('reg_send')} <IconChevron size={18} /></button>
        <button className="btn btn-ghost" style={{ marginTop: 10, color: '#25D366' }} disabled={!valid} onClick={() => onWhatsApp(t('wa_otp'))}>
          <IconPhone size={18} /> {t('wa_otp')}
        </button>
      </Sheet>
    </div>
  );
}

/**
 * AUTORISATIONS. L'écran proposait cinq interrupteurs (position, notifications, micro,
 * appareil photo, stockage) qui ne demandaient RIEN au téléphone, dont trois pour des
 * fonctions que l'app n'utilise pas — refus assuré à la revue App Store (règle 5.1.1).
 * Il ne reste que ce qui sert : la position (vraie demande système, pour le point de
 * prise en charge) et l'appareil photo (demandé seulement au moment de la photo).
 */
function PermissionsScreen({ etat, onLocaliser, onDone }: { etat: EtatPosition; onLocaliser: () => void; onDone: () => void }) {
  const { t } = useI18n();
  const [demande, setDemande] = useState(false);
  // On laisse le temps à la fenêtre système de répondre, puis on passe à l'accueil.
  useEffect(() => {
    if (demande && etat !== 'attente' && etat !== 'inconnue') { const id = window.setTimeout(onDone, 600); return () => window.clearTimeout(id); }
    return undefined;
  }, [demande, etat, onDone]);
  const autoriser = () => { setDemande(true); onLocaliser(); };
  const statut = etat === 'ok' ? t('perm_loc_ok') : etat === 'refus' ? t('perm_loc_refus') : etat === 'attente' ? t('lieu_position_attente')
    : etat === 'hors_zone' ? t('lieu_position_hors_zone') : etat === 'indisponible' ? t('lieu_position_indispo') : null;
  return (
    <div className="screen page">
      <OrionMap origin={DEFAULT_ORIGIN.location} />
      <TopBar title={t('perm_title')} />
      <div style={{ flex: 1 }} />
      <Sheet>
        <div className="logo-mark" style={{ width: 52, height: 52, marginBottom: 12 }}><IconShield size={26} /></div>
        <h2 className="h-title">{t('perm_title')}</h2>
        <p className="h-sub" style={{ marginBottom: 14 }}>{t('perm_sub')}</p>
        <div className="stack">
          <div className="opt" style={etat === 'ok' ? { borderColor: 'var(--green)' } : undefined}>
            <span className="list-ico" style={{ color: 'var(--green)' }}><IconPin size={20} /></span>
            <span className="col grow" style={{ textAlign: 'start' }}>
              <strong style={{ fontSize: 14.5 }}>{t('perm_loc')}</strong>
              <span className="faint" style={{ fontSize: 12 }}>{statut ?? t('perm_loc_d')}</span>
            </span>
            {etat === 'ok' ? <IconCheck size={20} color="var(--green)" /> : null}
          </div>
          <div className="opt">
            <span className="list-ico" style={{ color: 'var(--green)' }}><IconCamera size={20} /></span>
            <span className="col grow" style={{ textAlign: 'start' }}>
              <strong style={{ fontSize: 14.5 }}>{t('perm_cam')}</strong>
              <span className="faint" style={{ fontSize: 12 }}>{t('perm_cam_d')}</span>
            </span>
          </div>
        </div>
        <button className="btn btn-primary" style={{ marginTop: 16 }} disabled={etat === 'attente'} onClick={etat === 'ok' ? onDone : autoriser}>
          <IconCheck size={18} /> {etat === 'ok' ? t('perm_continue') : t('perm_allow')}
        </button>
        <button className="btn btn-ghost" style={{ marginTop: 10 }} onClick={onDone}>{t('perm_skip')}</button>
      </Sheet>
    </div>
  );
}

function OtpScreen({ phone, devCode, onBack, onResend, onVerify }: {
  phone: string; devCode?: string; onBack: () => void;
  onResend: () => Promise<string | null>; onVerify: (code: string) => Promise<string | null>;
}) {
  const { t } = useI18n();
  const N = 6;
  // Un seul vrai champ (6 chiffres) affiché en 6 cases : aucune frappe rapide ne se perd,
  // le collage et le remplissage automatique du SMS (iOS / Android) arrivent d'un bloc.
  const [code, setCode] = useState('');
  const [erreur, setErreur] = useState<string | null>(null);
  const [enCours, setEnCours] = useState(false);
  const [actif, setActif] = useState(true);
  const champ = useRef<HTMLInputElement>(null);
  const filled = code.length === N;

  const verifier = async () => {
    setEnCours(true); setErreur(null);
    const e = await onVerify(code);
    setEnCours(false);
    if (e) { setErreur(e); setCode(''); champ.current?.focus(); }
  };

  return (
    <div className="screen page">
      <OrionMap origin={DEFAULT_ORIGIN.location} />
      <TopBar onBack={onBack} title={t('otp_title')} />
      <div style={{ flex: 1 }} />
      <Sheet>
        <h2 className="h-title">{t('otp_title')}</h2>
        <p className="h-sub" style={{ marginBottom: 18 }}>{t('otp_subtitle', { phone: `+225 ${phone}` })}</p>
        <label className="otp-row">
          {Array.from({ length: N }, (_, i) => (
            <span key={i} className={`otp-box${actif && i === Math.min(code.length, N - 1) ? ' actif' : ''}`} aria-hidden="true">{code[i] ?? ''}</span>
          ))}
          <input ref={champ} className="otp-saisie" inputMode="numeric" pattern="[0-9]*" maxLength={N}
            autoComplete="one-time-code" aria-label={t('otp_label')} value={code} autoFocus
            onFocus={() => setActif(true)} onBlur={() => setActif(false)}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, N))} />
        </label>
        {devCode && <p className="otp-dev">{t('otp_dev', { code: devCode })}</p>}
        {erreur && <p className="photo-erreur" style={{ textAlign: 'center' }}>{erreur}</p>}
        <button className="btn btn-primary" style={{ marginTop: 16 }} disabled={!filled || enCours} onClick={() => void verifier()}>
          <IconCheck size={18} /> {t('otp_verify')}
        </button>
        <button className="btn btn-ghost" style={{ marginTop: 10 }} onClick={() => { setCode(''); champ.current?.focus(); void onResend().then(setErreur); }}>{t('otp_resend')}</button>
      </Sheet>
    </div>
  );
}

/* ------------------------------- Home -------------------------------- */
function MiniSvc({ illus, label, onClick }: { illus: React.ReactNode; label: string; onClick: () => void }) {
  const { t } = useI18n();
  return (
    <button className="svc-mini list-btn" onClick={onClick}>
      <span className="svc-mini-illus">{illus}</span>
      <span className="svc-mini-label">{label}</span>
      <span className="svc-soon">{t('soon_badge')}</span>
    </button>
  );
}

function HomeScreen({ announce, closed, deliveryOff, city, profil, onSearch, onCourse, onDelivery, onQuick, onAjouterLieu, onNav, onSoon, nonLus = 0, onMessages }: {
  /** Enregistrer le domicile ou le bureau du client. */
  onAjouterLieu: (quel: 'domicile' | 'bureau') => void;
  profil: ProfilClient | null;
  /** Messagerie ORION : bouton message (absent sans compte ni serveur). */
  nonLus?: number; onMessages?: () => void;
  announce: Announcement | null; closed: boolean; deliveryOff: boolean; city: string | null;
  onSearch: () => void; onCourse: () => void; onDelivery: () => void;
  onQuick: (p: Place) => void; onNav: (s: Screen) => void; onSoon: (name: string) => void;
}) {
  const { t } = useI18n();
  /*
   * Raccourcis : LE domicile et LE bureau du client (s'il les a enregistrés), ses trajets
   * récents, puis l'aéroport. Avant, tout le monde voyait le même « Domicile · Cocody »
   * écrit en dur : un client pouvait commander vers le domicile d'un inconnu.
   */
  const domicile = lieuEnregistre('home');
  const bureau = lieuEnregistre('work');
  const quick = [
    ...lieuxRecents().slice(0, 3),
    ...LIEUX_POPULAIRES.filter((p) => p.kind === 'hub').slice(0, 1),
  ];
  const [showAnnounce, setShowAnnounce] = useState(true);
  return (
    <div className="screen page hub">
      <div className="hub-hero">
        <div className="hub-top">
          <span className="hub-brand"><span className="hub-logo"><LogoGlyph size={20} /></span> ORION</span>
          <span className="hub-actions">
            {onMessages && <BoutonMessages nonLus={nonLus} onClick={onMessages} clair />}
            <button className="avatar hub-avatar" onClick={() => onNav('settings')} aria-label={t('set_title')}>
              {profil ? <Avatar photo={profil.photo} name={profil.name} size={40} /> : <IconSettings size={20} />}
            </button>
          </span>
        </div>
        <h2 className="hub-greet rise">{profil?.name ? t('home_greeting_name', { name: profil.name.split(' ')[0]! }) : t('home_greeting')}</h2>
        <button className="hub-search rise rise-2" onClick={onSearch}>
          <IconSearch size={20} /> <span>{t('home_search')}</span>
        </button>
        {/* Maintenance pilotée depuis la console : ORION momentanément fermé. */}
        {closed && (
          <div className="hub-closed rise rise-2" role="alert">
            <IconClock size={18} />
            <span className="col grow" style={{ textAlign: 'start' }}>
              <strong style={{ fontSize: 13 }}>{t('closed_title')}</strong>
              <span style={{ fontSize: 12, opacity: 0.9 }}>{city ? t('closed_body_city', { city }) : t('closed_body')}</span>
            </span>
          </div>
        )}
        {announce && showAnnounce && (
          <div className="hub-announce rise rise-2">
            <IconBell size={18} />
            <span className="col grow" style={{ textAlign: 'start' }}>
              <strong style={{ fontSize: 13 }}>{announce.title}</strong>
              <span style={{ fontSize: 12, opacity: 0.9 }}>{announce.body}</span>
            </span>
            <button className="hub-announce-x" onClick={() => setShowAnnounce(false)} aria-label="Fermer">✕</button>
          </div>
        )}
      </div>

      <div className="page-body hub-body">
        {/* Services principaux : Course & Livraison. La livraison se masque si la console
            l'a désactivée (services.delivery = false) ; tout est grisé en maintenance. */}
        <div className="svc-grid rise rise-2">
          <button className={`svc-card course${closed ? ' svc-off' : ''}`} onClick={onCourse} disabled={closed}>
            <span className="svc-illus"><Voiture modele="berline" peinture="accent" largeur={150} /></span>
            <span className="svc-meta"><strong>{t('svc_course')}</strong><span>{t('svc_course_d')}</span></span>
          </button>
          {!deliveryOff && (
            <button className={`svc-card deliver${closed ? ' svc-off' : ''}`} onClick={onDelivery} disabled={closed}>
              <span className="svc-illus"><Scooter largeur={150} /></span>
              <span className="svc-meta"><strong>{t('svc_delivery')}</strong><span>{t('svc_delivery_d')}</span></span>
            </button>
          )}
        </div>

        {/* Autres services (bientôt) */}
        <div className="svc-mini-grid rise rise-3">
          <MiniSvc illus={<IllusFood size={46} />} label={t('svc_food')} onClick={() => onSoon(t('svc_food'))} />
          <MiniSvc illus={<IllusShop size={46} />} label={t('svc_shop')} onClick={() => onSoon(t('svc_shop'))} />
          <MiniSvc illus={<IllusMarket size={46} />} label={t('svc_market')} onClick={() => onSoon(t('svc_market'))} />
          <MiniSvc illus={<IllusColis size={46} />} label={t('svc_colis')} onClick={() => onSoon(t('svc_colis'))} />
        </div>

        {/* Raccourcis ORION */}
        <div className="hub-quick rise rise-3">
          <button className="feature-card" onClick={() => onNav('subscription')}><i><IconCrown size={19} /></i> <span>{t('menu_subscription')}</span></button>
          <button className="feature-card" onClick={() => onNav('rental')}><i><IconCar size={19} /></i> <span>{t('rent_entry')}</span></button>
          <button className="feature-card" onClick={() => onNav('wedding')}><i><IconRing size={19} /></i> <span>{t('menu_wedding')}</span></button>
          <button className="feature-card" onClick={() => onNav('history')}><i><IconClock size={19} /></i> <span>{t('menu_history')}</span></button>
          <button className="feature-card" onClick={() => onNav('help')}><i><IconShield size={19} /></i> <span>{t('menu_help')}</span></button>
        </div>

        <span className="eyebrow" style={{ marginTop: 4 }}><IconPin size={13} /> {t('lieu_vos_lieux')}</span>
        <div className="stack" style={{ marginTop: 10 }}>
          {([['domicile', domicile], ['bureau', bureau]] as const).map(([quel, lieu]) => (
            <button key={quel} className="list-row list-btn" onClick={() => (lieu ? onQuick(lieu) : onAjouterLieu(quel))}>
              <span className="list-ico" style={{ color: 'var(--green)' }}>{quel === 'domicile' ? <IconHome size={20} /> : <IconBriefcase size={20} />}</span>
              <span className="col grow" style={{ textAlign: 'start', minWidth: 0 }}>
                <strong style={{ fontSize: 15 }}>{t(quel === 'domicile' ? 'lieu_domicile' : 'lieu_bureau')}</strong>
                <span className="faint" style={{ fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{lieu ? lieu.area || lieu.name : t(quel === 'domicile' ? 'lieu_ajouter_domicile' : 'lieu_ajouter_bureau')}</span>
              </span>
              {lieu ? <IconChevron size={18} color="var(--text-faint)" /> : <IconPlus size={18} color="var(--text-faint)" />}
            </button>
          ))}
          {quick.map((p) => (
            <button key={p.id} className="list-row list-btn" onClick={() => onQuick(p)}>
              <span className="list-ico" style={{ color: 'var(--green)' }}>{placeIcon(p.kind)}</span>
              <span className="col grow" style={{ textAlign: 'start' }}>
                <strong style={{ fontSize: 15 }}>{p.name}</strong>
                <span className="faint" style={{ fontSize: 13 }}>{p.area}</span>
              </span>
              <IconChevron size={18} color="var(--text-faint)" />
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

/* ----------------------------- Livraison ----------------------------- */
function DeliveryScreen({ origin, departAConfirmer, dropoff, pkgSize, onPickup, onDropoff, onBack, onConfirm }: {
  origin: Place; departAConfirmer: boolean; dropoff: Place | null; pkgSize: PkgSize;
  onPickup: () => void; onDropoff: () => void; onBack: () => void; onConfirm: (dropoff: Place, size: PkgSize) => void;
}) {
  const { t } = useI18n();
  const [size, setSize] = useState<PkgSize>(pkgSize);
  const quote = useMemo(() => (dropoff ? previewDelivery(origin.location, dropoff.location, size) : null), [dropoff, size, origin.location]);
  const sizes: PkgSize[] = ['petit', 'moyen', 'grand'];

  return (
    <div className="screen">
      <OrionMap origin={origin.location} destination={dropoff?.location ?? null} vehicle="moto" />
      <TopBar onBack={onBack} title={t('del_title')} />
      <div style={{ flex: 1 }} />
      <Sheet>
        <div className="del-head">
          <span className="svc-illus small"><Scooter largeur={92} /></span>
          <div className="col grow" style={{ textAlign: 'start' }}>
            <strong style={{ fontSize: 17 }}>{t('del_title')}</strong>
            <span className="faint" style={{ fontSize: 12.5 }}>{t('svc_delivery_d')}</span>
          </div>
        </div>

        {/* Retrait : le client le voit et peut le changer */}
        <LigneDepart origin={origin} aConfirmer={departAConfirmer} libelle={t('del_pickup')} onChange={onPickup} />

        {/* Dépôt */}
        <button className="list-row list-btn" style={{ width: '100%', padding: '8px 0' }} onClick={onDropoff}>
          <span className="list-ico" style={{ color: 'var(--gold)' }}>{dropoff ? <IconPin size={18} /> : <IconSearch size={18} />}</span>
          <span className="col grow" style={{ textAlign: 'start', minWidth: 0 }}>
            <strong style={{ fontSize: 14 }}>{dropoff ? dropoff.name : t('del_dropoff')}</strong>
            <span className="faint" style={{ fontSize: 12 }}>{dropoff ? dropoff.area : t('lieu_recherche')}</span>
          </span>
          {dropoff && <span className="faint" style={{ fontSize: 12, textDecoration: 'underline' }}>{t('del_change')}</span>}
        </button>

        {dropoff && (
          <>
            <span className="eyebrow" style={{ marginTop: 8 }}>{t('del_size')}</span>
            <div className="chips" style={{ margin: '10px 0 12px' }}>
              {sizes.map((s) => (
                <button key={s} className={`chip${s === size ? ' active' : ''}`} onClick={() => setSize(s)}>{t(`del_${s}`)}</button>
              ))}
            </div>
            {quote && (
              <div className="fare-total" style={{ marginBottom: 12 }}>
                <span className="row gap-sm"><TrafficBadge level={quote.trafficLevel} /><span className="muted">{t('conf_total')}</span></span>
                <span className="amt">{formatXOF(quote.amount)}</span>
              </div>
            )}
            {departAConfirmer ? (
              <button className="btn btn-primary" onClick={onPickup}><IconPin size={18} /> {t('lieu_confirmer_depart')}</button>
            ) : (
              <button className="btn btn-primary" onClick={() => onConfirm(dropoff, size)}>
                <IconBolt size={18} /> {t('del_cta')}
              </button>
            )}
            <p className="faint" style={{ textAlign: 'center', fontSize: 12, marginTop: 8 }}>{t('del_note')}</p>
          </>
        )}
      </Sheet>
    </div>
  );
}

/**
 * Le point de prise en charge, tel que le client le voit : d'où vient-il (GPS, choisi,
 * ou par défaut À CONFIRMER), et un bouton pour le changer.
 */
function LigneDepart({ origin, aConfirmer, libelle, onChange, droite }: { origin: Place; aConfirmer: boolean; libelle: string; onChange: () => void; droite?: React.ReactNode }) {
  const { t } = useI18n();
  const titre = aConfirmer ? t('lieu_a_confirmer') : origin.id === 'gps' ? `${origin.name} · ${origin.area}` : origin.name;
  return (
    <button className="list-row list-btn ligne-depart" style={{ width: '100%', padding: '8px 0' }} onClick={onChange} aria-label={`${libelle} : ${titre}. ${t('del_change')}`}>
      <span className="list-ico" style={{ color: aConfirmer ? 'var(--warn-ink, var(--gold))' : 'var(--green)' }}><IconPin size={18} /></span>
      <span className="col grow" style={{ textAlign: 'start', minWidth: 0 }}>
        <strong className="ligne-depart-titre">{titre}</strong>
        <span className="faint" style={{ fontSize: 12 }}>
          {aConfirmer ? <span className="ligne-depart-alerte">{t('lieu_a_confirmer_d')}</span> : libelle}
          {' · '}<span style={{ textDecoration: 'underline' }}>{t('del_change')}</span>
        </span>
      </span>
      {droite}
    </button>
  );
}

/* ----------------------------- Estimate ------------------------------ */
function TrafficBadge({ level }: { level: 'fluid' | 'dense' | 'jam' }) {
  const { t } = useI18n();
  const color = level === 'jam' ? '#ff4d5e' : level === 'dense' ? '#f5c451' : '#22c55e';
  const label = level === 'jam' ? t('traffic_jam') : level === 'dense' ? t('traffic_dense') : t('traffic_fluid');
  return <span className="badge" style={{ color, borderColor: `${color}66` }}><IconTraffic size={12} /> {label}</span>;
}

function EstimateScreen({ origin, destination, tier, onTier, bodyType, onBody, stops, onBack, onNext }: {
  origin: Place; destination: Place; tier: TierOption; onTier: (v: TierOption) => void;
  bodyType: 'suv' | 'berline'; onBody: (b: 'suv' | 'berline') => void; stops: Place[]; onBack: () => void; onNext: () => void;
}) {
  const { t } = useI18n();
  const stopLocs = stops.map((s) => s.location);
  const apercus = useMemo(
    () => Object.fromEntries(TIERS.map((v) => [v.id, previewQuote(origin.location, destination.location, v, { bodyType, stops: stopLocs }).amount])) as Record<string, number>,
    [origin.location, destination.location, bodyType, stops],
  );
  // PRIX FIXE : l'aperçu local s'affiche sans attendre, puis le prix du serveur le
  // remplace (zone, majoration, frais de prise en charge). Sans cela, la liste annonçait
  // un montant et l'écran de confirmation un autre.
  const [serveur, setServeur] = useState<{ prix: Record<string, number>; trafic?: 'fluid' | 'dense' | 'jam' } | null>(null);
  useEffect(() => {
    let annule = false;
    setServeur(null);
    void Promise.all(TIERS.map((v) => estimateWithCoverage(origin.location, destination.location, v, { bodyType, stops: stopLocs })))
      .then((devis) => {
        if (annule) return;
        setServeur({ prix: Object.fromEntries(TIERS.map((v, i) => [v.id, devis[i]!.quote.amount])), trafic: devis[0]?.quote.trafficLevel });
      })
      .catch(() => { /* hors ligne : l'aperçu local reste affiché */ });
    return () => { annule = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [origin.location, destination.location, bodyType, stops]);
  const prices = serveur?.prix ?? apercus;
  const traffic = serveur?.trafic ?? previewQuote(origin.location, destination.location, tier).trafficLevel;
  return (
    <div className="screen">
      <OrionMap origin={origin.location} destination={destination.location} stops={stopLocs} />
      <TopBar onBack={onBack} title={destination.name} />
      <div style={{ flex: 1 }} />
      <Sheet>
        <div className="row between" style={{ marginBottom: 10 }}>
          <span className="eyebrow">{t('est_choose')}</span>
          <span className="row gap-sm"><TrafficBadge level={traffic} /><span className="badge green"><IconClock size={12} /> {tier.eta} {t('est_min')}</span></span>
        </div>

        {/* Carrosserie : SUV ou Berline */}
        <div className="chips" style={{ marginBottom: 12 }}>
          {(['berline', 'suv'] as const).map((b) => (
            <button key={b} className={`chip${b === bodyType ? ' active' : ''}`} onClick={() => onBody(b)}>{t(`body_${b}`)}</button>
          ))}
        </div>

        <div className="stack">
          {TIERS.map((v) => (
            <button key={v.id} className={`veh${v.id === tier.id ? ' active' : ''}`} style={{ width: '100%', ...(v.id === tier.id ? { borderColor: v.accent, boxShadow: `0 0 22px ${v.accent}44` } : {}) }} onClick={() => onTier(v)}>
              <TierBadge tier={v.id} suv={bodyType === 'suv'} />
              <span className="col grow" style={{ textAlign: 'start' }}>
                <strong style={{ fontSize: 16 }}>{t(v.key)}</strong>
                <span className="faint" style={{ fontSize: 12.5 }}>{v.cars[0]}{v.cars.length > 1 ? ` +${v.cars.length - 1}` : ''} · {v.capacity} {t('seats')}</span>
              </span>
              <span className="price">{formatXOF(prices[v.id] ?? 0)}</span>
            </button>
          ))}
        </div>
        <button className="btn btn-primary" style={{ marginTop: 16 }} onClick={onNext}>
          {t('est_cta')} {t(tier.key)} · {t(`body_${bodyType}`)} <IconChevron size={18} />
        </button>
      </Sheet>
    </div>
  );
}

/* ------------------------------ Confirm ------------------------------ */
function ConfirmScreen({ origin, departAConfirmer, onDepart, destination, tier, bodyType = 'berline', quote, coverage, payment, payments, promo, onPromo, stops, onAddStop, onRemoveStop, scheduled, onSchedule, insurance, onInsurance, onPayment, onBack, onConfirm }: {
  bodyType?: 'suv' | 'berline';
  departAConfirmer: boolean; onDepart: () => void; onRemoveStop: (i: number) => void;
  origin: Place; destination: Place; tier: TierOption; quote: Quote | null; coverage: SubCoverage | null; payment: string;
  payments: { method: string; label: string }[]; promo: string; onPromo: (v: string) => void;
  stops: Place[]; onAddStop: () => void; scheduled: boolean; onSchedule: (v: boolean) => void;
  insurance: boolean; onInsurance: (v: boolean) => void;
  onPayment: (m: string) => void; onBack: () => void; onConfirm: () => void;
}) {
  const { t } = useI18n();
  const [showWhy, setShowWhy] = useState(false);
  const [showIns, setShowIns] = useState(false);
  const [promoDraft, setPromoDraft] = useState(promo);
  const discount = quote?.breakdown.discount ?? 0;
  return (
    <div className="screen">
      <OrionMap origin={origin.location} destination={destination.location} stops={stops.map((s) => s.location)} />
      <TopBar onBack={onBack} title={t('conf_title')} />
      <div style={{ flex: 1 }} />
      <Sheet>
        <div className="card" style={{ padding: 14, marginBottom: 12 }}>
          <LigneDepart origin={origin} aConfirmer={departAConfirmer} libelle={t('conf_departure')} onChange={onDepart}
            droite={<TierBadge tier={tier.id} size={32} suv={bodyType === 'suv'} />} />
          {stops.map((s, i) => (
            <div key={`${s.id}-${i}`}><div className="divider" /><div className="list-row" style={{ padding: '6px 0' }}>
              <span className="list-ico" style={{ color: 'var(--green)', fontSize: 12, fontWeight: 700 }}>{i + 1}</span>
              <span className="col grow" style={{ minWidth: 0 }}><strong style={{ fontSize: 14 }}>{s.name}</strong><span className="faint" style={{ fontSize: 12 }}>{s.area || t('p_stops')}</span></span>
              <button className="icon-btn" style={{ width: 36, height: 36 }} aria-label={t('lieu_retirer_arret')} onClick={() => onRemoveStop(i)}><IconMinus size={16} /></button>
            </div></div>
          ))}
          <div className="divider" />
          <div className="list-row" style={{ padding: '6px 0' }}>
            <span className="list-ico" style={{ color: 'var(--gold)' }}>{placeIcon(destination.kind)}</span>
            <span className="col grow"><strong style={{ fontSize: 14 }}>{destination.name}</strong><span className="faint" style={{ fontSize: 12 }}>{destination.area}</span></span>
          </div>
        </div>

        <div className="row gap-sm" style={{ marginBottom: 12 }}>
          <button className="btn btn-ghost" style={{ padding: 12, fontSize: 14 }} onClick={onAddStop}><IconPlus size={16} /> {t('act_addstop')}</button>
          <button className={`btn btn-ghost${scheduled ? '' : ''}`} style={{ padding: 12, fontSize: 14, ...(scheduled ? { borderColor: 'var(--green)', color: 'var(--green)' } : {}) }} onClick={() => onSchedule(!scheduled)}>
            <IconCalendar size={16} /> {t('sched_later')}
          </button>
        </div>
        {scheduled && <p className="faint" style={{ fontSize: 12, marginBottom: 12 }}>⏰ {t('sched_note')}</p>}

        {/* ORION Assurance (optionnelle, +2%) */}
        <div className="opt" style={{ marginBottom: 14, ...(insurance ? { borderColor: 'var(--green)', background: 'rgba(var(--accent-rgb),0.06)' } : {}) }}>
          <span className="list-ico" style={{ color: 'var(--green)' }}><IconShieldCheck size={18} /></span>
          <span className="col grow" style={{ textAlign: 'start' }}>
            <strong style={{ fontSize: 14 }}>{t('ins_toggle')}</strong>
            <button className="faint list-btn lien-cible" style={{ fontSize: 12, textDecoration: 'underline', textAlign: 'start' }} onClick={() => setShowIns(true)}>{t('ins_why')}</button>
          </span>
          <button className={`toggle${insurance ? ' on' : ''}`} role="switch" aria-checked={insurance} aria-label={t('ins_toggle')} onClick={() => onInsurance(!insurance)}><span /></button>
        </div>

        <span className="eyebrow">{t('conf_payment')}</span>
        <div className="chips" style={{ margin: '10px 0 14px' }}>
          {payments.map((p) => (
            <button key={p.method} className={`chip${p.method === payment ? ' active' : ''}`} onClick={() => onPayment(p.method)}>
              <IconWallet size={15} /> {p.label}
            </button>
          ))}
        </div>

        {/* Code promo (piloté depuis la console) : appliqué au devis côté serveur. */}
        <span className="eyebrow">{t('promo_label')}</span>
        <div className="row gap-sm" style={{ margin: '10px 0 14px' }}>
          {/* Le champ occupe la place restante ; le bouton garde sa largeur propre
              (sans cela, .btn { width: 100% } écrasait la saisie du code). */}
          <div className="field grow" style={{ padding: '10px 14px', minWidth: 0 }}>
            <IconGem size={16} />
            <input style={{ textTransform: 'uppercase', fontSize: 16, minWidth: 0 }} value={promoDraft}
              onChange={(e) => setPromoDraft(e.target.value.toUpperCase().replace(/\s/g, ''))}
              placeholder={t('promo_ph')} aria-label={t('promo_label')} maxLength={24} />
          </div>
          {promo && discount > 0
            ? <button className="btn btn-ghost" style={{ padding: '12px 16px', fontSize: 14, width: 'auto', flex: 'none', borderColor: 'var(--green)', color: 'var(--green)' }} onClick={() => { onPromo(''); setPromoDraft(''); }}>{t('promo_clear')}</button>
            : <button className="btn btn-ghost" style={{ padding: '12px 16px', fontSize: 14, width: 'auto', flex: 'none' }} onClick={() => onPromo(promoDraft.trim())} disabled={!promoDraft.trim()}>{t('promo_apply')}</button>}
        </div>
        {promo && (
          discount > 0
            ? <p className="faint" style={{ fontSize: 12, color: 'var(--green)', marginTop: -6, marginBottom: 12 }}>✓ {t('promo_ok', { code: promo, amount: formatXOF(discount) })}</p>
            : <p className="faint" style={{ fontSize: 12, marginTop: -6, marginBottom: 12 }}>{t('promo_none', { code: promo })}</p>
        )}

        {quote && (
          <>
            <button className="row between list-btn" style={{ width: '100%' }} onClick={() => setShowWhy((v) => !v)}>
              <span className="row gap-sm"><TrafficBadge level={quote.trafficLevel} /><span className="faint" style={{ fontSize: 12, textDecoration: 'underline' }}>{t('why_price')}</span></span>
              <IconChevron size={16} color="var(--text-faint)" />
            </button>
            {showWhy && (
              <div style={{ marginTop: 8 }}>
                <div className="fare-line"><span>{t('p_base')}</span><span>{formatXOF(quote.breakdown.base)}</span></div>
                <div className="fare-line"><span>{t('p_distance')} · {(quote.distanceMeters / 1000).toFixed(1)} km</span><span>{formatXOF(quote.breakdown.distance)}</span></div>
                <div className="fare-line"><span>{t('p_time')} · ~{Math.round(quote.etaSeconds / 60)} {t('est_min')}</span><span>{formatXOF(quote.breakdown.time)}</span></div>
                {quote.breakdown.traffic > 0 && <div className="fare-line"><span>{t('p_traffic')}</span><span>+{formatXOF(quote.breakdown.traffic)}</span></div>}
                {quote.breakdown.discount > 0 && <div className="fare-line" style={{ color: 'var(--green)' }}><span>{t('promo_line')}</span><span>−{formatXOF(quote.breakdown.discount)}</span></div>}
                <div className="fare-line"><span>{t('p_subtotal')}</span><span>{formatXOF(quote.breakdown.subtotal)}</span></div>
                <div className="fare-line"><span>{t('p_tva')}</span><span>{formatXOF(quote.breakdown.tva)}</span></div>
                <div className="fare-line"><span>{t('p_fee')}</span><span>{formatXOF(quote.breakdown.fee)}</span></div>
                {quote.breakdown.insurance > 0 && <div className="fare-line"><span>{t('ins_line')}</span><span>{formatXOF(quote.breakdown.insurance)}</span></div>}
              </div>
            )}
            <div className="divider" style={{ margin: '8px 0' }} />
            {/* ABONNEMENT ORION : ce que le forfait prend en charge sur CETTE course.
                Affiché avant la commande, pour que le client sache ce qu'il paiera —
                le quota, lui, n'est débité qu'à la confirmation. */}
            {coverage?.covered && (
              <div className="fare-line" style={{ color: 'var(--green)' }}>
                <span><IconCrown size={12} /> {coverage.aPayer > 0
                  ? t('sub_coveredPartial', { amount: formatXOF(coverage.montantCouvert), rest: formatXOF(coverage.aPayer) })
                  : t('sub_covered')}</span>
                <span>-{formatXOF(coverage.montantCouvert)}</span>
              </div>
            )}
            {!coverage?.covered && coverage && coverage.remise > 0 && (
              <div className="fare-line" style={{ color: 'var(--green)' }}>
                <span><IconCrown size={12} /> {t('sub_memberDiscount', { amount: formatXOF(coverage.remise) })}</span>
                <span>-{formatXOF(coverage.remise)}</span>
              </div>
            )}
            <div className="fare-total">
              <span className="col" style={{ alignItems: 'flex-start' }}>
                <span className="muted">{t('conf_total')}</span>
                <span className="badge green" style={{ fontSize: 10, marginTop: 4 }}><IconShieldCheck size={11} /> {t('fixed_badge')}</span>
              </span>
              <span className="amt">{formatXOF(Math.max(0, quote.amount - (coverage?.montantCouvert ?? 0) - (coverage?.remise ?? 0)))}</span>
            </div>
          </>
        )}
        {/* Avantage à bord : Wi-Fi gratuit illimité */}
        <div className="perk" style={{ marginTop: 12 }}>
          <span className="list-ico" style={{ color: 'var(--green)' }}><IconWifi size={18} /></span>
          <span className="grow" style={{ textAlign: 'start', fontSize: 13, fontWeight: 600 }}>{t('wifi_free')}</span>
          <span className="badge green" style={{ fontSize: 10 }}>GRATUIT</span>
        </div>
        {departAConfirmer ? (
          <button className="btn btn-primary" style={{ marginTop: 14 }} onClick={onDepart}><IconPin size={18} /> {t('lieu_confirmer_depart')}</button>
        ) : (
          <button className="btn btn-primary" style={{ marginTop: 14 }} onClick={onConfirm}>{scheduled ? t('sched_set') : t('conf_confirm')}</button>
        )}
        <p className="faint" style={{ textAlign: 'center', fontSize: 12, marginTop: 8 }}>{t('conf_locked')}</p>
      </Sheet>

      {showIns && (
        <div className="modal-backdrop" onClick={() => setShowIns(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="logo-mark" style={{ width: 52, height: 52, color: '#fff', marginBottom: 12 }}><IconShieldCheck size={26} /></div>
            <h2 className="h-title">{t('ins_toggle')}</h2>
            <p className="h-sub" style={{ marginTop: 8 }}>{t('ins_desc')}</p>
            <button className="btn btn-primary" style={{ marginTop: 18 }} onClick={() => { onInsurance(true); setShowIns(false); }}>{t('ins_toggle')} (+2%)</button>
            <button className="btn btn-ghost" style={{ marginTop: 10 }} onClick={() => setShowIns(false)}>{t('ins_got')}</button>
          </div>
        </div>
      )}
    </div>
  );
}

/* ----------------------------- Searching ----------------------------- */
function SearchingScreen({ origin, destination, mode = 'ride', onCancel }: { origin: Place; destination: Place; mode?: 'ride' | 'delivery'; onCancel: () => void }) {
  const { t } = useI18n();
  const del = mode === 'delivery';
  return (
    <div className="screen">
      <OrionMap origin={origin.location} destination={destination.location} vehicle={del ? 'moto' : 'car'} />
      <TopBar />
      <div style={{ flex: 1 }} />
      <Sheet>
        <div className="radar"><span className="ring" /><span className="ring" /><span className="ring" /><span className="core">{del ? <IconBolt size={26} /> : <IconLeaf size={28} />}</span></div>
        <h2 className="h-title" style={{ textAlign: 'center' }}>{del ? t('del_searching') : t('search_title')}</h2>
        <p className="h-sub" style={{ textAlign: 'center', marginTop: 6 }}>{del ? t('del_searching_sub') : t('search_sub')}</p>
        <button className="btn btn-ghost" style={{ marginTop: 18 }} onClick={onCancel}>{t('search_cancel')}</button>
      </Sheet>
    </div>
  );
}

/* ----------------------------- Tracking ------------------------------ */
function TrackingScreen({ origin, destination, driver, tier, phase, mode = 'ride', carPos, setCarPos, setPhase, live, rideId, stops, onSos, onShare, onArrived, onCancel, onReassigned, onServerCancel, onMessage, messages }: {
  origin: Place; destination: Place; driver: Driver; tier: TierOption; phase: TripPhase; mode?: 'ride' | 'delivery';
  carPos: LatLng | null; setCarPos: (p: LatLng) => void; setPhase: (p: TripPhase) => void;
  live: boolean; rideId: string | null; stops: Place[]; onSos: () => void; onShare: () => void; onArrived: () => void; onCancel: () => void;
  /** Synchro app chauffeur : nouveau chauffeur (refus / délai dépassé / console). */
  onReassigned?: (d: SafeDriver) => void;
  /** Course annulée côté serveur (aucun chauffeur disponible, clôture console). */
  onServerCancel?: () => void;
  /** Messagerie ORION : message reçu en direct pendant la course. */
  onMessage?: (m: MessageOrion) => void;
  /** Bouton message dans la barre du haut. */
  messages?: { nonLus: number; ouvrir: () => void };
}) {
  const { t } = useI18n();
  const del = mode === 'delivery';
  // BOUTON « APPELER » : le numéro du chauffeur vient du serveur (aux seuls participants,
  // pendant la course). Le bouton est un vrai lien tel: : un toucher ouvre le clavier du
  // téléphone avec le numéro composé ; il ne reste qu'à appuyer sur la touche d'appel.
  const [contact, setContact] = useState<{ nom: string; telephone: string; lien: string } | null>(null);
  const [avisAppel, setAvisAppel] = useState<string | null>(null);
  useEffect(() => {
    if (!live || !rideId) return;
    let actif = true;
    void contactCourse(rideId).then((c) => { if (actif && c) setContact(c); });
    return () => { actif = false; };
  }, [live, rideId, phase]);
  const appeler = async () => {
    if (!live || !rideId) { setAvisAppel(t('call_demo')); return; }
    const c = contact ?? await contactCourse(rideId);
    if (!c) { setAvisAppel(t('call_indispo')); return; }
    setContact(c);
    setAvisAppel(null);
    ouvrirClavier(c.lien);
  };
  const progressRef = useRef(0);
  // CODE DE PRISE EN CHARGE : affiché au passager pendant l'approche ; le chauffeur le
  // saisit pour démarrer. Démonstration sans serveur : un code local, validé au départ.
  const [code, setCode] = useState<string | null>(null);
  const [codeEtat, setCodeEtat] = useState<'attente' | 'ok' | 'bloque'>('attente');
  useEffect(() => {
    if (del) return;
    if (!live || !rideId) { setCode(String(1000 + Math.floor(Math.random() * 9000))); return; }
    void lireCodePriseEnCharge(rideId).then((c) => { if (c) { setCode(c.code); if (c.verifie) setCodeEtat('ok'); } });
  }, [del, live, rideId]);
  useEffect(() => { if (!live && phase === 'inprogress') setCodeEtat('ok'); }, [live, phase]);
  const driverStart = useMemo<LatLng>(() => ({ lat: origin.location.lat - 0.018, lng: origin.location.lng - 0.012 }), [origin.location]);

  useEffect(() => {
    if (!live || !rideId) return;
    const url = rideSocketUrl(rideId);
    if (!url) return;
    const ws = new WebSocket(url);
    ws.onmessage = (ev) => {
      try {
        const m = JSON.parse(ev.data as string) as { type: string; data: { position?: LatLng; status?: string; driver?: SafeDriver | null } };
        if (m.type === 'driver.location' && m.data.position) setCarPos(m.data.position);
        if (m.type === 'ride.reassigned' && m.data.driver) onReassigned?.(m.data.driver);
        if (m.type === 'message') onMessage?.(m.data as unknown as MessageOrion);
        if (m.type === 'ride.code') {
          const d = m.data as unknown as { resultat?: string; bloque?: boolean };
          if (d.resultat === 'verifie') setCodeEtat('ok');
          else if (d.bloque) setCodeEtat('bloque');
        }
        if (m.type === 'ride.status') {
          const s = m.data.status;
          if (s === 'cancelled') onServerCancel?.();
          if (s === 'driver_en_route') setPhase('enroute');
          else if (s === 'arrived') setPhase('arrived');
          else if (s === 'in_progress') setPhase('inprogress');
          else if (s === 'completed') { setPhase('completed'); onArrived(); }
        }
      } catch { /* ignore */ }
    };
    return () => ws.close();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [live, rideId]);

  useEffect(() => {
    if (live) return;
    progressRef.current = 0;
    const durations: Record<TripPhase, number> = { enroute: 6000, arrived: 1800, inprogress: 9000, completed: 0 };
    const from = phase === 'inprogress' ? origin.location : driverStart;
    const to = phase === 'inprogress' ? destination.location : origin.location;
    setCarPos(from);
    // Démonstration : le véhicule suit lui aussi les vraies routes dès que l'itinéraire arrive.
    let trace: LatLng[] = [from, to];
    void itineraire([from, to]).then((r) => { if (r) trace = r.geometrie; });
    const start = Date.now();
    const id = window.setInterval(() => {
      const tt = Math.min(1, (Date.now() - start) / durations[phase]);
      setCarPos(pointSurTrace(trace, tt));
      if (tt >= 1) {
        window.clearInterval(id);
        if (phase === 'enroute') setPhase('arrived');
        else if (phase === 'arrived') setPhase('inprogress');
        else if (phase === 'inprogress') { setPhase('completed'); onArrived(); }
      }
    }, 120);
    return () => window.clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, live]);

  const banner = phase === 'enroute' ? `${driver.name} ${t('track_arrives')} · ${tier.eta} ${t('est_min')}`
    : phase === 'arrived' ? (del ? t('del_picked') : t('track_arrived'))
    : (del ? t('del_enroute') : t('track_enroute'));
  const eta = phase === 'inprogress' ? `${t('track_dest')} · ${destination.name}` : (del ? t('del_meeting') : t('track_meeting'));

  return (
    <div className="screen">
      <OrionMap origin={origin.location} destination={destination.location} stops={stops.map((s) => s.location)} car={carPos} vehicle={del ? 'moto' : 'car'} approche={phase === 'enroute'} />
      <TopBar title={t('track_title')} right={messages ? <BoutonMessages nonLus={messages.nonLus} onClick={messages.ouvrir} /> : undefined} />
      <button className="sos" onClick={onSos} aria-label="SOS">SOS</button>
      <div style={{ flex: 1 }} />
      <Sheet>
        <div className="row between" style={{ marginBottom: 12 }}>
          <span className="badge green"><IconShield size={13} /> {banner}</span>
          <span className="faint" style={{ fontSize: 12 }}>{eta}</span>
        </div>
        {!del && code && codeEtat === 'attente' && (phase === 'enroute' || phase === 'arrived') && (
          <div className={`code-prise${phase === 'arrived' ? ' maintenant' : ''}`} role="status" aria-live="polite">
            <div className="code-prise-texte">
              <span className="code-prise-titre"><IconShieldCheck size={15} /> {t('code_titre')}</span>
              <span className="code-prise-aide">{t('code_aide')}</span>
            </div>
            <div className="code-prise-chiffres" aria-label={`${t('code_titre')} : ${code.split('').join(' ')}`}>
              {code.split('').map((c, i) => <span key={i}>{c}</span>)}
            </div>
          </div>
        )}
        {!del && codeEtat === 'ok' && (phase === 'arrived' || phase === 'inprogress') && (
          <div className="code-prise-ok" role="status"><IconShieldCheck size={16} /> {t('code_ok')}</div>
        )}
        {!del && codeEtat === 'bloque' && (
          <div className="code-prise-bloque" role="alert">{t('code_bloque')}</div>
        )}
        {/* Fiche chauffeur : photo, nom & prénom, note, matricule ORION */}
        <div className="card" style={{ padding: 14, marginBottom: 12 }}>
          <div className="row">
            <PhotoChauffeur driver={driver} style={{ color: tier.accent }} />
            <span className="col grow">
              <strong style={{ fontSize: 16 }}>{driver.name}</strong>
              <span className="row gap-sm" style={{ fontSize: 13 }}><IconStar size={14} color="#f5c451" /> {driver.rating} · {driver.trips.toLocaleString('fr-FR')}</span>
              <span className="faint" style={{ fontSize: 12, marginTop: 2 }}>{driver.car || tier.cars[0]}{del ? '' : ` · ${t(tier.key)}`}</span>
            </span>
            <span className="col drv-vehicule">
              {del
                ? <span className="veh-illus" style={{ width: 60, height: 34 }}><Scooter largeur={60} /></span>
                : <TierBadge tier={tier.id} size={34} />}
              <span className="plate">{driver.plate}</span>
            </span>
          </div>
          <div className="divider" style={{ margin: '12px 0' }} />
          <div className="row between">
            <span className="row gap-sm" style={{ fontSize: 13 }}>
              <span className="list-ico" style={{ width: 30, height: 30, color: 'var(--green)' }}><IconShieldCheck size={16} /></span>
              <span className="col">
                <span className="faint" style={{ fontSize: 11 }}>{t('drv_matricule')}</span>
                <strong style={{ fontSize: 13, letterSpacing: '0.04em' }}>{driver.matricule}</strong>
              </span>
            </span>
            <span className="badge green" style={{ fontSize: 11 }}>ORION</span>
          </div>
        </div>

        <div className="row gap-sm">
          <button className="btn btn-ghost" onClick={onShare}><IconShare size={18} /> {t('track_share')}</button>
          <a className="btn btn-primary" href={contact?.lien ?? '#appeler'} data-testid="bouton-appeler"
            aria-label={contact ? `${t('track_call')} ${contact.nom} ${numeroLisible(contact.telephone)}` : t('track_call')}
            onClick={(e) => { if (!contact) { e.preventDefault(); void appeler(); } }} style={{ textDecoration: 'none' }}>
            <IconPhone size={18} /> {t('track_call')}
          </a>
        </div>
        <p className="faint" style={{ fontSize: 11, textAlign: 'center', marginTop: 6 }} role={avisAppel ? 'status' : undefined}>
          {avisAppel ?? (contact ? `📞 ${numeroLisible(contact.telephone)} · ${t('call_clavier')}` : t('call_clavier'))}
        </p>

        {(phase === 'enroute' || phase === 'arrived') && (
          <button className="btn btn-danger" style={{ marginTop: 10 }} onClick={onCancel}>{t(del ? 'act_cancel_liv' : 'act_cancel')}</button>
        )}
        {!del && (
          <div className="perk" style={{ marginTop: 12 }}>
            <span className="list-ico" style={{ color: 'var(--green)' }}><IconWifi size={18} /></span>
            <span className="grow" style={{ textAlign: 'start', fontSize: 13, fontWeight: 600 }}>{t('wifi_free')}</span>
            <span className="badge green" style={{ fontSize: 10 }}>À BORD</span>
          </div>
        )}
        <div className="supervised-card">
          <span className="supervised-ico"><IconShield size={16} /></span>
          <span>{t('drv_supervised')}</span>
        </div>
      </Sheet>

    </div>
  );
}

/* ------------------------------ Rating ------------------------------- */
function RatingScreen({ origin, driver, quote, payment, destination, rating, setRating, onDone, livraison = false }: {
  origin: Place; driver: Driver; quote: Quote | null; payment: string; destination: Place; rating: number; setRating: (n: number) => void; onDone: () => void;
  /** Livraison à moto : « Livraison terminée » plutôt que « Course terminée ». */
  livraison?: boolean;
}) {
  const { t } = useI18n();
  const [tip, setTip] = useState(0);
  const payLabel = PAYMENTS.find((p) => p.method === payment)?.label ?? payment;
  return (
    <div className="screen">
      <OrionMap origin={origin.location} destination={destination.location} />
      <TopBar title={t(livraison ? 'rate_done_liv' : 'rate_done')} />
      <div style={{ flex: 1 }} />
      <Sheet>
        <div className="col" style={{ alignItems: 'center', marginBottom: 8 }}>
          <PhotoChauffeur driver={driver} style={{ width: 64, height: 64, fontSize: 24 }} />
          <h2 className="h-title" style={{ marginTop: 10 }}>{t('rate_notez')} {driver.name}</h2>
          <p className="faint" style={{ fontSize: 13 }}>{driver.car} · {driver.plate}</p>
        </div>
        <div className="stars" style={{ margin: '8px 0 16px' }}>
          {[1, 2, 3, 4, 5].map((n) => (
            <span key={n} className="star" onClick={() => setRating(n)}><IconStar size={38} color={n <= rating ? '#f5c451' : 'var(--stroke-strong)'} /></span>
          ))}
        </div>
        <span className="eyebrow">{t('rate_tip')}</span>
        <div className="chips" style={{ margin: '10px 0 14px' }}>
          {[0, 200, 500, 1000].map((tv) => (
            <button key={tv} className={`chip${tv === tip ? ' active' : ''}`} onClick={() => setTip(tv)}>{tv === 0 ? t('rate_none') : formatXOF(tv)}</button>
          ))}
        </div>
        <div className="card" style={{ padding: 14, marginBottom: 14 }}>
          {tip > 0 && <div className="fare-line"><span>{t('rate_tip')}</span><span>{formatXOF(tip)}</span></div>}
          <div className="fare-total"><span className="muted">{t('rate_paid')} · {payLabel}</span><span className="amt">{formatXOF((quote?.amount ?? 0) + tip)}</span></div>
        </div>
        <button className="btn btn-primary" disabled={rating === 0} onClick={onDone}><IconCheck size={18} /> {t('rate_finish')}</button>
      </Sheet>
    </div>
  );
}

/* ------------------------------ Settings ----------------------------- */
/* --------------------------- Subscription ----------------------------
 *
 * Écran BRANCHÉ au serveur. Il affichait auparavant un simple état local : choisir
 * un forfait ne créait aucun abonnement, ne débitait rien et n'ouvrait aucun droit.
 * Désormais la souscription part à l'API, et l'écran rend compte de la réalité :
 * quota du jour, échéance, plafond par course, facture à régler, valeur déjà rendue.
 */
function SubscriptionScreen({ onBack, onToast }: { onBack: () => void; onToast: (m: string, d?: boolean) => void }) {
  const { t } = useI18n();
  const [etat, setEtat] = useState<SubState | null>(null);
  /** Forfaits tels que le serveur les définit : plafonds, niveaux couverts, remises. */
  const [plansServeur, setPlansServeur] = useState<SubPlanInfo[] | null>(null);
  const [envoi, setEnvoi] = useState<string | null>(null);

  const charger = () => { void fetchSubscription(clientId()).then((e) => { if (e) setEtat(e); }); };
  useEffect(() => { charger(); void fetchSubPlans().then(setPlansServeur); }, []);

  const souscrire = async (plan: string) => {
    setEnvoi(plan);
    const e = await subscribePlan(clientId(), plan);
    setEnvoi(null);
    // Hors ligne, rien n'a été créé côté serveur : on ne fait pas croire le contraire.
    if (!e) { onToast(t('sub_offline'), true); return; }
    setEtat(e);
    onToast(t('toast_subscribed'));
  };

  const regler = async (invoiceId: string) => {
    setEnvoi(invoiceId);
    const f = await paySubscriptionInvoice(invoiceId, 'wave');
    setEnvoi(null);
    if (!f) { onToast(t('sub_offline'), true); return; }
    onToast(f.status === 'payee' ? t('sub_invoicePaid') : f.status === 'echouee' ? t('sub_invoiceFailed') : t('sub_invoicePending', { amount: formatXOF(f.amount) }), f.status === 'echouee');
    charger();
  };

  const resilier = async () => {
    const ok = await cancelSubscription(clientId());
    if (!ok) { onToast(t('sub_offline'), true); return; }
    onToast(t('sub_cancelled'));
    charger();
  };

  const actif = etat?.subscription && etat.subscription.active && !etat.echu ? etat.subscription : null;
  const facture = etat?.factureEnAttente ?? null;
  const planServeur = (id: string) => plansServeur?.find((p) => p.id === id) ?? (etat?.plan?.id === id ? etat.plan : null);

  return (
    <div className="screen page">
      <TopBar onBack={onBack} title={t('sub_title')} />
      <div className="page-body">
        <h2 className="h-title">{t('sub_title')}</h2>
        <p className="h-sub" style={{ marginBottom: 16 }}>{t('sub_subtitle')}</p>

        {/* État réel de l'abonnement : ce qui reste aujourd'hui, et ce qu'il a rapporté. */}
        {etat?.subscription && (
          <div className="card" style={{ marginBottom: 16 }}>
            <div className="row between">
              <strong style={{ fontSize: 14.5 }}>{etat.plan?.label ?? etat.subscription.plan}</strong>
              <span className="badge green">
                {actif ? t('sub_quotaToday', { n: String(etat.restantesAujourdhui) }) : etat.echu ? t('sub_expired') : t('sub_suspended')}
              </span>
            </div>
            <div className="divider" style={{ margin: '10px 0' }} />
            {actif && etat.restantesAujourdhui === 0 && (
              <div className="fare-line"><span>{t('sub_quotaNone')}</span><span /></div>
            )}
            <div className="fare-line"><span>{t('sub_renews', { n: String(etat.joursRestants) })}</span><span /></div>
            {etat.plan && <div className="fare-line"><span>{t('sub_cap', { amount: formatXOF(etat.plan.perRideCap) })}</span><span /></div>}
            {etat.subscription.coursesCouvertes > 0 && (
              <div className="fare-line" style={{ color: 'var(--green)' }}>
                <span>{t('sub_value', { n: String(etat.subscription.coursesCouvertes), amount: formatXOF(etat.subscription.totalCouvert) })}</span><span />
              </div>
            )}
            {facture && (
              <>
                <div className="divider" style={{ margin: '10px 0' }} />
                <div className="row between" style={{ marginBottom: 10 }}>
                  <span className="muted" style={{ fontSize: 13 }}>{t('sub_invoicePending', { amount: formatXOF(facture.amount) })}</span>
                </div>
                <button className="btn btn-primary" disabled={envoi === facture.id} onClick={() => void regler(facture.id)}>
                  <IconWallet size={16} /> {t('sub_invoicePay')}
                </button>
              </>
            )}
          </div>
        )}

        <div className="stack">
          {SUB_PLANS.map((p: SubPlan) => {
            const active = actif?.plan === p.id;
            const srv = planServeur(p.id);
            const avantages = srv?.benefits ?? p.benefits;
            return (
              <div key={p.id} className="plan-card" style={{ borderColor: active ? p.accent : 'var(--stroke)', boxShadow: active ? `0 0 24px ${p.accent}44` : 'none' }}>
                <div className="row between">
                  <div className="row gap-sm">
                    <span className="veh-ico" style={{ width: 42, height: 42, color: p.accent }}><IconCrown size={22} /></span>
                    <div className="col">
                      <strong style={{ fontSize: 17 }}>{srv?.label ?? (p.id === 'gold' ? 'Pack Gold' : `Pack ${t(p.key)}`)}</strong>
                      <span className="faint" style={{ fontSize: 12.5 }}>{srv?.ridesPerDay ?? p.ridesPerDay} {t('sub_perDay')}</span>
                    </div>
                  </div>
                  <div className="col" style={{ alignItems: 'flex-end' }}>
                    <span className="price">{formatXOF(srv?.monthlyPrice ?? p.monthlyPrice)}</span>
                    <span className="faint" style={{ fontSize: 11 }}>{t('sub_perMonth')}</span>
                  </div>
                </div>
                <div className="divider" style={{ margin: '12px 0' }} />
                <div className="stack" style={{ gap: 6 }}>
                  {avantages.map((b, i) => (
                    <div key={i} className="row gap-sm" style={{ fontSize: 13 }}><IconCheck size={15} color={p.accent} /> <span className="muted">{b}</span></div>
                  ))}
                </div>
                <button
                  className="btn btn-primary"
                  style={{ marginTop: 14, background: active ? 'var(--surface-2)' : undefined, color: active ? 'var(--text)' : undefined, boxShadow: active ? 'none' : undefined }}
                  disabled={active || envoi === p.id}
                  onClick={() => void souscrire(p.id)}
                >
                  {active ? t('sub_current') : t('sub_choose')}
                </button>
              </div>
            );
          })}
        </div>

        {etat?.subscription && !etat.subscription.cancelledAt && (
          <button className="btn btn-ghost" style={{ marginTop: 16 }} onClick={() => void resilier()}>{t('sub_cancelPlan')}</button>
        )}
      </div>
    </div>
  );
}

/* ------------------------------ Wedding ------------------------------ */
function WeddingScreen({ onBack, onReserve }: { onBack: () => void; onReserve: () => void }) {
  const { t } = useI18n();
  const [tier, setTier] = useState<TierOption>(tierById('or'));
  const [duration, setDuration] = useState<WeddingDuration>('fullday');
  const [decoration, setDecoration] = useState(true);
  const [convoy, setConvoy] = useState(0);

  const total = useMemo(() => {
    const vehicle = Math.round(tier.weddingDayPrice * (WEDDING_DURATION_FACTOR[duration] ?? 1));
    const deco = decoration ? WEDDING_FEES.decoration : 0;
    return vehicle + deco + convoy * WEDDING_FEES.convoyPerCar;
  }, [tier, duration, decoration, convoy]);

  const durations: WeddingDuration[] = ['halfday', 'fullday', 'weekend'];

  return (
    <div className="screen page">
      <TopBar onBack={onBack} title={t('wed_title')} />
      <div className="page-body">
        <h2 className="h-title">{t('wed_title')}</h2>
        <p className="h-sub" style={{ marginBottom: 16 }}>{t('wed_subtitle')}</p>

        <span className="eyebrow">{t('wed_vehicle')}</span>
        <div className="stack" style={{ margin: '10px 0 18px' }}>
          {TIERS.map((v) => (
            <button key={v.id} className={`veh${v.id === tier.id ? ' active' : ''}`} style={v.id === tier.id ? { borderColor: v.accent, boxShadow: `0 0 22px ${v.accent}44` } : {}} onClick={() => setTier(v)}>
              <TierBadge tier={v.id} />
              <span className="col grow" style={{ textAlign: 'start' }}>
                <strong style={{ fontSize: 15 }}>{t(v.key)}</strong>
                <span className="faint" style={{ fontSize: 12 }}>{v.cars.join(' · ')}</span>
              </span>
              <span className="price" style={{ fontSize: 15 }}>{formatXOF(v.weddingDayPrice)}</span>
            </button>
          ))}
        </div>

        <span className="eyebrow">{t('wed_duration')}</span>
        <div className="chips" style={{ margin: '10px 0 18px' }}>
          {durations.map((d) => (
            <button key={d} className={`chip${d === duration ? ' active' : ''}`} onClick={() => setDuration(d)}>
              <IconCalendar size={15} /> {t(`wed_${d}`)}
            </button>
          ))}
        </div>

        <div className="opt" style={{ marginBottom: 10 }}>
          <span className="grow" style={{ textAlign: 'start' }}>{t('wed_decoration')}</span>
          <button className={`toggle${decoration ? ' on' : ''}`} role="switch" aria-checked={decoration} aria-label={t('wed_decoration')} onClick={() => setDecoration((v) => !v)}><span /></button>
        </div>
        <div className="opt" style={{ marginBottom: 18 }}>
          <span className="grow" style={{ textAlign: 'start' }}>{t('wed_convoy')}</span>
          <div className="row gap-sm">
            <button className="step" onClick={() => setConvoy((c) => Math.max(0, c - 1))}><IconMinus size={16} /></button>
            <strong style={{ minWidth: 18, textAlign: 'center' }}>{convoy}</strong>
            <button className="step" onClick={() => setConvoy((c) => Math.min(8, c + 1))}><IconPlus size={16} /></button>
          </div>
        </div>

        <div className="fare-total" style={{ marginBottom: 14 }}><span className="muted">{t('wed_total')}</span><span className="amt">{formatXOF(total)}</span></div>
        <button className="btn btn-primary" onClick={onReserve}><IconRing size={18} /> {t('wed_reserve')}</button>
      </div>
    </div>
  );
}

/* -------------------------------- Aide ------------------------------- */
function HelpScreen({ onBack, onSupport }: { onBack: () => void; onSupport: () => void }) {
  const { t } = useI18n();
  const numbers = [
    { label: 'SAMU', num: '185' },
    { label: t('help_police'), num: '170' },
    { label: t('help_fire'), num: '180' },
  ];
  const faq = [1, 2, 3].map((i) => ({ q: t(`help_q${i}`), a: t(`help_a${i}`) }));
  const [open, setOpen] = useState<number | null>(0);
  return (
    <div className="screen page">
      <TopBar onBack={onBack} title={t('help_title')} />
      <div className="page-body">
        <button className="btn btn-primary" style={{ marginBottom: 18 }} onClick={onSupport}>
          <IconBell size={18} /> {t('sup_cta')}
        </button>
        <span className="eyebrow"><IconShield size={13} /> {t('help_emergency')}</span>
        <div className="stack" style={{ margin: '10px 0 20px' }}>
          {numbers.map((n) => (
            <a key={n.num} className="opt list-btn" href={`tel:${n.num}`} style={{ textDecoration: 'none' }}>
              <span className="list-ico" style={{ color: '#ff4d5e' }}><IconPhone size={18} /></span>
              <span className="grow" style={{ textAlign: 'start', fontWeight: 600 }}>{n.label}</span>
              <span className="plate">{n.num}</span>
            </a>
          ))}
        </div>

        <span className="eyebrow">{t('help_contact')}</span>
        <div className="stack" style={{ margin: '10px 0 20px' }}>
          <a className="opt list-btn" href="mailto:support@orion.ci" style={{ textDecoration: 'none' }}>
            <span className="list-ico" style={{ color: 'var(--green)' }}><IconBell size={18} /></span>
            <span className="grow" style={{ textAlign: 'start' }}>support@orion.ci</span>
          </a>
          <a className="opt list-btn" href="tel:+2252700000000" style={{ textDecoration: 'none' }}>
            <span className="list-ico" style={{ color: 'var(--green)' }}><IconPhone size={18} /></span>
            <span className="grow" style={{ textAlign: 'start' }}>+225 27 00 00 00 00</span>
          </a>
        </div>

        <span className="eyebrow">{t('help_faq')}</span>
        <div className="stack" style={{ margin: '10px 0 20px' }}>
          {faq.map((f, i) => (
            <div key={i} className="card" style={{ padding: 0, overflow: 'hidden' }}>
              <button className="list-btn row between" style={{ width: '100%', padding: 14 }} onClick={() => setOpen(open === i ? null : i)}>
                <strong style={{ fontSize: 14, textAlign: 'start' }}>{f.q}</strong>
                <IconChevron size={16} color="var(--text-faint)" />
              </button>
              {open === i && <p className="faint" style={{ fontSize: 13, padding: '0 14px 14px', margin: 0 }}>{f.a}</p>}
            </div>
          ))}
        </div>
        <p className="faint" style={{ textAlign: 'center', fontSize: 12 }}>ORION · v0.2.0 · Abidjan 🇨🇮</p>
      </div>
    </div>
  );
}

/* --------------------------- Chat support ---------------------------- */
function SupportChatScreen({ onBack }: { onBack: () => void }) {
  const { t } = useI18n();
  const [messages, setMessages] = useState<SupportMessage[]>([]);
  const [text, setText] = useState('');
  const [convId, setConvId] = useState<string | null>(null);
  const cid = clientId();

  useEffect(() => {
    (async () => {
      const convs = await listSupport(cid);
      if (convs && convs.length) { setConvId(convs[0]!.id); setMessages(convs[0]!.messages); }
    })();
  }, [cid]);

  const send = async () => {
    const body = text.trim();
    if (!body) return;
    setText('');
    const mine: SupportMessage = { id: `l${Date.now()}`, from: 'client', text: body, at: new Date().toISOString() };
    setMessages((m) => [...m, mine]);
    const conv = await openSupport(cid, body);
    if (conv) { setConvId(conv.id); setMessages(conv.messages); }
    else {
      // Démo hors-ligne : réponse automatique de courtoisie.
      window.setTimeout(() => setMessages((m) => [...m, { id: `a${Date.now()}`, from: 'agent', author: 'Support ORION', text: t('sup_auto'), at: new Date().toISOString() }]), 900);
    }
  };

  return (
    <div className="screen page">
      <TopBar onBack={onBack} title={t('sup_title')} />
      <div className="page-body" style={{ display: 'flex', flexDirection: 'column' }}>
        <div className="sup-chat">
          {messages.length === 0 && (
            <div className="sup-intro">
              <span className="list-ico" style={{ color: 'var(--green)', width: 44, height: 44 }}><IconShieldCheck size={22} /></span>
              <p className="h-sub" style={{ textAlign: 'center' }}>{t('sup_intro')}</p>
            </div>
          )}
          {messages.map((m) => (
            <div key={m.id} className={`sup-bubble ${m.from}`}>
              <span>{m.text}</span>
              <span className="sup-meta">{m.from === 'agent' ? (m.author ?? 'ORION') : t('sup_you')} · {new Date(m.at).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}</span>
            </div>
          ))}
        </div>
        <div className="sup-input">
          <input value={text} onChange={(e) => setText(e.target.value)} placeholder={t('sup_placeholder')} onKeyDown={(e) => { if (e.key === 'Enter') void send(); }} />
          <button className="btn btn-primary" style={{ width: 'auto', padding: '0 18px' }} onClick={() => void send()}>{t('sup_send')}</button>
        </div>
        {convId && <p className="faint" style={{ textAlign: 'center', fontSize: 11, marginTop: 6 }}>#{convId} · {t('sup_note')}</p>}
      </div>
    </div>
  );
}

/* ------------------------------ Paiement ----------------------------- */
function PaymentScreen({ quote, coverage, payment, driver, rideId, onPaid }: {
  quote: Quote | null; coverage: SubCoverage | null; payment: string; driver: Driver; rideId: string | null; onPaid: () => void;
}) {
  const { t } = useI18n();
  const provider = PAYMENTS.find((p) => p.method === payment)?.label ?? payment;
  const mobile = ['orange_money', 'wave', 'mtn_momo', 'moov_money'].includes(payment);
  const [phase, setPhase] = useState<'idle' | 'redirect' | 'success'>('idle');
  const [erreur, setErreur] = useState<string | null>(null);

  const pay = () => {
    setErreur(null);
    if (!mobile) { void finalize(); return; }
    setPhase('redirect');
  };
  /**
   * Le succès n'est affiché que si le SERVEUR a enregistré le paiement. Avant, l'app
   * annonçait « paiement reçu » sans regarder la réponse : sans numéro mobile money, le
   * paiement était refusé en silence et le chauffeur restait bloqué « en course ».
   */
  const finalize = async () => {
    if (isLiveBackend() && rideId) {
      try {
        const r = await fetch(`${import.meta.env.VITE_API_URL}/rides/${rideId}/pay`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'idempotency-key': `pay-${rideId}-${payment}` },
          // Le numéro vérifié du compte : celui sur lequel l'opérateur demande la confirmation.
          body: JSON.stringify({ method: payment, phone: profilEnCache()?.phone ?? undefined }),
        });
        const j = await r.json().catch(() => null) as { rideStatus?: string; payment?: { status?: string; message?: string }; error?: { message?: string } } | null;
        if (!r.ok || j?.rideStatus !== 'paid') {
          setPhase('idle');
          setErreur(j?.payment?.status === 'pending' ? t('pay_confirm_in', { p: provider }) : (j?.payment?.message ?? j?.error?.message ?? t('pay_failed')));
          return;
        }
      } catch {
        setPhase('idle');
        setErreur(t('pay_failed'));
        return;
      }
    }
    setPhase('success');
    window.setTimeout(onPaid, 2200);
  };

  return (
    <div className="screen page">
      <OrionMap origin={DEFAULT_ORIGIN.location} />
      <TopBar title={t('pay_title')} />
      <div style={{ flex: 1 }} />
      <Sheet>
        {phase !== 'success' ? (
          <>
            <div className="row between" style={{ marginBottom: 14 }}>
              <span className="col"><span className="faint" style={{ fontSize: 12 }}>{t('conf_total')}</span><span className="amt" style={{ fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: 28 }}>{formatXOF(Math.max(0, (quote?.amount ?? 0) - (coverage?.montantCouvert ?? 0) - (coverage?.remise ?? 0)))}</span></span>
              <PhotoChauffeur driver={driver} style={{ width: 48, height: 48, fontSize: 18 }} />
            </div>
            <div className="chip active" style={{ width: '100%', justifyContent: 'flex-start', marginBottom: 14 }}><IconWallet size={16} /> {provider}</div>
            <button className="btn btn-primary" onClick={pay}><IconWallet size={18} /> {t('pay_now')} · {formatXOF(quote?.amount ?? 0)}</button>
            {erreur && <p className="pay-erreur" role="alert">{erreur}</p>}
            {mobile && <p className="faint" style={{ fontSize: 12, textAlign: 'center', marginTop: 8 }}>{t('pay_redirect', { p: provider })}</p>}
          </>
        ) : (
          <div className="col" style={{ alignItems: 'center', textAlign: 'center', gap: 6 }}>
            <span className="pay-ok"><IconCheck size={40} /></span>
            <h2 className="h-title" style={{ marginTop: 8 }}>{t('pay_success')}</h2>
            <p className="muted">{formatXOF(quote?.amount ?? 0)} · {provider}</p>
            <p className="faint" style={{ fontSize: 13 }}>{t('pay_notif')}</p>
            <p className="faint" style={{ fontSize: 13 }}>{t('pay_email')}</p>
          </div>
        )}
      </Sheet>

      {phase === 'redirect' && (
        <div className="call-overlay" style={{ justifyContent: 'center', gap: 22 }}>
          <div className="logo-mark" style={{ width: 64, height: 64, color: '#fff' }}><IconWallet size={32} /></div>
          <h2 className="h-title">{t('pay_redirect', { p: provider })}</h2>
          <p className="h-sub" style={{ textAlign: 'center' }}>{t('pay_confirm_in', { p: provider })}</p>
          <div className="pay-spinner" />
          <button className="btn btn-primary" style={{ maxWidth: 260 }} onClick={() => void finalize()}>{t('pay_open', { p: provider })}</button>
        </div>
      )}
    </div>
  );
}

/* ----------------------------- Portefeuille -------------------------- */
function WalletScreen({ onBack, onToast }: { onBack: () => void; onToast: (m: string) => void }) {
  const { t } = useI18n();
  // Données de démonstration (ou backend en production).
  const [balance, setBalance] = useState(3250);
  const insuranceYear = 1840;
  const refund = Math.round(insuranceYear * 0.5);
  return (
    <div className="screen page">
      <TopBar onBack={onBack} title={t('wal_title')} />
      <div className="page-body">
        <div className="card" style={{ padding: 20, marginBottom: 16, background: 'linear-gradient(135deg, var(--green-deep), var(--green-bright))', border: 'none', color: 'var(--btn-on)' }}>
          <span style={{ fontSize: 13, fontWeight: 600, opacity: 0.85 }}>{t('wal_balance')}</span>
          <div style={{ fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: 36 }}>{formatXOF(balance)}</div>
        </div>

        <div className="card" style={{ padding: 16, marginBottom: 16 }}>
          <div className="row gap-sm" style={{ marginBottom: 10 }}>
            <span className="list-ico" style={{ color: 'var(--green)' }}><IconShieldCheck size={18} /></span>
            <strong style={{ fontSize: 15 }}>ORION Assurance</strong>
          </div>
          <div className="fare-line"><span>{t('wal_ins_year')}</span><span>{formatXOF(insuranceYear)}</span></div>
          <div className="fare-line"><span>{t('wal_refund')}</span><span style={{ color: 'var(--green)', fontWeight: 700 }}>{formatXOF(refund)}</span></div>
        </div>

        <span className="eyebrow">{t('wal_transfer')}</span>
        <div className="chips" style={{ margin: '10px 0 16px' }}>
          {['Wave', 'Orange Money', 'MTN MoMo', 'Moov Money'].map((m) => (
            <button key={m} className="chip" onClick={() => { setBalance((b) => Math.max(0, b - 1000)); onToast(t('toast_transfer')); }}><IconWallet size={15} /> {m}</button>
          ))}
        </div>
        <button className="btn btn-ghost"><IconCheck size={18} /> {t('wal_use')}</button>
      </div>
    </div>
  );
}
