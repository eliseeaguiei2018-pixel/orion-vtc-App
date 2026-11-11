import { useMemo } from 'react';
import type { LatLng } from '../types';
import { useTheme, type Accent } from '../theme';
import { getTileConfig } from '../mapConfig';
import { RealMap } from './RealMap';

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
  land: '#0c2018', land2: '#08160f', water: '#0a2b3c', park: '#123a26',
  roadCasing: '#0d2419', roadFill: '#20402f', primaryCasing: '#6f521c', primaryFill: '#b98a2c', label: '#61806f',
  route0: '#2bffa6', route1: '#00b46e', origin: '#2bffa6', dest: '#f5c451', car: '#2bffa6', ink: '#04140d',
};
const LIGHT: Palette = {
  land: '#e9f1ea', land2: '#f4f8f4', water: '#bfe0f0', park: '#d5eccf',
  roadCasing: '#d0dcd4', roadFill: '#ffffff', primaryCasing: '#eab308', primaryFill: '#ffd775', label: '#8aa093',
  route0: '#00c884', route1: '#008a53', origin: '#00a865', dest: '#e0a92e', car: '#00a865', ink: '#ffffff',
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
}

/** Itinéraire, départ et véhicule prennent la couleur choisie par le client. */
const ACCENT_CARTE: Record<Accent, Record<'dark' | 'light', Partial<Palette>>> = {
  vert: { dark: {}, light: {} },
  orange: {
    dark: { land: '#1c140c', land2: '#140d07', roadCasing: '#22170d', roadFill: '#3d2c1c', label: '#8a735f', route0: '#ffb05a', route1: '#e86a00', origin: '#ffb05a', car: '#ffb05a', ink: '#1c0e02' },
    light: { land: '#f3ece4', land2: '#faf6f1', roadCasing: '#e2d6ca', label: '#a08d7c', route0: '#ff8a1f', route1: '#c25700', origin: '#e06a00', car: '#e06a00' },
  },
  bleu: {
    dark: { land: '#0b1626', land2: '#07101c', roadCasing: '#0d1a2c', roadFill: '#1f3350', label: '#61758f', route0: '#79b8ff', route1: '#1f74e8', origin: '#79b8ff', car: '#79b8ff', ink: '#03112a' },
    light: { land: '#e8eef6', land2: '#f4f7fb', roadCasing: '#d0dae6', label: '#8696ad', route0: '#3d95ff', route1: '#0f5bc4', origin: '#1a6fe0', car: '#1a6fe0' },
  },
};

export function OrionMap({ origin, destination, stops = [], car, vehicle = 'car', traffic = true }: Props) {
  const { resolved, accent } = useTheme();
  const P: Palette = { ...(resolved === 'light' ? LIGHT : DARK), ...ACCENT_CARTE[accent][resolved] };

  // Vrai fond de carte (tuiles) si un fournisseur est configuré ; sinon carte stylisée.
  const tiles = getTileConfig();
  if (tiles) {
    return <RealMap origin={origin} destination={destination} stops={stops} car={car} tiles={tiles} />;
  }

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
  const segs = points.slice(1).map((p, i) => curvedPath(points[i]!, p));

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
          <g fill={P.park} opacity="0.8">
            <ellipse cx="64" cy="150" rx="76" ry="64" />
            <ellipse cx="336" cy="120" rx="58" ry="48" />
            <ellipse cx="366" cy="712" rx="64" ry="74" />
          </g>

          {/* Trame résidentielle (rues) — casing puis remplissage. */}
          <g stroke={P.roadCasing} strokeWidth="3.4" fill="none" opacity="0.9">
            {grid.map((dp, i) => <path key={i} d={dp} />)}
          </g>
          <g stroke={P.roadFill} strokeWidth="1.7" fill="none" opacity="0.95">
            {grid.map((dp, i) => <path key={i} d={dp} />)}
          </g>

          {/* Grands boulevards (voirie primaire) — casing + remplissage chaud. */}
          <g stroke={P.primaryCasing} strokeWidth="9.5" fill="none" strokeLinecap="round">
            {PRIMARIES.map((dp, i) => <path key={i} d={dp} />)}
          </g>
          <g stroke={P.primaryFill} strokeWidth="6" fill="none" strokeLinecap="round">
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
          <g stroke={P.primaryCasing} strokeWidth="9.5" fill="none" strokeLinecap="butt">
            {BRIDGES.map((dp, i) => <path key={i} d={dp} />)}
          </g>
          <g stroke={P.primaryFill} strokeWidth="6" fill="none" strokeLinecap="butt">
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
  return (
    <g className="car-marker" transform={`translate(${x} ${y})`}>
      <circle r="15" fill={P.car} opacity="0.18" />
      <circle r="12.5" fill={P.land2} stroke={P.car} strokeWidth="2" />
      <g transform="translate(-7 -6) scale(0.6)" fill="none" stroke={P.car} strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M2 13l1.4-4.2A2 2 0 0 1 5.3 7.5h9.4a2 2 0 0 1 1.9 1.3L18 13" />
        <rect x="1.5" y="13" width="17" height="4.5" rx="1.6" />
        <circle cx="6" cy="17.5" r="1.2" /><circle cx="14" cy="17.5" r="1.2" />
      </g>
    </g>
  );
}

function MotoMarker({ x, y, P }: { x: number; y: number; P: Palette }) {
  return (
    <g className="car-marker" transform={`translate(${x} ${y})`}>
      <circle r="15" fill={P.car} opacity="0.18" />
      <circle r="12.5" fill={P.land2} stroke={P.car} strokeWidth="2" />
      <g transform="translate(-7.5 -7) scale(0.62)" fill="none" stroke={P.car} strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="5" cy="17" r="3.2" /><circle cx="19" cy="17" r="3.2" />
        <path d="M5 17 L 11 11 L 16 11 L 19 17" /><path d="M11 11 L 8 17" />
        <rect x="2" y="6" width="6.5" height="6" rx="1.2" />
      </g>
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
