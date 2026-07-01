import { useEffect, useMemo, useRef, useState } from 'react';
import { OrionMap } from './components/OrionMap';
import { Sheet, TopBar, Toast } from './components/ui';
import {
  IconBell, IconBriefcase, IconCalendar, IconCamera, IconCheck, IconChevron, IconClock, IconCrown,
  IconFingerprint, IconGem, IconGlobe, IconHome, IconImage, IconLeaf, IconLock, IconMic, IconMinus,
  IconPhone, IconPhoneOff, IconPin, IconPlane, IconPlus, IconRing, IconSearch, IconSettings, IconShare,
  IconShield, IconShieldCheck, IconStar, IconTraffic, IconVolume, IconWallet,
} from './icons';
import { useTheme, type ThemeMode } from './theme';
import { LogoGlyph } from './components/Logo';
import { authenticateBiometric, isBiometricEnabled, setBiometricEnabled } from './security';
import type { TrustedContact } from './api';
import {
  ABIDJAN_PLACES, COUNTRIES, DEFAULT_ORIGIN, DRIVERS, SUB_PLANS, TIERS, WEDDING_DURATION_FACTOR,
  WEDDING_FEES, formatXOF, tierById,
} from './data';
import { cancelRide, clientId, createRide, estimate, isLiveBackend, listMyRides, previewQuote, rateRide, rideSocketUrl, sos, type RideHistoryItem, type SafeDriver } from './api';
import { LANGUAGES, useI18n, type Lang } from './i18n';
import type { Driver, LatLng, Place, Quote, Screen, SubPlan, TierOption, WeddingDuration } from './types';

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
  const [tier, setTier] = useState<TierOption>(TIERS[0]!);
  const [bodyType, setBodyType] = useState<'suv' | 'berline'>('berline');
  const [stops, setStops] = useState<Place[]>([]);
  const [scheduled, setScheduled] = useState(false);
  const [insurance, setInsurance] = useState(false);
  const [payment, setPayment] = useState<string>('orange_money');
  const [quote, setQuote] = useState<Quote | null>(null);
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
  const [currentPlan, setCurrentPlan] = useState<string | null>(null);
  const [phone, setPhone] = useState('');
  const [toast, setToast] = useState<{ message: string; danger?: boolean } | null>(null);

  const showToast = (message: string, danger?: boolean) => {
    setToast({ message, danger });
    window.setTimeout(() => setToast(null), 3200);
  };

  useEffect(() => {
    if (screen === 'confirm' && destination) {
      estimate(origin.location, destination.location, tier, { bodyType, stops: stops.map((s) => s.location), insurance }).then(setQuote);
    }
  }, [screen, destination, tier, bodyType, stops, insurance, origin.location]);

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
      const res = await createRide(quote.lockId, clientId(), shareRides && trusted ? trusted : undefined);
      if (res?.ride?.driverId) {
        setRideId(res.ride.id);
        setLive(true);
        setDriver(res.driver ? driverFromSafe(res.driver) : pickDriver());
        setCarPos(null);
        setTripPhase('enroute');
        setScreen('tracking');
        return;
      }
    }
    window.setTimeout(() => {
      setRideId(null);
      setLive(false);
      setDriver(pickDriver());
      setTripPhase('enroute');
      setScreen('tracking');
    }, 2400);
  };

  const triggerSos = () => {
    void sos(clientId(), carPos ?? origin.location, rideId ?? undefined);
    showToast(t('toast_sos'), true);
  };

  const cancelCurrentRide = () => {
    if (live && rideId) void cancelRide(rideId);
    showToast(t('toast_cancelled'));
    reset();
  };

  const reset = () => {
    setDestination(null);
    setQuote(null);
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
    setScreen('home');
  };

  return (
    <div className="app-shell">
      <div className="phone">
        {toast && <Toast message={toast.message} danger={toast.danger} />}
        {locked && <LockScreen onUnlock={() => setLocked(false)} />}

        {screen === 'splash' && <Splash onDone={() => setScreen('onboarding')} />}
        {screen === 'onboarding' && <Onboarding onStart={() => setScreen('auth')} onLang={() => setScreen('settings')} />}
        {screen === 'auth' && <AuthScreen phone={phone} setPhone={setPhone} onBack={() => setScreen('onboarding')} onNext={() => setScreen('otp')} onWhatsApp={(msg) => { showToast(msg); setScreen('otp'); }} />}
        {screen === 'otp' && <OtpScreen phone={phone} onBack={() => setScreen('auth')} onVerified={() => setScreen('permissions')} />}
        {screen === 'permissions' && <PermissionsScreen onDone={() => setScreen('home')} />}

        {screen === 'home' && (
          <HomeScreen origin={origin} onPick={() => setScreen('destination')} onQuick={chooseDestination} onNav={setScreen} />
        )}

        {screen === 'destination' && (
          <DestinationScreen origin={origin} onBack={() => setScreen('home')} onChoose={chooseDestination} />
        )}

        {screen === 'estimate' && destination && (
          <EstimateScreen origin={origin} destination={destination} tier={tier} onTier={setTier}
            bodyType={bodyType} onBody={setBodyType} stops={stops}
            onBack={() => setScreen('home')} onNext={() => setScreen('confirm')} />
        )}

        {screen === 'confirm' && destination && (
          <ConfirmScreen origin={origin} destination={destination} tier={tier} quote={quote} payment={payment}
            stops={stops} onAddStop={() => setStops((s) => (s.length < 3 ? [...s, EXTRA_STOPS[s.length]!] : s))}
            scheduled={scheduled} onSchedule={setScheduled} insurance={insurance} onInsurance={setInsurance}
            onPayment={setPayment} onBack={() => setScreen('estimate')}
            onConfirm={() => { if (scheduled) { showToast(t('toast_scheduled')); reset(); } else confirmRide(); }} />
        )}

        {screen === 'searching' && destination && (
          <SearchingScreen origin={origin} destination={destination} onCancel={reset} />
        )}

        {screen === 'tracking' && destination && driver && (
          <TrackingScreen origin={origin} destination={destination} driver={driver} tier={tier} phase={tripPhase}
            carPos={carPos} setCarPos={setCarPos} setPhase={setTripPhase} live={live} rideId={rideId} stops={stops}
            onSos={triggerSos} onShare={() => showToast(t('toast_share'))} onArrived={() => setScreen('payment')}
            onCancel={cancelCurrentRide} />
        )}

        {screen === 'payment' && destination && driver && (
          <PaymentScreen quote={quote} payment={payment} driver={driver} rideId={rideId}
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
        {screen === 'help' && <HelpScreen onBack={() => setScreen('home')} />}
        {screen === 'subscription' && (
          <SubscriptionScreen currentPlan={currentPlan} onBack={() => setScreen('home')}
            onSubscribe={(p) => { setCurrentPlan(p); showToast(t('toast_subscribed')); }} />
        )}
        {screen === 'wedding' && (
          <WeddingScreen onBack={() => setScreen('home')} onReserve={() => { showToast(t('toast_reserved')); setScreen('home'); }} />
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
function AuthScreen({ phone, setPhone, onBack, onNext, onWhatsApp }: {
  phone: string; setPhone: (v: string) => void; onBack: () => void; onNext: () => void; onWhatsApp: (msg: string) => void;
}) {
  const { t } = useI18n();
  const [name, setName] = useState('');
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
function HomeScreen({ origin, onPick, onQuick, onNav }: {
  origin: Place; onPick: () => void; onQuick: (p: Place) => void; onNav: (s: Screen) => void;
}) {
  const { t } = useI18n();
  const quick = ABIDJAN_PLACES.filter((p) => p.kind === 'home' || p.kind === 'work' || p.kind === 'hub');
  return (
    <div className="screen">
      <OrionMap origin={origin.location} />
      <TopBar right={<button className="avatar" onClick={() => onNav('settings')} aria-label="Settings"><IconSettings size={20} /></button>} />
      <div style={{ flex: 1 }} />
      <Sheet>
        <h2 className="h-title rise">{t('home_greeting')}</h2>
        <p className="h-sub rise rise-2" style={{ marginBottom: 14 }}>{t('home_whereTo')}</p>
        <button className="field rise rise-2" style={{ width: '100%' }} onClick={onPick}>
          <IconSearch size={20} color="#6f8a7e" />
          <span className="faint" style={{ fontSize: 16 }}>{t('home_search')}</span>
        </button>

        <div className="row gap-sm rise rise-3" style={{ marginTop: 14 }}>
          <button className="feature-card" onClick={() => onNav('subscription')}>
            <IconCrown size={22} /> <span>{t('menu_subscription')}</span>
          </button>
          <button className="feature-card" onClick={() => onNav('wedding')}>
            <IconRing size={22} /> <span>{t('menu_wedding')}</span>
          </button>
        </div>
        <div className="row gap-sm rise rise-3" style={{ marginTop: 10 }}>
          <button className="feature-card" onClick={() => onNav('history')}>
            <IconClock size={22} /> <span>{t('menu_history')}</span>
          </button>
          <button className="feature-card" onClick={() => onNav('help')}>
            <IconShield size={22} /> <span>{t('menu_help')}</span>
          </button>
        </div>

        <div className="stack rise rise-3" style={{ marginTop: 14 }}>
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
function ConfirmScreen({ origin, destination, tier, quote, payment, stops, onAddStop, scheduled, onSchedule, insurance, onInsurance, onPayment, onBack, onConfirm }: {
  origin: Place; destination: Place; tier: TierOption; quote: Quote | null; payment: string;
  stops: Place[]; onAddStop: () => void; scheduled: boolean; onSchedule: (v: boolean) => void;
  insurance: boolean; onInsurance: (v: boolean) => void;
  onPayment: (m: string) => void; onBack: () => void; onConfirm: () => void;
}) {
  const { t } = useI18n();
  const [showWhy, setShowWhy] = useState(false);
  const [showIns, setShowIns] = useState(false);
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
          {PAYMENTS.map((p) => (
            <button key={p.method} className={`chip${p.method === payment ? ' active' : ''}`} onClick={() => onPayment(p.method)}>
              <IconWallet size={15} /> {p.label}
            </button>
          ))}
        </div>

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
                <div className="fare-line"><span>{t('p_subtotal')}</span><span>{formatXOF(quote.breakdown.subtotal)}</span></div>
                <div className="fare-line"><span>{t('p_tva')}</span><span>{formatXOF(quote.breakdown.tva)}</span></div>
                <div className="fare-line"><span>{t('p_fee')}</span><span>{formatXOF(quote.breakdown.fee)}</span></div>
                {quote.breakdown.insurance > 0 && <div className="fare-line"><span>{t('ins_line')}</span><span>{formatXOF(quote.breakdown.insurance)}</span></div>}
              </div>
            )}
            <div className="divider" style={{ margin: '8px 0' }} />
            <div className="fare-total"><span className="muted">{t('conf_total')}</span><span className="amt">{formatXOF(quote.amount)}</span></div>
          </>
        )}
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
function SearchingScreen({ origin, destination, onCancel }: { origin: Place; destination: Place; onCancel: () => void }) {
  const { t } = useI18n();
  return (
    <div className="screen">
      <OrionMap origin={origin.location} destination={destination.location} />
      <TopBar />
      <div style={{ flex: 1 }} />
      <Sheet>
        <div className="radar"><span className="ring" /><span className="ring" /><span className="ring" /><span className="core"><IconLeaf size={28} /></span></div>
        <h2 className="h-title" style={{ textAlign: 'center' }}>{t('search_title')}</h2>
        <p className="h-sub" style={{ textAlign: 'center', marginTop: 6 }}>{t('search_sub')}</p>
        <button className="btn btn-ghost" style={{ marginTop: 18 }} onClick={onCancel}>{t('search_cancel')}</button>
      </Sheet>
    </div>
  );
}

/* ----------------------------- Tracking ------------------------------ */
function TrackingScreen({ origin, destination, driver, tier, phase, carPos, setCarPos, setPhase, live, rideId, stops, onSos, onShare, onArrived, onCancel }: {
  origin: Place; destination: Place; driver: Driver; tier: TierOption; phase: TripPhase;
  carPos: LatLng | null; setCarPos: (p: LatLng) => void; setPhase: (p: TripPhase) => void;
  live: boolean; rideId: string | null; stops: Place[]; onSos: () => void; onShare: () => void; onArrived: () => void; onCancel: () => void;
}) {
  const { t } = useI18n();
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
        const m = JSON.parse(ev.data as string) as { type: string; data: { position?: LatLng; status?: string } };
        if (m.type === 'driver.location' && m.data.position) setCarPos(m.data.position);
        if (m.type === 'ride.status') {
          const s = m.data.status;
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
    : phase === 'arrived' ? t('track_arrived') : t('track_enroute');
  const eta = phase === 'inprogress' ? `${t('track_dest')} · ${destination.name}` : t('track_meeting');

  return (
    <div className="screen">
      <OrionMap origin={origin.location} destination={destination.location} stops={stops.map((s) => s.location)} car={carPos} />
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

/* --------------------------- Subscription ---------------------------- */
function SubscriptionScreen({ currentPlan, onBack, onSubscribe }: {
  currentPlan: string | null; onBack: () => void; onSubscribe: (p: string) => void;
}) {
  const { t } = useI18n();
  return (
    <div className="screen page">
      <TopBar onBack={onBack} title={t('sub_title')} />
      <div className="page-body">
        <h2 className="h-title">{t('sub_title')}</h2>
        <p className="h-sub" style={{ marginBottom: 16 }}>{t('sub_subtitle')}</p>
        <div className="stack">
          {SUB_PLANS.map((p: SubPlan) => {
            const active = currentPlan === p.id;
            return (
              <div key={p.id} className="plan-card" style={{ borderColor: active ? p.accent : 'var(--stroke)', boxShadow: active ? `0 0 24px ${p.accent}44` : 'none' }}>
                <div className="row between">
                  <div className="row gap-sm">
                    <span className="veh-ico" style={{ width: 42, height: 42, color: p.accent }}><IconCrown size={22} /></span>
                    <div className="col">
                      <strong style={{ fontSize: 17 }}>{p.id === 'gold' ? 'Pack Gold' : `Pack ${t(p.key)}`}</strong>
                      <span className="faint" style={{ fontSize: 12.5 }}>{p.ridesPerDay} {t('sub_perDay')}</span>
                    </div>
                  </div>
                  <div className="col" style={{ alignItems: 'flex-end' }}>
                    <span className="price">{formatXOF(p.monthlyPrice)}</span>
                    <span className="faint" style={{ fontSize: 11 }}>{t('sub_perMonth')}</span>
                  </div>
                </div>
                <div className="divider" style={{ margin: '12px 0' }} />
                <div className="stack" style={{ gap: 6 }}>
                  {p.benefits.map((b, i) => (
                    <div key={i} className="row gap-sm" style={{ fontSize: 13 }}><IconCheck size={15} color={p.accent} /> <span className="muted">{b}</span></div>
                  ))}
                </div>
                <button className="btn btn-primary" style={{ marginTop: 14, background: active ? 'var(--surface-2)' : undefined, color: active ? 'var(--text)' : undefined, boxShadow: active ? 'none' : undefined }} disabled={active} onClick={() => onSubscribe(p.id)}>
                  {active ? t('sub_current') : t('sub_choose')}
                </button>
              </div>
            );
          })}
        </div>
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
function HelpScreen({ onBack }: { onBack: () => void }) {
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

/* ------------------------------ Paiement ----------------------------- */
function PaymentScreen({ quote, payment, driver, rideId, onPaid }: {
  quote: Quote | null; payment: string; driver: Driver; rideId: string | null; onPaid: () => void;
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
              <span className="col"><span className="faint" style={{ fontSize: 12 }}>{t('conf_total')}</span><span className="amt" style={{ fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: 28 }}>{formatXOF(quote?.amount ?? 0)}</span></span>
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
