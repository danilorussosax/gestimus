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

import { useState, useEffect, useCallback, useMemo, type ReactNode, type FormEvent } from 'react';
import { toast } from 'sonner';
import { useQueryClient } from '@tanstack/react-query';
import {
  Plus, Pencil, Trash2, ChevronUp, ChevronDown,
  Play, StopCircle, Shuffle, TriangleAlert,
} from 'lucide-react';

import { cn } from '@/lib/utils';
import { httpErrorMessage } from '@/lib/api';
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
  type TiebreakStep,
} from '@/api/fasi';
import { useCriteri, type CriterioInput, type CriterioRecord } from '@/api/criteri';
import { useSezioni } from '@/api/sezioni';
import { useCommissioni } from '@/api/commissioni';
import { useCommissari } from '@/api/commissari';
import type { FaseStato } from '@/types';

// ---------------------------------------------------------------------------
// Constants — testo ESATTO da js/scoring.js (METODI_MEDIA) e js/views/admin/fasi.js
// ---------------------------------------------------------------------------

// Descrittori dei 5 metodi di media. Testo identico a js/scoring.js METODI_MEDIA.
interface MetodoDescriptor {
  nome: string;
  icon: string;
  breve: string;
  pro: string;
  contro: string;
  consigliata: string;
}

const METODI_MEDIA: Record<string, MetodoDescriptor> = {
  aritmetica: {
    nome: 'Media aritmetica',
    icon: '∑',
    breve: 'Somma di tutti i voti diviso il numero di commissari.',
    pro: 'Usa tutti i dati, semplice e trasparente.',
    contro: 'Vulnerabile a un singolo outlier (un voto molto alto o molto basso).',
    consigliata: 'Sempre, se non vuoi correggere statisticamente gli estremi.',
  },
  olimpica: {
    nome: 'Media olimpica',
    icon: '🥇',
    breve: 'Scarta il voto più alto e il più basso, media aritmetica dei restanti.',
    pro: 'Annulla un singolo outlier per estremo. Standard nei concorsi Olimpici / pattinaggio.',
    contro: 'Con 3 commissari resta un solo voto utile (n−2 = 1) → poco significativa.',
    consigliata: 'Da 4 commissari in su.',
  },
  winsorizzata: {
    nome: 'Media winsorizzata',
    icon: '✂️',
    breve: 'Limita gli estremi al secondo valore più alto/basso, poi fa la media aritmetica.',
    pro: 'Attenua gli outlier senza scartarli del tutto, mantiene n dati.',
    contro: 'Servono almeno 4-5 voti perché il "secondo estremo" sia rappresentativo.',
    consigliata: 'Da 5 commissari in su.',
  },
  mediana: {
    nome: 'Voto mediano',
    icon: '⊥',
    breve: 'Valore centrale dei voti ordinati (con n pari, media dei due centrali).',
    pro: 'Massimamente robusta agli outlier — resiste anche a metà dei voti estremi.',
    contro: 'Ignora le distanze fra i voti: 7 / 7 / 7 e 5 / 7 / 9 hanno la stessa mediana.',
    consigliata: 'Robusta per qualsiasi N≥3, particolarmente buona per N piccoli (3–5).',
  },
  deviazione_std: {
    nome: 'Filtro deviazione standard',
    icon: 'σ',
    breve: 'Esclude i voti oltre ±2σ dalla media, poi ricalcola la media.',
    pro: 'Robusta anche con outlier multipli quando il campione è grande.',
    contro: 'σ stimata su pochi voti (n<7) è instabile, può scartare voti legittimi.',
    consigliata: 'Solo con almeno 7 commissari, idealmente 10+.',
  },
};

// suggerisciMetodo — testo identico a js/scoring.js.
function suggerisciMetodo(nCommissari: number): { metodo: string; motivo: string } {
  const n = Number(nCommissari) || 0;
  if (n <= 2) return { metodo: 'aritmetica', motivo: `Con ${n} commissari un filtro statistico non ha abbastanza dati per essere significativo.` };
  if (n === 3) return { metodo: 'mediana', motivo: 'Con 3 commissari la mediana è la scelta più robusta — non viene influenzata da un singolo voto estremo.' };
  if (n <= 5) return { metodo: 'olimpica', motivo: `Con ${n} commissari la media olimpica scarta i due estremi e mantiene un numero significativo di voti.` };
  if (n <= 7) return { metodo: 'mediana', motivo: `Con ${n} commissari la mediana resta la più semplice e robusta.` };
  if (n <= 12) return { metodo: 'winsorizzata', motivo: `Con ${n} commissari la winsorizzazione attenua gli outlier mantenendo tutti i voti nel calcolo.` };
  return { metodo: 'deviazione_std', motivo: `Con ${n} commissari la deviazione standard è statisticamente affidabile e identifica voti anomali.` };
}

// Descrittori delle due modalità di valutazione — identico a MODI_VALUTAZIONE in fasi.js.
interface ModoDescriptor {
  icon: string;
  nome: string;
  breve: string;
  scenari: string[];
  tip: string;
}

const MODI_VALUTAZIONE: Record<'autonoma' | 'sincrona', ModoDescriptor> = {
  autonoma: {
    icon: '👤',
    nome: 'Valutazione autonoma',
    breve: 'Ogni commissario procede al proprio ritmo, valutando in sequenza i candidati.',
    scenari: [
      'Valutazioni in differita su registrazioni audio/video',
      'Audizioni dal vivo con commissari indipendenti',
      'Concorsi con candidati numerosi (sblocca tutti i giurati in parallelo)',
    ],
    tip: 'Default consigliato per la maggior parte dei concorsi musicali.',
  },
  sincrona: {
    icon: '🎼',
    nome: 'Valutazione sincrona',
    breve: 'Tutta la commissione vota lo stesso candidato in contemporanea. Il presidente gestisce l\'avanzamento.',
    scenari: [
      'Audizioni dal vivo con candidato fisicamente presente in sala',
      'Finali con un solo candidato per volta sul palco',
      'Fasi con tempo cronometrato e cambio candidato visibile a tutti',
    ],
    tip: 'Richiede un presidente di giuria designato per pilotare il flusso.',
  },
};

// Cascata tiebreak — STEPS identici a tiebreakStrategyHtml in common.js.
interface TiebreakStepDef {
  key: string;
  icon: string;
  titolo: string;
  breve: string;
}

const TIEBREAK_STEPS: TiebreakStepDef[] = [
  { key: 'scomposizione', icon: '🧩', titolo: 'Scomposizione del voto', breve: 'Confronta i criteri uno per uno, in ordine di peso decrescente. Vince chi ha la media più alta sul criterio più importante che li differenzia.' },
  { key: 'presidente', icon: '🎯', titolo: 'Voto del Presidente di giuria', breve: 'Il voto del Presidente diventa decisivo: vince chi ha la media più alta calcolata sui soli voti del Presidente.' },
  { key: 'eta', icon: '🌱', titolo: 'Criterio anagrafico', breve: 'Vince il candidato più giovane al momento dell\'esibizione. Per i gruppi si usa la media delle date di nascita dei membri.' },
  { key: 'ex_aequo', icon: '🤝', titolo: 'Ex aequo (extrema ratio)', breve: 'Se nessuna regola precedente risolve la parità, viene dichiarato ex aequo: stessa posizione ai candidati, la posizione successiva non viene assegnata; il premio si divide in parti uguali.' },
];

const STATO_COLORS: Record<FaseStato, string> = {
  PIANIFICATA: 'bg-slate-100 text-slate-700 border-slate-200',
  IN_CORSO: 'bg-blue-100 text-blue-800 border-blue-200',
  CONCLUSA: 'bg-emerald-100 text-emerald-800 border-emerald-200',
};

// Criteri di default in creazione — identici a openFaseForm (peso decimale → %).
const DEFAULT_CRITERI: CriterioFV[] = [
  { label: 'Tecnica', key: 'tecnica', peso: 35 },
  { label: 'Interpretazione', key: 'interpretazione', peso: 35 },
  { label: 'Intonazione', key: 'intonazione', peso: 15 },
  { label: 'Musicalità', key: 'musicalita', peso: 15 },
];

// ---------------------------------------------------------------------------
// Form value types (state-driven, niente RHF/Zod: il form vanilla è imperativo)
// ---------------------------------------------------------------------------

interface CriterioFV {
  label: string;
  key: string;
  peso: number; // percentuale 0-100
}

interface FaseFormValues {
  nome: string;
  dataPrevista: string;
  scala: number | '';
  tempoMinuti: number | '';
  ammessi: number | '';
  testoEsitoPromosso: string;
  testoEsitoEliminato: string;
  modoValutazione: 'autonoma' | 'sincrona';
  metodoMedia: string;
  criteri: CriterioFV[];
  sezioniIds: string[];
  commissioneId: string;
  // tiebreak: array di {key, enabled} se l'admin ha toccato i toggle, altrimenti null
  tiebreakStrategy: TiebreakStep[] | null;
  tiebreakTouched: boolean;
}

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

// ---------------------------------------------------------------------------
// SectionHeader — header sezione numerata (cerchio brand + titolo)
// ---------------------------------------------------------------------------

function SectionHeader({ num, title, right }: { num: number; title: string; right?: ReactNode }) {
  return (
    <header className="flex items-center justify-between gap-2 mb-3 flex-wrap">
      <div className="flex items-center gap-2">
        <span className="w-6 h-6 rounded-full bg-brand-100 text-brand-700 text-xs font-bold inline-flex items-center justify-center shrink-0">
          {num}
        </span>
        <h3 className="font-semibold text-slate-900">{title}</h3>
      </div>
      {right}
    </header>
  );
}

// ---------------------------------------------------------------------------
// NumericCard — card numerica con preset (scala / tempo / posti)
// Replica numericCardHtml.
// ---------------------------------------------------------------------------

interface NumericCardProps {
  icon: string;
  title: string;
  desc: string;
  tip: ReactNode;
  value: string | number;
  min: number;
  max: number;
  suffix?: string | null;
  presets: { v: string | number; label: string }[];
  onChange: (v: string | number) => void;
}

function NumericCard({ icon, title, desc, tip, value, min, max, suffix, presets, onChange }: NumericCardProps) {
  const isEmpty = value === '' || value == null;
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-3 flex flex-col gap-2 hover:shadow-soft transition-shadow">
      <div className="flex items-center gap-2">
        <span className="text-xl shrink-0" aria-hidden="true">{icon}</span>
        <p className="font-semibold text-sm text-slate-900 min-w-0">{title}</p>
      </div>
      <p className="text-xs text-slate-600 leading-snug">{desc}</p>
      <div className="relative">
        <input
          type="number"
          min={min}
          max={max}
          value={isEmpty ? '' : value}
          placeholder="—"
          onChange={(e) => onChange(e.target.value === '' ? '' : Number(e.target.value))}
          className={cn('c-input pr-12 text-xl font-bold tabular-nums')}
        />
        {suffix && (
          <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs font-medium text-slate-500 pointer-events-none">
            {suffix}
          </span>
        )}
      </div>
      <div className="flex flex-wrap gap-1">
        {presets.map((p) => (
          <button
            key={String(p.v)}
            type="button"
            onClick={() => onChange(p.v)}
            className="text-[11px] font-medium text-slate-700 bg-slate-100 hover:bg-brand-100 hover:text-brand-800 px-2 py-1 rounded-md transition-colors"
          >
            {p.label}
          </button>
        ))}
      </div>
      <p className="text-[11px] text-slate-500 leading-snug mt-auto pt-1 border-t border-slate-100">{tip}</p>
    </div>
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

function buildDefaults(
  fase: FaseRecord | undefined,
  criteriExisting: CriterioRecord[] | undefined,
  suggeritoMetodo: string,
): FaseFormValues {
  const criteri: CriterioFV[] =
    criteriExisting && criteriExisting.length > 0
      ? criteriExisting.map((c) => ({ label: c.nome, key: '', peso: Number(c.peso) || 0 }))
      : DEFAULT_CRITERI.map((c) => ({ ...c }));
  return {
    nome: fase?.nome ?? '',
    dataPrevista: fase?.dataPrevista ?? '',
    scala: fase?.scala ?? 10,
    tempoMinuti: fase?.tempoMinuti ?? 0,
    ammessi: fase?.ammessi ?? '',
    testoEsitoPromosso: fase?.testoEsitoPromosso ?? '',
    testoEsitoEliminato: fase?.testoEsitoEliminato ?? '',
    modoValutazione: fase?.modoValutazione === 'sincrona' ? 'sincrona' : 'autonoma',
    metodoMedia: fase?.metodoMedia ?? suggeritoMetodo,
    criteri,
    sezioniIds: Array.isArray(fase?.sezioniIds) ? [...fase.sezioniIds] : [],
    commissioneId: fase?.commissioneId ?? '',
    tiebreakStrategy: Array.isArray(fase?.tiebreakStrategy) ? fase.tiebreakStrategy : null,
    tiebreakTouched: Array.isArray(fase?.tiebreakStrategy) && fase.tiebreakStrategy.length > 0,
  };
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

  // Dati per le sezioni 3 (n. commissari → metodo consigliato) e 5 (scope).
  const { data: sezioni } = useSezioni(concorsoId);
  const { data: commissioni } = useCommissioni(concorsoId);
  const { data: commissari } = useCommissari(concorsoId);
  const { data: criteriExisting } = useCriteri(existing?.id);

  // Numero di commissari: in edit = membri della commissione assegnata (se c'è),
  // altrimenti tutti i commissari del concorso (come db.getFaseCommissariIds).
  const nCommissari = useMemo(() => {
    const tutti = commissari?.length ?? 0;
    if (isEdit && existing?.commissioneId) {
      const comm = commissioni?.find((c) => c.id === existing.commissioneId);
      if (comm) return comm.commissari.length;
    }
    return tutti;
  }, [commissari, commissioni, isEdit, existing]);

  const suggerito = useMemo(() => suggerisciMetodo(nCommissari), [nCommissari]);

  const [values, setValues] = useState<FaseFormValues>(() =>
    buildDefaults(existing, undefined, suggerito.metodo),
  );

  // Reset/riempimento quando si apre o cambia la fase / i criteri caricati.
  useEffect(() => {
    if (!open) return;
    setValues(buildDefaults(existing, criteriExisting, suggerito.metodo));
  }, [open, existing, criteriExisting, suggerito.metodo]);

  const set = <K extends keyof FaseFormValues>(key: K, val: FaseFormValues[K]) =>
    setValues((p) => ({ ...p, [key]: val }));

  // ── Criteri editor handlers ──────────────────────────────────────────────
  const totalPeso = values.criteri.reduce((s, c) => s + (Number(c.peso) || 0), 0);

  const updateCriterio = (idx: number, field: keyof CriterioFV, val: string | number) =>
    setValues((p) => ({
      ...p,
      criteri: p.criteri.map((c, i) => (i === idx ? { ...c, [field]: val } : c)),
    }));

  const addCriterio = () =>
    setValues((p) => ({ ...p, criteri: [...p.criteri, { label: '', key: '', peso: 0 }] }));

  const removeCriterio = (idx: number) =>
    setValues((p) => ({
      ...p,
      criteri: p.criteri.length > 1 ? p.criteri.filter((_, i) => i !== idx) : p.criteri,
    }));

  // ── Tiebreak: stato "abilitato" per step ──────────────────────────────────
  const isInherited = !values.tiebreakStrategy || values.tiebreakStrategy.length === 0;
  const tbEnabled = (key: string): boolean => {
    const source = values.tiebreakStrategy;
    if (!Array.isArray(source)) return true;
    const row = source.find((s) => s.key === key);
    return row ? !!row.enabled : true;
  };
  const toggleTb = (key: string) => {
    setValues((p) => {
      const base: TiebreakStep[] = TIEBREAK_STEPS.map((s) => ({
        key: s.key,
        enabled: (() => {
          const src = p.tiebreakStrategy;
          if (!Array.isArray(src)) return true;
          const row = src.find((r) => r.key === s.key);
          return row ? !!row.enabled : true;
        })(),
      }));
      const next = base.map((s) => (s.key === key ? { ...s, enabled: !s.enabled } : s));
      return { ...p, tiebreakStrategy: next, tiebreakTouched: true };
    });
  };

  // ── Submit ─────────────────────────────────────────────────────────────────
  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    const nome = values.nome.trim();
    if (!nome) {
      toast.error('Il nome è obbligatorio');
      return;
    }

    const scala = Number(values.scala) || 10;
    const tempoMinuti = Number(values.tempoMinuti) || 0;
    const ammessi = values.ammessi === '' || values.ammessi == null ? null : Number(values.ammessi);
    const dataPrevista = values.dataPrevista || null;

    // Criteri: pesi % → int 0-100 (il server normalizza a 100 con largest-remainder).
    const criteriParsed: CriterioInput[] = values.criteri
      .map((c, i) => ({
        nome: c.label.trim(),
        peso: Math.max(0, Math.min(100, Number(c.peso) || 0)),
        ordine: i,
      }))
      .filter((c) => c.nome);

    if (criteriParsed.length === 0) {
      toast.error('Almeno un criterio richiesto');
      return;
    }

    // Warning soft (non bloccante): somma pesi ≠ 100%.
    const totPct = Math.round(criteriParsed.reduce((s, c) => s + c.peso, 0));
    if (totPct !== 100) {
      const ok = window.confirm(`La somma dei pesi è ${totPct}% (consigliato 100%). Vuoi salvare comunque?`);
      if (!ok) return;
    }

    // Tiebreak: salva l'array solo se l'admin ha toccato i toggle, altrimenti null (eredita).
    let tiebreakStrategy: TiebreakStep[] | null = null;
    if (values.tiebreakTouched) {
      tiebreakStrategy = TIEBREAK_STEPS.map((s) => ({ key: s.key, enabled: tbEnabled(s.key) }));
    }

    const sezioniIds = values.sezioniIds.filter(Boolean);
    const commissioneId = values.commissioneId || null;

    setSaving(true);
    try {
      const common = {
        nome,
        ammessi,
        dataPrevista,
        scala,
        modoValutazione: values.modoValutazione,
        metodoMedia: values.metodoMedia,
        tempoMinuti,
        sezioniIds,
        commissioneId,
        tiebreakStrategy,
        testoEsitoPromosso: values.testoEsitoPromosso.trim() || null,
        testoEsitoEliminato: values.testoEsitoEliminato.trim() || null,
      };

      if (isEdit && existing) {
        const body: UpdateFaseBody = common;
        await updateFase(existing.id, body);
        await syncCriteri(existing.id, criteriParsed);
        toast.success('Fase aggiornata');
      } else {
        const body: CreateFaseBody = { concorsoId, ordine: nextOrdine, ...common };
        const created = await createFase(body);
        await syncCriteri(created.id, criteriParsed);
        toast.success('Fase creata');
      }

      await qc.invalidateQueries({ queryKey: FASI_QUERY_KEY(concorsoId) });
      onSaved();
      onOpenChange(false);
    } catch (err) {
      toast.error(httpErrorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  const metodoConsigliatoNome = METODI_MEDIA[suggerito.metodo]?.nome ?? suggerito.metodo;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>{isEdit ? `Modifica fase: ${existing?.nome}` : 'Nuova fase'}</DialogTitle>
          <DialogDescription className="sr-only">
            Configura nome, esecuzione, metodo di media, criteri, scope e regole di spareggio della fase.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={onSubmit} className="space-y-6 overflow-y-auto max-h-[76dvh] pr-1">
          {/* ====== Sezione 1: Generale ====== */}
          <section>
            <SectionHeader num={1} title="Informazioni generali" />
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <label className="c-field">
                <span className="c-field__label">Nome</span>
                <input
                  type="text"
                  required
                  value={values.nome}
                  onChange={(e) => set('nome', e.target.value)}
                  placeholder="Eliminatoria"
                  autoFocus
                  className="c-input"
                />
              </label>
              <label className="c-field">
                <span className="c-field__label">Data prevista</span>
                <input
                  type="date"
                  value={values.dataPrevista}
                  onChange={(e) => set('dataPrevista', e.target.value)}
                  className="c-input"
                />
              </label>
            </div>
          </section>

          {/* ====== Sezione 2: Esecuzione ====== */}
          <section>
            <SectionHeader num={2} title="Modalità di esecuzione" />

            {/* Tre card numeriche: scala / tempo / posti */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 mb-4">
              <NumericCard
                icon="🎯"
                title="Scala di voto"
                desc="Voto massimo che un commissario può assegnare."
                value={values.scala}
                min={1}
                max={100}
                suffix={null}
                presets={[
                  { v: 10, label: '0–10' },
                  { v: 25, label: '0–25' },
                  { v: 100, label: '0–100' },
                ]}
                onChange={(v) => set('scala', v === '' ? '' : Number(v))}
                tip={
                  <>
                    <strong>10</strong> è lo standard nei conservatori italiani, <strong>100</strong> nei concorsi internazionali.
                  </>
                }
              />
              <NumericCard
                icon="⏱"
                title="Tempo per candidato"
                desc="Minuti previsti per l'esibizione. Attiva un cronometro condiviso."
                value={values.tempoMinuti}
                min={0}
                max={600}
                suffix="min"
                presets={[
                  { v: 0, label: 'Libero' },
                  { v: 5, label: '5 min' },
                  { v: 10, label: '10 min' },
                  { v: 15, label: '15 min' },
                ]}
                onChange={(v) => set('tempoMinuti', v === '' ? '' : Number(v))}
                tip={
                  <>
                    <strong>0</strong> = nessun limite cronometrato.
                  </>
                }
              />
              <NumericCard
                icon="🏆"
                title="Posti per la fase successiva"
                desc="Quanti candidati al massimo passano alla fase seguente."
                value={values.ammessi}
                min={0}
                max={9999}
                suffix={null}
                presets={[
                  { v: '', label: 'Tutti' },
                  { v: 5, label: 'Top 5' },
                  { v: 10, label: 'Top 10' },
                  { v: 20, label: 'Top 20' },
                ]}
                onChange={(v) => set('ammessi', v === '' ? '' : Number(v))}
                tip={
                  <>
                    <strong>Vuoto</strong> = tutti gli ammessi dal verdetto della commissione.
                  </>
                }
              />
            </div>

            {/* Testi custom esito */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mt-3">
              <label className="c-field">
                <span className="c-field__label">Testo esito "ammesso"</span>
                <input
                  className="c-input"
                  maxLength={80}
                  value={values.testoEsitoPromosso}
                  onChange={(e) => set('testoEsitoPromosso', e.target.value)}
                  placeholder="es. AMMESSO ALLA SEMIFINALE"
                />
                <span className="text-[11px] text-slate-500 mt-1 block">
                  Testo mostrato nella colonna esito per i candidati ammessi alla fase successiva. Vuoto = default "PROMOSSO".
                </span>
              </label>
              <label className="c-field">
                <span className="c-field__label">Testo esito "eliminato"</span>
                <input
                  className="c-input"
                  maxLength={80}
                  value={values.testoEsitoEliminato}
                  onChange={(e) => set('testoEsitoEliminato', e.target.value)}
                  placeholder="es. NON AMMESSO"
                />
                <span className="text-[11px] text-slate-500 mt-1 block">
                  Testo mostrato per i non ammessi. Vuoto = default "ELIMINATO".
                </span>
              </label>
            </div>

            {/* Modalità di valutazione: due radio-card */}
            <p className="c-field__label mb-2 mt-3">Modalità di valutazione</p>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
              {(['autonoma', 'sincrona'] as const).map((key) => {
                const m = MODI_VALUTAZIONE[key];
                const selected = values.modoValutazione === key;
                return (
                  <button
                    key={key}
                    type="button"
                    onClick={() => set('modoValutazione', key)}
                    className={cn(
                      'text-left rounded-xl border bg-white p-3 transition-all hover:shadow-soft flex flex-col gap-2',
                      selected
                        ? 'ring-2 ring-brand-500 bg-brand-50/40 border-brand-300'
                        : 'border-slate-200 hover:border-brand-200',
                    )}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex items-center gap-2 min-w-0">
                        <span className="text-xl shrink-0" aria-hidden="true">{m.icon}</span>
                        <p className="font-semibold text-sm text-slate-900">{m.nome}</p>
                      </div>
                      <span className="text-base text-brand-600 leading-none shrink-0">
                        {selected ? '●' : '○'}
                      </span>
                    </div>
                    <p className="text-xs text-slate-600 leading-snug">{m.breve}</p>
                    <div className="text-[11px] text-slate-500 space-y-0.5 mt-1 pt-2 border-t border-slate-100">
                      <p className="font-semibold text-slate-700 mb-0.5">Quando usarla:</p>
                      {m.scenari.map((s) => (
                        <p key={s} className="flex gap-1.5">
                          <span className="text-brand-500">·</span>
                          <span>{s}</span>
                        </p>
                      ))}
                      <p className="text-slate-400 italic mt-1">{m.tip}</p>
                    </div>
                  </button>
                );
              })}
            </div>
          </section>

          {/* ====== Sezione 3: Metodo di calcolo media ====== */}
          <section>
            <SectionHeader
              num={3}
              title="Metodo di calcolo della media"
              right={
                <div className="text-xs bg-amber-50 text-amber-900 border border-amber-200 rounded-full px-3 py-1 inline-flex items-center gap-1.5">
                  <span>👥</span>
                  <span>
                    <strong>{nCommissari}</strong> commissari {isEdit ? 'su questa fase' : 'nel concorso'}
                  </span>
                </div>
              }
            />
            <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-3 mb-3 flex items-start gap-3">
              <span className="text-lg shrink-0">🎯</span>
              <div className="text-sm">
                <p className="font-semibold text-emerald-900">Consigliato: {metodoConsigliatoNome}</p>
                <p className="text-emerald-800 text-xs mt-0.5">{suggerito.motivo}</p>
              </div>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
              {Object.entries(METODI_MEDIA).map(([key, m]) => {
                const isSel = key === values.metodoMedia;
                const isSug = key === suggerito.metodo;
                return (
                  <button
                    key={key}
                    type="button"
                    onClick={() => set('metodoMedia', key)}
                    className={cn(
                      'text-left rounded-xl border bg-white p-3 transition-all hover:shadow-soft flex flex-col gap-2',
                      isSel
                        ? 'ring-2 ring-brand-500 bg-brand-50/40 border-brand-300'
                        : 'border-slate-200 hover:border-brand-200',
                    )}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex items-center gap-2 min-w-0">
                        <span className="text-xl shrink-0" aria-hidden="true">{m.icon}</span>
                        <div className="min-w-0">
                          <p className="font-semibold text-sm text-slate-900 truncate">{m.nome}</p>
                          {isSug && (
                            <span className="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider text-emerald-700 bg-emerald-100 border border-emerald-200 px-1.5 py-0.5 rounded-full mt-0.5">
                              🎯 consigliato
                            </span>
                          )}
                        </div>
                      </div>
                      <span className="text-base text-brand-600 leading-none shrink-0">
                        {isSel ? '●' : '○'}
                      </span>
                    </div>
                    <p className="text-xs text-slate-600 leading-snug">{m.breve}</p>
                    <div className="text-[11px] text-slate-500 space-y-0.5 mt-1 pt-2 border-t border-slate-100">
                      <p>
                        <span className="font-semibold text-emerald-700">+</span> {m.pro}
                      </p>
                      <p>
                        <span className="font-semibold text-rose-700">−</span> {m.contro}
                      </p>
                      <p className="text-slate-400 italic">{m.consigliata}</p>
                    </div>
                  </button>
                );
              })}
            </div>
          </section>

          {/* ====== Sezione 4: Criteri ====== */}
          <section>
            <SectionHeader
              num={4}
              title="Criteri di valutazione"
              right={
                <p className="text-xs font-mono text-slate-600">
                  Totale pesi:{' '}
                  <span className={cn('font-bold', totalPeso === 100 ? 'text-emerald-600' : 'text-amber-600')}>
                    {totalPeso}%
                  </span>
                </p>
              }
            />
            <p className="text-xs text-slate-600 mb-2">
              Ogni criterio contribuisce alla media finale in base al suo peso. La somma dei pesi dovrebbe essere 100%.
            </p>
            <div className="space-y-2">
              {values.criteri.map((c, i) => (
                <div key={i} className="grid grid-cols-12 gap-2 items-end">
                  <label className="col-span-5 c-field">
                    {i === 0 && <span className="c-field__label">Etichetta</span>}
                    <input
                      type="text"
                      className="c-input"
                      value={c.label}
                      onChange={(e) => updateCriterio(i, 'label', e.target.value)}
                      placeholder="Tecnica"
                    />
                  </label>
                  <label className="col-span-4 c-field">
                    {i === 0 && <span className="c-field__label">Chiave (opzionale)</span>}
                    <input
                      type="text"
                      className="c-input font-mono text-xs"
                      value={c.key}
                      onChange={(e) => updateCriterio(i, 'key', e.target.value)}
                      placeholder="auto"
                    />
                  </label>
                  <label className="col-span-2 c-field">
                    {i === 0 && <span className="c-field__label">Peso (%)</span>}
                    <div className="relative">
                      <input
                        type="number"
                        step={1}
                        min={0}
                        max={100}
                        className="c-input pr-7"
                        value={c.peso}
                        onChange={(e) => updateCriterio(i, 'peso', Number(e.target.value))}
                      />
                      <span className="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-slate-500 pointer-events-none">
                        %
                      </span>
                    </div>
                  </label>
                  <button
                    type="button"
                    onClick={() => removeCriterio(i)}
                    className="col-span-1 h-9 text-rose-600 hover:bg-rose-50 rounded-md flex items-center justify-center"
                    title="Rimuovi"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              ))}
            </div>
            <button
              type="button"
              onClick={addCriterio}
              className="mt-2 text-xs font-medium text-brand-700 hover:text-brand-900 inline-flex items-center gap-1"
            >
              + Aggiungi criterio
            </button>
          </section>

          {/* ====== Sezione 5: Restrizione e assegnazione ====== */}
          <section>
            <SectionHeader num={5} title="Restrizione e assegnazione" />
            <div className="space-y-4">
              {/* Sezioni di scope */}
              <div>
                <p className="c-field__label mb-2">Limita ai candidati delle sezioni</p>
                <p className="text-[11px] text-slate-500 leading-snug mb-2">
                  Lascia tutto deselezionato per includere <strong>tutti</strong> i candidati del concorso. Selezionando una o più sezioni, solo i candidati che vi appartengono parteciperanno a questa fase: le fasi diventano tracce parallele per sezione.
                </p>
                {(sezioni?.length ?? 0) === 0 ? (
                  <div className="text-xs text-slate-500 italic bg-slate-50 border border-dashed border-slate-200 rounded-lg px-3 py-2">
                    Nessuna sezione definita. Crea le sezioni dal tab <em>Sezioni</em> per poter scopare le fasi.
                  </div>
                ) : (
                  <div className="flex flex-wrap gap-1.5">
                    {sezioni?.map((s) => {
                      const isSel = values.sezioniIds.includes(s.id);
                      return (
                        <button
                          key={s.id}
                          type="button"
                          onClick={() =>
                            set(
                              'sezioniIds',
                              isSel
                                ? values.sezioniIds.filter((id) => id !== s.id)
                                : [...values.sezioniIds, s.id],
                            )
                          }
                          className={cn(
                            'text-xs font-medium px-3 py-1.5 rounded-full border transition-colors',
                            isSel
                              ? 'bg-brand-600 text-white border-brand-600 hover:bg-brand-700'
                              : 'bg-white text-slate-700 border-slate-200 hover:border-brand-300 hover:bg-brand-50',
                          )}
                        >
                          {s.nome}
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* Commissione assegnata */}
              <div>
                <p className="c-field__label mb-2">Commissione assegnata</p>
                <p className="text-[11px] text-slate-500 leading-snug mb-2">
                  Una commissione raggruppa commissari + sezioni + categorie. Assegnandone una alla fase, solo i suoi membri valuteranno. Lascia "Nessuna" per usare automaticamente <strong>tutti i commissari del concorso</strong>.
                </p>
                <select
                  className="c-input"
                  value={values.commissioneId}
                  onChange={(e) => set('commissioneId', e.target.value)}
                >
                  <option value="">— Nessuna (tutti i commissari del concorso)</option>
                  {commissioni?.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.nome} · {c.commissari.length} commissari
                    </option>
                  ))}
                </select>
                {(commissioni?.length ?? 0) === 0 && (
                  <p className="text-[11px] text-amber-700 italic mt-1">
                    Nessuna commissione creata per questo concorso. Crea una commissione dal tab <em>Commissioni</em> per poterla assegnare.
                  </p>
                )}
              </div>
            </div>
          </section>

          {/* ====== Sezione 6: Regole di spareggio ====== */}
          <section>
            <SectionHeader num={6} title="Regole di rottura della parità" />
            <div className="space-y-3">
              {isInherited && (
                <div className="bg-amber-50 border border-amber-200 rounded-xl px-3 py-2 text-xs text-amber-900 flex items-center gap-2">
                  <span>ℹ️</span>
                  <span>
                    Questa fase usa la cascata di default del concorso. Modifica i toggle qui sotto per applicare una policy specifica a questa fase.
                  </span>
                </div>
              )}
              <p className="text-xs text-slate-600">
                L'ordine della cascata è fisso: si parte dal primo step abilitato e si scende solo se la parità resta. Lascia almeno "Ex aequo" attivo per chiudere casi residui in modo legalmente difendibile.
              </p>
              <div className="space-y-2">
                {TIEBREAK_STEPS.map((s, i) => (
                  <label
                    key={s.key}
                    className="flex items-start gap-3 rounded-xl border border-slate-200 bg-white px-3 py-2.5 hover:border-brand-200 transition cursor-pointer"
                  >
                    <input
                      type="checkbox"
                      className="mt-1 w-4 h-4"
                      checked={tbEnabled(s.key)}
                      onChange={() => toggleTb(s.key)}
                    />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="w-6 h-6 rounded-full bg-brand-100 text-brand-700 text-[11px] font-bold inline-flex items-center justify-center">
                          {i + 1}
                        </span>
                        <span className="text-base" aria-hidden="true">{s.icon}</span>
                        <span className="font-semibold text-sm text-slate-900">{s.titolo}</span>
                      </div>
                      <p className="text-[12px] text-slate-600 mt-1 leading-relaxed">{s.breve}</p>
                    </div>
                  </label>
                ))}
              </div>
            </div>
          </section>

          <DialogFooter>
            <button
              type="button"
              className="c-btn c-btn--outline"
              onClick={() => onOpenChange(false)}
              disabled={saving}
            >
              Annulla
            </button>
            <button type="submit" className="c-btn c-btn--primary" disabled={saving}>
              {saving ? 'Salvataggio…' : isEdit ? 'Salva' : 'Crea'}
            </button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
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
          <button
            type="button"
            className="c-btn c-btn--outline"
            onClick={() => onOpenChange(false)}
            disabled={loading}
          >
            Annulla
          </button>
          <button
            type="button"
            className={cn('c-btn', danger ? 'c-btn--danger' : 'c-btn--primary')}
            onClick={async () => {
              await onConfirm();
              onOpenChange(false);
            }}
            disabled={loading}
          >
            {loading ? 'Attendere…' : confirmLabel}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// FaseCard — card singola fase nella lista (stile vanilla faseCardHtml)
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
    <div className="bg-white border border-slate-200 rounded-2xl p-4 shadow-soft hover:shadow-md transition-shadow">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-xs font-mono uppercase tracking-wider text-slate-500">
              #{fase.ordine}
            </span>
            <h3 className="font-bold text-slate-900 text-lg">{fase.nome}</h3>
            <span
              className={cn(
                'inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider border',
                STATO_COLORS[stato],
              )}
            >
              {prettyStato(stato)}
            </span>
            {fase.modoValutazione === 'sincrona' && (
              <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full bg-purple-100 text-purple-800 border border-purple-200">
                sincrona
              </span>
            )}
          </div>

          <div className="mt-1 text-xs text-slate-600 flex flex-wrap gap-x-4 gap-y-1">
            <span>Scala {fase.scala}</span>
            {fase.metodoMedia && <span>Media: {fase.metodoMedia}</span>}
            {fase.ammessi != null && <span>Ammessi: {fase.ammessi}</span>}
            {fase.dataPrevista && <span>Data: {fmtDate(fase.dataPrevista)}</span>}
            {fase.tempoMinuti != null && fase.tempoMinuti > 0 && (
              <span>Tempo: {fase.tempoMinuti}′</span>
            )}
          </div>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={onMoveUp}
            disabled={isFirst}
            title="Sposta su"
            className="w-9 h-9 inline-flex items-center justify-center rounded-lg text-slate-600 bg-slate-50 hover:bg-slate-100 border border-slate-200 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <ChevronUp className="h-[18px] w-[18px]" />
          </button>
          <button
            type="button"
            onClick={onMoveDown}
            disabled={isLast}
            title="Sposta giù"
            className="w-9 h-9 inline-flex items-center justify-center rounded-lg text-slate-600 bg-slate-50 hover:bg-slate-100 border border-slate-200 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <ChevronDown className="h-[18px] w-[18px]" />
          </button>
          <button
            type="button"
            onClick={onEdit}
            title="Modifica"
            className="w-9 h-9 inline-flex items-center justify-center rounded-lg text-brand-700 bg-brand-50 hover:bg-brand-100 border border-brand-100 transition-colors"
          >
            <Pencil className="h-[18px] w-[18px]" />
          </button>
          <button
            type="button"
            onClick={onDelete}
            disabled={stato === 'IN_CORSO'}
            title={stato === 'IN_CORSO' ? 'Non eliminabile mentre è IN_CORSO' : 'Elimina'}
            className="w-9 h-9 inline-flex items-center justify-center rounded-lg text-rose-600 bg-rose-50 hover:bg-rose-100 border border-rose-100 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <Trash2 className="h-[18px] w-[18px]" />
          </button>
        </div>
      </div>

      <div className="mt-3 flex flex-wrap gap-2">
        {stato === 'PIANIFICATA' && (
          <button
            type="button"
            onClick={onStart}
            className="text-xs font-medium text-white bg-emerald-600 hover:bg-emerald-700 px-3 py-1.5 rounded-md shadow-sm inline-flex items-center gap-1"
          >
            <Play className="h-3.5 w-3.5" />
            Avvia
          </button>
        )}
        {stato === 'IN_CORSO' && (
          <button
            type="button"
            onClick={onConclude}
            className="text-xs font-medium text-white bg-rose-600 hover:bg-rose-700 px-3 py-1.5 rounded-md shadow-sm inline-flex items-center gap-1"
          >
            <StopCircle className="h-3.5 w-3.5" />
            Concludi
          </button>
        )}
        {stato !== 'CONCLUSA' && (
          <button
            type="button"
            onClick={onSorteggio}
            className="text-xs font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 px-3 py-1.5 rounded-md inline-flex items-center gap-1"
          >
            <Shuffle className="h-3.5 w-3.5" />
            Sorteggio
          </button>
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

  const sorted = [...(fasi ?? [])].sort((a, b) => a.ordine - b.ordine);

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
          await concludiFase(fase.id);
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
      <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
        <p className="text-sm text-slate-600">
          {sorted.length} {sorted.length === 1 ? 'fase' : 'fasi'}
        </p>
        <button
          type="button"
          onClick={() => setFormDialog({ open: true })}
          className="c-btn c-btn--primary c-btn--sm inline-flex items-center gap-1"
        >
          <Plus className="h-4 w-4" />
          Nuova fase
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
          <p className="mb-3">
            Le <strong>fasi</strong> definiscono la struttura del concorso: eliminatoria, semifinale, finale.
            Ogni fase ha i propri criteri di valutazione, commissione e scala di voto.
          </p>
          <ul className="space-y-1.5 pl-1">
            <li>▶️ <strong>Avvia</strong> — passa da PIANIFICATA a IN CORSO. I commissari possono iniziare a votare.</li>
            <li>■ <strong>Concludi</strong> — chiude la fase e calcola gli ammessi alla successiva.</li>
            <li>🎲 <strong>Sorteggio</strong> — genera un ordine casuale dei candidati.</li>
            <li>↕ <strong>Riordina</strong> — cambia la sequenza delle fasi con le frecce su/giù.</li>
            <li>🏆 <strong>Ammessi</strong> — numero di candidati che passano alla fase successiva. Vuoto = tutti.</li>
          </ul>
          <p className="mt-3 text-xs text-slate-500 italic">
            Il flusso di una fase è: PIANIFICATA → IN CORSO → CONCLUSA. Una fase IN CORSO non può essere eliminata.
          </p>
        </div>
      </details>

      {/* ── Empty state ───────────────────────────────────────────────── */}
      {sorted.length === 0 ? (
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
            onClick={() => setFormDialog({ open: true })}
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

      {/* ── Form dialog ───────────────────────────────────────────────── */}
      {formDialog.open && (
        <FaseFormDialog
          key={formDialog.existing?.id ?? 'new'}
          open={formDialog.open}
          onOpenChange={(v) => setFormDialog((p) => ({ ...p, open: v }))}
          concorsoId={concorsoId}
          existing={formDialog.existing}
          nextOrdine={nextOrdine}
          onSaved={() => setFormDialog({ open: false })}
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
