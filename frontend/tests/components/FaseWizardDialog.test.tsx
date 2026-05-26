// Component test — FaseWizardDialog (src/components/admin/fasi/FaseWizardDialog.tsx).
//
// Il wizard crea una o più fasi a partire da un template (unica / eliminatoria+finale /
// eliminatoria+semifinale+finale / personalizzato), con una "configurazione comune"
// (criteri + pesi) propagata a tutte le sotto-fasi. Al submit crea OGNI fase via
// POST /api/fasi e poi sincronizza i criteri via PUT /api/criteri/fase/:id.
//
// Note implementative rilevanti (vedi src/.../FaseWizardDialog.tsx + fasi-utils.ts):
//   - WIZ_TEMPLATES popola la LISTA FASI (sezione 2), non i criteri. I criteri
//     partono dai DEFAULT_CRITERI (Tecnica 35 / Interpretazione 35 / Intonazione 15
//     / Musicalità 15 = 100%) e sono indipendenti dal template scelto.
//   - La validazione peso NON blocca hard: se la somma != 100 il componente chiede
//     conferma via window.confirm("La somma dei pesi è X% ..."). Annullare aborta il
//     submit; confermare lo lascia proseguire. Con somma == 100 NON c'è alcun confirm.
//   - Il totale visibile "Tot: X%" è verde a 100, ambra altrimenti.
//   - Il dialog monta useSezioni/useCommissioni/useCommissari → GET su /api/*:
//     vanno mockati o MSW (onUnhandledRequest:'error') fa fallire il test.
//
// Si usa un AuthContext admin finto (niente rete per l'auth) + override MSW mirati.
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { http, HttpResponse } from 'msw';

import { FaseWizardDialog } from '@/components/admin/fasi/FaseWizardDialog';
import type { FaseGroup } from '@/components/admin/fasi-utils';
import type { User } from '@/types';
import { render, screen, waitFor, userEvent } from '../test-utils';
import { server } from '../msw/server';

const adminUser: User = {
  id: 'usr_admin',
  email: 'admin@esempio.it',
  role: 'admin',
  attivo: true,
  tenantId: 'tnt_test',
  commissarioId: null,
  totpEnabled: false,
};

const CONCORSO_ID = 'cnc_1';

const group: FaseGroup = {
  key: 's:sez_1',
  type: 'single',
  sezioneIds: ['sez_1'],
  fasi: [],
};

// Mock dei tre GET che il dialog spara al mount. I dati minimi bastano: il test
// non dipende da sezioni/commissioni/commissari specifici.
function mockSupportingData() {
  server.use(
    http.get('*/api/sezioni', () =>
      HttpResponse.json([
        {
          id: 'sez_1',
          concorsoId: CONCORSO_ID,
          tenantId: 'tnt_test',
          nome: 'Archi',
          descrizione: null,
          ordine: 0,
          createdAt: '2026-01-01T00:00:00Z',
          updatedAt: '2026-01-01T00:00:00Z',
        },
      ]),
    ),
    http.get('*/api/commissioni', () => HttpResponse.json([])),
    http.get('*/api/commissari', () => HttpResponse.json([])),
  );
}

interface RenderOpts {
  onOpenChange?: (v: boolean) => void;
  onSaved?: () => void;
}

function renderWizard(opts: RenderOpts = {}) {
  const onOpenChange = opts.onOpenChange ?? vi.fn();
  const onSaved = opts.onSaved ?? vi.fn();
  const utils = render(
    <FaseWizardDialog
      open
      onOpenChange={onOpenChange}
      concorsoId={CONCORSO_ID}
      group={group}
      nextOrdine={5}
      onSaved={onSaved}
    />,
    { auth: { user: adminUser } },
  );
  return { ...utils, onOpenChange, onSaved };
}

// Gli input "peso criterio" sono numerici (spinbutton) e — a differenza degli
// spinbutton delle NumericCard (Scala/Tempo, classe pr-12) — hanno classe pr-7.
// È l'unico marker stabile per distinguerli senza un accessible-name per riga
// (vedi GAP DI TESTABILITÀ in fondo / nel report). Filtriamo su quella classe.
function getPesoInputs(): HTMLInputElement[] {
  const all = screen.getAllByRole('spinbutton') as HTMLInputElement[];
  const criteri = all.filter((el) => el.classList.contains('pr-7'));
  if (criteri.length === 0) throw new Error('input peso criteri non trovati');
  return criteri;
}

async function setPeso(user: ReturnType<typeof userEvent.setup>, idx: number, value: string) {
  const inputs = getPesoInputs();
  const input = inputs[idx];
  await user.clear(input);
  if (value !== '') await user.type(input, value);
}

describe('FaseWizardDialog', () => {
  let confirmSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    mockSupportingData();
    // Default: l'utente CONFERMA eventuali prompt window.confirm. I test che
    // vogliono testare l'annullamento ridefiniscono il mockReturnValue.
    confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);
  });

  afterEach(() => {
    confirmSpy.mockRestore();
  });

  it('renders the dialog with all template options and the default 100% criteri', async () => {
    renderWizard();

    // Titolo del dialog (groupLabel = nome sezione "Archi", caricato via MSW).
    expect(
      await screen.findByRole('heading', { name: /configura fasi per archi/i }),
    ).toBeInTheDocument();

    // Le 4 opzioni template sono pulsanti con label italiana.
    expect(screen.getByRole('button', { name: /fase unica/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /eliminatoria \+ finale/i })).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: /eliminatoria \+ semifinale \+ finale/i }),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /personalizzato/i })).toBeInTheDocument();

    // Template di default 'unica' → una sola fase "Audizione" nella lista.
    expect(screen.getByDisplayValue('Audizione')).toBeInTheDocument();

    // Criteri di default sommano a 100% → badge totale verde "100%".
    expect(screen.getByText('100%')).toBeInTheDocument();
    const pesi = getPesoInputs();
    expect(pesi).toHaveLength(4);
    expect(pesi.map((p) => p.value)).toEqual(['35', '35', '15', '15']);
  });

  it('switching template repopulates the phase list (criteri stay intact)', async () => {
    const user = userEvent.setup();
    renderWizard();
    await screen.findByRole('heading', { name: /configura fasi per archi/i });

    // Parte da 'unica' → 1 fase "Audizione".
    expect(screen.getByDisplayValue('Audizione')).toBeInTheDocument();
    expect(screen.queryByDisplayValue('Eliminatoria')).not.toBeInTheDocument();

    // Seleziona "Eliminatoria + Semifinale + Finale" → 3 fasi popolate.
    await user.click(
      screen.getByRole('button', { name: /eliminatoria \+ semifinale \+ finale/i }),
    );
    expect(screen.getByDisplayValue('Eliminatoria')).toBeInTheDocument();
    expect(screen.getByDisplayValue('Semifinale')).toBeInTheDocument();
    expect(screen.getByDisplayValue('Finale')).toBeInTheDocument();
    // La fase del template precedente è stata rimpiazzata.
    expect(screen.queryByDisplayValue('Audizione')).not.toBeInTheDocument();

    // Tornando a "Fase unica" la lista torna a una sola fase "Audizione".
    await user.click(screen.getByRole('button', { name: /^fase unica/i }));
    expect(screen.getByDisplayValue('Audizione')).toBeInTheDocument();
    expect(screen.queryByDisplayValue('Eliminatoria')).not.toBeInTheDocument();

    // I criteri restano invariati (indipendenti dal template).
    expect(getPesoInputs().map((p) => p.value)).toEqual(['35', '35', '15', '15']);
  });

  it('valid 100% sum: submits without a confirm prompt and POSTs the expected payload', async () => {
    const user = userEvent.setup();

    const faseBodies: Array<Record<string, unknown>> = [];
    const criteriBodies: Array<{ url: string; body: unknown }> = [];
    server.use(
      http.post('*/api/fasi', async ({ request }) => {
        const body = (await request.json()) as Record<string, unknown>;
        faseBodies.push(body);
        return HttpResponse.json({
          id: `fase_${faseBodies.length}`,
          concorsoId: CONCORSO_ID,
          ordine: body.ordine,
          nome: body.nome,
          sezioniIds: ['sez_1'],
        });
      }),
      http.put('*/api/criteri/fase/:faseId', async ({ request, params }) => {
        criteriBodies.push({ url: String(params.faseId), body: await request.json() });
        return HttpResponse.json([]);
      }),
    );

    const { onSaved, onOpenChange } = renderWizard();
    await screen.findByRole('heading', { name: /configura fasi per archi/i });

    // I criteri di default sommano già a 100% → submit diretto.
    await user.click(screen.getByRole('button', { name: /crea fasi/i }));

    // Una sola fase ('unica') creata; nessun window.confirm perché somma == 100.
    await waitFor(() => expect(faseBodies).toHaveLength(1));
    expect(confirmSpy).not.toHaveBeenCalled();

    // Payload POST /api/fasi: ordine = nextOrdine (5), nome dal template.
    expect(faseBodies[0]).toMatchObject({
      concorsoId: CONCORSO_ID,
      ordine: 5,
      nome: 'Audizione',
      sezioniIds: ['sez_1'],
    });

    // I criteri sono stati sincronizzati sulla fase creata, con i pesi clampati.
    await waitFor(() => expect(criteriBodies).toHaveLength(1));
    expect(criteriBodies[0].url).toBe('fase_1');
    const sent = (criteriBodies[0].body as { criteri: Array<{ nome: string; peso: number }> })
      .criteri;
    expect(sent.map((c) => c.nome)).toEqual([
      'Tecnica',
      'Interpretazione',
      'Intonazione',
      'Musicalità',
    ]);
    expect(sent.reduce((s, c) => s + c.peso, 0)).toBe(100);

    // Successo → onSaved chiamato e dialog chiuso.
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('multi-phase template creates one fase per item with progressive ordine', async () => {
    const user = userEvent.setup();
    const faseBodies: Array<Record<string, unknown>> = [];
    server.use(
      http.post('*/api/fasi', async ({ request }) => {
        const body = (await request.json()) as Record<string, unknown>;
        faseBodies.push(body);
        return HttpResponse.json({
          id: `fase_${faseBodies.length}`,
          concorsoId: CONCORSO_ID,
          ordine: body.ordine,
          nome: body.nome,
          sezioniIds: ['sez_1'],
        });
      }),
      http.put('*/api/criteri/fase/:faseId', () => HttpResponse.json([])),
    );

    renderWizard();
    await screen.findByRole('heading', { name: /configura fasi per archi/i });

    await user.click(screen.getByRole('button', { name: /eliminatoria \+ finale/i }));
    await user.click(screen.getByRole('button', { name: /crea fasi/i }));

    await waitFor(() => expect(faseBodies).toHaveLength(2));
    // ordine progressivo dal nextOrdine (5, 6) e nomi dal template.
    expect(faseBodies.map((b) => [b.nome, b.ordine])).toEqual([
      ['Eliminatoria', 5],
      ['Finale', 6],
    ]);
  });

  it('weight sum != 100 triggers a confirm; cancelling it blocks the create call', async () => {
    const user = userEvent.setup();
    // L'utente ANNULLA il prompt → submit abortito, nessuna chiamata di rete.
    confirmSpy.mockReturnValue(false);

    let posted = false;
    server.use(
      http.post('*/api/fasi', () => {
        posted = true;
        return HttpResponse.json({ id: 'x', concorsoId: CONCORSO_ID, ordine: 5, nome: 'x', sezioniIds: ['sez_1'] });
      }),
    );

    const { onSaved } = renderWizard();
    await screen.findByRole('heading', { name: /configura fasi per archi/i });

    // Rendi la somma != 100: porta il primo criterio da 35 a 10
    // (totale 10 + 35 + 15 + 15 = 75%).
    await setPeso(user, 0, '10');
    // Il totale visibile ora è 75% (non più 100%).
    expect(screen.getByText('75%')).toBeInTheDocument();
    expect(screen.queryByText('100%')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /crea fasi/i }));

    // È stato chiesto conferma citando la somma non valida.
    await waitFor(() => expect(confirmSpy).toHaveBeenCalled());
    expect(confirmSpy.mock.calls[0][0]).toMatch(/somma dei pesi è 75%/i);

    // Annullato → nessuna fase creata, onSaved non chiamato.
    expect(posted).toBe(false);
    expect(onSaved).not.toHaveBeenCalled();
  });

  it('edge: invalid weights (negative rejected at input, empty coerced to 0) stay in [0,100]', async () => {
    const user = userEvent.setup();
    // somma diversa da 100 → confirm; lo confermiamo (default true) per arrivare al POST.
    const criteriBodies: Array<{ criteri: Array<{ nome: string; peso: number }> }> = [];
    server.use(
      http.post('*/api/fasi', () =>
        HttpResponse.json({ id: 'fase_1', concorsoId: CONCORSO_ID, ordine: 5, nome: 'Audizione', sezioniIds: ['sez_1'] }),
      ),
      http.put('*/api/criteri/fase/:faseId', async ({ request }) => {
        criteriBodies.push((await request.json()) as { criteri: Array<{ nome: string; peso: number }> });
        return HttpResponse.json([]);
      }),
    );

    renderWizard();
    await screen.findByRole('heading', { name: /configura fasi per archi/i });

    // L'input peso è <input type=number min=0>: il segno meno viene RIFIUTATO
    // dal field (jsdom scarta i caratteri non validi per min=0), quindi un peso
    // negativo non è proprio digitabile — la UI lo impedisce alla radice.
    const pesoTecnica = getPesoInputs()[0];
    await user.clear(pesoTecnica);
    await user.type(pesoTecnica, '-5');
    expect(Number(pesoTecnica.value)).toBeGreaterThanOrEqual(0);

    // Il peso lasciato VUOTO viene coerciato a 0 al submit (c.peso || 0).
    await setPeso(user, 1, ''); // Interpretazione svuotato

    await user.click(screen.getByRole('button', { name: /crea fasi/i }));

    // Somma != 100 → confirm mostrato (e confermato).
    await waitFor(() => expect(confirmSpy).toHaveBeenCalled());

    await waitFor(() => expect(criteriBodies).toHaveLength(1));
    const sent = criteriBodies[0].criteri;
    const byName = Object.fromEntries(sent.map((c) => [c.nome, c.peso]));
    // peso vuoto → 0 nel payload inviato.
    expect(byName['Interpretazione']).toBe(0);
    // tutti i pesi inviati restano clampati nel range valido [0,100].
    expect(sent.every((c) => c.peso >= 0 && c.peso <= 100)).toBe(true);
  });
});
