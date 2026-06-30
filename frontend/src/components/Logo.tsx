/**
 * Logo ORION.
 *
 * Concept de marque : le **« O » d'ORION** dessiné comme un anneau (orbite / route qui
 * tourne) ouvert vers le ciel, accompagné des **trois étoiles de la ceinture d'Orion**
 * (le nom de la plateforme). Le vert = mobilité électrique & verte ; l'anneau ouvert vers
 * les étoiles = mouvement, voyage, guidage. Identité unique, premium et mémorable.
 *
 * - `LogoGlyph` : le pictogramme seul (anneau + étoiles), hérite de `color` via currentColor.
 * - `LogoIcon`  : l'icône d'application complète (squircle + dégradé vert + glyphe blanc).
 * - `LogoWordmark` : le logotype « ORION » dont le O est remplacé par le glyphe.
 */

/** Étoile à 4 branches (concave), lisse — centrée sur (cx,cy), rayon R. */
function starPath(cx: number, cy: number, R: number) {
  return (
    `M${cx} ${cy - R} Q${cx} ${cy} ${cx + R} ${cy}` +
    ` Q${cx} ${cy} ${cx} ${cy + R} Q${cx} ${cy} ${cx - R} ${cy}` +
    ` Q${cx} ${cy} ${cx} ${cy - R} Z`
  );
}

// Anneau « O » : cercle ouvert (un creux orienté vers les étoiles).
const RING = { cx: 196, cy: 262, r: 112, w: 52 };
const CIRC = 2 * Math.PI * RING.r; // 703.7
const GAP = 74; // longueur de l'ouverture
const DASH = `${CIRC - GAP} ${GAP}`;

export function LogoGlyph({ size = 64 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 512 512" fill="none" aria-label="ORION">
      {/* Le « O » : anneau ouvert vers les étoiles */}
      <circle
        cx={RING.cx}
        cy={RING.cy}
        r={RING.r}
        fill="none"
        stroke="currentColor"
        strokeWidth={RING.w}
        strokeLinecap="round"
        strokeDasharray={DASH}
        transform={`rotate(-18 ${RING.cx} ${RING.cy})`}
      />
      {/* Point de départ (repère sur la route) à la base de l'ouverture */}
      <circle cx={262} cy={170} r={14} fill="currentColor" />
      {/* Ceinture d'Orion — 3 étoiles alignées vers l'ouverture */}
      <g fill="currentColor">
        <path d={starPath(356, 150, 44)} />
        <path d={starPath(408, 196, 30)} />
        <path d={starPath(450, 238, 20)} />
      </g>
    </svg>
  );
}

export function LogoIcon({ size = 96, radius = 0.24 }: { size?: number; radius?: number }) {
  const r = size * radius;
  return (
    <div
      style={{
        width: size,
        height: size,
        borderRadius: r,
        display: 'grid',
        placeItems: 'center',
        background: 'linear-gradient(140deg, var(--green-bright), var(--green-deep))',
        boxShadow: 'var(--glow)',
        color: '#ffffff',
      }}
    >
      <LogoGlyph size={size * 0.66} />
    </div>
  );
}

/**
 * Logotype complet « ORION » : le premier O est l'anneau-glyphe, les 3 étoiles de la
 * ceinture d'Orion forment une traînée au-dessus du mot, puis « RION ». Tout-en-un (SVG),
 * hérite de `color` via currentColor → blanc sur fond sombre, vert/encre sur fond clair.
 * `size` = hauteur en px.
 */
export function LogoWordmark({ size = 40, color = 'currentColor' }: { size?: number; color?: string }) {
  const VB_W = 372;
  const VB_H = 132;
  // « O » dessiné comme l'anneau ouvert
  const O = { cx: 52, cy: 82, r: 34, w: 15 };
  const circ = 2 * Math.PI * O.r;
  const dash = `${(circ - 24).toFixed(1)} 24`;
  return (
    <svg
      height={size}
      width={(size * VB_W) / VB_H}
      viewBox={`0 0 ${VB_W} ${VB_H}`}
      fill="none"
      style={{ color }}
      role="img"
      aria-label="ORION"
    >
      {/* Étoiles (ceinture d'Orion) en traînée au-dessus du mot */}
      <g fill="currentColor">
        <path d={starPath(96, 26, 12)} />
        <path d={starPath(120, 16, 7.5)} />
        <path d={starPath(138, 9, 5)} />
      </g>
      {/* Le O */}
      <circle
        cx={O.cx}
        cy={O.cy}
        r={O.r}
        stroke="currentColor"
        strokeWidth={O.w}
        strokeLinecap="round"
        strokeDasharray={dash}
        transform={`rotate(-18 ${O.cx} ${O.cy})`}
      />
      <circle cx={79.8} cy={62.5} r={4.5} fill="currentColor" />
      {/* RION */}
      <text
        x={100}
        y={118}
        fill="currentColor"
        fontFamily="'Sora', system-ui, sans-serif"
        fontWeight={800}
        fontSize={104}
        letterSpacing={1}
      >
        RION
      </text>
    </svg>
  );
}
