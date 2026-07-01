/**
 * Logo ORION.
 *
 * Concept de marque : une **feuille** (mobilité verte) traversée d'une **nervure-route**,
 * accompagnée de **trois étoiles** = la ceinture d'Orion (le nom de la plateforme).
 * Mobilité verte + Orion (constellation) = identité unique et mémorable.
 *
 * - `LogoGlyph` : le pictogramme seul (hérite de `color` via currentColor).
 * - `LogoIcon`  : l'icône d'application complète (squircle + dégradé + glyphe blanc).
 */

export function LogoGlyph({ size = 64 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 512 512" fill="none" aria-label="ORION">
      {/* Feuille */}
      <path
        d="M256 92 C 338 150 372 252 318 350 C 300 382 280 404 256 424 C 232 404 212 382 194 350 C 140 252 174 150 256 92 Z"
        fill="currentColor"
      />
      {/* Nervure-route (négatif) */}
      <path
        d="M256 150 C 250 240 250 330 256 408"
        stroke="#04140d"
        strokeOpacity="0.28"
        strokeWidth="14"
        strokeLinecap="round"
        fill="none"
      />
      <path d="M256 250 L 214 214 M256 300 L 300 268" stroke="#04140d" strokeOpacity="0.28" strokeWidth="12" strokeLinecap="round" />
      {/* Ceinture d'Orion (3 étoiles) */}
      <g fill="currentColor">
        <circle cx="372" cy="120" r="15" />
        <circle cx="406" cy="150" r="12" />
        <circle cx="430" cy="186" r="9" />
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
      <LogoGlyph size={size * 0.62} />
    </div>
  );
}
