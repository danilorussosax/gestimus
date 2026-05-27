// Component test — IscrizioniTab (src/components/admin/IscrizioniTab.tsx).
// Workflow di approvazione iscrizioni pubbliche (admin): tabella con filtri di
// stato, dialog di dettaglio, approve (crea candidato) e reject (con motivo).
//
// Note sull'harness:
//  - sonner non ha un <Toaster> montato dal render harness, quindi i toast non
//    finiscono nel DOM: mockiamo `sonner` per spiare toast.success/toast.error
//    (è il canale di feedback success/errore del componente).
//  - Oltre alla lista, il componente carica il concorso (GET /api/concorsi/:id,
//    per il filename CSV) e, all'apertura del dettaglio, gli allegati
//    (GET /api/iscrizioni/:id/allegati): li mockiamo per non far fallire MSW
//    con onUnhandledRequest:'error'.
//  - I bottoni Approva/Rifiuta vivono DENTRO il dialog di dettaglio, che si apre
//    cliccando la riga.
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { http, HttpResponse } from 'msw';

// Mock di sonner PRIMA dell'import del componente: cattura i toast.
const toastSuccess = vi.fn();
const toastError = vi.fn();
vi.mock('sonner', () => ({
  toast: {
    success: (...a: unknown[]) => toastSuccess(...a),
    error: (...a: unknown[]) => toastError(...a),
  },
}));

import { IscrizioniTab } from '@/components/admin/IscrizioniTab';
import type { IscrizioneFull } from '@/api/iscrizioni';
import { render, screen, within, waitFor, userEvent } from '../test-utils';
import { server } from '../msw/server';
import { authedMeHandler, mockUser } from '../msw/handlers';

const CONCORSO_ID = 'cnc_1';

// ── Factory: una IscrizioneFull completa con override puntuali ────────────────
function makeIscrizione(over: Partial<IscrizioneFull> = {}): IscrizioneFull {
  return {
    id: 'isc_x',
    concorsoId: CONCORSO_ID,
    stato: 'INVIATA',
    nome: 'Mario',
    cognome: 'Rossi',
    email: 'mario.rossi@esempio.it',
    telefono: null,
    dataNascita: '1990-01-01',
    nazionalita: null,
    luogoNascita: null,
    sesso: null,
    codiceFiscale: null,
    indirizzo: null,
    citta: null,
    cap: null,
    provincia: null,
    paese: null,
    strumento: 'Violino',
    anniStudio: null,
    scuolaProvenienza: null,
    programma: [],
    docentiPreparatori: [],
    sezioneId: null,
    categoriaId: null,
    isGruppo: false,
    gruppoNome: null,
    tipoGruppo: null,
    membri: [],
    tutore: null,
    consensiGdpr: null,
    noteLibere: null,
    emailVerifiedAt: null,
    approvataAt: null,
    candidatoId: null,
    note: null,
    ipAddress: null,
    userAgent: null,
    createdAt: '2026-05-01T10:00:00.000Z',
    updatedAt: '2026-05-01T10:00:00.000Z',
    ...over,
  };
}

// Set di righe in stati diversi usato dalla maggior parte dei test.
const ROWS: IscrizioneFull[] = [
  makeIscrizione({ id: 'isc_inviata', nome: 'Anna', cognome: 'Bianchi', stato: 'INVIATA', strumento: 'Pianoforte' }),
  makeIscrizione({ id: 'isc_approvata', nome: 'Luca', cognome: 'Verdi', stato: 'APPROVATA', strumento: 'Flauto' }),
  makeIscrizione({ id: 'isc_rifiutata', nome: 'Sara', cognome: 'Neri', stato: 'RIFIUTATA', strumento: 'Viola' }),
  makeIscrizione({ id: 'isc_verificata', nome: 'Gino', cognome: 'Gialli', stato: 'EMAIL_VERIFICATA', strumento: 'Tromba' }),
];

/** Mocka gli endpoint "di contorno" (concorso + allegati) sempre necessari. */
function mockSupportingEndpoints() {
  server.use(
    authedMeHandler({ role: 'admin' }),
    http.get('*/api/concorsi/:id', () =>
      HttpResponse.json({
        id: CONCORSO_ID,
        nome: 'Concorso Test',
        anno: 2026,
        dataInizio: null,
        stato: 'ATTIVO',
        logo: null,
        anonimo: false,
        iscrizioniAperte: true,
        iscrizioniScadenza: null,
      }),
    ),
    http.get('*/api/iscrizioni/:id/allegati', () => HttpResponse.json([])),
  );
}

/** Override della lista iscrizioni. */
function mockList(rows: IscrizioneFull[]) {
  server.use(http.get('*/api/iscrizioni', () => HttpResponse.json(rows)));
}

const adminUser = { ...mockUser, role: 'admin' as const };

/** Apre il dialog di dettaglio cliccando la riga del candidato indicato. */
async function openDetail(user: ReturnType<typeof userEvent.setup>, candidato: RegExp) {
  const cell = await screen.findByText(candidato);
  const row = cell.closest('tr');
  expect(row).not.toBeNull();
  await user.click(row!);
  return screen.findByRole('dialog');
}

describe('IscrizioniTab', () => {
  beforeEach(() => {
    toastSuccess.mockClear();
    toastError.mockClear();
    mockSupportingEndpoints();
  });

  it('renders the mocked iscrizioni rows in the table', async () => {
    mockList(ROWS);
    render(<IscrizioniTab concorsoId={CONCORSO_ID} />, { auth: { user: adminUser } });

    const table = await screen.findByRole('table');
    expect(within(table).getByText('Anna Bianchi')).toBeInTheDocument();
    expect(within(table).getByText('Luca Verdi')).toBeInTheDocument();
    expect(within(table).getByText('Sara Neri')).toBeInTheDocument();
    expect(within(table).getByText('Gino Gialli')).toBeInTheDocument();

    // header riepilogo: 4 iscrizioni totali
    expect(screen.getByText(/4 iscrizioni/i)).toBeInTheDocument();
  });

  it('filters rows by status when a filter pill is selected', async () => {
    mockList(ROWS);
    const user = userEvent.setup();
    render(<IscrizioniTab concorsoId={CONCORSO_ID} />, { auth: { user: adminUser } });

    // Tutte e 4 visibili all'inizio.
    await screen.findByText('Anna Bianchi');
    expect(screen.getByText('Luca Verdi')).toBeInTheDocument();

    // Click sul pill "Approvate" (data-isc-filter="APPROVATA").
    const approvatePill = document.querySelector('[data-isc-filter="APPROVATA"]');
    expect(approvatePill).not.toBeNull();
    await user.click(approvatePill as HTMLElement);

    // Resta solo la riga APPROVATA (Luca Verdi); le altre spariscono.
    const table = screen.getByRole('table');
    expect(within(table).getByText('Luca Verdi')).toBeInTheDocument();
    expect(within(table).queryByText('Anna Bianchi')).not.toBeInTheDocument();
    expect(within(table).queryByText('Sara Neri')).not.toBeInTheDocument();
    expect(within(table).queryByText('Gino Gialli')).not.toBeInTheDocument();
  });

  it('approves an INVIATA row: POSTs to the approve endpoint with the right id and shows success', async () => {
    mockList(ROWS);

    let approveUrl = '';
    server.use(
      http.post('*/api/iscrizioni/:id/approve', ({ params }) => {
        approveUrl = String(params.id);
        return HttpResponse.json({ ok: true, candidatoId: 'cand_new' });
      }),
    );

    const user = userEvent.setup();
    render(<IscrizioniTab concorsoId={CONCORSO_ID} />, { auth: { user: adminUser } });

    const dialog = await openDetail(user, /Anna Bianchi/);
    await user.click(within(dialog).getByRole('button', { name: /Approva/i }));

    // L'endpoint approve è stato colpito con l'id corretto della riga INVIATA.
    await waitFor(() => expect(approveUrl).toBe('isc_inviata'));

    // Success: toast.success chiamato e il dialog di dettaglio si chiude.
    await waitFor(() => expect(toastSuccess).toHaveBeenCalled());
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(toastError).not.toHaveBeenCalled();
  });

  it('reflects approval in the list (row badge becomes APPROVATA after refetch)', async () => {
    // La lista ritorna prima INVIATA, poi (dopo approve→invalidate) APPROVATA.
    let approved = false;
    server.use(
      http.get('*/api/iscrizioni', () =>
        HttpResponse.json([
          makeIscrizione({
            id: 'isc_inviata',
            nome: 'Anna',
            cognome: 'Bianchi',
            stato: approved ? 'APPROVATA' : 'INVIATA',
          }),
        ]),
      ),
      http.post('*/api/iscrizioni/:id/approve', () => {
        approved = true;
        return HttpResponse.json({ ok: true, candidatoId: 'cand_new' });
      }),
    );

    const user = userEvent.setup();
    render(<IscrizioniTab concorsoId={CONCORSO_ID} />, { auth: { user: adminUser } });

    // Stato iniziale: badge "In attesa" (INVIATA) nella tabella ("In attesa"
    // compare anche nel filter pill, quindi restringiamo alla <table>).
    const table = await screen.findByRole('table');
    expect(within(table).getByText('In attesa')).toBeInTheDocument();

    const dialog = await openDetail(user, /Anna Bianchi/);
    await user.click(within(dialog).getByRole('button', { name: /Approva/i }));

    // Dopo l'invalidate, la lista si ricarica e la riga mostra "Approvata".
    await waitFor(() => expect(within(table).getByText('Approvata')).toBeInTheDocument());
    expect(within(table).queryByText('In attesa')).not.toBeInTheDocument();
  });

  it('rejects an INVIATA row sending the reason in the payload', async () => {
    mockList(ROWS);

    let rejectId = '';
    let rejectBody: { reason?: string } = {};
    server.use(
      http.post('*/api/iscrizioni/:id/reject', async ({ params, request }) => {
        rejectId = String(params.id);
        rejectBody = (await request.json()) as typeof rejectBody;
        return HttpResponse.json({ ok: true });
      }),
    );

    const user = userEvent.setup();
    render(<IscrizioniTab concorsoId={CONCORSO_ID} />, { auth: { user: adminUser } });

    // Apri dettaglio della riga INVIATA → click "Rifiuta" → si apre il reject dialog.
    const detail = await openDetail(user, /Anna Bianchi/);
    await user.click(within(detail).getByRole('button', { name: /Rifiuta/i }));

    // Il reject dialog ha la textarea per il motivo.
    const reason = await screen.findByPlaceholderText(/Documentazione incompleta/i);
    await user.type(reason, 'Programma non conforme');

    await user.click(screen.getByRole('button', { name: /Rifiuta iscrizione/i }));

    // L'endpoint reject riceve l'id giusto e il motivo digitato.
    await waitFor(() => expect(rejectId).toBe('isc_inviata'));
    expect(rejectBody.reason).toBe('Programma non conforme');
    await waitFor(() => expect(toastSuccess).toHaveBeenCalled());
  });

  it('shows an error and does not mark approved when the approve endpoint fails', async () => {
    // Lista stabile: anche dopo un eventuale (errato) refetch la riga resta INVIATA.
    mockList([
      makeIscrizione({ id: 'isc_inviata', nome: 'Anna', cognome: 'Bianchi', stato: 'INVIATA' }),
    ]);

    server.use(
      http.post('*/api/iscrizioni/:id/approve', () =>
        HttpResponse.json({ error: 'Errore interno', code: 'INTERNAL' }, { status: 500 }),
      ),
    );

    const user = userEvent.setup();
    render(<IscrizioniTab concorsoId={CONCORSO_ID} />, { auth: { user: adminUser } });

    const dialog = await openDetail(user, /Anna Bianchi/);
    await user.click(within(dialog).getByRole('button', { name: /Approva/i }));

    // L'errore è segnalato via toast.error e NESSUN success. Il dialog resta
    // aperto (l'approvazione è fallita).
    await waitFor(() => expect(toastError).toHaveBeenCalled());
    expect(toastSuccess).not.toHaveBeenCalled();
    expect(screen.getByRole('dialog')).toBeInTheDocument();

    // Chiudiamo il dialog (Escape, gestito da radix) per riportare la tabella
    // nell'accessibility tree (radix marca il resto della pagina come
    // aria-hidden mentre il dialog è aperto).
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());

    // La riga NON risulta approvata: il badge nella tabella resta "In attesa"
    // (INVIATA) e non compare "Approvata".
    const table = screen.getByRole('table');
    expect(within(table).getByText('In attesa')).toBeInTheDocument();
    expect(within(table).queryByText('Approvata')).not.toBeInTheDocument();
  });
});
