/**
 * Icônes du volet LIVRAISON : un seul dessin, au trait de 1,6 px, angles arrondis, et une
 * face pleine en transparence (la couleur du trait à 16 %) qui leur donne du volume sans
 * les alourdir. Grille de 24 px ; la couleur vient du texte (currentColor).
 */
import type { ReactNode } from 'react';

type P = { size?: number; className?: string };
function Ico({ size = 22, className, children }: P & { children: ReactNode }) {
  return (
    <svg className={className} width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      {children}
    </svg>
  );
}
const face = { fill: 'currentColor', fillOpacity: 0.16, stroke: 'none' } as const;

export const IcoColis = (p: P) => (
  <Ico {...p}>
    <path d="M3.5 7.6 12 3.5l8.5 4.1v8.8L12 20.5l-8.5-4.1Z" {...face} />
    <path d="M3.5 7.6 12 3.5l8.5 4.1v8.8L12 20.5l-8.5-4.1Z" />
    <path d="M3.5 7.6 12 11.7l8.5-4.1M12 11.7v8.8" />
    <path d="m7.8 5.5 8.5 4.1v3" />
  </Ico>
);
export const IcoArrivee = (p: P) => (
  <Ico {...p}>
    <path d="M5.5 3.5v17" />
    <path d="M5.5 4.5h12.2l-2.4 3.7 2.4 3.8H5.5" {...face} />
    <path d="M5.5 4.5h12.2l-2.4 3.7 2.4 3.8H5.5" />
    <path d="M9.5 4.5v7.5M13.5 4.5v7.5" strokeOpacity={0.45} />
  </Ico>
);
export const IcoHorloge = (p: P) => (
  <Ico {...p}>
    <circle cx="12" cy="12.5" r="8" {...face} />
    <circle cx="12" cy="12.5" r="8" />
    <path d="M12 8.2v4.5l2.8 1.8M9.5 2.8h5" />
  </Ico>
);
export const IcoEclair = (p: P) => (
  <Ico {...p}>
    <path d="M13.4 2.8 5.6 13.4h5.6l-1 7.8 8.2-10.8h-5.7Z" {...face} />
    <path d="M13.4 2.8 5.6 13.4h5.6l-1 7.8 8.2-10.8h-5.7Z" />
  </Ico>
);
export const IcoFlocon = (p: P) => (
  <Ico {...p}>
    <path d="M12 2.8v18.4M4 7.4l16 9.2M4 16.6l16-9.2" />
    <path d="m9.6 4.3 2.4 2.1 2.4-2.1M9.6 19.7l2.4-2.1 2.4 2.1M4.6 10.3l3.1.8-.9 3M19.4 13.7l-3.1-.8.9-3M4.6 13.7l3.1-.8-.9-3M19.4 10.3l-3.1.8.9 3" />
  </Ico>
);
export const IcoFragile = (p: P) => (
  <Ico {...p}>
    <path d="M7 3.5h10l-.6 5.2a4.4 4.4 0 0 1-8.8 0Z" {...face} />
    <path d="M7 3.5h10l-.6 5.2a4.4 4.4 0 0 1-8.8 0Z" />
    <path d="M12 13v7.5M8.5 20.5h7M11.4 3.5l1.2 2.3-1.4 1.6" />
  </Ico>
);
export const IcoPersonne = (p: P) => (
  <Ico {...p}>
    <circle cx="12" cy="8" r="3.8" {...face} />
    <circle cx="12" cy="8" r="3.8" />
    <path d="M4.5 20.5c.9-3.8 3.9-5.8 7.5-5.8s6.6 2 7.5 5.8" />
  </Ico>
);
export const IcoTelephone = (p: P) => (
  <Ico {...p}>
    <path d="M6.2 3.5h3l1.5 4.2-2 1.4a10.6 10.6 0 0 0 6.2 6.2l1.4-2 4.2 1.5v3A2.7 2.7 0 0 1 17.8 20.5 14.6 14.6 0 0 1 3.5 6.2a2.7 2.7 0 0 1 2.7-2.7Z" {...face} />
    <path d="M6.2 3.5h3l1.5 4.2-2 1.4a10.6 10.6 0 0 0 6.2 6.2l1.4-2 4.2 1.5v3A2.7 2.7 0 0 1 17.8 20.5 14.6 14.6 0 0 1 3.5 6.2a2.7 2.7 0 0 1 2.7-2.7Z" />
  </Ico>
);
export const IcoRepere = (p: P) => (
  <Ico {...p}>
    <path d="M12 21s-6.5-6-6.5-11a6.5 6.5 0 0 1 13 0c0 5-6.5 11-6.5 11Z" {...face} />
    <path d="M12 21s-6.5-6-6.5-11a6.5 6.5 0 0 1 13 0c0 5-6.5 11-6.5 11Z" />
    <path d="m12 6.6.9 1.9 2 .3-1.4 1.4.3 2-1.8-1-1.8 1 .3-2-1.4-1.4 2-.3Z" />
  </Ico>
);
export const IcoImmeuble = (p: P) => (
  <Ico {...p}>
    <path d="M4.5 20.5v-14l7.5-3 7.5 3v14" {...face} />
    <path d="M4.5 20.5v-14l7.5-3 7.5 3v14M3 20.5h18" />
    <path d="M8.5 9h1.5M14 9h1.5M8.5 12.5h1.5M14 12.5h1.5M10.5 20.5v-4h3v4" />
  </Ico>
);
export const IcoEscalier = (p: P) => (
  <Ico {...p}>
    <path d="M3.5 20.5h17v-17h-4.2v4.2h-4.2v4.3H7.8v4.2H3.5Z" {...face} />
    <path d="M3.5 20.5h17v-17h-4.2v4.2h-4.2v4.3H7.8v4.2H3.5Z" />
  </Ico>
);
export const IcoPorte = (p: P) => (
  <Ico {...p}>
    <path d="M6 20.5v-16a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v16" {...face} />
    <path d="M6 20.5v-16a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v16M3.5 20.5h17" />
    <circle cx="14.6" cy="12.4" r=".9" fill="currentColor" stroke="none" />
  </Ico>
);
export const IcoMessage = (p: P) => (
  <Ico {...p}>
    <path d="M4 5.5h16a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1h-9l-4.5 3.5v-3.5H4a1 1 0 0 1-1-1v-10a1 1 0 0 1 1-1Z" {...face} />
    <path d="M4 5.5h16a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1h-9l-4.5 3.5v-3.5H4a1 1 0 0 1-1-1v-10a1 1 0 0 1 1-1Z" />
    <path d="M7.5 10h9M7.5 13h5.5" />
  </Ico>
);
export const IcoChevron = (p: P) => (<Ico {...p}><path d="m9.5 5.5 6.5 6.5-6.5 6.5" /></Ico>);
export const IcoRetour = (p: P) => (<Ico {...p}><path d="M19.5 12h-15M10.5 5.5 4 12l6.5 6.5" /></Ico>);
export const IcoBillet = (p: P) => (
  <Ico {...p}>
    <rect x="2.5" y="6" width="19" height="12" rx="2" {...face} />
    <rect x="2.5" y="6" width="19" height="12" rx="2" />
    <circle cx="12" cy="12" r="2.6" />
    <path d="M6 9.5v5M18 9.5v5" />
  </Ico>
);
export const IcoPortefeuille = (p: P) => (
  <Ico {...p}>
    <path d="M4 6.5h14.5a1.5 1.5 0 0 1 1.5 1.5v10a1.5 1.5 0 0 1-1.5 1.5H5.5A1.5 1.5 0 0 1 4 18Z" {...face} />
    <path d="M4 6.5h14.5a1.5 1.5 0 0 1 1.5 1.5v10a1.5 1.5 0 0 1-1.5 1.5H5.5A1.5 1.5 0 0 1 4 18V6.5a2 2 0 0 1 2-2h10" />
    <path d="M15.5 12.8h4.5v-3h-4.5a1.5 1.5 0 0 0 0 3Z" />
  </Ico>
);
export const IcoBouclier = (p: P) => (
  <Ico {...p}>
    <path d="M12 3 5 5.7v5.8c0 4.4 3 7.6 7 9.5 4-1.9 7-5.1 7-9.5V5.7Z" {...face} />
    <path d="M12 3 5 5.7v5.8c0 4.4 3 7.6 7 9.5 4-1.9 7-5.1 7-9.5V5.7Z" />
    <path d="m8.8 12 2.2 2.2 4.3-4.4" />
  </Ico>
);
export const IcoNote = (p: P) => (
  <Ico {...p}>
    <path d="M5.5 3.5h9l4 4v13h-13Z" {...face} />
    <path d="M5.5 3.5h9l4 4v13h-13ZM14.5 3.5v4h4M8.5 12h7M8.5 15.5h5" />
  </Ico>
);
/* Contenu du colis */
export const IcoDocuments = (p: P) => (
  <Ico {...p}>
    <path d="M7 6.5h9l3 3v11H7Z" {...face} />
    <path d="M7 6.5h9l3 3v11H7ZM5 17.5v-14h9M10 13h6M10 16h4" />
  </Ico>
);
export const IcoRepas = (p: P) => (
  <Ico {...p}>
    <path d="M3.5 12.5h17a8.5 8.5 0 0 1-17 0Z" {...face} />
    <path d="M3.5 12.5h17a8.5 8.5 0 0 1-17 0ZM9 3.5c-.8 1 .8 2 0 3M12.5 3.5c-.8 1 .8 2 0 3M16 3.5c-.8 1 .8 2 0 3" />
  </Ico>
);
export const IcoVetement = (p: P) => (
  <Ico {...p}>
    <path d="m8.5 3.5-5 3 2 4 2-1v11h9v-11l2 1 2-4-5-3a3.5 3.5 0 0 1-7 0Z" {...face} />
    <path d="m8.5 3.5-5 3 2 4 2-1v11h9v-11l2 1 2-4-5-3a3.5 3.5 0 0 1-7 0Z" />
  </Ico>
);
export const IcoTech = (p: P) => (
  <Ico {...p}>
    <rect x="6.5" y="2.5" width="11" height="19" rx="2.5" {...face} />
    <rect x="6.5" y="2.5" width="11" height="19" rx="2.5" />
    <path d="M10.5 18.5h3" />
  </Ico>
);
export const IcoCourses = (p: P) => (
  <Ico {...p}>
    <path d="M5 8.5h14l-1.2 12H6.2Z" {...face} />
    <path d="M5 8.5h14l-1.2 12H6.2ZM9 8.5V7a3 3 0 0 1 6 0v1.5" />
  </Ico>
);
export const IcoAutre = (p: P) => (
  <Ico {...p}>
    <circle cx="12" cy="12" r="8.5" {...face} />
    <circle cx="12" cy="12" r="8.5" />
    <path d="M8 12h.01M12 12h.01M16 12h.01" strokeWidth={2.4} />
  </Ico>
);
