import { useEffect, useMemo, useRef, useState } from 'react';
import { OrionMap } from './components/OrionMap';
import { Sheet, TopBar, Toast } from './components/ui';
import {
  IconBriefcase, IconCalendar, IconCheck, IconChevron, IconClock, IconCrown, IconGem, IconGlobe,
  IconHome, IconLeaf, IconMinus, IconPhone, IconPin, IconPlane, IconPlus, IconRing, IconSearch,
  IconSettings, IconShare, IconShield, IconStar, IconWallet,
} from './icons';
import {
  ABIDJAN_PLACES, COUNTRIES, DEFAULT_ORIGIN, DRIVERS, SUB_PLANS, TIERS, WEDDING_DURATION_FACTOR,
  WEDDING_FEES, formatXOF, tierById,
} from './data';
import { createRide, estimate, isLiveBackend, previewQuote, rideSocketUrl, sos } from './api';
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
  const [payment, setPayment] = useState<string>('orange_money');
  const [quote, setQuote] = useState<Quote | null>(null);
  const [driver, setDriver] = useState<Driver | null>(null);
  const [carPos, setCarPos] = useState<LatLng | null>(null);
  const [tripPhase, setTripPhase] = useState<TripPhase>('enroute');
  const [rideId, setRideId] = useState<string | null>(null);
  const [live, setLive] = useState(false);
  const [rating, setRating] = useState(0);
  const [currentPlan, setCurrentPlan] = useState<string | null>(null);
  const [toast, setToast] = useState<{ message: string; danger?: boolean } | null>(null);

  const showToast = (message: string, danger?: boolean) => {
    setToast({ message, danger });
    window.setTimeout(() => setToast(null), 3200);
  };

  useEffect(() => {
    if (screen === 'confirm' && destination) {
      estimate(origin.location, destination.location, tier).then(setQuote);
    }
  }, [screen, destination, tier, origin.location]);

  const chooseDestination = (place: Place) => {
    setDestination(place);
    setScreen('estimate');
  };

  const pickDriver = (): Driver => {
    const base = DRIVERS[Math.floor(Math.random() * DRIVERS.length)] ?? DRIVERS[0]!;
    const car = tier.cars[Math.floor(Math.random() * tier.cars.length)] ?? tier.cars[0]!;
    return { ...base, car };
  };

  const confirmRide = async () => {
    setScreen('searching');
    if (isLiveBackend() && quote) {
      const ride = await createRide(quote.lockId, 'client-demo');
      if (ride?.driverId) {
        setRideId(ride.id);
        setLive(true);
        setDriver(pickDriver());
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
    sos('client-demo', carPos ?? origin.location, rideId ?? undefined);
    showToast(t('toast_sos'), true);
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
    setScreen('home');
  };

  return (
    <div className="app-shell">
      <div className="phone">
        {toast && <Toast message={toast.message} danger={toast.danger} />}

        {screen === 'splash' && <Splash onDone={() => setScreen('onboarding')} />}
        {screen === 'onboarding' && <Onboarding onStart={() => setScreen('home')} onLang={() => setScreen('settings')} />}

        {screen === 'home' && (
          <HomeScreen origin={origin} onPick={() => setScreen('destination')} onQuick={chooseDestination} onNav={setScreen} />
        )}

        {screen === 'destination' && (
          <DestinationScreen origin={origin} onBack={() => setScreen('home')} onChoose={chooseDestination} />
        )}

        {screen === 'estimate' && destination && (
          <EstimateScreen origin={origin} destination={destination} tier={tier} onTier={setTier}
            onBack={() => setScreen('home')} onNext={() => setScreen('confirm')} />
        )}

        {screen === 'confirm' && destination && (
          <ConfirmScreen origin={origin} destination={destination} tier={tier} quote={quote} payment={payment}
            onPayment={setPayment} onBack={() => setScreen('estimate')} onConfirm={confirmRide} />
        )}

        {screen === 'searching' && destination && (
          <SearchingScreen origin={origin} destination={destination} onCancel={reset} />
        )}

        {screen === 'tracking' && destination && driver && (
          <TrackingScreen origin={origin} destination={destination} driver={driver} tier={tier} phase={tripPhase}
            carPos={carPos} setCarPos={setCarPos} setPhase={setTripPhase} live={live} rideId={rideId}
            onSos={triggerSos} onShare={() => showToast(t('toast_share'))} onArrived={() => setScreen('rating')} />
        )}

        {screen === 'rating' && destination && driver && (
          <RatingScreen driver={driver} quote={quote} payment={payment} destination={destination} rating={rating}
            setRating={setRating} onDone={() => { showToast(t('toast_done')); reset(); }} />
        )}

        {screen === 'settings' && <SettingsScreen onBack={() => setScreen('home')} />}
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
      <div className="splash-logo"><IconLeaf size={48} /></div>
      <div className="splash-word">ORION</div>
      <div className="splash-tag">{t('tagline')}</div>
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
        <div className="logo-mark rise"><IconLeaf size={40} /></div>
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
function EstimateScreen({ origin, destination, tier, onTier, onBack, onNext }: {
  origin: Place; destination: Place; tier: TierOption; onTier: (v: TierOption) => void; onBack: () => void; onNext: () => void;
}) {
  const { t } = useI18n();
  const prices = useMemo(
    () => Object.fromEntries(TIERS.map((v) => [v.id, previewQuote(origin.location, destination.location, v).amount])),
    [origin.location, destination.location],
  );
  return (
    <div className="screen">
      <OrionMap origin={origin.location} destination={destination.location} />
      <TopBar onBack={onBack} title={destination.name} />
      <div style={{ flex: 1 }} />
      <Sheet>
        <div className="row between" style={{ marginBottom: 10 }}>
          <span className="eyebrow">{t('est_choose')}</span>
          <span className="badge green"><IconClock size={12} /> {tier.eta} {t('est_min')}</span>
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
          {t('est_cta')} {t(tier.key)} <IconChevron size={18} />
        </button>
      </Sheet>
    </div>
  );
}

/* ------------------------------ Confirm ------------------------------ */
function ConfirmScreen({ origin, destination, tier, quote, payment, onPayment, onBack, onConfirm }: {
  origin: Place; destination: Place; tier: TierOption; quote: Quote | null; payment: string;
  onPayment: (m: string) => void; onBack: () => void; onConfirm: () => void;
}) {
  const { t } = useI18n();
  return (
    <div className="screen">
      <OrionMap origin={origin.location} destination={destination.location} />
      <TopBar onBack={onBack} title={t('conf_title')} />
      <div style={{ flex: 1 }} />
      <Sheet>
        <div className="card" style={{ padding: 14, marginBottom: 14 }}>
          <div className="list-row" style={{ padding: '6px 0' }}>
            <span className="list-ico" style={{ color: 'var(--green)' }}><IconPin size={18} /></span>
            <span className="col grow"><strong style={{ fontSize: 14 }}>{origin.area}</strong><span className="faint" style={{ fontSize: 12 }}>{t('conf_departure')}</span></span>
            <TierBadge accent={tier.accent} size={36} />
          </div>
          <div className="divider" />
          <div className="list-row" style={{ padding: '6px 0' }}>
            <span className="list-ico" style={{ color: 'var(--gold)' }}>{placeIcon(destination.kind)}</span>
            <span className="col grow"><strong style={{ fontSize: 14 }}>{destination.name}</strong><span className="faint" style={{ fontSize: 12 }}>{destination.area}</span></span>
          </div>
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
            <div className="fare-line"><span>{t(tier.key)} · {tier.cars[0]}</span><span>{formatXOF(quote.breakdown.base)}</span></div>
            <div className="fare-line"><span>{(quote.distanceMeters / 1000).toFixed(1)} km</span><span>{formatXOF(quote.breakdown.distance)}</span></div>
            <div className="fare-line"><span>~{Math.round(quote.etaSeconds / 60)} {t('est_min')}</span><span>{formatXOF(quote.breakdown.time)}</span></div>
            <div className="divider" style={{ margin: '8px 0' }} />
            <div className="fare-total"><span className="muted">{t('conf_total')}</span><span className="amt">{formatXOF(quote.amount)}</span></div>
          </>
        )}
        <button className="btn btn-primary" style={{ marginTop: 16 }} onClick={onConfirm}>{t('conf_confirm')}</button>
        <p className="faint" style={{ textAlign: 'center', fontSize: 12, marginTop: 8 }}>{t('conf_locked')}</p>
      </Sheet>
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
function TrackingScreen({ origin, destination, driver, tier, phase, carPos, setCarPos, setPhase, live, rideId, onSos, onShare, onArrived }: {
  origin: Place; destination: Place; driver: Driver; tier: TierOption; phase: TripPhase;
  carPos: LatLng | null; setCarPos: (p: LatLng) => void; setPhase: (p: TripPhase) => void;
  live: boolean; rideId: string | null; onSos: () => void; onShare: () => void; onArrived: () => void;
}) {
  const { t } = useI18n();
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
      <OrionMap origin={origin.location} destination={destination.location} car={carPos} />
      <TopBar title={t('track_title')} />
      <button className="sos" onClick={onSos} aria-label="SOS">SOS</button>
      <div style={{ flex: 1 }} />
      <Sheet>
        <div className="row between" style={{ marginBottom: 12 }}>
          <span className="badge green"><IconShield size={13} /> {banner}</span>
          <span className="faint" style={{ fontSize: 12 }}>{eta}</span>
        </div>
        <div className="row" style={{ marginBottom: 14 }}>
          <span className="driver-photo" style={{ color: tier.accent }}>{driver.name.charAt(0)}</span>
          <span className="col grow">
            <strong style={{ fontSize: 16 }}>{driver.name}</strong>
            <span className="row gap-sm" style={{ fontSize: 13 }}><IconStar size={14} color="#f5c451" /> {driver.rating} · {driver.trips.toLocaleString('fr-FR')}</span>
          </span>
          <span className="col" style={{ alignItems: 'flex-end', gap: 6 }}>
            <span className="plate">{driver.plate}</span>
            <span className="faint" style={{ fontSize: 12 }}>{driver.car}</span>
          </span>
        </div>
        <div className="row gap-sm">
          <button className="btn btn-ghost" onClick={onShare}><IconShare size={18} /> {t('track_share')}</button>
          <button className="btn btn-ghost"><IconPhone size={18} /> {t('track_call')}</button>
        </div>
        <div className="card" style={{ padding: 12, marginTop: 12 }}>
          <div className="row gap-sm" style={{ fontSize: 13 }}>
            <span className="list-ico" style={{ color: 'var(--green)', width: 32, height: 32 }}><IconShield size={16} /></span>
            <span className="muted">{t('track_safety')}</span>
          </div>
        </div>
      </Sheet>
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
function SettingsScreen({ onBack }: { onBack: () => void }) {
  const { t, lang, setLang } = useI18n();
  return (
    <div className="screen page">
      <TopBar onBack={onBack} title={t('set_title')} />
      <div className="page-body">
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
