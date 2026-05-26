# Piano Operativo Completo

## Obiettivo

Rendere la webapp più robusta, scalabile e manutenibile senza interrompere i flussi attuali di amministrazione, commissari e iscrizioni pubbliche.

Il piano è organizzato per priorità, con focus su:

1. riduzione del rischio di regressioni
2. miglioramento delle performance percepite e reali
3. riduzione del debito tecnico sui moduli più complessi
4. pulizia UX nei punti incoerenti

---

## Stato attuale sintetico

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

---

## Priorità

### P0

- mettere sotto controllo le regressioni dei flussi core
- correggere le incoerenze UX che possono generare errori d’uso

### P1

- ridurre l’over-fetching del frontend admin
- introdurre API e query più adatte alla scala

### P2

- rifattorizzare i moduli frontend più estesi
- migliorare typing e rimuovere soppressioni lint evitabili

### P3

- introdurre misurazioni continue
- consolidare documentazione tecnica e criteri di qualità

---

## Fase 1: Stabilizzare i flussi critici in CI

### Obiettivo

Intercettare regressioni reali su login, workspace admin, creazione fase e voto commissario prima del merge.

### Problema da risolvere

La CI esegue typecheck, lint, unit test e build, ma non copre i flussi browser-to-backend più delicati.

### Attività

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

### Deliverable

- job `e2e-smoke` stabile in CI
- Playwright eseguibile in ambiente pulamente riproducibile
- regressioni core bloccate prima del merge

### Criteri di successo

- un PR che rompe creazione fase o voto commissario fallisce in CI
- nessuna configurazione manuale locale è richiesta per eseguire gli smoke test

### Rischi

- flakiness dovuta a timing realtime o seed dati
- complessità del vincolo multitenant basato su subdomain

### Mitigazioni

- ridurre gli smoke ai soli flussi davvero essenziali
- usare attese basate su eventi di rete e stato UI, non timeout statici
- introdurre helper test per setup dati via API

---

## Fase 2: Correggere le incoerenze UX ad alto impatto

### Obiettivo

Rimuovere comportamenti che promettono un’azione e ne eseguono un’altra.

### Problema da risolvere

Nel workspace admin, `Nuovo concorso` e `Cambia concorso` portano allo stesso comportamento. Questo genera ambiguità e riduce fiducia nell’interfaccia.

### Attività

1. Definire il comportamento corretto di `Nuovo concorso`:
   - aprire dialog di creazione
   - oppure navigare a una vista dedicata
2. Mantenere `Cambia concorso` come ritorno alla lista.
3. Aggiornare label, aria-label e feedback utente.
4. Aggiungere test:
   - unit o integration per il routing del bottone
   - E2E minimo per il flusso di creazione

### Deliverable

- CTA distinte e coerenti
- test di copertura sul comportamento atteso

### Criteri di successo

- `Nuovo concorso` avvia davvero una creazione
- `Cambia concorso` riporta davvero alla selezione

---

## Fase 3: Ridurre l’over-fetching del workspace admin

### Obiettivo

Ridurre numero di query, payload trasferito e lavoro inutile al primo caricamento del workspace.

### Problema da risolvere

L’ingresso nel workspace admin attiva query multiple anche quando servono solo contatori o metadati sintetici.

### Strategia

Spostare il frontend da un modello "carico liste intere e poi conto" a un modello "chiedo summary mirati".

### Attività backend

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

### Attività frontend

1. Sostituire `useCounts()` con `useConcorsoSummary()`.
2. Evitare che tab non attive carichino dati non necessari.
3. Rimuovere dipendenze indirette pesanti dal mount iniziale.
4. Introdurre loading state mirati per sidebar/header.

### Deliverable

- endpoint summary stabile
- minor numero di richieste al primo ingresso nel workspace
- riduzione del payload medio per caricamento admin

### Criteri di successo

- il workspace non carica liste complete solo per mostrare badge numerici
- il numero di richieste iniziali si riduce in modo misurabile

### KPI suggeriti

- richieste iniziali workspace: target riduzione 40-70%
- bytes scaricati al primo render admin: target riduzione significativa
- time-to-interactive percepito: migliorato

---

## Fase 4: Rifattorizzare i moduli frontend ad alta complessità

### Obiettivo

Ridurre il rischio di regressione nei moduli oggi più lunghi e più difficili da modificare.

### Moduli prioritari

- `frontend/src/components/admin/FasiTab.tsx`
- `frontend/src/pages/Commissario.tsx`
- in seconda battuta `CandidatiTab.tsx`, `CalendarioTab.tsx`, `CommissariTab.tsx`

### Strategia

Scomporre per responsabilità, non per dimensione arbitraria.

### Attività su `FasiTab`

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

### Attività su `Commissario`

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

### Deliverable

- componenti più piccoli e leggibili
- hook riusabili
- meno soppressioni lint
- maggiore facilità di test

### Criteri di successo

- nessun file core sopra soglia critica senza motivo
- riduzione netta delle disabilitazioni lint non motivate
- nuove feature su fasi/commissario implementabili con rischio inferiore

---

## Fase 5: Rafforzare typing e contratti dati

### Obiettivo

Ridurre i bridge manuali fragili tra shape backend e shape frontend.

### Problemi da risolvere

- normalizzazioni multiple distribuite
- campi derivati frontend/backend non sempre allineati
- uso di `any` in moduli centrali

### Attività

1. Definire un layer esplicito di DTO e mapper per entità critiche:
   - candidati
   - fasi
   - valutazioni
   - commissioni
2. Centralizzare i mapper `raw -> ui` e `ui -> payload`.
3. Introdurre test unitari sui mapper.
4. Valutare generazione o condivisione tipizzata del contratto API.
5. Ridurre progressivamente i `eslint-disable @typescript-eslint/no-explicit-any`.

### Deliverable

- mapping coerente e verificato
- minore fragilità quando cambia lo schema server

### Criteri di successo

- un cambio di shape backend rompe test dedicati, non runtime silenzioso
- eliminazione dei `any` nei percorsi critici

---

## Fase 6: Performance e scalabilità dati

### Obiettivo

Preparare l’app a dataset più grandi senza degradare UX e costi server.

### Attività frontend

1. Introdurre paginazione reale o infinite query dove i volumi crescono:
   - candidati
   - iscrizioni
   - audit log
   - valutazioni, se necessario
2. Evitare limiti statici eccessivi come default universali.
3. Introdurre filtri server-driven dove oggi il filtering è solo client-side.
4. Usare query lazy per tab non attive.

### Attività backend

1. Verificare indice e query plan per endpoint ad alto volume.
2. Esporre metadati di paginazione standard:
   - `items`
   - `total`
   - `limit`
   - `offset` o `cursor`
3. Uniformare il contratto di list endpoint.
4. Aggiungere test di carico mirati sui percorsi principali.

### Deliverable

- API lista coerenti
- UX più fluida su concorsi grandi
- meno rischio di rallentamenti progressivi

### KPI suggeriti

- tempi medi list endpoint sotto soglia definita
- riduzione memoria browser su tab con molte righe
- riduzione tempi di rendering di liste grandi

---

## Fase 7: Osservabilità e baseline prestazionale

### Obiettivo

Misurare i miglioramenti invece di valutarli solo a percezione.

### Attività

1. Definire baseline iniziale:
   - numero richieste per pagina chiave
   - dimensione payload
   - tempo caricamento workspace admin
   - tempo primo voto commissario
2. Aggiungere logging o metriche applicative sui nuovi endpoint summary.
3. Integrare misure browser locali o synthetic:
   - Lighthouse per pagine chiave
   - timing custom lato client
4. Formalizzare un mini report prima/dopo per ogni intervento P1/P2.

### Deliverable

- dashboard minima o report comparativi
- decisioni basate su numeri

---

## Fase 8: Pulizia documentazione tecnica

### Obiettivo

Ridurre la distanza tra ciò che il codice fa e ciò che il team si aspetta.

### Attività

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

### Deliverable

- onboarding più rapido
- minore dipendenza da conoscenza implicita

---

## Sequenza consigliata di implementazione

### Sprint 1

- correggere CTA `Nuovo concorso`
- preparare E2E smoke in locale
- progettare job CI E2E
- definire endpoint summary

### Sprint 2

- mettere in CI gli smoke test
- implementare `useConcorsoSummary()`
- togliere il caricamento liste per i badge/contatori
- raccogliere baseline prima/dopo

### Sprint 3

- rifattorizzare `FasiTab`
- aggiungere test mirati ai flussi fase
- ridurre i disable hook più rischiosi

### Sprint 4

- rifattorizzare `Commissario`
- rimuovere `any` dai percorsi critici
- consolidare la state machine della schermata voto

### Sprint 5

- paginazione e filtri server-driven
- uniformazione contratti list endpoint
- test di carico e tuning

---

## Roadmap per impatto vs sforzo

### Alto impatto / sforzo basso-medio

- correggere `Nuovo concorso`
- portare smoke E2E in CI
- creare endpoint summary
- ridurre fetch iniziali del workspace

### Alto impatto / sforzo medio-alto

- rifattorizzare `FasiTab`
- rifattorizzare `Commissario`
- uniformare paginazione e contratti lista

### Impatto medio / sforzo medio

- pulizia typing e mapper
- documentazione tecnica e checklist PR
- metriche performance più strutturate

---

## Ownership suggerita

### Backend

- summary endpoint
- paginazione standard
- query aggregate
- supporto CI per E2E
- test server e test carico

### Frontend

- revisione workspace admin
- adozione summary query
- rifattorizzazione `FasiTab`
- rifattorizzazione `Commissario`
- correzioni UX e test browser

### Cross-cutting

- misurazioni baseline
- documentazione
- quality gate CI

---

## Definizione di completamento

Il piano può considerarsi completato quando:

1. i flussi browser critici sono bloccanti in CI
2. il workspace admin non carica liste complete per mostrare solo contatori
3. `FasiTab` e `Commissario` sono stati separati in moduli più piccoli e testabili
4. le CTA principali sono coerenti con il comportamento reale
5. esistono metriche prima/dopo per dimostrare il miglioramento

---

## Azione consigliata immediata

Ordine di esecuzione raccomandato:

1. fix UX `Nuovo concorso`
2. smoke E2E in CI
3. endpoint summary + refactor workspace admin
4. refactor `FasiTab`
5. refactor `Commissario`

Questo ordine massimizza il rapporto tra riduzione del rischio e sforzo investito.
