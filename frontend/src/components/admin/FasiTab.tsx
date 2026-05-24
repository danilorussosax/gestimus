// =============================================================================
// FasiTab — gestione fasi del concorso (admin)
//
// Porta js/views/admin/fasi.js su React 19 + TS + TanStack Query + RHF/Zod.
// Funzionalità:
//   - Lista fasi ordinate per `ordine` con badge stato e azioni workflow
//   - Crea/Modifica fase: form completo (nome, ordine, ammessi, dataPrevista,
//     scala, modoValutazione, metodoMedia, tempoMinuti) + editor criteri live
//   - Workflow: Avvia / Concludi / Sorteggio con confirm dialog
//   - Reorder (sposta su/giù) via reorderFasi
// =============================================================================

import { useState, useEffect, useCallback } from 'react';
import { useForm, useFieldArray, type Resolver } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod/v4';
import { toast } from 'sonner';
import { useQueryClient } from '@tanstack/react-query';
import {
  Plus, Pencil, Trash2, ChevronUp, ChevronDown,
  PlayCircle, StopCircle, Shuffle, AlertTriangle,
  BarChart3,
} from 'lucide-react';

import { cn } from '@/lib/utils';
import { httpErrorMessage } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
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

const METODI_MEDIA = [
  {
    key: 'aritmetica',
    nome: 'Media aritmetica',
    breve: 'Somma dei voti diviso n. Semplice e trasparente.',
  },
  {
    key: 'olimpica',
    nome: 'Media olimpica',
    breve: 'Scarta il voto più alto e più basso, fa la media dei restanti.',
  },
  {
    key: 'troncata10',
    nome: 'Media troncata 10%',
    breve: 'Elimina il 10% estremo superiore e inferiore, fa la media.',
  },
  {
    key: 'mediana',
    nome: 'Mediana',
    breve: 'Valore centrale dell\'insieme dei voti ordinati. Robusta agli outlier.',
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
// Zod schema
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Form value types (hand-written so zodResolver generics stay clean with
// zod v4 coerce, which widens input types to unknown in some toolchains)
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
    criteri: DEFAULT_CRITERI, // overwritten by useEffect after criteri load
  };
}

// ---------------------------------------------------------------------------
// CriteriEditor — sub-component for the live criteria list
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
        <span className="col-span-5 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
          Etichetta
        </span>
        <span className="col-span-5 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
          Descrizione (opz.)
        </span>
        <span className="col-span-2 text-[10px] font-bold uppercase tracking-wider text-muted-foreground text-right">
          Peso %
        </span>
      </div>

      {value.map((c, idx) => (
        <div key={idx} className="grid grid-cols-12 gap-2 items-start">
          <div className="col-span-5">
            <Input
              value={c.nome}
              onChange={(e) => update(idx, 'nome', e.target.value)}
              placeholder="Tecnica"
              className={cn(
                'h-8 text-sm',
                errors?.[idx]?.nome && 'border-destructive',
              )}
            />
            {errors?.[idx]?.nome && (
              <p className="text-[10px] text-destructive mt-0.5">
                {errors[idx].nome?.message}
              </p>
            )}
          </div>
          <div className="col-span-5">
            <Input
              value={c.descrizione ?? ''}
              onChange={(e) => update(idx, 'descrizione', e.target.value)}
              placeholder="Opzionale"
              className="h-8 text-sm"
            />
          </div>
          <div className="col-span-2 flex items-center gap-1">
            <div className="relative flex-1">
              <Input
                type="number"
                min={0}
                max={100}
                step={1}
                value={c.peso}
                onChange={(e) => update(idx, 'peso', Number(e.target.value))}
                className={cn(
                  'h-8 text-sm pr-5',
                  errors?.[idx]?.peso && 'border-destructive',
                )}
              />
              <span className="absolute right-2 top-1/2 -translate-y-1/2 text-[10px] text-muted-foreground pointer-events-none">
                %
              </span>
            </div>
            <button
              type="button"
              onClick={() => remove(idx)}
              disabled={value.length <= 1}
              className="h-8 w-7 flex items-center justify-center rounded text-destructive hover:bg-destructive/10 disabled:opacity-30 transition-colors shrink-0"
              title="Rimuovi criterio"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      ))}

      {/* Total + add */}
      <div className="flex items-center justify-between pt-1 border-t border-border/60">
        <button
          type="button"
          onClick={add}
          className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
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
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={loading}
          >
            Annulla
          </Button>
          <Button
            variant={danger ? 'destructive' : 'default'}
            onClick={async () => {
              await onConfirm();
              onOpenChange(false);
            }}
            disabled={loading}
          >
            {loading ? 'Attendere…' : confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
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
    // Cast needed: zod v4 z.preprocess widens input types to unknown, causing
    // a mismatch between the inferred schema type and our hand-written FaseFormValues.
    resolver: zodResolver(faseSchema) as unknown as Resolver<FaseFormValues>,
    defaultValues: formDefaultsFromFase(existing ?? null, nextOrdine),
  });

  const { fields: _fields, replace } = useFieldArray({ control, name: 'criteri' });
  const criteriFV = watch('criteri');
  const modoValutazione = watch('modoValutazione');
  const metodoMedia = watch('metodoMedia');

  // Reset form whenever dialog opens with a (possibly different) fase
  useEffect(() => {
    if (open) {
      const defaults = formDefaultsFromFase(existing ?? null, nextOrdine);
      reset(defaults);
    }
  }, [open, existing, nextOrdine, reset]);

  const onSubmit = async (values: FaseFormValues) => {
    setSaving(true);
    try {
      const ammessi =
        values.ammessi === '' || values.ammessi === undefined
          ? null
          : Number(values.ammessi);
      const tempoMinuti =
        values.tempoMinuti === '' || values.tempoMinuti === undefined
          ? null
          : Number(values.tempoMinuti);

      const criteri: CriterioInput[] = values.criteri.map((c, i) => ({
        nome: c.nome.trim(),
        descrizione: c.descrizione?.trim() || undefined,
        peso: Number(c.peso),
        ordine: i,
      }));

      // Soft-warn if weights don't sum to 100 (non-blocking)
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
          ammessi,
          dataPrevista: values.dataPrevista || null,
          scala: values.scala,
          modoValutazione: values.modoValutazione,
          metodoMedia: values.metodoMedia,
          tempoMinuti,
        };
        await updateFase(existing.id, body);
        // Sync criteri atomically
        if (criteri.length > 0) {
          await syncCriteri(existing.id, criteri);
        }
        toast.success('Fase aggiornata');
      } else {
        const body: CreateFaseBody = {
          concorsoId,
          nome: values.nome.trim(),
          ordine: values.ordine,
          ammessi,
          dataPrevista: values.dataPrevista || null,
          scala: values.scala,
          modoValutazione: values.modoValutazione,
          metodoMedia: values.metodoMedia,
          tempoMinuti,
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

        { }
        <form
          onSubmit={(handleSubmit as any)(onSubmit)}
          className="space-y-6 overflow-y-auto max-h-[76dvh] pr-1"
        >
          {/* ── Sezione 1: Informazioni generali ─────────────────────── */}
          <section className="space-y-3">
            <SectionHeader num={1} title="Informazioni generali" />

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <Label htmlFor="nome" className="mb-1 block">
                  Nome <span className="text-destructive">*</span>
                </Label>
                <Input
                  id="nome"
                  {...register('nome')}
                  placeholder="Eliminatoria"
                  autoFocus
                />
                {errors.nome && (
                  <p className="mt-1 text-xs text-destructive">{errors.nome.message}</p>
                )}
              </div>

              <div>
                <Label htmlFor="ordine" className="mb-1 block">
                  Ordine <span className="text-destructive">*</span>
                </Label>
                <Input
                  id="ordine"
                  type="number"
                  min={1}
                  {...register('ordine')}
                />
                {errors.ordine && (
                  <p className="mt-1 text-xs text-destructive">{errors.ordine.message}</p>
                )}
              </div>

              <div>
                <Label htmlFor="dataPrevista" className="mb-1 block">
                  Data prevista
                </Label>
                <Input id="dataPrevista" type="date" {...register('dataPrevista')} />
              </div>

              <div>
                <Label htmlFor="ammessi" className="mb-1 block">
                  Posti fase successiva
                  <span className="ml-1 text-[11px] text-muted-foreground">(vuoto = tutti)</span>
                </Label>
                <Input
                  id="ammessi"
                  type="number"
                  min={0}
                  placeholder="Tutti"
                  {...register('ammessi')}
                />
                {errors.ammessi && (
                  <p className="mt-1 text-xs text-destructive">
                    {String(errors.ammessi.message ?? '')}
                  </p>
                )}
              </div>
            </div>
          </section>

          {/* ── Sezione 2: Modalità di esecuzione ────────────────────── */}
          <section className="space-y-3">
            <SectionHeader num={2} title="Modalità di esecuzione" />

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              {/* Scala */}
              <div className="rounded-xl border border-border bg-card p-3 space-y-2">
                <div className="flex items-center gap-2">
                  <span className="text-lg" aria-hidden>🎯</span>
                  <p className="font-semibold text-sm">Scala di voto</p>
                </div>
                <p className="text-[11px] text-muted-foreground leading-snug">
                  Voto massimo assegnabile da un commissario.
                </p>
                <Input
                  type="number"
                  min={1}
                  max={1000}
                  {...register('scala')}
                  className="text-lg font-bold tabular-nums"
                />
                {errors.scala && (
                  <p className="text-[11px] text-destructive">{errors.scala.message}</p>
                )}
                <div className="flex gap-1 flex-wrap">
                  {[10, 25, 100].map((v) => (
                    <button
                      key={v}
                      type="button"
                      onClick={() => setValue('scala', v)}
                      className="text-[11px] font-medium px-2 py-0.5 rounded bg-muted hover:bg-primary/10 hover:text-primary transition-colors"
                    >
                      0–{v}
                    </button>
                  ))}
                </div>
              </div>

              {/* Tempo */}
              <div className="rounded-xl border border-border bg-card p-3 space-y-2">
                <div className="flex items-center gap-2">
                  <span className="text-lg" aria-hidden>⏱</span>
                  <p className="font-semibold text-sm">Tempo candidato</p>
                </div>
                <p className="text-[11px] text-muted-foreground leading-snug">
                  Minuti previsti per l'esibizione. 0 = nessun limite.
                </p>
                <div className="relative">
                  <Input
                    type="number"
                    min={0}
                    max={600}
                    placeholder="0"
                    {...register('tempoMinuti')}
                    className="text-lg font-bold tabular-nums pr-10"
                  />
                  <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground pointer-events-none">
                    min
                  </span>
                </div>
                <div className="flex gap-1 flex-wrap">
                  {[
                    { v: '', label: 'Libero' },
                    { v: '5', label: '5′' },
                    { v: '10', label: '10′' },
                    { v: '15', label: '15′' },
                  ].map(({ v, label }) => (
                    <button
                      key={label}
                      type="button"
                      onClick={() => setValue('tempoMinuti', v === '' ? '' : Number(v))}
                      className="text-[11px] font-medium px-2 py-0.5 rounded bg-muted hover:bg-primary/10 hover:text-primary transition-colors"
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Modo valutazione */}
              <div className="rounded-xl border border-border bg-card p-3 space-y-2">
                <div className="flex items-center gap-2">
                  <span className="text-lg" aria-hidden>👥</span>
                  <p className="font-semibold text-sm">Modo valutazione</p>
                </div>
                <p className="text-[11px] text-muted-foreground leading-snug">
                  Autonoma = ogni commissario al proprio ritmo. Sincrona = tutti
                  votano insieme guidati dal presidente.
                </p>
                <div className="flex flex-col gap-2 pt-1">
                  {(['autonoma', 'sincrona'] as const).map((modo) => (
                    <button
                      key={modo}
                      type="button"
                      onClick={() => setValue('modoValutazione', modo)}
                      className={cn(
                        'flex items-center gap-2 rounded-lg border px-3 py-2 text-sm text-left transition-all',
                        modoValutazione === modo
                          ? 'border-primary/50 bg-primary/5 ring-1 ring-primary/30 font-semibold'
                          : 'border-border hover:bg-accent',
                      )}
                    >
                      <span className="text-base" aria-hidden>
                        {modo === 'autonoma' ? '👤' : '🎼'}
                      </span>
                      <span className="capitalize">{modo}</span>
                      <span className="ml-auto text-primary text-xs">
                        {modoValutazione === modo ? '●' : '○'}
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </section>

          {/* ── Sezione 3: Metodo di media ────────────────────────────── */}
          <section className="space-y-3">
            <SectionHeader num={3} title="Metodo di calcolo della media" />

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {METODI_MEDIA.map((m) => (
                <button
                  key={m.key}
                  type="button"
                  onClick={() => setValue('metodoMedia', m.key)}
                  className={cn(
                    'text-left rounded-xl border p-3 transition-all flex flex-col gap-1',
                    metodoMedia === m.key
                      ? 'border-primary/50 bg-primary/5 ring-1 ring-primary/30'
                      : 'border-border hover:bg-accent hover:border-primary/20',
                  )}
                >
                  <div className="flex items-center justify-between">
                    <span className="font-semibold text-sm">{m.nome}</span>
                    <span className="text-primary text-xs">
                      {metodoMedia === m.key ? '●' : '○'}
                    </span>
                  </div>
                  <p className="text-[11px] text-muted-foreground leading-snug">{m.breve}</p>
                </button>
              ))}
            </div>
          </section>

          {/* ── Sezione 4: Criteri di valutazione ───────────────────── */}
          <section className="space-y-3">
            <SectionHeader num={4} title="Criteri di valutazione" />
            <p className="text-xs text-muted-foreground">
              Ogni criterio contribuisce alla media finale in base al suo peso.
              La somma dei pesi dovrebbe essere 100%.
            </p>
            <CriteriEditor
              value={criteriFV}
              onChange={(v) => replace(v)}
              errors={errors.criteri as { nome?: { message?: string }; peso?: { message?: string } }[]}
            />
            {errors.criteri?.root && (
              <p className="text-xs text-destructive">{errors.criteri.root.message}</p>
            )}
          </section>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={saving}
            >
              Annulla
            </Button>
            <Button type="submit" disabled={saving}>
              {saving ? 'Salvataggio…' : isEdit ? 'Salva modifiche' : 'Crea fase'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// SectionHeader — numbered section label (form helper)
// ---------------------------------------------------------------------------

function SectionHeader({ num, title }: { num: number; title: string }) {
  return (
    <div className="flex items-center gap-2 pb-1 border-b border-border/60">
      <span className="h-6 w-6 rounded-full bg-primary/10 text-primary text-xs font-bold inline-flex items-center justify-center shrink-0">
        {num}
      </span>
      <h3 className="font-semibold text-sm text-foreground">{title}</h3>
    </div>
  );
}

// ---------------------------------------------------------------------------
// FaseCard — single phase row in the list
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
    <div className="rounded-2xl border border-border bg-card p-4 shadow-sm hover:shadow-md transition-shadow">
      {/* Title row */}
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-xs font-mono text-muted-foreground">
              #{fase.ordine}
            </span>
            <h3 className="font-bold text-foreground text-base truncate">{fase.nome}</h3>
            <span
              className={cn(
                'inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider border',
                STATO_COLORS[stato],
              )}
            >
              {prettyStato(stato)}
            </span>
            {fase.modoValutazione === 'sincrona' && (
              <Badge variant="secondary" className="text-[10px] uppercase tracking-wider">
                sincrona
              </Badge>
            )}
          </div>

          {/* Meta row */}
          <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
            <span>Scala {fase.scala}</span>
            {fase.metodoMedia && <span>Media: {fase.metodoMedia}</span>}
            {fase.ammessi != null && (
              <span>
                <strong>{fase.ammessi}</strong> passano
              </span>
            )}
            {fase.dataPrevista && <span>📅 {fmtDate(fase.dataPrevista)}</span>}
            {fase.tempoMinuti != null && fase.tempoMinuti > 0 && (
              <span>⏱ {fase.tempoMinuti}′</span>
            )}
          </div>
        </div>

        {/* Action icons */}
        <div className="flex items-center gap-1 shrink-0">
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 text-muted-foreground"
            onClick={onMoveUp}
            disabled={isFirst}
            title="Sposta su"
          >
            <ChevronUp className="h-4 w-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 text-muted-foreground"
            onClick={onMoveDown}
            disabled={isLast}
            title="Sposta giù"
          >
            <ChevronDown className="h-4 w-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 text-primary hover:bg-primary/10"
            onClick={onEdit}
            title="Modifica"
          >
            <Pencil className="h-4 w-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 text-destructive hover:bg-destructive/10 disabled:opacity-30"
            onClick={onDelete}
            disabled={stato === 'IN_CORSO'}
            title={stato === 'IN_CORSO' ? 'Non eliminabile mentre è IN_CORSO' : 'Elimina'}
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {/* Workflow actions */}
      <div className="mt-3 flex flex-wrap gap-2">
        {stato === 'PIANIFICATA' && (
          <Button
            size="sm"
            variant="default"
            className="bg-emerald-600 hover:bg-emerald-700 text-white h-8 px-3 text-xs"
            onClick={onStart}
          >
            <PlayCircle className="h-3.5 w-3.5 mr-1" />
            Avvia
          </Button>
        )}
        {stato === 'IN_CORSO' && (
          <Button
            size="sm"
            className="bg-rose-600 hover:bg-rose-700 text-white h-8 px-3 text-xs"
            onClick={onConclude}
          >
            <StopCircle className="h-3.5 w-3.5 mr-1" />
            Concludi
          </Button>
        )}
        {stato !== 'CONCLUSA' && (
          <Button
            size="sm"
            variant="outline"
            className="h-8 px-3 text-xs"
            onClick={onSorteggio}
          >
            <Shuffle className="h-3.5 w-3.5 mr-1" />
            Sorteggio
          </Button>
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

  // Sorted by ordine
  const sorted = [...(fasi ?? [])].sort((a, b) => a.ordine - b.ordine);

  // Dialog state
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

  // ── Reorder (move up / down) ───────────────────────────────────────────
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

  // ── Delete ────────────────────────────────────────────────────────────
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

  // ── Start ─────────────────────────────────────────────────────────────
  const handleStart = (fase: FaseRecord) => {
    openConfirm({
      title: 'Avvia fase',
      description: `Avviare "${fase.nome}"? Lo stato cambierà a IN CORSO e non sarà più possibile modificare la struttura.`,
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

  // ── Conclude ──────────────────────────────────────────────────────────
  const handleConclude = (fase: FaseRecord) => {
    openConfirm({
      title: 'Concludi fase',
      description: `Concludere "${fase.nome}"? Lo stato cambierà a CONCLUSA. Il sistema calcolerà automaticamente gli ammessi alla fase successiva in base alla classifica.`,
      confirmLabel: 'Concludi',
      danger: false,
      onConfirm: async () => {
        try {
          // admittedIds is optional — omitting lets the server use existing admission data
          await concludiFase(fase.id);
          toast.success('Fase conclusa');
          await invalidate();
        } catch (e) {
          toast.error(httpErrorMessage(e));
        }
      },
    });
  };

  // ── Sorteggio ─────────────────────────────────────────────────────────
  const handleSorteggio = (fase: FaseRecord) => {
    openConfirm({
      title: 'Sorteggio ordine candidati',
      description: `Generare un nuovo ordine casuale dei candidati per "${fase.nome}"? L'ordine attuale verrà sovrascritto.`,
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

  // ── Render ────────────────────────────────────────────────────────────

  const nextOrdine = sorted.length > 0 ? (sorted[sorted.length - 1]?.ordine ?? 0) + 1 : 1;

  if (isLoading) {
    return (
      <div className="space-y-3">
        {[1, 2, 3].map((i) => (
          <div key={i} className="h-28 rounded-2xl border border-border bg-muted/30 animate-pulse" />
        ))}
      </div>
    );
  }

  if (isError) {
    return (
      <div className="flex items-center gap-2 rounded-xl border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
        <AlertTriangle className="h-4 w-4 shrink-0" />
        Errore nel caricamento delle fasi.
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="text-sm font-bold uppercase tracking-wider text-muted-foreground">
            Fasi del concorso
          </h3>
          <p className="text-sm text-muted-foreground mt-0.5">
            {sorted.length} {sorted.length === 1 ? 'fase' : 'fasi'} · ordinate per esecuzione
          </p>
        </div>
        <Button size="sm" onClick={() => setFormDialog({ open: true })}>
          <Plus className="h-4 w-4" />
          Nuova fase
        </Button>
      </div>

      {/* Stato flow guide */}
      <div className="flex items-center gap-2 flex-wrap text-[11px] text-muted-foreground bg-muted/40 rounded-xl px-4 py-2.5 border border-border/60">
        <span className="font-semibold uppercase tracking-wider text-[10px]">Flusso:</span>
        <span className={cn('px-2 py-0.5 rounded-full border font-bold uppercase', STATO_COLORS.PIANIFICATA)}>
          PIANIFICATA
        </span>
        <span>→</span>
        <span className={cn('px-2 py-0.5 rounded-full border font-bold uppercase', STATO_COLORS.IN_CORSO)}>
          IN CORSO
        </span>
        <span>→</span>
        <span className={cn('px-2 py-0.5 rounded-full border font-bold uppercase', STATO_COLORS.CONCLUSA)}>
          CONCLUSA
        </span>
      </div>

      {/* Empty state */}
      {sorted.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-2xl border-2 border-dashed border-border py-14 text-center gap-3">
          <BarChart3 className="h-10 w-10 text-muted-foreground/40" />
          <div>
            <p className="font-semibold text-foreground">Nessuna fase configurata</p>
            <p className="text-sm text-muted-foreground mt-1 max-w-xs mx-auto">
              Crea la prima fase del concorso per definire come si svolgerà la valutazione.
            </p>
          </div>
          <Button
            size="sm"
            variant="outline"
            onClick={() => setFormDialog({ open: true })}
          >
            <Plus className="h-4 w-4" />
            Crea la prima fase
          </Button>
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

      {/* Form dialog */}
      <FaseFormDialog
        open={formDialog.open}
        onOpenChange={(v) => setFormDialog((p) => ({ ...p, open: v }))}
        concorsoId={concorsoId}
        existing={formDialog.existing}
        nextOrdine={nextOrdine}
        onSaved={() => setFormDialog({ open: false })}
      />

      {/* Confirm dialog */}
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
