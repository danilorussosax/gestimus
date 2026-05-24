// =============================================================================
// CommissioniTab — gestione commissioni + N-N sync (admin)
//
// Features:
//  - Lista commissioni con card espansa (membri, sezioni, categorie)
//  - Crea / Modifica commissione con:
//    · selezione multi-commissari
//    · selezione presidente (deve essere tra i membri)
//    · selezione sezioni
//    · toggle "includi tutte le categorie delle sezioni"
//    · selezione categorie granulare
//  - Delete
//  - Sync N-N con diff-apply (no replace-all)
// =============================================================================

import { useState, useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { toast } from 'sonner';
import {
  Plus, Pencil, Trash2, Scale, UserCircle2, AlertTriangle,
} from 'lucide-react';

import { cn } from '@/lib/utils';
import { fileUrl, httpErrorMessage } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  useCommissioni,
  useCreateCommissione,
  useUpdateCommissione,
  useDeleteCommissione,
  commissioniApi,
  type CommissioneRecord,
} from '@/api/commissioni';
import { useCommissari, type CommissarioRecord } from '@/api/commissari';
import { useSezioni, type SezioneRecord } from '@/api/sezioni';
import { useCategorie } from '@/api/categorie';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function displayName(c: Pick<CommissarioRecord, 'nome' | 'cognome'>) {
  return [c.nome, c.cognome].filter(Boolean).join(' ');
}

// ---------------------------------------------------------------------------
// Zod schema
// ---------------------------------------------------------------------------
const commissioneSchema = z.object({
  nome: z.string().min(1, 'Nome obbligatorio').max(255),
  descrizione: z.string().max(2000).optional(),
});
type CommissioneFormValues = z.infer<typeof commissioneSchema>;

// ---------------------------------------------------------------------------
// CategoriePerSezioneSelector
// Helper component rendered inside the form for per-sezione category picks
// ---------------------------------------------------------------------------
interface CatSelectorProps {
  sezione: SezioneRecord;
  selectedCatIds: Set<string>;
  onChange: (catId: string, checked: boolean) => void;
  disabled?: boolean;
}

function CategoriePerSezioneSelector({
  sezione,
  selectedCatIds,
  onChange,
  disabled = false,
}: CatSelectorProps) {
  const { data: cats } = useCategorie(sezione.id);

  if (!cats?.length) return null;

  return (
    <div className="rounded-lg border border-border bg-muted/30 p-2">
      <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground mb-1.5">
        {sezione.nome}
      </p>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-1">
        {cats.map((cat) => (
          <label
            key={cat.id}
            className={cn(
              'flex items-center gap-2 rounded-md border border-border bg-background px-2 py-1 text-xs cursor-pointer',
              'hover:bg-accent transition-colors',
              disabled && 'opacity-60 cursor-default',
              selectedCatIds.has(cat.id) && 'border-primary/40 bg-primary/5',
            )}
          >
            <Checkbox
              checked={selectedCatIds.has(cat.id)}
              onCheckedChange={(v) => onChange(cat.id, !!v)}
              disabled={disabled}
              className="h-3.5 w-3.5"
            />
            <span className="truncate">{cat.nome}</span>
          </label>
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// CommissioneFormDialog
// ---------------------------------------------------------------------------
interface FormDialogProps {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  concorsoId: string;
  allCommissari: CommissarioRecord[];
  allSezioni: SezioneRecord[];
  /** All categories per sezione (pre-fetched) */
  catsBySezione: Map<string, string[]>;
  existing?: CommissioneRecord;
}

function CommissioneFormDialog({
  open,
  onOpenChange,
  concorsoId,
  allCommissari,
  allSezioni,
  catsBySezione,
  existing,
}: FormDialogProps) {
  const isEdit = !!existing;
  const createCommissione = useCreateCommissione(concorsoId);
  const updateCommissione = useUpdateCommissione(concorsoId);

  // Multi-select state
  const [selCommissari, setSelCommissari] = useState<Set<string>>(
    new Set(existing?.commissari ?? []),
  );
  const [selSezioni, setSelSezioni] = useState<Set<string>>(new Set(existing?.sezioni ?? []));
  const [selCategorie, setSelCategorie] = useState<Set<string>>(
    new Set(existing?.categorie ?? []),
  );
  const [includeTutte, setIncludeTutte] = useState(false);
  const [presidente, setPresidente] = useState<string>(
    existing?.presidenteCommissarioId ?? '',
  );
  const [saving, setSaving] = useState(false);

  // Reset when dialog opens for a new record or different existing
  useEffect(() => {
    if (open) {
      setSelCommissari(new Set(existing?.commissari ?? []));
      setSelSezioni(new Set(existing?.sezioni ?? []));
      setSelCategorie(new Set(existing?.categorie ?? []));
      setIncludeTutte(false);
      setPresidente(existing?.presidenteCommissarioId ?? '');
    }
  }, [open, existing]);

  // When "include all" toggles or sezioni selection changes, sync categories
  useEffect(() => {
    if (!includeTutte) return;
    const auto = new Set<string>();
    for (const sezId of selSezioni) {
      (catsBySezione.get(sezId) ?? []).forEach((id) => auto.add(id));
    }
    setSelCategorie(auto);
  }, [includeTutte, selSezioni, catsBySezione]);

  const form = useForm<CommissioneFormValues>({
    resolver: zodResolver(commissioneSchema),
    values: {
      nome: existing?.nome ?? '',
      descrizione: existing?.descrizione ?? '',
    },
  });

  const toggleCommissario = (id: string, checked: boolean) => {
    setSelCommissari((prev) => {
      const next = new Set(prev);
      if (checked) next.add(id); else next.delete(id);
      return next;
    });
    // Clear presidente if deselected
    if (!checked && id === presidente) setPresidente('');
  };

  const toggleSezione = (id: string, checked: boolean) => {
    setSelSezioni((prev) => {
      const next = new Set(prev);
      if (checked) next.add(id); else next.delete(id);
      return next;
    });
  };

  const toggleCategoria = (id: string, checked: boolean) => {
    if (includeTutte) return; // locked
    setSelCategorie((prev) => {
      const next = new Set(prev);
      if (checked) next.add(id); else next.delete(id);
      return next;
    });
  };

  const toggleIncludeTutte = (checked: boolean) => {
    setIncludeTutte(checked);
    if (!checked) {
      // restore manual selection (reset to what's currently in form)
      setSelCategorie(new Set(existing?.categorie ?? []));
    }
  };

  const finalCategorie = (): string[] => {
    if (includeTutte) {
      const auto = new Set<string>();
      for (const sezId of selSezioni) {
        (catsBySezione.get(sezId) ?? []).forEach((id) => auto.add(id));
      }
      return Array.from(auto);
    }
    return Array.from(selCategorie);
  };

  const onSubmit = async (values: CommissioneFormValues) => {
    const presidenteValido =
      presidente && selCommissari.has(presidente) ? presidente : '';
    const categorieIds = finalCategorie();

    setSaving(true);
    try {
      if (isEdit && existing) {
        // 1. Update name / presidente
        await updateCommissione.mutateAsync({
          id: existing.id,
          body: {
            nome: values.nome.trim(),
            presidenteCommissarioId: presidenteValido || undefined,
          },
        });
        // 2. Sync N-N relations
        await commissioniApi.syncRelations(existing.id, existing, {
          commissariIds: Array.from(selCommissari),
          sezioniIds: Array.from(selSezioni),
          categorieIds,
        });
        toast.success('Commissione aggiornata');
      } else {
        // 1. Create
        const created = await createCommissione.mutateAsync({
          concorsoId,
          nome: values.nome.trim(),
          presidenteCommissarioId: presidenteValido || undefined,
        });
        // 2. Add all N-N (new record has empty arrays)
        await commissioniApi.syncRelations(
          created.id,
          { ...created, commissari: [], sezioni: [], categorie: [] },
          {
            commissariIds: Array.from(selCommissari),
            sezioniIds: Array.from(selSezioni),
            categorieIds,
          },
        );
        toast.success('Commissione creata');
      }
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
            {isEdit ? `Modifica commissione` : 'Nuova commissione'}
          </DialogTitle>
          {isEdit && existing && <DialogDescription>{existing.nome}</DialogDescription>}
        </DialogHeader>

        <form
          onSubmit={form.handleSubmit(onSubmit)}
          className="space-y-5 overflow-y-auto max-h-[72dvh] pr-1"
        >
          {/* Nome */}
          <div>
            <label className="block text-sm font-medium mb-1">
              Nome <span className="text-destructive">*</span>
            </label>
            <Input
              {...form.register('nome')}
              placeholder="Es. Commissione Pianoforte"
            />
            {form.formState.errors.nome && (
              <p className="mt-1 text-xs text-destructive">
                {form.formState.errors.nome.message}
              </p>
            )}
          </div>

          {/* Nota: descrizione non è nel server schema; omessa dal body */}

          {/* Commissari */}
          <section>
            <div className="mb-2">
              <h4 className="text-sm font-bold text-foreground">Membri</h4>
              <p className="text-xs text-muted-foreground">
                Seleziona i commissari assegnati a questa commissione.
              </p>
            </div>
            {allCommissari.length === 0 ? (
              <p className="text-xs text-muted-foreground italic">
                Nessun commissario attivo disponibile — aggiungine uno prima.
              </p>
            ) : (
              <div className="space-y-1.5 max-h-52 overflow-y-auto pr-1">
                {allCommissari.map((c) => {
                  const fotoSrc = c.foto ? fileUrl(c.foto) : null;
                  return (
                    <label
                      key={c.id}
                      className={cn(
                        'flex items-center gap-2.5 rounded-lg border bg-background px-2.5 py-1.5 cursor-pointer transition-colors',
                        selCommissari.has(c.id)
                          ? 'border-primary/40 bg-primary/5'
                          : 'border-border hover:bg-accent',
                      )}
                    >
                      <Checkbox
                        checked={selCommissari.has(c.id)}
                        onCheckedChange={(v) => toggleCommissario(c.id, !!v)}
                        className="h-4 w-4"
                      />
                      <div className="h-6 w-6 rounded-full overflow-hidden bg-muted shrink-0 flex items-center justify-center">
                        {fotoSrc ? (
                          <img src={fotoSrc} alt="" className="h-full w-full object-cover" />
                        ) : (
                          <UserCircle2 className="h-4 w-4 text-muted-foreground" />
                        )}
                      </div>
                      <span className="flex-1 text-sm truncate">{displayName(c)}</span>
                      {c.specialita && (
                        <span className="text-xs text-muted-foreground shrink-0 truncate max-w-[120px]">
                          {c.specialita}
                        </span>
                      )}
                    </label>
                  );
                })}
              </div>
            )}

            {/* Presidente */}
            <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50/60 p-3">
              <label className="block text-sm font-semibold text-amber-900 mb-1">
                Presidente della commissione
              </label>
              <p className="text-[11px] text-amber-800 mb-2">
                Il presidente pilota le fasi: avvia/conclude, gestisce il timer, conferma
                le valutazioni. Deve essere uno dei membri sopra.
              </p>
              <Select
                value={presidente}
                onValueChange={(v) => setPresidente(v === '_none_' ? '' : v)}
              >
                <SelectTrigger className="bg-background">
                  <SelectValue placeholder="— Nessun presidente —" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="_none_">— Nessun presidente —</SelectItem>
                  {allCommissari
                    .filter((c) => selCommissari.has(c.id))
                    .map((c) => (
                      <SelectItem key={c.id} value={c.id}>
                        {displayName(c)}
                        {c.specialita ? ` · ${c.specialita}` : ''}
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
              {presidente && !selCommissari.has(presidente) && (
                <p className="mt-1 text-xs text-amber-700">
                  Il presidente deve essere selezionato come membro.
                </p>
              )}
            </div>
          </section>

          {/* Sezioni */}
          <section>
            <div className="mb-2">
              <h4 className="text-sm font-bold text-foreground">Sezioni</h4>
              <p className="text-xs text-muted-foreground">
                Sezioni di competenza di questa commissione.
              </p>
            </div>
            {allSezioni.length === 0 ? (
              <p className="text-xs text-muted-foreground italic">
                Nessuna sezione disponibile — creane una nel tab Sezioni.
              </p>
            ) : (
              <>
                <div className="space-y-1.5 max-h-40 overflow-y-auto pr-1">
                  {allSezioni.map((s) => {
                    const nCat = catsBySezione.get(s.id)?.length ?? 0;
                    return (
                      <label
                        key={s.id}
                        className={cn(
                          'flex items-center gap-2.5 rounded-lg border bg-background px-2.5 py-1.5 cursor-pointer transition-colors',
                          selSezioni.has(s.id)
                            ? 'border-primary/40 bg-primary/5'
                            : 'border-border hover:bg-accent',
                        )}
                      >
                        <Checkbox
                          checked={selSezioni.has(s.id)}
                          onCheckedChange={(v) => toggleSezione(s.id, !!v)}
                          className="h-4 w-4"
                        />
                        <span className="flex-1 text-sm">{s.nome}</span>
                        <span className="text-xs text-muted-foreground shrink-0">
                          {nCat} cat.
                        </span>
                      </label>
                    );
                  })}
                </div>

                {/* Include all toggle */}
                <label className="mt-3 flex items-start gap-2.5 rounded-lg border border-emerald-200 bg-emerald-50/60 px-3 py-2 cursor-pointer">
                  <Checkbox
                    checked={includeTutte}
                    onCheckedChange={(v) => toggleIncludeTutte(!!v)}
                    className="mt-0.5 h-4 w-4"
                  />
                  <div>
                    <span className="text-sm font-semibold text-emerald-900">
                      Includi tutte le categorie delle sezioni selezionate
                    </span>
                    <p className="text-[11px] text-emerald-800 mt-0.5">
                      Le categorie verranno aggiunte automaticamente ogni volta che selezioni
                      una sezione. Puoi comunque gestirle singolarmente disattivando questa opzione.
                    </p>
                  </div>
                </label>
              </>
            )}
          </section>

          {/* Categorie */}
          <section>
            <div className="mb-2">
              <h4 className="text-sm font-bold text-foreground">Categorie</h4>
              <p className="text-xs text-muted-foreground">
                {includeTutte
                  ? 'Tutte le categorie delle sezioni selezionate vengono incluse automaticamente.'
                  : 'Seleziona le categorie specifiche assegnate a questa commissione.'}
              </p>
            </div>
            {Array.from(selSezioni).length === 0 ? (
              <p className="text-xs text-muted-foreground italic">
                Seleziona almeno una sezione per vedere le categorie.
              </p>
            ) : (
              <div className="space-y-2">
                {allSezioni
                  .filter((s) => selSezioni.has(s.id))
                  .map((s) => (
                    <CategoriePerSezioneSelector
                      key={s.id}
                      sezione={s}
                      selectedCatIds={selCategorie}
                      onChange={toggleCategoria}
                      disabled={includeTutte}
                    />
                  ))}
              </div>
            )}
          </section>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Annulla
            </Button>
            <Button type="submit" disabled={saving}>
              {saving
                ? 'Salvataggio…'
                : isEdit
                  ? 'Salva modifiche'
                  : 'Crea commissione'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// CommissioneCard
// ---------------------------------------------------------------------------
interface CommissioneCardProps {
  commissione: CommissioneRecord;
  allCommissari: CommissarioRecord[];
  allSezioni: SezioneRecord[];
  catsBySezione: Map<string, string[]>;
  allCatNames: Map<string, string>;
  onEdit: () => void;
  onDelete: () => void;
}

function CommissioneCard({
  commissione: c,
  allCommissari,
  allSezioni,
  allCatNames,
  onEdit,
  onDelete,
}: CommissioneCardProps) {
  const members = c.commissari
    .map((id) => allCommissari.find((x) => x.id === id))
    .filter(Boolean) as CommissarioRecord[];
  const sezs = c.sezioni
    .map((id) => allSezioni.find((x) => x.id === id))
    .filter(Boolean) as SezioneRecord[];
  const pres = c.presidenteCommissarioId
    ? allCommissari.find((x) => x.id === c.presidenteCommissarioId)
    : null;

  return (
    <div className="rounded-2xl border border-border bg-card p-4 space-y-3">
      {/* Title row */}
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h4 className="font-bold text-foreground truncate">{c.nome}</h4>
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
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
            className="h-8 w-8 text-destructive hover:bg-destructive/10"
            onClick={onDelete}
            title="Elimina"
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {/* Presidente */}
      {pres ? (
        <div className="inline-flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-2.5 py-1.5">
          <Scale className="h-3.5 w-3.5 text-amber-600 shrink-0" />
          <div className="text-[11px] leading-tight">
            <div className="text-[9px] font-bold uppercase tracking-wider text-amber-700">
              Presidente
            </div>
            <div className="font-semibold text-amber-900">{displayName(pres)}</div>
          </div>
        </div>
      ) : (
        <div className="inline-flex items-center gap-1.5 text-[11px] text-amber-700 border border-dashed border-amber-300 rounded-lg px-2.5 py-1">
          <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
          <span className="italic">Nessun presidente — modifica per assegnarne uno</span>
        </div>
      )}

      {/* Membri */}
      <div>
        <p className="text-[10px] uppercase tracking-wider font-semibold text-muted-foreground mb-1.5">
          Membri ({members.length})
        </p>
        {members.length === 0 ? (
          <p className="text-xs text-muted-foreground italic">Nessun membro</p>
        ) : (
          <div className="flex flex-wrap gap-1">
            {members.map((m) => {
              const isPres = c.presidenteCommissarioId === m.id;
              return (
                <span
                  key={m.id}
                  className={cn(
                    'inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-full',
                    isPres
                      ? 'bg-amber-100 text-amber-900 ring-1 ring-amber-300'
                      : 'bg-secondary text-secondary-foreground',
                  )}
                >
                  <span className="h-4 w-4 rounded-full overflow-hidden flex items-center justify-center bg-muted shrink-0">
                    {m.foto ? (
                      <img
                        src={fileUrl(m.foto)}
                        alt=""
                        className="h-full w-full object-cover"
                      />
                    ) : (
                      <UserCircle2 className="h-3 w-3 text-muted-foreground" />
                    )}
                  </span>
                  {displayName(m)}
                  {isPres && ' 🎯'}
                </span>
              );
            })}
          </div>
        )}
      </div>

      {/* Sezioni */}
      <div>
        <p className="text-[10px] uppercase tracking-wider font-semibold text-muted-foreground mb-1.5">
          Sezioni ({sezs.length})
        </p>
        {sezs.length === 0 ? (
          <p className="text-xs text-muted-foreground italic">Nessuna sezione</p>
        ) : (
          <div className="flex flex-wrap gap-1">
            {sezs.map((s) => (
              <Badge key={s.id} variant="secondary" className="text-[11px]">
                {s.nome}
              </Badge>
            ))}
          </div>
        )}
      </div>

      {/* Categorie */}
      {c.categorie.length > 0 && (
        <div>
          <p className="text-[10px] uppercase tracking-wider font-semibold text-muted-foreground mb-1.5">
            Categorie ({c.categorie.length})
          </p>
          <div className="flex flex-wrap gap-1">
            {c.categorie.map((id) => (
              <Badge key={id} variant="muted" className="text-[10px]">
                {allCatNames.get(id) ?? id.slice(0, 8)}
              </Badge>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// CommissioniTab (exported)
// ---------------------------------------------------------------------------
export default function CommissioniTab({ concorsoId }: { concorsoId: string }) {
  const { data: commissioni, isLoading, isError } = useCommissioni(concorsoId);
  const { data: allCommissari } = useCommissari(concorsoId);
  const { data: allSezioni } = useSezioni(concorsoId);
  const deleteCommissione = useDeleteCommissione(concorsoId);

  const [dialog, setDialog] = useState<{ open: boolean; existing?: CommissioneRecord }>({
    open: false,
  });

  // catsBySezione / allCatNames: built lazily from tanstack cache by child components.
  // CommissioneCard receives them empty (IDs shown as fallback) until the dialog
  // opens and CategoriePerSezioneSelector fills the cache.
  const catsBySezione = new Map<string, string[]>();
  const allCatNames = new Map<string, string>();

  const attiviCommissari = allCommissari?.filter((c) => c.stato === 'ATTIVO') ?? [];

  const handleDelete = async (c: CommissioneRecord) => {
    if (!confirm(`Eliminare la commissione "${c.nome}"? L'operazione non è reversibile.`)) return;
    try {
      await deleteCommissione.mutateAsync(c.id);
      toast.success('Commissione eliminata');
    } catch (e) {
      toast.error(httpErrorMessage(e));
    }
  };

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------
  if (isLoading) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-36 w-full rounded-2xl" />
        <Skeleton className="h-36 w-full rounded-2xl" />
      </div>
    );
  }

  if (isError) {
    return (
      <p className="text-sm text-destructive">Errore nel caricamento delle commissioni.</p>
    );
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="text-sm font-bold uppercase tracking-wider text-muted-foreground">
            Commissioni
          </h3>
          <p className="text-sm text-muted-foreground mt-0.5">
            {commissioni?.length ?? 0} commissioni · ogni commissione gestisce una o più sezioni.
          </p>
        </div>
        <Button size="sm" onClick={() => setDialog({ open: true })}>
          <Plus className="h-4 w-4" />
          Nuova commissione
        </Button>
      </div>

      {/* Warnings */}
      {(allCommissari?.length ?? 0) === 0 && (
        <div className="flex items-center gap-2 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          Nessun commissario disponibile — aggiungine uno nel tab Commissari.
        </div>
      )}
      {(allSezioni?.length ?? 0) === 0 && (
        <div className="flex items-center gap-2 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          Nessuna sezione disponibile — creane una nel tab Sezioni.
        </div>
      )}

      {/* Empty state */}
      {(commissioni?.length ?? 0) === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-2xl border-2 border-dashed border-border py-14 text-center">
          <Scale className="mx-auto h-10 w-10 text-muted-foreground/40 mb-3" />
          <p className="text-sm text-muted-foreground italic">
            Nessuna commissione — creane una per organizzare la giuria.
          </p>
          <Button
            size="sm"
            variant="outline"
            className="mt-4"
            onClick={() => setDialog({ open: true })}
          >
            <Plus className="h-4 w-4" />
            Crea la prima commissione
          </Button>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
          {commissioni!.map((c) => (
            <CommissioneCard
              key={c.id}
              commissione={c}
              allCommissari={attiviCommissari}
              allSezioni={allSezioni ?? []}
              catsBySezione={catsBySezione}
              allCatNames={allCatNames}
              onEdit={() => setDialog({ open: true, existing: c })}
              onDelete={() => handleDelete(c)}
            />
          ))}
        </div>
      )}

      {/* Form dialog */}
      <CommissioneFormDialog
        open={dialog.open}
        onOpenChange={(v) => setDialog((p) => ({ ...p, open: v }))}
        concorsoId={concorsoId}
        allCommissari={attiviCommissari}
        allSezioni={allSezioni ?? []}
        catsBySezione={catsBySezione}
        existing={dialog.existing}
      />
    </div>
  );
}
