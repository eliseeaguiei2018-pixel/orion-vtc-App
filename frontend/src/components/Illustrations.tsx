/**
 * Illustrations de services ORION — SVG colorés, style « 3D doux », pour le hub multi-services.
 * Palette : vert ORION en base + accents (orange coursier, tons chauds food, etc.).
 * Chaque illustration est autonome (dégradés à id unique) et se met à l'échelle via `size`.
 */
type P = { size?: number };

function Shadow() {
  return <ellipse cx="64" cy="88" rx="42" ry="7" fill="#04140d" opacity="0.10" />;
}

/* ------------------------------- Course (voiture EV verte) ------------------------------- */
export function IllusCar({ size = 72 }: P) {
  return (
    <svg width={size} height={size * 0.78} viewBox="0 0 128 100" fill="none" aria-hidden>
      <defs>
        <linearGradient id="carBody" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#3dffb0" /><stop offset="100%" stopColor="#00a865" />
        </linearGradient>
        <linearGradient id="carRoof" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#eafff5" /><stop offset="100%" stopColor="#b9f4dc" />
        </linearGradient>
      </defs>
      <Shadow />
      {/* Corps */}
      <path d="M14 64 C 16 52 24 48 34 47 L 44 40 C 52 34 60 33 72 33 C 86 33 96 38 104 47 L 112 50 C 118 52 120 57 120 63 L 120 70 C 120 73 118 75 115 75 L 13 75 C 10 75 8 73 8 70 C 8 67 10 65 14 64 Z" fill="url(#carBody)" />
      {/* Toit / vitres */}
      <path d="M44 41 C 52 35 60 34 71 34 C 82 34 91 38 98 46 L 46 46 C 44 46 43 44 44 41 Z" fill="url(#carRoof)" />
      <path d="M50 44 L 68 44 L 66 34.6 C 60 35 55 37 50 44 Z" fill="#0e2a20" opacity="0.55" />
      <path d="M72 34.4 C 82 35 89 38.5 95 45 L 74 45 Z" fill="#0e2a20" opacity="0.55" />
      {/* Bandeau lumineux + logo */}
      <rect x="18" y="62" width="96" height="5" rx="2.5" fill="#eafff5" opacity="0.6" />
      <circle cx="108" cy="58" r="3" fill="#eafff5" />
      {/* Roues */}
      <circle cx="40" cy="76" r="12" fill="#0e2a20" /><circle cx="40" cy="76" r="5.5" fill="#c8d2dc" />
      <circle cx="92" cy="76" r="12" fill="#0e2a20" /><circle cx="92" cy="76" r="5.5" fill="#c8d2dc" />
      {/* Feuille (identité verte) */}
      <path d="M105 40 c 6 -1 10 -5 10 -10 c -6 0 -10 4 -10 10 Z" fill="#2bffa6" />
    </svg>
  );
}

/* ------------------------------- Livraison (moto + caisson) ------------------------------- */
export function IllusMoto({ size = 72 }: P) {
  return (
    <svg width={size} height={size * 0.78} viewBox="0 0 128 100" fill="none" aria-hidden>
      <defs>
        <linearGradient id="motoBox" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#ff8a3d" /><stop offset="100%" stopColor="#f0530f" />
        </linearGradient>
        <linearGradient id="motoBody" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#1f8f6b" /><stop offset="100%" stopColor="#0c5a41" />
        </linearGradient>
      </defs>
      <Shadow />
      {/* Roues */}
      <circle cx="34" cy="74" r="13" fill="#0e2a20" /><circle cx="34" cy="74" r="5.5" fill="#7fe7c4" />
      <circle cx="98" cy="74" r="13" fill="#0e2a20" /><circle cx="98" cy="74" r="5.5" fill="#7fe7c4" />
      {/* Cadre */}
      <path d="M34 74 L 60 60 L 86 60 L 98 74" stroke="url(#motoBody)" strokeWidth="7" strokeLinecap="round" strokeLinejoin="round" fill="none" />
      <path d="M60 60 L 52 74 L 34 74" stroke="url(#motoBody)" strokeWidth="7" strokeLinecap="round" strokeLinejoin="round" fill="none" />
      {/* Garde-boue avant + guidon */}
      <path d="M92 60 L 104 46 L 112 48" stroke="#0c5a41" strokeWidth="5" strokeLinecap="round" fill="none" />
      <path d="M86 62 C 96 58 104 60 108 66" stroke="#1f8f6b" strokeWidth="4" strokeLinecap="round" fill="none" />
      {/* Selle */}
      <path d="M52 58 L 74 58 C 78 58 79 62 74 62 L 54 62 Z" fill="#0e2a20" />
      {/* Caisson de livraison (orange, arrows + smiley) */}
      <rect x="16" y="40" width="30" height="26" rx="4" fill="url(#motoBox)" />
      <rect x="16" y="40" width="30" height="26" rx="4" fill="#000" opacity="0.05" />
      <path d="M27 58 l 0 -8 m 0 0 l -3 3 m 3 -3 l 3 3" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M35 58 l 0 -8 m 0 0 l -3 3 m 3 -3 l 3 3" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M24 62 c 3 3 11 3 14 0" stroke="#fff" strokeWidth="1.6" strokeLinecap="round" fill="none" />
      {/* Phare */}
      <circle cx="110" cy="52" r="3.4" fill="#eafff5" />
    </svg>
  );
}

/* ------------------------------- Food (burger + boisson) ------------------------------- */
export function IllusFood({ size = 48 }: P) {
  return (
    <svg width={size} height={size} viewBox="0 0 128 128" fill="none" aria-hidden>
      <defs>
        <linearGradient id="bun" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#ffcf8a" /><stop offset="100%" stopColor="#e79a4a" /></linearGradient>
        <linearGradient id="cup" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#ff6a5c" /><stop offset="100%" stopColor="#e23b2f" /></linearGradient>
      </defs>
      <ellipse cx="64" cy="112" rx="46" ry="8" fill="#04140d" opacity="0.10" />
      {/* Gobelet */}
      <path d="M74 60 L 104 60 L 100 104 C 99 108 96 110 92 110 L 86 110 C 82 110 79 108 78 104 Z" fill="url(#cup)" />
      <rect x="72" y="56" width="34" height="7" rx="3.5" fill="#ffd1cb" />
      <path d="M86 44 L 92 56 L 88 56 Z" fill="#c8d2dc" />
      <circle cx="89" cy="80" r="10" fill="#fff" opacity="0.85" /><path d="M84 80 a5 5 0 0 1 10 0" fill="#f0530f" />
      {/* Burger */}
      <path d="M22 62 C 22 46 34 38 48 38 C 62 38 74 46 74 62 Z" fill="url(#bun)" />
      <circle cx="38" cy="50" r="1.8" fill="#fff2d8" /><circle cx="50" cy="46" r="1.8" fill="#fff2d8" /><circle cx="60" cy="52" r="1.8" fill="#fff2d8" />
      <path d="M22 62 h52 v4 h-52 Z" fill="#7ac943" />
      <path d="M20 66 q27 10 56 0 l -1 6 q -27 8 -54 0 Z" fill="#b5651d" />
      <path d="M22 74 h50 a4 4 0 0 1 4 4 v2 a4 4 0 0 1 -4 4 H22 a4 4 0 0 1 -4 -4 v-2 a4 4 0 0 1 4 -4 Z" fill="url(#bun)" />
    </svg>
  );
}

/* ------------------------------- Achat & Vente (sac + article) ------------------------------- */
export function IllusShop({ size = 48 }: P) {
  return (
    <svg width={size} height={size} viewBox="0 0 128 128" fill="none" aria-hidden>
      <defs>
        <linearGradient id="bag" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#ffd23f" /><stop offset="100%" stopColor="#f5a623" /></linearGradient>
      </defs>
      <ellipse cx="64" cy="112" rx="44" ry="8" fill="#04140d" opacity="0.10" />
      {/* Sac */}
      <path d="M40 52 L 96 52 L 100 104 C 100 108 97 110 93 110 L 43 110 C 39 110 36 108 36 104 Z" fill="url(#bag)" />
      <path d="M52 52 C 52 40 60 34 68 34 C 76 34 84 40 84 52" stroke="#e08e12" strokeWidth="5" fill="none" />
      <rect x="40" y="52" width="56" height="8" fill="#000" opacity="0.06" />
      {/* Étiquette verte */}
      <path d="M62 70 l 16 0 l 0 12 l -8 8 l -8 -8 Z" fill="#00a865" /><circle cx="70" cy="76" r="2.4" fill="#eafff5" />
      {/* Basket rouge */}
      <path d="M20 96 C 24 86 34 84 44 88 C 50 90 52 94 50 98 L 22 102 C 19 102 18 99 20 96 Z" fill="#ff5a4d" />
      <path d="M22 100 l 30 -3 l 1 4 l -30 3 Z" fill="#fff" opacity="0.85" />
      <circle cx="26" cy="103" r="3" fill="#0e2a20" /><circle cx="46" cy="101" r="3" fill="#0e2a20" />
    </svg>
  );
}

/* ------------------------------- Supermarché (panier + produits) ------------------------------- */
export function IllusMarket({ size = 48 }: P) {
  return (
    <svg width={size} height={size} viewBox="0 0 128 128" fill="none" aria-hidden>
      <ellipse cx="64" cy="112" rx="44" ry="8" fill="#04140d" opacity="0.10" />
      {/* Produits */}
      <circle cx="50" cy="56" r="15" fill="#ff5a4d" /><path d="M50 42 q4 -6 8 -3 q-3 3 -8 3 Z" fill="#3bbf58" />
      <rect x="66" y="34" width="12" height="30" rx="4" fill="#ffd23f" /><rect x="68" y="30" width="8" height="8" rx="2" fill="#e23b2f" />
      <rect x="30" y="46" width="16" height="16" rx="3" fill="#ffcf3f" transform="rotate(-8 38 54)" />
      {/* Panier */}
      <path d="M30 64 L 96 64 L 88 98 C 87 102 84 104 80 104 L 46 104 C 42 104 39 102 38 98 Z" fill="#00a865" />
      <path d="M30 64 L 96 64" stroke="#0c5a41" strokeWidth="4" />
      <g stroke="#0c5a41" strokeWidth="3" opacity="0.5"><path d="M46 68 L 50 100" /><path d="M63 68 L 63 100" /><path d="M80 68 L 76 100" /></g>
      <circle cx="50" cy="112" r="5" fill="#0e2a20" /><circle cx="78" cy="112" r="5" fill="#0e2a20" />
    </svg>
  );
}

/* ------------------------------- Colis / Cargo (paquets) ------------------------------- */
export function IllusColis({ size = 48 }: P) {
  return (
    <svg width={size} height={size} viewBox="0 0 128 128" fill="none" aria-hidden>
      <defs>
        <linearGradient id="box1" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#38e0c0" /><stop offset="100%" stopColor="#12a586" /></linearGradient>
        <linearGradient id="box2" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#ff8a3d" /><stop offset="100%" stopColor="#f0530f" /></linearGradient>
      </defs>
      <ellipse cx="64" cy="112" rx="44" ry="8" fill="#04140d" opacity="0.10" />
      {/* Grand carton */}
      <path d="M28 66 L 64 54 L 100 66 L 100 100 L 64 112 L 28 100 Z" fill="url(#box1)" />
      <path d="M28 66 L 64 78 L 100 66" stroke="#0c5a41" strokeWidth="2.5" fill="none" opacity="0.4" />
      <path d="M64 78 L 64 112" stroke="#0c5a41" strokeWidth="2.5" opacity="0.4" />
      <path d="M52 58 L 76 58 L 76 66 L 64 70 L 52 66 Z" fill="#eafff5" opacity="0.7" />
      {/* Petit carton orange */}
      <path d="M60 40 L 84 33 L 104 40 L 104 58 L 84 64 L 60 58 Z" fill="url(#box2)" />
      <path d="M60 40 L 84 47 L 104 40" stroke="#a3350a" strokeWidth="2" fill="none" opacity="0.4" />
      <path d="M84 47 L 84 64" stroke="#a3350a" strokeWidth="2" opacity="0.4" />
      <path d="M80 44 l 0 -7 m 0 0 l -3 3 m 3 -3 l 3 3" stroke="#fff" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
