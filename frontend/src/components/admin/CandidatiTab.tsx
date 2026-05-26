// =============================================================================
// CandidatiTab — gestione candidati di un concorso (admin)
//
// Rebuild FEDELE del sorgente vanilla js/views/admin/candidati.js:
//  - Toolbar: conteggio + import CSV (placeholder coerente) + aggiungi
//  - Card candidato: avatar foto / icona gruppo-orchestra, numero, badge tipo,
//    nazionalità, strumento + età, pill membri gruppo, conteggio membri,
//    data di nascita, badge sezione (iconaPerSezione) + categoria, badge docenti
//  - Pulsanti card: Modifica, Membri (gruppo), Storico (individuale), Elimina
//  - Form create/edit completo: anagrafica estesa, contatti, studi musicali,
//    foto (resize client-side), docenti, sezione/categoria a radio-card con
//    auto-derive sezione da categoria, editor inline membri gruppo, note libere,
//    required dinamici per tipo
//  - Modale "Membri del gruppo": aggiungi/rimuovi membri (dati piatti)
//  - Modale "Storico": partecipazioni cross-concorso per stessa identità
//  - Delete con conferma
//
// Design system: c-btn/c-field/c-input/c-select/c-textarea, palette brand/ink,
//   icone lucide-react, iconaPerSezione da @/lib/sezione-icon, toast 'sonner',
//   fileUrl da @/lib/api.
// =============================================================================

import { useState, useMemo, useEffect } from 'react';
import { toast } from 'sonner';
import { Plus, Search, GraduationCap, X, Upload } from 'lucide-react';

import { httpErrorMessage } from '@/lib/api';
import {
  useCandidati,
  candidatiApi,
  type CandidatoFull,
  type MembroGruppo,
} from '@/api/candidati';
import ImportCsvDialog from '@/components/admin/ImportCsvDialog';

import { CandidatoCard } from './candidati/CandidatoCard';
import { DeleteConfirmDialog } from './candidati/DeleteConfirmDialog';
import { StoricoModal } from './candidati/StoricoModal';
import { MembriGruppoModal } from './candidati/MembriGruppoModal';
import { CandidatoFormDialog } from './candidati/CandidatoFormDialog';

// ---------------------------------------------------------------------------
// CandidatiTab (exported)
// ---------------------------------------------------------------------------

export function CandidatiTab({ concorsoId }: { concorsoId: string }) {
  const {
    candidati,
    sezioni,
    categorie,
    isLoading,
    isError,
    deleteMutation,
    refetch,
  } = useCandidati(concorsoId);

  // Filtri (toolbar)
  const [search, setSearch] = useState('');
  const [filterSezioneId, setFilterSezioneId] = useState('');
  const [filterCategoriaId, setFilterCategoriaId] = useState('');
  const [filterTipo, setFilterTipo] = useState('');

  const [dialog, setDialog] = useState<{ open: boolean; existing?: CandidatoFull }>({ open: false });
  const [importCsvOpen, setImportCsvOpen] = useState(false);
  const [deleteDialog, setDeleteDialog] = useState<{ open: boolean; candidato?: CandidatoFull }>({
    open: false,
  });
  const [membriModal, setMembriModal] = useState<{ open: boolean; gruppo: CandidatoFull | null }>({
    open: false,
    gruppo: null,
  });
  const [storicoModal, setStoricoModal] = useState<{ open: boolean; candidato: CandidatoFull | null }>({
    open: false,
    candidato: null,
  });

  // Membri per le card gruppo/orchestra (caricamento lazy a blocco)
  const [membriByGruppo, setMembriByGruppo] = useState<Record<string, MembroGruppo[]>>({});

  const groupIds = useMemo(
    () => candidati.filter((c) => c.tipo === 'gruppo' || c.tipo === 'orchestra').map((c) => c.id),
    [candidati],
  );
  const groupIdsKey = groupIds.join(',');

  useEffect(() => {
    if (groupIds.length === 0) {
      setMembriByGruppo({});
      return;
    }
    let alive = true;
    void Promise.all(
      groupIds.map(async (id) => {
        try {
          const rows = await candidatiApi.membri(id);
          return [id, rows] as const;
        } catch {
          return [id, [] as MembroGruppo[]] as const;
        }
      }),
    ).then((entries) => {
      if (alive) setMembriByGruppo(Object.fromEntries(entries));
    });
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [groupIdsKey]);

  const filteredCategorieForFilter = useMemo(
    () => (filterSezioneId ? categorie.filter((c) => c.sezioneId === filterSezioneId) : []),
    [categorie, filterSezioneId],
  );

  const filtered = useMemo(() => {
    const q = search.toLowerCase().trim();
    return candidati.filter((c) => {
      if (filterSezioneId && c.sezioneId !== filterSezioneId) return false;
      if (filterCategoriaId && c.categoriaId !== filterCategoriaId) return false;
      if (filterTipo && c.tipo !== filterTipo) return false;
      if (q) {
        const text = [c.nome, c.cognome, c.strumento, c.email, c.nazionalita, c.gruppoNome]
          .filter(Boolean)
          .join(' ')
          .toLowerCase();
        if (!text.includes(q)) return false;
      }
      return true;
    });
  }, [candidati, search, filterSezioneId, filterCategoriaId, filterTipo]);

  const sezioneMap = useMemo(() => new Map(sezioni.map((s) => [s.id, s])), [sezioni]);
  const categoriaMap = useMemo(() => new Map(categorie.map((c) => [c.id, c])), [categorie]);

  const handleDelete = async () => {
    if (!deleteDialog.candidato) return;
    try {
      await deleteMutation.mutateAsync(deleteDialog.candidato.id);
      toast.success('Candidato eliminato');
      setDeleteDialog({ open: false });
    } catch (e) {
      toast.error(httpErrorMessage(e));
    }
  };

  // ── Loading / error ──────────────────────────────────────────────────────
  if (isLoading) {
    return (
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3">
        {[1, 2, 3].map((i) => (
          <div key={i} className="bg-white border border-slate-200 rounded-2xl p-4 h-24 animate-pulse" />
        ))}
      </div>
    );
  }
  if (isError) {
    return <p className="text-sm text-rose-600">Errore nel caricamento dei candidati.</p>;
  }

  const hasFilters = !!(search || filterSezioneId || filterCategoriaId || filterTipo);

  return (
    <div className="space-y-4 view-fade">
      {/* ---- Toolbar: conteggio + import + aggiungi ---- */}
      <div className="flex flex-wrap items-center justify-between gap-2 mb-4">
        <p className="text-sm text-slate-600">
          {candidati.length} candidat{candidati.length === 1 ? 'o' : 'i'}
          {filtered.length !== candidati.length &&
            ` · ${filtered.length} mostrat${filtered.length === 1 ? 'o' : 'i'}`}
        </p>
        <div className="flex items-center gap-2">
          <button
            className="c-btn c-btn--sm c-btn--outline"
            onClick={() => setImportCsvOpen(true)}
            title="Importazione massiva da CSV"
          >
            <Upload className="h-4 w-4" />
            Importa CSV
          </button>
          <button className="c-btn c-btn--sm c-btn--primary" onClick={() => setDialog({ open: true })}>
            <Plus className="h-4 w-4" />
            Aggiungi candidato
          </button>
        </div>
      </div>

      {/* ---- Filtri ---- */}
      <div className="flex flex-wrap gap-2 mb-2">
        <div className="relative flex-1 min-w-48">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 pointer-events-none text-ink-500" />
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Cerca per nome, strumento…"
            className="c-input h-9 text-sm"
            // .c-input (legacy.css, non-layered) ha `padding` proprio che batte
            // l'utility pl-*: forziamo il padding-left inline per non sovrapporre l'icona.
            style={{ paddingLeft: '2.5rem' }}
          />
          {search && (
            <button
              type="button"
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
              onClick={() => setSearch('')}
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>

        {sezioni.length > 0 && (
          <select
            value={filterSezioneId}
            onChange={(e) => {
              setFilterSezioneId(e.target.value);
              setFilterCategoriaId('');
            }}
            className="c-select h-9 text-sm w-44"
          >
            <option value="">Tutte le sezioni</option>
            {sezioni.map((s) => (
              <option key={s.id} value={s.id}>
                {s.nome}
              </option>
            ))}
          </select>
        )}

        {filteredCategorieForFilter.length > 0 && (
          <select
            value={filterCategoriaId}
            onChange={(e) => setFilterCategoriaId(e.target.value)}
            className="c-select h-9 text-sm w-44"
          >
            <option value="">Tutte le categorie</option>
            {filteredCategorieForFilter.map((c) => (
              <option key={c.id} value={c.id}>
                {c.nome}
              </option>
            ))}
          </select>
        )}

        <select
          value={filterTipo}
          onChange={(e) => setFilterTipo(e.target.value)}
          className="c-select h-9 text-sm w-40"
        >
          <option value="">Tutti i tipi</option>
          <option value="individuale">Individuale</option>
          <option value="gruppo">Gruppo</option>
          <option value="orchestra">Orchestra</option>
        </select>

        {hasFilters && (
          <button
            type="button"
            className="c-btn c-btn--sm c-btn--ghost text-slate-500"
            onClick={() => {
              setSearch('');
              setFilterSezioneId('');
              setFilterCategoriaId('');
              setFilterTipo('');
            }}
          >
            <X className="h-3.5 w-3.5" />
            Reset
          </button>
        )}
      </div>

      {/* ---- Empty / lista ---- */}
      {candidati.length === 0 ? (
        <div className="bg-white border-2 border-dashed border-slate-200 rounded-2xl py-12 text-center">
          <GraduationCap className="mx-auto h-10 w-10 text-slate-300 mb-2" />
          <p className="text-sm text-slate-500 italic">Nessun candidato — aggiungine uno.</p>
          <button className="c-btn c-btn--sm c-btn--outline mt-4" onClick={() => setDialog({ open: true })}>
            <Plus className="h-4 w-4" />
            Aggiungi il primo candidato
          </button>
        </div>
      ) : filtered.length === 0 ? (
        <div className="bg-white border-2 border-dashed border-slate-200 rounded-2xl py-10 text-center">
          <Search className="mx-auto h-8 w-8 text-slate-300 mb-2" />
          <p className="text-sm text-slate-500 italic">
            Nessun candidato corrisponde ai filtri selezionati.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3">
          {filtered.map((c) => (
            <CandidatoCard
              key={c.id}
              candidato={c}
              sezione={c.sezioneId ? sezioneMap.get(c.sezioneId) : undefined}
              categoria={c.categoriaId ? categoriaMap.get(c.categoriaId) : undefined}
              membri={membriByGruppo[c.id] ?? []}
              onEdit={() => setDialog({ open: true, existing: c })}
              onManageMembers={() => setMembriModal({ open: true, gruppo: c })}
              onHistory={() => setStoricoModal({ open: true, candidato: c })}
              onDelete={() => setDeleteDialog({ open: true, candidato: c })}
            />
          ))}
        </div>
      )}

      {/* ---- Form dialog ---- */}
      <CandidatoFormDialog
        open={dialog.open}
        onOpenChange={(v) => setDialog((p) => ({ ...p, open: v }))}
        concorsoId={concorsoId}
        sezioni={sezioni}
        categorie={categorie}
        existing={dialog.existing}
        onSaved={() => {
          setDialog({ open: false });
          void refetch();
        }}
      />

      {/* ---- Membri gruppo ---- */}
      <MembriGruppoModal
        open={membriModal.open}
        gruppo={membriModal.gruppo}
        candidati={candidati}
        onClose={() => {
          setMembriModal({ open: false, gruppo: null });
          // Ricarica le pill membri delle card
          const id = membriModal.gruppo?.id;
          if (id) {
            void candidatiApi
              .membri(id)
              .then((rows) => setMembriByGruppo((prev) => ({ ...prev, [id]: rows })))
              .catch(() => undefined);
          }
        }}
      />

      {/* ---- Storico ---- */}
      <StoricoModal
        open={storicoModal.open}
        candidato={storicoModal.candidato}
        onClose={() => setStoricoModal({ open: false, candidato: null })}
      />

      {/* ---- Delete confirm ---- */}
      <DeleteConfirmDialog
        open={deleteDialog.open}
        candidato={deleteDialog.candidato ?? null}
        onCancel={() => setDeleteDialog({ open: false })}
        onConfirm={handleDelete}
        isPending={deleteMutation.isPending}
      />

      {/* ---- Import CSV dialog ---- */}
      <ImportCsvDialog
        concorsoId={concorsoId}
        kind="candidati"
        open={importCsvOpen}
        onOpenChange={setImportCsvOpen}
        onDone={() => void refetch()}
      />
    </div>
  );
}

export default CandidatiTab;
