// =============================================================================
// CommissariTab — gestione commissari (admin)
//
// Faithful rebuild of the vanilla source js/views/admin/commissari.js.
// Every feature of the vanilla view is reproduced 1:1 against the available
// React/server data model:
//
//   - Header: titolo + bottone "Aggiungi commissario"
//   - Summary line ("{n} commissari assegnati · presidente: …" / nessun presidente)
//   - Warning banner quando ci sono commissari ma nessun presidente
//   - Empty state (dashed border, 🧑‍⚖️)
//   - ATTIVI grid (1/2/3 col) con card commissario:
//       avatar foto/🧑‍⚖️, ring presidente, badge PRESIDENTE, nazionalità,
//       specialità · età, email ✉, telefono ☎, pill CV (apre modale), pill bio,
//       azioni Modifica / Rimuovi (archivia) / Elimina
//   - Sezione ARCHIVIO (commissari archiviati/INATTIVI) con toolbar:
//       ricerca, filtro specialità, filtro nazionalità, ordinamento, clear,
//       card archivio (foto/specialità/età/nazionalità/email/telefono/bio/CV),
//       bottone "Aggiungi a questo concorso" (riattiva)
//   - CV view modal (sola lettura, testo pre-wrap, font-mono)
//   - Create/Edit modal con TUTTI i campi: nome, cognome, specialità,
//       data nascita, nazionalità (datalist), email, telefono, foto (upload +
//       resize + preview + rimuovi), CV (testo, toggle editor + visualizza +
//       rimuovi + contatore caratteri), biografia, nota presidente,
//       sezione credenziali (crea account / gestisci account esistente)
//   - Modale credenziali one-time (email/password copiabili)
//   - Conferme archivia / elimina (multi-concorso non applicabile: modello
//       single-concorso lato server)
//
// Data wiring dalle hook '@/api/commissari' è interamente preservato; per le
// credenziali si usa '@/api/accounts'; il presidente è risolto da
// '@/api/commissioni' (presidenteCommissarioId).
// =============================================================================

import { useState, useMemo } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';

import { httpErrorMessage } from '@/lib/api';
import {
  useCommissari,
  useUpdateCommissario,
  useDeleteCommissario,
  type CommissarioRecord,
} from '@/api/commissari';
import { useCommissioni } from '@/api/commissioni';
import { isPresidenteDiQualcheCommissione } from '@/lib/presidenti';
import ImportCsvDialog from '@/components/admin/ImportCsvDialog';

import { displayName } from './commissari-utils';
import CommissarioCard from './commissari/CommissarioCard';
import ArchivioCard from './commissari/ArchivioCard';
import CommissarioFormDialog from './commissari/CommissarioFormDialog';

// ---------------------------------------------------------------------------
// CommissariTab (exported)
// ---------------------------------------------------------------------------
export default function CommissariTab({ concorsoId }: { concorsoId: string }) {
  const { data: all, isLoading, isError } = useCommissari(concorsoId);
  const { data: commissioni } = useCommissioni(concorsoId);
  const updateCommissario = useUpdateCommissario(concorsoId);
  const deleteCommissario = useDeleteCommissario(concorsoId);
  const qc = useQueryClient();

  const [dialog, setDialog] = useState<{ open: boolean; existing: CommissarioRecord | null }>({
    open: false,
    existing: null,
  });
  const [importCsvOpen, setImportCsvOpen] = useState(false);
  const [importingId, setImportingId] = useState<string | null>(null);

  // ----- Archivio toolbar state (port di renderArchivio.ui) -----
  const [archQ, setArchQ] = useState('');
  const [archSpec, setArchSpec] = useState('');
  const [archNaz, setArchNaz] = useState('');
  const [archSort, setArchSort] = useState<'nome' | 'recente' | 'concorsi'>('nome');

  const attivi = useMemo(() => all?.filter((c) => c.stato === 'ATTIVO') ?? [], [all]);
  const inattivi = useMemo(() => all?.filter((c) => c.stato === 'INATTIVO') ?? [], [all]);

  // Presidente = commissario presidente di ALMENO UNA commissione del concorso
  // (db.isPresidenteDiQualcheCommissione, ora in @/lib/presidenti).
  const isPresidente = useMemo(() => {
    const coms = commissioni ?? [];
    return (id: string) => isPresidenteDiQualcheCommissione(id, coms);
  }, [commissioni]);

  const presidente = useMemo(
    () => attivi.find((c) => isPresidente(c.id)) ?? null,
    [attivi, isPresidente],
  );

  // ----- Action handlers (port di unassign/delete) -----
  const handleUnassign = async (c: CommissarioRecord) => {
    if (
      !confirm(
        `Rimuovere ${displayName(c)} da questo concorso? Resta nell'archivio per riusi futuri.`,
      )
    )
      return;
    try {
      await updateCommissario.mutateAsync({ id: c.id, body: { stato: 'INATTIVO' } });
      toast.success(`${displayName(c)} rimosso dal concorso`);
    } catch (e) {
      toast.error(httpErrorMessage(e));
    }
  };

  const handleDelete = async (c: CommissarioRecord) => {
    if (
      !confirm(
        `Eliminare "${displayName(c)}"? Il record sarà rimosso dall'archivio. Le valutazioni già salvate restano nello storico.`,
      )
    )
      return;
    try {
      await deleteCommissario.mutateAsync(c.id);
      toast.success('Commissario eliminato');
    } catch (e) {
      toast.error(httpErrorMessage(e));
    }
  };

  const handleImport = async (c: CommissarioRecord) => {
    setImportingId(c.id);
    try {
      await updateCommissario.mutateAsync({ id: c.id, body: { stato: 'ATTIVO' } });
      toast.success(`${displayName(c)} aggiunto al concorso`);
    } catch (e) {
      toast.error(`Errore importazione: ${httpErrorMessage(e)}`);
    } finally {
      setImportingId(null);
    }
  };

  // ----- Archivio filtri/ordinamento (port di renderArchivio.apply) -----
  const specialitaOpts = useMemo(
    () => [...new Set(inattivi.map((c) => c.specialita).filter(Boolean) as string[])].sort(),
    [inattivi],
  );
  const nazionalitaOpts = useMemo(
    () => [...new Set(inattivi.map((c) => c.nazionalita).filter(Boolean) as string[])].sort(),
    [inattivi],
  );

  const archResults = useMemo(() => {
    let list = inattivi.slice();
    if (archSpec) list = list.filter((c) => c.specialita === archSpec);
    if (archNaz) list = list.filter((c) => c.nazionalita === archNaz);
    if (archQ) {
      const q = archQ.toLowerCase();
      list = list.filter((c) => {
        const hay = `${c.nome} ${c.cognome ?? ''} ${c.specialita ?? ''} ${c.email ?? ''} ${c.telefono ?? ''} ${c.nazionalita ?? ''} ${c.bio ?? ''}`.toLowerCase();
        return hay.includes(q);
      });
    }
    if (archSort === 'nome') {
      list.sort((a, b) =>
        `${a.cognome ?? ''} ${a.nome}`.localeCompare(`${b.cognome ?? ''} ${b.nome}`, 'it'),
      );
    } else if (archSort === 'recente') {
      list.sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
    }
    // 'concorsi' (numero concorsi) non applicabile al modello single-concorso:
    // lascia l'ordine corrente.
    return list;
  }, [inattivi, archSpec, archNaz, archQ, archSort]);

  const clearFilters = () => {
    setArchQ('');
    setArchSpec('');
    setArchNaz('');
    setArchSort('nome');
  };

  // ----- Render -----
  if (isLoading) {
    return (
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3">
        {[1, 2, 3].map((i) => (
          <div
            key={i}
            className="bg-white border border-slate-200 rounded-2xl p-4 h-24 animate-pulse"
          />
        ))}
      </div>
    );
  }

  if (isError) {
    return <p className="text-sm text-rose-600">Errore nel caricamento dei commissari.</p>;
  }

  return (
    <div className="view-fade">
      {/* ---- Header ---- */}
      <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
        <h3 className="text-sm font-bold text-slate-800 uppercase tracking-wider">
          Commissari di questo concorso
        </h3>
        <div className="flex items-center gap-2">
          <button
            className="text-sm font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 px-3.5 py-2 rounded-lg"
            onClick={() => setImportCsvOpen(true)}
            title="Importazione massiva da CSV"
          >
            Importa CSV
          </button>
          <button
            className="text-sm font-semibold text-white bg-brand-600 hover:bg-brand-700 px-3.5 py-2 rounded-lg shadow-sm"
            onClick={() => setDialog({ open: true, existing: null })}
          >
            + Aggiungi commissario
          </button>
        </div>
      </div>

      {/* ---- Summary line ---- */}
      <p className="text-sm text-slate-600 mb-4">
        {attivi.length} commissari assegnati ·{' '}
        {presidente ? (
          <>
            presidente: <strong>{displayName(presidente)}</strong>
          </>
        ) : (
          <span className="text-amber-700 font-medium">nessun presidente designato</span>
        )}
      </p>

      {/* ---- Warning: commissari ma nessun presidente ---- */}
      {attivi.length > 0 && !presidente && (
        <div className="bg-amber-50 border border-amber-200 text-amber-900 rounded-xl px-4 py-3 mb-4 text-sm">
          ⚠ Nessun commissario è marcato come <strong>presidente</strong>. Le fasi non potranno
          essere avviate o concluse finché non designi un presidente del concorso.
        </div>
      )}

      {/* ---- ATTIVI grid / empty ---- */}
      {attivi.length === 0 ? (
        <div className="bg-white border-2 border-dashed border-slate-200 rounded-2xl py-12 text-center">
          <div className="text-4xl mb-2">🧑‍⚖️</div>
          <p className="text-sm text-slate-500 italic">
            Nessun commissario. Aggiungine almeno uno per consentire la valutazione.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3">
          {attivi.map((c) => (
            <CommissarioCard
              key={c.id}
              commissario={c}
              isPresidente={isPresidente(c.id)}
              onEdit={() => setDialog({ open: true, existing: c })}
              onUnassign={() => handleUnassign(c)}
              onDelete={() => handleDelete(c)}
            />
          ))}
        </div>
      )}

      {/* ---- Archivio ---- */}
      <div className="mt-8 pt-6 border-t-2 border-dashed border-brand-100">
        <div className="flex flex-wrap items-center gap-3 mb-3">
          <div>
            <h3 className="text-sm font-bold text-slate-800 uppercase tracking-wider">
              📚 Archivio commissari
            </h3>
            <p className="text-xs text-slate-500">
              {inattivi.length} anagrafiche archiviate · usa <strong>+ Aggiungi</strong> per
              riportarle in questo concorso
            </p>
          </div>
        </div>

        {/* Toolbar filtri */}
        <div className="bg-white border border-brand-100 rounded-2xl p-4 mb-4 shadow-soft">
          <div className="grid grid-cols-1 md:grid-cols-12 gap-2">
            <div className="md:col-span-5 relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400">🔍</span>
              <input
                type="search"
                value={archQ}
                onChange={(e) => setArchQ(e.target.value)}
                placeholder="Cerca per nome, cognome, email, specialità, bio…"
                className="w-full pl-9 pr-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-brand-500 focus:border-brand-500"
              />
            </div>
            <select
              value={archSpec}
              onChange={(e) => setArchSpec(e.target.value)}
              className="md:col-span-3 border border-slate-300 rounded-lg px-2.5 py-2 text-sm focus:ring-2 focus:ring-brand-500"
            >
              <option value="">Tutte le specialità</option>
              {specialitaOpts.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
            <select
              value={archNaz}
              onChange={(e) => setArchNaz(e.target.value)}
              className="md:col-span-2 border border-slate-300 rounded-lg px-2.5 py-2 text-sm focus:ring-2 focus:ring-brand-500"
            >
              <option value="">Tutte le nazionalità</option>
              {nazionalitaOpts.map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
            <select
              value={archSort}
              onChange={(e) => setArchSort(e.target.value as typeof archSort)}
              className="md:col-span-2 border border-slate-300 rounded-lg px-2.5 py-2 text-sm focus:ring-2 focus:ring-brand-500"
            >
              <option value="nome">Ordina per nome</option>
              <option value="recente">Ordina per più recente</option>
            </select>
          </div>
          <div className="mt-2 flex items-center gap-3 text-xs">
            <button
              type="button"
              onClick={clearFilters}
              className="text-brand-600 hover:text-brand-800 font-medium ml-auto"
            >
              Cancella filtri
            </button>
          </div>
        </div>

        {/* Risultati archivio */}
        {inattivi.length === 0 ? (
          <div className="bg-white border-2 border-dashed border-slate-200 rounded-2xl py-12 text-center">
            <div className="text-4xl mb-2">📭</div>
            <p className="text-sm text-slate-500 italic">Nessun commissario in archivio.</p>
          </div>
        ) : archResults.length === 0 ? (
          <div className="bg-white border-2 border-dashed border-slate-200 rounded-2xl py-12 text-center">
            <div className="text-4xl mb-2">🔎</div>
            <p className="text-sm text-slate-500 italic">
              Nessun commissario corrisponde ai filtri.
            </p>
          </div>
        ) : (
          <>
            <div className="text-xs text-slate-500 mb-2">
              {archResults.length === 1
                ? `${archResults.length} risultato`
                : `${archResults.length} risultati`}
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3">
              {archResults.map((c) => (
                <ArchivioCard
                  key={c.id}
                  commissario={c}
                  inThis={false}
                  importing={importingId === c.id}
                  onImport={() => handleImport(c)}
                />
              ))}
            </div>
          </>
        )}
      </div>

      {/* ---- Form dialog ---- */}
      {dialog.open && (
        <CommissarioFormDialog
          concorsoId={concorsoId}
          existing={dialog.existing}
          onClose={() => setDialog({ open: false, existing: null })}
        />
      )}

      {/* ---- Import CSV dialog ---- */}
      <ImportCsvDialog
        concorsoId={concorsoId}
        kind="commissari"
        open={importCsvOpen}
        onOpenChange={setImportCsvOpen}
        onDone={() => qc.invalidateQueries({ queryKey: ['commissari', concorsoId] })}
      />
    </div>
  );
}
