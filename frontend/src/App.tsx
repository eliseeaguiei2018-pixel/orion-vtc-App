import { useEffect, useMemo, useRef, useState } from 'react';
import { OrionMap } from './components/OrionMap';
import { Sheet, TopBar, Toast } from './components/ui';
import {
  IconBolt, IconBriefcase, IconCar, IconCheck, IconChevron, IconClock, IconHome, IconLeaf,
  IconPhone, IconPin, IconPlane, IconSearch, IconShare, IconShield, IconStar, IconUsers, IconWallet,
} from './icons';
import { ABIDJAN_PLACES, DEFAULT_ORIGIN, DRIVERS, VEHICLES, formatXOF } from './data';
import { estimate, isLiveBackend, previewQuote, sos } from './api';
import type { Driver, LatLng, Place, Quote, Screen, Vehicle } from './types';

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

function vehicleIcon(icon: Vehicle['icon']) {
  if (icon === 'green') return <IconLeaf size={26} />;
  if (icon === 'comfort') return <IconStar size={24} color="#f5c451" />;
  if (icon === 'van') return <IconUsers size={26} />;
  return <IconCar size={26} />;
}

const placeIcon = (kind?: Place['kind']) => {
  if (kind === 'home') return <IconHome size={20} />;
  if (kind === 'work') return <IconBriefcase size={20} />;
  if (kind === 'hub') return <IconPlane size={20} />;
  return <IconPin size={20} />;
};

type TripPhase = 'enroute' | 'arrived' | 'inprogress' | 'completed';

export function App() {
  const [screen, setScreen] = useState<Screen>('onboarding');
  const origin = DEFAULT_ORIGIN;
  const [destination, setDestination] = useState<Place | null>(null);
  const [vehicle, setVehicle] = useState<Vehicle>(VEHICLES[1]!);
  const [payment, setPayment] = useState<string>('orange_money');
  const [quote, setQuote] = useState<Quote | null>(null);
  const [driver, setDriver] = useState<Driver | null>(null);
  const [carPos, setCarPos] = useState<LatLng | null>(null);
  const [tripPhase, setTripPhase] = useState<TripPhase>('enroute');
  const [rating, setRating] = useState(0);
  const [toast, setToast] = useState<{ message: string; danger?: boolean } | null>(null);

  const showToast = (message: string, danger?: boolean) => {
    setToast({ message, danger });
    window.setTimeout(() => setToast(null), 3200);
  };

  // Estimation authoritative à l'arrivée sur l'écran "confirm".
  useEffect(() => {
    if (screen === 'confirm' && destination) {
      estimate(origin.location, destination.location, vehicle).then(setQuote);
    }
  }, [screen, destination, vehicle, origin.location]);

  const chooseDestination = (place: Place) => {
    setDestination(place);
    setScreen('estimate');
  };

  const confirmRide = () => {
    setScreen('searching');
    window.setTimeout(() => {
      setDriver(DRIVERS[Math.floor(Math.random() * DRIVERS.length)] ?? DRIVERS[0]!);
      setTripPhase('enroute');
      setScreen('tracking');
    }, 2600);
  };

  const triggerSos = () => {
    sos('client-demo', carPos ?? origin.location, undefined);
    showToast('🚨 Alerte envoyée — SAMU (185) et supervision ORION notifiés', true);
  };

  const reset = () => {
    setDestination(null);
    setQuote(null);
    setDriver(null);
    setCarPos(null);
    setRating(0);
    setVehicle(VEHICLES[1]!);
    setScreen('home');
  };

  return (
    <div className="app-shell">
      <div className="phone">
        {toast && <Toast message={toast.message} danger={toast.danger} />}

        {screen === 'onboarding' && <Onboarding onStart={() => setScreen('home')} />}

        {screen === 'home' && (
          <HomeScreen origin={origin} onPick={() => setScreen('destination')} onQuick={chooseDestination} />
        )}

        {screen === 'destination' && (
          <DestinationScreen
            origin={origin}
            onBack={() => setScreen('home')}
            onChoose={chooseDestination}
          />
        )}

        {screen === 'estimate' && destination && (
          <EstimateScreen
            origin={origin}
            destination={destination}
            vehicle={vehicle}
            onVehicle={setVehicle}
            onBack={() => setScreen('home')}
            onNext={() => setScreen('confirm')}
          />
        )}

        {screen === 'confirm' && destination && (
          <ConfirmScreen
            origin={origin}
            destination={destination}
            vehicle={vehicle}
            quote={quote}
            payment={payment}
            onPayment={setPayment}
            onBack={() => setScreen('estimate')}
            onConfirm={confirmRide}
          />
        )}

        {screen === 'searching' && destination && (
          <SearchingScreen origin={origin} destination={destination} onCancel={reset} />
        )}

        {screen === 'tracking' && destination && driver && (
          <TrackingScreen
            origin={origin}
            destination={destination}
            driver={driver}
            vehicle={vehicle}
            phase={tripPhase}
            carPos={carPos}
            setCarPos={setCarPos}
            setPhase={setTripPhase}
            onSos={triggerSos}
            onShare={() => showToast('Lien de suivi partagé avec vos proches')}
            onArrived={() => setScreen('rating')}
          />
        )}

        {screen === 'rating' && destination && driver && (
          <RatingScreen
            driver={driver}
            quote={quote}
            payment={payment}
            destination={destination}
            rating={rating}
            setRating={setRating}
            onDone={() => {
              showToast('Merci ! Course terminée 🌱');
              reset();
            }}
          />
        )}
      </div>
    </div>
  );
}

/* ----------------------------- Onboarding ----------------------------- */
function Onboarding({ onStart }: { onStart: () => void }) {
  return (
    <div className="onb">
      <OrionMap origin={DEFAULT_ORIGIN.location} />
      <div style={{ position: 'relative', zIndex: 2 }} className="stack">
        <div className="logo-mark"><IconLeaf size={40} /></div>
        <div className="eyebrow">Mobilité verte · Abidjan</div>
        <h1 className="h-hero">La course<br />nouvelle génération<br />en Côte d’Ivoire.</h1>
        <p className="h-sub">Réservez en quelques secondes. Suivi précis, prix transparent en FCFA, paiement mobile money, sécurité SAMU intégrée.</p>
        <div className="row gap-sm" style={{ marginTop: 6 }}>
          <span className="badge green"><IconBolt size={13} /> 100% électrique</span>
          <span className="badge"><IconShield size={13} /> Sécurité SAMU</span>
        </div>
        <button className="btn btn-primary" style={{ marginTop: 18 }} onClick={onStart}>
          Commencer <IconChevron size={18} />
        </button>
        {!isLiveBackend() && <p className="faint" style={{ textAlign: 'center', fontSize: 12 }}>Mode démo — données simulées</p>}
      </div>
    </div>
  );
}

/* ------------------------------- Home -------------------------------- */
function HomeScreen({ origin, onPick, onQuick }: { origin: Place; onPick: () => void; onQuick: (p: Place) => void }) {
  const quick = ABIDJAN_PLACES.filter((p) => p.kind === 'home' || p.kind === 'work' || p.kind === 'hub');
  return (
    <div className="screen">
      <OrionMap origin={origin.location} />
      <TopBar />
      <div style={{ flex: 1 }} />
      <Sheet>
        <h2 className="h-title rise">Bonjour 👋</h2>
        <p className="h-sub rise rise-2" style={{ marginBottom: 14 }}>Où allez-vous aujourd’hui ?</p>
        <button className="field rise rise-2" style={{ width: '100%' }} onClick={onPick}>
          <IconSearch size={20} color="#6f8a7e" />
          <span className="faint" style={{ fontSize: 16 }}>Rechercher une destination…</span>
        </button>
        <div className="stack rise rise-3" style={{ marginTop: 6 }}>
          {quick.map((p) => (
            <button key={p.id} className="list-row" style={{ width: '100%', background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text)' }} onClick={() => onQuick(p)}>
              <span className="list-ico" style={{ color: 'var(--green)' }}>{placeIcon(p.kind)}</span>
              <span className="col grow" style={{ textAlign: 'left' }}>
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
  const [q, setQ] = useState('');
  const results = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return ABIDJAN_PLACES;
    return ABIDJAN_PLACES.filter((p) => (p.name + ' ' + p.area).toLowerCase().includes(s));
  }, [q]);
  return (
    <div className="screen">
      <OrionMap origin={origin.location} />
      <TopBar onBack={onBack} title="Destination" />
      <div style={{ flex: 1 }} />
      <Sheet>
        <div className="field" style={{ marginBottom: 8 }}>
          <IconSearch size={20} color="#6f8a7e" />
          <input autoFocus placeholder="Quartier, lieu, adresse à Abidjan…" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <div style={{ maxHeight: 320, overflowY: 'auto' }}>
          {results.map((p) => (
            <button key={p.id} className="list-row" style={{ width: '100%', background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text)' }} onClick={() => onChoose(p)}>
              <span className="list-ico" style={{ color: 'var(--green)' }}>{placeIcon(p.kind)}</span>
              <span className="col grow" style={{ textAlign: 'left' }}>
                <strong style={{ fontSize: 15 }}>{p.name}</strong>
                <span className="faint" style={{ fontSize: 13 }}>{p.area}</span>
              </span>
            </button>
          ))}
          {results.length === 0 && <p className="faint" style={{ padding: 20, textAlign: 'center' }}>Aucun résultat</p>}
        </div>
      </Sheet>
    </div>
  );
}

/* ----------------------------- Estimate ------------------------------ */
function EstimateScreen({ origin, destination, vehicle, onVehicle, onBack, onNext }: {
  origin: Place; destination: Place; vehicle: Vehicle; onVehicle: (v: Vehicle) => void; onBack: () => void; onNext: () => void;
}) {
  const prices = useMemo(
    () => Object.fromEntries(VEHICLES.map((v) => [v.id, previewQuote(origin.location, destination.location, v).amount])),
    [origin.location, destination.location],
  );
  return (
    <div className="screen">
      <OrionMap origin={origin.location} destination={destination.location} />
      <TopBar onBack={onBack} title={destination.name} />
      <div style={{ flex: 1 }} />
      <Sheet>
        <div className="row between" style={{ marginBottom: 10 }}>
          <span className="eyebrow">Choisissez votre course</span>
          <span className="badge green"><IconClock size={12} /> {vehicle.eta} min</span>
        </div>
        <div className="stack">
          {VEHICLES.map((v) => (
            <button key={v.id} className={`veh${v.id === vehicle.id ? ' active' : ''}`} style={{ width: '100%' }} onClick={() => onVehicle(v)}>
              <span className="veh-ico" style={{ color: v.id === 'comfort' ? '#f5c451' : 'var(--green)' }}>{vehicleIcon(v.icon)}</span>
              <span className="col grow" style={{ textAlign: 'left' }}>
                <strong style={{ fontSize: 16 }}>{v.label}</strong>
                <span className="faint" style={{ fontSize: 13 }}>{v.tagline} · {v.capacity} places</span>
              </span>
              <span className="price">{formatXOF(prices[v.id] ?? 0)}</span>
            </button>
          ))}
        </div>
        <button className="btn btn-primary" style={{ marginTop: 16 }} onClick={onNext}>
          Choisir {vehicle.label} <IconChevron size={18} />
        </button>
      </Sheet>
    </div>
  );
}

/* ------------------------------ Confirm ------------------------------ */
function ConfirmScreen({ origin, destination, vehicle, quote, payment, onPayment, onBack, onConfirm }: {
  origin: Place; destination: Place; vehicle: Vehicle; quote: Quote | null; payment: string;
  onPayment: (m: string) => void; onBack: () => void; onConfirm: () => void;
}) {
  return (
    <div className="screen">
      <OrionMap origin={origin.location} destination={destination.location} />
      <TopBar onBack={onBack} title="Confirmer" />
      <div style={{ flex: 1 }} />
      <Sheet>
        <div className="card" style={{ padding: 14, marginBottom: 14 }}>
          <div className="list-row" style={{ padding: '6px 0' }}>
            <span className="list-ico" style={{ color: 'var(--green)' }}><IconPin size={18} /></span>
            <span className="col grow"><strong style={{ fontSize: 14 }}>{origin.area}</strong><span className="faint" style={{ fontSize: 12 }}>Départ</span></span>
          </div>
          <div className="divider" />
          <div className="list-row" style={{ padding: '6px 0' }}>
            <span className="list-ico" style={{ color: 'var(--gold)' }}>{placeIcon(destination.kind)}</span>
            <span className="col grow"><strong style={{ fontSize: 14 }}>{destination.name}</strong><span className="faint" style={{ fontSize: 12 }}>{destination.area}</span></span>
          </div>
        </div>

        <span className="eyebrow">Paiement</span>
        <div className="chips" style={{ margin: '10px 0 14px' }}>
          {PAYMENTS.map((p) => (
            <button key={p.method} className={`chip${p.method === payment ? ' active' : ''}`} onClick={() => onPayment(p.method)}>
              <IconWallet size={15} /> {p.label}
            </button>
          ))}
        </div>

        {quote && (
          <>
            <div className="fare-line"><span>Base ({vehicle.label})</span><span>{formatXOF(quote.breakdown.base)}</span></div>
            <div className="fare-line"><span>Distance · {(quote.distanceMeters / 1000).toFixed(1)} km</span><span>{formatXOF(quote.breakdown.distance)}</span></div>
            <div className="fare-line"><span>Temps · ~{Math.round(quote.etaSeconds / 60)} min</span><span>{formatXOF(quote.breakdown.time)}</span></div>
            <div className="divider" style={{ margin: '8px 0' }} />
            <div className="fare-total"><span className="muted">Total estimé</span><span className="amt">{formatXOF(quote.amount)}</span></div>
          </>
        )}
        <button className="btn btn-primary" style={{ marginTop: 16 }} onClick={onConfirm}>
          Confirmer la course
        </button>
        <p className="faint" style={{ textAlign: 'center', fontSize: 12, marginTop: 8 }}>Prix verrouillé · aucun supplément surprise</p>
      </Sheet>
    </div>
  );
}

/* ----------------------------- Searching ----------------------------- */
function SearchingScreen({ origin, destination, onCancel }: { origin: Place; destination: Place; onCancel: () => void }) {
  return (
    <div className="screen">
      <OrionMap origin={origin.location} destination={destination.location} />
      <TopBar />
      <div style={{ flex: 1 }} />
      <Sheet>
        <div className="radar">
          <span className="ring" /><span className="ring" /><span className="ring" />
          <span className="core"><IconCar size={28} /></span>
        </div>
        <h2 className="h-title" style={{ textAlign: 'center' }}>Recherche d’un chauffeur…</h2>
        <p className="h-sub" style={{ textAlign: 'center', marginTop: 6 }}>Nous contactons les chauffeurs ORION les plus proches de {origin.area}.</p>
        <button className="btn btn-ghost" style={{ marginTop: 18 }} onClick={onCancel}>Annuler</button>
      </Sheet>
    </div>
  );
}

/* ----------------------------- Tracking ------------------------------ */
function TrackingScreen({ origin, destination, driver, vehicle, phase, carPos, setCarPos, setPhase, onSos, onShare, onArrived }: {
  origin: Place; destination: Place; driver: Driver; vehicle: Vehicle; phase: TripPhase;
  carPos: LatLng | null; setCarPos: (p: LatLng) => void; setPhase: (p: TripPhase) => void;
  onSos: () => void; onShare: () => void; onArrived: () => void;
}) {
  const progressRef = useRef(0);
  // Point de départ du chauffeur (légèrement décalé de l'usager).
  const driverStart = useMemo<LatLng>(() => ({ lat: origin.location.lat - 0.018, lng: origin.location.lng - 0.012 }), [origin.location]);

  useEffect(() => {
    progressRef.current = 0;
    const durations: Record<TripPhase, number> = { enroute: 6000, arrived: 1800, inprogress: 9000, completed: 0 };
    const from = phase === 'inprogress' ? origin.location : driverStart;
    const to = phase === 'inprogress' ? destination.location : origin.location;
    setCarPos(from);

    const start = Date.now();
    const id = window.setInterval(() => {
      const t = Math.min(1, (Date.now() - start) / durations[phase]);
      progressRef.current = t;
      setCarPos(lerp(from, to, t));
      if (t >= 1) {
        window.clearInterval(id);
        if (phase === 'enroute') setPhase('arrived');
        else if (phase === 'arrived') setPhase('inprogress');
        else if (phase === 'inprogress') { setPhase('completed'); onArrived(); }
      }
    }, 120);
    return () => window.clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase]);

  const banner =
    phase === 'enroute' ? `${driver.name} arrive · ${vehicle.eta} min`
    : phase === 'arrived' ? 'Votre chauffeur est arrivé 🎉'
    : 'En route vers votre destination';

  const eta = phase === 'inprogress' ? `Arrivée à ${destination.name}` : 'Point de rendez-vous';

  return (
    <div className="screen">
      <OrionMap origin={origin.location} destination={destination.location} car={carPos} />
      <TopBar title="Suivi en direct" />
      <button className="sos" onClick={onSos} aria-label="Urgence SOS">SOS</button>
      <div style={{ flex: 1 }} />
      <Sheet>
        <div className="row between" style={{ marginBottom: 12 }}>
          <span className="badge green"><IconShield size={13} /> {banner}</span>
          <span className="faint" style={{ fontSize: 12 }}>{eta}</span>
        </div>
        <div className="row" style={{ marginBottom: 14 }}>
          <span className="driver-photo">{driver.name.charAt(0)}</span>
          <span className="col grow">
            <strong style={{ fontSize: 16 }}>{driver.name}</strong>
            <span className="row gap-sm" style={{ fontSize: 13 }}>
              <IconStar size={14} color="#f5c451" /> {driver.rating} · {driver.trips.toLocaleString('fr-FR')} courses
            </span>
          </span>
          <span className="col" style={{ alignItems: 'flex-end', gap: 6 }}>
            <span className="plate">{driver.plate}</span>
            <span className="faint" style={{ fontSize: 12 }}>{driver.car}</span>
          </span>
        </div>
        <div className="row gap-sm">
          <button className="btn btn-ghost" onClick={() => onShare()}><IconShare size={18} /> Partager</button>
          <button className="btn btn-ghost"><IconPhone size={18} /> Appeler</button>
        </div>
        <div className="card" style={{ padding: 12, marginTop: 12 }}>
          <div className="row gap-sm" style={{ fontSize: 13 }}>
            <span className="list-ico" style={{ color: 'var(--green)', width: 32, height: 32 }}><IconBolt size={16} /></span>
            <span className="muted">Trajet enregistré · détection d’accident active · secours SAMU en 1 tap</span>
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
  const [tip, setTip] = useState(0);
  const payLabel = PAYMENTS.find((p) => p.method === payment)?.label ?? payment;
  return (
    <div className="screen">
      <OrionMap origin={DEFAULT_ORIGIN.location} destination={destination.location} />
      <TopBar title="Course terminée" />
      <div style={{ flex: 1 }} />
      <Sheet>
        <div className="col" style={{ alignItems: 'center', marginBottom: 8 }}>
          <span className="driver-photo" style={{ width: 64, height: 64, fontSize: 24 }}>{driver.name.charAt(0)}</span>
          <h2 className="h-title" style={{ marginTop: 10 }}>Notez {driver.name}</h2>
          <p className="faint" style={{ fontSize: 13 }}>{driver.car} · {driver.plate}</p>
        </div>
        <div className="stars" style={{ margin: '8px 0 16px' }}>
          {[1, 2, 3, 4, 5].map((n) => (
            <span key={n} className="star" onClick={() => setRating(n)}>
              <IconStar size={38} color={n <= rating ? '#f5c451' : '#1d3a2d'} />
            </span>
          ))}
        </div>
        <span className="eyebrow">Pourboire (FCFA)</span>
        <div className="chips" style={{ margin: '10px 0 14px' }}>
          {[0, 200, 500, 1000].map((t) => (
            <button key={t} className={`chip${t === tip ? ' active' : ''}`} onClick={() => setTip(t)}>{t === 0 ? 'Aucun' : formatXOF(t)}</button>
          ))}
        </div>
        <div className="card" style={{ padding: 14, marginBottom: 14 }}>
          <div className="fare-line"><span>Course</span><span>{formatXOF(quote?.amount ?? 0)}</span></div>
          {tip > 0 && <div className="fare-line"><span>Pourboire</span><span>{formatXOF(tip)}</span></div>}
          <div className="divider" style={{ margin: '8px 0' }} />
          <div className="fare-total"><span className="muted">Payé · {payLabel}</span><span className="amt">{formatXOF((quote?.amount ?? 0) + tip)}</span></div>
        </div>
        <button className="btn btn-primary" disabled={rating === 0} onClick={onDone}>
          <IconCheck size={18} /> Terminer
        </button>
      </Sheet>
    </div>
  );
}
