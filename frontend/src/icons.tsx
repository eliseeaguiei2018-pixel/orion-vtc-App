/** Jeu d'icônes SVG inline (zéro dépendance, trait cohérent). */
type P = { size?: number; color?: string; strokeWidth?: number };
const base = (size = 24, sw = 1.8) => ({
  width: size,
  height: size,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: sw,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
});

export const IconPin = ({ size, strokeWidth }: P) => (
  <svg {...base(size, strokeWidth)}><path d="M12 21s7-5.5 7-11a7 7 0 1 0-14 0c0 5.5 7 11 7 11Z" /><circle cx="12" cy="10" r="2.5" /></svg>
);
export const IconSearch = ({ size, strokeWidth }: P) => (
  <svg {...base(size, strokeWidth)}><circle cx="11" cy="11" r="7" /><path d="m21 21-4.3-4.3" /></svg>
);
export const IconClock = ({ size, strokeWidth }: P) => (
  <svg {...base(size, strokeWidth)}><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></svg>
);
export const IconStar = ({ size = 24, color = 'currentColor' }: P) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill={color} stroke={color} strokeWidth={1.2} strokeLinejoin="round">
    <path d="m12 2 2.9 6.3 6.9.7-5.1 4.7 1.4 6.8L12 18l-6 3.5 1.4-6.8L2.3 9l6.9-.7L12 2Z" />
  </svg>
);
export const IconHome = ({ size, strokeWidth }: P) => (
  <svg {...base(size, strokeWidth)}><path d="M4 11.5 12 4l8 7.5" /><path d="M6 10v9h12v-9" /></svg>
);
export const IconBriefcase = ({ size, strokeWidth }: P) => (
  <svg {...base(size, strokeWidth)}><rect x="3" y="7" width="18" height="13" rx="2.5" /><path d="M8 7V5.5A1.5 1.5 0 0 1 9.5 4h5A1.5 1.5 0 0 1 16 5.5V7" /></svg>
);
export const IconPlane = ({ size, strokeWidth }: P) => (
  <svg {...base(size, strokeWidth)}><path d="M10.5 13.5 3 11l1-2 7 1 4-5.5a1.6 1.6 0 0 1 2.6 1.8L14 12l1 7-2 1-2.5-6.5Z" /></svg>
);
export const IconShield = ({ size, strokeWidth }: P) => (
  <svg {...base(size, strokeWidth)}><path d="M12 3 5 6v5c0 4.5 3 7.5 7 9 4-1.5 7-4.5 7-9V6l-7-3Z" /><path d="m9 12 2 2 4-4" /></svg>
);
export const IconBolt = ({ size, strokeWidth }: P) => (
  <svg {...base(size, strokeWidth)}><path d="M13 2 4 14h6l-1 8 9-12h-6l1-8Z" /></svg>
);
export const IconChevron = ({ size, strokeWidth }: P) => (
  <svg {...base(size, strokeWidth)}><path d="m9 6 6 6-6 6" /></svg>
);
export const IconArrowLeft = ({ size, strokeWidth }: P) => (
  <svg {...base(size, strokeWidth)}><path d="M19 12H5" /><path d="m12 19-7-7 7-7" /></svg>
);
export const IconPhone = ({ size, strokeWidth }: P) => (
  <svg {...base(size, strokeWidth)}><path d="M5 4h3l2 5-2 1a11 11 0 0 0 5 5l1-2 5 2v3a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2Z" /></svg>
);
export const IconShare = ({ size, strokeWidth }: P) => (
  <svg {...base(size, strokeWidth)}><circle cx="18" cy="5" r="2.5" /><circle cx="6" cy="12" r="2.5" /><circle cx="18" cy="19" r="2.5" /><path d="m8 11 8-5M8 13l8 5" /></svg>
);
export const IconUsers = ({ size, strokeWidth }: P) => (
  <svg {...base(size, strokeWidth)}><circle cx="9" cy="8" r="3" /><path d="M3 20a6 6 0 0 1 12 0" /><path d="M16 5.5a3 3 0 0 1 0 5.8M21 20a6 6 0 0 0-4-5.7" /></svg>
);
export const IconLeaf = ({ size, strokeWidth }: P) => (
  <svg {...base(size, strokeWidth)}><path d="M5 19c0-8 6-13 14-13 0 8-5 14-13 14" /><path d="M5 19c3-4 6-6 9-7" /></svg>
);
export const IconCar = ({ size = 24, strokeWidth = 1.8 }: P) => (
  <svg {...base(size, strokeWidth)}><path d="M5 16v2M19 16v2M4 13l1.5-4.5A2 2 0 0 1 7.4 7h9.2a2 2 0 0 1 1.9 1.5L20 13" /><rect x="3" y="13" width="18" height="4" rx="1.5" /><circle cx="7.5" cy="16.5" r="1" /><circle cx="16.5" cy="16.5" r="1" /></svg>
);
export const IconCheck = ({ size, strokeWidth }: P) => (
  <svg {...base(size, strokeWidth)}><path d="m5 12 5 5L20 6" /></svg>
);
export const IconWallet = ({ size, strokeWidth }: P) => (
  <svg {...base(size, strokeWidth)}><rect x="3" y="6" width="18" height="13" rx="3" /><path d="M3 10h18M16 14h2" /></svg>
);
export const IconSettings = ({ size, strokeWidth }: P) => (
  <svg {...base(size, strokeWidth)}><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.6 1.6 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.6 1.6 0 0 0-2.7 1.1V21a2 2 0 1 1-4 0v-.1A1.6 1.6 0 0 0 7 19.4a1.6 1.6 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1A1.6 1.6 0 0 0 2.6 14H2.5a2 2 0 1 1 0-4h.1A1.6 1.6 0 0 0 4 7.4l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1A1.6 1.6 0 0 0 10 4.6V4.5a2 2 0 1 1 4 0v.1a1.6 1.6 0 0 0 2.7 1.1l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.6 1.6 0 0 0 .8 2.7h.1a2 2 0 1 1 0 4h-.1a1.6 1.6 0 0 0-1.7.9Z" /></svg>
);
export const IconGlobe = ({ size, strokeWidth }: P) => (
  <svg {...base(size, strokeWidth)}><circle cx="12" cy="12" r="9" /><path d="M3 12h18M12 3c2.5 2.5 2.5 15 0 18M12 3c-2.5 2.5-2.5 15 0 18" /></svg>
);
export const IconCrown = ({ size, strokeWidth }: P) => (
  <svg {...base(size, strokeWidth)}><path d="M3 7l4 4 5-6 5 6 4-4-2 12H5L3 7Z" /></svg>
);
export const IconRing = ({ size, strokeWidth }: P) => (
  <svg {...base(size, strokeWidth)}><path d="M12 8 9.5 4h5L12 8Z" /><circle cx="12" cy="15" r="6" /></svg>
);
export const IconCalendar = ({ size, strokeWidth }: P) => (
  <svg {...base(size, strokeWidth)}><rect x="3" y="5" width="18" height="16" rx="2.5" /><path d="M3 9h18M8 3v4M16 3v4" /></svg>
);
export const IconMenu = ({ size, strokeWidth }: P) => (
  <svg {...base(size, strokeWidth)}><path d="M4 7h16M4 12h16M4 17h16" /></svg>
);
export const IconPlus = ({ size, strokeWidth }: P) => (
  <svg {...base(size, strokeWidth)}><path d="M12 5v14M5 12h14" /></svg>
);
export const IconMinus = ({ size, strokeWidth }: P) => (
  <svg {...base(size, strokeWidth)}><path d="M5 12h14" /></svg>
);
export const IconGem = ({ size, strokeWidth }: P) => (
  <svg {...base(size, strokeWidth)}><path d="M6 3h12l3 6-9 12L3 9l3-6Z" /><path d="M3 9h18M9 3 7.5 9 12 21 16.5 9 15 3" /></svg>
);
