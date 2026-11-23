import { useContext, useEffect, useMemo, useState } from 'react';
import type { LatLng } from '../types';
import { rendu } from './Vehicules';
import { useTheme, type Accent } from '../theme';
import { getVectorConfig } from '../mapConfig';
import { CarteReelle } from './CarteReelle';
import { CarteGoogle, GoogleIndisponible } from './CarteGoogle';
import { cleRefusee, fondCarte, googleSeul, suivreFondCarte } from '../carteGoogle';
import { GpsCarte } from './gpsCarte';
import { IconLocate, IconRefresh } from '../icons';

/**
 * Carte ORION façon navigation (style Google/Waze) projetant de vraies coordonnées
 * d'Abidjan, adaptée au thème clair / sombre :
 *  - hiérarchie de voirie (grands boulevards + rues secondaires + trame résidentielle),
 *  - lagune Ébrié + espaces verts + libellés de communes (Plateau, Cocody, …),
 *  - marqueurs de trafic (carrefours / embouteillages), itinéraire, arrêts et VOITURE.
 *
 * En production, en présence d'une clé Google Maps (ou de tuiles OSM/MapTiler), on
 * substitue le fond de carte réel via cette même couche : les marqueurs, l'itinéraire
 * et le suivi voiture restent identiques (couche d'abstraction cartographique).
 */
const VIEW_W = 400;
const VIEW_H = 800;
const BOUNDS = { minLat: 5.18, maxLat: 5.46, minLng: -4.14, maxLng: -3.68 };

type Pt = { x: number; y: number };
const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));

function project(p: LatLng): Pt {
  const x = ((p.lng - BOUNDS.minLng) / (BOUNDS.maxLng - BOUNDS.minLng)) * VIEW_W;
  const y = (1 - (p.lat - BOUNDS.minLat) / (BOUNDS.maxLat - BOUNDS.minLat)) * VIEW_H;
  return { x: clamp(x, 16, VIEW_W - 16), y: clamp(y, 16, VIEW_H - 16) };
}

function curvedPath(a: Pt, b: Pt): string {
  const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
  const dx = b.x - a.x, dy = b.y - a.y;
  const len = Math.hypot(dx, dy) || 1;
  const off = Math.min(60, len * 0.18);
  return `M ${a.x} ${a.y} Q ${mx + (-dy / len) * off} ${my + (dx / len) * off} ${b.x} ${b.y}`;
}

interface Palette {
  land: string; land2: string; water: string; park: string;
  roadCasing: string; roadFill: string; primaryCasing: string; primaryFill: string; label: string;
  route0: string; route1: string; origin: string; dest: string; car: string; ink: string;
}
const DARK: Palette = {
  land: '#141518', land2: '#0f1012', water: '#0f2230', park: '#16241b',
  roadCasing: '#0e0f11', roadFill: '#2a2c32', primaryCasing: '#0c0d0f', primaryFill: '#474a53', label: '#7b7f88',
  route0: '#4be391', route1: '#1fb863', origin: '#4be391', dest: '#e8b84a', car: '#4be391', ink: '#04160c',
};
const LIGHT: Palette = {
  land: '#eeeff2', land2: '#f3f4f6', water: '#aed3f2', park: '#cfead6',
  roadCasing: '#d9dce1', roadFill: '#ffffff', primaryCasing: '#e3c675', primaryFill: '#ffeebf', label: '#6f737c',
  route0: '#00b85c', route1: '#00843d', origin: '#00843d', dest: '#b7791f', car: '#00843d', ink: '#ffffff',
};

interface Props {
  origin: LatLng;
  destination?: LatLng | null;
  stops?: LatLng[];
  car?: LatLng | null;
  /** Type de véhicule suivi (course = voiture, livraison = moto). */
  vehicle?: 'car' | 'moto';
  /** Affiche les marqueurs de trafic (carrefours/feux/embouteillages). */
  traffic?: boolean;
  /** Le chauffeur rejoint le départ : son trajet d'approche est tracé en pointillés. */
  approche?: boolean;
  /* --- Navigation guidée (app chauffeur), carte réelle uniquement --- */
  trace?: LatLng[] | null;
  ponts?: string[];
  /** Péages de l'itinéraire choisi (pont à péage) : mis en avant sur la carte. */
  peages?: { id: string; nom: string; lat: number; lng: number; montant: number }[];
  suivi?: boolean;
  basCouvert?: number;
  libelleRecentrer?: string;
}

/** Itinéraire, départ et véhicule prennent la couleur choisie par le client. */
const ACCENT_CARTE: Record<Accent, Record<'dark' | 'light', Partial<Palette>>> = {
  // Le fond de carte ne change pas avec l'accent : seuls l'itinéraire, le départ et le véhicule le portent.
  vert: { dark: {}, light: {} },
  orange: {
    dark: { route0: '#ffa466', route1: '#f06a10', origin: '#ffa466', car: '#ffa466', ink: '#1f0d00' },
    light: { route0: '#ff6a00', route1: '#b84300', origin: '#b84300', car: '#b84300' },
  },
  bleu: {
    dark: { route0: '#9cc1ff', route1: '#4a8bff', origin: '#9cc1ff', car: '#9cc1ff', ink: '#03112a' },
    light: { route0: '#1463ff', route1: '#0b57e6', origin: '#0b57e6', car: '#0b57e6' },
  },
  // Blanc : la carte reste pure ; l'itinéraire est à l'encre (noir en clair, blanc en sombre).
  blanc: {
    dark: { route0: '#f4f4f6', route1: '#c9cbd1', origin: '#f4f4f6', car: '#f4f4f6', ink: '#0c0d0f' },
    light: { route0: '#121315', route1: '#3a3c42', origin: '#121315', car: '#121315' },
  },
  jaune: {
    dark: { route0: '#ffd23f', route1: '#f5b800', origin: '#ffd23f', car: '#ffd23f', ink: '#1f1600' },
    light: { route0: '#f5b800', route1: '#946b00', origin: '#946b00', car: '#946b00', ink: '#1f1600' },
  },
  marron: {
    dark: { route0: '#d8a274', route1: '#b5713b', origin: '#d8a274', car: '#d8a274', ink: '#1c0f05' },
    light: { route0: '#a8693a', route1: '#7a4a24', origin: '#7a4a24', car: '#7a4a24' },
  },
  violet: {
    dark: { route0: '#b69cff', route1: '#8a5cff', origin: '#b69cff', car: '#b69cff', ink: '#12062e' },
    light: { route0: '#7c4dff', route1: '#5b2fd6', origin: '#5b2fd6', car: '#5b2fd6' },
  },
  rose: {
    dark: { route0: '#ff8fbd', route1: '#ff5c9a', origin: '#ff8fbd', car: '#ff8fbd', ink: '#22050f' },
    light: { route0: '#e94b8a', route1: '#c2185b', origin: '#c2185b', car: '#c2185b' },
  },
};

export function OrionMap(props: Props) {
  // Vraie carte de Côte d'Ivoire par défaut ; carte stylisée si elle ne se charge pas.
  const [repli, setRepli] = useState(false);
  // Fond Google Maps (clé saisie par le client ou intégrée) ; s'il échoue, la carte ORION reprend.
  const [fond, setFond] = useState(fondCarte);
  const [googleEchec, setGoogleEchec] = useState(false);
  const [refus, setRefus] = useState(cleRefusee);
  useEffect(() => suivreFondCarte(() => { setFond(fondCarte()); setGoogleEchec(false); setRefus(cleRefusee()); }), []);
  // Construction « Google seul » : pas d'autre carte ; si Google manque, l'écran le dit.
  const seul = googleSeul();
  const gps = useContext(GpsCarte);
  const config = getVectorConfig();
  const { origin, destination, stops, car, vehicle, approche, trace, ponts, suivi, basCouvert, libelleRecentrer, peages } = props;
  // NAVIGATION GUIDÉE (app chauffeur, en course) : vue GPS comme Yango ou Waze — caméra derrière
  // le véhicule, carte inclinée et tournée dans le sens de la route, noms de rues lisibles.
  // La carte Google de l'application ne sait ni s'incliner ni tourner ; la vraie carte (MapLibre,
  // OpenStreetMap, la même que celle des consignes de guidage) le fait. La vue d'ensemble reste Google.
  const navigationGps = Boolean(suivi && car && config && !repli);
  const carte = navigationGps
    ? <CarteReelle origin={origin} destination={destination} stops={stops} car={car} vehicle={vehicle} approche={approche} config={config!} onEchec={() => setRepli(true)}
        trace={trace} ponts={ponts} suivi basCouvert={basCouvert} libelleRecentrer={libelleRecentrer} peages={peages} />
    : fond === 'google' && !googleEchec && !(seul && refus)
    ? <CarteGoogle origin={origin} destination={destination} stops={stops} car={car} vehicle={vehicle} approche={approche} moi={gps?.moi} voisins={gps?.voisins}
        trace={trace} peages={peages} basCouvert={basCouvert} onEchec={() => setGoogleEchec(true)} />
    : seul ? <GoogleIndisponible />
    : config && !repli
      ? <CarteReelle origin={origin} destination={destination} stops={stops} car={car} vehicle={vehicle} approche={approche} config={config} onEchec={() => setRepli(true)}
          trace={trace} ponts={ponts} suivi={suivi} basCouvert={basCouvert} libelleRecentrer={libelleRecentrer} moi={gps?.moi} peages={peages} />
      : <CarteStylisee {...props} />;
  return (
    <>
      {carte}
      {gps && (
        <button type="button" className={`bulle carte-gps${gps.occupe ? ' occupe' : ''}`} onClick={gps.actualiser} disabled={gps.occupe} aria-label={gps.libelle} title={gps.libelle}>
          {gps.occupe ? <IconRefresh size={22} /> : <IconLocate size={22} />}
        </button>
      )}
    </>
  );
}

/** Carte stylisée hors-ligne (démonstration sans réseau, repli). */
function CarteStylisee({ origin, destination, stops = [], car, vehicle = 'car', traffic = true, trace }: Props) {
  const { resolved, accent } = useTheme();
  const P: Palette = { ...(resolved === 'light' ? LIGHT : DARK), ...ACCENT_CARTE[accent][resolved] };

  const o = useMemo(() => project(origin), [origin]);
  const d = useMemo(() => (destination ? project(destination) : null), [destination]);
  const sp = useMemo(() => stops.map(project), [stops]);
  const c = useMemo(() => (car ? project(car) : null), [car]);

  // Trame résidentielle (avenues + rues) générée pour densifier la ville.
  const grid = useMemo(() => {
    const av: string[] = [];
    for (let x = -20; x <= 420; x += 30) {
      const j = ((x / 30) % 2 === 0 ? 1 : -1);
      av.push(`M ${x} -20 C ${x + 16 * j} 200, ${x - 14 * j} 520, ${x + 9 * j} 820`);
    }
    const st: string[] = [];
    for (let y = -20; y <= 820; y += 34) {
      const j = ((y / 34) % 2 === 0 ? 1 : -1);
      st.push(`M -20 ${y} C 120 ${y + 12 * j}, 280 ${y - 12 * j}, 420 ${y + 7 * j}`);
    }
    return [...av, ...st];
  }, []);

  // Itinéraire passant par les arrêts.
  const points: Pt[] = d ? [o, ...sp, d] : [];
  // Navigation guidée (chauffeur) : le tracé réel restant, point par point, même hors ligne.
  const segs = trace && trace.length > 1
    ? [trace.map(project).map((p, i) => `${i ? 'L' : 'M'} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(' ')]
    : points.slice(1).map((p, i) => curvedPath(points[i]!, p));

  return (
    <div className="map-wrap">
      <svg viewBox={`0 0 ${VIEW_W} ${VIEW_H}`} preserveAspectRatio="xMidYMid slice">
        <defs>
          <radialGradient id="bgGlow" cx="50%" cy="34%" r="72%">
            <stop offset="0%" stopColor={P.land2} />
            <stop offset="100%" stopColor={P.land} />
          </radialGradient>
          <linearGradient id="routeGrad" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor={P.route0} />
            <stop offset="100%" stopColor={P.route1} />
          </linearGradient>
          <clipPath id="frame"><rect width={VIEW_W} height={VIEW_H} /></clipPath>
        </defs>

        <g clipPath="url(#frame)">
          <rect width={VIEW_W} height={VIEW_H} fill="url(#bgGlow)" />

          {/* Espaces verts (Parc du Banco, jardins). */}
          <g fill={P.park} opacity="0.7">
            <ellipse cx="64" cy="150" rx="76" ry="64" />
            <ellipse cx="336" cy="120" rx="58" ry="48" />
            <ellipse cx="366" cy="712" rx="64" ry="74" />
          </g>

          {/* Trame résidentielle (rues) — casing puis remplissage. */}
          <g stroke={P.roadCasing} strokeWidth="2.4" fill="none" opacity="0.85">
            {grid.map((dp, i) => <path key={i} d={dp} />)}
          </g>
          <g stroke={P.roadFill} strokeWidth="1.1" fill="none" opacity="0.8">
            {grid.map((dp, i) => <path key={i} d={dp} />)}
          </g>

          {/* Grands boulevards (voirie primaire) — casing + remplissage chaud. */}
          <g stroke={P.primaryCasing} strokeWidth="7" fill="none" strokeLinecap="round">
            {PRIMARIES.map((dp, i) => <path key={i} d={dp} />)}
          </g>
          <g stroke={P.primaryFill} strokeWidth="4.2" fill="none" strokeLinecap="round">
            {PRIMARIES.map((dp, i) => <path key={i} d={dp} />)}
          </g>

          {/* Lagune Ébrié — dessinée AU-DESSUS de la voirie (Abidjan est bâtie autour). */}
          <g>
            <path
              d="M -20 448 C 90 424 168 466 250 448 C 322 432 372 466 420 446 L 420 572 C 350 598 300 560 250 572 C 158 590 88 552 -20 590 Z"
              fill={P.water}
            />
            {/* Baie de Cocody (bras vertical) */}
            <path d="M 244 452 C 252 540 250 660 246 820 L 302 820 C 308 660 302 540 300 456 Z" fill={P.water} />
            {/* Reflet subtil */}
            <path d="M -20 470 C 100 452 180 486 260 470 C 330 456 372 484 420 468" fill="none"
              stroke={P.roadFill} strokeOpacity="0.25" strokeWidth="2" />
          </g>

          {/* Ponts sur la lagune (Pont HKB / FHB / de Gaulle) — casing + tablier. */}
          <g stroke={P.primaryCasing} strokeWidth="7" fill="none" strokeLinecap="butt">
            {BRIDGES.map((dp, i) => <path key={i} d={dp} />)}
          </g>
          <g stroke={P.primaryFill} strokeWidth="4.2" fill="none" strokeLinecap="butt">
            {BRIDGES.map((dp, i) => <path key={i} d={dp} />)}
          </g>

          {/* Libellés de communes + lagune. */}
          <g fill={P.label} fontSize="11" fontWeight="700" opacity="0.92"
             style={{ letterSpacing: '0.12em', textTransform: 'uppercase' } as React.CSSProperties}>
            <text x="150" y="300">Plateau</text>
            <text x="300" y="150">Cocody</text>
            <text x="56" y="250">Yopougon</text>
            <text x="150" y="185">Adjamé</text>
            <text x="150" y="120">Abobo</text>
            <text x="326" y="360">Riviera</text>
            <text x="120" y="424">Treichville</text>
            <text x="188" y="648">Marcory</text>
            <text x="300" y="700">Koumassi</text>
          </g>
          <text x="40" y="530" fill={P.water} fontSize="12" fontWeight="700" opacity="0.9"
            style={{ letterSpacing: '0.16em' } as React.CSSProperties}
            stroke={P.land} strokeWidth="0.4">Lagune Ébrié</text>
        </g>

        {/* Trafic : carrefours / feux tricolores / embouteillages. */}
        {traffic && TRAFFIC_POINTS.map((tp, i) => (
          <g key={i} transform={`translate(${tp.x} ${tp.y})`}>
            {tp.c === '#ff4d5e' && <circle r="9" fill="#ff4d5e" opacity="0.22" />}
            <circle r="4" fill={tp.c} stroke={P.ink} strokeWidth="1" />
          </g>
        ))}

        {/* Itinéraire (segments via arrêts). */}
        {segs.map((s, i) => (
          <g key={i}>
            <path className="route-line" d={s} />
            <path className="route-dash" d={s} />
          </g>
        ))}

        {/* Arrêts intermédiaires numérotés. */}
        {sp.map((p, i) => (
          <g key={i} transform={`translate(${p.x} ${p.y})`}>
            <circle r="9" fill={P.route1} stroke={P.ink} strokeWidth="2" />
            <text textAnchor="middle" y="3.5" fontSize="10" fontWeight="700" fill={P.ink}>{i + 1}</text>
          </g>
        ))}

        {d && <Pin x={d.x} y={d.y} kind="dest" P={P} />}

        {/* VÉHICULE — repère de suivi (voiture pour une course, moto pour une livraison). */}
        {c && (vehicle === 'moto' ? <MotoMarker x={c.x} y={c.y} P={P} /> : <CarMarker x={c.x} y={c.y} P={P} />)}

        <Pin x={o.x} y={o.y} kind="origin" P={P} />
      </svg>
      <div className="map-grad-top" />
    </div>
  );
}

function CarMarker({ x, y, P }: { x: number; y: number; P: Palette }) {
  // Voiture vue de dessus (rendu 3D), sur un halo : on la repère d'un coup d'œil.
  return (
    <g className="car-marker" transform={`translate(${x} ${y})`}>
      <circle r="22" fill={P.car} opacity="0.16" className="marker-halo" />
      <image href={rendu('voiture-dessus')} x="-9" y="-18" width="18" height="36" />
    </g>
  );
}

function MotoMarker({ x, y, P }: { x: number; y: number; P: Palette }) {
  // Scooter de livraison vu de dessus (rendu 3D).
  return (
    <g className="car-marker" transform={`translate(${x} ${y})`}>
      <circle r="20" fill={P.car} opacity="0.16" className="marker-halo" />
      <image href={rendu('scooter-dessus')} x="-8" y="-16" width="16" height="32" />
    </g>
  );
}

function Pin({ x, y, kind, P }: { x: number; y: number; kind: 'origin' | 'dest'; P: Palette }) {
  if (kind === 'origin') {
    return (
      <g className="pin pin-pulse" transform={`translate(${x} ${y})`}>
        <circle r="16" fill={P.origin} opacity="0.18" />
        <circle r="7" fill={P.origin} stroke={P.ink} strokeWidth="2.5" />
      </g>
    );
  }
  return (
    <g className="pin pin-pulse" transform={`translate(${x} ${y})`}>
      <path d="M0 2 C 9 2 14 9 14 15 C 14 24 0 34 0 34 C 0 34 -14 24 -14 15 C -14 9 -9 2 0 2 Z" fill={P.dest} stroke={P.ink} strokeWidth="2" transform="translate(0 -34)" />
      <circle cx="0" cy="-19" r="4.5" fill={P.ink} />
    </g>
  );
}

// Grands boulevards d'Abidjan (tracés indicatifs) : Bd Lagunaire, Autoroute du Nord,
// Bd VGE, Bd de Marseille — voirie primaire mise en avant.
const PRIMARIES = [
  'M -20 250 C 120 236 260 300 420 244',
  'M 84 -20 C 120 200 96 520 168 820',
  'M -20 610 C 140 590 270 650 420 596',
  'M 250 -20 C 300 220 332 520 300 820',
  'M -20 380 C 160 360 300 396 420 372',
];

// Ponts sur la lagune Ébrié (tabliers traversant l'eau).
const BRIDGES = [
  'M 168 436 L 176 588',   // axe Plateau ↔ sud
  'M 296 440 L 300 590',   // axe est
  'M 96 452 L 104 596',    // pont ouest
];

// Carrefours majeurs d'Abidjan (repères) — vert = fluide, orange = dense, rouge = embouteillage.
const TRAFFIC_POINTS = [
  { x: 150, y: 250, c: '#ff4d5e' }, // Carrefour dense
  { x: 84, y: 380, c: '#f5c451' },
  { x: 300, y: 372, c: '#22c55e' },
  { x: 168, y: 500, c: '#f5c451' },
  { x: 300, y: 610, c: '#22c55e' },
];
