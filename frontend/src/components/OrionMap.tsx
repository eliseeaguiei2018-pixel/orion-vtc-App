import { useMemo } from 'react';
import type { LatLng } from '../types';
import { useTheme } from '../theme';

/**
 * Carte stylisée ORION projetant de vraies coordonnées d'Abidjan, adaptée au thème
 * (clair / sombre). Affiche l'itinéraire (avec arrêts), des marqueurs de trafic
 * (carrefours / embouteillages) et une VOITURE comme repère de suivi.
 * En présence d'une clé Google Maps, on peut substituer une carte réelle sans changer l'app.
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
  bg0: string; bg1: string; street1: string; street2: string; lagune: string;
  route0: string; route1: string; origin: string; dest: string; car: string; ink: string;
}
const DARK: Palette = { bg0: '#0e3325', bg1: '#04100b', street1: '#103527', street2: '#163f2e', lagune: '#072a3a', route0: '#2bffa6', route1: '#00b46e', origin: '#2bffa6', dest: '#f5c451', car: '#2bffa6', ink: '#04140d' };
const LIGHT: Palette = { bg0: '#e9faf1', bg1: '#ffffff', street1: '#d2e8dd', street2: '#bfdacd', lagune: '#d3ecf5', route0: '#00c884', route1: '#008a53', origin: '#00a865', dest: '#e0a92e', car: '#00a865', ink: '#ffffff' };

interface Props {
  origin: LatLng;
  destination?: LatLng | null;
  stops?: LatLng[];
  car?: LatLng | null;
  /** Affiche les marqueurs de trafic (carrefours/feux/embouteillages). */
  traffic?: boolean;
}

export function OrionMap({ origin, destination, stops = [], car, traffic = true }: Props) {
  const { resolved } = useTheme();
  const P = resolved === 'light' ? LIGHT : DARK;

  const o = useMemo(() => project(origin), [origin]);
  const d = useMemo(() => (destination ? project(destination) : null), [destination]);
  const sp = useMemo(() => stops.map(project), [stops]);
  const c = useMemo(() => (car ? project(car) : null), [car]);

  // Itinéraire passant par les arrêts.
  const points: Pt[] = d ? [o, ...sp, d] : [];
  const segs = points.slice(1).map((p, i) => curvedPath(points[i]!, p));

  return (
    <div className="map-wrap">
      <svg viewBox={`0 0 ${VIEW_W} ${VIEW_H}`} preserveAspectRatio="xMidYMid slice">
        <defs>
          <radialGradient id="bgGlow" cx="50%" cy="38%" r="60%">
            <stop offset="0%" stopColor={P.bg0} />
            <stop offset="100%" stopColor={P.bg1} />
          </radialGradient>
          <linearGradient id="routeGrad" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor={P.route0} />
            <stop offset="100%" stopColor={P.route1} />
          </linearGradient>
          <filter id="soft"><feGaussianBlur stdDeviation="1.1" /></filter>
        </defs>

        <rect width={VIEW_W} height={VIEW_H} fill="url(#bgGlow)" />

        <g stroke={P.street1} strokeWidth="6" opacity="0.55" filter="url(#soft)">
          {STREETS.map((dp, i) => <path key={i} d={dp} fill="none" />)}
        </g>
        <g stroke={P.street2} strokeWidth="1.4" opacity="0.5">
          {STREETS.map((dp, i) => <path key={i} d={dp} fill="none" />)}
        </g>

        <path d="M -20 560 C 120 520 200 600 400 540 L 400 700 C 220 660 120 700 -20 660 Z" fill={P.lagune} opacity="0.6" />

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

        {/* VOITURE — repère de suivi de l'itinéraire. */}
        {c && <CarMarker x={c.x} y={c.y} P={P} />}

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
      <circle r="12.5" fill={P.bg1} stroke={P.car} strokeWidth="2" />
      <g transform="translate(-7 -6) scale(0.6)" fill="none" stroke={P.car} strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M2 13l1.4-4.2A2 2 0 0 1 5.3 7.5h9.4a2 2 0 0 1 1.9 1.3L18 13" />
        <rect x="1.5" y="13" width="17" height="4.5" rx="1.6" />
        <circle cx="6" cy="17.5" r="1.2" /><circle cx="14" cy="17.5" r="1.2" />
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

const STREETS = [
  'M 0 120 L 400 90', 'M 0 230 Q 200 200 400 250', 'M 40 0 L 90 800', 'M 180 0 Q 220 400 160 800',
  'M 300 0 L 340 800', 'M 0 380 L 400 360', 'M 0 470 Q 200 450 400 480', 'M 120 0 L 150 560',
  'M 250 60 L 400 600', 'M 0 650 L 400 640',
];

// Carrefours majeurs d'Abidjan (repères) — vert = fluide, orange = dense, rouge = embouteillage.
const TRAFFIC_POINTS = [
  { x: 150, y: 250, c: '#ff4d5e' }, // Carrefour dense
  { x: 90, y: 380, c: '#f5c451' },
  { x: 300, y: 360, c: '#22c55e' },
  { x: 160, y: 480, c: '#f5c451' },
  { x: 340, y: 600, c: '#22c55e' },
];
