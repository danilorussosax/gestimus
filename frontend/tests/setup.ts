import '@testing-library/jest-dom/vitest';
import { afterAll, afterEach, beforeAll } from 'vitest';
import { server } from './msw/server';
import i18n from '@/i18n';

// Lingua deterministica per la suite: il LanguageDetector altrimenti pesca da
// navigator.language / localStorage e i test diventano dipendenti dalla locale
// del runner. Forziamo 'it' (lingua primaria dell'app, fallbackLng) così le
// asserzioni su testi/label sono stabili. I test possono comunque cambiare
// lingua con i18n.changeLanguage(...) se serve.
beforeAll(async () => {
  await i18n.changeLanguage('it');
});

// ─── MSW: ciclo di vita condiviso da tutta la suite ─────────────────────────
// onUnhandledRequest 'error': qualunque chiamata di rete non mockata fa fallire
// il test (rete reale vietata negli unit/component test). Aggiungi un handler
// in tests/msw/handlers.ts o via server.use(...) nel test per coprirla.
beforeAll(() => {
  server.listen({ onUnhandledRequest: 'error' });
});
// Azzera gli override per-test così ogni test riparte dai baseline handlers.
afterEach(() => {
  server.resetHandlers();
});
afterAll(() => {
  server.close();
});
