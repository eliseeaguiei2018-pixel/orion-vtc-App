import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { LANGUAGES, TRANSLATIONS, type Lang } from './translations';

interface I18nValue {
  lang: Lang;
  setLang: (l: Lang) => void;
  rtl: boolean;
  t: (key: string, vars?: Record<string, string | number>) => string;
}

const I18nContext = createContext<I18nValue | null>(null);

const STORAGE_KEY = 'orion.lang';

function detectInitial(): Lang {
  const saved = (typeof localStorage !== 'undefined' && localStorage.getItem(STORAGE_KEY)) as Lang | null;
  if (saved && TRANSLATIONS[saved]) return saved;
  const nav = (typeof navigator !== 'undefined' ? navigator.language : 'fr').slice(0, 2) as Lang;
  return TRANSLATIONS[nav] ? nav : 'fr';
}

export function I18nProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>(detectInitial);

  const rtl = LANGUAGES.find((l) => l.code === lang)?.rtl ?? false;

  useEffect(() => {
    document.documentElement.lang = lang;
    document.documentElement.dir = rtl ? 'rtl' : 'ltr';
  }, [lang, rtl]);

  const setLang = (l: Lang) => {
    setLangState(l);
    try {
      localStorage.setItem(STORAGE_KEY, l);
    } catch {
      /* stockage indisponible */
    }
  };

  const t = (key: string, vars?: Record<string, string | number>): string => {
    let str = TRANSLATIONS[lang][key] ?? TRANSLATIONS.fr[key] ?? key;
    if (vars) for (const [k, v] of Object.entries(vars)) str = str.replace(`{${k}}`, String(v));
    return str;
  };

  return <I18nContext.Provider value={{ lang, setLang, rtl, t }}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nValue {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error('useI18n hors de I18nProvider');
  return ctx;
}

export { LANGUAGES };
export type { Lang };
