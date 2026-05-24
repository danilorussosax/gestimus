// =============================================================================
// ImpostazioniConcorsoTab — settings panel for a single concorso (admin)
//
// Ports js/views/admin/impostazioni-concorso.js to React + RHF/Zod.
// Sections:
//   1. Logo upload (preview, 5 MB guard)
//   2. Anagrafica (nome, anno, dataInizio, stato)
//   3. Modalità di valutazione (anonimo toggle)
//   4. Iscrizioni pubbliche (iscrizioni_aperte + iscrizioni_chiusura)
//   5. Tiebreak default cascade (enabled/disabled per step)
//   6. Save / Reset bar (sticky bottom)
//   7. Statistiche (fasi / candidati / commissari counts)
//   8. Zona pericolosa (double-confirm delete)
// =============================================================================

import { useState, useRef, useCallback } from 'react';
import { useForm, Controller, type Resolver, type SubmitHandler } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod/v4';
import { toast } from 'sonner';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Save, Settings, EyeOff, Calendar, AlertTriangle, Upload, X } from 'lucide-react';

import { http, fileUrl, httpErrorMessage } from '@/lib/api';
import {
  useConcorso,
  useUpdateConcorso,
  useDeleteConcorso,
  CONCORSI_QUERY_KEY,
  concorsoQueryKey,
} from '@/api/concorsi';
import { stepInfo, TIEBREAK_STEPS } from '@/lib/tiebreak';
import type { Concorso } from '@/types';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface FaseCountRaw { id: string }
interface CandidatoCountRaw { id: string }
interface CommissarioCountRaw { id: string }

interface TiebreakStepField {
  key: string;
  enabled: boolean;
}

// ---------------------------------------------------------------------------
// Zod schema
// ---------------------------------------------------------------------------

const schema = z.object({
  nome: z.string().min(1, 'Il nome è obbligatorio').max(255),
  anno: z.preprocess(
    (v) => (v === '' || v === null || v === undefined ? null : Number(v)),
    z.number({ error: 'Anno non valido' }).int().min(2000).max(2100).nullable(),
  ),
  dataInizio: z.string().optional(),
  stato: z.enum(['ATTIVO', 'CONCLUSO', 'SOSPESO', 'CHIUSO']),
  anonimo: z.boolean(),
  iscrizioniAperte: z.boolean(),
  iscrizioniChiusura: z.string().optional(),
  tiebreakSteps: z.array(
    z.object({
      key: z.string(),
      enabled: z.boolean(),
    }),
  ),
});

type FormValues = z.infer<typeof schema>;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function buildDefaultSteps(
  strategy: unknown,
): TiebreakStepField[] {
  // Build from the known step keys, respecting any saved strategy
   
  const saved: TiebreakStepField[] = Array.isArray(strategy) ? (strategy) : [];
  const savedMap = new Map(saved.map((s) => [s.key, s.enabled]));
  return TIEBREAK_STEPS.map((key) => ({
    key,
    enabled: savedMap.has(key) ? (savedMap.get(key) ?? true) : true,
  }));
}

function concorsoToFormValues(c: Concorso): FormValues {
  return {
    nome: c.nome ?? '',
    anno: c.anno ?? null,
    dataInizio: c.dataInizio ?? '',
    stato: (c.stato ?? 'ATTIVO'),
    anonimo: c.anonimo ?? false,
    iscrizioniAperte: c.iscrizioniAperte ?? false,
    iscrizioniChiusura: c.iscrizioniChiusura ?? '',
    // default_tiebreak_strategy lives as unknown on Concorso (not typed)
    tiebreakSteps: buildDefaultSteps((c as unknown as Record<string, unknown>).defaultTiebreakStrategy),
  };
}

function readImageResized(file: File, maxPx: number, quality: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(url);
      const ratio = Math.min(1, maxPx / Math.max(img.width, img.height));
      const w = Math.round(img.width * ratio);
      const h = Math.round(img.height * ratio);
      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d');
      if (!ctx) { reject(new Error('canvas context')); return; }
      ctx.drawImage(img, 0, 0, w, h);
      resolve(canvas.toDataURL(file.type === 'image/svg+xml' ? 'image/png' : file.type, quality));
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('load')); };
    img.src = url;
  });
}

const STEP_LABELS: Record<string, string> = {
  scomposizione: 'Scomposizione del voto',
  presidente: 'Voto del Presidente di giuria',
  eta: 'Criterio anagrafico (più giovane)',
  ex_aequo: 'Ex aequo (extrema ratio)',
};

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

interface TiebreakEditorProps {
  steps: TiebreakStepField[];
  onChange: (steps: TiebreakStepField[]) => void;
}

function TiebreakEditor({ steps, onChange }: TiebreakEditorProps) {
  const toggle = useCallback(
    (key: string) => {
      onChange(steps.map((s) => (s.key === key ? { ...s, enabled: !s.enabled } : s)));
    },
    [steps, onChange],
  );

  return (
    <div className="space-y-2">
      {steps.map((step) => {
        const info = stepInfo(step.key);
        return (
          <label
            key={step.key}
            className="flex items-start gap-2 text-sm text-ink-700 cursor-pointer"
          >
            <input
              type="checkbox"
              className="rounded border-slate-300 mt-0.5 shrink-0"
              checked={step.enabled}
              onChange={() => toggle(step.key)}
            />
            <span>
              <span className="font-medium text-ink-900">
                {STEP_LABELS[step.key] ?? step.key}
              </span>
              {info && (
                <>
                  <br />
                  <span className="text-xs text-slate-500">{info.breve}</span>
                </>
              )}
            </span>
          </label>
        );
      })}
    </div>
  );
}

// Delete confirm modal (inline, no external modal utility)
interface DeleteConfirmProps {
  concorso: Concorso;
  nFasi: number;
  nCandidati: number;
  nCommissari: number;
  onClose: () => void;
  onDeleted: () => void;
}

function DeleteConfirmPanel({
  concorso,
  nFasi,
  nCandidati,
  nCommissari,
  onClose,
  onDeleted,
}: DeleteConfirmProps) {
  const [confirmText, setConfirmText] = useState('');
  const deleteMutation = useDeleteConcorso();
  const match = confirmText.trim() === concorso.nome.trim();

  const handleDelete = async () => {
    if (!match) return;
    try {
      await deleteMutation.mutateAsync({ id: concorso.id, force: true });
      toast.success('Concorso eliminato');
      onDeleted();
    } catch (err) {
      toast.error(httpErrorMessage(err));
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="bg-white rounded-2xl shadow-2xl max-w-md w-full p-6 space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-base font-semibold text-rose-900 flex items-center gap-2">
            <AlertTriangle size={18} className="text-rose-600" />
            Conferma eliminazione definitiva
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="text-ink-500 hover:text-ink-900"
          >
            <X size={18} />
          </button>
        </div>

        <div className="bg-rose-50 border border-rose-200 rounded-2xl p-4 text-sm text-rose-900">
          <p className="font-semibold mb-2">
            Stai per cancellare <strong>{concorso.nome}</strong> dal database.
          </p>
          <ul className="text-xs space-y-1 list-disc pl-5">
            <li>{nCandidati} candidati e tutte le loro valutazioni</li>
            <li>{nFasi} fasi con criteri e risultati</li>
            <li>{nCommissari} commissari assegnati a questo concorso</li>
            <li>tutte le iscrizioni pubbliche ricevute (incluse pending)</li>
          </ul>
          <p className="text-xs mt-3">
            <strong>L&apos;operazione non è annullabile.</strong> Esegui un backup
            prima di procedere se hai dubbi.
          </p>
        </div>

        <label className="block">
          <span className="text-sm font-medium text-ink-800">
            Per confermare, digita il nome esatto del concorso:
          </span>
          <p className="font-mono text-sm bg-slate-100 border border-slate-200 rounded px-2 py-1 mt-1 mb-2 select-all">
            {concorso.nome}
          </p>
          <input
            type="text"
            autoComplete="off"
            autoCapitalize="off"
            spellCheck={false}
            className="c-input w-full focus:ring-2 focus:ring-rose-500 focus:border-rose-500"
            placeholder="Scrivi qui il nome..."
            value={confirmText}
            onChange={(e) => setConfirmText(e.target.value)}
          />
        </label>

        <div className="flex justify-end gap-3">
          <button
            type="button"
            className="c-btn c-btn--outline c-btn--sm"
            onClick={onClose}
          >
            Annulla
          </button>
          <button
            type="button"
            className={[
              'c-btn c-btn--sm',
              match
                ? 'bg-rose-600 hover:bg-rose-700 text-white border-rose-600'
                : 'opacity-50 cursor-not-allowed bg-rose-300 text-white border-rose-300',
            ].join(' ')}
            disabled={!match || deleteMutation.isPending}
            onClick={handleDelete}
          >
            {deleteMutation.isPending ? 'Eliminazione…' : 'Elimina definitivamente'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Stats mini-query
// ---------------------------------------------------------------------------

function useStats(concorsoId: string) {
  const fasi = useQuery({
    queryKey: ['fasi', concorsoId, 'count'],
    queryFn: () => http.get<FaseCountRaw[]>('fasi', { concorsoId, limit: 1000 }),
    enabled: !!concorsoId,
    staleTime: 60_000,
  });
  const candidati = useQuery({
    queryKey: ['candidati', concorsoId, 'count'],
    queryFn: () => http.get<CandidatoCountRaw[]>('candidati', { concorsoId, limit: 1000 }),
    enabled: !!concorsoId,
    staleTime: 60_000,
  });
  const commissari = useQuery({
    queryKey: ['commissari', concorsoId, 'count'],
    queryFn: () => http.get<CommissarioCountRaw[]>('commissari', { concorsoId, limit: 1000 }),
    enabled: !!concorsoId,
    staleTime: 60_000,
  });

  return {
    nFasi: fasi.data?.length ?? 0,
    nCandidati: candidati.data?.length ?? 0,
    nCommissari: commissari.data?.length ?? 0,
  };
}

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------

export function ImpostazioniConcorsoTab({ concorsoId }: { concorsoId: string }) {
  const qc = useQueryClient();

  // ── Remote data ─────────────────────────────────────────────────────────────
  const { data: concorso, isLoading, isError } = useConcorso(concorsoId);
  const updateMutation = useUpdateConcorso();

  // ── Stats (read-only) ────────────────────────────────────────────────────────
  const { nFasi, nCandidati, nCommissari } = useStats(concorsoId);

  // ── Logo local state ─────────────────────────────────────────────────────────
  const logoInputRef = useRef<HTMLInputElement>(null);
  const [pendingLogo, setPendingLogo] = useState<{ dataURL: string; name: string } | null>(null);

  // ── Delete confirm dialog ────────────────────────────────────────────────────
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  // ── Form ─────────────────────────────────────────────────────────────────────
  const {
    register,
    handleSubmit,
    control,
    reset,
    watch,
    setValue,
    formState: { errors, isDirty, isSubmitting },
  } = useForm<FormValues>({
    resolver: zodResolver(schema) as unknown as Resolver<FormValues>,
    defaultValues: concorso ? concorsoToFormValues(concorso) : undefined,
  });

  // Re-seed form when remote data loads
  const [seeded, setSeeded] = useState(false);
  if (concorso && !seeded) {
    reset(concorsoToFormValues(concorso));
    setSeeded(true);
  }

  const tiebreakSteps = watch('tiebreakSteps') ?? [];

  // ── Logo change handler ──────────────────────────────────────────────────────
  const handleLogoChange = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;
      if (file.size > 5 * 1024 * 1024) {
        toast.error('Il logo supera i 5 MB');
        if (logoInputRef.current) logoInputRef.current.value = '';
        return;
      }
      try {
        const dataURL = await readImageResized(file, 800, 0.85);
        setPendingLogo({ dataURL, name: file.name });
      } catch {
        toast.error('Errore caricamento logo');
      }
    },
    [],
  );

  // ── Reset handler ────────────────────────────────────────────────────────────
  const handleReset = useCallback(() => {
    if (concorso) {
      reset(concorsoToFormValues(concorso));
      setPendingLogo(null);
      if (logoInputRef.current) logoInputRef.current.value = '';
    }
  }, [concorso, reset]);

  // ── Submit ───────────────────────────────────────────────────────────────────
  const onSubmit = useCallback(
    async (values: FormValues) => {
      const patch: Record<string, unknown> = {
        nome: values.nome,
        anno: values.anno ?? undefined,
        dataInizio: values.dataInizio || null,
        stato: values.stato,
        anonimo: values.anonimo,
        iscrizioniAperte: values.iscrizioniAperte,
        // Column is date-only on server: send date portion only to avoid TZ drift
        iscrizioniScadenza: values.iscrizioniChiusura
          ? values.iscrizioniChiusura.slice(0, 10)
          : null,
        defaultTiebreakStrategy: values.tiebreakSteps,
      };

      if (pendingLogo) {
        patch.logo = pendingLogo.dataURL;
      }

      try {
        await updateMutation.mutateAsync({ id: concorsoId, body: patch });
        // Invalidate list + detail
        void qc.invalidateQueries({ queryKey: CONCORSI_QUERY_KEY });
        void qc.invalidateQueries({ queryKey: concorsoQueryKey(concorsoId) });
        setPendingLogo(null);
        if (logoInputRef.current) logoInputRef.current.value = '';
        toast.success('Concorso aggiornato');
      } catch (err) {
        toast.error(httpErrorMessage(err));
      }
    },
    [concorsoId, pendingLogo, updateMutation, qc],
  );

  // ── Render states ────────────────────────────────────────────────────────────
  if (isLoading) {
    return (
      <div className="max-w-3xl space-y-6 animate-pulse">
        {[1, 2, 3].map((i) => (
          <div key={i} className="bg-white border border-slate-200 rounded-2xl p-5 h-28" />
        ))}
      </div>
    );
  }

  if (isError || !concorso) {
    return (
      <div className="max-w-3xl">
        <div className="bg-rose-50 border border-rose-200 rounded-2xl p-5 text-sm text-rose-900">
          Impossibile caricare le impostazioni del concorso.
        </div>
      </div>
    );
  }

  const logoPreviewSrc = pendingLogo?.dataURL ?? (concorso.logoUrl ? fileUrl(concorso.logoUrl) : null);

  return (
    <div className="max-w-3xl space-y-6" data-impostazioni-concorso>
      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <header>
        <h3 className="text-base font-semibold text-ink-900 flex items-center gap-2">
          <Settings size={16} className="text-ink-500" />
          Impostazioni del concorso
        </h3>
        <p className="text-sm text-ink-700 mt-1">
          Modifica anagrafica, branding e gestione del concorso selezionato.
          Le modifiche vengono salvate cliccando &ldquo;Salva&rdquo; in fondo alla pagina.
        </p>
      </header>

      <form onSubmit={handleSubmit(onSubmit as SubmitHandler<FormValues>)} noValidate className="space-y-6">

        {/* ── 1. Logo ──────────────────────────────────────────────────────── */}
        <section className="bg-white border border-slate-200 rounded-2xl p-5">
          <p className="text-[11px] uppercase tracking-wide font-semibold text-ink-500 mb-3">
            Logo del concorso
          </p>
          <div className="flex items-start gap-4">
            <div className="w-24 h-24 rounded-xl bg-slate-50 border border-brand-100 flex items-center justify-center overflow-hidden shrink-0">
              {logoPreviewSrc ? (
                <img
                  src={logoPreviewSrc}
                  alt=""
                  className="w-full h-full object-contain"
                />
              ) : (
                <span className="text-slate-400">
                  <Upload size={28} />
                </span>
              )}
            </div>
            <div className="flex-1 min-w-0">
              <label className="c-btn c-btn--outline c-btn--sm cursor-pointer inline-flex items-center gap-1.5">
                <Upload size={14} />
                <span>{logoPreviewSrc ? 'Sostituisci logo' : 'Scegli logo'}</span>
                <input
                  ref={logoInputRef}
                  type="file"
                  accept="image/png,image/jpeg,image/webp,image/svg+xml"
                  className="hidden"
                  onChange={handleLogoChange}
                />
              </label>
              {pendingLogo && (
                <p className="text-xs text-brand-600 mt-1 truncate max-w-xs">
                  Nuovo logo: {pendingLogo.name}
                </p>
              )}
              <p className="text-xs text-ink-700 mt-2">
                Sostituisce il logo applicativo nelle stampe PDF e nell&apos;header dell&apos;app.
                PNG, JPG, WebP o SVG. Max 5 MB.
              </p>
            </div>
          </div>
        </section>

        {/* ── 2. Anagrafica ────────────────────────────────────────────────── */}
        <section className="bg-white border border-slate-200 rounded-2xl p-5 space-y-4">
          <p className="text-[11px] uppercase tracking-wide font-semibold text-ink-500">
            Anagrafica
          </p>

          <div className="c-field">
            <label htmlFor="nome" className="c-field__label">
              Nome del concorso
            </label>
            <input
              id="nome"
              type="text"
              className="c-input"
              placeholder="Es: Concorso Nazionale 2026"
              {...register('nome')}
            />
            {errors.nome && (
              <p className="text-xs text-rose-600 mt-1">{errors.nome.message}</p>
            )}
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div className="c-field">
              <label htmlFor="anno" className="c-field__label">
                Anno
              </label>
              <input
                id="anno"
                type="number"
                min={2000}
                max={2100}
                className="c-input"
                {...register('anno')}
              />
              {errors.anno && (
                <p className="text-xs text-rose-600 mt-1">{String(errors.anno.message)}</p>
              )}
            </div>

            <div className="c-field">
              <label htmlFor="dataInizio" className="c-field__label flex items-center gap-1">
                <Calendar size={12} />
                Data inizio
              </label>
              <input
                id="dataInizio"
                type="date"
                className="c-input"
                {...register('dataInizio')}
              />
            </div>

            <div className="c-field">
              <label htmlFor="stato" className="c-field__label">
                Stato
              </label>
              <select id="stato" className="c-input" {...register('stato')}>
                <option value="ATTIVO">ATTIVO</option>
                <option value="CONCLUSO">CONCLUSO</option>
                <option value="SOSPESO">SOSPESO</option>
                <option value="CHIUSO">CHIUSO</option>
              </select>
            </div>
          </div>
        </section>

        {/* ── 3. Modalità di valutazione ───────────────────────────────────── */}
        <section className="bg-white border border-slate-200 rounded-2xl p-5 space-y-3">
          <p className="text-[11px] uppercase tracking-wide font-semibold text-ink-500">
            Modalità di valutazione
          </p>
          <Controller
            name="anonimo"
            control={control}
            render={({ field }) => (
              <label className="flex items-start gap-2 text-sm text-ink-700 cursor-pointer">
                <input
                  type="checkbox"
                  className="rounded border-slate-300 mt-0.5"
                  checked={field.value}
                  onChange={(e) => field.onChange(e.target.checked)}
                />
                <span>
                  <span className="font-medium text-ink-900 flex items-center gap-1">
                    <EyeOff size={14} />
                    Modalità anonima
                  </span>
                  <br />
                  <span className="text-xs text-slate-500">
                    Nasconde i nomi dei candidati ai commissari: durante la votazione vedono
                    solo il numero progressivo. Utile per concorsi che richiedono valutazione
                    cieca.
                  </span>
                </span>
              </label>
            )}
          />
        </section>

        {/* ── 4. Iscrizioni pubbliche ──────────────────────────────────────── */}
        <section className="bg-white border border-slate-200 rounded-2xl p-5 space-y-4">
          <p className="text-[11px] uppercase tracking-wide font-semibold text-ink-500">
            Iscrizioni pubbliche
          </p>
          <p className="text-xs text-slate-500 leading-snug">
            Quando aperte, il form auto-service all&apos;indirizzo{' '}
            <code className="bg-slate-100 px-1 rounded">/#/iscrizione</code> accetta
            nuove iscrizioni. Lasciale chiuse per concorsi non ancora pubblicizzati o già pieni.
          </p>

          <Controller
            name="iscrizioniAperte"
            control={control}
            render={({ field }) => (
              <label className="flex items-center gap-2 text-sm text-ink-700 cursor-pointer">
                <input
                  type="checkbox"
                  className="rounded border-slate-300"
                  checked={field.value}
                  onChange={(e) => field.onChange(e.target.checked)}
                />
                <span>Accetta iscrizioni dal frontend pubblico</span>
              </label>
            )}
          />

          <div className="c-field">
            <label htmlFor="iscrizioniChiusura" className="c-field__label">
              Data/ora di chiusura iscrizioni{' '}
              <span className="text-slate-400">(opzionale)</span>
            </label>
            <input
              id="iscrizioniChiusura"
              type="datetime-local"
              className="c-input"
              {...register('iscrizioniChiusura')}
            />
            <span className="text-[11px] text-slate-500 mt-1 block">
              Oltre questa data il form pubblico chiude le iscrizioni automaticamente.
              Lascia vuoto per nessun limite temporale.
            </span>
          </div>
        </section>

        {/* ── 5. Tiebreak default ──────────────────────────────────────────── */}
        <section className="bg-white border border-slate-200 rounded-2xl p-5 space-y-3">
          <p className="text-[11px] uppercase tracking-wide font-semibold text-ink-500">
            Regole di rottura della parità (default)
          </p>
          <p className="text-xs text-slate-500 leading-snug">
            Cascata di default applicata a ogni fase del concorso. Ogni fase può comunque
            sovrascrivere questa policy nelle proprie impostazioni.
          </p>
          <TiebreakEditor
            steps={tiebreakSteps}
            onChange={(steps) => setValue('tiebreakSteps', steps, { shouldDirty: true })}
          />
        </section>

        {/* ── 6. Save bar (sticky bottom) ──────────────────────────────────── */}
        <div className="flex justify-end gap-3 sticky bottom-0 bg-gradient-to-t from-white via-white pt-3 -mt-1 pb-2">
          <button
            type="button"
            className="c-btn c-btn--outline c-btn--sm"
            onClick={handleReset}
            disabled={isSubmitting}
          >
            Annulla modifiche
          </button>
          <button
            type="submit"
            className="c-btn c-btn--primary flex items-center gap-1.5"
            disabled={isSubmitting || (!isDirty && !pendingLogo)}
          >
            <Save size={14} />
            <span>{isSubmitting ? 'Salvataggio…' : 'Salva impostazioni'}</span>
          </button>
        </div>
      </form>

      {/* ── 7. Statistiche ──────────────────────────────────────────────────── */}
      <section className="bg-white border border-slate-200 rounded-2xl p-5">
        <p className="text-[11px] uppercase tracking-wide font-semibold text-ink-500 mb-3">
          Statistiche
        </p>
        <div className="grid grid-cols-3 gap-3 text-sm">
          {(
            [
              { label: 'Fasi', value: nFasi },
              { label: 'Candidati', value: nCandidati },
              { label: 'Commissari', value: nCommissari },
            ] as const
          ).map(({ label, value }) => (
            <div
              key={label}
              className="text-center bg-slate-50 border border-slate-200 rounded-lg px-3 py-3"
            >
              <div className="text-2xl font-bold text-ink-900">{value}</div>
              <div className="text-[11px] text-ink-700 uppercase tracking-wide mt-1">
                {label}
              </div>
            </div>
          ))}
        </div>
        {concorso.dataInizio && (
          <p className="text-xs text-ink-700 mt-3">
            Data inizio prevista:{' '}
            <span className="font-medium text-ink-900">
              {new Date(concorso.dataInizio).toLocaleDateString('it-IT', {
                day: '2-digit',
                month: 'long',
                year: 'numeric',
              })}
            </span>
          </p>
        )}
      </section>

      {/* ── 8. Zona pericolosa ──────────────────────────────────────────────── */}
      <section className="bg-rose-50 border border-rose-200 rounded-2xl p-5">
        <div className="flex items-start gap-3">
          <span className="text-rose-700 shrink-0">
            <AlertTriangle size={20} />
          </span>
          <div className="flex-1">
            <h4 className="text-sm font-semibold text-rose-900">Zona pericolosa</h4>
            <p className="text-sm text-rose-800 mt-1">
              Eliminare il concorso rimuove anche tutti i dati associati (fasi, candidati,
              valutazioni). Operazione irreversibile.
            </p>
            <button
              type="button"
              className="c-btn c-btn--sm mt-3 bg-rose-600 hover:bg-rose-700 text-white border-rose-600"
              onClick={() => setShowDeleteConfirm(true)}
            >
              Elimina concorso
            </button>
          </div>
        </div>
      </section>

      {/* ── Delete confirm overlay ───────────────────────────────────────────── */}
      {showDeleteConfirm && (
        <DeleteConfirmPanel
          concorso={concorso}
          nFasi={nFasi}
          nCandidati={nCandidati}
          nCommissari={nCommissari}
          onClose={() => setShowDeleteConfirm(false)}
          onDeleted={() => {
            setShowDeleteConfirm(false);
            // Navigate away: dispatch a hashchange like the vanilla app does
            window.dispatchEvent(new HashChangeEvent('hashchange'));
          }}
        />
      )}
    </div>
  );
}
