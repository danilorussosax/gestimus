# Gestimus Improvement Pack

## Prompt Master

Usa questo documento come fonte unica di verità per migliorare la codebase `gestionale_concorso`. Lavora in modo incrementale, preserva i flussi critici, evita refactor distruttivi e procedi per milestone verificabili. Segui prima le priorità, poi il brief operativo, poi la checklist esecutiva. Non saltare direttamente ai refactor grandi senza prima mettere sotto controllo test e CI.

---

## Parte 1: Piano Strategico Completo

### Obiettivo

Rendere la webapp più robusta, scalabile e manutenibile senza interrompere i flussi attuali di amministrazione, commissari e iscrizioni pubbliche.

Il piano è organizzato per priorità, con focus su:

1. riduzione del rischio di regressioni
2. miglioramento delle performance percepite e reali
3. riduzione del debito tecnico sui moduli più complessi
4. pulizia UX nei punti incoerenti

### Stato attuale sintetico

Punti forti già presenti:

- architettura separata `frontend/` + `server/`
- backend con RLS, audit, 2FA, hardening HTTP e sessioni cookie HttpOnly
- CI già attiva
- suite test backend ampia
- frontend typed con React Query, i18n, PWA, Sentry

Limiti principali osservati:

- i flussi E2E critici non sono nel gate CI
- il workspace admin carica più dati del necessario
- alcuni componenti frontend sono troppo grandi e fragili da mantenere
- esiste almeno una incoerenza UX visibile nel workspace admin

### Priorità

#### P0

- mettere sotto controllo le regressioni dei flussi core
- correggere le incoerenze UX che possono generare errori d’uso

#### P1

- ridurre l’over-fetching del frontend admin
- introdurre API e query più adatte alla scala

#### P2

- rifattorizzare i moduli frontend più estesi
- migliorare typing e rimuovere soppressioni lint evitabili

#### P3

- introdurre misurazioni continue
- consolidare documentazione tecnica e criteri di qualità

### Fase 1: Stabilizzare i flussi critici in CI

#### Obiettivo

Intercettare regressioni reali su login, workspace admin, creazione fase e voto commissario prima del merge.

#### Problema da risolvere

La CI esegue typecheck, lint, unit test e build, ma non copre i flussi browser-to-backend più delicati.

#### Attività

1. Creare un job CI dedicato E2E con:
   - PostgreSQL 18
   - bootstrap DB
   - setup schema/policies
   - seed dati demo
   - avvio backend Fastify
   - avvio frontend Vite o preview buildata
   - esecuzione Playwright
2. Eliminare la dipendenza manuale da `/etc/hosts` nei test:
   - opzione preferita: usare un host locale standard e forzare l’header `Host`
   - alternativa: usare mapping Playwright o reverse proxy test-only
3. Portare in CI almeno questi flow:
   - login admin
   - apertura workspace admin
   - creazione fase
   - voto commissario
4. Separare gli E2E in:
   - smoke obbligatori
   - flow approfonditi opzionali o nightly
5. Salvare artifact utili in failure:
   - screenshot
   - trace
   - video se necessario

#### Deliverable

- job `e2e-smoke` stabile in CI
- Playwright eseguibile in ambiente pulamente riproducibile
- regressioni core bloccate prima del merge

#### Criteri di successo

- un PR che rompe creazione fase o voto commissario fallisce in CI
- nessuna configurazione manuale locale è richiesta per eseguire gli smoke test

#### Rischi

- flakiness dovuta a timing realtime o seed dati
- complessità del vincolo multitenant basato su subdomain

#### Mitigazioni

- ridurre gli smoke ai soli flussi davvero essenziali
- usare attese basate su eventi di rete e stato UI, non timeout statici
- introdurre helper test per setup dati via API

### Fase 2: Correggere le incoerenze UX ad alto impatto

#### Obiettivo

Rimuovere comportamenti che promettono un’azione e ne eseguono un’altra.

#### Problema da risolvere

Nel workspace admin, `Nuovo concorso` e `Cambia concorso` portano allo stesso comportamento. Questo genera ambiguità e riduce fiducia nell’interfaccia.

#### Attività

1. Definire il comportamento corretto di `Nuovo concorso`:
   - aprire dialog di creazione
   - oppure navigare a una vista dedicata
2. Mantenere `Cambia concorso` come ritorno alla lista.
3. Aggiornare label, aria-label e feedback utente.
4. Aggiungere test:
   - unit o integration per il routing del bottone
   - E2E minimo per il flusso di creazione

#### Deliverable

- CTA distinte e coerenti
- test di copertura sul comportamento atteso

#### Criteri di successo

- `Nuovo concorso` avvia davvero una creazione
- `Cambia concorso` riporta davvero alla selezione

### Fase 3: Ridurre l’over-fetching del workspace admin

#### Obiettivo

Ridurre numero di query, payload trasferito e lavoro inutile al primo caricamento del workspace.

#### Problema da risolvere

L’ingresso nel workspace admin attiva query multiple anche quando servono solo contatori o metadati sintetici.

#### Strategia

Spostare il frontend da un modello "carico liste intere e poi conto" a un modello "chiedo summary mirati".

#### Attività backend

1. Introdurre un endpoint summary del concorso, ad esempio:
   - `GET /api/concorsi/:id/summary`
2. Restituire almeno:
   - numero candidati
   - numero commissari
   - numero commissioni
   - numero fasi
   - numero sezioni
   - eventuali warning sintetici
3. Valutare query aggregate SQL dedicate invece di fetch di tabelle intere.
4. Aggiungere test server per:
   - correttezza conteggi
   - isolamento tenant
   - performance minima su dataset voluminosi

#### Attività frontend

1. Sostituire `useCounts()` con `useConcorsoSummary()`.
2. Evitare che tab non attive carichino dati non necessari.
3. Rimuovere dipendenze indirette pesanti dal mount iniziale.
4. Introdurre loading state mirati per sidebar/header.

#### Deliverable

- endpoint summary stabile
- minor numero di richieste al primo ingresso nel workspace
- riduzione del payload medio per caricamento admin

#### Criteri di successo

- il workspace non carica liste complete solo per mostrare badge numerici
- il numero di richieste iniziali si riduce in modo misurabile

#### KPI suggeriti

- richieste iniziali workspace: target riduzione 40-70%
- bytes scaricati al primo render admin: target riduzione significativa
- time-to-interactive percepito: migliorato

### Fase 4: Rifattorizzare i moduli frontend ad alta complessità

#### Obiettivo

Ridurre il rischio di regressione nei moduli oggi più lunghi e più difficili da modificare.

#### Moduli prioritari

- `frontend/src/components/admin/FasiTab.tsx`
- `frontend/src/pages/Commissario.tsx`
- in seconda battuta `CandidatiTab.tsx`, `CalendarioTab.tsx`, `CommissariTab.tsx`

#### Strategia

Scomporre per responsabilità, non per dimensione arbitraria.

#### Attività su `FasiTab`

1. Estrarre hook dedicati:
   - gestione dialog
   - grouping e sorting fasi
   - configurazione condivisa
   - mutazioni CRUD/sorteggio/reorder
2. Estrarre sottocomponenti:
   - toolbar
   - lista gruppo
   - dialog configurazione condivisa
   - card fase
3. Ridurre e giustificare ogni `eslint-disable react-hooks/exhaustive-deps`.
4. Formalizzare i tipi condivisi del dominio fase.

#### Attività su `Commissario`

1. Separare:
   - data loading
   - runtime fase/timer/SSE
   - logica voto
   - persistence draft
   - pannello presidente
2. Sostituire `any` e import dinamici poco tipizzati con adapter espliciti.
3. Isolare la state machine della schermata:
   - loading
   - not assigned
   - waiting
   - scoring
   - all done
4. Aggiungere test su transizioni di stato principali.

#### Deliverable

- componenti più piccoli e leggibili
- hook riusabili
- meno soppressioni lint
- maggiore facilità di test

#### Criteri di successo

- nessun file core sopra soglia critica senza motivo
- riduzione netta delle disabilitazioni lint non motivate
- nuove feature su fasi/commissario implementabili con rischio inferiore

### Fase 5: Rafforzare typing e contratti dati

#### Obiettivo

Ridurre i bridge manuali fragili tra shape backend e shape frontend.

#### Attività

1. Definire un layer esplicito di DTO e mapper per entità critiche:
   - candidati
   - fasi
   - valutazioni
   - commissioni
2. Centralizzare i mapper `raw -> ui` e `ui -> payload`.
3. Introdurre test unitari sui mapper.
4. Valutare generazione o condivisione tipizzata del contratto API.
5. Ridurre progressivamente i `eslint-disable @typescript-eslint/no-explicit-any`.

#### Deliverable

- mapping coerente e verificato
- minore fragilità quando cambia lo schema server

#### Criteri di successo

- un cambio di shape backend rompe test dedicati, non runtime silenzioso
- eliminazione dei `any` nei percorsi critici

### Fase 6: Performance e scalabilità dati

#### Obiettivo

Preparare l’app a dataset più grandi senza degradare UX e costi server.

#### Attività frontend

1. Introdurre paginazione reale o infinite query dove i volumi crescono:
   - candidati
   - iscrizioni
   - audit log
   - valutazioni, se necessario
2. Evitare limiti statici eccessivi come default universali.
3. Introdurre filtri server-driven dove oggi il filtering è solo client-side.
4. Usare query lazy per tab non attive.

#### Attività backend

1. Verificare indice e query plan per endpoint ad alto volume.
2. Esporre metadati di paginazione standard:
   - `items`
   - `total`
   - `limit`
   - `offset` o `cursor`
3. Uniformare il contratto di list endpoint.
4. Aggiungere test di carico mirati sui percorsi principali.

#### Deliverable

- API lista coerenti
- UX più fluida su concorsi grandi
- meno rischio di rallentamenti progressivi

### Fase 7: Osservabilità e baseline prestazionale

#### Obiettivo

Misurare i miglioramenti invece di valutarli solo a percezione.

#### Attività

1. Definire baseline iniziale:
   - numero richieste per pagina chiave
   - dimensione payload
   - tempo caricamento workspace admin
   - tempo primo voto commissario
2. Aggiungere logging o metriche applicative sui nuovi endpoint summary.
3. Integrare misure browser locali o synthetic.
4. Formalizzare un mini report prima/dopo per ogni intervento P1/P2.

### Fase 8: Pulizia documentazione tecnica

#### Obiettivo

Ridurre la distanza tra ciò che il codice fa e ciò che il team si aspetta.

#### Attività

1. Aggiornare documentazione developer per:
   - come eseguire E2E in locale
   - come funziona la risoluzione tenant in test
   - convenzioni query React Query
   - policy sui file troppo grandi
2. Documentare le API summary/paginazione introdotte.
3. Introdurre una checklist PR per:
   - test
   - performance
   - UX regressions
   - typing/contracts

### Sequenza consigliata di implementazione

#### Sprint 1

- correggere CTA `Nuovo concorso`
- preparare E2E smoke in locale
- progettare job CI E2E
- definire endpoint summary

#### Sprint 2

- mettere in CI gli smoke test
- implementare `useConcorsoSummary()`
- togliere il caricamento liste per i badge/contatori
- raccogliere baseline prima/dopo

#### Sprint 3

- rifattorizzare `FasiTab`
- aggiungere test mirati ai flussi fase
- ridurre i disable hook più rischiosi

#### Sprint 4

- rifattorizzare `Commissario`
- rimuovere `any` dai percorsi critici
- consolidare la state machine della schermata voto

#### Sprint 5

- paginazione e filtri server-driven
- uniformazione contratti list endpoint
- test di carico e tuning

### Roadmap per impatto vs sforzo

#### Alto impatto / sforzo basso-medio

- correggere `Nuovo concorso`
- portare smoke E2E in CI
- creare endpoint summary
- ridurre fetch iniziali del workspace

#### Alto impatto / sforzo medio-alto

- rifattorizzare `FasiTab`
- rifattorizzare `Commissario`
- uniformare paginazione e contratti lista

#### Impatto medio / sforzo medio

- pulizia typing e mapper
- documentazione tecnica e checklist PR
- metriche performance più strutturate

### Definizione di completamento

Il piano può considerarsi completato quando:

1. i flussi browser critici sono bloccanti in CI
2. il workspace admin non carica liste complete per mostrare solo contatori
3. `FasiTab` e `Commissario` sono stati separati in moduli più piccoli e testabili
4. le CTA principali sono coerenti con il comportamento reale
5. esistono metriche prima/dopo per dimostrare il miglioramento

### Azione consigliata immediata

Ordine di esecuzione raccomandato:

1. fix UX `Nuovo concorso`
2. smoke E2E in CI
3. endpoint summary + refactor workspace admin
4. refactor `FasiTab`
5. refactor `Commissario`

---

## Parte 2: Brief Operativo per Coding Agent

### Missione

Migliorare la webapp `gestionale_concorso` intervenendo in modo incrementale, sicuro e verificabile su test, performance, UX e manutenibilità.

L’agente deve lavorare per step piccoli, mantenere il sistema funzionante a ogni passaggio e verificare ogni modifica con test o controlli mirati.

### Regole operative

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

### Obiettivi prioritari

#### P0

- mettere i flussi E2E core sotto CI
- correggere la CTA `Nuovo concorso`

#### P1

- ridurre l’over-fetching del workspace admin
- introdurre un endpoint summary dedicato

#### P2

- rifattorizzare `FasiTab.tsx`
- rifattorizzare `Commissario.tsx`

#### P3

- migliorare typing, contratti dati e paginazione

### Strategia di esecuzione

L’agente deve eseguire il lavoro in questo ordine:

1. stabilizzazione test e CI
2. fix UX puntuali
3. ottimizzazione fetch e summary data
4. refactor moduli grandi
5. hardening typing e contratti
6. performance e paginazione

### Task 1: Portare gli smoke E2E in CI

#### File da analizzare

- `.github/workflows/ci.yml`
- `frontend/playwright.config.ts`
- `frontend/tests/e2e/flows.spec.ts`
- `frontend/tests/e2e/smoke.spec.ts`
- `frontend/tests/e2e/helpers.ts`

#### Cosa fare

1. Aggiungere un job CI E2E dedicato.
2. Preparare un ambiente riproducibile con DB, backend e frontend.
3. Ridurre la dipendenza da `/etc/hosts`.
4. Eseguire almeno smoke login/admin workspace e, se stabile, creazione fase e voto commissario.
5. Conservare trace e screenshot in caso di failure.

#### Acceptance criteria

- un job CI E2E compare nel workflow
- il job gira senza configurazione manuale locale
- un bug nel flusso core fa fallire la pipeline

### Task 2: Correggere `Nuovo concorso`

#### File da analizzare

- `frontend/src/pages/admin/AdminWorkspace.tsx`
- componenti correlati a creazione/selezione concorso
- `frontend/src/api/concorsi.ts`

#### Cosa fare

1. Individuare il flusso di creazione concorso già esistente o costruire il minimo necessario.
2. Distinguere semanticamente `Cambia concorso` e `Nuovo concorso`.
3. Aggiungere copertura test minima.

#### Acceptance criteria

- i due pulsanti hanno comportamenti diversi e coerenti
- il flusso di creazione è realmente raggiungibile

### Task 3: Ridurre l’over-fetching del workspace admin

#### File da analizzare

- `frontend/src/pages/admin/AdminWorkspace.tsx`
- `frontend/src/api/candidati.ts`
- `frontend/src/api/commissari.ts`
- `frontend/src/api/commissioni.ts`
- `frontend/src/api/fasi.ts`
- `frontend/src/api/sezioni.ts`
- `server/src/routes/concorsi.ts`

#### Cosa fare

1. Introdurre endpoint summary.
2. Restituire contatori minimi necessari.
3. Creare `useConcorsoSummary()`.
4. Sostituire i conteggi basati su liste complete nel workspace admin.

#### Acceptance criteria

- il workspace admin usa il summary per badge e dati sintetici
- il numero di fetch iniziali si riduce

### Task 4: Rifattorizzare `FasiTab.tsx`

#### Cosa fare

1. Estrarre grouping/sorting, dialog state, shared config e mutazioni.
2. Estrarre sottocomponenti UI.
3. Ridurre `eslint-disable react-hooks/exhaustive-deps`.
4. Mantenere invariata la UX attuale.

#### Acceptance criteria

- file principale sensibilmente più piccolo
- logica più leggibile e segmentata
- test esistenti verdi

### Task 5: Rifattorizzare `Commissario.tsx`

#### Cosa fare

1. Separare bootstrap dati, runtime fase, scoring form, persistence draft e presidente panel.
2. Ridurre o eliminare `any` nei percorsi critici.
3. Rendere le transizioni di stato più esplicite.

#### Acceptance criteria

- file principale più corto e meno accoppiato
- minore uso di `any`
- nessun cambiamento funzionale indesiderato nel voto

### Task 6: Migliorare typing e mapper

#### Cosa fare

1. Identificare entità con mapper complessi.
2. Centralizzare i mapper `raw -> ui` e `ui -> payload`.
3. Aggiungere test unitari ai mapper.

### Task 7: Paginazione e contratti lista

#### Cosa fare

1. Uniformare il contratto degli endpoint lista.
2. Introdurre paginazione reale almeno su una lista critica end-to-end.
3. Fare rollout graduale con compatibilità temporanea se serve.

### Standard di qualità richiesti

Per ogni task completato, l’agente deve:

1. eseguire i controlli minimi rilevanti
2. spiegare cosa ha cambiato
3. indicare rischi residui
4. non lasciare modifiche parziali non coerenti

### Output atteso dall’agente

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

## Parte 3: Checklist Esecutiva Multi-Turno

### Regole globali

- lavora in ordine, non saltare direttamente ai refactor grandi
- ogni milestone deve lasciare il progetto in stato coerente
- dopo ogni milestone esegui verifiche minime
- non toccare sicurezza, auth o multitenancy senza necessità esplicita
- non introdurre nuove librerie se non strettamente necessario

### Ordine di esecuzione obbligatorio

1. `M1` stabilizzare E2E e CI
2. `M2` correggere UX `Nuovo concorso`
3. `M3` introdurre summary endpoint e ridurre over-fetching
4. `M4` rifattorizzare `FasiTab.tsx`
5. `M5` rifattorizzare `Commissario.tsx`
6. `M6` consolidare typing e mapper
7. `M7` introdurre paginazione e contratti lista coerenti

### M1 - E2E e CI

#### Checklist

- leggere `.github/workflows/ci.yml`
- leggere `frontend/playwright.config.ts`
- leggere `frontend/tests/e2e/smoke.spec.ts`
- leggere `frontend/tests/e2e/flows.spec.ts`
- capire come backend, DB e tenant vengono preparati nei test
- progettare un job CI E2E riproducibile
- rimuovere o ridurre la dipendenza da `/etc/hosts`
- aggiungere artifact utili in caso di failure

#### Done quando

- esiste un job CI E2E
- il job è riproducibile
- almeno uno smoke browser blocca il merge se fallisce

#### Prompt da dare all’agente

```text
Analizza l’attuale setup CI ed E2E della webapp. Implementa un job CI riproducibile che esegua almeno gli smoke test browser sui flussi core, riducendo la dipendenza da configurazioni manuali locali. Mantieni l’intervento piccolo, motiva le scelte e verifica tutto ciò che modifichi.
```

### M2 - Fix UX Nuovo Concorso

#### Checklist

- leggere `frontend/src/pages/admin/AdminWorkspace.tsx`
- individuare il comportamento attuale dei pulsanti
- trovare il flusso già esistente di creazione concorso
- differenziare semanticamente le CTA

#### Done quando

- `Nuovo concorso` avvia veramente una creazione o porta alla vista giusta
- `Cambia concorso` torna alla selezione

#### Prompt da dare all’agente

```text
Analizza il workspace admin e correggi la CTA "Nuovo concorso", che oggi non è coerente con il comportamento reale. Mantieni il fix piccolo, non cambiare la UX più del necessario e aggiungi copertura minima sul comportamento corretto.
```

### M3 - Summary endpoint e riduzione over-fetching

#### Checklist

- leggere i moduli API admin e `AdminWorkspace.tsx`
- confermare dove nasce l’over-fetching
- introdurre endpoint summary
- creare `useConcorsoSummary()`
- sostituire i conteggi ottenuti da liste complete

#### Done quando

- il workspace usa summary data per badge/header
- non carica liste complete solo per contare elementi

#### Prompt da dare all’agente

```text
Analizza l’over-fetching del workspace admin e introduci un endpoint summary dedicato per i contatori sintetici del concorso. Aggiorna il frontend affinché non carichi liste complete quando servono solo badge e metadati. Preserva i contratti esistenti dove non necessario cambiarli.
```

### M4 - Refactor FasiTab

#### Checklist

- leggere completamente `frontend/src/components/admin/FasiTab.tsx`
- individuare aree logiche separabili
- estrarre hook locali o moduli
- estrarre sottocomponenti UI
- ridurre disable dei hook

#### Done quando

- il file è più piccolo e più leggibile
- le responsabilità sono distribuite in modo chiaro

#### Prompt da dare all’agente

```text
Rifattorizza incrementalmente FasiTab.tsx senza cambiarne il comportamento. Estrai hook e sottocomponenti per separare grouping, dialog, configurazione condivisa e mutazioni. Riduci i disable dei hook dove possibile e verifica i flussi principali dopo ogni passaggio.
```

### M5 - Refactor Commissario

#### Checklist

- leggere completamente `frontend/src/pages/Commissario.tsx`
- leggere hook e moduli runtime/scoring collegati
- separare bootstrap dati, timer/runtime, scoring form, draft persistence e presidente panel
- esplicitare la state machine
- ridurre i `any`

#### Done quando

- la pagina è più modulare
- il flusso commissario rimane stabile

#### Prompt da dare all’agente

```text
Rifattorizza incrementalmente la pagina Commissario separando runtime fase, timer, scoring, persistence draft e pannello presidente. Non cambiare il comportamento utente. Riduci l’uso di any nei percorsi critici e verifica il flusso reale di voto.
```

### M6 - Typing e mapper

#### Checklist

- analizzare i moduli `frontend/src/api/*.ts` più fragili
- partire da `frontend/src/api/candidati.ts`
- centralizzare mapper critici
- aggiungere test unitari

#### Done quando

- i mapper critici sono centralizzati
- esistono test dedicati ai contratti più delicati

#### Prompt da dare all’agente

```text
Analizza i bridge dati tra backend e frontend, partendo dai candidati. Centralizza i mapper più fragili, aggiungi test unitari sui contratti e riduci le normalizzazioni implicite sparse nei moduli API.
```

### M7 - Paginazione e contratti lista

#### Checklist

- individuare endpoint lista con limiti statici elevati
- analizzare candidati, iscrizioni, audit
- definire contratto lista coerente
- introdurre paginazione reale almeno su una lista critica

#### Done quando

- almeno una lista critica ha paginazione vera
- il pattern è riutilizzabile per le altre

#### Prompt da dare all’agente

```text
Analizza i list endpoint principali e introduci una paginazione reale, iniziando da una lista critica ad alto volume. Definisci un contratto coerente e aggiorna il frontend in modo graduale, evitando breaking changes estese.
```

### Template di esecuzione per ogni milestone

```text
Analisi:
- cosa ho letto
- dove sta il problema

Piano:
- step 1
- step 2

Implementazione:
- file toccati
- cambiamenti principali

Verifica:
- comandi eseguiti
- esito

Rischi residui:
- punto 1
- punto 2
```

### Comandi tipici di verifica

```bash
cd frontend && npm run typecheck
cd frontend && npm run test
cd server && npm run lint
cd server && npm test
cd frontend && npm run e2e
```

### Stop conditions

L’agente deve fermarsi e chiedere conferma se:

- incontra modifiche locali conflittuali
- per completare il task servirebbe una scelta di prodotto non deducibile dal codice
- la soluzione richiede cambiare API già usate in molte aree senza strategia di compatibilità
- i test esistenti mostrano regressioni non correlate e bloccanti

### Prima istruzione consigliata da usare subito

```text
Segui il file finetuning-unified.md e inizia dalla milestone M1. Analizza CI ed E2E esistenti, implementa un job smoke browser riproducibile e fermati solo dopo aver verificato il risultato e riassunto file toccati, test eseguiti e rischi residui.
```
