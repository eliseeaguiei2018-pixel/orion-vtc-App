/**
 * Illustrations des petits services ORION (food, achat, supermarché, colis).
 * Les véhicules (voitures, scooter) sont dans Vehicules.tsx.
 * Dégradés multi-arrêts, reflets spéculaires, jantes alliage, ombres douces (flou).
 * Palette ORION (émeraude/graphite) + accents raffinés. Style cohérent, élégant.
 */
type P = { size?: number };

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
