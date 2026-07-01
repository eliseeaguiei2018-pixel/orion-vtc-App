/**
 * Illustrations de services ORION — rendu PREMIUM (vecteur).
 * Dégradés multi-arrêts, reflets spéculaires, jantes alliage, ombres douces (flou).
 * Palette ORION (émeraude/graphite) + accents raffinés. Style cohérent, élégant.
 */
type P = { size?: number };

/** Roue alliage réaliste (pneu + jante argent multi-branches). */
function AlloyWheel({ cx, cy, r, rimId }: { cx: number; cy: number; r: number; rimId: string }) {
  const rr = r * 0.62;
  const spokes = Array.from({ length: 6 }, (_, i) => {
    const a = (Math.PI / 3) * i - Math.PI / 12;
    return `M${cx} ${cy} L${(cx + Math.cos(a) * rr).toFixed(1)} ${(cy + Math.sin(a) * rr).toFixed(1)}`;
  }).join(' ');
  return (
    <g>
      <circle cx={cx} cy={cy} r={r} fill="#0b1712" />
      <circle cx={cx} cy={cy} r={r - 1.5} fill="none" stroke="#243a30" strokeWidth="1.4" />
      <circle cx={cx} cy={cy} r={rr} fill={`url(#${rimId})`} />
      <path d={spokes} stroke="#7b8d85" strokeWidth="1.5" strokeLinecap="round" />
      <circle cx={cx} cy={cy} r={2.1} fill="#586860" />
      <circle cx={cx - rr * 0.4} cy={cy - rr * 0.4} r={rr * 0.5} fill="#ffffff" opacity="0.12" />
    </g>
  );
}

/* --------------------------------- Course : berline EV premium --------------------------------- */
export function IllusCar({ size = 72 }: P) {
  return (
    <svg width={size} height={size * 0.74} viewBox="0 0 132 96" fill="none" aria-hidden>
      <defs>
        <linearGradient id="carB" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#3ceaa6" /><stop offset="42%" stopColor="#0bab6d" /><stop offset="100%" stopColor="#045f3f" />
        </linearGradient>
        <linearGradient id="carG" x1="0" y1="0" x2="0.4" y2="1">
          <stop offset="0%" stopColor="#1d5744" /><stop offset="100%" stopColor="#08231a" />
        </linearGradient>
        <radialGradient id="rimCar" cx="42%" cy="40%" r="60%">
          <stop offset="0%" stopColor="#f6faf8" /><stop offset="60%" stopColor="#c6d2cd" /><stop offset="100%" stopColor="#889a92" />
        </radialGradient>
        <filter id="csCar" x="-20%" y="-20%" width="140%" height="160%"><feGaussianBlur stdDeviation="2.4" /></filter>
      </defs>
      <ellipse cx="66" cy="85" rx="54" ry="7" fill="#04140d" opacity="0.18" filter="url(#csCar)" />
      <ellipse cx="66" cy="80" rx="44" ry="6" fill="#2bffa6" opacity="0.18" filter="url(#csCar)" />
      {/* Carrosserie */}
      <path d="M9 68 C 8 58 15 53 25 52 L 39 43 C 49 36 61 34 74 35 C 90 36 102 42 110 51 L 120 54 C 126 56 128 61 126 68 Z" fill="url(#carB)" />
      {/* Bas de caisse (ombre) */}
      <path d="M9 68 C 26 71 106 71 126 68 L 126 68 C 120 66 20 66 9 68 Z" fill="#04140d" opacity="0.25" />
      {/* Vitrage teinté */}
      <path d="M45 45 C 52 38.5 62 37 72 37.4 C 82 37.8 90 40.5 96 45 Z" fill="url(#carG)" />
      <path d="M70.5 37.4 L 70.5 45 L 74 45 L 74 37.5 Z" fill="#04140d" opacity="0.35" />
      {/* Reflet vitre */}
      <path d="M49 44 C 55 39.5 62 38.4 69 38.4 L 60 44 Z" fill="#eafff6" opacity="0.35" />
      {/* Reflet spéculaire carrosserie */}
      <path d="M40 43.5 C 50 37 62 35.4 74 36.2 C 86 37 97 42 105 49" stroke="#eafff6" strokeWidth="1.6" opacity="0.5" fill="none" strokeLinecap="round" />
      {/* Feu avant LED */}
      <path d="M118 55 L 126 57 C 127 59 127 60 125 60 L 118 59 Z" fill="#eafff6" />
      <circle cx="122" cy="62" r="1.6" fill="#2bffa6" />
      {/* Feu arrière */}
      <rect x="9.5" y="57" width="4" height="4" rx="1.2" fill="#ff6a5c" opacity="0.85" />
      {/* Poignée + emblème feuille */}
      <rect x="52" y="52" width="16" height="1.8" rx="0.9" fill="#04140d" opacity="0.25" />
      <path d="M96 52 c 5 -1 8 -4 8 -8 c -5 0 -8 3 -8 8 Z" fill="#eafff6" opacity="0.85" />
      {/* Roues */}
      <AlloyWheel cx={38} cy={70} r={13} rimId="rimCar" />
      <AlloyWheel cx={97} cy={70} r={13} rimId="rimCar" />
    </svg>
  );
}

/* --------------------------------- Livraison : scooter électrique + top-case --------------------------------- */
export function IllusMoto({ size = 72 }: P) {
  return (
    <svg width={size} height={size * 0.74} viewBox="0 0 132 96" fill="none" aria-hidden>
      <defs>
        <linearGradient id="motoB" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#33424b" /><stop offset="100%" stopColor="#141d22" />
        </linearGradient>
        <linearGradient id="motoAccent" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#3ceaa6" /><stop offset="100%" stopColor="#0aa96b" />
        </linearGradient>
        <linearGradient id="caseG" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#ffb15e" /><stop offset="100%" stopColor="#ef5f16" />
        </linearGradient>
        <radialGradient id="rimMoto" cx="42%" cy="40%" r="60%">
          <stop offset="0%" stopColor="#f6faf8" /><stop offset="60%" stopColor="#c6d2cd" /><stop offset="100%" stopColor="#889a92" />
        </radialGradient>
        <filter id="csMoto" x="-20%" y="-20%" width="140%" height="160%"><feGaussianBlur stdDeviation="2.4" /></filter>
      </defs>
      <ellipse cx="66" cy="86" rx="52" ry="7" fill="#04140d" opacity="0.18" filter="url(#csMoto)" />
      {/* Masse arrière (carénage sur la roue arrière) */}
      <path d="M26 62 C 26 50 34 46 46 46 C 60 46 66 54 64 64 C 62 70 40 72 30 68 C 27 66 26 64 26 62 Z" fill="url(#motoB)" />
      {/* Plancher + tablier avant (une pièce continue) */}
      <path d="M52 66 L 82 62 C 84 52 92 47 101 44 L 110 42 C 114 41 115 44 112 46 L 104 49 C 98 53 96 60 98 66 L 90 66 C 88 61 82 61 78 62 L 56 66 Z" fill="url(#motoB)" />
      {/* Fourche avant */}
      <path d="M100 62 L 100 74" stroke="#1a262c" strokeWidth="4.5" strokeLinecap="round" />
      {/* Selle */}
      <path d="M30 48 C 30 43 36 42 46 42 L 62 42 C 68 42 68 48 61 48 L 36 48 C 32 48 30 48 30 48 Z" fill="#0e1519" />
      {/* Accent émeraude */}
      <path d="M32 60 L 60 58" stroke="url(#motoAccent)" strokeWidth="2.6" strokeLinecap="round" />
      {/* Guidon + poignée */}
      <path d="M104 46 L 118 41" stroke="#2a373f" strokeWidth="4" strokeLinecap="round" />
      <circle cx="118" cy="41" r="2.4" fill="#0e1519" />
      {/* Phare LED */}
      <path d="M108 50 C 113 48 116 50 116 54 L 110 55 Z" fill="#eafff6" />
      {/* Support + top-case livraison (premium, emblème feuille) */}
      <path d="M40 46 L 34 37" stroke="#2a373f" strokeWidth="3.4" strokeLinecap="round" />
      <g filter="url(#csMoto)"><rect x="15" y="28" width="30" height="23" rx="5" fill="#04140d" opacity="0.16" /></g>
      <rect x="16" y="27" width="29" height="23" rx="5" fill="url(#caseG)" />
      <rect x="16" y="27" width="29" height="8.5" rx="5" fill="#ffffff" opacity="0.16" />
      <path d="M30.5 33.5 c 4 -0.8 6.5 -3.2 6.5 -6.6 c -4 0 -6.5 2.6 -6.5 6.6 Z" fill="#fff" opacity="0.9" />
      <rect x="22" y="41" width="17" height="2.2" rx="1.1" fill="#fff" opacity="0.5" />
      {/* Roues */}
      <AlloyWheel cx={38} cy={74} r={12} rimId="rimMoto" />
      <AlloyWheel cx={100} cy={74} r={12} rimId="rimMoto" />
    </svg>
  );
}

/* --------------------------------- Food (burger gastro) --------------------------------- */
export function IllusFood({ size = 48 }: P) {
  return (
    <svg width={size} height={size} viewBox="0 0 128 128" fill="none" aria-hidden>
      <defs>
        <linearGradient id="bunT" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#f0b064" /><stop offset="100%" stopColor="#c97e34" /></linearGradient>
        <linearGradient id="bunB" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#e0a054" /><stop offset="100%" stopColor="#b26a28" /></linearGradient>
        <filter id="csF" x="-20%" y="-20%" width="140%" height="150%"><feGaussianBlur stdDeviation="2.2" /></filter>
      </defs>
      <ellipse cx="64" cy="104" rx="42" ry="7" fill="#04140d" opacity="0.16" filter="url(#csF)" />
      {/* Pain haut */}
      <path d="M26 60 C 26 42 40 33 56 33 C 72 33 86 42 86 60 Z" fill="url(#bunT)" />
      <path d="M30 50 C 40 44 72 44 82 50" stroke="#fff" strokeWidth="1.4" opacity="0.35" fill="none" />
      <circle cx="44" cy="47" r="1.7" fill="#fff2d8" /><circle cx="56" cy="43.5" r="1.7" fill="#fff2d8" /><circle cx="68" cy="47" r="1.7" fill="#fff2d8" />
      {/* Salade */}
      <path d="M24 60 q28 9 62 0 l 0 5 q -31 8 -62 0 Z" fill="#5fb84b" />
      {/* Steak */}
      <path d="M23 66 q29 8 66 0 l -1 6 q -32 8 -64 0 Z" fill="#7a4a24" />
      {/* Fromage */}
      <path d="M28 70 L 44 78 L 60 70 L 76 78 L 88 70 L 86 74 q -22 8 -56 0 Z" fill="#f6c445" />
      {/* Pain bas */}
      <path d="M26 76 h60 a4 4 0 0 1 4 4 v3 a5 5 0 0 1 -5 5 H27 a5 5 0 0 1 -5 -5 v-3 a4 4 0 0 1 4 -4 Z" fill="url(#bunB)" />
    </svg>
  );
}

/* --------------------------------- Achat & Vente (sac premium + étiquette) --------------------------------- */
export function IllusShop({ size = 48 }: P) {
  return (
    <svg width={size} height={size} viewBox="0 0 128 128" fill="none" aria-hidden>
      <defs>
        <linearGradient id="bagG" x1="0" y1="0" x2="0.3" y2="1"><stop offset="0%" stopColor="#f6cf6b" /><stop offset="100%" stopColor="#d99521" /></linearGradient>
        <filter id="csS" x="-20%" y="-20%" width="140%" height="150%"><feGaussianBlur stdDeviation="2.2" /></filter>
      </defs>
      <ellipse cx="64" cy="106" rx="40" ry="7" fill="#04140d" opacity="0.16" filter="url(#csS)" />
      {/* Anses */}
      <path d="M50 56 C 50 42 57 34 66 34 C 75 34 82 42 82 56" stroke="#c98b18" strokeWidth="5" fill="none" strokeLinecap="round" />
      {/* Sac */}
      <path d="M40 54 L 92 54 L 96 100 C 96 105 92 108 87 108 L 45 108 C 40 108 36 105 36 100 Z" fill="url(#bagG)" />
      <path d="M40 54 L 92 54 L 92 60 L 40 60 Z" fill="#ffffff" opacity="0.18" />
      <path d="M46 66 C 55 62 73 62 86 66" stroke="#ffffff" strokeWidth="1.4" opacity="0.3" fill="none" />
      {/* Étiquette émeraude */}
      <path d="M58 74 l 18 0 l 0 14 l -9 9 l -9 -9 Z" fill="#0aa96b" />
      <circle cx="67" cy="81" r="2.6" fill="#eafff6" />
    </svg>
  );
}

/* --------------------------------- Supermarché (chariot élégant) --------------------------------- */
export function IllusMarket({ size = 48 }: P) {
  return (
    <svg width={size} height={size} viewBox="0 0 128 128" fill="none" aria-hidden>
      <defs>
        <linearGradient id="cartG" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#12b47a" /><stop offset="100%" stopColor="#067a52" /></linearGradient>
        <filter id="csM" x="-20%" y="-20%" width="140%" height="150%"><feGaussianBlur stdDeviation="2.2" /></filter>
      </defs>
      <ellipse cx="66" cy="108" rx="42" ry="7" fill="#04140d" opacity="0.16" filter="url(#csM)" />
      {/* Produits */}
      <circle cx="52" cy="52" r="14" fill="#e5533f" /><circle cx="47" cy="47" r="4" fill="#fff" opacity="0.35" /><path d="M52 39 q4 -6 8 -3 q-3 4 -8 3 Z" fill="#3bbf58" />
      <rect x="68" y="32" width="12" height="30" rx="4" fill="#f0b83f" /><rect x="70" y="28" width="8" height="7" rx="2" fill="#c33a2c" /><rect x="70" y="40" width="8" height="7" rx="1" fill="#fff" opacity="0.4" />
      {/* Chariot */}
      <path d="M26 60 L 96 60 L 88 96 C 87 100 84 102 80 102 L 48 102 C 44 102 41 100 40 96 Z" fill="url(#cartG)" />
      <path d="M18 52 L 28 52 L 40 96" stroke="#067a52" strokeWidth="4.5" strokeLinecap="round" fill="none" />
      <g stroke="#eafff6" strokeWidth="2" opacity="0.35"><path d="M34 66 L 92 66" /><path d="M50 68 L 48 100" /><path d="M66 68 L 66 100" /><path d="M82 68 L 82 100" /></g>
      <circle cx="52" cy="110" r="5.5" fill="#0b1712" /><circle cx="80" cy="110" r="5.5" fill="#0b1712" />
    </svg>
  );
}

/* --------------------------------- Colis / Cargo (paquets premium) --------------------------------- */
export function IllusColis({ size = 48 }: P) {
  return (
    <svg width={size} height={size} viewBox="0 0 128 128" fill="none" aria-hidden>
      <defs>
        <linearGradient id="bxA" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#2fd3b4" /><stop offset="100%" stopColor="#0f9a7d" /></linearGradient>
        <linearGradient id="bxAtop" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#57e6ca" /><stop offset="100%" stopColor="#22b79a" /></linearGradient>
        <linearGradient id="bxB" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#ffb15e" /><stop offset="100%" stopColor="#ef5f16" /></linearGradient>
        <filter id="csC" x="-20%" y="-20%" width="140%" height="150%"><feGaussianBlur stdDeviation="2.2" /></filter>
      </defs>
      <ellipse cx="64" cy="108" rx="42" ry="7" fill="#04140d" opacity="0.16" filter="url(#csC)" />
      {/* Grand carton (3/4) */}
      <path d="M28 68 L 64 56 L 100 68 L 100 100 L 64 112 L 28 100 Z" fill="url(#bxA)" />
      <path d="M28 68 L 64 80 L 64 112 L 28 100 Z" fill="#0b7a63" opacity="0.35" />
      <path d="M64 80 L 100 68 L 100 100 L 64 112 Z" fill="#000" opacity="0.06" />
      <path d="M50 60 L 78 60 L 78 68 L 64 72.5 L 50 68 Z" fill="url(#bxAtop)" />
      {/* Ruban */}
      <path d="M64 72.5 L 64 112" stroke="#eafff6" strokeWidth="2" opacity="0.4" />
      {/* Petit carton orange */}
      <path d="M60 40 L 84 33 L 104 40 L 104 58 L 84 64 L 60 58 Z" fill="url(#bxB)" />
      <path d="M60 40 L 84 47 L 84 64 L 60 58 Z" fill="#a3350a" opacity="0.28" />
      <path d="M80 44 l 0 -7 m 0 0 l -3 3 m 3 -3 l 3 3" stroke="#fff" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
