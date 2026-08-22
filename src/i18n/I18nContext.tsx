import { createContext, useContext, useState, useEffect, useCallback, type ReactNode } from 'react';
import { translations, getLanguage, setLanguage, applyLanguage, type Language, type TranslationKey } from '@/i18n/translations';

interface I18nContextValue {
  lang: Language;
  t: (key: TranslationKey) => string;
  toggleLanguage: () => void;
  setLang: (lang: Language) => void;
  dir: 'rtl' | 'ltr';
}

const I18nContext = createContext<I18nContextValue | null>(null);

export function I18nProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Language>(() => getLanguage());

  useEffect(() => {
    applyLanguage(lang);
  }, [lang]);

  const setLang = useCallback((l: Language) => {
    setLangState(l);
    setLanguage(l);
  }, []);

  const toggleLanguage = useCallback(() => {
    const next: Language = lang === 'ar' ? 'en' : 'ar';
    setLang(next);
  }, [lang, setLang]);

  const t = useCallback((key: TranslationKey) => {
    return translations[lang][key] ?? translations.ar[key] ?? key;
  }, [lang]);

  return (
    <I18nContext.Provider value={{ lang, t, toggleLanguage, setLang, dir: lang === 'ar' ? 'rtl' : 'ltr' }}>
      {children}
    </I18nContext.Provider>
  );
}

export function useI18n() {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error('useI18n must be used within I18nProvider');
  return ctx;
}
