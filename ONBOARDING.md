# Onboarding — Gestimus (dev)

Setup di sviluppo locale. Stack: **server** Node ≥22 + Fastify + Postgres + Drizzle (`:4000`), **frontend** React 19 + Vite + Tailwind (`:5173`). Multitenant: il tenant è risolto dal **sottodominio** (`ente1.gestimus.local`, `platform.gestimus.local`, …).

## 1. Prerequisiti
- Node ≥ 22, Postgres in locale, su macOS Homebrew (per il dev-proxy).
- `git clone` + `npm ci` in `server/` e in `frontend/`.

## 2. Variabili d'ambiente
Copia `server/.env.example` → `server/.env` e compila almeno:
- `DATABASE_URL_APP`, `DATABASE_URL_SUPER` (+ `DATABASE_URL_DIRECT` se usi PgBouncer)
- `SESSION_COOKIE_SECRET`, `GESTIMUS_SECRET_KEY` (≥ 32 caratteri)
- `SUPERADMIN_SUBDOMAIN=platform` (default)
- opzionale: `SENTRY_DSN` (error tracking; assente = no-op)

## 3. Database
```bash
cd server
npm run db:bootstrap     # crea ruoli gestimus_app/gestimus_super + db (una volta)
npm run db:setup         # db:push (schema) + db:policies (RLS)
npm run db:seed          # dati demo (2 tenant + superadmin + seed piani)
npm run db:sql:baseline  # allinea il ledger migrazioni su un DB esistente
```
Migrazioni incrementali (`server/scripts/migrations/*.sql`) e rollback:
```bash
npm run db:sql:status    # cosa è applicato / pending
npm run db:sql:up        # applica le nuove
npm run db:sql:down      # rollback ultima (usa il `.down.sql` corrispondente)
npm run db:backup        # snapshot pg_dump (lo stesso del timer systemd in prod)
```

## 4. Avvio dev server
```bash
cd server   && npm run dev    # Fastify :4000
cd frontend && npm run dev    # Vite   :5173
```

## 5. Accesso — dev-proxy (consigliato)

> ⚠️ **Non usare `localhost`.** Il backend risolve il tenant dal sottodominio: su `localhost` `/auth/*` e `/api/*` rispondono **400** → login fallisce, admin/display vuoti. Usa sempre un sottodominio `*.gestimus.local`.

Lo script `scripts/dev-proxy.sh` mette un reverse proxy **nginx su :80** davanti ai due dev server e configura **dnsmasq** per risolvere *qualsiasi* `*.gestimus.local` → `127.0.0.1` (URL pulite, senza porta):

```bash
./scripts/dev-proxy.sh up        # auto-install nginx+dnsmasq, dnsmasq wildcard, nginx :80
```
Poi apri:
- **Admin tenant**: http://ente1.gestimus.local/  (o `ente2`)
- **Super-admin**: http://platform.gestimus.local/

Cosa fa `up`:
1. `brew install nginx dnsmasq` se mancanti.
2. dnsmasq: `address=/gestimus.local/127.0.0.1` + `/etc/resolver/gestimus.local` → tutti i sottodomini (anche tenant nuovi) risolvono a 127.0.0.1, senza toccare `/etc/hosts`.
3. nginx `:80` `server_name *.gestimus.local`, **Host preservato** → `/api /auth /uploads /healthz /readyz` a Fastify `:4000`, il resto a Vite `:5173`.

Richiede `sudo` una volta (resolver, dnsmasq su `:53`, nginx su `:80`).

Altri comandi:
```bash
./scripts/dev-proxy.sh status    # diagnostica: install, DNS, proxy, backend
./scripts/dev-proxy.sh reload    # rigenera conf nginx e ricarica
./scripts/dev-proxy.sh down      # ferma nginx (dnsmasq resta come servizio)
./scripts/dev-proxy.sh dns       # (ri)configura solo dnsmasq + resolver
```

Override via env: `BASE_DOMAIN`, `BACKEND_ADDR`, `FRONTEND_ADDR`, `LISTEN_PORT`, `AUTO_INSTALL=0`.

### Accesso senza dev-proxy (fallback)
Aggiungi a `/etc/hosts` i sottodomini (`127.0.0.1 ente1.gestimus.local` …) e apri con la porta di Vite: `http://ente1.gestimus.local:5173/`.

## 6. Credenziali demo (seed)
| Ruolo | Sottodominio | Email | Password |
|-------|--------------|-------|----------|
| Admin | ente1 | `admin@ente1.test` | `Admin123!` |
| Commissario | ente1 | `commissario@ente1.test` | `Demo123!` |
| Admin | ente2 | `admin@ente2.test` | `Admin123!` |
| Super-admin | platform | `super@platform.test` | `Super123!` |

Il super-admin accede **solo** da `platform.gestimus.local` e atterra sulla console super-admin.

## 7. Test
```bash
cd server   && npm test        # integrazione (Postgres reale)
cd frontend && npm run test    # vitest (unit)
cd frontend && npm run build   # typecheck + build SPA
```
