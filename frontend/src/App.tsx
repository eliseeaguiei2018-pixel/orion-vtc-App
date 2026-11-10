import { useEffect, useMemo, useRef, useState } from 'react';
import { OrionMap } from './components/OrionMap';
import { Sheet, TopBar, Toast } from './components/ui';
import {
  IconBell, IconBolt, IconBriefcase, IconCalendar, IconCamera, IconCar, IconCheck, IconChevron, IconClock, IconCrown,
  IconFingerprint, IconGem, IconGlobe, IconHome, IconImage, IconLeaf, IconLock, IconMic, IconMinus,
  IconPhone, IconPhoneOff, IconPin, IconPlane, IconPlus, IconRing, IconSearch, IconSettings, IconShare,
  IconShield, IconShieldCheck, IconStar, IconTraffic, IconVolume, IconWallet, IconWifi,
} from './icons';
import { useTheme, type ThemeMode } from './theme';
import { LogoGlyph } from './components/Logo';
import { IllusCar, IllusMoto, IllusFood, IllusShop, IllusMarket, IllusColis } from './components/Illustrations';
import { authenticateBiometric, isBiometricEnabled, setBiometricEnabled } from './security';
import type { TrustedContact } from './api';
import {
  ABIDJAN_PLACES, COUNTRIES, DEFAULT_ORIGIN, DRIVERS, SUB_PLANS, TIERS, WEDDING_DURATION_FACTOR,
  WEDDING_FEES, formatXOF, tierById,
} from './data';
import { EMERGENCY_NUMBERS, cancelRide, cancelSubscription, clientId, configSocketUrl, createRide, estimateWithCoverage, fetchAppConfig, fetchSubPlans, fetchSubscription, isLiveBackend, listAnnouncements, listMyRides, listSupport, openSupport, estimateDelivery, notifyRentalTariffChange, paySubscriptionInvoice, previewDelivery, registerClientProfile, previewQuote, rateRide, rideSocketUrl, sos, subscribePlan, type Announcement, type AppConfig, type PkgSize, type RideHistoryItem, type SafeDriver, type SupportMessage } from './api';
import { LANGUAGES, useI18n, type Lang } from './i18n';
import type { Driver, LatLng, Place, Quote, Screen, SubCoverage, SubPlan, SubPlanInfo, SubState, TierOption, WeddingDuration } from './types';
import { MyRentalsScreen, RentalScreen } from './components/RentalScreens';

const PAYMENTS = [
  { method: 'orange_money', label: 'Orange Money' },
  { method: 'wave', label: 'Wave' },
  { method: 'mtn_momo', label: 'MTN MoMo' },
  { method: 'moov_money', label: 'Moov Money' },
  { method: 'cash', label: 'Espèces' },
  { method: 'card', label: 'Carte' },
];

// Arrêts d'exemple proposés lors de l'ajout d'un arrêt (multi-arrêts).
const EXTRA_STOPS: Place[] = ABIDJAN_PLACES.filter((p) => ['pisam', 'sococe', 'gare'].includes(p.id));

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

/** Médaille de niveau (couleur d'accent). */
function TierBadge({ accent, size = 50 }: { accent: string; size?: number }) {
  return (
    <span className="veh-ico" style={{ width: size, height: size, color: accent, boxShadow: `inset 0 0 0 1px ${accent}55` }}>
      <IconGem size={size * 0.5} />
    </span>
  );
}

type TripPhase = 'enroute' | 'arrived' | 'inprogress' | 'completed';

export function App() {
  const { t } = useI18n();
  const [screen, setScreen] = useState<Screen>('splash');
  const origin = DEFAULT_ORIGIN;
  const [destination, setDestination] = useState<Place | null>(null);
  const [mode, setMode] = useState<'ride' | 'delivery'>('ride');
  const [pkgSize, setPkgSize] = useState<'petit' | 'moyen' | 'grand'>('moyen');
  const [tier, setTier] = useState<TierOption>(TIERS[0]!);
  const [bodyType, setBodyType] = useState<'suv' | 'berline'>('berline');
  const [stops, setStops] = useState<Place[]>([]);
  const [scheduled, setScheduled] = useState(false);
  const [insurance, setInsurance] = useState(false);
  const [payment, setPayment] = useState<string>('orange_money');
  const [quote, setQuote] = useState<Quote | null>(null);
  /** Nom saisi à l'inscription — enregistré côté serveur après vérification du numéro. */
  const [clientName, setClientName] = useState('');
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
    setDestination(place);
    setScreen('estimate');
  };

  const pickDriver = (): Driver => {
    const base = DRIVERS[Math.floor(Math.random() * DRIVERS.length)] ?? DRIVERS[0]!;
    const car = tier.cars[Math.floor(Math.random() * tier.cars.length)] ?? tier.cars[0]!;
    return { ...base, car };
  };

  /** Construit la fiche chauffeur à partir du VRAI chauffeur matché par le backend. */
  const driverFromSafe = (s: SafeDriver): Driver => ({
    name: s.name,
    matricule: s.matricule,
    rating: s.ratingAvg,
    trips: s.ratingCount,
    plate: plateFromMatricule(s.matricule),
    car: tier.cars[Math.floor(Math.random() * tier.cars.length)] ?? tier.cars[0]!,
    color: '',
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
    setSosState('sending');
    const res = await sos(clientId(), carPos ?? origin.location, rideId ?? undefined);
    if (res.delivered) { setSosState(null); showToast(t('toast_sos'), true); return; }
    setSosState('failed'); // échec : le passager doit appeler lui-même
  };

  const cancelCurrentRide = () => {
    if (live && rideId) void cancelRide(rideId);
    showToast(t('toast_cancelled'));
    reset();
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
          setDriver(res.driver ? driverFromSafe(res.driver) : pickCourier());
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
        {locked && <LockScreen onUnlock={() => setLocked(false)} />}

        {screen === 'splash' && <Splash onDone={() => setScreen('onboarding')} />}
        {screen === 'onboarding' && <Onboarding onStart={() => setScreen('auth')} onLang={() => setScreen('settings')} />}
        {screen === 'auth' && <AuthScreen phone={phone} setPhone={setPhone} name={clientName} setName={setClientName} onBack={() => setScreen('onboarding')} onNext={() => setScreen('otp')} onWhatsApp={(msg) => { showToast(msg); setScreen('otp'); }} />}
        {screen === 'otp' && (
          <OtpScreen
            phone={phone}
            onBack={() => setScreen('auth')}
            onVerified={() => {
              // Le numéro est vérifié : on enregistre la fiche pour que le support
              // puisse rappeler. Sans cela, la console n'affiche qu'un identifiant.
              void registerClientProfile(clientName, phone);
              setScreen('permissions');
            }}
          />
        )}
        {screen === 'permissions' && <PermissionsScreen onDone={() => setScreen('home')} />}

        {screen === 'home' && (
          <HomeScreen announce={announce} closed={closed} deliveryOff={deliveryOff} city={appConfig?.city ?? null}
            onSearch={() => { if (guardOpen()) { setMode('ride'); setScreen('destination'); } }}
            onCourse={() => { if (guardOpen()) { setMode('ride'); setScreen('destination'); } }}
            onDelivery={() => { if (guardOpen()) { setMode('delivery'); setScreen('delivery'); } }}
            onQuick={(p) => { if (guardOpen()) { setMode('ride'); chooseDestination(p); } }}
            onNav={setScreen}
            onSoon={(name) => showToast(t('soon_toast', { name }))} />
        )}

        {screen === 'destination' && (
          <DestinationScreen origin={origin} onBack={() => setScreen('home')} onChoose={chooseDestination} />
        )}

        {screen === 'delivery' && (
          <DeliveryScreen origin={origin} pkgSize={pkgSize} onBack={() => setScreen('home')} onConfirm={startDelivery} />
        )}

        {screen === 'estimate' && destination && (
          <EstimateScreen origin={origin} destination={destination} tier={tier} onTier={setTier}
            bodyType={bodyType} onBody={setBodyType} stops={stops}
            onBack={() => setScreen('home')} onNext={() => setScreen('confirm')} />
        )}

        {screen === 'confirm' && destination && (
          <ConfirmScreen origin={origin} destination={destination} tier={tier} quote={quote} coverage={coverage} payment={payment}
            payments={enabledPayments} promo={promo} onPromo={setPromo}
            stops={stops} onAddStop={() => setStops((s) => (s.length < 3 ? [...s, EXTRA_STOPS[s.length]!] : s))}
            scheduled={scheduled} onSchedule={setScheduled} insurance={insurance} onInsurance={setInsurance}
            onPayment={setPayment} onBack={() => setScreen('estimate')}
            onConfirm={() => { if (scheduled) { showToast(t('toast_scheduled')); reset(); } else confirmRide(); }} />
        )}

        {screen === 'searching' && destination && (
          <SearchingScreen origin={origin} destination={destination} mode={mode} onCancel={reset} />
        )}

        {screen === 'tracking' && destination && driver && (
          <TrackingScreen origin={origin} destination={destination} driver={driver} tier={tier} phase={tripPhase} mode={mode}
            carPos={carPos} setCarPos={setCarPos} setPhase={setTripPhase} live={live} rideId={rideId} stops={stops}
            onSos={triggerSos} onShare={() => showToast(t('toast_share'))} onArrived={() => setScreen('payment')}
            onCancel={cancelCurrentRide}
            onReassigned={(d) => { setDriver(driverFromSafe(d)); showToast(t('toast_reassigned', { name: d.name })); }}
            onServerCancel={() => { showToast(t('toast_no_driver'), true); reset(); }} />
        )}

        {screen === 'payment' && destination && driver && (
          <PaymentScreen quote={quote} coverage={coverage} payment={payment} driver={driver} rideId={rideId}
            onPaid={() => setScreen('rating')} />
        )}

        {screen === 'rating' && destination && driver && (
          <RatingScreen driver={driver} quote={quote} payment={payment} destination={destination} rating={rating}
            setRating={setRating} onDone={() => { if (live && rideId && rating) void rateRide(rideId, rating); showToast(t('toast_done')); reset(); }} />
        )}

        {screen === 'settings' && (
          <SettingsScreen onBack={() => setScreen('home')} onWallet={() => setScreen('wallet')}
            trusted={trusted} setTrusted={(c) => { setTrusted(c); localStorage.setItem('orion.trusted', JSON.stringify(c)); }}
            shareRides={shareRides} setShareRides={(v) => { setShareRides(v); localStorage.setItem('orion.share', v ? '1' : '0'); }} />
        )}
        {screen === 'wallet' && <WalletScreen onBack={() => setScreen('home')} onToast={showToast} />}
        {screen === 'history' && <HistoryScreen onBack={() => setScreen('home')} />}
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
function AuthScreen({ phone, setPhone, name, setName, onBack, onNext, onWhatsApp }: {
  phone: string; setPhone: (v: string) => void;
  name: string; setName: (v: string) => void;
  onBack: () => void; onNext: () => void; onWhatsApp: (msg: string) => void;
}) {
  const { t } = useI18n();
  const valid = phone.replace(/\D/g, '').length >= 8;
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
          <input placeholder={t('reg_name')} value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div className="field" style={{ marginBottom: 16 }}>
          <span className="dialcode">🇨🇮 +225</span>
          <input inputMode="tel" placeholder={t('reg_phone')} value={phone} onChange={(e) => setPhone(e.target.value)} />
        </div>
        <button className="btn btn-primary" disabled={!valid} onClick={onNext}>{t('reg_send')} <IconChevron size={18} /></button>
        <button className="btn btn-ghost" style={{ marginTop: 10, color: '#25D366' }} disabled={!valid} onClick={() => onWhatsApp(t('wa_otp'))}>
          <IconPhone size={18} /> {t('wa_otp')}
        </button>
      </Sheet>
    </div>
  );
}

function PermissionsScreen({ onDone }: { onDone: () => void }) {
  const { t } = useI18n();
  const items = [
    { icon: <IconPin size={20} />, k: 'loc' },
    { icon: <IconBell size={20} />, k: 'notif' },
    { icon: <IconMic size={20} />, k: 'mic' },
    { icon: <IconCamera size={20} />, k: 'cam' },
    { icon: <IconImage size={20} />, k: 'storage' },
  ];
  const [granted, setGranted] = useState<Record<string, boolean>>({});
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
          {items.map((it) => (
            <div key={it.k} className="opt" style={granted[it.k] ? { borderColor: 'var(--green)' } : undefined}>
              <span className="list-ico" style={{ color: 'var(--green)' }}>{it.icon}</span>
              <span className="col grow" style={{ textAlign: 'start' }}>
                <strong style={{ fontSize: 14.5 }}>{t(`perm_${it.k}`)}</strong>
                <span className="faint" style={{ fontSize: 12 }}>{t(`perm_${it.k}_d`)}</span>
              </span>
              <button className={`toggle${granted[it.k] ? ' on' : ''}`} onClick={() => setGranted((g) => ({ ...g, [it.k]: !g[it.k] }))}><span /></button>
            </div>
          ))}
        </div>
        <button className="btn btn-primary" style={{ marginTop: 16 }} onClick={() => { setGranted({ loc: true, notif: true, mic: true, cam: true, storage: true }); onDone(); }}>
          <IconCheck size={18} /> {t('perm_allow')}
        </button>
        <button className="btn btn-ghost" style={{ marginTop: 10 }} onClick={onDone}>{t('perm_skip')}</button>
      </Sheet>
    </div>
  );
}

function OtpScreen({ phone, onBack, onVerified }: { phone: string; onBack: () => void; onVerified: () => void }) {
  const { t } = useI18n();
  const [code, setCode] = useState(['', '', '', '']);
  const refs = useRef<Array<HTMLInputElement | null>>([]);
  const filled = code.every((c) => c !== '');

  const setDigit = (i: number, v: string) => {
    const d = v.replace(/\D/g, '').slice(-1);
    setCode((prev) => { const n = [...prev]; n[i] = d; return n; });
    if (d && i < 3) refs.current[i + 1]?.focus();
  };

  return (
    <div className="screen page">
      <OrionMap origin={DEFAULT_ORIGIN.location} />
      <TopBar onBack={onBack} title={t('otp_title')} />
      <div style={{ flex: 1 }} />
      <Sheet>
        <h2 className="h-title">{t('otp_title')}</h2>
        <p className="h-sub" style={{ marginBottom: 18 }}>{t('otp_subtitle', { phone: `+225 ${phone}` })}</p>
        <div className="otp-row">
          {code.map((c, i) => (
            <input key={i} ref={(el) => { refs.current[i] = el; }} className="otp-box" inputMode="numeric" maxLength={1}
              value={c} autoFocus={i === 0} onChange={(e) => setDigit(i, e.target.value)} />
          ))}
        </div>
        <button className="btn btn-primary" style={{ marginTop: 20 }} disabled={!filled} onClick={onVerified}>
          <IconCheck size={18} /> {t('otp_verify')}
        </button>
        <button className="btn btn-ghost" style={{ marginTop: 10 }} onClick={() => setCode(['', '', '', ''])}>{t('otp_resend')}</button>
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

function HomeScreen({ announce, closed, deliveryOff, city, onSearch, onCourse, onDelivery, onQuick, onNav, onSoon }: {
  announce: Announcement | null; closed: boolean; deliveryOff: boolean; city: string | null;
  onSearch: () => void; onCourse: () => void; onDelivery: () => void;
  onQuick: (p: Place) => void; onNav: (s: Screen) => void; onSoon: (name: string) => void;
}) {
  const { t } = useI18n();
  const quick = ABIDJAN_PLACES.filter((p) => p.kind === 'home' || p.kind === 'work' || p.kind === 'hub');
  const [showAnnounce, setShowAnnounce] = useState(true);
  return (
    <div className="screen page hub">
      <div className="hub-hero">
        <div className="hub-top">
          <span className="hub-brand"><span className="hub-logo"><LogoGlyph size={20} /></span> ORION</span>
          <button className="avatar hub-avatar" onClick={() => onNav('settings')} aria-label="Settings"><IconSettings size={20} /></button>
        </div>
        <h2 className="hub-greet rise">{t('home_greeting')}</h2>
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
            <span className="svc-illus"><IllusCar size={92} /></span>
            <span className="svc-meta"><strong>{t('svc_course')}</strong><span>{t('svc_course_d')}</span></span>
          </button>
          {!deliveryOff && (
            <button className={`svc-card deliver${closed ? ' svc-off' : ''}`} onClick={onDelivery} disabled={closed}>
              <span className="svc-illus"><IllusMoto size={92} /></span>
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
          <button className="feature-card" onClick={() => onNav('subscription')}><IconCrown size={20} /> <span>{t('menu_subscription')}</span></button>
          <button className="feature-card" onClick={() => onNav('rental')}><IconCar size={20} /> <span>{t('rent_entry')}</span></button>
          <button className="feature-card" onClick={() => onNav('wedding')}><IconRing size={20} /> <span>{t('menu_wedding')}</span></button>
          <button className="feature-card" onClick={() => onNav('history')}><IconClock size={20} /> <span>{t('menu_history')}</span></button>
          <button className="feature-card" onClick={() => onNav('help')}><IconShield size={20} /> <span>{t('menu_help')}</span></button>
        </div>

        <span className="eyebrow" style={{ marginTop: 4 }}><IconPin size={13} /> {t('home_recent')}</span>
        <div className="stack" style={{ marginTop: 10 }}>
          {quick.map((p) => (
            <button key={p.id} className="list-row list-btn" onClick={() => onQuick(p)}>
              <span className="list-ico" style={{ color: 'var(--green)' }}>{placeIcon(p.kind)}</span>
              <span className="col grow" style={{ textAlign: 'start' }}>
                <strong style={{ fontSize: 15 }}>{p.name}</strong>
                <span className="faint" style={{ fontSize: 13 }}>{p.area}</span>
              </span>
              <IconChevron size={18} color="#6f8a7e" />
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

/* ----------------------------- Livraison ----------------------------- */
function DeliveryScreen({ origin, pkgSize, onBack, onConfirm }: {
  origin: Place; pkgSize: PkgSize; onBack: () => void; onConfirm: (dropoff: Place, size: PkgSize) => void;
}) {
  const { t } = useI18n();
  const [dropoff, setDropoff] = useState<Place | null>(null);
  const [size, setSize] = useState<PkgSize>(pkgSize);
  const [q, setQ] = useState('');
  const results = useMemo(() => {
    const s = q.trim().toLowerCase();
    return (s ? ABIDJAN_PLACES.filter((p) => (p.name + ' ' + p.area).toLowerCase().includes(s)) : ABIDJAN_PLACES).slice(0, 6);
  }, [q]);
  const quote = useMemo(() => (dropoff ? previewDelivery(origin.location, dropoff.location, size) : null), [dropoff, size, origin.location]);
  const sizes: PkgSize[] = ['petit', 'moyen', 'grand'];

  return (
    <div className="screen">
      <OrionMap origin={origin.location} destination={dropoff?.location ?? null} vehicle="moto" />
      <TopBar onBack={onBack} title={t('del_title')} />
      <div style={{ flex: 1 }} />
      <Sheet>
        <div className="del-head">
          <span className="svc-illus small"><IllusMoto size={54} /></span>
          <div className="col grow" style={{ textAlign: 'start' }}>
            <strong style={{ fontSize: 17 }}>{t('del_title')}</strong>
            <span className="faint" style={{ fontSize: 12.5 }}>{t('svc_delivery_d')}</span>
          </div>
        </div>

        {/* Retrait */}
        <div className="list-row" style={{ padding: '8px 0' }}>
          <span className="list-ico" style={{ color: 'var(--green)' }}><IconPin size={18} /></span>
          <span className="col grow"><strong style={{ fontSize: 14 }}>{origin.area}</strong><span className="faint" style={{ fontSize: 12 }}>{t('del_pickup')}</span></span>
        </div>

        {/* Dépôt */}
        {dropoff ? (
          <button className="list-row list-btn" style={{ width: '100%', padding: '8px 0' }} onClick={() => setDropoff(null)}>
            <span className="list-ico" style={{ color: 'var(--gold)' }}><IconPin size={18} /></span>
            <span className="col grow" style={{ textAlign: 'start' }}><strong style={{ fontSize: 14 }}>{dropoff.name}</strong><span className="faint" style={{ fontSize: 12 }}>{dropoff.area}</span></span>
            <span className="faint" style={{ fontSize: 12, textDecoration: 'underline' }}>{t('del_change')}</span>
          </button>
        ) : (
          <>
            <div className="field" style={{ margin: '8px 0' }}>
              <IconSearch size={20} color="#6f8a7e" />
              <input autoFocus placeholder={t('del_dropoff')} value={q} onChange={(e) => setQ(e.target.value)} />
            </div>
            <div style={{ maxHeight: 168, overflowY: 'auto' }}>
              {results.map((p) => (
                <button key={p.id} className="list-row list-btn" onClick={() => setDropoff(p)}>
                  <span className="list-ico" style={{ color: 'var(--green)' }}>{placeIcon(p.kind)}</span>
                  <span className="col grow" style={{ textAlign: 'start' }}><strong style={{ fontSize: 15 }}>{p.name}</strong><span className="faint" style={{ fontSize: 13 }}>{p.area}</span></span>
                </button>
              ))}
            </div>
          </>
        )}

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
            <button className="btn btn-primary" onClick={() => onConfirm(dropoff, size)}>
              <IconBolt size={18} /> {t('del_cta')}
            </button>
            <p className="faint" style={{ textAlign: 'center', fontSize: 12, marginTop: 8 }}>{t('del_note')}</p>
          </>
        )}
      </Sheet>
    </div>
  );
}

/* ---------------------------- Destination ---------------------------- */
function DestinationScreen({ origin, onBack, onChoose }: { origin: Place; onBack: () => void; onChoose: (p: Place) => void }) {
  const { t } = useI18n();
  const [q, setQ] = useState('');
  const results = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return ABIDJAN_PLACES;
    return ABIDJAN_PLACES.filter((p) => (p.name + ' ' + p.area).toLowerCase().includes(s));
  }, [q]);
  return (
    <div className="screen">
      <OrionMap origin={origin.location} />
      <TopBar onBack={onBack} title={t('dest_title')} />
      <div style={{ flex: 1 }} />
      <Sheet>
        <div className="field" style={{ marginBottom: 8 }}>
          <IconSearch size={20} color="#6f8a7e" />
          <input autoFocus placeholder={t('dest_search')} value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <div style={{ maxHeight: 340, overflowY: 'auto' }}>
          {results.map((p) => (
            <button key={p.id} className="list-row list-btn" onClick={() => onChoose(p)}>
              <span className="list-ico" style={{ color: 'var(--green)' }}>{placeIcon(p.kind)}</span>
              <span className="col grow" style={{ textAlign: 'start' }}>
                <strong style={{ fontSize: 15 }}>{p.name}</strong>
                <span className="faint" style={{ fontSize: 13 }}>{p.area}</span>
              </span>
            </button>
          ))}
          {results.length === 0 && <p className="faint" style={{ padding: 20, textAlign: 'center' }}>{t('dest_none')}</p>}
        </div>
      </Sheet>
    </div>
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
  const prices = useMemo(
    () => Object.fromEntries(TIERS.map((v) => [v.id, previewQuote(origin.location, destination.location, v, { bodyType, stops: stopLocs }).amount])),
    [origin.location, destination.location, bodyType, stops],
  );
  const traffic = previewQuote(origin.location, destination.location, tier).trafficLevel;
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
              <TierBadge accent={v.accent} />
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
function ConfirmScreen({ origin, destination, tier, quote, coverage, payment, payments, promo, onPromo, stops, onAddStop, scheduled, onSchedule, insurance, onInsurance, onPayment, onBack, onConfirm }: {
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
          <div className="list-row" style={{ padding: '6px 0' }}>
            <span className="list-ico" style={{ color: 'var(--green)' }}><IconPin size={18} /></span>
            <span className="col grow"><strong style={{ fontSize: 14 }}>{origin.area}</strong><span className="faint" style={{ fontSize: 12 }}>{t('conf_departure')}</span></span>
            <TierBadge accent={tier.accent} size={36} />
          </div>
          {stops.map((s, i) => (
            <div key={i}><div className="divider" /><div className="list-row" style={{ padding: '6px 0' }}>
              <span className="list-ico" style={{ color: 'var(--green)', fontSize: 12, fontWeight: 700 }}>{i + 1}</span>
              <span className="col grow"><strong style={{ fontSize: 14 }}>{s.name}</strong><span className="faint" style={{ fontSize: 12 }}>{t('p_stops')}</span></span>
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
        <div className="opt" style={{ marginBottom: 14, ...(insurance ? { borderColor: 'var(--green)', background: 'rgba(0,168,101,0.06)' } : {}) }}>
          <span className="list-ico" style={{ color: 'var(--green)' }}><IconShieldCheck size={18} /></span>
          <span className="col grow" style={{ textAlign: 'start' }}>
            <strong style={{ fontSize: 14 }}>{t('ins_toggle')}</strong>
            <button className="faint list-btn" style={{ fontSize: 12, textDecoration: 'underline', padding: 0, textAlign: 'start' }} onClick={() => setShowIns(true)}>{t('ins_why')}</button>
          </span>
          <button className={`toggle${insurance ? ' on' : ''}`} onClick={() => onInsurance(!insurance)}><span /></button>
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
            <input style={{ textTransform: 'uppercase', fontSize: 14, minWidth: 0 }} value={promoDraft}
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
              <IconChevron size={16} color="#6f8a7e" />
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
        <button className="btn btn-primary" style={{ marginTop: 14 }} onClick={onConfirm}>{scheduled ? t('sched_set') : t('conf_confirm')}</button>
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
function TrackingScreen({ origin, destination, driver, tier, phase, mode = 'ride', carPos, setCarPos, setPhase, live, rideId, stops, onSos, onShare, onArrived, onCancel, onReassigned, onServerCancel }: {
  origin: Place; destination: Place; driver: Driver; tier: TierOption; phase: TripPhase; mode?: 'ride' | 'delivery';
  carPos: LatLng | null; setCarPos: (p: LatLng) => void; setPhase: (p: TripPhase) => void;
  live: boolean; rideId: string | null; stops: Place[]; onSos: () => void; onShare: () => void; onArrived: () => void; onCancel: () => void;
  /** Synchro app chauffeur : nouveau chauffeur (refus / délai dépassé / console). */
  onReassigned?: (d: SafeDriver) => void;
  /** Course annulée côté serveur (aucun chauffeur disponible, clôture console). */
  onServerCancel?: () => void;
}) {
  const { t } = useI18n();
  const del = mode === 'delivery';
  const [calling, setCalling] = useState(false);
  const progressRef = useRef(0);
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
    const start = Date.now();
    const id = window.setInterval(() => {
      const tt = Math.min(1, (Date.now() - start) / durations[phase]);
      setCarPos(lerp(from, to, tt));
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
      <OrionMap origin={origin.location} destination={destination.location} stops={stops.map((s) => s.location)} car={carPos} vehicle={del ? 'moto' : 'car'} />
      <TopBar title={t('track_title')} />
      <button className="sos" onClick={onSos} aria-label="SOS">SOS</button>
      <div style={{ flex: 1 }} />
      <Sheet>
        <div className="row between" style={{ marginBottom: 12 }}>
          <span className="badge green"><IconShield size={13} /> {banner}</span>
          <span className="faint" style={{ fontSize: 12 }}>{eta}</span>
        </div>
        {/* Fiche chauffeur : photo, nom & prénom, note, matricule ORION */}
        <div className="card" style={{ padding: 14, marginBottom: 12 }}>
          <div className="row">
            <span className="driver-photo" style={{ color: tier.accent }}>{driver.name.charAt(0)}</span>
            <span className="col grow">
              <strong style={{ fontSize: 16 }}>{driver.name}</strong>
              <span className="row gap-sm" style={{ fontSize: 13 }}><IconStar size={14} color="#f5c451" /> {driver.rating} · {driver.trips.toLocaleString('fr-FR')}</span>
            </span>
            <span className="col" style={{ alignItems: 'flex-end', gap: 6 }}>
              <span className="plate">{driver.plate}</span>
              <span className="faint" style={{ fontSize: 12 }}>{driver.car || tier.cars[0]}</span>
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
          <button className="btn btn-primary" onClick={() => setCalling(true)}><IconPhone size={18} /> {t('track_call')}</button>
        </div>
        <p className="faint" style={{ fontSize: 11, textAlign: 'center', marginTop: 6 }}>📶 {t('call_nounits')}</p>

        {(phase === 'enroute' || phase === 'arrived') && (
          <button className="btn btn-danger" style={{ marginTop: 10 }} onClick={onCancel}>{t('act_cancel')}</button>
        )}
        {!del && (
          <div className="perk" style={{ marginTop: 12 }}>
            <span className="list-ico" style={{ color: 'var(--green)' }}><IconWifi size={18} /></span>
            <span className="grow" style={{ textAlign: 'start', fontSize: 13, fontWeight: 600 }}>{t('wifi_free')}</span>
            <span className="badge green" style={{ fontSize: 10 }}>À BORD</span>
          </div>
        )}
        <div className="card" style={{ padding: 12, marginTop: 12 }}>
          <div className="row gap-sm" style={{ fontSize: 13 }}>
            <span className="list-ico" style={{ color: 'var(--green)', width: 32, height: 32 }}><IconShield size={16} /></span>
            <span className="muted">{t('drv_supervised')}</span>
          </div>
        </div>
      </Sheet>

      {calling && <CallOverlay driver={driver} tier={tier} onClose={() => setCalling(false)} />}
    </div>
  );
}

/* --------------------------- Appel internet -------------------------- */
function CallOverlay({ driver, tier, onClose }: { driver: Driver; tier: TierOption; onClose: () => void }) {
  const { t } = useI18n();
  const [seconds, setSeconds] = useState(0);
  const [connected, setConnected] = useState(false);
  const [muted, setMuted] = useState(false);
  const [speaker, setSpeaker] = useState(true);

  useEffect(() => {
    const c = window.setTimeout(() => setConnected(true), 1600);
    return () => window.clearTimeout(c);
  }, []);
  useEffect(() => {
    if (!connected) return;
    const id = window.setInterval(() => setSeconds((s) => s + 1), 1000);
    return () => window.clearInterval(id);
  }, [connected]);

  const mmss = `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;

  return (
    <div className="call-overlay">
      <div className="call-top">
        <span className="badge green"><IconShield size={12} /> {t('call_internet')}</span>
        <p className="faint" style={{ fontSize: 12, marginTop: 6 }}>{t('call_nounits')}</p>
      </div>
      <div className="call-center">
        <span className="call-avatar" style={{ color: tier.accent }}>{driver.name.charAt(0)}</span>
        <h2 className="h-title" style={{ marginTop: 16 }}>{driver.name}</h2>
        <p className="faint" style={{ fontSize: 13 }}>{driver.matricule}</p>
        <p className="muted" style={{ marginTop: 8, fontSize: 14 }}>{connected ? mmss : t('call_connecting')}</p>
      </div>
      <div className="call-actions">
        <button className={`call-btn${muted ? ' on' : ''}`} onClick={() => setMuted((m) => !m)}>
          <IconMic size={22} /><span>{t('call_mute')}</span>
        </button>
        <button className="call-btn end" onClick={onClose}><IconPhoneOff size={24} /><span>{t('call_end')}</span></button>
        <button className={`call-btn${speaker ? ' on' : ''}`} onClick={() => setSpeaker((s) => !s)}>
          <IconVolume size={22} /><span>{t('call_speaker')}</span>
        </button>
      </div>
    </div>
  );
}

/* ------------------------------ Rating ------------------------------- */
function RatingScreen({ driver, quote, payment, destination, rating, setRating, onDone }: {
  driver: Driver; quote: Quote | null; payment: string; destination: Place; rating: number; setRating: (n: number) => void; onDone: () => void;
}) {
  const { t } = useI18n();
  const [tip, setTip] = useState(0);
  const payLabel = PAYMENTS.find((p) => p.method === payment)?.label ?? payment;
  return (
    <div className="screen">
      <OrionMap origin={DEFAULT_ORIGIN.location} destination={destination.location} />
      <TopBar title={t('rate_done')} />
      <div style={{ flex: 1 }} />
      <Sheet>
        <div className="col" style={{ alignItems: 'center', marginBottom: 8 }}>
          <span className="driver-photo" style={{ width: 64, height: 64, fontSize: 24 }}>{driver.name.charAt(0)}</span>
          <h2 className="h-title" style={{ marginTop: 10 }}>{t('rate_notez')} {driver.name}</h2>
          <p className="faint" style={{ fontSize: 13 }}>{driver.car} · {driver.plate}</p>
        </div>
        <div className="stars" style={{ margin: '8px 0 16px' }}>
          {[1, 2, 3, 4, 5].map((n) => (
            <span key={n} className="star" onClick={() => setRating(n)}><IconStar size={38} color={n <= rating ? '#f5c451' : '#1d3a2d'} /></span>
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
function SettingsScreen({ onBack, onWallet, trusted, setTrusted, shareRides, setShareRides }: {
  onBack: () => void; onWallet: () => void;
  trusted: TrustedContact | null; setTrusted: (c: TrustedContact) => void;
  shareRides: boolean; setShareRides: (v: boolean) => void;
}) {
  const { t, lang, setLang } = useI18n();
  const { mode, setMode } = useTheme();
  const [bio, setBio] = useState(isBiometricEnabled());
  const [name, setName] = useState(trusted?.name ?? '');
  const [phone, setPhone] = useState(trusted?.phone ?? '');
  const themeOpts: Array<{ m: ThemeMode; k: string }> = [
    { m: 'system', k: 'theme_auto' }, { m: 'light', k: 'theme_light' }, { m: 'dark', k: 'theme_dark' },
  ];
  const saveContact = (nm: string, ph: string) => { if (nm && ph) setTrusted({ name: nm, phone: ph }); };
  return (
    <div className="screen page">
      <TopBar onBack={onBack} title={t('set_title')} />
      <div className="page-body">
        {/* Sécurité & confidentialité */}
        <span className="eyebrow"><IconShieldCheck size={13} /> {t('sec_title')}</span>
        <div className="opt" style={{ margin: '10px 0 8px' }}>
          <span className="list-ico" style={{ color: 'var(--green)' }}><IconFingerprint size={18} /></span>
          <span className="col grow" style={{ textAlign: 'start' }}>
            <strong style={{ fontSize: 14 }}>{t('sec_biometric')}</strong>
            <span className="faint" style={{ fontSize: 12 }}>{t('sec_biometric_d')}</span>
          </span>
          <button className={`toggle${bio ? ' on' : ''}`} onClick={() => { const v = !bio; setBio(v); setBiometricEnabled(v); }}><span /></button>
        </div>
        <p className="faint" style={{ fontSize: 11, margin: '0 0 18px' }}>🔒 {t('sec_privacy')}</p>

        {/* Contact de confiance */}
        <span className="eyebrow"><IconShield size={13} /> {t('tc_title')}</span>
        <div className="field" style={{ margin: '10px 0 8px' }}>
          <input placeholder={t('tc_name')} value={name} onChange={(e) => { setName(e.target.value); saveContact(e.target.value, phone); }} />
        </div>
        <div className="field" style={{ marginBottom: 8 }}>
          <span className="dialcode">🇨🇮 +225</span>
          <input inputMode="tel" placeholder={t('tc_phone')} value={phone} onChange={(e) => { setPhone(e.target.value); saveContact(name, e.target.value); }} />
        </div>
        <div className="opt" style={{ marginBottom: 18 }}>
          <span className="col grow" style={{ textAlign: 'start' }}>
            <strong style={{ fontSize: 14 }}>{t('tc_share')}</strong>
            <span className="faint" style={{ fontSize: 12 }}>{t('tc_share_d')}</span>
          </span>
          <button className={`toggle${shareRides ? ' on' : ''}`} onClick={() => setShareRides(!shareRides)}><span /></button>
        </div>

        {/* Portefeuille */}
        <button className="opt list-btn" style={{ marginBottom: 22 }} onClick={onWallet}>
          <span className="list-ico" style={{ color: 'var(--green)' }}><IconWallet size={18} /></span>
          <span className="grow" style={{ textAlign: 'start', fontWeight: 600 }}>{t('wal_title')}</span>
          <IconChevron size={18} color="#6f8a7e" />
        </button>

        <span className="eyebrow">{t('set_theme')}</span>
        <div className="chips" style={{ margin: '10px 0 22px' }}>
          {themeOpts.map((o) => (
            <button key={o.m} className={`chip${mode === o.m ? ' active' : ''}`} onClick={() => setMode(o.m)}>{t(o.k)}</button>
          ))}
        </div>

        <span className="eyebrow"><IconGlobe size={13} /> {t('set_language')}</span>
        <div className="grid2" style={{ margin: '10px 0 22px' }}>
          {LANGUAGES.map((l) => (
            <button key={l.code} className={`opt${l.code === lang ? ' active' : ''}`} onClick={() => setLang(l.code as Lang)}>
              <span style={{ fontSize: 20 }}>{l.flag}</span> <span className="grow" style={{ textAlign: 'start' }}>{l.label}</span>
              {l.code === lang && <IconCheck size={16} color="var(--green)" />}
            </button>
          ))}
        </div>

        <span className="eyebrow"><IconPin size={13} /> {t('set_country')}</span>
        <p className="faint" style={{ fontSize: 12, margin: '4px 0 10px' }}>{t('set_region')}</p>
        <div className="stack">
          {COUNTRIES.map((c) => (
            <div key={c.code} className={`opt${c.status === 'active' ? ' active' : ' muted-opt'}`} style={{ cursor: c.status === 'active' ? 'default' : 'not-allowed' }}>
              <span style={{ fontSize: 20 }}>{c.flag}</span>
              <span className="grow" style={{ textAlign: 'start' }}>{c.name}</span>
              <span className={`badge ${c.status === 'active' ? 'green' : ''}`}>{c.status === 'active' ? t('set_active') : t('set_comingSoon')}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

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
              <TierBadge accent={v.accent} />
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
          <button className={`toggle${decoration ? ' on' : ''}`} onClick={() => setDecoration((v) => !v)}><span /></button>
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

/* ------------------------------ Historique --------------------------- */
const RIDE_STATUS_FR: Record<string, string> = {
  searching: 'Recherche', accepted: 'Acceptée', driver_en_route: 'En approche', arrived: 'Arrivé',
  in_progress: 'En course', completed: 'Terminée', paid: 'Payée', rated: 'Notée', cancelled: 'Annulée', no_driver: 'Sans chauffeur',
};

function demoHistory(): RideHistoryItem[] {
  const P = ABIDJAN_PLACES;
  const mk = (from: Place, to: Place, tierId: string, daysAgo: number, status: string): RideHistoryItem => {
    const tier = tierById(tierId);
    const q = previewQuote(from.location, to.location, tier);
    return { id: `demo-${from.id}-${to.id}-${daysAgo}`, status, origin: from.location, destination: to.location, quote: q, createdAt: new Date(Date.now() - daysAgo * 86400000).toISOString() };
  };
  const byId = (id: string) => P.find((p) => p.id === id) ?? P[0]!;
  return [
    mk(byId('home'), byId('work'), 'or', 1, 'rated'),
    mk(byId('work'), byId('home'), 'argent', 2, 'paid'),
    mk(byId('home'), byId('fhb'), 'diamant', 5, 'rated'),
    mk(byId('univ'), byId('home'), 'bronze', 8, 'cancelled'),
  ];
}

function HistoryScreen({ onBack }: { onBack: () => void }) {
  const { t } = useI18n();
  const [items, setItems] = useState<RideHistoryItem[] | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const remote = await listMyRides(clientId());
      setItems(remote && remote.length ? remote : demoHistory());
    })();
  }, []);

  const nameFor = (loc: LatLng) => {
    let best = ABIDJAN_PLACES[0]!; let bd = Infinity;
    for (const p of ABIDJAN_PLACES) {
      const d = Math.hypot(p.location.lat - loc.lat, p.location.lng - loc.lng);
      if (d < bd) { bd = d; best = p; }
    }
    return best.name;
  };

  return (
    <div className="screen page">
      <TopBar onBack={onBack} title={t('hist_title')} />
      <div className="page-body">
        {items === null && <p className="faint">…</p>}
        {items?.length === 0 && <p className="faint" style={{ textAlign: 'center', padding: 24 }}>{t('hist_empty')}</p>}
        <div className="stack">
          {items?.map((r) => {
            const open = openId === r.id;
            const b = r.quote.breakdown;
            return (
              <div key={r.id} className="card" style={{ padding: 0, overflow: 'hidden' }}>
                <button className="list-btn" style={{ width: '100%', padding: 14, display: 'flex', gap: 12, alignItems: 'center' }} onClick={() => setOpenId(open ? null : r.id)}>
                  <span className="list-ico" style={{ color: 'var(--green)' }}><IconClock size={18} /></span>
                  <span className="col grow" style={{ textAlign: 'start' }}>
                    <strong style={{ fontSize: 14 }}>{nameFor(r.origin)} → {nameFor(r.destination)}</strong>
                    <span className="faint" style={{ fontSize: 12 }}>{new Date(r.createdAt).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })} · {RIDE_STATUS_FR[r.status] ?? r.status}</span>
                  </span>
                  <span className="price" style={{ fontSize: 15 }}>{formatXOF(r.quote.amount)}</span>
                </button>
                {open && (
                  <div style={{ padding: '0 14px 14px' }}>
                    <div className="divider" style={{ margin: '4px 0 10px' }} />
                    <span className="eyebrow">{t('hist_receipt')}</span>
                    <div style={{ marginTop: 8 }}>
                      <div className="fare-line"><span>{t('p_base')}</span><span>{formatXOF(b.base)}</span></div>
                      <div className="fare-line"><span>{t('p_distance')} · {(r.quote.distanceMeters / 1000).toFixed(1)} km</span><span>{formatXOF(b.distance)}</span></div>
                      <div className="fare-line"><span>{t('p_time')}</span><span>{formatXOF(b.time)}</span></div>
                      {b.traffic > 0 && <div className="fare-line"><span>{t('p_traffic')}</span><span>+{formatXOF(b.traffic)}</span></div>}
                      <div className="fare-line"><span>{t('p_tva')}</span><span>{formatXOF(b.tva)}</span></div>
                      <div className="fare-line"><span>{t('p_fee')}</span><span>{formatXOF(b.fee)}</span></div>
                      {b.insurance > 0 && <div className="fare-line"><span>{t('ins_line')}</span><span>{formatXOF(b.insurance)}</span></div>}
                      <div className="divider" style={{ margin: '8px 0' }} />
                      <div className="fare-total"><span className="muted">{t('conf_total')}</span><span className="amt">{formatXOF(r.quote.amount)}</span></div>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
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
                <IconChevron size={16} color="#6f8a7e" />
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

  const pay = () => {
    if (!mobile) { finalize(); return; }
    setPhase('redirect');
  };
  const finalize = () => {
    setPhase('success');
    if (isLiveBackend() && rideId) {
      void fetch(`${import.meta.env.VITE_API_URL}/rides/${rideId}/pay`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'idempotency-key': `pay-${rideId}` },
        body: JSON.stringify({ method: payment }),
      }).catch(() => {});
    }
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
              <span className="driver-photo" style={{ width: 48, height: 48, fontSize: 18 }}>{driver.name.charAt(0)}</span>
            </div>
            <div className="chip active" style={{ width: '100%', justifyContent: 'flex-start', marginBottom: 14 }}><IconWallet size={16} /> {provider}</div>
            <button className="btn btn-primary" onClick={pay}><IconWallet size={18} /> {t('conf_confirm')} · {formatXOF(quote?.amount ?? 0)}</button>
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
          <button className="btn btn-primary" style={{ maxWidth: 260 }} onClick={finalize}>{t('pay_open', { p: provider })}</button>
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
        <div className="card" style={{ padding: 20, marginBottom: 16, background: 'linear-gradient(135deg, var(--green-deep), var(--green-bright))', border: 'none', color: '#04140d' }}>
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
