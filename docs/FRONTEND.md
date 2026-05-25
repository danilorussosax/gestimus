# Gestimus — Frontend React

Guida tecnica al frontend React. Per l'overview generale del progetto vedi il [README](../README.md).

---

## Stack

| | |
|---|---|
| **React** | 19.x (StrictMode, Concurrent Features, lazy/Suspense per le pagine) |
| **TypeScript** | 6.x strict (`tsconfig.app.json`; `exactOptionalPropertyTypes` off per compat) |
| **Vite** | 8.x — dev server :5173, HMR, proxy `/api` `/auth` `/uploads` → `:4000` |
| **Tailwind CSS** | 4.x — configurazione CSS-first (`@import 'tailwindcss'` in `index.css`) |
| **Radix UI** | Primitivi accessibili headless (Dialog, Select, Tabs, Switch, Tooltip, …) |
| **TanStack Query** | v5 — server state, cache, invalidation (`staleTime` 30s, `retry` 1) |
| **React Router** | v7 — `BrowserRouter`, lazy routes, guard components |
| **react-hook-form** | v7 + **Zod 4** via `@hookform/resolvers` |
| **i18next** | v26 + `react-i18next` v17 — 4 lingue (it/en/fr/es), chiavi piatte |
| **Sentry** | `@sentry/react` v10 — Error Boundary + sourcemap upload opzionale in CI |
| **PWA** | `vite-plugin-pwa` + Workbox `generateSW` — NetworkOnly su `/api/*`, SWR sul calendario pubblico |
| **framer-motion** | Animazioni (ridotte se `prefers-reduced-motion`) |
| **recharts** | Grafici (sparkline metriche super-admin) |
| **dayjs** | Date/time + locale sync con la lingua i18next attiva |
| **sonner** | Toast notifications |
| **lucide-react** | Icon set |
| **jspdf + jspdf-autotable** | Export PDF (verbale, calendario, protocollo) |

---

## Layout di `src/`

```
src/
├── api/                    # Moduli fetch per entità di dominio
│   ├── auth.ts             # login, logout, /auth/me, TOTP setup/enable/disable
│   ├── concorsi.ts
│   ├── fasi.ts
│   ├── fase-runtime.ts     # timer fase + SSE subscription
│   ├── candidati.ts
│   ├── commissari.ts
│   ├── commissioni.ts
│   ├── criteri.ts
│   ├── sezioni.ts
│   ├── categorie.ts
│   ├── valutazioni.ts
│   ├── iscrizioni.ts
│   ├── calendario.ts
│   ├── audit.ts
│   ├── accounts.ts
│   ├── ente.ts
│   ├── platform.ts         # super-admin: enti, metriche, audit piattaforma
│   ├── home.ts
│   └── public.ts           # endpoint pubblici (branding ente, calendario)
│
├── components/
│   ├── ui/                 # Primitivi shadcn-style (Button, Card, Dialog, Input, Select, …)
│   ├── admin/              # Tab del workspace admin
│   │   ├── FasiTab.tsx
│   │   ├── CandidatiTab.tsx
│   │   ├── CommissariTab.tsx
│   │   ├── CommissioniTab.tsx
│   │   ├── SezioniTab.tsx
│   │   ├── RisultatiTab.tsx
│   │   ├── IscrizioniTab.tsx
│   │   ├── CalendarioTab.tsx
│   │   ├── AuditTab.tsx
│   │   ├── ImpostazioniConcorsoTab.tsx
│   │   └── ConcorsoSelector.tsx
│   ├── layout/
│   │   └── AppLayout.tsx   # Shell autenticata (sidebar + header + <Outlet>)
│   ├── ProtectedRoute.tsx  # Guard rotte (ProtectedRoute, RequireAdmin, PublicOnlyRoute)
│   ├── AppErrorBoundary.tsx
│   └── OfflineBanner.tsx
│
├── contexts/
│   ├── AuthContext.tsx      # Stato auth + loginWithCredentials + completeMfaLogin + logout
│   └── ThemeContext.tsx     # Light/dark mode
│
├── hooks/
│   ├── useFaseRuntime.ts   # Fetch runtime fase + SSE timer + countdown ogni 250ms
│   ├── useOnline.ts        # navigator.onLine + eventi online/offline
│   ├── useDirtyDialogClose.ts  # Confirm prima di chiudere un dialog con modifiche
│   └── useFullscreen.ts
│
├── i18n/
│   ├── index.ts            # Init i18next (LanguageDetector, fallbackLng 'it', keySeparator false)
│   └── locales/
│       ├── it.json         # Lingua master
│       ├── en.json
│       ├── fr.json
│       └── es.json
│
├── lib/
│   ├── api.ts              # HTTP client (fetch + credentials:'include', HttpError, http.{get,post,patch,…})
│   ├── scoring.ts          # Algoritmi calcolo media (portati dal vanilla)
│   ├── tiebreak.ts         # Logiche spareggio
│   ├── rng.ts              # mulberry32 seedato (sorteggio riproducibile)
│   ├── date.ts             # Helper dayjs (format, parse)
│   ├── sentry.ts           # Init Sentry + setSentryUser (id anonimizzato SHA-256)
│   ├── pwa.ts              # Registrazione SW + prompt aggiornamento
│   ├── sezione-icon.ts     # Mappa sezione → icona Lucide
│   └── utils.ts            # cn() (clsx + tailwind-merge), helpers vari
│
├── pages/
│   ├── Home.tsx            # Landing autenticata (eager)
│   ├── NotFound.tsx        # 404 catch-all (eager)
│   ├── Commissario.tsx     # Vista commissario (lazy)
│   ├── Superadmin.tsx      # Vista super-admin (lazy)
│   ├── AccountSecurity.tsx # 2FA TOTP self-service (lazy)
│   ├── admin/
│   │   ├── AdminWorkspace.tsx  # Tabs admin concorso selezionato (lazy)
│   │   ├── Dashboard.tsx
│   │   ├── Statistiche.tsx
│   │   ├── Impostazioni.tsx
│   │   ├── Utenti.tsx
│   │   └── Manuale.tsx
│   ├── auth/
│   │   └── Login.tsx       # Pagina login (+ step 2FA) (lazy)
│   └── public/
│       ├── Iscrizione.tsx
│       ├── IscrizioneConferma.tsx
│       ├── Privacy.tsx
│       └── CalendarioPubblico.tsx
│
├── types/
│   └── index.ts            # Contratto API: User, Role, Concorso, Fase, …
│
├── App.tsx                 # Router (Routes/Route lazy, ProtectedRoute/RequireAdmin)
├── main.tsx                # Entry point (StrictMode > ErrorBoundary > Theme > Query > Router > Auth)
├── index.css               # Tailwind 4 + token custom (palette brand/ink/accent/sun)
├── legacy.css              # Token HSL shadcn/ui (card, primary, border, …)
└── vite-env.d.ts
```

---

## Convenzioni principali

### HTTP client + moduli api/

Il client HTTP vive in `src/lib/api.ts`. Punti chiave:

- `credentials: 'include'` su ogni fetch — il cookie di sessione HttpOnly viaggia automaticamente.
- Path che iniziano con `/` sono usati verbatim; gli altri ricevono il prefisso `/api`.
- Su `401` viene emesso l'evento `auth:expired` che `AuthContext` ascolta per forzare il logout locale.
- `HttpError` porta `status` + `payload` (con `code`, `issues`, `details` per la localizzazione).
- Helper tipizzati: `http.get<T>`, `http.post<T>`, `http.patch<T>`, `http.del<T>`, `http.upload`.

Ogni entità ha il proprio modulo in `src/api/`:

```ts
// src/api/concorsi.ts — esempio tipico
import { http } from '@/lib/api';
import type { Concorso } from '@/types';

export const concorsiApi = {
  list: () => http.get<Concorso[]>('concorsi'),
  get: (id: string) => http.get<Concorso>(`concorsi/${id}`),
  create: (body: Partial<Concorso>) => http.post<Concorso>('concorsi', body),
  update: (id: string, body: Partial<Concorso>) => http.patch<Concorso>(`concorsi/${id}`, body),
  remove: (id: string) => http.del(`concorsi/${id}`),
};
```

Nelle pagine/componenti si usano hook TanStack Query che chiamano questi moduli:

```ts
const { data: concorsi } = useQuery({
  queryKey: ['concorsi'],
  queryFn: () => concorsiApi.list(),
});

const mutazione = useMutation({
  mutationFn: (body: Partial<Concorso>) => concorsiApi.create(body),
  onSuccess: () => queryClient.invalidateQueries({ queryKey: ['concorsi'] }),
});
```

### Design system

Il design system combina due strati:

1. **`legacy.css`** — token CSS HSL di shadcn/ui (`--background`, `--primary`, `--card`, …) che definiscono il tema visivo (Royal Blue `#4169E1` come primary). Include anche le classi utilitarie `c-*` portate dal vanilla (`c-stat`, `c-tile`, `sidebar-nav-active`, `login-hero`).

2. **`index.css`** — Tailwind CSS 4 (`@import 'tailwindcss'`) con la palette custom brand/ink/accent/sun:
   - `brand-*` (50→900) — blu royal, colore primario
   - `ink-*` (400→900) — testo su sfondi chiari
   - `accent-*` (50→600) — celeste secondario
   - `sun-*` (50→600) — giallo/warning

3. **`src/components/ui/`** — Wrapper Radix UI con Tailwind (`cn()` = `clsx` + `tailwind-merge`). Convenzione: ogni primitivo esporta i propri `variants` via `class-variance-authority`.

Per aggiungere un componente UI: creare `src/components/ui/<nome>.tsx`, usare `cn()` per i class names, esporre `ref` tramite `React.forwardRef` se il primitivo è interattivo.

### i18n

- Init in `src/i18n/index.ts` (importato in `main.tsx` come side-effect).
- `keySeparator: false` + `nsSeparator: false` → le chiavi sono piatte con punti letterali (es. `'app.title'`, `'errors.generic'`), stessa convenzione del vanilla.
- Lingua rilevata da `localStorage` (`gestimus_lang`) → `navigator.language` → `htmlTag`.
- `fallbackLng: 'it'` — le chiavi mancanti ricadono sull'italiano.
- La lingua di `dayjs` è sincronizzata automaticamente in `src/i18n/index.ts`.
- Nei componenti: `const { t } = useTranslation()`.

```ts
// Chiave piatta:
t('candidati.importa.titolo')

// Con interpolazione:
t('fase.tempo_rimasto', { minuti: 5 })
```

Per aggiungere una chiave: aggiungere in `it.json` (master) e nelle altre 3 lingue.

### Routing e guard

Il router vive in `src/App.tsx`. Schema:

```
/iscrizione          → Iscrizione (pubblica, no auth)
/iscrizione/conferma → IscrizioneConferma (pubblica)
/privacy             → Privacy (pubblica)
/calendario          → CalendarioPubblico (pubblica)
/login               → Login (PublicOnlyRoute: redirect a / se già autenticato)

ProtectedRoute (→ /login se non autenticato)
  AppLayout (shell con sidebar)
    /                  → Home
    /account/security  → AccountSecurity
    /commissario       → Commissario
    /admin             → AdminWorkspace   (RequireAdmin: role ≥ admin)
    /admin/dashboard   → Dashboard
    /admin/statistiche → Statistiche
    /admin/impostazioni→ Impostazioni
    /admin/utenti      → Utenti
    /admin/manuale     → Manuale
    ProtectedRoute (minRole:'superadmin')
      /superadmin      → Superadmin
```

**Guard components** (`src/components/ProtectedRoute.tsx`):

- `ProtectedRoute` — reindirizza a `/login` (con `state.from`) se non autenticato; controlla il rank minimo.
- `RequireAdmin` — wrapper inline per sotto-alberi che richiedono `role ≥ admin`.
- `PublicOnlyRoute` — reindirizza a `/superadmin` o `/` se già autenticato.

Rank roles: `commissario(1) < admin(2) < superadmin(3)`.

### Auth context

`src/contexts/AuthContext.tsx` espone:

| Campo/metodo | Descrizione |
|---|---|
| `user` | Utente loggato (`User \| null`) |
| `loading` | `true` durante il bootstrap (`GET /auth/me`) |
| `isAuthenticated` | Shorthand `Boolean(user)` |
| `hasRole(...roles)` | Controlla se il ruolo corrente è nella lista |
| `loginWithCredentials(email, password)` | Step 1: ritorna `{kind:'ok', user}` oppure `{kind:'mfa', challenge}` |
| `completeMfaLogin(challenge, code)` | Step 2 2FA: verifica TOTP e popola l'utente |
| `refreshUser()` | Ri-fetch `/auth/me` (utile dopo modifiche al profilo) |
| `logout()` | POST `/auth/logout` + reset stato locale |

Il bootstrap avviene a mount con `GET /auth/me`. Se il cookie di sessione è valido, l'utente è ripristinato senza ulteriore login. Se un'API risponde `401`, l'evento `auth:expired` viene emesso e il context forza il logout locale.

---

## Come aggiungere una pagina

1. **Crea il file** in `src/pages/<NomePagina>.tsx` (o in una sottocartella appropriata).

2. **Aggiungi la route** in `src/App.tsx`. Le nuove pagine sono normalmente lazy:
   ```ts
   const NuovaPagina = lazy(() => import('@/pages/NuovaPagina'));
   // poi in Routes:
   <Route path="/nuova-pagina" element={<NuovaPagina />} />
   ```

3. **Fetch dati**: crea (o estendi) un modulo in `src/api/` e usa `useQuery`/`useMutation` nel componente.

4. **Form**: usa `react-hook-form` + `zodResolver`. Schema Zod definito nello stesso file o in un modulo `schemas/`.

5. **i18n**: aggiungi le chiavi in `src/i18n/locales/it.json` (+ en/fr/es).

6. **Tipi**: aggiungi le interfacce necessarie in `src/types/index.ts`.

### Esempio minimo

```tsx
// src/pages/EsempioPagina.tsx
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { concorsiApi } from '@/api/concorsi';

export default function EsempioPagina() {
  const { t } = useTranslation();
  const { data, isLoading } = useQuery({
    queryKey: ['concorsi'],
    queryFn: () => concorsiApi.list(),
  });

  if (isLoading) return <div>{t('common.caricamento')}</div>;
  return (
    <div>
      <h1>{t('concorsi.titolo')}</h1>
      {data?.map((c) => <p key={c.id}>{c.nome}</p>)}
    </div>
  );
}
```

---

## Build, lint, test

### Dev

```bash
cd frontend
npm run dev          # Vite :5173 con HMR (richiede backend :4000)
```

Il proxy Vite preserva l'`Host` originale (`changeOrigin: false`) così il backend
risolve il tenant dal sottodominio anche in dev. Accedere via
`http://ente1.gestimus.local:5173/` (non `localhost:5173`).

### Build produzione

```bash
cd frontend
npm run build        # tsc -b && vite build → dist/
```

Output in `frontend/dist/`. Chunk splitting manuale in `vite.config.ts`:
`vendor-react`, `vendor-radix`, `vendor-query`, `vendor-i18n`, `vendor-form`,
`vendor-recharts`, `vendor-motion`, `vendor-icons`, `vendor-dayjs`, `vendor-markdown`.

### Type-check

```bash
cd frontend
npm run typecheck    # tsc -b --noEmit
```

Usa `tsconfig.app.json` (src/) + `tsconfig.node.json` (vite.config, playwright.config).
Deve dare **0 errori**.

### Lint

```bash
cd frontend
npm run lint         # ESLint strict-type-checked (max-warnings 9999 durante port)
npm run lint:fix     # + autofix
```

Config in `eslint.config.js` (flat config ESLint 9+): `typescript-eslint strictTypeChecked` +
`stylisticTypeChecked` + `eslint-plugin-react-hooks` v7 + `react-refresh`. Le regole
più aggressive sono abbassate a `warn` per il port iniziale e saranno rialzate a `error`
progressivamente.

### Unit test (Vitest)

```bash
cd frontend
npm run test             # Vitest run (jsdom, una volta)
npm run test:watch       # Vitest watch
npm run test:coverage    # + copertura v8 in coverage/
```

Config in `vitest.config.ts`. Setup file: `tests/setup.ts` (importa `@testing-library/jest-dom`).
Scope copertura: `src/components/**` + `src/lib/**` (esclusi `components/ui/`).

### E2E (Playwright)

```bash
# Avvia il backend prima:
cd server && npm run dev

# Poi dalla cartella frontend:
cd frontend
npm run e2e                       # tutti gli spec
npx playwright test smoke.spec.ts # spec singolo
npx playwright show-report        # apre il report HTML
```

Spec in `frontend/tests/e2e/`. `playwright.config.ts` avvia il dev server Vite se non è
già in ascolto su `:5173`. I test usano `baseURL: http://ente1.gestimus.local:5173`
(tenant `ente1` risolto dal sottodominio).

---

## Variabili d'ambiente (frontend)

Le variabili Vite sono prefissate `VITE_` e iniettate a build-time via `import.meta.env`.

| Variabile | Uso | Default |
|---|---|---|
| `VITE_SENTRY_DSN` | DSN Sentry (ometti per disabilitare) | — |
| `SENTRY_AUTH_TOKEN` | Upload sourcemap in CI (build-time, non `VITE_`) | — |
| `SENTRY_ORG` | Organizzazione Sentry (build-time) | — |
| `SENTRY_PROJECT` | Progetto Sentry (build-time) | — |
| `SENTRY_RELEASE` | Release tag Sentry (build-time) | — |

In dev crea `frontend/.env.local` (non committare):

```
VITE_SENTRY_DSN=
```

---

## Struttura del provider tree

```
StrictMode
  AppErrorBoundary       (Sentry ErrorBoundary + fallback UI)
    MotionConfig           (reducedMotion:'user')
      ThemeProvider        (light/dark, persiste in localStorage)
        QueryClientProvider  (TanStack Query)
          BrowserRouter
            AuthProvider   (sessione cookie, bootstrap /auth/me)
              App          (Routes)
              Toaster      (sonner)
              OfflineBanner
```
