import type { FleetUnit, Alert } from './Admin';

/**
 * Carte de supervision (console admin) : projette la flotte et les alertes SAMU sur
 * l'emprise d'Abidjan. Fond sombre « ops room ». Même projection que la carte cliente.
 */
const W = 720, H = 420;
const B = { minLat: 5.18, maxLat: 5.46, minLng: -4.14, maxLng: -3.68 };
const px = (lng: number) => ((lng - B.minLng) / (B.maxLng - B.minLng)) * W;
const py = (lat: number) => (1 - (lat - B.minLat) / (B.maxLat - B.minLat)) * H;

const grid = () => {
  const p: string[] = [];
  for (let x = 40; x < W; x += 60) p.push(`M ${x} 0 L ${x} ${H}`);
  for (let y = 40; y < H; y += 60) p.push(`M 0 ${y} L ${W} ${y}`);
  return p;
};

export function SupervisionMap({ fleet, alerts }: { fleet: FleetUnit[]; alerts: Alert[] }) {
  return (
    <div className="adm-map">
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMid slice">
        <rect width={W} height={H} fill="#08160f" />
        <g stroke="#123b2a" strokeWidth="1" fill="none">{grid().map((d, i) => <path key={i} d={d} />)}</g>
        {/* Lagune */}
        <path d="M 0 250 C 180 232 320 268 460 250 C 560 236 640 262 720 248 L 720 330 C 600 350 520 320 440 332 C 300 350 160 322 0 352 Z" fill="#0a2b3c" opacity="0.85" />
        {/* Grands axes */}
        <g stroke="#1f4a34" strokeWidth="4" fill="none" strokeLinecap="round">
          <path d="M 0 150 C 220 140 460 180 720 150" />
          <path d="M 160 0 C 200 160 180 300 250 420" />
          <path d="M 520 0 C 560 160 590 300 560 420" />
        </g>

        {/* Flotte */}
        {fleet.map((u) => {
          const on = u.availability === 'on_trip';
          return (
            <g key={u.id} transform={`translate(${px(u.lng)} ${py(u.lat)})`}>
              <circle r="9" fill={on ? '#f5c451' : '#2bffa6'} opacity="0.16" />
              <circle r="4.5" fill={on ? '#f5c451' : '#2bffa6'} stroke="#04140d" strokeWidth="1" />
            </g>
          );
        })}

        {/* Alertes SAMU */}
        {alerts.map((a) => (
          <g key={a.id} transform={`translate(${px(a.location.lng)} ${py(a.location.lat)})`}>
            <circle r="16" fill="#ff5468" opacity="0.22"><animate attributeName="r" values="10;20;10" dur="1.6s" repeatCount="indefinite" /></circle>
            <circle r="6" fill="#ff5468" stroke="#fff" strokeWidth="1.5" />
          </g>
        ))}
      </svg>
    </div>
  );
}
