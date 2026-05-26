// =============================================================================
// CommissioniTab — gestione commissioni + N-N sync (admin)
//
// Port FEDELE di js/views/admin/commissioni.js. Replica esattamente:
//  - Header (⚖ Commissioni + sottotitolo) + warnings (no commissari / no sezioni)
//  - Empty state (⚖)
//  - Card commissione:
//    · titolo + descrizione
//    · badge Presidente (🎯) oppure warning "Nessun presidente"
//    · 🧑‍⚖️ Commissari (n) con foto/emoji + 🎯 sul presidente DI QUESTA commissione
//    · 🗂 Sezioni (n) con iconaPerSezione
//    · 📑 Categorie (n) con tooltip sezione
//  - Form crea/modifica:
//    · nome (required) + descrizione
//    · multi-select commissari (con 🎯 se presidente di QUALCHE commissione) + contatore
//    · selettore presidente (amber box) limitato semanticamente ai membri
//    · multi-select sezioni (con conteggio categorie)
//    · toggle "includi tutte le categorie" → auto-popola e blocca le checkbox
//    · selettore categorie granulare raggruppato per sezione
//  - Delete con conferma
//  - Sync N-N con diff-apply (no replace-all)
//
// NB: il backend Postgres NON persiste `descrizione` né `include_tutte_categorie`
// (vedi server/src/db/schema.ts → commissioni). Il toggle "tutte le categorie"
// resta quindi una comodità in-form: espande le categorie delle sezioni scelte
// e le invia esplicitamente in `categorieIds` (esattamente come il ramo
// `finalCategorieIds` del vanilla). La descrizione resta nella UI ma non viene
// inviata al server (coerente con l'API attuale).
// =============================================================================

import { useState, useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useQueries } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Pencil, Trash2 } from 'lucide-react';

import { fileUrl, httpErrorMessage } from '@/lib/api';
import { iconaPerSezione } from '@/lib/sezione-icon';
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
import { categorieApi, categorieKeys, type CategoriaRecord } from '@/api/categorie';
import {
  getPresidenteForCommissione,
  isPresidenteDiQualcheCommissione,
} from '@/lib/presidenti';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function displayName(c: Pick<CommissarioRecord, 'nome' | 'cognome'>) {
  return [c.nome, c.cognome].filter(Boolean).join(' ');
}

// inputCls — identico al vanilla (commissioni.js)
const inputCls =
  'mt-1 w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-brand-500 focus:border-brand-500';

// ---------------------------------------------------------------------------
// useCategorieMaps — aggrega le categorie di TUTTE le sezioni del concorso.
// Sostituisce `db.state.categorie` del vanilla: il backend espone le categorie
// per-sezione, quindi facciamo fan-out con useQueries.
//   · catsBySezione: sezioneId → CategoriaRecord[]   (per il form + auto-include)
//   · allCats:       catId      → CategoriaRecord     (per nomi + tooltip sezione)
// ---------------------------------------------------------------------------
function useCategorieMaps(sezioni: SezioneRecord[]) {
  const results = useQueries({
    queries: sezioni.map((s) => ({
      queryKey: categorieKeys.bySezione(s.id),
      queryFn: () => categorieApi.listBySezione(s.id),
      enabled: !!s.id,
      staleTime: 30_000,
    })),
  });

  const catsBySezione = new Map<string, CategoriaRecord[]>();
  const allCats = new Map<string, CategoriaRecord>();
  sezioni.forEach((s, i) => {
    const cats = (results[i]?.data ?? []);
    catsBySezione.set(s.id, cats);
    for (const c of cats) allCats.set(c.id, c);
  });

  return { catsBySezione, allCats };
}

// ---------------------------------------------------------------------------
// Zod schema (solo nome/descrizione — il resto è gestito a parte come nel
// vanilla, dove `formFields` legge nome/descrizione e il resto vive nei Set).
// ---------------------------------------------------------------------------
const commissioneSchema = z.object({
  nome: z.string().min(1, 'Nome obbligatorio').max(255),
  descrizione: z.string().max(2000).optional(),
});
type CommissioneFormValues = z.infer<typeof commissioneSchema>;

// ---------------------------------------------------------------------------
// CommissioneFormDialog — replica modal() del vanilla openCommissioneForm()
// ---------------------------------------------------------------------------
interface FormDialogProps {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  concorsoId: string;
  allCommissari: CommissarioRecord[];
  allSezioni: SezioneRecord[];
  catsBySezione: Map<string, CategoriaRecord[]>;
  /** id commissari che sono presidente di QUALCHE commissione (per il 🎯). */
  presidentiOvunque: Set<string>;
  existing?: CommissioneRecord;
}

function CommissioneFormDialog({
  open,
  onOpenChange,
  concorsoId,
  allCommissari,
  allSezioni,
  catsBySezione,
  presidentiOvunque,
  existing,
}: FormDialogProps) {
  const isEdit = !!existing;
  const createCommissione = useCreateCommissione(concorsoId);
  const updateCommissione = useUpdateCommissione(concorsoId);

  const [selCommissari, setSelCommissari] = useState<Set<string>>(new Set());
  const [selSezioni, setSelSezioni] = useState<Set<string>>(new Set());
  const [selCategorie, setSelCategorie] = useState<Set<string>>(new Set());
  const [includeTutte, setIncludeTutte] = useState(false);
  const [selPresidente, setSelPresidente] = useState<string>('');
  const [saving, setSaving] = useState(false);

  // Reset sullo open (come il re-mount del modal vanilla).
  useEffect(() => {
    if (!open) return;
    setSelCommissari(new Set(existing?.commissari ?? []));
    setSelSezioni(new Set(existing?.sezioni ?? []));
    setSelCategorie(new Set(existing?.categorie ?? []));
    // include_tutte_categorie non è persistito dal backend → parte sempre off.
    setIncludeTutte(false);
    setSelPresidente(existing?.presidenteCommissarioId ?? '');
  }, [open, existing]);

  const form = useForm<CommissioneFormValues>({
    resolver: zodResolver(commissioneSchema),
    values: {
      nome: existing?.nome ?? '',
      descrizione: existing?.descrizione ?? '',
    },
  });

  // syncCategorieAuto: quando "includi tutte" è attivo, le categorie delle
  // sezioni scelte vengono auto-popolate e le checkbox bloccate in checked.
  // (vanilla: syncCategorieAuto). Disattivato → ripristina la scelta manuale.
  useEffect(() => {
    if (!includeTutte) return;
    const auto = new Set<string>();
    for (const sezId of selSezioni) {
      (catsBySezione.get(sezId) ?? []).forEach((c) => auto.add(c.id));
    }
    setSelCategorie(auto);
    // selSezioni cambia → ricalcola; catsBySezione cambia → ricalcola.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [includeTutte, selSezioni]);

  const toggleCommissario = (id: string, checked: boolean) => {
    setSelCommissari((prev) => {
      const next = new Set(prev);
      if (checked) next.add(id);
      else next.delete(id);
      return next;
    });
    // Smarcare un membro che era presidente → azzera il presidente.
    if (!checked && id === selPresidente) setSelPresidente('');
  };

  const toggleSezione = (id: string, checked: boolean) => {
    setSelSezioni((prev) => {
      const next = new Set(prev);
      if (checked) next.add(id);
      else next.delete(id);
      return next;
    });
  };

  const toggleCategoria = (id: string, checked: boolean) => {
    if (includeTutte) return; // checkbox bloccate dal flag
    setSelCategorie((prev) => {
      const next = new Set(prev);
      if (checked) next.add(id);
      else next.delete(id);
      return next;
    });
  };

  const toggleIncludeTutte = (checked: boolean) => {
    setIncludeTutte(checked);
    if (!checked) {
      // Ripristina lo stato manuale (ciò che l'admin aveva scelto / esistente).
      setSelCategorie(new Set(existing?.categorie ?? []));
    }
  };

  const finalCategorieIds = (): string[] => {
    if (includeTutte) {
      const auto = new Set<string>();
      for (const sezId of selSezioni) {
        (catsBySezione.get(sezId) ?? []).forEach((c) => auto.add(c.id));
      }
      return Array.from(auto);
    }
    return Array.from(selCategorie);
  };

  const onSubmit = async (values: CommissioneFormValues) => {
    // Il presidente deve essere tra i membri selezionati; altrimenti azzera.
    const presidenteValido =
      selPresidente && selCommissari.has(selPresidente) ? selPresidente : '';
    const categorieIds = finalCategorieIds();

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

  return (
    /* Backdrop */
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4"
      onClick={(e) => {
        if (e.target === e.currentTarget) onOpenChange(false);
      }}
    >
      <div
        className="bg-white rounded-2xl shadow-xl w-full max-w-2xl max-h-[92dvh] flex flex-col modal-pop"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 pt-5 pb-4 border-b border-slate-200">
          <div>
            <h3 className="text-base font-bold text-slate-900">
              {isEdit ? 'Modifica commissione' : 'Aggiungi commissione'}
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
                Nome commissione <span className="text-rose-500">*</span>
              </span>
              <input
                {...form.register('nome')}
                className={inputCls}
                placeholder="Es: Giuria Archi, Giuria Fiati Senior"
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
                placeholder="Breve descrizione (opzionale)"
              />
            </label>
          </div>

          {/* Sezione: Membri */}
          <section className="pt-4 border-t border-slate-200">
            <header className="mb-2">
              <h4 className="text-sm font-bold text-slate-900">
                🧑‍⚖️ Membri della commissione
              </h4>
              <p className="text-xs text-slate-500">
                Seleziona i commissari che ne fanno parte. Un commissario può appartenere a
                più commissioni.
              </p>
            </header>
            <div className="space-y-1.5 max-h-56 overflow-y-auto pr-1" id="comm-list">
              {allCommissari.length === 0 ? (
                <span className="text-xs text-slate-400 italic">
                  Nessun commissario disponibile. Aggiungili dalla scheda Commissari.
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
                      <span className="text-sm text-slate-800 truncate">
                        {displayName(c)}
                        {presidentiOvunque.has(c.id) ? ' 🎯' : ''}
                      </span>
                      <span className="text-[10px] text-slate-500 ml-auto truncate">
                        {c.specialita ?? ''}
                      </span>
                    </label>
                  );
                })
              )}
            </div>
            <div className="mt-2 text-[11px] text-slate-500">
              {selCommissari.size} selezionati
            </div>

            {/* Selezione presidente DI QUESTA COMMISSIONE */}
            <div className="mt-3 bg-amber-50 border border-amber-200 rounded-lg p-3">
              <label className="block">
                <span className="text-sm font-semibold text-amber-900 flex items-center gap-1.5">
                  🎯 Presidente della commissione
                </span>
                <p className="text-[11px] text-amber-800 mt-0.5 mb-2">
                  Il presidente pilota le fasi a cui questa commissione è assegnata:
                  avvia/conclude, gestisce il timer, conferma le valutazioni.
                </p>
                <select
                  value={selPresidente}
                  onChange={(e) => setSelPresidente(e.target.value)}
                  className={inputCls + ' mt-0'}
                >
                  <option value="">
                    — Nessun presidente (l&apos;admin gestirà le fasi) —
                  </option>
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

          {/* Sezione: Sezioni assegnate */}
          <section className="pt-4 border-t border-slate-200">
            <header className="mb-2">
              <h4 className="text-sm font-bold text-slate-900">🗂 Sezioni assegnate</h4>
              <p className="text-xs text-slate-500">
                La commissione può coprire più sezioni del concorso.
              </p>
            </header>
            <div className="space-y-1.5 max-h-44 overflow-y-auto pr-1" id="sez-list">
              {allSezioni.length === 0 ? (
                <span className="text-xs text-slate-400 italic">
                  Nessuna sezione disponibile.
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
                        checked={selSezioni.has(s.id)}
                        onChange={(e) => toggleSezione(s.id, e.target.checked)}
                        className="w-4 h-4 rounded border-slate-300 text-brand-600"
                      />
                      <span className="text-sm text-slate-800">{s.nome}</span>
                      <span className="text-[10px] text-slate-500 ml-auto">
                        {nCat} categorie
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
                  checked={includeTutte}
                  onChange={(e) => toggleIncludeTutte(e.target.checked)}
                  className="mt-0.5 w-4 h-4 rounded border-emerald-300 text-emerald-600"
                />
                <div>
                  <span className="text-sm font-semibold text-emerald-900">
                    ✨ Includi automaticamente tutte le categorie delle sezioni selezionate
                  </span>
                  <p className="text-[11px] text-emerald-800 mt-0.5">
                    Se attivo, la commissione valuterà automaticamente{' '}
                    <strong>tutte</strong> le categorie presenti nelle sezioni scelte sopra
                    (anche quelle aggiunte in futuro).
                  </p>
                </div>
              </label>
            )}
          </section>

          {/* Sezione: Categorie specifiche */}
          <section className="pt-4 border-t border-slate-200">
            <header className="mb-2">
              <h4 className="text-sm font-bold text-slate-900">📑 Categorie specifiche</h4>
              <p className="text-xs text-slate-500">
                Assegnazioni puntuali — utile per coprire solo alcune categorie di una
                sezione (se non hai attivato &quot;auto-include&quot;).
              </p>
            </header>
            <div className="space-y-2" id="cat-list">
              {allSezioni.length === 0 ? (
                <span className="text-xs text-slate-400 italic">
                  Nessuna sezione disponibile.
                </span>
              ) : (
                allSezioni.map((s) => {
                  const cats = catsBySezione.get(s.id) ?? [];
                  if (cats.length === 0) return null;
                  return (
                    <div
                      key={s.id}
                      className="border border-slate-200 rounded-lg p-2 bg-slate-50"
                    >
                      <div className="text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1">
                        {s.nome}
                      </div>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-1">
                        {cats.map((c) => (
                          <label
                            key={c.id}
                            className="flex items-center gap-2 bg-white hover:bg-brand-50 border border-slate-200 rounded-md px-2 py-1 cursor-pointer"
                          >
                            <input
                              type="checkbox"
                              checked={selCategorie.has(c.id)}
                              onChange={(e) => toggleCategoria(c.id, e.target.checked)}
                              disabled={includeTutte}
                              className="w-3.5 h-3.5 rounded border-slate-300 text-brand-600"
                            />
                            <span className="text-xs text-slate-800 truncate">{c.nome}</span>
                          </label>
                        ))}
                      </div>
                    </div>
                  );
                })
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
            {saving ? 'Salvataggio…' : isEdit ? 'Salva modifiche' : 'Crea commissione'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// CommissioneCard — replica esatta di commissioneCardHtml() (commissioni.js)
// ---------------------------------------------------------------------------
interface CommissioneCardProps {
  commissione: CommissioneRecord;
  allCommissari: CommissarioRecord[];
  allSezioni: SezioneRecord[];
  allCats: Map<string, CategoriaRecord>;
  onEdit: () => void;
  onDelete: () => void;
}

function CommissioneCard({
  commissione: c,
  allCommissari,
  allSezioni,
  allCats,
  onEdit,
  onDelete,
}: CommissioneCardProps) {
  const members = c.commissari
    .map((id) => allCommissari.find((x) => x.id === id))
    .filter((x): x is CommissarioRecord => !!x);
  const sezs = c.sezioni
    .map((id) => allSezioni.find((x) => x.id === id))
    .filter((x): x is SezioneRecord => !!x);
  // Categorie effettive = lista persistita (categorie_ids). Il backend non
  // persiste include_tutte_categorie, quindi non c'è espansione "auto"/✨.
  const cats = c.categorie
    .map((id) => allCats.get(id))
    .filter((x): x is CategoriaRecord => !!x);
  // Presidente di QUESTA commissione (non di altre) — db.getPresidenteForCommissione.
  const pres = getPresidenteForCommissione(c, [c], allCommissari);

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
            title="Modifica"
          >
            <Pencil size={18} />
          </button>
          <button
            onClick={onDelete}
            className="w-9 h-9 inline-flex items-center justify-center rounded-lg text-rose-600 bg-rose-50 hover:bg-rose-100 border border-rose-100 transition-colors"
            title="Elimina"
          >
            <Trash2 size={18} />
          </button>
        </div>
      </div>

      {/* Presidente badge / warning */}
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
        {/* Commissari */}
        <div>
          <div className="text-[10px] uppercase tracking-wider text-slate-500 font-semibold mb-1">
            🧑‍⚖️ Commissari ({members.length})
          </div>
          <div className="flex flex-wrap gap-1">
            {members.length === 0 ? (
              <span className="text-xs text-slate-400 italic">Nessuno</span>
            ) : (
              members.map((m) => {
                // 🎯 SOLO se è presidente di QUESTA commissione.
                const isPresQui = c.presidenteCommissarioId === m.id;
                const fotoSrc = m.foto ? fileUrl(m.foto) : null;
                return (
                  <span
                    key={m.id}
                    className={
                      'inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-full ' +
                      (isPresQui
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
                    {isPresQui && ' 🎯'}
                  </span>
                );
              })
            )}
          </div>
        </div>

        {/* Sezioni */}
        <div>
          <div className="text-[10px] uppercase tracking-wider text-slate-500 font-semibold mb-1">
            🗂 Sezioni ({sezs.length})
          </div>
          <div className="flex flex-wrap gap-1">
            {sezs.length === 0 ? (
              <span className="text-xs text-slate-400 italic">Nessuna</span>
            ) : (
              sezs.map((s) => (
                <span
                  key={s.id}
                  className="text-[11px] bg-brand-50 text-brand-700 px-2 py-0.5 rounded-full font-medium"
                >
                  {iconaPerSezione(s.nome)} {s.nome}
                </span>
              ))
            )}
          </div>
        </div>

        {/* Categorie */}
        <div>
          <div className="text-[10px] uppercase tracking-wider text-slate-500 font-semibold mb-1">
            📑 Categorie ({cats.length})
          </div>
          <div className="flex flex-wrap gap-1">
            {cats.length === 0 ? (
              <span className="text-xs text-slate-400 italic">Nessuna</span>
            ) : (
              cats.map((cat) => {
                const sez = allSezioni.find((s) => s.id === cat.sezioneId);
                return (
                  <span
                    key={cat.id}
                    className="text-[11px] bg-slate-100 text-slate-700 px-2 py-0.5 rounded-full"
                    title={sez?.nome ?? ''}
                  >
                    {cat.nome}
                  </span>
                );
              })
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

  const sezList = allSezioni ?? [];
  const { catsBySezione, allCats } = useCategorieMaps(sezList);

  // Commissari attivi (il vanilla mostrava tutti i commissari del concorso;
  // qui restiamo coerenti con la convenzione del componente precedente che
  // filtra gli ATTIVO). Le card risolvono i membri dalla lista completa per
  // non far sparire i membri di commissioni che includono ex-attivi.
  const commissariAll = allCommissari ?? [];
  const commissariAttivi = commissariAll.filter((c) => c.stato === 'ATTIVO');

  // isPresidenteDiQualcheCommissione: id dei commissari presidente di ALMENO
  // UNA commissione del concorso (db, ora in @/lib/presidenti).
  const allComs = commissioni ?? [];
  const presidentiOvunque = new Set<string>(
    commissariAll
      .filter((c) => isPresidenteDiQualcheCommissione(c.id, allComs))
      .map((c) => c.id),
  );

  const handleDelete = async (c: CommissioneRecord) => {
    if (!confirm(`Eliminare la commissione "${c.nome}"? L'operazione non è reversibile.`)) {
      return;
    }
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

  const list = commissioni ?? [];

  return (
    <div className="view-fade">
      {/* Header — mirrors renderCommissioni heading row */}
      <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
        <h3 className="text-sm font-bold text-slate-800 uppercase tracking-wider">
          ⚖ Commissioni
        </h3>
        <button
          onClick={() => setDialog({ open: true })}
          className="text-sm font-semibold text-white bg-brand-600 hover:bg-brand-700 px-3.5 py-2 rounded-lg shadow-sm"
        >
          + Aggiungi commissione
        </button>
      </div>
      <p className="text-sm text-slate-600 mb-4">
        Una <strong>commissione</strong> è un gruppo di commissari che valuta una o più
        sezioni / categorie. Un commissario può far parte di più commissioni; una
        commissione può coprire sezioni multiple.
      </p>

      {/* Warnings */}
      {commissariAll.length === 0 && (
        <div className="bg-amber-50 border border-amber-200 text-amber-900 rounded-xl px-4 py-3 mb-4 text-sm">
          ⚠ Aggiungi prima dei commissari per poter comporre le commissioni.
        </div>
      )}
      {sezList.length === 0 && (
        <div className="bg-amber-50 border border-amber-200 text-amber-900 rounded-xl px-4 py-3 mb-4 text-sm">
          ℹ Crea prima almeno una sezione per assegnare le commissioni a sezioni /
          categorie.
        </div>
      )}

      {/* Empty state / List */}
      {list.length === 0 ? (
        <div className="bg-white border-2 border-dashed border-slate-200 rounded-2xl py-12 text-center">
          <div className="text-4xl mb-2">⚖</div>
          <p className="text-sm text-slate-500 italic">
            Nessuna commissione ancora composta.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
          {list.map((c) => (
            <CommissioneCard
              key={c.id}
              commissione={c}
              allCommissari={commissariAll}
              allSezioni={sezList}
              allCats={allCats}
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
        allCommissari={commissariAttivi}
        allSezioni={sezList}
        catsBySezione={catsBySezione}
        presidentiOvunque={presidentiOvunque}
        existing={dialog.existing}
      />
    </div>
  );
}
