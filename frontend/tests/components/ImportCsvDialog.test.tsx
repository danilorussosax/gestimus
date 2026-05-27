// Component test — ImportCsvDialog (src/components/admin/ImportCsvDialog.tsx),
// kind="candidati": flusso bulk-import da CSV (file upload → parse → anteprima
// dry-run → feedback validazione/righe scartate → conferma import → success/errore).
//
// Auth iniettata via `auth: { user: admin }` (nessuna rete per l'AuthProvider).
// La risoluzione sezione/categoria (GET /api/sezioni, /api/categorie) e la
// creazione per-riga (POST /api/candidati) sono mockate per-test con
// server.use(...). Il parser CSV puro (lib/csv-import) ha già i suoi unit test:
// qui si testa SOLO il comportamento del componente (file handling, anteprima
// UI, feedback errori, submit). sonner è mockato per ispezionare i toast.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { http, HttpResponse } from 'msw';

import ImportCsvDialog from '@/components/admin/ImportCsvDialog';
import { render, screen, within, waitFor, userEvent } from '../test-utils';
import { server } from '../msw/server';
import { mockUser } from '../msw/handlers';

// sonner non ha un <Toaster /> nel harness di test → mockiamo l'API toast per
// asserire successo/errore senza dipendere dal rendering del portal.
const toastMock = vi.hoisted(() => ({
  success: vi.fn(),
  error: vi.fn(),
  warning: vi.fn(),
}));
vi.mock('sonner', () => ({ toast: toastMock }));

const admin = { ...mockUser, role: 'admin' as const };
const CONCORSO_ID = 'cnc_test_1';

// Sezioni/categorie del concorso usate per risolvere i nomi nel CSV.
const SEZIONI = [{ id: 'sez_1', nome: 'Pianoforte' }];
const CATEGORIE = [{ id: 'cat_1', nome: 'Junior', sezioneId: 'sez_1' }];

// CSV valido: header riconosciuto + 2 righe dati valide.
const VALID_CSV = [
  'nome,cognome,strumento,data_nascita,nazionalita,sezione,categoria',
  'Anna,Rossi,Pianoforte,2002-04-15,Italiana,Pianoforte,Junior',
  'Marco,Bianchi,Violino,2003-06-15,Italiana,,',
].join('\n');

function makeFile(text: string, name = 'candidati.csv') {
  return new File([text], name, { type: 'text/csv' });
}

function renderDialog(extra?: { onOpenChange?: () => void; onDone?: () => void }) {
  const onOpenChange = vi.fn(extra?.onOpenChange);
  const onDone = vi.fn(extra?.onDone);
  const utils = render(
    <ImportCsvDialog
      concorsoId={CONCORSO_ID}
      kind="candidati"
      open
      onOpenChange={onOpenChange}
      onDone={onDone}
    />,
    { auth: { user: admin } },
  );
  return { ...utils, onOpenChange, onDone };
}

/** Mock di base per gli endpoint di lookup usati durante l'import. */
function mockLookups() {
  server.use(
    http.get('*/api/sezioni', () => HttpResponse.json(SEZIONI)),
    http.get('*/api/categorie', () => HttpResponse.json(CATEGORIE)),
  );
}

// L'input file è nascosto (class="hidden") senza label accessibile: lo
// recuperiamo per tipo dal container del dialog.
function getFileInput(): HTMLInputElement {
  const input = document.querySelector('input[type="file"]');
  if (!input) throw new Error('file input non trovato');
  return input as HTMLInputElement;
}

beforeEach(() => {
  toastMock.success.mockReset();
  toastMock.error.mockReset();
  toastMock.warning.mockReset();
});

describe('ImportCsvDialog (candidati)', () => {
  it('mostra titolo e hint colonne all\'apertura', () => {
    renderDialog();
    expect(
      screen.getByRole('heading', { name: /importa candidati da csv/i }),
    ).toBeInTheDocument();
    // L'hint descrive le colonne attese (data dalla DialogDescription).
    expect(screen.getByText(/colonne:\s*nome\*/i)).toBeInTheDocument();
    // Nessuna anteprima e import disabilitato finché non si analizza un CSV.
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^importa/i })).toBeDisabled();
  });

  it('caricare un CSV valido mostra l\'anteprima delle righe parse-ate', async () => {
    const user = userEvent.setup();
    renderDialog();

    await user.upload(getFileInput(), makeFile(VALID_CSV));

    // FileReader/await file.text() è async → attendiamo la tabella anteprima.
    const table = await screen.findByRole('table');
    // Le righe dati compaiono con i valori normalizzati.
    expect(within(table).getByText('Anna')).toBeInTheDocument();
    expect(within(table).getByText('Rossi')).toBeInTheDocument();
    expect(within(table).getByText('Marco')).toBeInTheDocument();
    // Riepilogo separatore + conteggio righe valide.
    expect(screen.getByText(/2 righe · 2 valide/i)).toBeInTheDocument();
    // Con righe valide il bottone import diventa attivo e ne riporta il numero.
    expect(screen.getByRole('button', { name: /importa\s*2/i })).toBeEnabled();
  });

  it('CSV con intestazione errata mostra errore colonne mancanti e blocca l\'import', async () => {
    const user = userEvent.setup();
    renderDialog();

    // Header che NON contiene le colonne obbligatorie (nessun alias riconosciuto).
    const badCsv = ['aaa,bbb,ccc', '1,2,3'].join('\n');
    await user.upload(getFileInput(), makeFile(badCsv, 'bad.csv'));

    // Messaggio di errore parse/validazione (colonne obbligatorie mancanti).
    expect(
      await screen.findByText(/colonne obbligatorie mancanti/i),
    ).toBeInTheDocument();
    // Nessuna anteprima e import non consentito.
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^importa/i })).toBeDisabled();
  });

  it('righe non valide (campi mancanti/data errata) sono marcate con il motivo e scartate dal conteggio', async () => {
    const user = userEvent.setup();
    renderDialog();

    // Riga 2 valida; riga 3 con data non valida e nazionalità mancante.
    const mixedCsv = [
      'nome,cognome,strumento,data_nascita,nazionalita',
      'Anna,Rossi,Pianoforte,2002-04-15,Italiana',
      'Luca,Verdi,Flauto,99/99/9999,',
    ].join('\n');
    await user.upload(getFileInput(), makeFile(mixedCsv, 'mixed.csv'));

    const table = await screen.findByRole('table');
    // Feedback per-riga: il motivo dell'errore è mostrato sulla riga invalida.
    expect(within(table).getByText(/data non valida/i)).toBeInTheDocument();
    expect(
      within(table).getByText(/campo obbligatorio mancante: nazionalita/i),
    ).toBeInTheDocument();
    // Riepilogo: 1 valida, 1 con errori; bottone import conta solo le valide e
    // segnala le scartate.
    expect(screen.getByText(/2 righe · 1 valide · 1 con errori/i)).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: /importa\s*1\s*\(1 scartate\)/i }),
    ).toBeEnabled();
  });

  it('confermare l\'import chiama POST /api/candidati con il payload parse-ato e chiude con success', async () => {
    const user = userEvent.setup();
    mockLookups();
    const created: unknown[] = [];
    server.use(
      http.post('*/api/candidati', async ({ request }) => {
        const body = await request.json();
        created.push(body);
        return HttpResponse.json({ id: `cnd_${created.length}`, isGruppo: false }, { status: 201 });
      }),
    );

    const { onOpenChange, onDone } = renderDialog();

    await user.upload(getFileInput(), makeFile(VALID_CSV));
    await screen.findByRole('table');

    await user.click(screen.getByRole('button', { name: /importa\s*2/i }));

    // Entrambe le righe valide vengono create.
    await waitFor(() => expect(created).toHaveLength(2));

    // Payload corretto: nome/strumento dal CSV + risoluzione sezione/categoria
    // per nome (Anna → Pianoforte/Junior). denormalizeBody traduce tipo→isGruppo.
    const anna = created.find((c) => (c as { nome: string }).nome === 'Anna') as Record<string, unknown>;
    expect(anna).toMatchObject({
      concorsoId: CONCORSO_ID,
      nome: 'Anna',
      cognome: 'Rossi',
      strumento: 'Pianoforte',
      dataNascita: '2002-04-15',
      nazionalita: 'Italiana',
      sezioneId: 'sez_1',
      categoriaId: 'cat_1',
      isGruppo: false,
    });
    const marco = created.find((c) => (c as { nome: string }).nome === 'Marco') as Record<string, unknown>;
    // Marco senza sezione/categoria → riferimenti null.
    expect(marco).toMatchObject({ nome: 'Marco', strumento: 'Violino', sezioneId: null, categoriaId: null });

    // A import completato: success toast + onDone + chiusura dialog.
    await waitFor(() => expect(toastMock.success).toHaveBeenCalled());
    expect(String(toastMock.success.mock.calls[0][0])).toMatch(/import completato: 2 candidati/i);
    expect(onDone).toHaveBeenCalled();
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('errore lato server durante l\'import → warning di import parziale, dialog resta aperto', async () => {
    const user = userEvent.setup();
    mockLookups();
    // Ogni create fallisce 500: le righe finiscono in ko (catch per-riga).
    server.use(
      http.post('*/api/candidati', () =>
        HttpResponse.json({ error: 'Errore interno', code: 'INTERNAL' }, { status: 500 }),
      ),
    );

    const { onOpenChange, onDone } = renderDialog();

    await user.upload(getFileInput(), makeFile(VALID_CSV));
    await screen.findByRole('table');
    await user.click(screen.getByRole('button', { name: /importa\s*2/i }));

    // Feedback d'errore: import parziale con 0 creati / 2 errori.
    await waitFor(() => expect(toastMock.warning).toHaveBeenCalled());
    expect(String(toastMock.warning.mock.calls[0][0])).toMatch(/import parziale: 0 creati, 2 errori/i);
    expect(toastMock.success).not.toHaveBeenCalled();

    // onDone viene comunque chiamato (refetch parent) ma la chiusura del dialog
    // avviene solo se non viene sollevato un errore: con catch per-riga si chiude.
    expect(onDone).toHaveBeenCalled();
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('fallimento del lookup sezioni → errore globale d\'import, niente success', async () => {
    const user = userEvent.setup();
    // Il primo await (Promise.all sezioni/categorie) rigetta → catch globale di
    // runImport → toast.error, dialog NON chiuso.
    server.use(
      http.get('*/api/sezioni', () =>
        HttpResponse.json({ error: 'Boom', code: 'INTERNAL' }, { status: 500 }),
      ),
      http.get('*/api/categorie', () => HttpResponse.json(CATEGORIE)),
      http.post('*/api/candidati', () => HttpResponse.json({ id: 'x', isGruppo: false }, { status: 201 })),
    );

    const { onOpenChange, onDone } = renderDialog();

    await user.upload(getFileInput(), makeFile(VALID_CSV));
    await screen.findByRole('table');
    await user.click(screen.getByRole('button', { name: /importa\s*2/i }));

    await waitFor(() => expect(toastMock.error).toHaveBeenCalled());
    expect(String(toastMock.error.mock.calls[0][0])).toMatch(/errore durante l'import/i);
    expect(toastMock.success).not.toHaveBeenCalled();
    expect(onDone).not.toHaveBeenCalled();
    expect(onOpenChange).not.toHaveBeenCalled();
  });
});
