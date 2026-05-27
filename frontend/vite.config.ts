import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { sentryVitePlugin } from '@sentry/vite-plugin';
import { VitePWA } from 'vite-plugin-pwa';
import path from 'node:path';

// Sentry sourcemap upload: attivo solo se SENTRY_AUTH_TOKEN + SENTRY_ORG +
// SENTRY_PROJECT sono nelle env (es. in CI/CD). In dev locale: skip silente.
const SENTRY_UPLOAD = Boolean(
  process.env.SENTRY_AUTH_TOKEN && process.env.SENTRY_ORG && process.env.SENTRY_PROJECT,
);

export default defineConfig({
  plugins: [
    react(),
    // PWA: manifest statico (public/manifest.webmanifest) + service worker
    // Workbox. NetworkOnly su /api/* (mai cached, sessione cookie); SWR sui
    // dati pubblici (calendario condiviso) per un kiosk offline-soft.
    VitePWA({
      strategies: 'generateSW',
      registerType: 'prompt',
      injectRegister: false,
      manifest: false, // fornito staticamente da public/manifest.webmanifest
      includeAssets: ['manifest.webmanifest', 'logo.png', 'theme-init.js'],
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,ico,webmanifest}'],
        maximumFileSizeToCacheInBytes: 3 * 1024 * 1024,
        navigateFallback: '/index.html',
        navigateFallbackDenylist: [/^\/api\//, /^\/auth\//, /^\/uploads\//],
        cleanupOutdatedCaches: true,
        clientsClaim: false,
        skipWaiting: false,
        runtimeCaching: [
          // Calendario pubblico (link condivisibile read-only): SWR 5min →
          // tabellone/kiosk regge qualche minuto di backend irraggiungibile.
          {
            urlPattern: ({ url }) => url.pathname.startsWith('/api/public/calendario'),
            handler: 'StaleWhileRevalidate',
            options: {
              cacheName: 'public-calendario-v1',
              expiration: { maxEntries: 30, maxAgeSeconds: 5 * 60 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
          // Branding pubblico ente (logo/nome) — cambia raramente.
          {
            urlPattern: ({ url }) => url.pathname.startsWith('/api/public/ente'),
            handler: 'CacheFirst',
            options: {
              cacheName: 'ente-public-v1',
              expiration: { maxEntries: 10, maxAgeSeconds: 60 * 60 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
          // Upload (foto candidati/commissari/loghi) serviti dal backend.
          // StaleWhileRevalidate (non CacheFirst): serve subito la copia in cache
          // ma rivalida in background ad ogni richiesta. Con CacheFirst una foto
          // corretta dall'admin (stesso URL) restava stale fino a 7 giorni per
          // chi l'aveva già in cache — su una valutazione concorsuale è un rischio
          // d'identità (commissario vede la foto sbagliata). cacheName bumpato a
          // -v2 per scartare le entry CacheFirst già persistite sui client.
          {
            urlPattern: ({ url }) => url.pathname.startsWith('/uploads/'),
            handler: 'StaleWhileRevalidate',
            options: {
              cacheName: 'uploads-v2',
              expiration: { maxEntries: 200, maxAgeSeconds: 7 * 24 * 60 * 60 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
        ],
      },
      devOptions: { enabled: false },
    }),
    ...(SENTRY_UPLOAD
      ? [
          sentryVitePlugin({
            org: process.env.SENTRY_ORG,
            project: process.env.SENTRY_PROJECT,
            authToken: process.env.SENTRY_AUTH_TOKEN,
            release: { name: process.env.SENTRY_RELEASE },
            sourcemaps: { assets: './dist/**' },
            telemetry: false,
          }),
        ]
      : []),
  ],
  resolve: {
    alias: { '@': path.resolve(__dirname, './src') },
  },
  server: {
    port: 5173,
    // host:true → ascolta su tutti gli hostname così si può accedere via
    // ente1.gestimus.local:5173 (il tenant è risolto dal sottodominio).
    host: true,
    // Vite blocca host non-localhost di default: consentiamo i sottodomini
    // *.gestimus.local usati dal multitenant in dev.
    allowedHosts: ['.gestimus.local'],
    proxy: {
      // Backend Fastify su :4000 serve /api (dati) e /auth (sessione cookie).
      // changeOrigin:false → preserva l'Host originale (es. ente1.gestimus.local)
      // così il backend risolve il tenant dal sottodominio. Il cookie di
      // sessione resta sul dominio del tenant e viaggia col proxy.
      '/api': { target: 'http://localhost:4000', changeOrigin: false },
      '/auth': { target: 'http://localhost:4000', changeOrigin: false },
      '/uploads': { target: 'http://localhost:4000', changeOrigin: false },
    },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    sourcemap: SENTRY_UPLOAD ? 'hidden' : false,
    chunkSizeWarningLimit: 600,
    rollupOptions: {
      output: {
        // SOLO il core React (grande + condiviso da tutte le rotte) va in un
        // chunk nominato, per cache-stabilità. Tutto il resto è lasciato
        // all'auto-split di rollup, che rispetta i confini dei dynamic import:
        // librerie usate solo on-demand (jspdf+html2canvas+canvg, recharts,
        // react-markdown) finiscono in chunk LAZY e NON nel bundle iniziale.
        // NB: NON reintrodurre un catch-all `return 'vendor'`: i chunk vendor
        // nominati vengono issati come dipendenze statiche dell'entry da
        // rolldown → forzerebbe eager anche le librerie lazy (regressione nota).
        manualChunks(id) {
          if (
            /[\\/]node_modules[\\/](react|react-dom|react-router|react-router-dom|scheduler|react-is|use-sync-external-store)[\\/]/.test(
              id,
            ) ||
            id.includes('@remix-run/router')
          ) {
            return 'vendor-react';
          }
          return undefined;
        },
      },
    },
  },
});
