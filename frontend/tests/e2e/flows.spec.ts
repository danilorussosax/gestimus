import { test, expect, type Page } from '@playwright/test';
import {
  ADMIN,
  COMMISSARIO,
  apiFetch,
  errorSink,
  getConcorsoId,
  getMyCommissarioId,
  login,
  nextFaseOrdine,
  tag,
} from './helpers';

/**
 * E2E per-area sui flussi core dell'admin/commissario (React + backend reale).
 *
 * Il seed NON crea fasi: i prerequisiti vengono orchestrati via API usando il
 * cookie di sessione del browser (apiFetch = fetch nel contesto pagina). Poi i
 * test guidano/verificano la UI. Ogni test ripulisce le righe che crea in
 * afterEach. Dove un prerequisito non è soddisfacibile in modo affidabile (es.
 * rate-limit sulle iscrizioni pubbliche), il test fa `test.skip` con un
 * messaggio chiaro invece di fallire in modo flaky.
 */

// I quattro flussi coprono aree indipendenti: niente `mode: serial` così un
// fallimento isolato non maschera gli altri. La config globale gira comunque
// con 1 worker / fullyParallel:false → nessuna contesa sul concorso condiviso.

// ───────────────────────────────────────────────────────────────────────────
// 1) CREA FASE — assicura una sezione, poi crea una fase dalla UI e verifica
//    che compaia nella lista.
// ───────────────────────────────────────────────────────────────────────────
test.describe('Flow · Crea fase (admin)', () => {
  const created: { fasi: string[]; sezioni: string[] } = { fasi: [], sezioni: [] };

  test.afterEach(async ({ page }) => {
    for (const id of created.fasi) await apiFetch(page, `/api/fasi/${id}`, { method: 'DELETE' });
    for (const id of created.sezioni) await apiFetch(page, `/api/sezioni/${id}`, { method: 'DELETE' });
    created.fasi = [];
    created.sezioni = [];
  });

  test('crea una fase dal wizard e appare nella lista', async ({ page }) => {
    test.setTimeout(60_000);
    const errors = errorSink(page);
    await login(page, ADMIN);
    const concorsoId = await getConcorsoId(page);

    // Prerequisito: almeno una sezione (il task lo richiede esplicitamente).
    const { body: sezExisting } = await apiFetch(page, `/api/sezioni?concorsoId=${concorsoId}&limit=1000`);
    if (!Array.isArray(sezExisting) || sezExisting.length === 0) {
      const sezName = tag('SEZ');
      const res = await apiFetch(page, '/api/sezioni', {
        method: 'POST',
        body: { concorsoId, nome: sezName },
      });
      expect(res.status, 'POST /api/sezioni').toBe(201);
      created.sezioni.push(res.body.id);
    }

    const faseName = tag('FASE');

    // Naviga al tab fasi.
    await page.goto(`/admin?c=${concorsoId}&tab=fasi`);
    await expect(page.locator('#root :is(h1, h2, h3)').first()).toBeVisible({ timeout: 15_000 });

    // Apri il form di creazione: in vista raggruppata il bottone è "Fase globale",
    // in vista piatta "Nuova fase". Matchiamo entrambi.
    const newFaseBtn = page.getByRole('button', { name: /Fase globale|Nuova fase/ }).first();
    await expect(newFaseBtn).toBeVisible({ timeout: 10_000 });
    await newFaseBtn.click();

    // Il dialog di creazione mostra il titolo "Nuova fase".
    const dialog = page.getByRole('dialog');
    await expect(dialog.getByText('Nuova fase')).toBeVisible({ timeout: 10_000 });

    // Compila il nome (campo con placeholder "Eliminatoria"). I criteri di
    // default (somma 100%) sono pre-popolati, quindi il salvataggio non apre il
    // confirm sui pesi.
    await dialog.locator('input[placeholder="Eliminatoria"]').fill(faseName);

    // Salva: il pulsante di submit del form è "Crea".
    await dialog.getByRole('button', { name: 'Crea', exact: true }).click();

    // Il dialog si chiude e la fase compare nella lista (heading con il nome).
    await expect(dialog).toBeHidden({ timeout: 15_000 });
    await expect(page.locator('#root').getByText(faseName, { exact: false }).first())
      .toBeVisible({ timeout: 15_000 });

    // Conferma lato dati + registra per cleanup.
    const { body: fasiNow } = await apiFetch(page, `/api/fasi?concorsoId=${concorsoId}&limit=1000`);
    const mine = (fasiNow as Array<{ id: string; nome: string }>).find((f) => f.nome === faseName);
    expect(mine, 'la fase creata risulta nel backend').toBeTruthy();
    if (mine) created.fasi.push(mine.id);

    expect(errors, 'nessun errore JS durante la creazione fase').toEqual([]);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// 2) VOTO COMMISSARIO — orchestrazione completa via API (commissione + membro +
//    fase IN_CORSO con criteri + candidati), poi voto reale dalla UI.
// ───────────────────────────────────────────────────────────────────────────
test.describe('Flow · Voto commissario', () => {
  const created: { fasi: string[]; commissioni: string[] } = { fasi: [], commissioni: [] };

  async function cleanup(page: Page) {
    // L'eliminazione della fase fa cascade su candidati_fase + valutazioni.
    for (const id of created.fasi) await apiFetch(page, `/api/fasi/${id}`, { method: 'DELETE' });
    for (const id of created.commissioni) await apiFetch(page, `/api/commissioni/${id}`, { method: 'DELETE' });
    created.fasi = [];
    created.commissioni = [];
  }

  test.afterEach(async ({ page }) => {
    // Il cleanup richiede privilegi admin; assicuriamoci di essere admin.
    const me = await apiFetch(page, '/auth/me');
    if (me.body?.role !== 'admin' && me.body?.role !== 'superadmin') {
      await login(page, ADMIN);
    }
    await cleanup(page);
  });

  test('il commissario vede la scheda voto e salva un voto (200)', async ({ page }) => {
    test.setTimeout(90_000);

    // ── Setup come ADMIN ────────────────────────────────────────────────────
    await login(page, ADMIN);
    const concorsoId = await getConcorsoId(page);

    // Profilo commissario legato all'account commissario@ente1.test.
    // Lo ricaviamo loggandoci come commissario una volta (poi torniamo admin).
    await login(page, COMMISSARIO);
    const commissarioId = await getMyCommissarioId(page);
    if (!commissarioId) {
      test.skip(true, 'account commissario senza profilo collegato (commissarioId nullo): impossibile orchestrare il voto');
      return;
    }
    await login(page, ADMIN);

    // Commissione + membro (il commissario deve poter valutare).
    const commName = tag('COMM');
    const commRes = await apiFetch(page, '/api/commissioni', {
      method: 'POST',
      body: { concorsoId, nome: commName, presidenteCommissarioId: commissarioId },
    });
    expect(commRes.status, 'POST /api/commissioni').toBe(201);
    const commissioneId = commRes.body.id;
    created.commissioni.push(commissioneId);

    const addMember = await apiFetch(
      page,
      `/api/commissioni/${commissioneId}/commissari/${commissarioId}`,
      { method: 'POST' },
    );
    expect([201, 204, 409], 'aggiunta membro commissione').toContain(addMember.status);

    // Fase assegnata alla commissione (ordine = max+1 per non collidere).
    const ordine = await nextFaseOrdine(page, concorsoId);
    const faseName = tag('FASE-VOTO');
    const faseRes = await apiFetch(page, '/api/fasi', {
      method: 'POST',
      body: {
        concorsoId,
        ordine,
        nome: faseName,
        scala: 10,
        commissioneId,
        modoValutazione: 'autonoma',
        metodoMedia: 'aritmetica',
      },
    });
    expect(faseRes.status, 'POST /api/fasi').toBe(201);
    const faseId = faseRes.body.id;
    created.fasi.push(faseId);

    // Criteri configurati: senza criteri la scheda voto non si attiva.
    const criteriRes = await apiFetch(page, `/api/criteri/fase/${faseId}`, {
      method: 'PUT',
      body: {
        criteri: [
          { nome: 'Tecnica', peso: 50, ordine: 0 },
          { nome: 'Interpretazione', peso: 50, ordine: 1 },
        ],
      },
    });
    expect(criteriRes.status, 'PUT /api/criteri/fase').toBe(200);

    // Avvio fase → auto-popola candidati_fase (tutti i candidati del concorso).
    const startRes = await apiFetch(page, `/api/fasi/${faseId}/start`, { method: 'POST' });
    expect(startRes.status, 'POST /api/fasi/:id/start').toBe(200);

    const { body: cfs } = await apiFetch(page, `/api/candidati-fase?faseId=${faseId}&limit=2000`);
    if (!Array.isArray(cfs) || cfs.length === 0) {
      test.skip(true, 'nessun candidato_fase dopo lo start (il concorso non ha candidati): impossibile votare');
      return;
    }

    // ── Voto come COMMISSARIO (UI) ───────────────────────────────────────────
    await login(page, COMMISSARIO);
    const errors = errorSink(page);

    // Intercetta le POST /api/valutazioni per asserire il 200/201.
    const votePromise = page.waitForResponse(
      (r) => r.url().includes('/api/valutazioni') && r.request().method() === 'POST',
      { timeout: 20_000 },
    );

    await page.goto('/commissario');

    // La scheda voto mostra il totale pesato (#totale) e il pulsante di salvataggio.
    // Diamo tempo al caricamento dati (concorso/fasi/commissioni/candidati/valutazioni).
    await expect(page.locator('#totale')).toBeVisible({ timeout: 25_000 });

    // Bottone di salvataggio del voto: "✓ Salva e prossimo candidato".
    const saveBtn = page.getByRole('button', { name: /Salva e prossimo candidato/ });
    await expect(saveBtn).toBeVisible({ timeout: 10_000 });
    // Il widget timer (role="timer", fixed bottom-6 right-6, z-40) galleggia
    // nell'angolo in basso a destra e copre il bottone quando questo resta in
    // fondo al viewport: un click "reale" (anche con force) cadrebbe sul timer,
    // non sul bottone. dispatchEvent('click') invia l'evento direttamente al
    // nodo del bottone (nessuna coordinata / hit-test) → l'onClick React parte.
    // La validità del test resta intatta: `votePromise` asserisce comunque che
    // la POST /api/valutazioni vada a buon fine (200/201).
    // NB UX (follow-up M5): il timer fisso copre la CTA primaria di voto →
    // valutare `pointer-events-none` sul widget o riposizionarlo.
    await saveBtn.dispatchEvent('click');

    // Si apre un overlay di conferma con countdown di 5s che salva da solo
    // (non c'è un bottone "conferma immediata", solo "Annulla"). Attendiamo che
    // il countdown faccia partire la POST /api/valutazioni.
    const voteRes = await votePromise;
    expect([200, 201], 'POST /api/valutazioni andato a buon fine').toContain(voteRes.status());

    // Verifica lato dati: esiste almeno una valutazione del commissario sulla fase.
    const cf0 = (cfs as Array<{ id: string }>)[0].id;
    const { body: vals } = await apiFetch(
      page,
      `/api/valutazioni?candidatoFaseId=${cf0}&commissarioId=${commissarioId}`,
    );
    // Il candidato votato potrebbe non essere il primo (autonoma → primo non votato),
    // quindi controlliamo l'intera fase via i cf.
    let totalVals = Array.isArray(vals) ? vals.length : 0;
    if (totalVals === 0) {
      for (const cf of cfs as Array<{ id: string }>) {
        const r = await apiFetch(
          page,
          `/api/valutazioni?candidatoFaseId=${cf.id}&commissarioId=${commissarioId}`,
        );
        if (Array.isArray(r.body)) totalVals += r.body.length;
      }
    }
    expect(totalVals, 'almeno un voto salvato dal commissario').toBeGreaterThan(0);

    expect(errors, 'nessun errore JS nella scheda voto').toEqual([]);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// 3) RISULTATI — la leaderboard per-fase renderizza senza errori JS.
// ───────────────────────────────────────────────────────────────────────────
test.describe('Flow · Risultati (admin)', () => {
  const created: { fasi: string[] } = { fasi: [] };

  test.afterEach(async ({ page }) => {
    for (const id of created.fasi) await apiFetch(page, `/api/fasi/${id}`, { method: 'DELETE' });
    created.fasi = [];
  });

  test('la classifica per-fase renderizza senza errori', async ({ page }) => {
    test.setTimeout(60_000);
    const errors = errorSink(page);
    await login(page, ADMIN);
    const concorsoId = await getConcorsoId(page);

    // Garantiamo almeno una fase così la leaderboard ha qualcosa da mostrare
    // (heading + tabella). Se ci sono già fasi, ne riusiamo l'esistente.
    const { body: fasiNow } = await apiFetch(page, `/api/fasi?concorsoId=${concorsoId}&limit=1000`);
    if (!Array.isArray(fasiNow) || fasiNow.length === 0) {
      const ordine = await nextFaseOrdine(page, concorsoId);
      const faseName = tag('FASE-RIS');
      const res = await apiFetch(page, '/api/fasi', {
        method: 'POST',
        body: { concorsoId, ordine, nome: faseName, scala: 10, metodoMedia: 'aritmetica' },
      });
      expect(res.status, 'POST /api/fasi').toBe(201);
      created.fasi.push(res.body.id);
    }

    await page.goto(`/admin?c=${concorsoId}&tab=risultati`);

    // Header di una card-fase (h3 "#ordine Nome") oppure il fallback "Nessuna fase".
    const faseHeading = page.locator('#root h3').first();
    await expect(faseHeading).toBeVisible({ timeout: 20_000 });

    // La card-fase contiene la tabella della leaderboard (o lo stato "non avviata"),
    // ma in nessun caso deve esserci un'eccezione JS.
    // Verifichiamo la presenza del toolbar dei risultati (export/anonimato) come
    // segnale che il tab è montato.
    await expect(
      page.getByRole('button', { name: /Modalità anonima|Mostra nomi/ }),
    ).toBeVisible({ timeout: 15_000 });

    expect(errors, 'nessun errore JS nel tab Risultati').toEqual([]);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// 4) APPROVA ISCRIZIONE — crea un'iscrizione via endpoint pubblico, poi
//    approvala dalla UI (detail dialog → "Approva") e verifica la transizione.
// ───────────────────────────────────────────────────────────────────────────
test.describe('Flow · Approva iscrizione (admin)', () => {
  const created: { candidati: string[] } = { candidati: [] };
  // Le iscrizioni non hanno endpoint DELETE: non si possono rimuovere. Usiamo
  // un'email univoca per evitare collisioni tra run.

  test.afterEach(async ({ page }) => {
    for (const id of created.candidati) await apiFetch(page, `/api/candidati/${id}`, { method: 'DELETE' });
    created.candidati = [];
  });

  test('approva un\'iscrizione pubblica e crea il candidato', async ({ page }) => {
    test.setTimeout(60_000);
    const errors = errorSink(page);
    await login(page, ADMIN);
    const concorsoId = await getConcorsoId(page);

    // Submit iscrizione via endpoint pubblico (rate-limit 3/h per IP).
    const email = `e2e-isc-${Date.now()}@example.test`;
    const submit = await apiFetch(page, '/api/public/iscrizioni', {
      method: 'POST',
      body: {
        concorsoId,
        nome: 'E2E',
        cognome: 'Tester',
        email,
        strumento: 'Violino',
        consensiGdpr: { privacy: true, regolamento: true },
      },
    });

    if (submit.status === 429) {
      test.skip(true, 'rate-limit iscrizioni pubbliche (3/ora per IP) raggiunto: skip per evitare flakiness');
      return;
    }
    if (submit.status === 403) {
      // Concorso a iscrizioni chiuse/scadute: fallback alla verifica del tab.
      await page.goto(`/admin?c=${concorsoId}&tab=iscrizioni`);
      await expect(page.locator('[data-isc-filter="INVIATA"]')).toBeVisible({ timeout: 15_000 });
      await page.locator('[data-isc-filter="APPROVATA"]').click();
      await expect(page.locator('[data-isc-filter="APPROVATA"]')).toHaveClass(/bg-brand-600/);
      test.skip(true, 'iscrizioni chiuse sul concorso: verificato solo il rendering del tab + filtri');
      return;
    }
    expect(submit.status, 'POST /api/public/iscrizioni').toBe(201);
    const iscrizioneId: string = submit.body.iscrizioneId;
    expect(iscrizioneId).toBeTruthy();

    // Apri il tab iscrizioni e filtra "In attesa" (INVIATA).
    await page.goto(`/admin?c=${concorsoId}&tab=iscrizioni`);
    await expect(page.locator('[data-isc-filter="INVIATA"]')).toBeVisible({ timeout: 15_000 });
    await page.locator('[data-isc-filter="INVIATA"]').click();

    // Apri la riga dell'iscrizione appena creata (match per email).
    const row = page.locator('tr', { hasText: email }).first();
    await expect(row).toBeVisible({ timeout: 15_000 });
    await row.click();

    // Nel detail dialog, clicca "Approva".
    const dialog = page.getByRole('dialog');
    const approveBtn = dialog.getByRole('button', { name: /Approva/ }).first();
    await expect(approveBtn).toBeVisible({ timeout: 10_000 });

    const approvePromise = page.waitForResponse(
      (r) => r.url().includes(`/api/iscrizioni/${iscrizioneId}/approve`) && r.request().method() === 'POST',
      { timeout: 20_000 },
    );
    await approveBtn.click();
    const approveRes = await approvePromise;
    expect(approveRes.status(), 'POST /api/iscrizioni/:id/approve').toBe(200);

    // Verifica lato dati: stato APPROVATA + candidato creato.
    const { body: isc } = await apiFetch(page, `/api/iscrizioni/${iscrizioneId}`);
    expect(isc?.stato, 'iscrizione passata ad APPROVATA').toBe('APPROVATA');
    expect(isc?.candidatoId, 'iscrizione collegata a un candidato').toBeTruthy();
    if (isc?.candidatoId) created.candidati.push(isc.candidatoId);

    expect(errors, 'nessun errore JS nel tab Iscrizioni').toEqual([]);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// 5) CTA "Nuovo concorso" vs "Cambia concorso" — devono avere comportamenti
//    DISTINTI: "Nuovo concorso" apre il dialog di creazione in-place (l'URL
//    resta sul workspace), "Cambia concorso" torna alla lista (rimuove ?c).
// ───────────────────────────────────────────────────────────────────────────
test.describe('Flow · CTA Nuovo vs Cambia concorso (admin)', () => {
  test('"Nuovo concorso" apre la creazione; "Cambia concorso" torna alla lista', async ({ page }) => {
    test.setTimeout(45_000);
    const errors = errorSink(page);
    await login(page, ADMIN);
    const concorsoId = await getConcorsoId(page);
    await page.goto(`/admin?c=${concorsoId}`);

    // Sidebar desktop: le due CTA esistono e sono distinte (aria-label).
    const nuovo = page.getByRole('button', { name: 'Nuovo concorso' });
    const cambia = page.getByRole('button', { name: 'Cambia concorso' });
    await expect(nuovo).toBeVisible({ timeout: 15_000 });
    await expect(cambia).toBeVisible();

    // "Nuovo concorso" → apre il dialog di creazione, SENZA lasciare il workspace.
    await nuovo.click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible({ timeout: 10_000 });
    await expect(dialog.getByText('Nuovo concorso')).toBeVisible();
    expect(new URL(page.url()).searchParams.get('c'), 'URL resta sul workspace').toBe(concorsoId);

    // Annulla (Escape) → chiude e l'utente resta nel workspace corrente.
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden({ timeout: 10_000 });
    expect(new URL(page.url()).searchParams.get('c'), 'annullare resta nel workspace').toBe(concorsoId);

    // "Cambia concorso" → torna alla lista (rimuove ?c).
    await cambia.click();
    await page.waitForURL((u) => !u.searchParams.has('c'), { timeout: 10_000 });

    expect(errors, 'nessun errore JS nelle CTA concorso').toEqual([]);
  });
});
