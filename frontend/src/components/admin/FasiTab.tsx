// =============================================================================
// FasiTab — gestione fasi del concorso (admin)
//
// Porta js/views/admin/fasi.js su React 19 + TS + TanStack Query + RHF/Zod.
// Layout/classi replicano la sorgente vanilla (c-tile, c-btn, c-tag, c-field,
// brand/ink palette, design-system classes).
// =============================================================================

import { useState, useEffect, useCallback } from 'react';
import { useForm, useFieldArray, type Resolver } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod/v4';
import { toast } from 'sonner';
import { useQueryClient } from '@tanstack/react-query';
import {
  Plus, Pencil, Trash2, ChevronUp, ChevronDown,
  Play, StopCircle, Shuffle, TriangleAlert,
} from 'lucide-react';

import { cn } from '@/lib/utils';
import { httpErrorMessage } from '@/lib/api';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from '@/components/ui/dialog';
import {
  useFasi,
  createFase,
  updateFase,
  deleteFase,
  startFase,
  concludiFase,
  sorteggiaFase,
  reorderFasi,
  syncCriteri,
  FASI_QUERY_KEY,
  type FaseRecord,
  type CreateFaseBody,
  type UpdateFaseBody,
} from '@/api/fasi';
import type { FaseStato } from '@/types';
import type { CriterioInput } from '@/api/criteri';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

// Metodi media — chiavi e descrizioni ESATTE da js/scoring.js (METODI_MEDIA).
const METODI_MEDIA = [
  {
    key: 'aritmetica',
    nome: 'Media aritmetica',
    breve: 'Somma dei voti diviso n. Semplice e trasparente.',
  },
  {
    key: 'olimpica',
    nome: 'Media olimpica',
    breve: 'Scarta il voto più alto e il più basso, media aritmetica dei restanti.',
  },
  {
    key: 'winsorizzata',
    nome: 'Media winsorizzata',
    breve: 'Limita gli estremi al secondo valore più alto/basso, poi fa la media aritmetica.',
  },
  {
    key: 'mediana',
    nome: 'Mediana',
    breve: "Valore in posizione (n+1)/2 dopo l'ordinamento. Robusta agli outlier.",
  },
  {
    key: 'deviazione_std',
    nome: 'Filtro deviazione standard',
    breve: 'Scarta i voti oltre 1 deviazione standard dalla media, poi rifà la media.',
  },
] as const;

const STATO_COLORS: Record<FaseStato, string> = {
  PIANIFICATA: 'bg-slate-100 text-slate-700 border-slate-200',
  IN_CORSO: 'bg-blue-100 text-blue-800 border-blue-200',
  CONCLUSA: 'bg-emerald-100 text-emerald-800 border-emerald-200',
};

const DEFAULT_CRITERI: CriterioInput[] = [
  { nome: 'Tecnica', peso: 35 },
  { nome: 'Interpretazione', peso: 35 },
  { nome: 'Intonazione', peso: 15 },
  { nome: 'Musicalità', peso: 15 },
];

// ---------------------------------------------------------------------------
// Zod schema + hand-written form value types
// ---------------------------------------------------------------------------

interface CriterioFV {
  nome: string;
  descrizione?: string;
  peso: number;
}

interface FaseFormValues {
  nome: string;
  ordine: number;
  ammessi: number | '';
  dataPrevista?: string;
  scala: number;
  modoValutazione: 'autonoma' | 'sincrona';
  metodoMedia: string;
  tempoMinuti: number | '';
  criteri: CriterioFV[];
}

const criterioSchema = z.object({
  nome: z.string().min(1, 'Etichetta obbligatoria'),
  descrizione: z.string().optional(),
  peso: z.preprocess((v) => (v === '' ? 0 : Number(v)), z.number().int().min(0).max(100)),
});

const faseSchema = z.object({
  nome: z.string().min(1, 'Nome obbligatorio').max(255),
  ordine: z.preprocess((v) => Number(v), z.number().int().min(1)),
  ammessi: z.preprocess(
    (v) => (v === '' || v === null || v === undefined ? '' : Number(v)),
    z.union([z.literal(''), z.number().int().min(1)]),
  ).optional(),
  dataPrevista: z.string().optional(),
  scala: z.preprocess((v) => Number(v), z.number().int().min(1).max(1000)),
  modoValutazione: z.enum(['autonoma', 'sincrona']),
  metodoMedia: z.string().min(1),
  tempoMinuti: z.preprocess(
    (v) => (v === '' || v === null || v === undefined ? '' : Number(v)),
    z.union([z.literal(''), z.number().int().min(0)]),
  ).optional(),
  criteri: z.array(criterioSchema).min(1, 'Almeno un criterio richiesto'),
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function prettyStato(stato: FaseStato): string {
  return stato.replace(/_/g, ' ');
}

function fmtDate(iso: string | null | undefined): string {
  if (!iso) return '';
  try {
    return new Date(iso).toLocaleDateString('it-IT', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
    });
  } catch {
    return iso;
  }
}

function formDefaultsFromFase(fase: FaseRecord | null, nextOrdine: number): FaseFormValues {
  if (!fase) {
    return {
      nome: '',
      ordine: nextOrdine,
      ammessi: '',
      dataPrevista: '',
      scala: 10,
      modoValutazione: 'autonoma',
      metodoMedia: 'aritmetica',
      tempoMinuti: '',
      criteri: DEFAULT_CRITERI,
    };
  }
  return {
    nome: fase.nome,
    ordine: fase.ordine,
    ammessi: fase.ammessi ?? '',
    dataPrevista: fase.dataPrevista ?? '',
    scala: fase.scala,
    modoValutazione: (fase.modoValutazione ?? 'autonoma'),
    metodoMedia: fase.metodoMedia ?? 'aritmetica',
    tempoMinuti: fase.tempoMinuti ?? '',
    criteri: DEFAULT_CRITERI,
  };
}

// ---------------------------------------------------------------------------
// CriteriEditor
// ---------------------------------------------------------------------------

interface CriteriEditorProps {
  value: { nome: string; descrizione?: string; peso: number }[];
  onChange: (v: { nome: string; descrizione?: string; peso: number }[]) => void;
  errors?: { nome?: { message?: string }; peso?: { message?: string } }[];
}

function CriteriEditor({ value, onChange, errors }: CriteriEditorProps) {
  const totalPeso = value.reduce((s, c) => s + (Number(c.peso) || 0), 0);

  const update = (idx: number, field: 'nome' | 'peso' | 'descrizione', val: string | number) => {
    const next = value.map((c, i) => (i === idx ? { ...c, [field]: val } : c));
    onChange(next);
  };

  const add = () => onChange([...value, { nome: '', peso: 0 }]);

  const remove = (idx: number) => {
    if (value.length <= 1) return;
    onChange(value.filter((_, i) => i !== idx));
  };

  return (
    <div className="space-y-2">
      {/* Header row */}
      <div className="grid grid-cols-12 gap-2 items-center px-1">
        <span className="col-span-5 text-[10px] font-bold uppercase tracking-wider text-slate-500">
          Etichetta
        </span>
        <span className="col-span-5 text-[10px] font-bold uppercase tracking-wider text-slate-500">
          Descrizione (opz.)
        </span>
        <span className="col-span-2 text-[10px] font-bold uppercase tracking-wider text-slate-500 text-right">
          Peso %
        </span>
      </div>

      {value.map((c, idx) => (
        <div key={idx} className="grid grid-cols-12 gap-2 items-start">
          <div className="col-span-5">
            <input
              type="text"
              value={c.nome}
              onChange={(e) => update(idx, 'nome', e.target.value)}
              placeholder="Tecnica"
              className={cn('c-input', errors?.[idx]?.nome && 'border-rose-400')}
            />
            {errors?.[idx]?.nome && (
              <p className="text-[10px] text-rose-600 mt-0.5">{errors[idx].nome?.message}</p>
            )}
          </div>
          <div className="col-span-5">
            <input
              type="text"
              value={c.descrizione ?? ''}
              onChange={(e) => update(idx, 'descrizione', e.target.value)}
              placeholder="Opzionale"
              className="c-input"
            />
          </div>
          <div className="col-span-2 flex items-center gap-1">
            <div className="relative flex-1">
              <input
                type="number"
                min={0}
                max={100}
                step={1}
                value={c.peso}
                onChange={(e) => update(idx, 'peso', Number(e.target.value))}
                className={cn('c-input pr-5', errors?.[idx]?.peso && 'border-rose-400')}
              />
              <span className="absolute right-2 top-1/2 -translate-y-1/2 text-[10px] text-slate-400 pointer-events-none">
                %
              </span>
            </div>
            <button
              type="button"
              onClick={() => remove(idx)}
              disabled={value.length <= 1}
              className="h-8 w-7 flex items-center justify-center rounded text-rose-600 hover:bg-rose-50 disabled:opacity-30 transition-colors shrink-0"
              title="Rimuovi criterio"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      ))}

      {/* Total + add */}
      <div className="flex items-center justify-between pt-1 border-t border-slate-200">
        <button
          type="button"
          onClick={add}
          className="inline-flex items-center gap-1 text-xs font-medium text-brand-700 hover:text-brand-900"
        >
          <Plus className="h-3.5 w-3.5" />
          Aggiungi criterio
        </button>
        <span
          className={cn(
            'text-xs font-mono font-bold',
            totalPeso === 100 ? 'text-emerald-600' : 'text-amber-600',
          )}
        >
          Totale: {totalPeso}%
          {totalPeso !== 100 && (
            <span className="ml-1 font-normal text-amber-600">(consigliato 100)</span>
          )}
        </span>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// ConfirmDialog
// ---------------------------------------------------------------------------

interface ConfirmDialogProps {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  title: string;
  description: string;
  confirmLabel?: string;
  danger?: boolean;
  onConfirm: () => void | Promise<void>;
  loading?: boolean;
}

function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel = 'Conferma',
  danger = false,
  onConfirm,
  loading = false,
}: ConfirmDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <button
            type="button"
            className="c-btn c-btn--outline"
            onClick={() => onOpenChange(false)}
            disabled={loading}
          >
            Annulla
          </button>
          <button
            type="button"
            className={cn('c-btn', danger ? 'c-btn--danger' : 'c-btn--primary')}
            onClick={async () => {
              await onConfirm();
              onOpenChange(false);
            }}
            disabled={loading}
          >
            {loading ? 'Attendere…' : confirmLabel}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// SectionHeader — numbered section label (form helper)
// ---------------------------------------------------------------------------

function SectionHeader({ num, title }: { num: number; title: string }) {
  return (
    <div className="flex items-center gap-2 mb-3">
      <span className="w-6 h-6 rounded-full bg-brand-100 text-brand-700 text-xs font-bold inline-flex items-center justify-center shrink-0">
        {num}
      </span>
      <h3 className="font-semibold text-slate-900">{title}</h3>
    </div>
  );
}

// ---------------------------------------------------------------------------
// NumericCard — card numerica con preset (scala / tempo / ammessi)
// ---------------------------------------------------------------------------

interface NumericCardProps {
  icon: string;
  title: string;
  desc: string;
  tip?: string;
  value: string | number;
  min: number;
  max: number;
  suffix?: string | null;
  presets: { v: string | number; label: string }[];
  onChange: (v: string | number) => void;
  name: string;
  error?: string;
}

function NumericCard({ icon, title, desc, tip, value, min, max, suffix, presets, onChange, name, error }: NumericCardProps) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-3 flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <span className="text-xl" aria-hidden="true">{icon}</span>
        <p className="font-semibold text-sm text-slate-900">{title}</p>
      </div>
      <p className="text-[11px] text-slate-600 leading-snug">{desc}</p>
      <div className="relative">
        <input
          type="number"
          name={name}
          min={min}
          max={max}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className={cn('c-input text-lg font-bold tabular-nums', suffix && 'pr-10', error && 'border-rose-400')}
        />
        {suffix && (
          <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-slate-400 pointer-events-none">
            {suffix}
          </span>
        )}
      </div>
      {error && <p className="text-[11px] text-rose-600">{error}</p>}
      {tip && (
        <p
          className="text-[11px] text-slate-500 leading-snug"
          dangerouslySetInnerHTML={{ __html: tip }}
        />
      )}
      <div className="flex gap-1 flex-wrap">
        {presets.map((p) => (
          <button
            key={String(p.v)}
            type="button"
            onClick={() => onChange(p.v)}
            className="text-[11px] font-medium px-2 py-0.5 rounded bg-slate-100 hover:bg-brand-100 hover:text-brand-700 transition-colors"
          >
            {p.label}
          </button>
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// FaseFormDialog
// ---------------------------------------------------------------------------

interface FaseFormDialogProps {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  concorsoId: string;
  existing?: FaseRecord;
  nextOrdine: number;
  onSaved: () => void;
}

function FaseFormDialog({
  open,
  onOpenChange,
  concorsoId,
  existing,
  nextOrdine,
  onSaved,
}: FaseFormDialogProps) {
  const isEdit = !!existing;
  const qc = useQueryClient();
  const [saving, setSaving] = useState(false);

  const {
    register,
    handleSubmit,
    control,
    watch,
    setValue,
    reset,
    formState: { errors },
  } = useForm<FaseFormValues>({
    resolver: zodResolver(faseSchema) as unknown as Resolver<FaseFormValues>,
    defaultValues: formDefaultsFromFase(existing ?? null, nextOrdine),
  });

  const { fields: _fields, replace } = useFieldArray({ control, name: 'criteri' });
  const criteriFV = watch('criteri');
  const modoValutazione = watch('modoValutazione');
  const metodoMedia = watch('metodoMedia');
  const scala = watch('scala');
  const tempoMinuti = watch('tempoMinuti');
  const ammessi = watch('ammessi');

  useEffect(() => {
    if (open) {
      const defaults = formDefaultsFromFase(existing ?? null, nextOrdine);
      reset(defaults);
    }
  }, [open, existing, nextOrdine, reset]);

  const onSubmit = async (values: FaseFormValues) => {
    setSaving(true);
    try {
      const ammesiVal =
        values.ammessi === '' || values.ammessi === undefined
          ? null
          : Number(values.ammessi);
      const tempoMinutiVal =
        values.tempoMinuti === '' || values.tempoMinuti === undefined
          ? null
          : Number(values.tempoMinuti);

      const criteri: CriterioInput[] = values.criteri.map((c, i) => ({
        nome: c.nome.trim(),
        descrizione: c.descrizione?.trim() || undefined,
        peso: Number(c.peso),
        ordine: i,
      }));

      const totalPeso = criteri.reduce((s, c) => s + c.peso, 0);
      if (totalPeso !== 100) {
        const proceed = window.confirm(
          `La somma dei pesi è ${totalPeso}% (consigliato 100%). Continuare comunque?`,
        );
        if (!proceed) {
          setSaving(false);
          return;
        }
      }

      if (isEdit && existing) {
        const body: UpdateFaseBody = {
          nome: values.nome.trim(),
          ordine: values.ordine,
          ammessi: ammesiVal,
          dataPrevista: values.dataPrevista || null,
          scala: values.scala,
          modoValutazione: values.modoValutazione,
          metodoMedia: values.metodoMedia,
          tempoMinuti: tempoMinutiVal,
        };
        await updateFase(existing.id, body);
        if (criteri.length > 0) {
          await syncCriteri(existing.id, criteri);
        }
        toast.success('Fase aggiornata');
      } else {
        const body: CreateFaseBody = {
          concorsoId,
          nome: values.nome.trim(),
          ordine: values.ordine,
          ammessi: ammesiVal,
          dataPrevista: values.dataPrevista || null,
          scala: values.scala,
          modoValutazione: values.modoValutazione,
          metodoMedia: values.metodoMedia,
          tempoMinuti: tempoMinutiVal,
        };
        const created = await createFase(body);
        if (criteri.length > 0) {
          await syncCriteri(created.id, criteri);
        }
        toast.success('Fase creata');
      }

      await qc.invalidateQueries({ queryKey: FASI_QUERY_KEY(concorsoId) });
      onSaved();
      onOpenChange(false);
    } catch (e) {
      toast.error(httpErrorMessage(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>
            {isEdit ? `Modifica fase: ${existing?.nome}` : 'Nuova fase'}
          </DialogTitle>
          {isEdit && (
            <DialogDescription>
              Modifica i dettagli e i criteri di valutazione della fase.
            </DialogDescription>
          )}
        </DialogHeader>

        <form
          onSubmit={(handleSubmit as any)(onSubmit)}
          className="space-y-6 overflow-y-auto max-h-[76dvh] pr-1"
        >
          {/* ── Sezione 1: Informazioni generali ─────────────────────── */}
          <section>
            <SectionHeader num={1} title="Informazioni generali" />
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <label className="c-field">
                <span className="c-field__label">Nome <span className="text-rose-500">*</span></span>
                <input
                  type="text"
                  {...register('nome')}
                  placeholder="Eliminatoria"
                  autoFocus
                  className={cn('c-input', errors.nome && 'border-rose-400')}
                />
                {errors.nome && (
                  <p className="text-[11px] text-rose-600 mt-0.5">{errors.nome.message}</p>
                )}
              </label>

              <label className="c-field">
                <span className="c-field__label">Data prevista</span>
                <input
                  type="date"
                  {...register('dataPrevista')}
                  className="c-input"
                />
              </label>

              <label className="c-field">
                <span className="c-field__label">
                  Ordine <span className="text-rose-500">*</span>
                </span>
                <input
                  type="number"
                  min={1}
                  {...register('ordine')}
                  className={cn('c-input', errors.ordine && 'border-rose-400')}
                />
                {errors.ordine && (
                  <p className="text-[11px] text-rose-600 mt-0.5">{errors.ordine.message}</p>
                )}
              </label>

              <label className="c-field">
                <span className="c-field__label">
                  Posti fase successiva
                  <span className="ml-1 text-[11px] text-slate-500 font-normal">(vuoto = tutti)</span>
                </span>
                <input
                  type="number"
                  min={0}
                  placeholder="Tutti"
                  {...register('ammessi')}
                  className={cn('c-input', errors.ammessi && 'border-rose-400')}
                />
                {errors.ammessi && (
                  <p className="text-[11px] text-rose-600 mt-0.5">
                    {String(errors.ammessi.message ?? '')}
                  </p>
                )}
              </label>
            </div>
          </section>

          {/* ── Sezione 2: Modalità di esecuzione ────────────────────── */}
          <section>
            <SectionHeader num={2} title="Modalità di esecuzione" />

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 mb-4">
              <NumericCard
                icon="🎯"
                title="Scala di voto"
                desc="Voto massimo che un commissario può assegnare."
                tip="<strong>10</strong> è lo standard nei conservatori italiani, <strong>100</strong> nei concorsi internazionali."
                value={scala ?? 10}
                min={1}
                max={1000}
                suffix={null}
                name="scala"
                presets={[
                  { v: 10, label: '0–10' },
                  { v: 25, label: '0–25' },
                  { v: 100, label: '0–100' },
                ]}
                onChange={(v) => setValue('scala', Number(v))}
                error={errors.scala?.message}
              />

              <NumericCard
                icon="⏱"
                title="Tempo per candidato"
                desc="Minuti previsti per l'esibizione. Attiva un cronometro condiviso."
                tip="<strong>0</strong> = nessun limite cronometrato."
                value={tempoMinuti ?? ''}
                min={0}
                max={600}
                suffix="min"
                name="tempoMinuti"
                presets={[
                  { v: '', label: 'Libero' },
                  { v: 5, label: '5 min' },
                  { v: 10, label: '10 min' },
                  { v: 15, label: '15 min' },
                ]}
                onChange={(v) => setValue('tempoMinuti', v === '' ? '' : Number(v))}
              />

              <NumericCard
                icon="🏆"
                title="Posti per la fase successiva"
                desc="Quanti candidati al massimo passano alla fase seguente."
                tip="<strong>Vuoto</strong> = tutti gli ammessi dal verdetto della commissione."
                value={ammessi ?? ''}
                min={0}
                max={9999}
                suffix={null}
                name="ammessi_card"
                presets={[
                  { v: '', label: 'Tutti' },
                  { v: 5, label: 'Top 5' },
                  { v: 10, label: 'Top 10' },
                  { v: 20, label: 'Top 20' },
                ]}
                onChange={(v) => setValue('ammessi', v === '' ? '' : Number(v))}
              />
            </div>

            {/* Modalità valutazione */}
            <p className="c-field__label mb-2">Modalità di valutazione</p>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
              {(['autonoma', 'sincrona'] as const).map((modo) => {
                const isSel = modoValutazione === modo;
                return (
                  <button
                    key={modo}
                    type="button"
                    onClick={() => setValue('modoValutazione', modo)}
                    className={cn(
                      'text-left rounded-xl border px-3 py-2.5 transition-all flex items-center gap-3',
                      isSel
                        ? 'border-brand-300 bg-brand-50/40 ring-2 ring-brand-500'
                        : 'border-slate-200 hover:border-brand-300 hover:bg-brand-50/30',
                    )}
                  >
                    <span className="text-xl shrink-0" aria-hidden="true">
                      {modo === 'autonoma' ? '👤' : '🎼'}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="font-semibold text-sm text-slate-900 capitalize">{modo}</p>
                      <p className="text-[11px] text-slate-600 leading-snug">
                        {modo === 'autonoma'
                          ? 'Ogni commissario vota al proprio ritmo.'
                          : 'Tutti i commissari votano insieme guidati dal presidente.'}
                      </p>
                    </div>
                    <span className="text-brand-600 text-sm shrink-0" aria-hidden="true">
                      {isSel ? '●' : '○'}
                    </span>
                  </button>
                );
              })}
            </div>
          </section>

          {/* ── Sezione 3: Metodo di media ────────────────────────────── */}
          <section>
            <SectionHeader num={3} title="Metodo di calcolo della media" />
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {METODI_MEDIA.map((m) => {
                const isSel = metodoMedia === m.key;
                return (
                  <button
                    key={m.key}
                    type="button"
                    onClick={() => setValue('metodoMedia', m.key)}
                    className={cn(
                      'text-left rounded-xl border px-3 py-2.5 transition-all flex flex-col gap-1',
                      isSel
                        ? 'border-brand-300 bg-brand-50/40 ring-2 ring-brand-500'
                        : 'border-slate-200 hover:border-brand-300 hover:bg-brand-50/30',
                    )}
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-semibold text-sm text-slate-900">{m.nome}</span>
                      <span className="text-brand-600 text-xs" aria-hidden="true">
                        {isSel ? '●' : '○'}
                      </span>
                    </div>
                    <p className="text-[11px] text-slate-600 leading-snug">{m.breve}</p>
                  </button>
                );
              })}
            </div>
          </section>

          {/* ── Sezione 4: Criteri di valutazione ───────────────────── */}
          <section>
            <div className="flex items-center justify-between gap-2 mb-3 flex-wrap">
              <div className="flex items-center gap-2">
                <span className="w-6 h-6 rounded-full bg-brand-100 text-brand-700 text-xs font-bold inline-flex items-center justify-center shrink-0">
                  4
                </span>
                <h3 className="font-semibold text-slate-900">Criteri di valutazione</h3>
              </div>
              <p className="text-xs font-mono text-slate-600">
                Totale pesi:{' '}
                <span
                  className={cn(
                    'font-bold',
                    criteriFV.reduce((s, c) => s + (Number(c.peso) || 0), 0) === 100
                      ? 'text-emerald-600'
                      : 'text-amber-600',
                  )}
                >
                  {criteriFV.reduce((s, c) => s + (Number(c.peso) || 0), 0)}%
                </span>
              </p>
            </div>
            <p className="text-xs text-slate-600 mb-2">
              Ogni criterio contribuisce alla media finale in base al suo peso. La somma dei pesi dovrebbe essere 100%.
            </p>
            <CriteriEditor
              value={criteriFV}
              onChange={(v) => replace(v)}
              errors={errors.criteri as { nome?: { message?: string }; peso?: { message?: string } }[]}
            />
            {errors.criteri?.root && (
              <p className="text-xs text-rose-600 mt-1">{errors.criteri.root.message}</p>
            )}
          </section>

          <DialogFooter>
            <button
              type="button"
              className="c-btn c-btn--outline"
              onClick={() => onOpenChange(false)}
              disabled={saving}
            >
              Annulla
            </button>
            <button type="submit" className="c-btn c-btn--primary" disabled={saving}>
              {saving ? 'Salvataggio…' : isEdit ? 'Salva modifiche' : 'Crea fase'}
            </button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// FaseCard — card singola fase nella lista (stile vanilla faseCardHtml)
// ---------------------------------------------------------------------------

interface FaseCardProps {
  fase: FaseRecord;
  isFirst: boolean;
  isLast: boolean;
  onEdit: () => void;
  onDelete: () => void;
  onStart: () => void;
  onConclude: () => void;
  onSorteggio: () => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
}

function FaseCard({
  fase,
  isFirst,
  isLast,
  onEdit,
  onDelete,
  onStart,
  onConclude,
  onSorteggio,
  onMoveUp,
  onMoveDown,
}: FaseCardProps) {
  const stato = fase.stato ?? 'PIANIFICATA';

  return (
    <div className="bg-white border border-slate-200 rounded-2xl p-4 shadow-soft hover:shadow-md transition-shadow">
      {/* Title row */}
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-xs font-mono uppercase tracking-wider text-slate-500">
              #{fase.ordine}
            </span>
            <h3 className="font-bold text-slate-900 text-lg">{fase.nome}</h3>
            <span
              className={cn(
                'inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider border',
                STATO_COLORS[stato],
              )}
            >
              {prettyStato(stato)}
            </span>
            {fase.modoValutazione === 'sincrona' && (
              <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full bg-purple-100 text-purple-800 border border-purple-200">
                sincrona
              </span>
            )}
          </div>

          {/* Meta row */}
          <div className="mt-1 text-xs text-slate-600 flex flex-wrap gap-x-4 gap-y-1">
            <span>Scala {fase.scala}</span>
            {fase.metodoMedia && <span>Media: {fase.metodoMedia}</span>}
            {fase.ammessi != null && <span>Ammessi: {fase.ammessi}</span>}
            {fase.dataPrevista && <span>Data: {fmtDate(fase.dataPrevista)}</span>}
            {fase.tempoMinuti != null && fase.tempoMinuti > 0 && (
              <span>Tempo: {fase.tempoMinuti}′</span>
            )}
          </div>
        </div>

        {/* Action icon buttons */}
        <div className="flex items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={onMoveUp}
            disabled={isFirst}
            title="Sposta su"
            className="w-9 h-9 inline-flex items-center justify-center rounded-lg text-slate-600 bg-slate-50 hover:bg-slate-100 border border-slate-200 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <ChevronUp className="h-[18px] w-[18px]" />
          </button>
          <button
            type="button"
            onClick={onMoveDown}
            disabled={isLast}
            title="Sposta giù"
            className="w-9 h-9 inline-flex items-center justify-center rounded-lg text-slate-600 bg-slate-50 hover:bg-slate-100 border border-slate-200 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <ChevronDown className="h-[18px] w-[18px]" />
          </button>
          <button
            type="button"
            onClick={onEdit}
            title="Modifica"
            className="w-9 h-9 inline-flex items-center justify-center rounded-lg text-brand-700 bg-brand-50 hover:bg-brand-100 border border-brand-100 transition-colors"
          >
            <Pencil className="h-[18px] w-[18px]" />
          </button>
          <button
            type="button"
            onClick={onDelete}
            disabled={stato === 'IN_CORSO'}
            title={stato === 'IN_CORSO' ? 'Non eliminabile mentre è IN_CORSO' : 'Elimina'}
            className="w-9 h-9 inline-flex items-center justify-center rounded-lg text-rose-600 bg-rose-50 hover:bg-rose-100 border border-rose-100 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <Trash2 className="h-[18px] w-[18px]" />
          </button>
        </div>
      </div>

      {/* Workflow action buttons */}
      <div className="mt-3 flex flex-wrap gap-2">
        {stato === 'PIANIFICATA' && (
          <button
            type="button"
            onClick={onStart}
            className="text-xs font-medium text-white bg-emerald-600 hover:bg-emerald-700 px-3 py-1.5 rounded-md shadow-sm inline-flex items-center gap-1"
          >
            <Play className="h-3.5 w-3.5" />
            Avvia
          </button>
        )}
        {stato === 'IN_CORSO' && (
          <button
            type="button"
            onClick={onConclude}
            className="text-xs font-medium text-white bg-rose-600 hover:bg-rose-700 px-3 py-1.5 rounded-md shadow-sm inline-flex items-center gap-1"
          >
            <StopCircle className="h-3.5 w-3.5" />
            Concludi
          </button>
        )}
        {stato !== 'CONCLUSA' && (
          <button
            type="button"
            onClick={onSorteggio}
            className="text-xs font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 px-3 py-1.5 rounded-md inline-flex items-center gap-1"
          >
            <Shuffle className="h-3.5 w-3.5" />
            Sorteggio
          </button>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// FasiTab (exported)
// ---------------------------------------------------------------------------

export function FasiTab({ concorsoId }: { concorsoId: string }) {
  const qc = useQueryClient();
  const { data: fasi, isLoading, isError } = useFasi(concorsoId);

  const sorted = [...(fasi ?? [])].sort((a, b) => a.ordine - b.ordine);

  const [formDialog, setFormDialog] = useState<{
    open: boolean;
    existing?: FaseRecord;
  }>({ open: false });

  const [confirmState, setConfirmState] = useState<{
    open: boolean;
    title: string;
    description: string;
    confirmLabel?: string;
    danger?: boolean;
    loading: boolean;
    onConfirm: () => Promise<void>;
  }>({
    open: false,
    title: '',
    description: '',
    loading: false,
    onConfirm: async () => {},
  });

  const openConfirm = useCallback(
    (opts: {
      title: string;
      description: string;
      confirmLabel?: string;
      danger?: boolean;
      onConfirm: () => Promise<void>;
    }) => {
      setConfirmState({ open: true, loading: false, ...opts });
    },
    [],
  );

  const invalidate = useCallback(
    () => qc.invalidateQueries({ queryKey: FASI_QUERY_KEY(concorsoId) }),
    [qc, concorsoId],
  );

  // ── Reorder ───────────────────────────────────────────────────────────────
  const handleReorder = async (faseId: string, direction: 'up' | 'down') => {
    const idx = sorted.findIndex((f) => f.id === faseId);
    const newIdx = direction === 'up' ? idx - 1 : idx + 1;
    if (newIdx < 0 || newIdx >= sorted.length) return;
    const ids = sorted.map((f) => f.id);
    [ids[idx], ids[newIdx]] = [ids[newIdx], ids[idx]];
    try {
      await reorderFasi(concorsoId, ids);
      await invalidate();
    } catch (e) {
      toast.error(httpErrorMessage(e));
    }
  };

  // ── Delete ────────────────────────────────────────────────────────────────
  const handleDelete = (fase: FaseRecord) => {
    openConfirm({
      title: 'Elimina fase',
      description: `Eliminare definitivamente "${fase.nome}"? Tutte le valutazioni associate andranno perse.`,
      confirmLabel: 'Elimina',
      danger: true,
      onConfirm: async () => {
        try {
          await deleteFase(fase.id);
          toast.success('Fase eliminata');
          await invalidate();
        } catch (e) {
          toast.error(httpErrorMessage(e));
        }
      },
    });
  };

  // ── Start ─────────────────────────────────────────────────────────────────
  const handleStart = (fase: FaseRecord) => {
    openConfirm({
      title: 'Avvia fase',
      description: `Avviare "${fase.nome}"? Lo stato cambierà a IN CORSO.`,
      confirmLabel: 'Avvia',
      onConfirm: async () => {
        try {
          await startFase(fase.id);
          toast.success('Fase avviata');
          await invalidate();
        } catch (e) {
          toast.error(httpErrorMessage(e));
        }
      },
    });
  };

  // ── Conclude ──────────────────────────────────────────────────────────────
  const handleConclude = (fase: FaseRecord) => {
    openConfirm({
      title: 'Concludi fase',
      description: `Concludere "${fase.nome}"? Non sarà più modificabile.`,
      confirmLabel: 'Concludi',
      onConfirm: async () => {
        try {
          await concludiFase(fase.id);
          toast.success('Fase conclusa');
          await invalidate();
        } catch (e) {
          toast.error(httpErrorMessage(e));
        }
      },
    });
  };

  // ── Sorteggio ─────────────────────────────────────────────────────────────
  const handleSorteggio = (fase: FaseRecord) => {
    openConfirm({
      title: 'Sorteggio ordine candidati',
      description: `Generare un nuovo ordine casuale dei candidati per "${fase.nome}"?`,
      confirmLabel: 'Sorteggia',
      onConfirm: async () => {
        try {
          const result = await sorteggiaFase(fase.id);
          toast.success(`Ordine sorteggiato (seed: ${result.seed})`);
          await invalidate();
        } catch (e) {
          toast.error(httpErrorMessage(e));
        }
      },
    });
  };

  // ── Render ────────────────────────────────────────────────────────────────

  const nextOrdine = sorted.length > 0 ? (sorted[sorted.length - 1]?.ordine ?? 0) + 1 : 1;

  if (isLoading) {
    return (
      <div className="space-y-3">
        {[1, 2, 3].map((i) => (
          <div
            key={i}
            className="h-28 rounded-2xl border border-slate-200 bg-slate-50 animate-pulse"
          />
        ))}
      </div>
    );
  }

  if (isError) {
    return (
      <div className="flex items-center gap-2 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
        <TriangleAlert className="h-4 w-4 shrink-0" />
        Errore nel caricamento delle fasi.
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* ── Header ────────────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
        <p className="text-sm text-slate-600">
          {sorted.length} {sorted.length === 1 ? 'fase' : 'fasi'}
        </p>
        <button
          type="button"
          onClick={() => setFormDialog({ open: true })}
          className="c-btn c-btn--primary c-btn--sm inline-flex items-center gap-1"
        >
          <Plus className="h-4 w-4" />
          Nuova fase
        </button>
      </div>

      {/* ── Guidance banner (collapsible) ─────────────────────────────── */}
      <details
        open={sorted.length === 0}
        className="bg-brand-50/60 border border-brand-100 rounded-2xl mb-4 group"
      >
        <summary className="cursor-pointer list-none px-4 py-3 flex items-center gap-2.5 select-none">
          <span className="w-7 h-7 rounded-full bg-brand-100 text-brand-700 inline-flex items-center justify-center text-sm shrink-0">
            💡
          </span>
          <span className="text-sm font-semibold text-brand-900">Guida alle fasi del concorso</span>
          <span className="ml-auto text-brand-600 group-open:rotate-180 transition-transform text-sm" aria-hidden="true">
            ▾
          </span>
        </summary>
        <div className="px-4 pb-4 pt-1 text-[13px] text-slate-700 leading-relaxed">
          <p className="mb-3">
            Le <strong>fasi</strong> definiscono la struttura del concorso: eliminatoria, semifinale, finale.
            Ogni fase ha i propri criteri di valutazione, commissione e scala di voto.
          </p>
          <ul className="space-y-1.5 pl-1">
            <li>▶️ <strong>Avvia</strong> — passa da PIANIFICATA a IN CORSO. I commissari possono iniziare a votare.</li>
            <li>■ <strong>Concludi</strong> — chiude la fase e calcola gli ammessi alla successiva.</li>
            <li>🎲 <strong>Sorteggio</strong> — genera un ordine casuale dei candidati.</li>
            <li>↕ <strong>Riordina</strong> — cambia la sequenza delle fasi con le frecce su/giù.</li>
            <li>🏆 <strong>Ammessi</strong> — numero di candidati che passano alla fase successiva. Vuoto = tutti.</li>
          </ul>
          <p className="mt-3 text-xs text-slate-500 italic">
            Il flusso di una fase è: PIANIFICATA → IN CORSO → CONCLUSA. Una fase IN CORSO non può essere eliminata.
          </p>
        </div>
      </details>

      {/* ── Empty state ───────────────────────────────────────────────── */}
      {sorted.length === 0 ? (
        <div className="bg-white border-2 border-dashed border-slate-200 rounded-2xl p-8 sm:p-10 text-center">
          <div className="text-5xl mb-3">🎼</div>
          <h3 className="text-lg font-bold text-slate-800">Nessuna fase configurata</h3>
          <p className="text-sm text-slate-600 mt-2 max-w-xl mx-auto">
            Crea la prima fase del concorso per definire come si svolgerà la valutazione.
          </p>
          <ol className="text-left max-w-md mx-auto mt-5 space-y-2.5 text-sm text-slate-700">
            <li className="flex gap-3 items-start">
              <span className="w-5 h-5 rounded-full bg-brand-100 text-brand-700 text-xs font-bold inline-flex items-center justify-center shrink-0 mt-0.5">
                1
              </span>
              <span>Clicca <strong>Nuova fase</strong> per creare la prima fase (es. "Eliminatoria").</span>
            </li>
            <li className="flex gap-3 items-start">
              <span className="w-5 h-5 rounded-full bg-brand-100 text-brand-700 text-xs font-bold inline-flex items-center justify-center shrink-0 mt-0.5">
                2
              </span>
              <span>Configura scala di voto, criteri e commissione per ciascuna fase.</span>
            </li>
            <li className="flex gap-3 items-start">
              <span className="w-5 h-5 rounded-full bg-brand-100 text-brand-700 text-xs font-bold inline-flex items-center justify-center shrink-0 mt-0.5">
                3
              </span>
              <span>Avvia la fase quando sei pronto: i commissari potranno iniziare a votare.</span>
            </li>
          </ol>
          <button
            type="button"
            onClick={() => setFormDialog({ open: true })}
            className="mt-6 c-btn c-btn--primary inline-flex items-center gap-1.5"
          >
            <Plus className="h-4 w-4" />
            Crea la prima fase
          </button>
        </div>
      ) : (
        <div className="space-y-3">
          {sorted.map((fase, idx) => (
            <FaseCard
              key={fase.id}
              fase={fase}
              isFirst={idx === 0}
              isLast={idx === sorted.length - 1}
              onEdit={() => setFormDialog({ open: true, existing: fase })}
              onDelete={() => handleDelete(fase)}
              onStart={() => handleStart(fase)}
              onConclude={() => handleConclude(fase)}
              onSorteggio={() => handleSorteggio(fase)}
              onMoveUp={() => handleReorder(fase.id, 'up')}
              onMoveDown={() => handleReorder(fase.id, 'down')}
            />
          ))}
        </div>
      )}

      {/* ── Form dialog ───────────────────────────────────────────────── */}
      <FaseFormDialog
        open={formDialog.open}
        onOpenChange={(v) => setFormDialog((p) => ({ ...p, open: v }))}
        concorsoId={concorsoId}
        existing={formDialog.existing}
        nextOrdine={nextOrdine}
        onSaved={() => setFormDialog({ open: false })}
      />

      {/* ── Confirm dialog ────────────────────────────────────────────── */}
      <ConfirmDialog
        open={confirmState.open}
        onOpenChange={(v) => setConfirmState((p) => ({ ...p, open: v }))}
        title={confirmState.title}
        description={confirmState.description}
        confirmLabel={confirmState.confirmLabel}
        danger={confirmState.danger}
        loading={confirmState.loading}
        onConfirm={confirmState.onConfirm}
      />
    </div>
  );
}

export default FasiTab;
