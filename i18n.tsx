import React, { createContext, useContext, useCallback, useState, useEffect } from 'react';
import { Language } from './types';
import { translations } from './locales';
import { api } from './services/apiClient';

interface I18nContextValue {
  lang: Language;
  setLang: (lang: Language) => void;
  t: (key: string) => string;
}

const I18nContext = createContext<I18nContextValue | null>(null);

const LANG_STORAGE_KEY = 'dramaforge_language';
const LANG_BACKEND_KEY = 'language';

/** 从 localStorage 读语言（同步首屏用，避免闪烁）。 */
function readLocalLang(): Language {
  try {
    const saved = localStorage.getItem(LANG_STORAGE_KEY) as Language | null;
    if (saved && ['en', 'zh', 'ja', 'ko'].includes(saved)) return saved;
  } catch {}
  return 'zh';
}

/** 写语言到 localStorage（同步写，避免下次启动首屏闪烁；后端是主存）。 */
function writeLocalLang(lang: Language) {
  try { localStorage.setItem(LANG_STORAGE_KEY, lang); } catch {}
}

export const I18nProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  // 1) 同步：先从 localStorage 拿（首屏不闪烁）
  const [lang, setLangState] = useState<Language>(() => readLocalLang());

  // 2) 异步：挂载时从后端拉，覆盖 localStorage
  useEffect(() => {
    let cancelled = false;
    api.getUserPreference(LANG_BACKEND_KEY)
      .then((res) => {
        if (cancelled) return;
        const v = res?.value;
        if (typeof v === 'string' && ['en', 'zh', 'ja', 'ko'].includes(v)) {
          setLangState(v as Language);
          writeLocalLang(v as Language);
        }
      })
      .catch((e) => {
        // 后端不可用时继续用 localStorage（兜底）
        if (cancelled) return;
        console.warn('[i18n] getUserPreference(language) failed, using localStorage', e);
      });
    return () => { cancelled = true; };
  }, []);

  const setLang = useCallback((newLang: Language) => {
    setLangState(newLang);
    writeLocalLang(newLang);
    // 后端主存：PUT /api/user-preferences/language
    api.setUserPreference(LANG_BACKEND_KEY, newLang).catch((e) => {
      console.warn('[i18n] setUserPreference(language) failed', e);
    });
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
 * Reads current language from localStorage（fallback only — 后端优先）。
 */
export function getT(lang?: Language): (key: string) => string {
  const resolvedLang = lang || readLocalLang();
  return (key: string) => translations[resolvedLang]?.[key] || translations.en?.[key] || key;
}
