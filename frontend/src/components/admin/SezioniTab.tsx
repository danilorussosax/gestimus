// =============================================================================
// SezioniTab — sezioni list + categorie tree per sezione (admin)
// Layout/structure/classes mirror js/views/admin/sezioni.js exactly.
// =============================================================================

import { useState } from 'react';
import { useForm, type Resolver } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { toast } from 'sonner';
import { Plus, Pencil, Trash2, Copy, Layers } from 'lucide-react';

import { httpErrorMessage } from '@/lib/api';
import { http } from '@/lib/api';
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
// CopyCategorieDialog — mirrors openCopyCategorieModal in sezioni.js
// Fan-out via individual categorieApi.create calls (no server bulk endpoint yet).
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
        // fetch existing names in destination to honor skipDup
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
            etaMin: cat.etaMin ?? undefined,
            etaMax: cat.etaMax ?? undefined,
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
      toast.error(httpErrorMessage(e));
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
          {/* Preview categorie sorgente */}
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
          {/* Sezioni destinazione */}
          <fieldset>
            <legend className="text-sm font-semibold text-slate-800 mb-2">
              Sezioni destinazione
            </legend>
            <div className="space-y-1.5 max-h-64 overflow-y-auto pr-1">
              {otherSezioni.map((s) => (
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
                  </span>
                </label>
              ))}
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

// ---------------------------------------------------------------------------
// SezioneCard — mirrors sezioneCardHtml() + categorie tree
// ---------------------------------------------------------------------------
interface SezioneCardProps {
  sezione: SezioneRecord;
  onEditSezione: (s: SezioneRecord) => void;
  onDeleteSezione: (s: SezioneRecord) => void;
  onAddCategoria: (s: SezioneRecord) => void;
  onEditCategoria: (sez: SezioneRecord, cat: CategoriaRecord) => void;
  onCopyCategorie: (s: SezioneRecord) => void;
}

function SezioneCard({
  sezione,
  onEditSezione,
  onDeleteSezione,
  onAddCategoria,
  onEditCategoria,
  onCopyCategorie,
}: SezioneCardProps) {
  const { data: cats, isLoading } = useCategorie(sezione.id);
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

  const catCount = cats?.length ?? 0;

  return (
    <li className="bg-white border border-slate-200 rounded-2xl p-4">
      {/* Header sezione */}
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-3 min-w-0">
          <div className="w-10 h-10 rounded-xl bg-brand-50 text-brand-700 flex items-center justify-center text-lg shrink-0">
            {iconaPerSezione(sezione.nome)}
          </div>
          <div className="min-w-0">
            <h4 className="font-bold text-slate-900">{sezione.nome}</h4>
            {sezione.descrizione && (
              <p className="text-xs text-slate-500 mt-0.5">{sezione.descrizione}</p>
            )}
            <p className="text-[11px] text-slate-500 mt-1">
              {isLoading
                ? '…'
                : `${catCount} categori${catCount === 1 ? 'a' : 'e'}`}
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

      {/* Categorie tree */}
      <div className="mt-3 ml-13 pl-3 border-l-2 border-slate-100">
        {isLoading ? (
          <p className="text-xs text-slate-400 italic mb-2">Caricamento…</p>
        ) : catCount === 0 ? (
          <p className="text-xs text-slate-400 italic mb-2">Nessuna categoria</p>
        ) : (
          <ul className="space-y-1.5 mb-2">
            {cats!.map((cat) => (
              <li
                key={cat.id}
                className="flex items-center justify-between gap-2 bg-slate-50 rounded-lg px-3 py-2"
              >
                <div className="min-w-0 flex items-center gap-2">
                  <span className="text-sm font-medium text-slate-800">{cat.nome}</span>
                  {cat.descrizione && (
                    <span className="text-[11px] text-slate-500 ml-1">{cat.descrizione}</span>
                  )}
                  {(cat.etaMin != null || cat.etaMax != null) && (
                    <span className="text-[10px] font-mono px-1.5 py-0.5 bg-white border border-slate-200 rounded text-slate-600">
                      {cat.etaMin ?? 0}–{cat.etaMax ?? '∞'} anni
                    </span>
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
                    onClick={() => handleDeleteCategoria(cat)}
                    className="w-9 h-9 inline-flex items-center justify-center rounded-lg text-rose-600 bg-white hover:bg-rose-50 border border-rose-100 transition-colors"
                    title="Elimina categoria"
                  >
                    <Trash2 size={18} />
                  </button>
                </div>
              </li>
            ))}
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
  const [copyDialog, setCopyDialog] = useState<{
    open: boolean;
    fromSezione?: SezioneRecord;
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
            onClick={() => setSezDialog({ open: true })}
            className="text-sm font-semibold text-white bg-brand-600 hover:bg-brand-700 px-3.5 py-2 rounded-lg shadow-sm inline-flex items-center gap-1.5"
          >
            <Plus size={16} />
            <span>Nuova sezione</span>
          </button>
        </div>
      </div>
      <p className="text-sm text-slate-600 mb-4">
        {sezList.length} sezioni · organizza i partecipanti per disciplina e fascia d&apos;età.
      </p>

      {/* Empty state */}
      {sezList.length === 0 && (
        <div className="bg-white border-2 border-dashed border-slate-200 rounded-2xl py-12 text-center">
          <div className="text-4xl mb-2">
            <Layers className="mx-auto h-10 w-10 text-slate-300" />
          </div>
          <p className="text-sm text-slate-500 italic">
            Nessuna sezione — creane una per organizzare il concorso.
          </p>
        </div>
      )}

      {/* List */}
      {sezList.length > 0 && (
        <ul className="space-y-3">
          {sezList.map((sez) => (
            <SezioneCard
              key={sez.id}
              sezione={sez}
              onEditSezione={(s) => setSezDialog({ open: true, existing: s })}
              onDeleteSezione={handleDeleteSezione}
              onAddCategoria={(s) => setCatDialog({ open: true, sezione: s })}
              onEditCategoria={(sez2, cat) =>
                setCatDialog({ open: true, sezione: sez2, existing: cat })
              }
              onCopyCategorie={(s) => setCopyDialog({ open: true, fromSezione: s })}
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

      {/* Copy categorie dialog */}
      {copyDialog.fromSezione && (
        <CopyCategorieDialog
          open={copyDialog.open}
          onOpenChange={(v) => setCopyDialog((p) => ({ ...p, open: v }))}
          fromSezione={copyDialog.fromSezione}
          allSezioni={sezList}
        />
      )}
    </div>
  );
}
