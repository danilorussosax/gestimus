// =============================================================================
// SezioniTab — sezioni list + categorie tree per sezione (admin)
// =============================================================================

import { useState } from 'react';
import { useForm, type Resolver } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { toast } from 'sonner';
import {
  Plus, Pencil, Trash2, ChevronDown, ChevronUp, Layers, Tag,
} from 'lucide-react';

import { httpErrorMessage } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import {
  useSezioni,
  useCreateSezione,
  useUpdateSezione,
  useDeleteSezione,
  type SezioneRecord,
} from '@/api/sezioni';
import {
  useCategorie,
  useCreateCategoria,
  useUpdateCategoria,
  useDeleteCategoria,
  type CategoriaRecord,
} from '@/api/categorie';

// ---------------------------------------------------------------------------
// Zod schemas
// ---------------------------------------------------------------------------
const sezioneSchema = z.object({
  nome: z.string().min(1, 'Nome obbligatorio').max(255),
  descrizione: z.string().max(2000).optional(),
});
type SezioneFormValues = z.infer<typeof sezioneSchema>;

const categoriaSchema = z.object({
  nome: z.string().min(1, 'Nome obbligatorio').max(255),
  descrizione: z.string().max(2000).optional(),
  etaMin: z.coerce.number().int().min(0).max(120).optional().or(z.literal('')),
  etaMax: z.coerce.number().int().min(0).max(120).optional().or(z.literal('')),
});
type CategoriaFormValues = z.infer<typeof categoriaSchema>;

// ---------------------------------------------------------------------------
// SezioneFormDialog
// ---------------------------------------------------------------------------
interface SezioneDialogProps {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  concorsoId: string;
  existing?: SezioneRecord;
}

function SezioneFormDialog({ open, onOpenChange, concorsoId, existing }: SezioneDialogProps) {
  const isEdit = !!existing;
  const createSezione = useCreateSezione(concorsoId);
  const updateSezione = useUpdateSezione(concorsoId);

  const form = useForm<SezioneFormValues>({
    resolver: zodResolver(sezioneSchema),
    values: {
      nome: existing?.nome ?? '',
      descrizione: existing?.descrizione ?? '',
    },
  });

  const onSubmit = async (values: SezioneFormValues) => {
    const body = { nome: values.nome.trim(), descrizione: (values.descrizione ?? '').trim() };
    try {
      if (isEdit && existing) {
        await updateSezione.mutateAsync({ id: existing.id, body });
        toast.success('Sezione aggiornata');
      } else {
        await createSezione.mutateAsync({ concorsoId, ...body });
        toast.success('Sezione creata');
      }
      onOpenChange(false);
    } catch (e) {
      toast.error(httpErrorMessage(e));
    }
  };

  const isPending = createSezione.isPending || updateSezione.isPending;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{isEdit ? `Modifica "${existing?.nome}"` : 'Nuova sezione'}</DialogTitle>
        </DialogHeader>
        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-3">
          <div>
            <label className="block text-sm font-medium text-foreground mb-1">
              Nome <span className="text-destructive">*</span>
            </label>
            <Input {...form.register('nome')} placeholder="Es. Pianoforte" />
            {form.formState.errors.nome && (
              <p className="mt-1 text-xs text-destructive">{form.formState.errors.nome.message}</p>
            )}
          </div>
          <div>
            <label className="block text-sm font-medium text-foreground mb-1">Descrizione</label>
            <Textarea {...form.register('descrizione')} rows={2} placeholder="Descrizione opzionale" />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Annulla
            </Button>
            <Button type="submit" disabled={isPending}>
              {isPending ? 'Salvataggio…' : isEdit ? 'Salva modifiche' : 'Crea sezione'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// CategoriaFormDialog
// ---------------------------------------------------------------------------
interface CategoriaDialogProps {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  sezione: SezioneRecord;
  existing?: CategoriaRecord;
}

function CategoriaFormDialog({ open, onOpenChange, sezione, existing }: CategoriaDialogProps) {
  const isEdit = !!existing;
  const createCategoria = useCreateCategoria(sezione.id);
  const updateCategoria = useUpdateCategoria(sezione.id);

  const form = useForm<CategoriaFormValues>({
    resolver: zodResolver(categoriaSchema) as Resolver<CategoriaFormValues>,
    values: {
      nome: existing?.nome ?? '',
      descrizione: existing?.descrizione ?? '',
      etaMin: existing?.etaMin ?? '',
      etaMax: existing?.etaMax ?? '',
    },
  });

  const onSubmit = async (values: CategoriaFormValues) => {
    const body = {
      nome: values.nome.trim(),
      descrizione: (values.descrizione ?? '').trim() || undefined,
      etaMin: values.etaMin !== '' && values.etaMin != null
        ? Number(values.etaMin)
        : undefined,
      etaMax: values.etaMax !== '' && values.etaMax != null
        ? Number(values.etaMax)
        : undefined,
    };
    try {
      if (isEdit && existing) {
        await updateCategoria.mutateAsync({ id: existing.id, body });
        toast.success('Categoria aggiornata');
      } else {
        await createCategoria.mutateAsync({ sezioneId: sezione.id, ...body });
        toast.success('Categoria creata');
      }
      onOpenChange(false);
    } catch (e) {
      toast.error(httpErrorMessage(e));
    }
  };

  const isPending = createCategoria.isPending || updateCategoria.isPending;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {isEdit
              ? `Modifica "${existing?.nome}"`
              : `Nuova categoria in "${sezione.nome}"`}
          </DialogTitle>
        </DialogHeader>
        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-3">
          <div>
            <label className="block text-sm font-medium text-foreground mb-1">
              Nome <span className="text-destructive">*</span>
            </label>
            <Input {...form.register('nome')} placeholder="Es. Under 12" />
            {form.formState.errors.nome && (
              <p className="mt-1 text-xs text-destructive">{form.formState.errors.nome.message}</p>
            )}
          </div>
          <div>
            <label className="block text-sm font-medium text-foreground mb-1">Descrizione</label>
            <Textarea {...form.register('descrizione')} rows={2} placeholder="Descrizione opzionale" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-foreground mb-1">Età min</label>
              <Input
                type="number"
                min={0}
                max={120}
                {...form.register('etaMin')}
                placeholder="0"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-foreground mb-1">Età max</label>
              <Input
                type="number"
                min={0}
                max={120}
                {...form.register('etaMax')}
                placeholder="120"
              />
            </div>
          </div>
          {form.formState.errors.etaMin && (
            <p className="text-xs text-destructive">{form.formState.errors.etaMin.message}</p>
          )}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Annulla
            </Button>
            <Button type="submit" disabled={isPending}>
              {isPending ? 'Salvataggio…' : isEdit ? 'Salva modifiche' : 'Crea categoria'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// SezioneRow — expands to show its categorie
// ---------------------------------------------------------------------------
interface SezioneRowProps {
  sezione: SezioneRecord;
  concorsoId: string;
  onEditSezione: (s: SezioneRecord) => void;
  onDeleteSezione: (s: SezioneRecord) => void;
  onAddCategoria: (s: SezioneRecord) => void;
  onEditCategoria: (sez: SezioneRecord, cat: CategoriaRecord) => void;
}

function SezioneRow({
  sezione,
  onEditSezione,
  onDeleteSezione,
  onAddCategoria,
  onEditCategoria,
}: SezioneRowProps) {
  const [open, setOpen] = useState(true);
  const { data: cats, isLoading } = useCategorie(sezione.id);
  // Delete mutation scoped to this sezione (correct cache key)
  const deleteCategoria = useDeleteCategoria(sezione.id);

  const handleDeleteCategoria = async (cat: CategoriaRecord) => {
    if (!confirm(`Eliminare la categoria "${cat.nome}"?`)) return;
    try {
      await deleteCategoria.mutateAsync(cat.id);
      toast.success('Categoria eliminata');
    } catch (e) {
      toast.error(httpErrorMessage(e));
    }
  };

  return (
    <li className="rounded-xl border border-border bg-card shadow-xs overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between gap-3 p-4">
        <div className="flex items-center gap-3 min-w-0">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <Layers className="h-5 w-5" />
          </div>
          <div className="min-w-0">
            <p className="font-semibold text-foreground truncate">{sezione.nome}</p>
            {sezione.descrizione && (
              <p className="text-xs text-muted-foreground truncate">{sezione.descrizione}</p>
            )}
            <p className="text-xs text-muted-foreground mt-0.5">
              {isLoading ? '…' : `${cats?.length ?? 0} categori${(cats?.length ?? 0) === 1 ? 'a' : 'e'}`}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 text-primary hover:bg-primary/10"
            title="Modifica sezione"
            onClick={() => onEditSezione(sezione)}
          >
            <Pencil className="h-4 w-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 text-destructive hover:bg-destructive/10"
            title="Elimina sezione"
            onClick={() => onDeleteSezione(sezione)}
          >
            <Trash2 className="h-4 w-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            onClick={() => setOpen((v) => !v)}
            title={open ? 'Comprimi' : 'Espandi'}
          >
            {open ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
          </Button>
        </div>
      </div>

      {/* Categorie */}
      {open && (
        <div className="border-t border-border bg-muted/30 px-4 py-3">
          {isLoading ? (
            <div className="space-y-2">
              <Skeleton className="h-8 w-full" />
              <Skeleton className="h-8 w-2/3" />
            </div>
          ) : (cats?.length ?? 0) === 0 ? (
            <p className="text-xs text-muted-foreground italic">
              Nessuna categoria — aggiungine una.
            </p>
          ) : (
            <ul className="space-y-1.5 mb-3">
              {cats!.map((cat) => (
                <li
                  key={cat.id}
                  className="flex items-center justify-between gap-2 rounded-lg bg-background border border-border px-3 py-2"
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <Tag className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                    <span className="text-sm font-medium truncate">{cat.nome}</span>
                    {cat.descrizione && (
                      <span className="text-xs text-muted-foreground truncate hidden sm:inline">
                        {cat.descrizione}
                      </span>
                    )}
                    {(cat.etaMin != null || cat.etaMax != null) && (
                      <Badge variant="muted" className="text-[10px]">
                        {cat.etaMin ?? '0'}–{cat.etaMax ?? '∞'} anni
                      </Badge>
                    )}
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7 text-primary hover:bg-primary/10"
                      onClick={() => onEditCategoria(sezione, cat)}
                      title="Modifica categoria"
                    >
                      <Pencil className="h-3.5 w-3.5" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7 text-destructive hover:bg-destructive/10"
                      onClick={() => handleDeleteCategoria(cat)}
                      title="Elimina categoria"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          )}
          <Button
            size="sm"
            variant="outline"
            className="gap-1.5 text-xs"
            onClick={() => onAddCategoria(sezione)}
          >
            <Plus className="h-3.5 w-3.5" />
            Aggiungi categoria
          </Button>
        </div>
      )}
    </li>
  );
}

// ---------------------------------------------------------------------------
// SezioniTab (exported)
// ---------------------------------------------------------------------------
export default function SezioniTab({ concorsoId }: { concorsoId: string }) {
  const { data: sezioni, isLoading, isError } = useSezioni(concorsoId);
  const deleteSezione = useDeleteSezione(concorsoId);

  // Dialog state
  const [sezDialog, setSezDialog] = useState<{ open: boolean; existing?: SezioneRecord }>({
    open: false,
  });
  const [catDialog, setCatDialog] = useState<{
    open: boolean;
    sezione?: SezioneRecord;
    existing?: CategoriaRecord;
  }>({ open: false });

  // ---------- Handlers ----------
  const handleDeleteSezione = async (s: SezioneRecord) => {
    if (!confirm(`Eliminare la sezione "${s.nome}"? Le categorie figlie verranno rimosse.`)) return;
    try {
      await deleteSezione.mutateAsync(s.id);
      toast.success('Sezione eliminata');
    } catch (e) {
      toast.error(httpErrorMessage(e));
    }
  };

  // ---------- Render ----------
  if (isLoading) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-24 w-full rounded-xl" />
        <Skeleton className="h-24 w-full rounded-xl" />
      </div>
    );
  }

  if (isError) {
    return (
      <p className="text-sm text-destructive">Errore nel caricamento delle sezioni.</p>
    );
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between gap-2">
        <div>
          <h3 className="text-sm font-bold uppercase tracking-wider text-muted-foreground">
            Sezioni &amp; Categorie
          </h3>
          <p className="text-sm text-muted-foreground mt-0.5">
            {sezioni?.length ?? 0} sezioni · organizza i partecipanti per disciplina e fascia d'età.
          </p>
        </div>
        <Button size="sm" onClick={() => setSezDialog({ open: true })}>
          <Plus className="h-4 w-4" />
          Nuova sezione
        </Button>
      </div>

      {/* Empty state */}
      {(sezioni?.length ?? 0) === 0 && (
        <div className="flex flex-col items-center justify-center rounded-2xl border-2 border-dashed border-border py-14 text-center">
          <Layers className="mx-auto h-10 w-10 text-muted-foreground/40 mb-3" />
          <p className="text-sm text-muted-foreground italic">
            Nessuna sezione — creane una per organizzare il concorso.
          </p>
          <Button
            size="sm"
            variant="outline"
            className="mt-4"
            onClick={() => setSezDialog({ open: true })}
          >
            <Plus className="h-4 w-4" />
            Crea la prima sezione
          </Button>
        </div>
      )}

      {/* List */}
      {(sezioni?.length ?? 0) > 0 && (
        <ul className="space-y-3">
          {sezioni!.map((sez) => (
            <SezioneRow
              key={sez.id}
              sezione={sez}
              concorsoId={concorsoId}
              onEditSezione={(s) => setSezDialog({ open: true, existing: s })}
              onDeleteSezione={handleDeleteSezione}
              onAddCategoria={(s) => setCatDialog({ open: true, sezione: s })}
              onEditCategoria={(sez2, cat) =>
                setCatDialog({ open: true, sezione: sez2, existing: cat })
              }
            />
          ))}
        </ul>
      )}

      {/* Sezione dialog */}
      <SezioneFormDialog
        open={sezDialog.open}
        onOpenChange={(v) => setSezDialog((p) => ({ ...p, open: v }))}
        concorsoId={concorsoId}
        existing={sezDialog.existing}
      />

      {/* Categoria dialog */}
      {catDialog.sezione && (
        <CategoriaFormDialog
          open={catDialog.open}
          onOpenChange={(v) => setCatDialog((p) => ({ ...p, open: v }))}
          sezione={catDialog.sezione}
          existing={catDialog.existing}
        />
      )}
    </div>
  );
}
