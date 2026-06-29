import { useMemo } from 'react';
import type { LatLng } from '../types';

/**
 * Carte stylisée ORION (cohérente avec la charte premium) projetant de vraies
 * coordonnées d'Abidjan. Sert d'affichage par défaut ; en présence d'une clé Google
 * Maps, on peut substituer une carte Google sans changer le reste de l'app.
 */
const VIEW_W = 400;
const VIEW_H = 800;
// Cadre géographique : Grand Abidjan (+ aéroport, + Bassam).
const BOUNDS = { minLat: 5.18, maxLat: 5.46, minLng: -4.14, maxLng: -3.68 };

function project(p: LatLng): { x: number; y: number } {
  const x = ((p.lng - BOUNDS.minLng) / (BOUNDS.maxLng - BOUNDS.minLng)) * VIEW_W;
  const y = (1 - (p.lat - BOUNDS.minLat) / (BOUNDS.maxLat - BOUNDS.minLat)) * VIEW_H;
  return { x: clamp(x, 14, VIEW_W - 14), y: clamp(y, 14, VIEW_H - 14) };
}
const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));

/** Chemin légèrement courbé entre deux points (effet "itinéraire"). */
function curvedPath(a: { x: number; y: number }, b: { x: number; y: number }): string {
  const mx = (a.x + b.x) / 2;
  const my = (a.y + b.y) / 2;
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy) || 1;
  const off = Math.min(60, len * 0.18);
  const cx = mx + (-dy / len) * off;
  const cy = my + (dx / len) * off;
  return `M ${a.x} ${a.y} Q ${cx} ${cy} ${b.x} ${b.y}`;
}

interface Props {
  origin: LatLng;
  destination?: LatLng | null;
  car?: LatLng | null;
}

export function OrionMap({ origin, destination, car }: Props) {
  const o = useMemo(() => project(origin), [origin]);
  const d = useMemo(() => (destination ? project(destination) : null), [destination]);
  const c = useMemo(() => (car ? project(car) : null), [car]);
  const path = d ? curvedPath(o, d) : null;

  return (
    <div className="map-wrap">
      <svg viewBox={`0 0 ${VIEW_W} ${VIEW_H}`} preserveAspectRatio="xMidYMid slice">
        <defs>
          <radialGradient id="bgGlow" cx="50%" cy="38%" r="60%">
            <stop offset="0%" stopColor="#0e3325" />
            <stop offset="100%" stopColor="#04100b" />
          </radialGradient>
          <linearGradient id="routeGrad" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="#2bffa6" />
            <stop offset="100%" stopColor="#00b46e" />
          </linearGradient>
          <filter id="soft"><feGaussianBlur stdDeviation="1.1" /></filter>
        </defs>

        <rect width={VIEW_W} height={VIEW_H} fill="url(#bgGlow)" />

        {/* Réseau viaire procédural (ambiance ville la nuit). */}
        <g stroke="#103527" strokeWidth="6" opacity="0.55" filter="url(#soft)">
          {STREETS.map((dpath, i) => (
            <path key={i} d={dpath} fill="none" />
          ))}
        </g>
        <g stroke="#163f2e" strokeWidth="1.4" opacity="0.5">
          {STREETS.map((dpath, i) => (
            <path key={i} d={dpath} fill="none" />
          ))}
        </g>

        {/* "Lagune" Ébrié stylisée. */}
        <path d="M -20 560 C 120 520 200 600 400 540 L 400 700 C 220 660 120 700 -20 660 Z" fill="#072a3a" opacity="0.6" />

        {/* Itinéraire. */}
        {path && (
          <>
            <path className="route-line" d={path} />
            <path className="route-dash" d={path} />
          </>
        )}

        {/* Pin destination. */}
        {d && <Pin x={d.x} y={d.y} kind="dest" />}

        {/* Marqueur véhicule animé. */}
        {c && (
          <g className="car-marker" transform={`translate(${c.x} ${c.y})`}>
            <circle r="13" fill="#04140d" stroke="#2bffa6" strokeWidth="2" />
            <circle r="5.5" fill="#2bffa6" />
          </g>
        )}

        {/* Pin origine (toujours visible). */}
        <Pin x={o.x} y={o.y} kind="origin" />
      </svg>
      <div className="map-grad-top" />
    </div>
  );
}

function Pin({ x, y, kind }: { x: number; y: number; kind: 'origin' | 'dest' }) {
  if (kind === 'origin') {
    return (
      <g className="pin pin-pulse" transform={`translate(${x} ${y})`}>
        <circle r="16" fill="#2bffa6" opacity="0.18" />
        <circle r="7" fill="#2bffa6" stroke="#04140d" strokeWidth="2.5" />
      </g>
    );
  }
  return (
    <g className="pin pin-pulse" transform={`translate(${x} ${y})`}>
      <path d="M0 2 C 9 2 14 9 14 15 C 14 24 0 34 0 34 C 0 34 -14 24 -14 15 C -14 9 -9 2 0 2 Z" fill="#f5c451" stroke="#04140d" strokeWidth="2" transform="translate(0 -34)" />
      <circle cx="0" cy="-19" r="4.5" fill="#04140d" />
    </g>
  );
}

// Tracés de rues approximatifs pour l'ambiance (non géographiques).
const STREETS = [
  'M 0 120 L 400 90',
  'M 0 230 Q 200 200 400 250',
  'M 40 0 L 90 800',
  'M 180 0 Q 220 400 160 800',
  'M 300 0 L 340 800',
  'M 0 380 L 400 360',
  'M 0 470 Q 200 450 400 480',
  'M 120 0 L 150 560',
  'M 250 60 L 400 600',
  'M 0 650 L 400 640',
];
