// Component test — AdminUtenti (src/pages/admin/Utenti.tsx).
//
// Copre la gestione account tenant:
//   - render lista con ruoli/stato;
//   - creazione account (payload POST corretto + validazione email/password);
//   - guard "non puoi eliminare te stesso" (delete + toggle disabilitati sul
//     proprio account);
//   - delete di un altro account (DELETE), toggle attivo (PATCH), reset
//     password (POST .../reset-password);
//   - un path d'errore: create con email duplicata → 409 → toast d'errore.
//
// L'auth è iniettata via `auth: { user }` con l'utente loggato CORRENTE (serve
// alla guard delete-self, che confronta acc.id === user.id). Gli endpoint
// /api/accounts sono mockati per-test con server.use(...).
//
// Il componente dà feedback via `sonner` (toast) ma l'harness non monta
// <Toaster>, quindi i toast non producono DOM: spiamo il modulo `sonner`.
// `window.confirm` (usato dalla delete) è stubato per default su true.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { http, HttpResponse } from 'msw';

import AdminUtenti from '@/pages/admin/Utenti';
import { render, screen, within, waitFor, userEvent } from '../test-utils';
import { server } from '../msw/server';
import { mockUser } from '../msw/handlers';
import type { Account, User } from '@/types';

// ─── Spy su sonner (toast) ──────────────────────────────────────────────────
// Il componente importa { toast } from 'sonner'; senza <Toaster> i toast non
// finiscono nel DOM, quindi mockiamo il modulo e asseriamo le chiamate.
const toastSuccess = vi.fn();
const toastError = vi.fn();
vi.mock('sonner', () => ({
  toast: {
    success: (...a: unknown[]) => toastSuccess(...a),
    error: (...a: unknown[]) => toastError(...a),
  },
}));

// ─── Fixtures ───────────────────────────────────────────────────────────────
// L'utente loggato corrente: lo stesso `mockUser` (admin). È DENTRO la lista
// account così possiamo testare la guard delete-self.
const currentUser: User = { ...mockUser, id: 'usr_me', email: 'io@esempio.it', role: 'admin' };

const accSelf: Account = {
  id: 'usr_me',
  email: 'io@esempio.it',
  role: 'admin',
  attivo: true,
  commissarioId: null,
  lastLoginAt: '2026-05-20T10:00:00.000Z',
};
const accOtherAdmin: Account = {
  id: 'usr_other',
  email: 'collega@esempio.it',
  role: 'admin',
  attivo: true,
  commissarioId: null,
  lastLoginAt: null,
};
const accCommissario: Account = {
  id: 'usr_com',
  email: 'commissario@esempio.it',
  role: 'commissario',
  attivo: false,
  commissarioId: 'cm_1',
  lastLoginAt: null,
};

const ACCOUNTS = [accSelf, accOtherAdmin, accCommissario];

/** Mock di GET /api/accounts con una lista (default: le 3 fixtures). */
function mockList(list: Account[] = ACCOUNTS) {
  server.use(http.get('*/accounts', () => HttpResponse.json(list)));
}

function renderPage() {
  return render(<AdminUtenti />, { auth: { user: currentUser } });
}

/** Trova la riga <tr> di un account dato il suo email. */
function rowFor(email: string): HTMLElement {
  const cell = screen.getByText(email);
  const row = cell.closest('tr');
  if (!row) throw new Error(`riga non trovata per ${email}`);
  return row;
}

beforeEach(() => {
  toastSuccess.mockClear();
  toastError.mockClear();
  vi.spyOn(window, 'confirm').mockReturnValue(true);
});

describe('AdminUtenti — lista', () => {
  it('mostra gli account con i rispettivi ruoli e marca l\'utente corrente con "(tu)"', async () => {
    mockList();
    renderPage();

    // Le righe compaiono dopo la fetch.
    expect(await screen.findByText('io@esempio.it')).toBeInTheDocument();
    expect(screen.getByText('collega@esempio.it')).toBeInTheDocument();
    expect(screen.getByText('commissario@esempio.it')).toBeInTheDocument();

    // Conteggio account in toolbar.
    expect(screen.getByText('3 account')).toBeInTheDocument();

    // Ruoli: l'account commissario mostra il badge "Commissario".
    const comRow = rowFor('commissario@esempio.it');
    expect(within(comRow).getByText('Commissario')).toBeInTheDocument();
    // Stato disabilitato per il commissario.
    expect(within(comRow).getByText('Disabilitato')).toBeInTheDocument();

    // L'utente loggato è marcato "(tu)".
    const selfRow = rowFor('io@esempio.it');
    expect(within(selfRow).getByText('(tu)')).toBeInTheDocument();
  });

  it('mostra un errore se la fetch fallisce', async () => {
    server.use(
      http.get('*/accounts', () =>
        HttpResponse.json({ error: 'boom', code: 'SERVER_ERROR' }, { status: 500 }),
      ),
    );
    renderPage();

    expect(
      await screen.findByText(/errore nel caricamento degli account/i),
    ).toBeInTheDocument();
  });
});

describe('AdminUtenti — creazione account', () => {
  it('compila e invia il form: chiama POST /accounts col payload corretto (ruolo default admin)', async () => {
    const user = userEvent.setup();
    mockList();
    let createBody: Record<string, unknown> | null = null;
    server.use(
      http.post('*/accounts', async ({ request }) => {
        createBody = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json({ ...accOtherAdmin, ...createBody, id: 'usr_new' });
      }),
    );

    renderPage();
    await screen.findByText('io@esempio.it');

    // Apri il dialog di creazione.
    await user.click(screen.getByRole('button', { name: /aggiungi utente/i }));

    const dialog = await screen.findByRole('dialog');
    await user.type(within(dialog).getByLabelText(/email/i), 'nuovo@esempio.it');
    await user.type(within(dialog).getByLabelText(/^password$/i), 'password123');

    // Submit (il bottone "Crea" è associato al form via attributo form=).
    await user.click(within(dialog).getByRole('button', { name: /^crea$/i }));

    await waitFor(() => {
      expect(createBody).toEqual({
        email: 'nuovo@esempio.it',
        password: 'password123',
        role: 'admin',
        attivo: true,
      });
    });
    await waitFor(() => expect(toastSuccess).toHaveBeenCalled());
  });

  it('validazione email: un\'email malformata blocca l\'invio (gate nativo type=email), nessuna API', async () => {
    const user = userEvent.setup();
    mockList();
    const createSpy = vi.fn();
    server.use(
      http.post('*/accounts', () => {
        createSpy();
        return HttpResponse.json(accOtherAdmin);
      }),
    );

    renderPage();
    await screen.findByText('io@esempio.it');
    await user.click(screen.getByRole('button', { name: /aggiungi utente/i }));

    const dialog = await screen.findByRole('dialog');
    const email = within(dialog).getByLabelText(/email/i) as HTMLInputElement;
    await user.type(email, 'non-una-email');
    await user.type(within(dialog).getByLabelText(/^password$/i), 'password123');
    await user.click(within(dialog).getByRole('button', { name: /^crea$/i }));

    // L'input email type=email è invalido → il browser blocca la submit prima
    // che parta la mutation: feedback di validità nativo + nessuna chiamata.
    expect(email.validity.valid).toBe(false);
    expect(email).toBeInvalid();
    await waitFor(() => undefined);
    expect(createSpy).not.toHaveBeenCalled();
  });

  it('validazione password: email valida ma password < 8 → messaggio zod e nessuna API', async () => {
    const user = userEvent.setup();
    mockList();
    const createSpy = vi.fn();
    server.use(
      http.post('*/accounts', () => {
        createSpy();
        return HttpResponse.json(accOtherAdmin);
      }),
    );

    renderPage();
    await screen.findByText('io@esempio.it');
    await user.click(screen.getByRole('button', { name: /aggiungi utente/i }));

    const dialog = await screen.findByRole('dialog');
    await user.type(within(dialog).getByLabelText(/email/i), 'ok@esempio.it');
    await user.type(within(dialog).getByLabelText(/^password$/i), 'corta'); // < 8
    await user.click(within(dialog).getByRole('button', { name: /^crea$/i }));

    // Messaggio di errore zod sulla password.
    expect(await within(dialog).findByText(/minimo 8 caratteri/i)).toBeInTheDocument();
    // Nessuna chiamata di rete.
    expect(createSpy).not.toHaveBeenCalled();
  });

  it('path d\'errore: email duplicata → 409 → toast d\'errore, nessun toast di successo', async () => {
    const user = userEvent.setup();
    mockList();
    server.use(
      http.post('*/accounts', () =>
        HttpResponse.json(
          { error: 'Email già in uso', code: 'EMAIL_TAKEN' },
          { status: 409 },
        ),
      ),
    );

    renderPage();
    await screen.findByText('io@esempio.it');
    await user.click(screen.getByRole('button', { name: /aggiungi utente/i }));

    const dialog = await screen.findByRole('dialog');
    await user.type(within(dialog).getByLabelText(/email/i), 'collega@esempio.it');
    await user.type(within(dialog).getByLabelText(/^password$/i), 'password123');
    await user.click(within(dialog).getByRole('button', { name: /^crea$/i }));

    await waitFor(() => {
      expect(toastError).toHaveBeenCalledWith('Email già in uso');
    });
    expect(toastSuccess).not.toHaveBeenCalled();
  });
});

describe('AdminUtenti — guard delete-self', () => {
  it('sul proprio account i pulsanti elimina e toggle sono disabilitati', async () => {
    mockList();
    renderPage();
    await screen.findByText('io@esempio.it');

    const selfRow = rowFor('io@esempio.it');
    const delBtn = within(selfRow).getByRole('button', { name: /elimina/i });
    expect(delBtn).toBeDisabled();
    // Anche il toggle attivo è bloccato sul proprio account.
    const toggleBtn = within(selfRow).getByRole('button', { name: /disabilita|abilita/i });
    expect(toggleBtn).toBeDisabled();
  });

  it('la guard regge anche a livello logico: nessuna DELETE per il proprio id', async () => {
    const user = userEvent.setup();
    mockList();
    const delSpy = vi.fn();
    server.use(
      http.delete('*/accounts/:id', ({ params }) => {
        delSpy(params.id);
        return new HttpResponse(null, { status: 204 });
      }),
    );

    renderPage();
    await screen.findByText('io@esempio.it');

    // Il pulsante è disabled, ma forziamo comunque un attempt: resta no-op.
    const selfRow = rowFor('io@esempio.it');
    const delBtn = within(selfRow).getByRole('button', { name: /elimina/i });
    await user.click(delBtn).catch(() => undefined);

    expect(delSpy).not.toHaveBeenCalled();
  });
});

describe('AdminUtenti — azioni su altri account', () => {
  it('elimina un altro account: chiama DELETE /accounts/:id dopo conferma', async () => {
    const user = userEvent.setup();
    mockList();
    let deletedId: string | undefined;
    server.use(
      http.delete('*/accounts/:id', ({ params }) => {
        deletedId = params.id as string;
        return new HttpResponse(null, { status: 204 });
      }),
    );

    renderPage();
    await screen.findByText('collega@esempio.it');

    const row = rowFor('collega@esempio.it');
    await user.click(within(row).getByRole('button', { name: /elimina/i }));

    expect(window.confirm).toHaveBeenCalled();
    await waitFor(() => expect(deletedId).toBe('usr_other'));
    await waitFor(() => expect(toastSuccess).toHaveBeenCalled());
  });

  it('toggle attivo: chiama PATCH /accounts/:id con il nuovo stato', async () => {
    const user = userEvent.setup();
    mockList();
    let patchBody: Record<string, unknown> | null = null;
    let patchedId: string | undefined;
    server.use(
      http.patch('*/accounts/:id', async ({ request, params }) => {
        patchedId = params.id as string;
        patchBody = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json({ ...accOtherAdmin, ...patchBody });
      }),
    );

    renderPage();
    await screen.findByText('collega@esempio.it');

    // collega è attivo → il toggle lo disabilita (attivo:false).
    const row = rowFor('collega@esempio.it');
    await user.click(within(row).getByRole('button', { name: /disabilita/i }));

    await waitFor(() => expect(patchedId).toBe('usr_other'));
    expect(patchBody).toEqual({ attivo: false });
  });

  it('reset password: invia POST /accounts/:id/reset-password con la nuova password', async () => {
    const user = userEvent.setup();
    mockList();
    let resetBody: Record<string, unknown> | null = null;
    let resetId: string | undefined;
    server.use(
      http.post('*/accounts/:id/reset-password', async ({ request, params }) => {
        resetId = params.id as string;
        resetBody = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json({ ok: true });
      }),
    );

    renderPage();
    await screen.findByText('collega@esempio.it');

    const row = rowFor('collega@esempio.it');
    await user.click(within(row).getByRole('button', { name: /reset password/i }));

    const dialog = await screen.findByRole('dialog');
    // Il dialog mostra l'email dell'account selezionato.
    expect(within(dialog).getByText('collega@esempio.it')).toBeInTheDocument();

    await user.type(within(dialog).getByLabelText(/nuova password/i), 'nuovapass123');
    await user.type(within(dialog).getByLabelText(/conferma/i), 'nuovapass123');
    await user.click(within(dialog).getByRole('button', { name: /reimposta/i }));

    await waitFor(() => expect(resetId).toBe('usr_other'));
    expect(resetBody).toEqual({ password: 'nuovapass123' });
  });

  it('reset password: password non coincidenti → errore di validazione, nessuna chiamata', async () => {
    const user = userEvent.setup();
    mockList();
    const resetSpy = vi.fn();
    server.use(
      http.post('*/accounts/:id/reset-password', () => {
        resetSpy();
        return HttpResponse.json({ ok: true });
      }),
    );

    renderPage();
    await screen.findByText('collega@esempio.it');

    const row = rowFor('collega@esempio.it');
    await user.click(within(row).getByRole('button', { name: /reset password/i }));

    const dialog = await screen.findByRole('dialog');
    await user.type(within(dialog).getByLabelText(/nuova password/i), 'nuovapass123');
    await user.type(within(dialog).getByLabelText(/conferma/i), 'diversa12345');
    await user.click(within(dialog).getByRole('button', { name: /reimposta/i }));

    expect(await within(dialog).findByText(/le password non coincidono/i)).toBeInTheDocument();
    expect(resetSpy).not.toHaveBeenCalled();
  });
});
