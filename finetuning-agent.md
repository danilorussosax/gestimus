# AI Coding Agent Brief

## Missione

Migliorare la webapp `gestionale_concorso` intervenendo in modo incrementale, sicuro e verificabile su test, performance, UX e manutenibilità.

L’agente deve lavorare per step piccoli, mantenere il sistema funzionante a ogni passaggio e verificare ogni modifica con test o controlli mirati.

---

## Regole operative

1. Non introdurre regressioni nei flussi:
   - login
   - workspace admin
   - creazione fase
   - voto commissario
2. Non cambiare il modello di sicurezza:
   - sessioni cookie HttpOnly
   - isolamento tenant
   - RLS
   - audit
3. Non fare refactor massivi non giustificati.
4. Ogni step deve essere:
   - piccolo
   - testabile
   - reversibile
5. Prima di modificare file grandi, leggere il codice esistente e preservare il comportamento.
6. Se trovi conflitti con modifiche locali non tue, fermati e segnala il problema.

---

## Obiettivi prioritari

### P0

- mettere i flussi E2E core sotto CI
- correggere la CTA `Nuovo concorso`

### P1

- ridurre l’over-fetching del workspace admin
- introdurre un endpoint summary dedicato

### P2

- rifattorizzare `FasiTab.tsx`
- rifattorizzare `Commissario.tsx`

### P3

- migliorare typing, contratti dati e paginazione

---

## Strategia di esecuzione

L’agente deve eseguire il lavoro in questo ordine:

1. stabilizzazione test e CI
2. fix UX puntuali
3. ottimizzazione fetch e summary data
4. refactor moduli grandi
5. hardening typing e contratti
6. performance e paginazione

Non saltare direttamente ai refactor grandi se prima non sono protetti i flussi critici.

---

## Task 1: Portare gli smoke E2E in CI

### Obiettivo

Eseguire in CI almeno i flussi browser critici.

### File da analizzare

- `.github/workflows/ci.yml`
- `frontend/playwright.config.ts`
- `frontend/tests/e2e/flows.spec.ts`
- `frontend/tests/e2e/smoke.spec.ts`
- eventuali helper in `frontend/tests/e2e/helpers.ts`

### Problema attuale

I test Playwright esistono ma non sono integrati nel gate CI e dipendono da setup locale.

### Cosa fare

1. Aggiungere un job CI E2E dedicato.
2. Preparare un ambiente riproducibile con:
   - Postgres 18
   - bootstrap DB
   - setup schema
   - seed demo
   - backend avviato
   - frontend avviato o buildato
3. Ridurre la dipendenza da `/etc/hosts`.
4. Eseguire almeno:
   - smoke login
   - smoke admin workspace
   - flow creazione fase
   - flow voto commissario se stabile
5. Conservare trace e screenshot in caso di failure.

### Vincoli

- evitare test flaky
- preferire smoke ridotti ma stabili
- non introdurre dipendenze CI fragili se esiste una soluzione più semplice

### Acceptance criteria

- un job CI E2E compare nel workflow
- il job gira senza configurazione manuale locale
- un bug nel flusso core fa fallire la pipeline

### Verifica minima

- eseguire il subset Playwright localmente, se possibile
- validare sintassi workflow

---

## Task 2: Correggere `Nuovo concorso`

### Obiettivo

Allineare la CTA al comportamento reale.

### File da analizzare

- `frontend/src/pages/admin/AdminWorkspace.tsx`
- componenti correlati a creazione/selezione concorso
- `frontend/src/api/concorsi.ts`

### Problema attuale

`Nuovo concorso` e `Cambia concorso` usano lo stesso handler.

### Cosa fare

1. Individuare il flusso di creazione concorso già esistente o costruire il minimo necessario.
2. Fare in modo che:
   - `Cambia concorso` torni alla lista
   - `Nuovo concorso` apra la creazione o navighi a una vista dedicata
3. Aggiungere copertura test minima.

### Acceptance criteria

- i due pulsanti hanno comportamenti diversi e coerenti
- il flusso di creazione è realmente raggiungibile

### Verifica minima

- typecheck frontend
- test unit o E2E minimo sul comportamento CTA

---

## Task 3: Ridurre l’over-fetching del workspace admin

### Obiettivo

Non caricare liste complete quando servono solo contatori o metadati.

### File da analizzare

- `frontend/src/pages/admin/AdminWorkspace.tsx`
- `frontend/src/api/candidati.ts`
- `frontend/src/api/commissari.ts`
- `frontend/src/api/commissioni.ts`
- `frontend/src/api/fasi.ts`
- `frontend/src/api/sezioni.ts`
- `server/src/routes/concorsi.ts`
- eventuali query/servizi backend associati

### Problema attuale

`useCounts()` dipende da query multiple, inclusa `useCandidati()` che porta con sé altri fetch accessori.

### Cosa fare

1. Introdurre un endpoint summary, preferibilmente:
   - `GET /api/concorsi/:id/summary`
2. Restituire almeno:
   - `candidatiCount`
   - `commissariCount`
   - `commissioniCount`
   - `fasiCount`
   - `sezioniCount`
3. Aggiungere hook frontend `useConcorsoSummary()`.
4. Sostituire i conteggi basati su liste complete nel workspace admin.
5. Evitare il caricamento di query accessorie al mount se non servono subito.

### Vincoli

- preservare isolamento tenant
- non rompere le liste esistenti
- non cambiare inutilmente i contratti già usati altrove

### Acceptance criteria

- il workspace admin usa il summary per i badge e i dati sintetici
- il numero di fetch iniziali si riduce
- nessuna regressione visibile nei contatori

### Verifica minima

- test server sul nuovo endpoint
- typecheck frontend/server
- confronto richieste iniziali prima/dopo se possibile

---

## Task 4: Rifattorizzare `FasiTab.tsx`

### Obiettivo

Ridurre complessità e fragilità senza cambiare il comportamento utente.

### File da analizzare

- `frontend/src/components/admin/FasiTab.tsx`
- moduli API collegati
- test esistenti sulle fasi

### Cosa fare

1. Identificare sottodomini logici:
   - grouping/sorting
   - dialog creazione/modifica
   - configurazione condivisa
   - mutazioni CRUD
   - sorteggio e reorder
2. Estrarre hook e sottocomponenti con responsabilità chiare.
3. Ridurre `eslint-disable react-hooks/exhaustive-deps` dove possibile.
4. Mantenere invariata la UX attuale, salvo fix espliciti.

### Vincoli

- niente rewrite totale
- ogni estrazione deve essere validata subito
- mantenere naming coerente con il dominio esistente

### Acceptance criteria

- file principale sensibilmente più piccolo
- logica più leggibile e segmentata
- test esistenti verdi

### Verifica minima

- typecheck frontend
- unit test frontend
- E2E creazione/modifica fase se disponibile

---

## Task 5: Rifattorizzare `Commissario.tsx`

### Obiettivo

Separare logica di runtime, scoring e stato UI per ridurre il rischio di regressioni.

### File da analizzare

- `frontend/src/pages/Commissario.tsx`
- `frontend/src/hooks/useFaseRuntime.ts`
- `frontend/src/api/fase-runtime.ts`
- `frontend/src/api/valutazioni.ts`
- `frontend/src/lib/scoring.ts`

### Cosa fare

1. Separare la pagina in blocchi:
   - bootstrap dati
   - runtime fase/timer
   - scoring form
   - draft persistence
   - presidente panel
   - state machine schermata
2. Ridurre o eliminare `any` nei percorsi critici.
3. Rendere le transizioni di stato più esplicite.
4. Aggiungere test alle transizioni principali, se mancano.

### Acceptance criteria

- file principale più corto e meno accoppiato
- minore uso di `any`
- nessun cambiamento funzionale indesiderato nel voto

### Verifica minima

- typecheck frontend
- test esistenti su scoring/voto
- flow E2E commissario

---

## Task 6: Migliorare typing e mapper

### Obiettivo

Ridurre le normalizzazioni implicite e i bridge fragili tra backend e frontend.

### File da analizzare

- `frontend/src/api/candidati.ts`
- altri moduli `frontend/src/api/*.ts`
- `frontend/src/types/index.ts`
- route backend corrispondenti

### Cosa fare

1. Identificare entità con mapper complessi.
2. Centralizzare i mapper `raw -> ui` e `ui -> payload`.
3. Aggiungere test unitari sui mapper.
4. Rimuovere `any` evitabili.

### Acceptance criteria

- mapping più esplicito
- test dedicati ai contratti più fragili
- meno logica di normalizzazione dispersa

---

## Task 7: Paginazione e contratti lista

### Obiettivo

Preparare le liste principali a dataset più grandi.

### File da analizzare

- endpoint server delle liste principali
- hook frontend di:
   - candidati
   - iscrizioni
   - audit
   - valutazioni dove utile

### Cosa fare

1. Uniformare il contratto degli endpoint lista.
2. Valutare formato comune:
   - `items`
   - `total`
   - `limit`
   - `offset` o `cursor`
3. Introdurre paginazione reale dove oggi ci sono limiti statici alti.
4. Aggiornare i consumer frontend più importanti.

### Vincoli

- fare rollout graduale
- non rompere tutte le API in una volta
- se necessario introdurre compatibilità temporanea

### Acceptance criteria

- almeno una lista critica usa paginazione reale end-to-end
- struttura più coerente tra endpoint

---

## Standard di qualità richiesti

Per ogni task completato, l’agente deve:

1. eseguire i controlli minimi rilevanti
2. spiegare cosa ha cambiato
3. indicare rischi residui
4. non lasciare modifiche parziali non coerenti

Controlli tipici:

- `cd frontend && npm run typecheck`
- `cd frontend && npm run test`
- `cd server && npm run lint`
- test mirati server
- test Playwright dove applicabile

---

## Output atteso dall’agente

Per ogni task, l’agente deve produrre:

1. breve analisi iniziale
2. implementazione
3. verifica
4. riepilogo finale con:
   - file toccati
   - comportamento modificato
   - test eseguiti
   - eventuali limiti o follow-up

---

## Cose da non fare

- non riscrivere interi moduli solo per “pulizia”
- non cambiare sicurezza/sessioni/auth senza motivo
- non introdurre librerie nuove se non strettamente necessarie
- non rompere il modello multitenant
- non rimuovere test perché instabili: prima provare a stabilizzarli

---

## Prima task raccomandata

L’agente deve iniziare da:

1. analisi workflow CI ed E2E
2. implementazione smoke E2E in CI
3. fix `Nuovo concorso`

Solo dopo deve passare a summary endpoint e refactor strutturali.
