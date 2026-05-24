// =============================================================================
// SezioniTab — sezioni list + categorie tree per sezione (admin)
// Layout/structure/classes mirror js/views/admin/sezioni.js exactly.
// =============================================================================

import { useState } from 'react';
import { useForm, type Resolver } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { toast } from 'sonner';
import { Plus, Pencil, Trash2, Copy } from 'lucide-react';

import { HttpError, httpErrorMessage, http } from '@/lib/api';
import { iconaPerSezione } from '@/lib/sezione-icon';
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
  categorieApi,
  type CategoriaRecord,
} from '@/api/categorie';
import { candidatiApi } from '@/api/candidati';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import ImportCsvDialog from '@/components/admin/ImportCsvDialog';

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
});
type CategoriaFormValues = z.infer<typeof categoriaSchema>;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Extract the cleanest error message, honouring 409 body.error like the vanilla. */
function resolveError(e: unknown): string {
  if (e instanceof HttpError && e.status === 409 && e.payload.error) {
    return e.payload.error;
  }
  return httpErrorMessage(e);
}

// ---------------------------------------------------------------------------
// ConfirmDialog — mirrors vanilla confirmDialog({ danger: true })
// ---------------------------------------------------------------------------
interface ConfirmDialogProps {
  open: boolean;
  title: string;
  message: string;
  danger?: boolean;
  confirmLabel?: string;
  onConfirm: () => void;
  onCancel: () => void;
}

function ConfirmDialog({
  open,
  title,
  message,
  danger = false,
  confirmLabel = 'Conferma',
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onCancel(); }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        <p className="text-sm text-slate-600">{message}</p>
        <DialogFooter>
          <button
            type="button"
            className="c-btn c-btn--outline"
            onClick={onCancel}
          >
            Annulla
          </button>
          <button
            type="button"
            className={danger ? 'c-btn c-btn--danger' : 'c-btn c-btn--primary'}
            onClick={onConfirm}
          >
            {confirmLabel}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// SezioneFormDialog — mirrors openSezioneForm()
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
      console.error(e);
      toast.error(resolveError(e));
    }
  };

  const isPending = createSezione.isPending || updateSezione.isPending;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {isEdit ? `Modifica "${existing?.nome}"` : 'Nuova sezione'}
          </DialogTitle>
        </DialogHeader>
        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-3">
          {/* Nome */}
          <label className="block">
            <span className="c-field__label">
              Nome <span className="text-rose-500">*</span>
            </span>
            <input
              {...form.register('nome')}
              className="c-input mt-1"
              placeholder="Es. Pianoforte"
            />
            {form.formState.errors.nome && (
              <p className="mt-1 text-xs text-rose-600">{form.formState.errors.nome.message}</p>
            )}
          </label>
          {/* Descrizione */}
          <label className="block">
            <span className="c-field__label">Descrizione</span>
            <textarea
              {...form.register('descrizione')}
              rows={2}
              className="c-textarea mt-1"
              placeholder="Descrizione opzionale"
            />
          </label>
          <DialogFooter>
            <button
              type="button"
              className="c-btn c-btn--outline"
              onClick={() => onOpenChange(false)}
            >
              Annulla
            </button>
            <button type="submit" className="c-btn c-btn--primary" disabled={isPending}>
              {isPending ? 'Salvataggio…' : isEdit ? 'Salva modifiche' : 'Crea sezione'}
            </button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// CategoriaFormDialog — mirrors openCategoriaForm() (nome + descrizione only)
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
    },
  });

  const onSubmit = async (values: CategoriaFormValues) => {
    const body = {
      nome: values.nome.trim(),
      descrizione: (values.descrizione ?? '').trim() || undefined,
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
      console.error(e);
      toast.error(resolveError(e));
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
          {/* Nome */}
          <label className="block">
            <span className="c-field__label">
              Nome <span className="text-rose-500">*</span>
            </span>
            <input
              {...form.register('nome')}
              className="c-input mt-1"
              placeholder="Es. Under 12"
            />
            {form.formState.errors.nome && (
              <p className="mt-1 text-xs text-rose-600">{form.formState.errors.nome.message}</p>
            )}
          </label>
          {/* Descrizione */}
          <label className="block">
            <span className="c-field__label">Descrizione</span>
            <textarea
              {...form.register('descrizione')}
              rows={2}
              className="c-textarea mt-1"
              placeholder="Descrizione opzionale"
            />
          </label>
          <DialogFooter>
            <button
              type="button"
              className="c-btn c-btn--outline"
              onClick={() => onOpenChange(false)}
            >
              Annulla
            </button>
            <button type="submit" className="c-btn c-btn--primary" disabled={isPending}>
              {isPending ? 'Salvataggio…' : isEdit ? 'Salva modifiche' : 'Crea categoria'}
            </button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// CopyCategorieDialog — mirrors openCopyCategorieModal()
// ---------------------------------------------------------------------------
interface CopyCategorieDialogProps {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  fromSezione: SezioneRecord;
  allSezioni: SezioneRecord[];
}

function CopyCategorieDialog({
  open,
  onOpenChange,
  fromSezione,
  allSezioni,
}: CopyCategorieDialogProps) {
  const { data: fromCats } = useCategorie(fromSezione.id);
  const [destIds, setDestIds] = useState<string[]>([]);
  const [skipDup, setSkipDup] = useState(true);
  const [isPending, setIsPending] = useState(false);

  const otherSezioni = allSezioni.filter((s) => s.id !== fromSezione.id);

  // Per ogni sezione destinazione, fetch il conteggio categorie esistenti
  const destCatCounts = useDestCatCounts(otherSezioni);

  const toggleDest = (id: string) =>
    setDestIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    );

  const handleCopy = async () => {
    if (destIds.length === 0) {
      toast.error('Seleziona almeno una sezione destinazione.');
      return;
    }
    if (!fromCats || fromCats.length === 0) {
      toast.error('Nessuna categoria da copiare.');
      return;
    }
    setIsPending(true);
    let created = 0;
    let skipped = 0;
    try {
      for (const destId of destIds) {
        let existingNames = new Set<string>();
        if (skipDup) {
          const destCats = await categorieApi.listBySezione(destId);
          existingNames = new Set(destCats.map((c) => c.nome.trim().toLowerCase()));
        }
        for (const cat of fromCats) {
          if (skipDup && existingNames.has(cat.nome.trim().toLowerCase())) {
            skipped++;
            continue;
          }
          await http.post('categorie', {
            sezioneId: destId,
            nome: cat.nome,
            descrizione: cat.descrizione ?? undefined,
          });
          created++;
        }
      }
      const msg =
        `${created} categori${created === 1 ? 'a copiata' : 'e copiate'}` +
        (skipped > 0 ? `, ${skipped} saltat${skipped === 1 ? 'a' : 'e'} (duplicate)` : '');
      toast.success(msg);
      onOpenChange(false);
      setDestIds([]);
    } catch (e) {
      toast.error(resolveError(e));
    } finally {
      setIsPending(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Copia categorie da &ldquo;{fromSezione.nome}&rdquo;</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          {/* Preview categorie sorgente — mirrors the bg-slate-50 box */}
          <div className="bg-slate-50 border border-slate-200 rounded-xl p-3">
            <p className="text-xs font-semibold text-slate-600 mb-1.5">
              Categorie che verranno copiate ({fromCats?.length ?? 0}):
            </p>
            <ul className="text-sm text-slate-800 space-y-0.5">
              {fromCats?.map((c) => (
                <li key={c.id}>
                  · {c.nome}
                  {c.descrizione && (
                    <span className="text-xs text-slate-500"> ({c.descrizione})</span>
                  )}
                </li>
              ))}
            </ul>
          </div>
          {/* Sezioni destinazione — mirrors the fieldset with existing-cat count */}
          <fieldset>
            <legend className="text-sm font-semibold text-slate-800 mb-2">
              Sezioni destinazione
            </legend>
            <div className="space-y-1.5 max-h-64 overflow-y-auto pr-1">
              {otherSezioni.map((s) => {
                const existingCats = destCatCounts[s.id] ?? 0;
                return (
                  <label
                    key={s.id}
                    className="flex items-start gap-2 p-2 rounded-lg hover:bg-slate-50 cursor-pointer"
                  >
                    <input
                      type="checkbox"
                      className="mt-0.5"
                      checked={destIds.includes(s.id)}
                      onChange={() => toggleDest(s.id)}
                    />
                    <span className="min-w-0 flex-1">
                      <span className="font-medium text-slate-800">{s.nome}</span>
                      <span className="text-[11px] text-slate-500 ml-1">
                        ({existingCats} categori{existingCats === 1 ? 'a' : 'e'})
                      </span>
                    </span>
                  </label>
                );
              })}
            </div>
          </fieldset>
          {/* Skip duplicati */}
          <label className="flex items-center gap-2 text-sm text-slate-700">
            <input
              type="checkbox"
              checked={skipDup}
              onChange={(e) => setSkipDup(e.target.checked)}
            />
            <span>Salta categorie con nome già presente nella destinazione</span>
          </label>
        </div>
        <DialogFooter>
          <button
            type="button"
            className="c-btn c-btn--outline"
            onClick={() => onOpenChange(false)}
          >
            Annulla
          </button>
          <button
            type="button"
            className="c-btn c-btn--primary"
            disabled={isPending}
            onClick={handleCopy}
          >
            {isPending ? 'Copia in corso…' : 'Copia categorie'}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Hook: per ogni sezione in `sezioni`, ritorna una map id→count usando
 * le query già in cache da useCategorie (niente fetch aggiuntivi se già caricati).
 * Materializziamo con una singola query aggregata che legge la cache TQ.
 */
function useDestCatCounts(sezioni: SezioneRecord[]): Record<string, number> {
  // One hook call per sezione. Rules-of-hooks: the array length is stable during
  // the dialog lifetime. We gather counts into a record.
  // To avoid conditional hooks we use a combined approach: each SezioneRow fetches
  // its own count via a tiny hook, and we expose a map.
  // Since we cannot use hooks in a loop, we use the pure API queries via useQuery
  // composed as a single combined query that resolves all counts.
  const { data } = useQuery({
    queryKey: ['categorie-counts', sezioni.map((s) => s.id).join(',')],
    queryFn: async () => {
      const results = await Promise.all(
        sezioni.map(async (s) => {
          const cats = await categorieApi.listBySezione(s.id);
          return [s.id, cats.length] as const;
        }),
      );
      return Object.fromEntries(results);
    },
    enabled: sezioni.length > 0,
    staleTime: 30_000,
  });
  return data ?? {};
}

// ---------------------------------------------------------------------------
// SezioneCard — mirrors sezioneCardHtml() exactly
// ---------------------------------------------------------------------------
interface SezioneCardProps {
  sezione: SezioneRecord;
  /** candidati counts by sezioneId and categoriaId */
  candBySezione: Record<string, number>;
  candByCategoria: Record<string, number>;
  onEditSezione: (s: SezioneRecord) => void;
  onDeleteSezione: (s: SezioneRecord) => void;
  onAddCategoria: (s: SezioneRecord) => void;
  onEditCategoria: (sez: SezioneRecord, cat: CategoriaRecord) => void;
  onDeleteCategoria: (sez: SezioneRecord, cat: CategoriaRecord) => void;
  onCopyCategorie: (s: SezioneRecord) => void;
}

function SezioneCard({
  sezione,
  candBySezione,
  candByCategoria,
  onEditSezione,
  onDeleteSezione,
  onAddCategoria,
  onEditCategoria,
  onDeleteCategoria,
  onCopyCategorie,
}: SezioneCardProps) {
  const { data: cats, isLoading } = useCategorie(sezione.id);

  const catCount = cats?.length ?? 0;
  const candCount = candBySezione[sezione.id] ?? 0;

  return (
    <li className="bg-white border border-slate-200 rounded-2xl p-4">
      {/* Header sezione */}
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-3 min-w-0">
          {/* Icon */}
          <div className="w-10 h-10 rounded-xl bg-brand-50 text-brand-700 flex items-center justify-center text-lg shrink-0">
            {iconaPerSezione(sezione.nome)}
          </div>
          <div className="min-w-0">
            <h4 className="font-bold text-slate-900">{sezione.nome}</h4>
            {sezione.descrizione && (
              <p className="text-xs text-slate-500 mt-0.5">{sezione.descrizione}</p>
            )}
            {/* N categorie · N candidati — mirrors the vanilla subtitle */}
            <p className="text-[11px] text-slate-500 mt-1">
              {isLoading
                ? '…'
                : `${catCount} categori${catCount === 1 ? 'a' : 'e'}`}{' '}
              · {candCount} candidat{candCount === 1 ? 'o' : 'i'}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <button
            onClick={() => onEditSezione(sezione)}
            className="w-9 h-9 inline-flex items-center justify-center rounded-lg text-brand-700 bg-brand-50 hover:bg-brand-100 border border-brand-100 transition-colors"
            title="Modifica sezione"
          >
            <Pencil size={18} />
          </button>
          <button
            onClick={() => onDeleteSezione(sezione)}
            className="w-9 h-9 inline-flex items-center justify-center rounded-lg text-rose-600 bg-rose-50 hover:bg-rose-100 border border-rose-100 transition-colors"
            title="Elimina sezione"
          >
            <Trash2 size={18} />
          </button>
        </div>
      </div>

      {/* Categorie tree — mirrors ml-13 border-l block */}
      <div className="mt-3 ml-13 sm:ml-13 pl-3 border-l-2 border-slate-100">
        {isLoading ? (
          <p className="text-xs text-slate-400 italic mb-2">Caricamento…</p>
        ) : catCount === 0 ? (
          <p className="text-xs text-slate-400 italic mb-2">Nessuna categoria</p>
        ) : (
          <ul className="space-y-1.5 mb-2">
            {cats!.map((cat) => {
              const catCandCount = candByCategoria[cat.id] ?? 0;
              return (
                <li
                  key={cat.id}
                  className="flex items-center justify-between gap-2 bg-slate-50 rounded-lg px-3 py-2"
                >
                  <div className="min-w-0 flex items-center gap-2">
                    <span className="text-sm font-medium text-slate-800">{cat.nome}</span>
                    {/* Candidati count badge — mirrors the font-mono badge in vanilla */}
                    <span
                      className="text-[10px] font-mono px-1.5 py-0.5 bg-white border border-slate-200 rounded text-slate-600"
                      title="Candidati assegnati"
                    >
                      {catCandCount}
                    </span>
                    {cat.descrizione && (
                      <span className="text-[11px] text-slate-500 ml-1">{cat.descrizione}</span>
                    )}
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <button
                      onClick={() => onEditCategoria(sezione, cat)}
                      className="w-9 h-9 inline-flex items-center justify-center rounded-lg text-brand-700 bg-white hover:bg-brand-50 border border-brand-100 transition-colors"
                      title="Modifica categoria"
                    >
                      <Pencil size={18} />
                    </button>
                    <button
                      onClick={() => onDeleteCategoria(sezione, cat)}
                      className="w-9 h-9 inline-flex items-center justify-center rounded-lg text-rose-600 bg-white hover:bg-rose-50 border border-rose-100 transition-colors"
                      title="Elimina categoria"
                    >
                      <Trash2 size={18} />
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}

        {/* Footer actions */}
        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={() => onAddCategoria(sezione)}
            className="text-xs font-semibold text-brand-700 bg-brand-50 hover:bg-brand-100 px-2.5 py-1.5 rounded-lg inline-flex items-center gap-1.5"
          >
            <Plus size={14} />
            <span>Aggiungi categoria</span>
          </button>
          {catCount > 0 && (
            <button
              onClick={() => onCopyCategorie(sezione)}
              className="text-xs font-semibold text-slate-700 bg-slate-50 hover:bg-slate-100 border border-slate-200 px-2.5 py-1.5 rounded-lg inline-flex items-center gap-1.5"
              title="Copia queste categorie in altre sezioni"
            >
              <Copy size={14} />
              <span>Copia in…</span>
            </button>
          )}
        </div>
      </div>
    </li>
  );
}

// ---------------------------------------------------------------------------
// SezioniTab (exported) — mirrors renderSezioni()
// ---------------------------------------------------------------------------
export default function SezioniTab({ concorsoId }: { concorsoId: string }) {
  const { data: sezioni, isLoading, isError } = useSezioni(concorsoId);
  const deleteSezione = useDeleteSezione(concorsoId);
  const qc = useQueryClient();

  // Candidati list — used for counts per sezione and per categoria
  const { data: candidati } = useQuery({
    queryKey: ['candidati', concorsoId],
    queryFn: () => candidatiApi.list(concorsoId),
    enabled: !!concorsoId,
    staleTime: 30_000,
  });

  // Build count maps once from the flat candidati list
  const candBySezione: Record<string, number> = {};
  const candByCategoria: Record<string, number> = {};
  for (const c of candidati ?? []) {
    if (c.sezioneId) candBySezione[c.sezioneId] = (candBySezione[c.sezioneId] ?? 0) + 1;
    if (c.categoriaId) candByCategoria[c.categoriaId] = (candByCategoria[c.categoriaId] ?? 0) + 1;
  }

  // Dialog state
  const [sezDialog, setSezDialog] = useState<{ open: boolean; existing?: SezioneRecord }>({
    open: false,
  });
  const [catDialog, setCatDialog] = useState<{
    open: boolean;
    sezione?: SezioneRecord;
    existing?: CategoriaRecord;
  }>({ open: false });
  const [copyDialog, setCopyDialog] = useState<{
    open: boolean;
    fromSezione?: SezioneRecord;
  }>({ open: false });
  const [importCsvOpen, setImportCsvOpen] = useState(false);

  // Delete confirms — mirrors confirmDialog({ danger: true })
  const [delSezConfirm, setDelSezConfirm] = useState<{ open: boolean; sezione?: SezioneRecord }>({
    open: false,
  });
  const [delCatConfirm, setDelCatConfirm] = useState<{
    open: boolean;
    sezione?: SezioneRecord;
    cat?: CategoriaRecord;
  }>({ open: false });

  // ---------- Sezione delete ----------
  const handleDeleteSezione = (s: SezioneRecord) => {
    setDelSezConfirm({ open: true, sezione: s });
  };

  const confirmDeleteSezione = async () => {
    const s = delSezConfirm.sezione;
    if (!s) return;
    setDelSezConfirm({ open: false });
    try {
      await deleteSezione.mutateAsync(s.id);
      toast.success('Sezione eliminata');
    } catch (e) {
      toast.error(resolveError(e));
    }
  };

  // ---------- Categoria delete ----------
  // We keep deleteCategoria per-sezione hooks inside SezioneCard to keep
  // the invalidation scoped. So we pass onDeleteCategoria up to the card
  // which opens the confirm dialog here, then mutates via a separate hook.

  const handleDeleteCategoria = (sez: SezioneRecord, cat: CategoriaRecord) => {
    setDelCatConfirm({ open: true, sezione: sez, cat });
  };

  // ---------- Loading ----------
  if (isLoading) {
    return (
      <div className="space-y-3">
        <div className="bg-white border border-slate-200 rounded-2xl p-4 animate-pulse h-24" />
        <div className="bg-white border border-slate-200 rounded-2xl p-4 animate-pulse h-24" />
      </div>
    );
  }

  if (isError) {
    return (
      <p className="text-sm text-rose-600">Errore nel caricamento delle sezioni.</p>
    );
  }

  const sezList = sezioni ?? [];

  return (
    <div>
      {/* Header — mirrors renderSezioni heading row */}
      <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
        <h3 className="text-sm font-bold text-slate-800 uppercase tracking-wider">
          Sezioni &amp; Categorie
        </h3>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setImportCsvOpen(true)}
            className="text-sm font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 px-3.5 py-2 rounded-lg"
            title="Importazione massiva da CSV"
          >
            Importa CSV
          </button>
          <button
            onClick={() => setSezDialog({ open: true })}
            className="text-sm font-semibold text-white bg-brand-600 hover:bg-brand-700 px-3.5 py-2 rounded-lg shadow-sm"
          >
            Nuova sezione
          </button>
        </div>
      </div>
      {/* Subtitle — mirrors admin.sezioni.subtitle */}
      <p className="text-sm text-slate-600 mb-4">
        Organizza il concorso in sezioni (per strumento o disciplina) e categorie (per fascia
        d&apos;età o livello).
      </p>

      {/* Empty state — mirrors the dashed border block with 🗂 emoji */}
      {sezList.length === 0 ? (
        <div className="bg-white border-2 border-dashed border-slate-200 rounded-2xl py-12 text-center">
          <div className="text-4xl mb-2">🗂</div>
          <p className="text-sm text-slate-500 italic">
            Nessuna sezione — creane una per organizzare il concorso.
          </p>
        </div>
      ) : (
        <ul className="space-y-3">
          {sezList.map((sez) => (
            <SezioneCard
              key={sez.id}
              sezione={sez}
              candBySezione={candBySezione}
              candByCategoria={candByCategoria}
              onEditSezione={(s) => setSezDialog({ open: true, existing: s })}
              onDeleteSezione={handleDeleteSezione}
              onAddCategoria={(s) => setCatDialog({ open: true, sezione: s })}
              onEditCategoria={(sez2, cat) =>
                setCatDialog({ open: true, sezione: sez2, existing: cat })
              }
              onDeleteCategoria={handleDeleteCategoria}
              onCopyCategorie={(s) => setCopyDialog({ open: true, fromSezione: s })}
            />
          ))}
        </ul>
      )}

      {/* ConfirmDialog: elimina sezione — mirrors confirmDialog danger */}
      <ConfirmDialog
        open={delSezConfirm.open}
        title={`Elimina sezione "${delSezConfirm.sezione?.nome ?? ''}"`}
        message="Sei sicuro? Questa operazione è irreversibile. Se la sezione è referenziata da candidati o fasi, il server bloccherà l'eliminazione."
        danger
        confirmLabel="Elimina"
        onConfirm={confirmDeleteSezione}
        onCancel={() => setDelSezConfirm({ open: false })}
      />

      {/* ConfirmDialog: elimina categoria */}
      {delCatConfirm.cat && delCatConfirm.sezione && (
        <DeleteCategoriaConfirm
          open={delCatConfirm.open}
          sezione={delCatConfirm.sezione}
          cat={delCatConfirm.cat}
          onClose={() => setDelCatConfirm({ open: false })}
        />
      )}

      {/* Sezione form dialog */}
      <SezioneFormDialog
        open={sezDialog.open}
        onOpenChange={(v) => setSezDialog((p) => ({ ...p, open: v }))}
        concorsoId={concorsoId}
        existing={sezDialog.existing}
      />

      {/* Categoria form dialog */}
      {catDialog.sezione && (
        <CategoriaFormDialog
          open={catDialog.open}
          onOpenChange={(v) => setCatDialog((p) => ({ ...p, open: v }))}
          sezione={catDialog.sezione}
          existing={catDialog.existing}
        />
      )}

      {/* Copy categorie dialog */}
      {copyDialog.fromSezione && (
        <CopyCategorieDialog
          open={copyDialog.open}
          onOpenChange={(v) => setCopyDialog((p) => ({ ...p, open: v }))}
          fromSezione={copyDialog.fromSezione}
          allSezioni={sezList}
        />
      )}

      {/* Import CSV dialog (sezioni + categorie) */}
      <ImportCsvDialog
        concorsoId={concorsoId}
        kind="sezioni"
        open={importCsvOpen}
        onOpenChange={setImportCsvOpen}
        onDone={() => {
          qc.invalidateQueries({ queryKey: ['sezioni', concorsoId] });
          qc.invalidateQueries({ queryKey: ['categorie'] });
        }}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// DeleteCategoriaConfirm — separate component so it can own the mutation hook
// (hooks must be called unconditionally, so wrapping in a rendered component
// is the idiomatic React way when the sezione_id is needed for invalidation).
// ---------------------------------------------------------------------------
interface DeleteCategoriaConfirmProps {
  open: boolean;
  sezione: SezioneRecord;
  cat: CategoriaRecord;
  onClose: () => void;
}

function DeleteCategoriaConfirm({ open, sezione, cat, onClose }: DeleteCategoriaConfirmProps) {
  const deleteCategoria = useDeleteCategoria(sezione.id);

  const handleConfirm = async () => {
    onClose();
    try {
      await deleteCategoria.mutateAsync(cat.id);
      toast.success('Categoria eliminata');
    } catch (e) {
      toast.error(resolveError(e));
    }
  };

  return (
    <ConfirmDialog
      open={open}
      title={`Elimina categoria "${cat.nome}"`}
      message="Sei sicuro? Se la categoria è referenziata da candidati o fasi, il server bloccherà l'eliminazione."
      danger
      confirmLabel="Elimina"
      onConfirm={handleConfirm}
      onCancel={onClose}
    />
  );
}
