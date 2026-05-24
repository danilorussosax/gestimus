// Lightweight i18n: dictionary lookup with {param} interpolation,
// localStorage persistence, and a `langchange` window event so views
// can re-render on switch. Fallback chain: current lang → IT → key.

const STORAGE_KEY = 'gc_lang';
export const SUPPORTED_LANGS = ['it', 'en', 'fr', 'es'];
export const LANG_LABELS = { it: 'Italiano', en: 'English', fr: 'Français', es: 'Español' };
export const LANG_FLAGS  = { it: '🇮🇹', en: '🇬🇧', fr: '🇫🇷', es: '🇪🇸' };
const DEFAULT_LANG = 'it';

import { it } from './i18n/it.js';
import { en } from './i18n/en.js';
import { fr } from './i18n/fr.js';
import { es } from './i18n/es.js';

const dict = { it, en, fr, es };

let currentLang = (() => {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored && SUPPORTED_LANGS.includes(stored)) return stored;
  } catch { /* localStorage unavailable */ }
  // Auto-detect from browser
  const nav = (navigator.language || 'it').slice(0, 2).toLowerCase();
  return SUPPORTED_LANGS.includes(nav) ? nav : DEFAULT_LANG;
})();

export function t(key, params = {}) {
  const lang = dict[currentLang] || dict[DEFAULT_LANG];
  let text = lang[key] ?? dict[DEFAULT_LANG][key] ?? key;
  for (const [k, v] of Object.entries(params)) {
    text = text.replaceAll(`{${k}}`, String(v));
  }
  return text;
}

export function setLang(lang) {
  if (!SUPPORTED_LANGS.includes(lang)) return;
  currentLang = lang;
  try { localStorage.setItem(STORAGE_KEY, lang); } catch { /* noop */ }
  document.documentElement.lang = lang;
  window.dispatchEvent(new CustomEvent('langchange', { detail: { lang } }));
}

export function getLang() { return currentLang; }

// Initialize html[lang] on first import
if (typeof document !== 'undefined') {
  document.documentElement.lang = currentLang;
}
