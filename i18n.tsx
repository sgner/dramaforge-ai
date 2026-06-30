import React, { createContext, useContext, useCallback, useState, useEffect } from 'react';
import { Language } from './types';
import { translations } from './locales';

interface I18nContextValue {
  lang: Language;
  setLang: (lang: Language) => void;
  t: (key: string) => string;
}

const I18nContext = createContext<I18nContextValue | null>(null);

const LANG_STORAGE_KEY = 'dramaforge_language';

export const I18nProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [lang, setLangState] = useState<Language>(() => {
    try {
      const saved = localStorage.getItem(LANG_STORAGE_KEY) as Language | null;
      if (saved && ['en', 'zh', 'ja', 'ko'].includes(saved)) return saved;
    } catch {}
    return 'zh';
  });

  const setLang = useCallback((newLang: Language) => {
    setLangState(newLang);
    try { localStorage.setItem(LANG_STORAGE_KEY, newLang); } catch {}
  }, []);

  const t = useCallback((key: string) => {
    return translations[lang]?.[key] || translations.en?.[key] || key;
  }, [lang]);

  return (
    <I18nContext.Provider value={{ lang, setLang, t }}>
      {children}
    </I18nContext.Provider>
  );
};

export function useI18n(): I18nContextValue {
  const ctx = useContext(I18nContext);
  if (!ctx) {
    // Fallback for components used outside provider (e.g. during testing)
    return {
      lang: 'zh',
      setLang: () => {},
      t: (key: string) => translations.zh?.[key] || key,
    };
  }
  return ctx;
}

/**
 * Standalone translation function for non-React code (e.g. Zustand stores).
 * Reads current language from localStorage.
 */
export function getT(lang?: Language): (key: string) => string {
  const resolvedLang = lang || (() => {
    try {
      const saved = localStorage.getItem(LANG_STORAGE_KEY) as Language | null;
      if (saved && ['en', 'zh', 'ja', 'ko'].includes(saved)) return saved;
    } catch {}
    return 'zh';
  })();
  return (key: string) => translations[resolvedLang]?.[key] || translations.en?.[key] || key;
}
