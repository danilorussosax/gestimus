# AI Agent Execution Checklist

## Scopo

Questo documento è pensato per un agente AI di coding che deve lavorare sulla codebase in più turni, senza perdere il focus e senza fare refactor incontrollati.

Va usato come checklist operativa sequenziale.

---

## Regole globali

- lavora in ordine, non saltare direttamente ai refactor grandi
- ogni milestone deve lasciare il progetto in stato coerente
- dopo ogni milestone esegui verifiche minime
- non toccare sicurezza, auth o multitenancy senza necessità esplicita
- non introdurre nuove librerie se non strettamente necessario
- se trovi modifiche locali in conflitto, fermati e segnala

---

## Ordine di esecuzione obbligatorio

1. `M1` stabilizzare E2E e CI
2. `M2` correggere UX `Nuovo concorso`
3. `M3` introdurre summary endpoint e ridurre over-fetching
4. `M4` rifattorizzare `FasiTab.tsx`
5. `M5` rifattorizzare `Commissario.tsx`
6. `M6` consolidare typing e mapper
7. `M7` introdurre paginazione e contratti lista coerenti

---

## M1 - E2E e CI

### Obiettivo

Portare in CI gli smoke test browser sui flussi core.

### Checklist

- leggere `.github/workflows/ci.yml`
- leggere `frontend/playwright.config.ts`
- leggere `frontend/tests/e2e/smoke.spec.ts`
- leggere `frontend/tests/e2e/flows.spec.ts`
- capire come backend, DB e tenant vengono preparati nei test
- progettare un job CI E2E riproducibile
- rimuovere o ridurre la dipendenza da `/etc/hosts`
- aggiungere artifact utili in caso di failure
- eseguire almeno smoke login/admin
- includere creazione fase se stabile
- includere voto commissario solo se non flaky

### Done quando

- esiste un job CI E2E
- il job è riproducibile
- almeno uno smoke browser blocca il merge se fallisce

### Verifiche minime

- validazione workflow
- run locale del subset Playwright se possibile
- `cd frontend && npm run typecheck`
- `cd server && npm run lint`

### Prompt da dare all’agente

```text
Analizza l’attuale setup CI ed E2E della webapp. Implementa un job CI riproducibile che esegua almeno gli smoke test browser sui flussi core, riducendo la dipendenza da configurazioni manuali locali. Mantieni l’intervento piccolo, motiva le scelte e verifica tutto ciò che modifichi.
```

---

## M2 - Fix UX Nuovo Concorso

### Obiettivo

Allineare la CTA `Nuovo concorso` al comportamento reale.

### Checklist

- leggere `frontend/src/pages/admin/AdminWorkspace.tsx`
- individuare il comportamento attuale dei pulsanti
- trovare il flusso già esistente di creazione concorso, se presente
- fare in modo che `Cambia concorso` e `Nuovo concorso` abbiano semantiche diverse
- aggiungere copertura minima

### Done quando

- `Nuovo concorso` avvia veramente una creazione o porta alla vista giusta
- `Cambia concorso` torna alla selezione

### Verifiche minime

- `cd frontend && npm run typecheck`
- test mirato o E2E minimo sul comportamento

### Prompt da dare all’agente

```text
Analizza il workspace admin e correggi la CTA "Nuovo concorso", che oggi non è coerente con il comportamento reale. Mantieni il fix piccolo, non cambiare la UX più del necessario e aggiungi copertura minima sul comportamento corretto.
```

---

## M3 - Summary endpoint e riduzione over-fetching

### Obiettivo

Ridurre fetch e payload iniziali del workspace admin.

### Checklist

- leggere `frontend/src/pages/admin/AdminWorkspace.tsx`
- leggere `frontend/src/api/candidati.ts`
- leggere `frontend/src/api/commissari.ts`
- leggere `frontend/src/api/commissioni.ts`
- leggere `frontend/src/api/fasi.ts`
- leggere `frontend/src/api/sezioni.ts`
- leggere `server/src/routes/concorsi.ts`
- confermare dove nasce l’over-fetching
- introdurre endpoint summary tipo `GET /api/concorsi/:id/summary`
- restituire contatori minimi necessari
- creare `useConcorsoSummary()`
- sostituire i conteggi ottenuti da liste complete
- evitare query inutili al mount del workspace

### Done quando

- il workspace usa summary data per badge/header
- non carica liste complete solo per contare elementi

### Verifiche minime

- test server sul summary endpoint
- `cd frontend && npm run typecheck`
- `cd server && npm run lint`

### Prompt da dare all’agente

```text
Analizza l’over-fetching del workspace admin e introduci un endpoint summary dedicato per i contatori sintetici del concorso. Aggiorna il frontend affinché non carichi liste complete quando servono solo badge e metadati. Preserva i contratti esistenti dove non necessario cambiarli.
```

---

## M4 - Refactor FasiTab

### Obiettivo

Ridurre complessità e accoppiamento di `FasiTab.tsx`.

### Checklist

- leggere completamente `frontend/src/components/admin/FasiTab.tsx`
- individuare aree logiche separabili
- estrarre hook locali o moduli:
  - dialog state
  - grouping/sorting
  - shared config
  - mutazioni
- estrarre sottocomponenti UI
- ridurre `eslint-disable react-hooks/exhaustive-deps` dove possibile
- mantenere il comportamento invariato

### Done quando

- il file è più piccolo e più leggibile
- le responsabilità sono distribuite in modo chiaro
- i flussi fase continuano a funzionare

### Verifiche minime

- `cd frontend && npm run typecheck`
- `cd frontend && npm run test`
- smoke o flow fase se disponibile

### Prompt da dare all’agente

```text
Rifattorizza incrementalmente FasiTab.tsx senza cambiarne il comportamento. Estrai hook e sottocomponenti per separare grouping, dialog, configurazione condivisa e mutazioni. Riduci i disable dei hook dove possibile e verifica i flussi principali dopo ogni passaggio.
```

---

## M5 - Refactor Commissario

### Obiettivo

Separare runtime, scoring e stato UI della pagina commissario.

### Checklist

- leggere completamente `frontend/src/pages/Commissario.tsx`
- leggere `frontend/src/hooks/useFaseRuntime.ts`
- leggere `frontend/src/api/fase-runtime.ts`
- leggere `frontend/src/lib/scoring.ts`
- separare bootstrap dati, timer/runtime, scoring form, draft persistence e presidente panel
- esplicitare la state machine della pagina
- ridurre i `any` più pericolosi
- preservare il flusso di voto

### Done quando

- la pagina è più modulare
- il flusso commissario rimane stabile
- il typing migliora nei percorsi critici

### Verifiche minime

- `cd frontend && npm run typecheck`
- `cd frontend && npm run test`
- flow commissario E2E

### Prompt da dare all’agente

```text
Rifattorizza incrementalmente la pagina Commissario separando runtime fase, timer, scoring, persistence draft e pannello presidente. Non cambiare il comportamento utente. Riduci l’uso di any nei percorsi critici e verifica il flusso reale di voto.
```

---

## M6 - Typing e mapper

### Obiettivo

Rendere più espliciti i bridge dati tra backend e frontend.

### Checklist

- analizzare i moduli `frontend/src/api/*.ts` più fragili
- partire da `frontend/src/api/candidati.ts`
- identificare mapper ripetuti o impliciti
- centralizzare `raw -> ui` e `ui -> payload`
- aggiungere test unitari ai mapper
- ridurre `any` evitabili

### Done quando

- i mapper critici sono centralizzati
- esistono test dedicati ai contratti più delicati

### Verifiche minime

- `cd frontend && npm run typecheck`
- `cd frontend && npm run test`

### Prompt da dare all’agente

```text
Analizza i bridge dati tra backend e frontend, partendo dai candidati. Centralizza i mapper più fragili, aggiungi test unitari sui contratti e riduci le normalizzazioni implicite sparse nei moduli API.
```

---

## M7 - Paginazione e contratti lista

### Obiettivo

Preparare le liste principali a dataset più grandi.

### Checklist

- individuare endpoint lista con limiti statici elevati
- analizzare candidati, iscrizioni, audit
- definire un contratto lista più coerente
- introdurre paginazione reale almeno su una lista critica end-to-end
- aggiornare il frontend relativo
- evitare breaking changes massive in un solo passaggio

### Done quando

- almeno una lista critica ha paginazione vera
- il pattern è riutilizzabile per le altre

### Verifiche minime

- test server dei list endpoint modificati
- `cd frontend && npm run typecheck`
- `cd server && npm run lint`

### Prompt da dare all’agente

```text
Analizza i list endpoint principali e introduci una paginazione reale, iniziando da una lista critica ad alto volume. Definisci un contratto coerente e aggiorna il frontend in modo graduale, evitando breaking changes estese.
```

---

## Template di esecuzione per ogni milestone

L’agente deve usare questo schema:

1. analisi iniziale
2. ipotesi e rischi
3. implementazione minima
4. verifica
5. riepilogo finale

### Formato atteso

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

---

## Comandi tipici di verifica

```bash
cd frontend && npm run typecheck
cd frontend && npm run test
cd server && npm run lint
cd server && npm test
cd frontend && npm run e2e
```

Usare solo i comandi rilevanti per la milestone corrente.

---

## Stop conditions

L’agente deve fermarsi e chiedere conferma se:

- incontra modifiche locali conflittuali
- per completare il task servirebbe una scelta di prodotto non deducibile dal codice
- la soluzione richiede cambiare API già usate in molte aree senza strategia di compatibilità
- i test esistenti mostrano regressioni non correlate e bloccanti

---

## Prima istruzione consigliata da usare subito

```text
Segui il file finetuning-agent-checklist.md e inizia dalla milestone M1. Analizza CI ed E2E esistenti, implementa un job smoke browser riproducibile e fermati solo dopo aver verificato il risultato e riassunto file toccati, test eseguiti e rischi residui.
```
