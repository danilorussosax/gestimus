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
//
// Presentation: vanilla-JS design system (c-tile, c-btn, c-tag, c-field,
// c-input, c-select, raw Tailwind amber/emerald/brand pills exactly as in
// js/views/admin/commissioni.js).
// =============================================================================

import { useState, useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { toast } from 'sonner';
import { Plus, Pencil, Trash2, Scale } from 'lucide-react';

import { fileUrl, httpErrorMessage } from '@/lib/api';
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
import { useCategorie, type CategoriaRecord } from '@/api/categorie';

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
    <div className="border border-slate-200 rounded-lg p-2 bg-slate-50">
      <div className="text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1">
        {sezione.nome}
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-1">
        {cats.map((cat: CategoriaRecord) => (
          <label
            key={cat.id}
            className="flex items-center gap-2 bg-white hover:bg-brand-50 border border-slate-200 rounded-md px-2 py-1 cursor-pointer"
          >
            <input
              type="checkbox"
              checked={selectedCatIds.has(cat.id)}
              onChange={(e) => onChange(cat.id, e.target.checked)}
              disabled={disabled}
              className="w-3.5 h-3.5 rounded border-slate-300 text-brand-600"
            />
            <span className="text-xs text-slate-800 truncate">{cat.nome}</span>
          </label>
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// CommissioneFormDialog — modal overlay matching vanilla JS modal()
// ---------------------------------------------------------------------------
interface FormDialogProps {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  concorsoId: string;
  allCommissari: CommissarioRecord[];
  allSezioni: SezioneRecord[];
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

  useEffect(() => {
    if (open) {
      setSelCommissari(new Set(existing?.commissari ?? []));
      setSelSezioni(new Set(existing?.sezioni ?? []));
      setSelCategorie(new Set(existing?.categorie ?? []));
      setIncludeTutte(false);
      setPresidente(existing?.presidenteCommissarioId ?? '');
    }
  }, [open, existing]);

  // Sync "include tutte" → categories
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
    if (includeTutte) return;
    setSelCategorie((prev) => {
      const next = new Set(prev);
      if (checked) next.add(id); else next.delete(id);
      return next;
    });
  };

  const toggleIncludeTutte = (checked: boolean) => {
    setIncludeTutte(checked);
    if (!checked) {
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
        await updateCommissione.mutateAsync({
          id: existing.id,
          body: {
            nome: values.nome.trim(),
            presidenteCommissarioId: presidenteValido || undefined,
          },
        });
        await commissioniApi.syncRelations(existing.id, existing, {
          commissariIds: Array.from(selCommissari),
          sezioniIds: Array.from(selSezioni),
          categorieIds,
        });
        toast.success('Commissione aggiornata');
      } else {
        const created = await createCommissione.mutateAsync({
          concorsoId,
          nome: values.nome.trim(),
          presidenteCommissarioId: presidenteValido || undefined,
        });
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

  if (!open) return null;

  // inputCls matching vanilla JS exactly
  const inputCls =
    'mt-1 w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-brand-500 focus:border-brand-500';

  return (
    /* Backdrop */
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4"
      onClick={(e) => { if (e.target === e.currentTarget) onOpenChange(false); }}
    >
      <div
        className="bg-white rounded-2xl shadow-xl w-full max-w-2xl max-h-[92dvh] flex flex-col modal-pop"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 pt-5 pb-4 border-b border-slate-200">
          <div>
            <h3 className="text-base font-bold text-slate-900">
              {isEdit ? `Modifica commissione` : 'Nuova commissione'}
            </h3>
            {isEdit && existing && (
              <p className="text-xs text-slate-500 mt-0.5">{existing.nome}</p>
            )}
          </div>
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            className="w-8 h-8 inline-flex items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100 transition-colors"
            aria-label="Chiudi"
          >
            ×
          </button>
        </div>

        {/* Scrollable body */}
        <form
          id="comm-frm"
          onSubmit={form.handleSubmit(onSubmit)}
          className="flex-1 overflow-y-auto px-6 py-4 space-y-4"
          autoComplete="off"
        >
          {/* Nome + Descrizione */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <label className="block sm:col-span-2">
              <span className="text-sm font-medium text-slate-700">
                Nome <span className="text-rose-500">*</span>
              </span>
              <input
                {...form.register('nome')}
                className={inputCls}
                placeholder="Es. Commissione Pianoforte"
              />
              {form.formState.errors.nome && (
                <p className="mt-1 text-xs text-rose-600">
                  {form.formState.errors.nome.message}
                </p>
              )}
            </label>
            <label className="block sm:col-span-2">
              <span className="text-sm font-medium text-slate-700">Descrizione</span>
              <textarea
                {...form.register('descrizione')}
                rows={2}
                className={inputCls}
                placeholder="Descrizione opzionale"
              />
            </label>
          </div>

          {/* Sezione: Commissari */}
          <section className="pt-4 border-t border-slate-200">
            <header className="mb-2">
              <h4 className="text-sm font-bold text-slate-900">Membri</h4>
              <p className="text-xs text-slate-500">
                Seleziona i commissari assegnati a questa commissione.
              </p>
            </header>
            <div className="space-y-1.5 max-h-56 overflow-y-auto pr-1" id="comm-list">
              {allCommissari.length === 0 ? (
                <span className="text-xs text-slate-400 italic">
                  Nessun commissario disponibile — aggiungine uno prima.
                </span>
              ) : (
                allCommissari.map((c) => {
                  const fotoSrc = c.foto ? fileUrl(c.foto) : null;
                  return (
                    <label
                      key={c.id}
                      className="flex items-center gap-2 bg-white hover:bg-slate-50 border border-slate-200 rounded-lg px-2.5 py-1.5 cursor-pointer"
                    >
                      <input
                        type="checkbox"
                        data-comm={c.id}
                        checked={selCommissari.has(c.id)}
                        onChange={(e) => toggleCommissario(c.id, e.target.checked)}
                        className="w-4 h-4 rounded border-slate-300 text-brand-600"
                      />
                      <div className="w-6 h-6 rounded-full bg-amber-100 text-amber-700 overflow-hidden flex items-center justify-center text-xs shrink-0">
                        {fotoSrc ? (
                          <img src={fotoSrc} alt="" className="w-full h-full object-cover" />
                        ) : (
                          '🧑‍⚖️'
                        )}
                      </div>
                      <span className="text-sm text-slate-800 truncate flex-1">
                        {displayName(c)}
                      </span>
                      {c.specialita && (
                        <span className="text-[10px] text-slate-500 ml-auto truncate max-w-[120px]">
                          {c.specialita}
                        </span>
                      )}
                    </label>
                  );
                })
              )}
            </div>
            <div className="mt-2 text-[11px] text-slate-500">
              {selCommissari.size} selezionati
            </div>

            {/* Presidente */}
            <div className="mt-3 bg-amber-50 border border-amber-200 rounded-lg p-3">
              <label className="block">
                <span className="text-sm font-semibold text-amber-900 flex items-center gap-1.5">
                  🎯 Presidente della commissione
                </span>
                <p className="text-[11px] text-amber-800 mt-0.5 mb-2">
                  Il presidente pilota le fasi a cui questa commissione è assegnata: avvia/conclude,
                  gestisce il timer, conferma le valutazioni.
                </p>
                <select
                  id="presidente-select"
                  value={presidente}
                  onChange={(e) => setPresidente(e.target.value)}
                  className={inputCls + ' mt-0'}
                >
                  <option value="">— Nessun presidente (l&apos;admin gestirà le fasi) —</option>
                  {allCommissari.map((c) => (
                    <option key={c.id} value={c.id}>
                      {displayName(c)}
                      {c.specialita ? ` · ${c.specialita}` : ''}
                    </option>
                  ))}
                </select>
                <p className="text-[10px] text-amber-700 mt-1 italic">
                  Il presidente deve essere uno dei membri sopra selezionati.
                </p>
              </label>
            </div>
          </section>

          {/* Sezione: Sezioni */}
          <section className="pt-4 border-t border-slate-200">
            <header className="mb-2">
              <h4 className="text-sm font-bold text-slate-900">Sezioni</h4>
              <p className="text-xs text-slate-500">
                Sezioni di competenza di questa commissione.
              </p>
            </header>
            <div className="space-y-1.5 max-h-44 overflow-y-auto pr-1" id="sez-list">
              {allSezioni.length === 0 ? (
                <span className="text-xs text-slate-400 italic">
                  Nessuna sezione disponibile — creane una nel tab Sezioni.
                </span>
              ) : (
                allSezioni.map((s) => {
                  const nCat = catsBySezione.get(s.id)?.length ?? 0;
                  return (
                    <label
                      key={s.id}
                      className="flex items-center gap-2 bg-white hover:bg-slate-50 border border-slate-200 rounded-lg px-2.5 py-1.5 cursor-pointer"
                    >
                      <input
                        type="checkbox"
                        data-sez={s.id}
                        checked={selSezioni.has(s.id)}
                        onChange={(e) => toggleSezione(s.id, e.target.checked)}
                        className="w-4 h-4 rounded border-slate-300 text-brand-600"
                      />
                      <span className="text-sm text-slate-800 flex-1">{s.nome}</span>
                      <span className="text-[10px] text-slate-500 ml-auto">
                        {nCat} cat.
                      </span>
                    </label>
                  );
                })
              )}
            </div>
            {allSezioni.length > 0 && (
              <label className="mt-3 flex items-start gap-2 bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2 cursor-pointer">
                <input
                  type="checkbox"
                  id="incl-tutte"
                  checked={includeTutte}
                  onChange={(e) => toggleIncludeTutte(e.target.checked)}
                  className="mt-0.5 w-4 h-4 rounded border-emerald-300 text-emerald-600"
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
            )}
          </section>

          {/* Sezione: Categorie */}
          <section className="pt-4 border-t border-slate-200">
            <header className="mb-2">
              <h4 className="text-sm font-bold text-slate-900">Categorie</h4>
              <p className="text-xs text-slate-500">
                {includeTutte
                  ? 'Tutte le categorie delle sezioni selezionate vengono incluse automaticamente.'
                  : 'Seleziona le categorie specifiche assegnate a questa commissione.'}
              </p>
            </header>
            <div className="space-y-2" id="cat-list">
              {allSezioni.length === 0 ? (
                <span className="text-xs text-slate-400 italic">
                  Nessuna sezione disponibile.
                </span>
              ) : selSezioni.size === 0 ? (
                <span className="text-xs text-slate-400 italic">
                  Seleziona almeno una sezione per vedere le categorie.
                </span>
              ) : (
                allSezioni
                  .filter((s) => selSezioni.has(s.id))
                  .map((s) => (
                    <CategoriePerSezioneSelector
                      key={s.id}
                      sezione={s}
                      selectedCatIds={selCategorie}
                      onChange={toggleCategoria}
                      disabled={includeTutte}
                    />
                  ))
              )}
            </div>
          </section>
        </form>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 px-6 py-4 border-t border-slate-200">
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            className="c-btn c-btn--outline c-btn--sm"
          >
            Annulla
          </button>
          <button
            type="submit"
            form="comm-frm"
            disabled={saving}
            className="c-btn c-btn--primary c-btn--sm"
          >
            {saving
              ? 'Salvataggio…'
              : isEdit
                ? 'Salva modifiche'
                : 'Crea commissione'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// CommissioneCard — matches commissioneCardHtml() in commissioni.js exactly
// ---------------------------------------------------------------------------
interface CommissioneCardProps {
  commissione: CommissioneRecord;
  allCommissari: CommissarioRecord[];
  allSezioni: SezioneRecord[];
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
    .filter((x): x is CommissarioRecord => !!x);
  const sezs = c.sezioni
    .map((id) => allSezioni.find((x) => x.id === id))
    .filter((x): x is SezioneRecord => !!x);
  const pres = c.presidenteCommissarioId
    ? allCommissari.find((x) => x.id === c.presidenteCommissarioId)
    : null;

  return (
    <div className="bg-white border border-slate-200 rounded-2xl p-4">
      {/* Title row */}
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h4 className="font-bold text-slate-900 truncate">{c.nome}</h4>
          {c.descrizione && (
            <p className="text-xs text-slate-500 mt-0.5">{c.descrizione}</p>
          )}
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <button
            onClick={onEdit}
            className="w-9 h-9 inline-flex items-center justify-center rounded-lg text-brand-700 bg-brand-50 hover:bg-brand-100 border border-brand-100 transition-colors"
            title="Modifica commissione"
          >
            <Pencil size={18} />
          </button>
          <button
            onClick={onDelete}
            className="w-9 h-9 inline-flex items-center justify-center rounded-lg text-rose-600 bg-rose-50 hover:bg-rose-100 border border-rose-100 transition-colors"
            title="Elimina commissione"
          >
            <Trash2 size={18} />
          </button>
        </div>
      </div>

      {/* Presidente badge */}
      {pres ? (
        <div className="mt-3 inline-flex items-center gap-2 bg-amber-50 border border-amber-200 text-amber-900 rounded-lg px-2.5 py-1.5">
          <span className="text-base">🎯</span>
          <div className="text-[11px] leading-tight">
            <div className="font-bold uppercase tracking-wider text-[9px] text-amber-700">
              Presidente
            </div>
            <div className="font-semibold">{displayName(pres)}</div>
          </div>
        </div>
      ) : (
        <div className="mt-3 inline-flex items-center gap-1.5 text-[11px] text-amber-700 bg-amber-50/50 border border-dashed border-amber-300 rounded-lg px-2.5 py-1">
          <span>⚠</span>
          <span className="italic">Nessun presidente — modifica per assegnarne uno</span>
        </div>
      )}

      <div className="mt-3 grid grid-cols-1 gap-2">
        {/* Membri */}
        <div>
          <div className="text-[10px] uppercase tracking-wider text-slate-500 font-semibold mb-1">
            Membri ({members.length})
          </div>
          <div className="flex flex-wrap gap-1">
            {members.length === 0 ? (
              <span className="text-xs text-slate-400 italic">Nessun membro</span>
            ) : (
              members.map((m) => {
                const isPres = c.presidenteCommissarioId === m.id;
                const fotoSrc = m.foto ? fileUrl(m.foto) : null;
                return (
                  <span
                    key={m.id}
                    className={
                      'inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-full ' +
                      (isPres
                        ? 'bg-amber-100 text-amber-900 ring-1 ring-amber-300'
                        : 'bg-slate-100 text-slate-700')
                    }
                  >
                    <span className="w-4 h-4 rounded-full bg-amber-100 text-amber-700 flex items-center justify-center text-[9px] overflow-hidden">
                      {fotoSrc ? (
                        <img src={fotoSrc} className="w-full h-full object-cover" alt="" />
                      ) : (
                        '🧑‍⚖️'
                      )}
                    </span>
                    {displayName(m)}
                    {isPres && ' 🎯'}
                  </span>
                );
              })
            )}
          </div>
        </div>

        {/* Sezioni */}
        <div>
          <div className="text-[10px] uppercase tracking-wider text-slate-500 font-semibold mb-1">
            Sezioni ({sezs.length})
          </div>
          <div className="flex flex-wrap gap-1">
            {sezs.length === 0 ? (
              <span className="text-xs text-slate-400 italic">Nessuna sezione</span>
            ) : (
              sezs.map((s) => (
                <span
                  key={s.id}
                  className="text-[11px] bg-brand-50 text-brand-700 px-2 py-0.5 rounded-full font-medium"
                >
                  {s.nome}
                </span>
              ))
            )}
          </div>
        </div>

        {/* Categorie */}
        <div>
          <div className="text-[10px] uppercase tracking-wider text-slate-500 font-semibold mb-1">
            Categorie ({c.categorie.length})
          </div>
          <div className="flex flex-wrap gap-1">
            {c.categorie.length === 0 ? (
              <span className="text-xs text-slate-400 italic">Nessuna categoria</span>
            ) : (
              c.categorie.map((id) => (
                <span
                  key={id}
                  className="text-[11px] bg-slate-100 text-slate-700 px-2 py-0.5 rounded-full"
                >
                  {allCatNames.get(id) ?? id.slice(0, 8)}
                </span>
              ))
            )}
          </div>
        </div>
      </div>
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
        <div className="bg-white border border-slate-200 rounded-2xl h-36 animate-pulse" />
        <div className="bg-white border border-slate-200 rounded-2xl h-36 animate-pulse" />
      </div>
    );
  }

  if (isError) {
    return (
      <p className="text-sm text-rose-600">Errore nel caricamento delle commissioni.</p>
    );
  }

  return (
    <div className="view-fade space-y-4">
      {/* Header — matches vanilla flex justify-between */}
      <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
        <h3 className="text-sm font-bold text-slate-800 uppercase tracking-wider">
          Commissioni
        </h3>
        <button
          className="c-btn c-btn--primary c-btn--sm"
          onClick={() => setDialog({ open: true })}
        >
          <Plus size={16} />
          Nuova commissione
        </button>
      </div>
      <p className="text-sm text-slate-600 mb-4">
        {commissioni?.length ?? 0} commissioni · ogni commissione gestisce una o più sezioni.
      </p>

      {/* Warnings */}
      {(allCommissari?.length ?? 0) === 0 && (
        <div className="bg-amber-50 border border-amber-200 text-amber-900 rounded-xl px-4 py-3 mb-4 text-sm">
          Nessun commissario disponibile — aggiungine uno nel tab Commissari.
        </div>
      )}
      {(allSezioni?.length ?? 0) === 0 && (
        <div className="bg-amber-50 border border-amber-200 text-amber-900 rounded-xl px-4 py-3 mb-4 text-sm">
          Nessuna sezione disponibile — creane una nel tab Sezioni.
        </div>
      )}

      {/* Empty state */}
      {(commissioni?.length ?? 0) === 0 ? (
        <div className="bg-white border-2 border-dashed border-slate-200 rounded-2xl py-12 text-center">
          <div className="text-4xl mb-2">
            <Scale className="mx-auto h-10 w-10 text-slate-300" />
          </div>
          <p className="text-sm text-slate-500 italic">
            Nessuna commissione — creane una per organizzare la giuria.
          </p>
          <button
            className="c-btn c-btn--outline c-btn--sm mt-4"
            onClick={() => setDialog({ open: true })}
          >
            <Plus size={16} />
            Crea la prima commissione
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
          {commissioni!.map((c) => (
            <CommissioneCard
              key={c.id}
              commissione={c}
              allCommissari={attiviCommissari}
              allSezioni={allSezioni ?? []}
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
