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
export const IconBell = ({ size, strokeWidth }: P) => (
  <svg {...base(size, strokeWidth)}><path d="M18 8a6 6 0 1 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" /><path d="M13.7 21a2 2 0 0 1-3.4 0" /></svg>
);
export const IconMic = ({ size, strokeWidth }: P) => (
  <svg {...base(size, strokeWidth)}><rect x="9" y="3" width="6" height="11" rx="3" /><path d="M5 11a7 7 0 0 0 14 0M12 18v3" /></svg>
);
export const IconCamera = ({ size, strokeWidth }: P) => (
  <svg {...base(size, strokeWidth)}><path d="M3 8a2 2 0 0 1 2-2h2l1.5-2h7L19 6h0a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z" /><circle cx="12" cy="13" r="3.5" /></svg>
);
export const IconImage = ({ size, strokeWidth }: P) => (
  <svg {...base(size, strokeWidth)}><rect x="3" y="4" width="18" height="16" rx="2.5" /><circle cx="9" cy="10" r="2" /><path d="m4 18 5-5 4 4 3-3 4 4" /></svg>
);
export const IconTraffic = ({ size, strokeWidth }: P) => (
  <svg {...base(size, strokeWidth)}><rect x="8" y="2" width="8" height="20" rx="3" /><circle cx="12" cy="7" r="1.4" /><circle cx="12" cy="12" r="1.4" /><circle cx="12" cy="17" r="1.4" /></svg>
);
export const IconPhoneOff = ({ size, strokeWidth }: P) => (
  <svg {...base(size, strokeWidth)}><path d="M5 4h3l2 5-2 1a11 11 0 0 0 5 5l1-2 5 2v3a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2Z" /><path d="m2 2 20 20" /></svg>
);
export const IconVolume = ({ size, strokeWidth }: P) => (
  <svg {...base(size, strokeWidth)}><path d="M4 9v6h4l5 4V5L8 9H4Z" /><path d="M16 8a5 5 0 0 1 0 8" /></svg>
);
export const IconShieldCheck = ({ size, strokeWidth }: P) => (
  <svg {...base(size, strokeWidth)}><path d="M12 3 5 6v5c0 4.5 3 7.5 7 9 4-1.5 7-4.5 7-9V6l-7-3Z" /><path d="m9 12 2 2 4-4" /></svg>
);
export const IconFingerprint = ({ size, strokeWidth }: P) => (
  <svg {...base(size, strokeWidth)}><path d="M12 11v3a8 8 0 0 1-1.5 4.5" /><path d="M8 11a4 4 0 0 1 8 0v2a12 12 0 0 1-.7 4" /><path d="M5.5 13.5V11a6.5 6.5 0 0 1 11-4.7" /><path d="M12 11v3.5a16 16 0 0 0 .6 4.5" /></svg>
);
export const IconLock = ({ size, strokeWidth }: P) => (
  <svg {...base(size, strokeWidth)}><rect x="4.5" y="10" width="15" height="11" rx="2.5" /><path d="M8 10V7a4 4 0 0 1 8 0v3" /></svg>
);
export const IconWifi = ({ size, strokeWidth }: P) => (
  <svg {...base(size, strokeWidth)}><path d="M2 8.5a16 16 0 0 1 20 0" /><path d="M5 12a11 11 0 0 1 14 0" /><path d="M8.5 15.5a6 6 0 0 1 7 0" /><circle cx="12" cy="19" r="0.6" fill="currentColor" /></svg>
);
/** Messagerie ORION (bulle de conversation). */
export const IconMessage = ({ size, strokeWidth }: P) => (
  <svg {...base(size, strokeWidth)}><path d="M21 12a8 8 0 0 1-11.6 7.1L4 20.5l1.4-4.6A8 8 0 1 1 21 12Z" /><path d="M8.5 11h7M8.5 14.5h4" /></svg>
);
/** Croix médicale (ORION Assurance). */
export const IconMedical = ({ size, strokeWidth }: P) => (
  <svg {...base(size, strokeWidth)}><rect x="3.5" y="3.5" width="17" height="17" rx="5" /><path d="M12 8v8M8 12h8" /></svg>
);

/* ---- Console : icônes de navigation (même trait que le reste du jeu) ---- */
export const IconChart = ({ size, strokeWidth }: P) => (
  <svg {...base(size, strokeWidth)}><path d="M4 20h16" /><path d="M7 16v-5" /><path d="M12 16V7" /><path d="M17 16v-8" /></svg>
);
export const IconTrend = ({ size, strokeWidth }: P) => (
  <svg {...base(size, strokeWidth)}><path d="m4 16 5-5 4 3 7-7" /><path d="M15 7h5v5" /></svg>
);
export const IconAlert = ({ size, strokeWidth }: P) => (
  <svg {...base(size, strokeWidth)}><path d="M12 4 2.8 19.5h18.4L12 4Z" /><path d="M12 10v4.5" /><path d="M12 17.5h.01" /></svg>
);
export const IconFile = ({ size, strokeWidth }: P) => (
  <svg {...base(size, strokeWidth)}><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8l-5-5Z" /><path d="M14 3v5h5" /><path d="M9 13h6M9 17h4" /></svg>
);
export const IconMap = ({ size, strokeWidth }: P) => (
  <svg {...base(size, strokeWidth)}><path d="m9 4-5 2v14l5-2 6 2 5-2V4l-5 2-6-2Z" /><path d="M9 4v14M15 6v14" /></svg>
);
export const IconTag = ({ size, strokeWidth }: P) => (
  <svg {...base(size, strokeWidth)}><path d="M3 12V4h8l9 9-8 8-9-9Z" /><circle cx="7.5" cy="8.5" r="1.3" /></svg>
);
export const IconBuilding = ({ size, strokeWidth }: P) => (
  <svg {...base(size, strokeWidth)}><rect x="5" y="3" width="14" height="18" rx="1.5" /><path d="M9 7h2M13 7h2M9 11h2M13 11h2M9 15h2M13 15h2M10 21v-3h4v3" /></svg>
);
export const IconKey = ({ size, strokeWidth }: P) => (
  <svg {...base(size, strokeWidth)}><circle cx="8" cy="15" r="4" /><path d="m11 12 9-9M17 6l2 2M15 8l2 2" /></svg>
);
export const IconScale = ({ size, strokeWidth }: P) => (
  <svg {...base(size, strokeWidth)}><path d="M12 4v16M7 20h10M5 7h14" /><path d="m5 7-3 6a3 3 0 0 0 6 0L5 7ZM19 7l-3 6a3 3 0 0 0 6 0l-3-6Z" /></svg>
);
export const IconSignal = ({ size, strokeWidth }: P) => (
  <svg {...base(size, strokeWidth)}><circle cx="12" cy="12" r="1.5" /><path d="M8.5 15.5a5 5 0 0 1 0-7M15.5 8.5a5 5 0 0 1 0 7M5.6 18.4a9 9 0 0 1 0-12.8M18.4 5.6a9 9 0 0 1 0 12.8" /></svg>
);
export const IconTicket = ({ size, strokeWidth }: P) => (
  <svg {...base(size, strokeWidth)}><path d="M3 8a2 2 0 0 0 2-2h14a2 2 0 0 0 2 2v8a2 2 0 0 0-2 2H5a2 2 0 0 0-2-2V8Z" /><path d="M14 6v12" strokeDasharray="2 2" /></svg>
);
export const IconCompass = ({ size, strokeWidth }: P) => (
  <svg {...base(size, strokeWidth)}><circle cx="12" cy="12" r="9" /><path d="m15.5 8.5-2 5-5 2 2-5 5-2Z" /></svg>
);
export const IconTarget = ({ size, strokeWidth }: P) => (
  <svg {...base(size, strokeWidth)}><circle cx="12" cy="12" r="9" /><circle cx="12" cy="12" r="5" /><circle cx="12" cy="12" r="1" /></svg>
);
export const IconBank = ({ size, strokeWidth }: P) => (
  <svg {...base(size, strokeWidth)}><path d="M3 9.5 12 4l9 5.5H3Z" /><path d="M5 10v7M9.5 10v7M14.5 10v7M19 10v7M3 20h18" /></svg>
);
export const IconCash = ({ size, strokeWidth }: P) => (
  <svg {...base(size, strokeWidth)}><rect x="2.5" y="6" width="19" height="12" rx="2" /><circle cx="12" cy="12" r="2.5" /><path d="M6 9.5v.01M18 14.5v.01" /></svg>
);
export const IconGrid = ({ size, strokeWidth }: P) => (
  <svg {...base(size, strokeWidth)}><rect x="4" y="4" width="7" height="7" rx="1.5" /><rect x="13" y="4" width="7" height="7" rx="1.5" /><rect x="4" y="13" width="7" height="7" rx="1.5" /><rect x="13" y="13" width="7" height="7" rx="1.5" /></svg>
);
export const IconMonitor = ({ size, strokeWidth }: P) => (
  <svg {...base(size, strokeWidth)}><rect x="3" y="4" width="18" height="12" rx="2" /><path d="M8 20h8M12 16v4" /></svg>
);
export const IconMegaphone = ({ size, strokeWidth }: P) => (
  <svg {...base(size, strokeWidth)}><path d="M4 10v4a1 1 0 0 0 1 1h2l8 4V5L7 9H5a1 1 0 0 0-1 1Z" /><path d="M18.5 9.5a3.5 3.5 0 0 1 0 5" /></svg>
);
export const IconMail = ({ size, strokeWidth }: P) => (
  <svg {...base(size, strokeWidth)}><rect x="3" y="5" width="18" height="14" rx="2" /><path d="m4 7 8 6 8-6" /></svg>
);
export const IconInbox = ({ size, strokeWidth }: P) => (
  <svg {...base(size, strokeWidth)}><path d="M4 13 6.5 5h11L20 13v5a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-5Z" /><path d="M4 13h4.5l1 2h5l1-2H20" /></svg>
);
export const IconActivity = ({ size, strokeWidth }: P) => (
  <svg {...base(size, strokeWidth)}><path d="M3 12h4l3-7 4 14 3-7h4" /></svg>
);
export const IconIdCard = ({ size, strokeWidth }: P) => (
  <svg {...base(size, strokeWidth)}><rect x="3" y="5" width="18" height="14" rx="2" /><circle cx="9" cy="11" r="2" /><path d="M6 16a3 3 0 0 1 6 0M14 10h4M14 14h3" /></svg>
);
export const IconSteering = ({ size, strokeWidth }: P) => (
  <svg {...base(size, strokeWidth)}><circle cx="12" cy="12" r="9" /><circle cx="12" cy="12" r="2" /><path d="M3.5 10.5 10 12M20.5 10.5 14 12M12 14v7" /></svg>
);
export const IconAlarm = ({ size, strokeWidth }: P) => (
  <svg {...base(size, strokeWidth)}><path d="M6 17v-5a6 6 0 0 1 12 0v5" /><path d="M4 17h16v3H4zM12 3v1.5M4.5 6l1 1M19.5 6l-1 1" /></svg>
);
export const IconSun = ({ size, strokeWidth }: P) => (
  <svg {...base(size, strokeWidth)}><circle cx="12" cy="12" r="4" /><path d="M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.3 5.3l1.4 1.4M17.3 17.3l1.4 1.4M5.3 18.7l1.4-1.4M17.3 6.7l1.4-1.4" /></svg>
);
export const IconMoon = ({ size, strokeWidth }: P) => (
  <svg {...base(size, strokeWidth)}><path d="M20 14.5A8 8 0 1 1 9.5 4 6.5 6.5 0 0 0 20 14.5Z" /></svg>
);
export const IconBellOff = ({ size, strokeWidth }: P) => (
  <svg {...base(size, strokeWidth)}><path d="M8.5 5.2A6 6 0 0 1 18 10v3.5l1.5 2.5H9M6 10v3.5L4.5 16H9M10 19.5a2 2 0 0 0 4 0M3 3l18 18" /></svg>
);
