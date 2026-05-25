import i18n from 'i18next';
import LanguageDetector from 'i18next-browser-languagedetector';
import { initReactI18next } from 'react-i18next';
import dayjs from 'dayjs';
import 'dayjs/locale/it';
import 'dayjs/locale/en';
import 'dayjs/locale/es';
import 'dayjs/locale/fr';

import it from './locales/it.json';
import en from './locales/en.json';
import es from './locales/es.json';
import fr from './locales/fr.json';

export const SUPPORTED_LANGUAGES = ['it', 'en', 'fr', 'es'] as const;
export type SupportedLanguage = (typeof SUPPORTED_LANGUAGES)[number];

export const LANGUAGE_NAMES: Record<SupportedLanguage, string> = {
  it: 'Italiano',
  en: 'English',
  fr: 'Français',
  es: 'Español',
};

export const LANGUAGE_FLAGS: Record<SupportedLanguage, string> = {
  it: '🇮🇹',
  en: '🇬🇧',
  fr: '🇫🇷',
  es: '🇪🇸',
};

const STORAGE_KEY = 'gestimus_lang';

void i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources: {
      it: { translation: it },
      en: { translation: en },
      fr: { translation: fr },
      es: { translation: es },
    },
    fallbackLng: 'it',
    supportedLngs: SUPPORTED_LANGUAGES,
    // Le chiavi della vecchia app sono FLAT con punti (es. 'app.title'):
    // disattiviamo i separatori così i18next le tratta come chiavi letterali
    // e il contratto i18n resta identico al vanilla.
    keySeparator: false,
    nsSeparator: false,
    interpolation: { escapeValue: false },
    detection: {
      order: ['localStorage', 'navigator', 'htmlTag'],
      caches: ['localStorage'],
      lookupLocalStorage: STORAGE_KEY,
    },
  });

function syncDayjsLocale(lng: string) {
  const base = (lng || 'it').split('-')[0];
  const supported = (SUPPORTED_LANGUAGES as readonly string[]).includes(base) ? base : 'it';
  dayjs.locale(supported);
  document.documentElement.lang = supported;
}
syncDayjsLocale((i18n.resolvedLanguage ?? i18n.language) || 'it');
i18n.on('languageChanged', syncDayjsLocale);

export default i18n;
