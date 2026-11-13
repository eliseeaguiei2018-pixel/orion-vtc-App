import type { FleetUnit, Alert } from './types';

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

const SEUIL_DETAIL = 300;
const ALERTES_ANIMEES = 12;

/** Points groupés : un tracé par couleur, chaque véhicule est un trait de longueur nulle à bout rond. */
function FlotteGroupee({ fleet }: { fleet: FleetUnit[] }) {
  let libres = '';
  let enCourse = '';
  for (const u of fleet) {
    const d = `M${px(u.lng).toFixed(1)} ${py(u.lat).toFixed(1)}h0`;
    if (u.availability === 'on_trip') enCourse += d; else libres += d;
  }
  return (
    <g fill="none" strokeLinecap="round">
      <path d={libres} stroke="#2bffa6" strokeWidth="3.2" opacity="0.75" />
      <path d={enCourse} stroke="#f5c451" strokeWidth="3.6" opacity="0.9" />
    </g>
  );
}

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

        {/* Flotte : détaillée jusqu'à quelques centaines de véhicules ; au-delà, deux tracés
            groupés (libres, en course). 5 000 véhicules en nœuds SVG individuels, c'était
            10 000 cercles redessinés à chaque rafraîchissement : la console décrochait. */}
        {fleet.length <= SEUIL_DETAIL ? fleet.map((u) => {
          const on = u.availability === 'on_trip';
          return (
            <g key={u.id} transform={`translate(${px(u.lng)} ${py(u.lat)})`}>
              <circle r="9" fill={on ? '#f5c451' : '#2bffa6'} opacity="0.16" />
              <circle r="4.5" fill={on ? '#f5c451' : '#2bffa6'} stroke="#04140d" strokeWidth="1" />
            </g>
          );
        }) : <FlotteGroupee fleet={fleet} />}

        {/* Alertes SAMU : les plus récentes pulsent, les autres restent fixes (lisible et léger). */}
        {alerts.map((a, i) => (
          <g key={a.id} transform={`translate(${px(a.location.lng)} ${py(a.location.lat)})`}>
            {i < ALERTES_ANIMEES
              ? <circle r="16" fill="#ff5468" opacity="0.22"><animate attributeName="r" values="10;20;10" dur="1.6s" repeatCount="indefinite" /></circle>
              : <circle r="9" fill="#ff5468" opacity="0.18" />}
            <circle r={i < ALERTES_ANIMEES ? 6 : 4} fill="#ff5468" stroke="#fff" strokeWidth={i < ALERTES_ANIMEES ? 1.5 : 1} />
          </g>
        ))}
      </svg>
    </div>
  );
}
