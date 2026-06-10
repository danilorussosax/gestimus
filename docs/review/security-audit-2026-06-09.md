# Security audit — 2026-06-09

Audit a 4 agenti paralleli (auth/middleware, routes, services/db, frontend+config)
sul codice a HEAD (commit 79cf286). Le 5 criticità della review del 2026-06-07 sono
state riverificate: tutte ancora fixate. Sotto: i fix **nuovi applicati** in questa
ondata e gli item **rinviati** con motivazione.

`npm audit` (server + frontend): 0 vulnerabilità HIGH/CRITICAL.
Verifica: `tsc -p .` + `tsc -p tsconfig.lint.json` puliti; suite server 324/324 (1 skip condizionale).

## Fix applicati

| # | Sev | File | Problema → Fix |
|---|-----|------|----------------|
| 1 | HIGH | `services/storage.ts` | Path-confinement con `startsWith(root)` (bug del prefisso: `/app/uploads-secret` passava come dentro `/app/uploads`). Nuovo helper esportato `assertInside`/`assertInsideUploads` che confronta col separatore finale. Applicato a `saveFile` e `deleteFile`. |
| 2 | HIGH | `routes/documenti.ts` (download **pubblico, no auth**) | `readFile(doc.storageKey)` su path dal DB senza confinamento → arbitrary file read se `storageKey` non prodotto da `saveFile`. Ora `assertInsideUploads()` prima della lettura → 404. |
| 3 | HIGH | `routes/iscrizioni.ts` (download allegato) | Idem su `readFile(a.path)`: confinato con `assertInsideUploads()`. |
| 4 | HIGH | `services/backup.ts` | `restoreTenant(filepath)` leggeva qualunque path (ops-only ma non imposto a runtime). Aggiunto guard: solo dentro `ARCHIVE_DIR`. |
| 5 | HIGH | `services/backup.ts` | `pruneOldBackups` cancellava ogni file oltre la retention → per un tenant hard-deleted poteva sparire l’**unica copia DR**. Ora keep-latest-per-slug (tiene sempre il backup più recente per slug) + log per cancellazione. |
| 6 | MED | `routes/auth.ts` | Consumo recovery-code non atomico (read-filter-write) → due richieste concorrenti con lo stesso codice → doppia sessione. Sostituito con UPDATE atomico `array_remove(...) WHERE $hash = ANY(...)` + `returning`. |
| 7 | MED | `routes/documenti.ts` | PATCH restituiva la riga completa **incluso `storageKey`** (path FS interno). Proiezione coerente con GET/POST (niente `storageKey`). |
| 8 | MED | `routes/platform.ts` | PATCH `/tenants/:id` e `/piani/:key` dereferenziavano `t!`/`updated!` senza guard → 500 su DELETE concorrente (TOCTOU). Ora 404 pulito. |
| 9 | MED | `env.ts` | `GESTIMUS_SECRET_KEY_PREVIOUS` (chiave master di rotazione) non era nel weak-secret guard di produzione. Aggiunta (guard salta se assente). |
| 10 | MED | `routes/smtp.ts` | Campo `from` accettava caratteri di controllo (header SMTP). Regex che rifiuta CR/LF/TAB/NUL/control. |
| 11 | MED | `routes/iscrizioni.ts` | Filtro `stato` su lista admin era `z.string()` libera (valore fuori-enum → 0 risultati silenziosi). Vincolato all’enum. |
| 12 | LOW | `app.ts` | `/readyz` (pubblico) esponeva `NODE_ENV`. Rimosso dal body. |
| 13 | LOW | `middleware/tenant.ts` | 404 riecheggiava lo slug richiesto (oracolo di enumerazione). Messaggio generico. |
| 14 | LOW | `routes/iscrizioni.ts`, `routes/candidati.ts` | `docentiPreparatori: z.array(z.string())` senza limiti (iscrizioni = endpoint pubblico). Bound `.max(20)` + elemento `.max(255)`. |

## Rinviati (con motivazione)

- **2FA enforcement (`require2faAdmin` / `require2faSuperadmin`)** — HIGH reale: i flag
  sono salvati e mostrati ma il login non li consulta (controlla solo `account.totpEnabled`).
  **NON** applicato il fix naïf (403 se admin senza TOTP): l’enrollment TOTP richiede una
  sessione autenticata (`requireAuth` su `/totp/setup`) → un 403 secco **bloccherebbe
  fuori ogni admin** di un tenant col flag attivo che non ha ancora il TOTP. Serve un
  flusso di "grace session" (sessione limitata che può solo completare l’enrollment).
  Decisione di design.

- **`uploadToken` / `emailVerificationToken` in chiaro nel DB** — HIGH: sono token
  bearer (192-bit random) salvati e confrontati in plaintext (`iscrizioni`). Sfruttabili
  solo con lettura DB (difesa-in-profondità). Fix corretto = hash SHA-256 come `session.ts`,
  ma richiede migration + invalida i token in volo. Da fare in finestra dedicata.

- **PII candidati a ruolo `commissario`** (`GET /candidati`, `/candidati-fase`) — MED:
  il commissario vede tutta l’anagrafica (CF, email, indirizzo, ecc.) ed enumera fasi
  non sue. **Verificato che il frontend Commissario consuma davvero questi endpoint**
  (`useCommissarioData`): bloccarli ad `admin` romperebbe lo scoring. Il fix corretto è
  una proiezione PII-safe per il ruolo commissario (mantiene nome/strumento/posizione),
  che cambia il contratto FE → da pianificare con il frontend.

- **Rate-limit login solo per-IP + `trustProxy:1`** (MED) e **`totp/setup` sovrascrive
  secret pending senza conferma** (MED) e **lock ottimistico su PATCH scoring fasi** (MED):
  cambi di contratto/feature non banali, fuori dallo scope "fix sicuro e concreto".

- **`Manuale.tsx` `dangerouslySetInnerHTML` + i18n `escapeValue:false`** (MED, frontend):
  attualmente non sfruttabile (stringhe locale statiche a build-time). Pattern rischioso
  solo se le traduzioni diventassero remote. Da bonificare quando si tocca quel componente.
