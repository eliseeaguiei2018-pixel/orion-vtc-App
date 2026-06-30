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

export function LogoWordmark({ size = 40, color = 'currentColor' }: { size?: number; color?: string }) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: size * 0.18, color }}>
      <LogoGlyph size={size * 1.15} />
      <span
        style={{
          fontWeight: 800,
          fontSize: size,
          letterSpacing: size * 0.06,
          lineHeight: 1,
          fontFamily: 'inherit',
        }}
      >
        RION
      </span>
    </span>
  );
}
