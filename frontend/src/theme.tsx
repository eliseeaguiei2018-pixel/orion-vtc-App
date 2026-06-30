import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';

export type ThemeMode = 'light' | 'dark' | 'system';
export type Resolved = 'light' | 'dark';

interface ThemeValue {
  mode: ThemeMode;
  resolved: Resolved;
  setMode: (m: ThemeMode) => void;
}

const ThemeContext = createContext<ThemeValue | null>(null);
const KEY = 'orion.theme';

const systemPrefersDark = () =>
  typeof matchMedia !== 'undefined' && matchMedia('(prefers-color-scheme: dark)').matches;

function initialMode(): ThemeMode {
  const saved = (typeof localStorage !== 'undefined' && localStorage.getItem(KEY)) as ThemeMode | null;
  return saved ?? 'system';
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [mode, setModeState] = useState<ThemeMode>(initialMode);
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
  }, [mode]);

  const setMode = (m: ThemeMode) => {
    setModeState(m);
    try {
      localStorage.setItem(KEY, m);
    } catch {
      /* stockage indisponible */
    }
  };

  return <ThemeContext.Provider value={{ mode, resolved, setMode }}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme hors de ThemeProvider');
  return ctx;
}
