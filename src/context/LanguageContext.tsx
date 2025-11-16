"use client";

import React, { createContext, useContext, useState, useMemo } from 'react';
import { TRANSLATIONS, DEFAULT_LANGUAGE } from '@/lib/translations';

type LanguageContextValue = {
  language: string;
  setLanguage: (l: string) => void;
  t: (key: string, vars?: Record<string, string>) => string;
};

const LanguageContext = createContext<LanguageContextValue | undefined>(undefined);

export const LanguageProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [language, setLanguage] = useState<string>(DEFAULT_LANGUAGE);

  const t = useMemo(() => {
    return (key: string, vars?: Record<string, string>) => {
      const lang = language || DEFAULT_LANGUAGE;
      let str = TRANSLATIONS[lang]?.[key] ?? TRANSLATIONS[DEFAULT_LANGUAGE][key] ?? key;
      if (vars) {
        for (const k of Object.keys(vars)) {
          str = str.replace(new RegExp(`\{${k}\}`, 'g'), vars[k]);
        }
      }
      return str;
    };
  }, [language]);

  return (
    <LanguageContext.Provider value={{ language, setLanguage, t }}>
      {children}
    </LanguageContext.Provider>
  );
};

export const useLanguage = (): LanguageContextValue => {
  const ctx = useContext(LanguageContext);
  if (!ctx) throw new Error('useLanguage must be used within a LanguageProvider');
  return ctx;
};
