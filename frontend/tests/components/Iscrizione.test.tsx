// Component test — Iscrizione pubblica (src/pages/public/Iscrizione.tsx).
//
// Pagina PUBBLICA (anonima): l'AuthProvider reale fa GET /auth/me → 401 baseline.
// Il form si monta solo dopo aver caricato un concorso aperto: mockiamo
//   GET /api/public/concorsi      → lista con un concorso
//   GET /api/public/concorsi/:id  → dettaglio (sezioni/categorie vuote)
// così evitiamo lo stato "Caricamento" / "Iscrizioni non disponibili".
//
// Copriamo i comportamenti ad alto valore:
//   1. render della prima sezione con i campi obbligatori;
//   2. validazione: submit a vuoto mostra errori e NON chiama l'endpoint submit;
//   3. gate consensi GDPR: senza privacy/regolamento il submit resta bloccato;
//   4. draft localStorage: digitare un campo popola la chiave del draft;
//   5. happy path: compilati i required + consensi, il submit colpisce l'API
//      con i campi chiave.
//
// Le <label> avvolgono input + uno <span class="c-field__label">: Testing
// Library le associa per wrapping, quindi getByLabelText(/Nome \*/) funziona.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { http, HttpResponse } from 'msw';

import Iscrizione from '@/pages/public/Iscrizione';
import { render, screen, waitFor, userEvent } from '../test-utils';
import { server } from '../msw/server';

const CONCORSO = {
  id: 'cnc_1',
  nome: 'Concorso Test 2026',
  anno: 2026,
  dataInizio: null,
  logo: null,
  iscrizioniScadenza: null,
  stato: 'aperto',
};

const DRAFT_KEY = 'iscrizione_draft_v3';

/** Registra i mock per far montare il form (lista + dettaglio concorso). */
function mockConcorsoAperto() {
  server.use(
    http.get('*/api/public/concorsi', () => HttpResponse.json([CONCORSO])),
    http.get('*/api/public/concorsi/cnc_1', () =>
      HttpResponse.json({ ...CONCORSO, sezioni: [], categorie: [] }),
    ),
  );
}

/** Attende che il form sia montato (header del concorso visibile). */
async function renderForm() {
  const view = render(<Iscrizione />);
  expect(
    await screen.findByRole('heading', { name: /concorso test 2026/i }),
  ).toBeInTheDocument();
  return view;
}

describe('Iscrizione (form pubblico)', () => {
  beforeEach(() => {
    localStorage.clear();
    mockConcorsoAperto();
    // jsdom non implementa scrollIntoView: il componente lo chiama nell'handler
    // "invalid" di react-hook-form. Senza stub diventa una unhandled rejection
    // che fa fallire il test. (Polyfill d'ambiente test, non tocca src.)
    Element.prototype.scrollIntoView = vi.fn();
  });

  afterEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  it('renders the first section with its required fields once the open competition loads', async () => {
    await renderForm();

    // Sezione 1 "Dati anagrafici" presente.
    expect(screen.getByRole('heading', { name: /dati anagrafici/i })).toBeInTheDocument();

    // Campi obbligatori della prima sezione (label con asterisco).
    expect(screen.getByLabelText(/^Nome \*/)).toBeInTheDocument();
    expect(screen.getByLabelText(/^Cognome \*/)).toBeInTheDocument();
    expect(screen.getByLabelText(/Data di nascita \*/)).toBeInTheDocument();
    expect(screen.getByLabelText(/Nazionalità \*/)).toBeInTheDocument();

    // Email (sezione 2), strumento (sezione 3), pulsante submit.
    expect(screen.getByLabelText(/Email \*/)).toBeInTheDocument();
    expect(screen.getByLabelText(/Strumento \*/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /invia iscrizione/i })).toBeInTheDocument();
  });

  it('blocks submit and surfaces validation errors when required fields are empty', async () => {
    const user = userEvent.setup();
    let submitCalled = false;
    server.use(
      http.post('*/api/public/iscrizioni', () => {
        submitCalled = true;
        return HttpResponse.json({ ok: true, iscrizioneId: 'x', uploadToken: '' }, { status: 201 });
      }),
    );

    await renderForm();
    await user.click(screen.getByRole('button', { name: /invia iscrizione/i }));

    // Errori di validazione zod renderizzati sotto i campi.
    // NB: regex ancorate — "/nome/" matcherebbe anche "Cognome".
    expect(await screen.findByText(/^Nome obbligatorio$/i)).toBeInTheDocument();
    expect(screen.getByText(/^Cognome obbligatorio$/i)).toBeInTheDocument();
    expect(screen.getByText(/^Data di nascita obbligatoria$/i)).toBeInTheDocument();
    expect(screen.getByText(/^Strumento obbligatorio$/i)).toBeInTheDocument();

    // L'endpoint di submit NON è stato chiamato.
    expect(submitCalled).toBe(false);
  });

  it('GDPR consent gate: with all data filled but consents unchecked, submit is blocked', async () => {
    const user = userEvent.setup();
    let submitCalled = false;
    server.use(
      http.post('*/api/public/iscrizioni', () => {
        submitCalled = true;
        return HttpResponse.json({ ok: true, iscrizioneId: 'x', uploadToken: '' }, { status: 201 });
      }),
    );

    await renderForm();

    // Compila TUTTI i required tranne i consensi GDPR.
    await user.type(screen.getByLabelText(/^Nome \*/), 'Anna');
    await user.type(screen.getByLabelText(/^Cognome \*/), 'Rossi');
    await user.type(screen.getByLabelText(/Data di nascita \*/), '1995-04-10');
    await user.type(screen.getByLabelText(/Nazionalità \*/), 'Italiana');
    await user.type(screen.getByLabelText(/Email \*/), 'anna@esempio.it');
    await user.type(screen.getByLabelText(/Strumento \*/), 'Pianoforte');
    await user.type(screen.getByPlaceholderText(/Titolo brano/i), 'Notturno');

    await user.click(screen.getByRole('button', { name: /invia iscrizione/i }));

    // Gli errori sui consensi obbligatori compaiono e il submit resta bloccato.
    expect(await screen.findByText(/consenso privacy obbligatorio/i)).toBeInTheDocument();
    expect(screen.getByText(/consenso regolamento obbligatorio/i)).toBeInTheDocument();
    expect(submitCalled).toBe(false);
  });

  it('persists a draft to localStorage as fields change', async () => {
    const user = userEvent.setup();
    await renderForm();

    // Inizialmente nessun (o draft vuoto). Digitiamo il nome.
    await user.type(screen.getByLabelText(/^Nome \*/), 'Marco');

    await waitFor(() => {
      const raw = localStorage.getItem(DRAFT_KEY);
      expect(raw).toBeTruthy();
      const draft = JSON.parse(raw ?? '{}') as { nome?: string };
      expect(draft.nome).toBe('Marco');
    });
  });

  it('happy path: filling required fields + consents submits to the API with key fields', async () => {
    const user = userEvent.setup();
    let payload: Record<string, unknown> | null = null;
    server.use(
      http.post('*/api/public/iscrizioni', async ({ request }) => {
        payload = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json(
          { ok: true, iscrizioneId: 'isc_99', uploadToken: '' },
          { status: 201 },
        );
      }),
    );

    await renderForm();

    await user.type(screen.getByLabelText(/^Nome \*/), 'Giulia');
    await user.type(screen.getByLabelText(/^Cognome \*/), 'Bianchi');
    await user.type(screen.getByLabelText(/Data di nascita \*/), '1990-06-15');
    await user.type(screen.getByLabelText(/Nazionalità \*/), 'Italiana');
    await user.type(screen.getByLabelText(/Email \*/), 'giulia@esempio.it');
    await user.type(screen.getByLabelText(/Strumento \*/), 'Violino');
    await user.type(screen.getByPlaceholderText(/Titolo brano/i), 'Sonata');

    // Consensi obbligatori (privacy + regolamento) via le rispettive label.
    await user.click(screen.getByLabelText(/Privacy \*/i));
    await user.click(screen.getByLabelText(/Regolamento \*/i));

    await user.click(screen.getByRole('button', { name: /invia iscrizione/i }));

    // Schermata di conferma + payload ricevuto dal server.
    expect(await screen.findByRole('heading', { name: /iscrizione inviata/i })).toBeInTheDocument();

    await waitFor(() => {
      expect(payload).not.toBeNull();
    });
    const sent = payload as unknown as {
      concorsoId: string; nome: string; cognome: string; email: string;
      strumento: string; programma: { titolo: string }[];
      consensiGdpr: { privacy: boolean; regolamento: boolean };
    };
    expect(sent.concorsoId).toBe('cnc_1');
    expect(sent.nome).toBe('Giulia');
    expect(sent.cognome).toBe('Bianchi');
    expect(sent.email).toBe('giulia@esempio.it');
    expect(sent.strumento).toBe('Violino');
    // Il payload normalizza i brani (autore/durata vuoti inclusi): basta il titolo.
    expect(sent.programma).toHaveLength(1);
    expect(sent.programma[0].titolo).toBe('Sonata');
    expect(sent.consensiGdpr.privacy).toBe(true);
    expect(sent.consensiGdpr.regolamento).toBe(true);
  });
});
