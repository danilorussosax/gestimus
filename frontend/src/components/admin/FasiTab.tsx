// =============================================================================
// FasiTab — gestione fasi del concorso (admin)
//
// Porta js/views/admin/fasi.js su React 19 + TS + TanStack Query.
// Il form "Nuova/Modifica fase" replica 1:1 la versione vanilla (openFaseForm):
//   Sezione 1 — Informazioni generali (nome, data prevista)
//   Sezione 2 — Modalità di esecuzione (scala/tempo/posti card numeriche con
//               preset, testi esito promosso/eliminato, modo valutazione)
//   Sezione 3 — Metodo di calcolo della media (5 metodi, banner consigliato)
//   Sezione 4 — Criteri di valutazione (editor pesi/add/remove, totale live)
//   Sezione 5 — Restrizione e assegnazione (sezioni-scope multi-select,
//               commissione assegnata)
//   Sezione 6 — Regole di rottura della parità (cascata tiebreak override)
//
// Layout/classi replicano la sorgente vanilla (c-tile, c-btn, c-tag, c-field,
// brand/ink palette, design-system classes, card numerate).
// =============================================================================

import { useState, useCallback, useMemo } from 'react';
import { toast } from 'sonner';
import { useQueryClient } from '@tanstack/react-query';
import {
  Plus, TriangleAlert,
} from 'lucide-react';

import { httpErrorMessage } from '@/lib/api';
import { resolveAdmittedIds } from '@/lib/admitted';
import {
  useFasi,
  deleteFase,
  startFase,
  concludiFase,
  sorteggiaFase,
  reorderFasi,
  FASI_QUERY_KEY,
  type FaseRecord,
} from '@/api/fasi';
import { useSezioni } from '@/api/sezioni';
import { useCommissioni } from '@/api/commissioni';
import {
  GUIDE_TIPS,
  gruppoFasi,
  computeDrift,
  sharedValue,
  type FaseGroup,
} from './fasi-utils';
import { ConfirmDialog } from './fasi/ConfirmDialog';
import { FaseCard } from './fasi/FaseCard';
import { InnerFaseRow } from './fasi/InnerFaseRow';
import { GroupCard } from './fasi/GroupCard';
import { FaseFormDialog, type FasePrefill } from './fasi/FaseFormDialog';
import { FaseWizardDialog } from './fasi/FaseWizardDialog';
import { SharedFieldsDialog } from './fasi/SharedFieldsDialog';

// ---------------------------------------------------------------------------
// FasiTab (exported)
// ---------------------------------------------------------------------------

export function FasiTab({ concorsoId }: { concorsoId: string }) {
  const qc = useQueryClient();
  const { data: fasi, isLoading, isError } = useFasi(concorsoId);
  // Sezioni: servono per enumerare i gruppi (una "fase madre" per sezione).
  const { data: sezioni } = useSezioni(concorsoId);
  const { data: commissioni } = useCommissioni(concorsoId);

  const sorted = [...(fasi ?? [])].sort((a, b) => a.ordine - b.ordine);

  // Vista raggruppata: attiva quando il concorso ha sezioni. Senza sezioni
  // (legacy / micro-concorsi) si usa la vista piatta come prima.
  const useGrouped = (sezioni?.length ?? 0) > 0;
  const groups = useMemo(
    () => gruppoFasi(sorted, sezioni ?? []),
    // sorted è ricalcolato a ogni render (nuovo array) ma il contenuto cambia solo con `fasi`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [fasi, sezioni],
  );

  // form: { existing } = modifica fase; { prefill } = "+ Aggiungi sotto-fase"
  // (delega al form con sezioni_ids + campi condivisi del gruppo pre-popolati).
  const [formDialog, setFormDialog] = useState<{
    open: boolean;
    existing?: FaseRecord;
    prefill?: FasePrefill;
  }>({ open: false });

  const [wizardDialog, setWizardDialog] = useState<{ open: boolean; group?: FaseGroup }>({
    open: false,
  });
  const [sharedDialog, setSharedDialog] = useState<{ open: boolean; group?: FaseGroup }>({
    open: false,
  });

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
    onConfirm: async () => { /* placeholder, sovrascritto all'apertura */ },
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
          // N144: calcola e invia gli ammessi top-N (con risoluzione pareggi);
          // senza, nessun candidato verrebbe promosso alla fase successiva.
          const admitted = await resolveAdmittedIds(fase);
          await concludiFase(fase.id, admitted ?? undefined);
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

  // ── Add sotto-fase (delega al form con prefill dei campi condivisi) ─────────
  // Replica il ramo `group.fasi.length > 0` di openFaseWizard.
  const handleAddFase = (group: FaseGroup) => {
    const prefill: FasePrefill = { sezioniIds: group.sezioneIds.slice() };
    const sScala = sharedValue(group.fasi, 'scala');
    if (sScala !== undefined) prefill.scala = sScala;
    const sTempo = sharedValue(group.fasi, 'tempoMinuti');
    if (sTempo !== undefined && sTempo != null) prefill.tempoMinuti = sTempo;
    const sModo = sharedValue(group.fasi, 'modoValutazione');
    if (sModo === 'autonoma' || sModo === 'sincrona') prefill.modoValutazione = sModo;
    const sMetodo = sharedValue(group.fasi, 'metodoMedia');
    if (sMetodo) prefill.metodoMedia = sMetodo;
    const sComm = sharedValue(group.fasi, 'commissioneId');
    if (sComm !== undefined) prefill.commissioneId = sComm;
    setFormDialog({ open: true, prefill });
  };

  // ── Elimina gruppo: cancella TUTTE le sotto-fasi del gruppo ─────────────────
  // Blocco preventivo se c'è qualcosa IN_CORSO (replica delete-group vanilla).
  const handleDeleteGroup = (group: FaseGroup) => {
    const running = group.fasi.filter((f) => f.stato === 'IN_CORSO');
    if (running.length > 0) {
      toast.error(`Impossibile eliminare: ${running.length} sotto-fasi sono IN_CORSO. Concludile prima.`);
      return;
    }
    const concluse = group.fasi.filter((f) => f.stato === 'CONCLUSA').length;
    const scopeLabel =
      group.type === 'shared'
        ? 'Fasi globali (tutte le sezioni)'
        : group.sezioneIds
            .map((id) => sezioni?.find((s) => s.id === id)?.nome)
            .filter(Boolean)
            .join(', ');
    openConfirm({
      title: 'Elimina gruppo di fasi',
      description:
        `Stai per eliminare tutte e ${group.fasi.length} le sotto-fasi del gruppo "${scopeLabel}".` +
        (concluse > 0
          ? ` ⚠ ${concluse} sotto-fasi sono CONCLUSE: tutte le valutazioni associate andranno perse irrimediabilmente.`
          : '') +
        " L'operazione non è reversibile.",
      confirmLabel: 'Elimina tutte',
      danger: true,
      onConfirm: async () => {
        // Sequenziale: ogni delete invalida il dataset → evito race.
        const failed: string[] = [];
        for (const f of group.fasi) {
          try {
            await deleteFase(f.id);
          } catch (e) {
            failed.push(`${f.nome}: ${httpErrorMessage(e)}`);
          }
        }
        if (failed.length === 0) {
          toast.success(`${group.fasi.length} sotto-fasi eliminate`);
        } else {
          const ok = group.fasi.length - failed.length;
          toast.error(`Eliminate ${ok}/${group.fasi.length} — ${failed.slice(0, 3).join(' · ')}`);
        }
        await invalidate();
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
      {/* In vista raggruppata il pulsante crea una FASE GLOBALE (sezioni_ids
          vuoto). Le altre creazioni partono dalle card-gruppo. In vista piatta
          (legacy) è il classico "Nuova fase". */}
      <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
        <p className="text-sm text-slate-600">
          {sorted.length} {sorted.length === 1 ? 'fase' : 'fasi'}
        </p>
        <button
          type="button"
          onClick={() => setFormDialog({ open: true, prefill: { sezioniIds: [] } })}
          className="text-sm font-medium text-slate-700 bg-white border border-slate-200 hover:bg-slate-50 px-3 py-2 rounded-lg inline-flex items-center gap-1"
        >
          {useGrouped ? (
            <>＋ Fase globale</>
          ) : (
            <>
              <Plus className="h-4 w-4" />
              Nuova fase
            </>
          )}
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
          {/* Intro + 10 tip di guida — testo identico al vanilla (fasiGuidanceHtml).
              SICUREZZA: i body contengono HTML (<strong>/<em>/<code>) deliberato →
              dangerouslySetInnerHTML. Il contenuto è una COSTANTE hardcoded
              (GUIDE_TIPS, sotto) e la stringa letterale qui: NON proviene mai dal
              backend né da input utente. Se in futuro diventasse dinamico,
              sostituire con rendering markdown/JSX o sanitizzare con DOMPurify. */}
          <p
            className="mb-3"
            dangerouslySetInnerHTML={{
              __html:
                'La pagina è organizzata <strong>per sezione</strong>: ogni card è una "fase madre" che contiene una o più <em>sotto-fasi</em> (eliminatoria, semifinale, finale…). I candidati ammessi al termine di una sotto-fase passano automaticamente alla successiva della stessa sezione.',
            }}
          />
          <ul className="space-y-1.5 pl-1">
            {GUIDE_TIPS.map((tip) => (
              <li key={tip.title}>
                {tip.emoji} <strong>{tip.title}</strong> —{' '}
                <span dangerouslySetInnerHTML={{ __html: tip.body }} />
              </li>
            ))}
          </ul>
          <p className="mt-3 text-xs text-slate-500 italic">
            Suggerimento: prima di configurare le fasi assicurati di aver definito sezioni,
            candidati, commissari e (opzionalmente) commissioni.
          </p>
        </div>
      </details>

      {/* ── Body: vista raggruppata (fase madre per sezione) o piatta (legacy) ── */}
      {useGrouped ? (
        <div className="space-y-4">
          {groups.map((g) => (
            <GroupCard
              key={g.key}
              group={g}
              sezioni={sezioni}
              commissioni={commissioni}
              onWizard={() => setWizardDialog({ open: true, group: g })}
              onAddFase={() => handleAddFase(g)}
              onEditShared={() => setSharedDialog({ open: true, group: g })}
              onDeleteGroup={() => handleDeleteGroup(g)}
              renderRow={(fase) => {
                // isFirst/isLast usano l'ordine GLOBALE: il reorder è globale,
                // non per-gruppo (replica move-up/down della vista vanilla).
                const globalIdx = sorted.findIndex((f) => f.id === fase.id);
                return (
                  <InnerFaseRow
                    key={fase.id}
                    fase={fase}
                    drift={computeDrift(g.fasi)}
                    isFirst={globalIdx === 0}
                    isLast={globalIdx === sorted.length - 1}
                    commissioni={commissioni}
                    onEdit={() => setFormDialog({ open: true, existing: fase })}
                    onDelete={() => handleDelete(fase)}
                    onStart={() => handleStart(fase)}
                    onConclude={() => handleConclude(fase)}
                    onSorteggio={() => handleSorteggio(fase)}
                    onMoveUp={() => handleReorder(fase.id, 'up')}
                    onMoveDown={() => handleReorder(fase.id, 'down')}
                  />
                );
              }}
            />
          ))}
        </div>
      ) : sorted.length === 0 ? (
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
            onClick={() => setFormDialog({ open: true, prefill: { sezioniIds: [] } })}
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

      {/* ── Form dialog (modifica / + sotto-fase / fase globale) ──────────── */}
      {formDialog.open && (
        <FaseFormDialog
          key={formDialog.existing?.id ?? `new:${JSON.stringify(formDialog.prefill ?? {})}`}
          open={formDialog.open}
          onOpenChange={(v) => setFormDialog((p) => ({ ...p, open: v }))}
          concorsoId={concorsoId}
          existing={formDialog.existing}
          prefill={formDialog.prefill}
          nextOrdine={nextOrdine}
          onSaved={() => setFormDialog({ open: false })}
        />
      )}

      {/* ── Wizard dialog (sequenza fasi per un gruppo vuoto) ─────────────── */}
      {wizardDialog.open && wizardDialog.group && (
        <FaseWizardDialog
          key={wizardDialog.group.key}
          open={wizardDialog.open}
          onOpenChange={(v) => setWizardDialog((p) => ({ ...p, open: v }))}
          concorsoId={concorsoId}
          group={wizardDialog.group}
          nextOrdine={nextOrdine}
          onSaved={() => setWizardDialog({ open: false })}
        />
      )}

      {/* ── Shared-fields dialog (batch edit campi condivisi) ─────────────── */}
      {sharedDialog.open && sharedDialog.group && (
        <SharedFieldsDialog
          key={sharedDialog.group.key}
          open={sharedDialog.open}
          onOpenChange={(v) => setSharedDialog((p) => ({ ...p, open: v }))}
          concorsoId={concorsoId}
          group={sharedDialog.group}
          commissioni={commissioni}
          onSaved={() => setSharedDialog({ open: false })}
        />
      )}

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
