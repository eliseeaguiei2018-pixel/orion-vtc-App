import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { appliquerStyle, memoriserStyle, styleInitial } from './styleApp';

export type ThemeMode = 'light' | 'dark' | 'system';
export type Resolved = 'light' | 'dark';
/**
 * Couleur choisie par le client, sur la base du design ORION : huit palettes, rangées par
 * deux lignes de quatre dans les paramètres. « blanc » garde les thèmes clair et sombre purs
 * (aucune teinte dans les fonds, boutons noirs en clair et blancs en sombre).
 */
export type Accent = 'vert' | 'orange' | 'bleu' | 'blanc' | 'jaune' | 'marron' | 'violet' | 'rose';
export const ACCENTS: Accent[] = ['vert', 'orange', 'bleu', 'blanc', 'jaune', 'marron', 'violet', 'rose'];
/** Accents qui ont leurs propres rendus de voiture (les autres prennent la voiture nacrée). */
export const ACCENTS_RENDUS: Accent[] = ['vert', 'orange', 'bleu'];

interface ThemeValue {
  mode: ThemeMode;
  resolved: Resolved;
  setMode: (m: ThemeMode) => void;
  accent: Accent;
  setAccent: (a: Accent) => void;
  /** « Mêler les couleurs » : la couleur choisie teinte légèrement les fonds (comme en 2.6). */
  meler: boolean;
  setMeler: (v: boolean) => void;
  /** « Style Orion » : le style de la version 2.6.0 à la place du design 2.7. */
  styleOrion: boolean;
  setStyleOrion: (v: boolean) => void;
}

const ThemeContext = createContext<ThemeValue | null>(null);
const KEY = 'orion.theme';
const KEY_ACCENT = 'orion.accent';
const KEY_MELER = 'orion.meler';

/** Couleur de la barre du navigateur / du système, par accent et par mode. */
const BARRE: Record<Accent, Record<Resolved, string>> = Object.fromEntries(
  ACCENTS.map((a) => [a, { dark: '#0c0d0f', light: '#ffffff' }]),
) as Record<Accent, Record<Resolved, string>>;

function accentInitial(): Accent {
  try {
    const a = localStorage.getItem(KEY_ACCENT) as Accent | null;
    if (a && ACCENTS.includes(a)) return a;
  } catch { /* stockage indisponible */ }
  return 'vert';
}

function appliquerAccent(a: Accent, r: Resolved): void {
  document.documentElement.setAttribute('data-accent', a);
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', BARRE[a][r]);
}

/** « Mêler les couleurs » : désactivé par défaut (blanc et noir purs, version 2.7). */
function melerInitial(): boolean {
  try { return localStorage.getItem(KEY_MELER) === '1'; } catch { return false; }
}
function appliquerMeler(v: boolean): void {
  if (v) document.documentElement.setAttribute('data-meler', '1');
  else document.documentElement.removeAttribute('data-meler');
}

// Appliqué dès le chargement du module, avant le premier affichage : pas d'éclair vert
// au démarrage pour un client qui a choisi l'orange ou le bleu, ni de fond qui change de ton.
if (typeof document !== 'undefined') {
  document.documentElement.setAttribute('data-accent', accentInitial());
  appliquerMeler(melerInitial());
  appliquerStyle(styleInitial());
}

const systemPrefersDark = () =>
  typeof matchMedia !== 'undefined' && matchMedia('(prefers-color-scheme: dark)').matches;

function initialMode(): ThemeMode {
  const saved = (typeof localStorage !== 'undefined' && localStorage.getItem(KEY)) as ThemeMode | null;
  return saved ?? 'system';
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [mode, setModeState] = useState<ThemeMode>(initialMode);
  const [accent, setAccentState] = useState<Accent>(accentInitial);
  const [meler, setMelerState] = useState<boolean>(melerInitial);
  const [styleOrion, setStyleOrionState] = useState<boolean>(() => styleInitial() === 'orion');
  const [resolved, setResolved] = useState<Resolved>(
    initialMode() === 'system' ? (systemPrefersDark() ? 'dark' : 'light') : (initialMode() as Resolved),
  );

  useEffect(() => {
    const compute = (): Resolved => (mode === 'system' ? (systemPrefersDark() ? 'dark' : 'light') : mode);
    const apply = () => {
      const r = compute();
      setResolved(r);
      document.documentElement.setAttribute('data-theme', r);
      document.documentElement.style.colorScheme = r;
      appliquerAccent(accent, r);
    };
    apply();
    // Optimisation auto : suit le thème du téléphone quand mode = system.
    if (mode === 'system' && typeof matchMedia !== 'undefined') {
      const mq = matchMedia('(prefers-color-scheme: dark)');
      const onChange = () => apply();
      mq.addEventListener?.('change', onChange);
      return () => mq.removeEventListener?.('change', onChange);
    }
    return undefined;
  }, [mode, accent]);

  const setMode = (m: ThemeMode) => {
    setModeState(m);
    try {
      localStorage.setItem(KEY, m);
    } catch {
      /* stockage indisponible */
    }
  };

  /**
   * Change la couleur de l'app en temps réel. Avec la transition de vue du navigateur
   * (Chrome, Android, Safari 18+), l'ancien rendu se fond dans le nouveau ; sinon le
   * changement est immédiat.
   */
  const setAccent = (a: Accent) => {
    try { localStorage.setItem(KEY_ACCENT, a); } catch { /* stockage indisponible */ }
    const doc = document as Document & { startViewTransition?: (cb: () => void) => unknown };
    const changer = () => { appliquerAccent(a, resolved); setAccentState(a); };
    if (doc.startViewTransition && !matchMedia('(prefers-reduced-motion: reduce)').matches) doc.startViewTransition(changer);
    else changer();
  };

  /** Mêle (ou non) la couleur choisie aux fonds, en fondu comme le changement de couleur. */
  const setMeler = (v: boolean) => {
    try { localStorage.setItem(KEY_MELER, v ? '1' : '0'); } catch { /* stockage indisponible */ }
    const doc = document as Document & { startViewTransition?: (cb: () => void) => unknown };
    const changer = () => { appliquerMeler(v); setMelerState(v); };
    if (doc.startViewTransition && !matchMedia('(prefers-reduced-motion: reduce)').matches) doc.startViewTransition(changer);
    else changer();
  };

  /** Bascule entre le design 2.7 et le « Style Orion » (2.6.0), en fondu. */
  const setStyleOrion = (v: boolean) => {
    memoriserStyle(v ? 'orion' : 'apple');
    const doc = document as Document & { startViewTransition?: (cb: () => void) => unknown };
    const changer = () => { appliquerStyle(v ? 'orion' : 'apple'); setStyleOrionState(v); };
    if (doc.startViewTransition && !matchMedia('(prefers-reduced-motion: reduce)').matches) doc.startViewTransition(changer);
    else changer();
  };

  return <ThemeContext.Provider value={{ mode, resolved, setMode, accent, setAccent, meler, setMeler, styleOrion, setStyleOrion }}>{children}</ThemeContext.Provider>;
}

/** Accent courant, y compris hors de ThemeProvider (console, tableau de bord) : vert par défaut. */
export function useAccentSur(): Accent {
  return useContext(ThemeContext)?.accent ?? 'vert';
}

/** « Style Orion » actif, y compris hors de ThemeProvider (console, tableau de bord) : non par défaut. */
export function useStyleOrionSur(): boolean {
  return useContext(ThemeContext)?.styleOrion ?? false;
}

export function useTheme(): ThemeValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme hors de ThemeProvider');
  return ctx;
}
