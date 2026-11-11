import { useId } from 'react';

/**
 * VÉHICULES ORION : illustrations vectorielles détaillées (vue de profil).
 *
 * Carrosserie en peinture métallisée (dégradé à trois tons, reflet de ligne de caisse,
 * reflet de toit), vitrage teinté avec reflet, phares LED et feux arrière lumineux,
 * jantes aérodynamiques avec étrier de frein, ombre portée douce.
 *
 * La peinture « accent » suit la couleur choisie par le client (vert, orange, bleu) ;
 * les gammes ont leur teinte : bronze, argent, or et « nuit » pour Diamant.
 * Les identifiants SVG sont uniques par illustration (plusieurs véhicules par écran).
 */
export type Modele = 'citadine' | 'berline' | 'suv' | 'luxe';
export type Peinture = 'accent' | 'bronze' | 'argent' | 'or' | 'nuit' | 'perle';

const PEINTURES: Record<Exclude<Peinture, 'accent'>, [string, string, string]> = {
  bronze: ['#f2c18f', '#b8733d', '#5e3213'],
  argent: ['#ffffff', '#bcc5cf', '#56616d'],
  or: ['#ffeab0', '#d9a93a', '#6f4c0f'],
  nuit: ['#6a7a8f', '#1c2532', '#05070b'],
  perle: ['#ffffff', '#e6ecf2', '#9aa7b5'],
};

/** Teinte de la gamme ORION (Bronze → citadine, Diamant → berline de luxe). */
export function vehiculeDeGamme(gamme: string): { modele: Modele; peinture: Peinture } {
  switch (gamme) {
    case 'bronze': return { modele: 'citadine', peinture: 'bronze' };
    case 'argent': return { modele: 'berline', peinture: 'argent' };
    case 'or': return { modele: 'suv', peinture: 'or' };
    case 'diamant': return { modele: 'luxe', peinture: 'nuit' };
    default: return { modele: 'berline', peinture: 'accent' };
  }
}

interface Geo {
  corps: string; vitres: string; montants: string; bas: string;
  roues: [number, number]; r: number; sol: number;
  phare: string; feu: string; ligne: string; toit: string; portes: string; poignees: Array<[number, number]>;
  retro: [number, number]; lueur: [number, number]; chrome?: string; barres?: string;
}

/* Profils dessinés à la main, nez à droite, dans un cadre 240 × 120. */
const GEO: Record<Modele, Geo> = {
  berline: {
    corps: 'M20 87 C 14 85 13 77 16 71 C 18 66 23 63 33 61 L 57 57 C 72 44 94 34 120 32 C 138 31 152 35 162 41 L 177 50 C 197 53 214 57 222 63 C 228 67 229 76 226 82 C 224 88 220 90 213 90 L 199 90 A 23 23 0 0 0 153 90 L 87 90 A 23 23 0 0 0 41 90 L 29 90 C 25 90 22 89 20 87 Z',
    vitres: 'M64 56 C 77 45 96 38 118 37 C 134 37 148 40 158 47 L 168 55 Z',
    montants: 'M114 37 L 116 56 L 121 56 L 119 37 Z',
    bas: 'M41 90 L 87 90 L 153 90 L 199 90 L 199 86 L 41 86 Z',
    roues: [64, 176], r: 19, sol: 105,
    phare: 'M208 61 C 215 62 221 64 224 67 L 222 69 C 216 67 211 66 207 65 Z',
    feu: 'M17 70 C 21 68 26 67 31 67 L 31 70 C 26 70 21 71 18 73 Z',
    ligne: 'M30 66 C 80 61 160 59 216 62',
    toit: 'M72 47 C 88 38 104 35 122 34.5 C 138 34.5 150 38 158 43',
    portes: 'M116 58 L 117 86 M154 56 L 151 86',
    poignees: [[96, 64], [134, 63]],
    retro: [164, 52],
    lueur: [224, 66],
  },
  citadine: {
    corps: 'M26 88 C 20 86 19 78 20 70 C 21 60 26 50 40 44 C 58 36 80 31 106 30 C 124 30 138 33 148 40 L 166 52 C 184 55 200 59 207 65 C 213 70 214 78 211 84 C 209 89 205 90 199 90 L 189 90 A 22 22 0 0 0 145 90 L 91 90 A 22 22 0 0 0 47 90 L 34 90 C 30 90 28 89 26 88 Z',
    vitres: 'M46 54 L 50 44 C 62 38 82 34 104 34 C 120 34 132 38 142 45 L 156 55 Z',
    montants: 'M98 34 L 100 55 L 105 55 L 103 34 Z M48 44 L 52 55 L 58 55 L 55 43 Z',
    bas: 'M47 90 L 91 90 L 145 90 L 189 90 L 189 86 L 47 86 Z',
    roues: [69, 167], r: 18, sol: 104,
    phare: 'M194 60 C 200 61 205 63 208 66 L 206 68 C 201 66 196 65 193 64 Z',
    feu: 'M20 62 C 22 60 25 59 28 59 L 28 66 C 25 66 22 67 20 68 Z',
    ligne: 'M30 64 C 80 60 150 58 202 61',
    toit: 'M54 44 C 70 37 88 34 106 33.5 C 122 33.5 134 37 142 42',
    portes: 'M101 57 L 102 86 M142 55 L 139 86',
    poignees: [[84, 64], [124, 63]],
    retro: [152, 53],
    lueur: [208, 66],
  },
  suv: {
    corps: 'M20 84 C 14 82 13 72 15 64 C 17 56 22 50 34 48 L 52 46 C 64 36 86 28 116 27 C 138 27 152 30 162 36 L 180 46 C 200 49 216 53 223 59 C 229 64 230 74 227 80 C 225 85 221 87 214 87 L 203 87 A 25 25 0 0 0 153 87 L 89 87 A 25 25 0 0 0 39 87 L 29 87 C 25 87 22 86 20 84 Z',
    vitres: 'M56 50 C 68 38 90 32 114 31.5 C 132 31.5 148 34 158 40 L 172 50 Z',
    montants: 'M110 31.5 L 112 50 L 117 50 L 115 31.5 Z M60 47 L 63 50 L 70 50 L 66 44 Z',
    bas: 'M39 87 L 89 87 L 153 87 L 203 87 L 203 81 L 39 81 Z',
    roues: [64, 178], r: 21, sol: 106,
    phare: 'M209 55 C 216 56 222 58 225 61 L 223 64 C 217 62 212 61 208 60 Z',
    feu: 'M15 60 C 19 58 25 57 32 57 L 32 61 C 26 61 20 62 16 64 Z',
    ligne: 'M28 60 C 80 55 160 53 218 57',
    toit: 'M64 42 C 82 33 100 29.5 118 29 C 136 29 150 32 158 37',
    portes: 'M113 52 L 114 81 M156 50 L 153 81',
    poignees: [[92, 59], [134, 58]],
    retro: [168, 46],
    lueur: [226, 60],
    barres: 'M70 33 C 90 26 130 24 152 29',
  },
  luxe: {
    corps: 'M16 86 C 10 84 9 77 12 71 C 14 66 20 63 30 62 L 58 58 C 74 46 98 37 124 35 C 144 34 158 38 168 44 L 184 52 C 204 55 220 59 227 64 C 232 68 233 76 230 82 C 228 87 224 89 217 89 L 205 89 A 23 23 0 0 0 159 89 L 83 89 A 23 23 0 0 0 37 89 L 26 89 C 21 89 18 88 16 86 Z',
    vitres: 'M64 57 C 80 46 102 40 122 39.5 C 140 39.5 154 42 164 49 L 175 56 Z',
    montants: 'M118 39.5 L 120 57 L 125 57 L 123 39.5 Z',
    bas: 'M37 89 L 83 89 L 159 89 L 205 89 L 205 85 L 37 85 Z',
    roues: [60, 182], r: 19, sol: 104,
    phare: 'M213 61 C 220 62 226 64 229 67 L 227 69 C 221 67 216 66 212 65 Z',
    feu: 'M13 70 C 18 68 24 67 30 67 L 30 70 C 24 70 18 71 14 73 Z',
    ligne: 'M26 66 C 80 61 170 59 222 62',
    toit: 'M76 48 C 94 40 110 37.5 126 37 C 142 37 154 40 162 45',
    portes: 'M121 59 L 122 85 M162 57 L 159 85',
    poignees: [[100, 65], [142, 64]],
    retro: [170, 53],
    lueur: [229, 66],
    chrome: 'M64 57.5 C 80 46.5 102 40.5 122 40 C 140 40 154 42.5 164 49.5 L 175 56.5',
  },
};

function Roue({ cx, cy, r, id }: { cx: number; cy: number; r: number; id: string }) {
  const rj = r * 0.66;
  const branches = Array.from({ length: 5 }, (_, i) => {
    const a = (Math.PI * 2 * i) / 5 - Math.PI / 2;
    const x1 = cx + Math.cos(a - 0.2) * rj * 0.32, y1 = cy + Math.sin(a - 0.2) * rj * 0.32;
    const x2 = cx + Math.cos(a - 0.12) * rj * 0.95, y2 = cy + Math.sin(a - 0.12) * rj * 0.95;
    const x3 = cx + Math.cos(a + 0.12) * rj * 0.95, y3 = cy + Math.sin(a + 0.12) * rj * 0.95;
    const x4 = cx + Math.cos(a + 0.2) * rj * 0.32, y4 = cy + Math.sin(a + 0.2) * rj * 0.32;
    return `M${x1.toFixed(1)} ${y1.toFixed(1)} L${x2.toFixed(1)} ${y2.toFixed(1)} L${x3.toFixed(1)} ${y3.toFixed(1)} L${x4.toFixed(1)} ${y4.toFixed(1)} Z`;
  }).join(' ');
  return (
    <g>
      <circle cx={cx} cy={cy} r={r} fill="#0b0f12" />
      <circle cx={cx} cy={cy} r={r - 1.2} fill="none" stroke="#2a3238" strokeWidth="1.2" />
      <circle cx={cx} cy={cy} r={rj} fill={`url(#${id}-jante)`} />
      <circle cx={cx} cy={cy} r={rj * 0.92} fill="#2b3237" />
      <path d={branches} fill={`url(#${id}-jante)`} />
      {/* Étrier de frein à la couleur de l'app */}
      <path d={`M${cx + rj * 0.62} ${cy - rj * 0.5} A ${rj * 0.8} ${rj * 0.8} 0 0 1 ${cx + rj * 0.62} ${cy + rj * 0.5}`} stroke="var(--green)" strokeWidth={r * 0.13} strokeLinecap="round" fill="none" opacity="0.9" />
      <circle cx={cx} cy={cy} r={rj * 0.22} fill="#d5dce2" />
      <circle cx={cx} cy={cy} r={rj * 0.1} fill="#4b555d" />
      <ellipse cx={cx - r * 0.35} cy={cy - r * 0.45} rx={r * 0.32} ry={r * 0.16} fill="#fff" opacity="0.08" transform={`rotate(-30 ${cx - r * 0.35} ${cy - r * 0.45})`} />
    </g>
  );
}

export function Voiture({ modele = 'berline', peinture = 'accent', largeur = 120, phares = true }: {
  modele?: Modele; peinture?: Peinture; largeur?: number; phares?: boolean;
}) {
  const id = `v${useId().replace(/[^a-zA-Z0-9]/g, '')}`;
  const g = GEO[modele];
  const [clair, moyen, sombre] = peinture === 'accent'
    ? ['var(--green-bright)', 'var(--green)', 'var(--accent-darker)']
    : PEINTURES[peinture];
  const [r1, r2] = g.roues;
  const yRoue = g.sol - g.r;
  return (
    <svg width={largeur} height={largeur / 2} viewBox="0 0 240 120" fill="none" aria-hidden className="vehicule">
      <defs>
        <linearGradient id={`${id}-p`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" style={{ stopColor: clair }} />
          <stop offset="0.45" style={{ stopColor: moyen }} />
          <stop offset="1" style={{ stopColor: sombre }} />
        </linearGradient>
        <linearGradient id={`${id}-reflet`} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="#fff" stopOpacity="0" />
          <stop offset="0.35" stopColor="#fff" stopOpacity="0.55" />
          <stop offset="0.7" stopColor="#fff" stopOpacity="0.15" />
          <stop offset="1" stopColor="#fff" stopOpacity="0" />
        </linearGradient>
        <linearGradient id={`${id}-vitre`} x1="0" y1="0" x2="0.3" y2="1">
          <stop offset="0" stopColor="#3c4b5a" />
          <stop offset="0.55" stopColor="#141c24" />
          <stop offset="1" stopColor="#06090c" />
        </linearGradient>
        <radialGradient id={`${id}-jante`} cx="40%" cy="35%" r="70%">
          <stop offset="0" stopColor="#ffffff" />
          <stop offset="0.55" stopColor="#c3ccd4" />
          <stop offset="1" stopColor="#6b7680" />
        </radialGradient>
        <radialGradient id={`${id}-lum`} cx="50%" cy="50%" r="50%">
          <stop offset="0" style={{ stopColor: 'var(--green-bright)' }} stopOpacity="0.9" />
          <stop offset="1" style={{ stopColor: 'var(--green-bright)' }} stopOpacity="0" />
        </radialGradient>
        <filter id={`${id}-flou`} x="-30%" y="-80%" width="160%" height="260%"><feGaussianBlur stdDeviation="3.2" /></filter>
        <filter id={`${id}-flou2`} x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="1.6" /></filter>
      </defs>

      {/* Ombre au sol : diffuse, puis contact sous les roues */}
      <ellipse cx="120" cy={g.sol} rx="104" ry="7" fill="#000" opacity="0.28" filter={`url(#${id}-flou)`} />
      <ellipse cx={r1} cy={g.sol - 1} rx={g.r * 1.05} ry="3" fill="#000" opacity="0.45" filter={`url(#${id}-flou2)`} />
      <ellipse cx={r2} cy={g.sol - 1} rx={g.r * 1.05} ry="3" fill="#000" opacity="0.45" filter={`url(#${id}-flou2)`} />

      {/* Passages de roue sombres (visibles autour des pneus) */}
      {[r1, r2].map((x) => <path key={x} d={`M${x - g.r - 3} ${yRoue + 2} A ${g.r + 3} ${g.r + 3} 0 0 1 ${x + g.r + 3} ${yRoue + 2} Z`} fill="#07090b" />)}
      {/* Carrosserie */}
      <path d={g.corps} fill={`url(#${id}-p)`} />
      {g.barres && <path d={g.barres} stroke="#1a2026" strokeWidth="3" strokeLinecap="round" />}
      {/* Bas de caisse sombre */}
      <path d={g.bas} fill="#0b0f12" opacity="0.55" />
      {/* Vitrage teinté, montant, reflet */}
      <path d={g.vitres} fill={`url(#${id}-vitre)`} />
      <path d={g.montants} fill="#06090c" opacity="0.9" />
      <path d={g.vitres} fill={`url(#${id}-reflet)`} opacity="0.35" transform="translate(-6 0) skewX(-8)" />
      {g.chrome && <path d={g.chrome} stroke="#e8eef3" strokeWidth="1.4" fill="none" opacity="0.9" />}
      {/* Reflets de peinture : toit et ligne de caisse */}
      <path d={g.toit} stroke="#fff" strokeOpacity="0.55" strokeWidth="2" strokeLinecap="round" fill="none" />
      <path d={g.ligne} stroke={`url(#${id}-reflet)`} strokeWidth="2.4" strokeLinecap="round" fill="none" />
      {/* Portes et poignées affleurantes */}
      <path d={g.portes} stroke="#000" strokeOpacity="0.22" strokeWidth="1" />
      {g.poignees.map(([x, y]) => <rect key={x} x={x} y={y} width="12" height="2.2" rx="1.1" fill="#000" opacity="0.28" />)}
      {/* Rétroviseur */}
      <path d={`M${g.retro[0]} ${g.retro[1]} l7 -1.5 c2 0 2.5 3 0.5 3.6 l-7 1.4 Z`} fill={`url(#${id}-p)`} stroke="#000" strokeOpacity="0.25" strokeWidth="0.6" />
      {/* Feuille ORION */}
      {g.poignees[1] && <path d={`M${g.poignees[1][0] + 22} ${g.poignees[1][1] + 6} c 5 -1 8 -4 8 -8.5 c -5 0 -8 3.2 -8 8.5 Z`} fill="#fff" opacity="0.75" />}
      {/* Éclairage */}
      {phares && <ellipse cx={g.lueur[0]} cy={g.lueur[1]} rx="16" ry="8" fill={`url(#${id}-lum)`} opacity="0.6" />}
      <path d={g.phare} fill="#f4fbff" />
      <path d={g.feu} fill="#ff3b4a" />
      <path d={g.feu} fill="#ff3b4a" opacity="0.6" filter={`url(#${id}-flou2)`} />
      {/* Roues */}
      <Roue cx={r1} cy={yRoue} r={g.r} id={id} />
      <Roue cx={r2} cy={yRoue} r={g.r} id={id} />
    </svg>
  );
}

/** Scooter électrique de livraison, top-case à la couleur de l'app. */
export function Scooter({ largeur = 120 }: { largeur?: number }) {
  const id = `s${useId().replace(/[^a-zA-Z0-9]/g, '')}`;
  return (
    <svg width={largeur} height={largeur / 2} viewBox="0 0 240 120" fill="none" aria-hidden className="vehicule">
      <defs>
        <linearGradient id={`${id}-c`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#5b6a75" /><stop offset="0.5" stopColor="#27313a" /><stop offset="1" stopColor="#0d1217" />
        </linearGradient>
        <linearGradient id={`${id}-coffre`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" style={{ stopColor: 'var(--green-bright)' }} />
          <stop offset="0.55" style={{ stopColor: 'var(--green)' }} />
          <stop offset="1" style={{ stopColor: 'var(--accent-darker)' }} />
        </linearGradient>
        <radialGradient id={`${id}-jante`} cx="40%" cy="35%" r="70%">
          <stop offset="0" stopColor="#ffffff" /><stop offset="0.55" stopColor="#c3ccd4" /><stop offset="1" stopColor="#6b7680" />
        </radialGradient>
        <radialGradient id={`${id}-lum`} cx="50%" cy="50%" r="50%">
          <stop offset="0" style={{ stopColor: 'var(--green-bright)' }} stopOpacity="0.9" />
          <stop offset="1" style={{ stopColor: 'var(--green-bright)' }} stopOpacity="0" />
        </radialGradient>
        <filter id={`${id}-flou`} x="-30%" y="-80%" width="160%" height="260%"><feGaussianBlur stdDeviation="3" /></filter>
      </defs>
      <ellipse cx="122" cy="105" rx="86" ry="6" fill="#000" opacity="0.3" filter={`url(#${id}-flou)`} />
      {/* Roues (pneus larges, disques) */}
      {[64, 182].map((x) => (
        <g key={x}>
          <circle cx={x} cy="88" r="17" fill="#0b0f12" />
          <circle cx={x} cy="88" r="11" fill={`url(#${id}-jante)`} />
          <circle cx={x} cy="88" r="8" fill="#2b3237" />
          <circle cx={x} cy="88" r="5.5" fill="none" stroke="#9aa5ae" strokeWidth="1.4" strokeDasharray="2 1.6" />
          <circle cx={x} cy="88" r="2.2" fill="#d5dce2" />
        </g>
      ))}
      {/* Carénage arrière (sur la roue) */}
      <path d="M36 80 C 34 64 46 56 66 55 L 104 56 C 112 57 114 64 108 70 L 96 80 C 90 86 80 84 76 80 C 72 74 60 72 52 78 C 46 82 38 84 36 80 Z" fill={`url(#${id}-c)`} />
      <path d="M44 62 C 60 58 86 58 104 60" stroke="#fff" strokeOpacity="0.35" strokeWidth="1.6" strokeLinecap="round" />
      {/* Plancher */}
      <path d="M96 80 L 146 80 C 150 80 152 82 150 85 L 98 86 Z" fill="#141a20" />
      {/* Tablier avant et fourche */}
      <path d="M140 84 C 144 64 152 48 166 38 L 176 34 C 180 33 182 36 179 39 L 172 44 C 160 54 156 68 156 84 Z" fill={`url(#${id}-c)`} />
      <path d="M168 44 C 174 58 178 72 182 88" stroke="#1d252c" strokeWidth="5" strokeLinecap="round" />
      <path d="M158 50 C 166 42 172 38 178 36" stroke="#fff" strokeOpacity="0.4" strokeWidth="1.4" strokeLinecap="round" />
      {/* Garde-boue avant */}
      <path d="M163 82 C 166 70 196 70 200 82" stroke="#27313a" strokeWidth="5" strokeLinecap="round" fill="none" />
      {/* Selle */}
      <path d="M58 54 C 58 47 68 45 84 45 L 104 46 C 112 46 112 54 104 55 L 64 56 C 60 56 58 55 58 54 Z" fill="#0d1217" />
      <path d="M66 47.5 C 80 46 96 46 106 47.5" stroke="#fff" strokeOpacity="0.15" strokeWidth="1.2" />
      {/* Guidon, rétro, phare */}
      <path d="M170 36 L 186 26" stroke="#1d252c" strokeWidth="4.5" strokeLinecap="round" />
      <circle cx="186" cy="26" r="3" fill="#0d1217" />
      <path d="M180 30 L 186 18" stroke="#1d252c" strokeWidth="1.6" />
      <ellipse cx="187" cy="17" rx="4" ry="2.6" fill="#27313a" />
      <ellipse cx="190" cy="40" rx="15" ry="8" fill={`url(#${id}-lum)`} opacity="0.55" />
      <path d="M174 37 C 180 35 186 37 186 42 L 177 44 Z" fill="#f4fbff" />
      <path d="M38 66 L 44 65 L 44 69 L 38 70 Z" fill="#ff3b4a" />
      {/* Porte-bagages et top-case de livraison ORION */}
      <path d="M58 52 L 50 40" stroke="#1d252c" strokeWidth="3.4" strokeLinecap="round" />
      <ellipse cx="44" cy="42" rx="24" ry="4" fill="#000" opacity="0.25" filter={`url(#${id}-flou)`} />
      <rect x="22" y="12" width="44" height="32" rx="7" fill={`url(#${id}-coffre)`} />
      <rect x="22" y="12" width="44" height="11" rx="7" fill="#fff" opacity="0.18" />
      <path d="M22 30 L 66 30" stroke="#000" strokeOpacity="0.18" />
      <path d="M40 27 c 6 -1.2 9.6 -4.6 9.6 -9.6 c -6 0 -9.6 3.8 -9.6 9.6 Z" fill="#fff" opacity="0.92" />
      <rect x="31" y="35" width="26" height="2.6" rx="1.3" fill="#fff" opacity="0.55" />
    </svg>
  );
}

/** Voiture vue de dessus : repère du véhicule sur la carte. */
export function VoitureDessus({ taille = 26 }: { taille?: number }) {
  const id = `d${useId().replace(/[^a-zA-Z0-9]/g, '')}`;
  return (
    <svg width={taille} height={taille * 1.9} viewBox="0 0 26 50" aria-hidden>
      <defs>
        <linearGradient id={`${id}-p`} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" style={{ stopColor: 'var(--accent-darker)' }} />
          <stop offset="0.5" style={{ stopColor: 'var(--green-bright)' }} />
          <stop offset="1" style={{ stopColor: 'var(--accent-darker)' }} />
        </linearGradient>
      </defs>
      <rect x="1.5" y="2" width="23" height="46" rx="9" fill={`url(#${id}-p)`} stroke="#000" strokeOpacity="0.35" strokeWidth="0.8" />
      <path d="M5 14 C 8 11 18 11 21 14 L 20 20 C 16 18.5 10 18.5 6 20 Z" fill="#0b1117" />
      <path d="M6 36 C 10 37.5 16 37.5 20 36 L 21 41 C 17 43 9 43 5 41 Z" fill="#0b1117" />
      <rect x="6" y="21" width="14" height="14" rx="3" fill="#fff" opacity="0.18" />
      <rect x="4" y="2.5" width="5" height="2" rx="1" fill="#f4fbff" />
      <rect x="17" y="2.5" width="5" height="2" rx="1" fill="#f4fbff" />
      <rect x="4" y="45.5" width="5" height="1.6" rx="0.8" fill="#ff3b4a" />
      <rect x="17" y="45.5" width="5" height="1.6" rx="0.8" fill="#ff3b4a" />
    </svg>
  );
}
