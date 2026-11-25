import type { ReactNode } from 'react';

/**
 * DRAPEAUX EN COULEUR — langues de l'application et pays desservis.
 *
 * Dessinés en vectoriel, aux couleurs officielles : ils s'affichent à l'identique sur tous
 * les téléphones (les drapeaux « emoji » dépendent du système, et manquent sur certains).
 * Chaque drapeau tient dans un cadre 30 × 20, coins arrondis, liseré discret pour que le
 * blanc ne se perde pas sur un fond clair.
 */

/** Étoile à cinq branches, pointe en haut. */
const etoile = (cx: number, cy: number, r: number): string =>
  Array.from({ length: 10 }, (_, k) => {
    const rayon = k % 2 === 0 ? r : r * 0.382;
    const a = (k * Math.PI) / 5;
    return `${(cx + rayon * Math.sin(a)).toFixed(2)},${(cy - rayon * Math.cos(a)).toFixed(2)}`;
  }).join(' ');

/** Trois bandes verticales égales. */
const verticales = (a: string, b: string, c: string): ReactNode => (
  <><rect width="10" height="20" fill={a} /><rect x="10" width="10" height="20" fill={b} /><rect x="20" width="10" height="20" fill={c} /></>
);
/** Trois bandes horizontales égales. */
const horizontales = (a: string, b: string, c: string): ReactNode => (
  <><rect width="30" height="6.67" fill={a} /><rect y="6.67" width="30" height="6.67" fill={b} /><rect y="13.33" width="30" height="6.67" fill={c} /></>
);

const DESSINS: Record<string, ReactNode> = {
  /* ---- Langues ---- */
  fr: verticales('#0055A4', '#FFFFFF', '#EF4135'),
  en: (
    // Royaume-Uni
    <>
      <rect width="30" height="20" fill="#012169" />
      <path d="M0,0 L30,20 M30,0 L0,20" stroke="#FFFFFF" strokeWidth="4" />
      <path d="M0,0 L30,20 M30,0 L0,20" stroke="#C8102E" strokeWidth="1.4" />
      <path d="M15,0 V20 M0,10 H30" stroke="#FFFFFF" strokeWidth="6.6" />
      <path d="M15,0 V20 M0,10 H30" stroke="#C8102E" strokeWidth="4" />
    </>
  ),
  es: <><rect width="30" height="20" fill="#AA151B" /><rect y="5" width="30" height="10" fill="#F1BF00" /></>,
  it: verticales('#009246', '#FFFFFF', '#CE2B37'),
  de: horizontales('#000000', '#DD0000', '#FFCE00'),
  ar: (
    // Émirats arabes unis
    <>
      {horizontales('#00732F', '#FFFFFF', '#000000')}
      <rect width="7.5" height="20" fill="#FF0000" />
    </>
  ),
  zh: (
    <>
      <rect width="30" height="20" fill="#EE1C25" />
      <polygon points={etoile(5, 5, 3)} fill="#FFFF00" />
      {[[10, 2], [12, 4], [12, 7], [10, 9]].map(([x, y]) => <polygon key={`${x}-${y}`} points={etoile(x!, y!, 1)} fill="#FFFF00" />)}
    </>
  ),
  ru: horizontales('#FFFFFF', '#0039A6', '#D52B1E'),

  /* ---- Pays ---- */
  CI: verticales('#FF8200', '#FFFFFF', '#009A44'),
  GH: <>{horizontales('#CE1126', '#FCD116', '#006B3F')}<polygon points={etoile(15, 10, 3.2)} fill="#000000" /></>,
  SN: <>{verticales('#00853F', '#FDEF42', '#E31B23')}<polygon points={etoile(15, 10, 3)} fill="#00853F" /></>,
  TG: (
    <>
      {[0, 1, 2, 3, 4].map((k) => <rect key={k} y={k * 4} width="30" height="4" fill={k % 2 === 0 ? '#006A4E' : '#FFCE00'} />)}
      <rect width="12" height="12" fill="#D21034" />
      <polygon points={etoile(6, 6, 3.6)} fill="#FFFFFF" />
    </>
  ),
  BJ: <><rect width="30" height="10" fill="#FCD116" /><rect y="10" width="30" height="10" fill="#E8112D" /><rect width="12" height="20" fill="#008751" /></>,
  NG: verticales('#008751', '#FFFFFF', '#008751'),
};

/** Drapeau d'une langue (`fr`, `en`…) ou d'un pays (`CI`, `GH`…). `taille` = hauteur en pixels. */
export function Drapeau({ code, taille = 20 }: { code: string; taille?: number }) {
  const dessin = DESSINS[code] ?? DESSINS[code.toLowerCase()] ?? DESSINS[code.toUpperCase()];
  if (!dessin) return <span className="code-langue">{code.toUpperCase()}</span>;
  return (
    <svg className="drapeau" width={taille * 1.5} height={taille} viewBox="0 0 30 20" aria-hidden="true" focusable="false">
      {dessin}
    </svg>
  );
}
