import { useState, useEffect, useMemo, type SyntheticEvent } from 'react';
import { toast } from 'sonner';
import { useQueryClient } from '@tanstack/react-query';
import { Trash2 } from 'lucide-react';
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
  createFase,
  updateFase,
  syncCriteri,
  FASI_QUERY_KEY,
  type FaseRecord,
  type CreateFaseBody,
  type UpdateFaseBody,
  type TiebreakStep,
} from '@/api/fasi';
import { useCriteri, type CriterioInput } from '@/api/criteri';
import { useSezioni } from '@/api/sezioni';
import { useCommissioni } from '@/api/commissioni';
import { useCommissari } from '@/api/commissari';
import {
  METODI_MEDIA,
  MODI_VALUTAZIONE,
  TIEBREAK_STEPS,
  suggerisciMetodo,
  buildDefaults,
  type CriterioFV,
  type FaseFormValues,
} from '../fasi-utils';
import { SectionHeader } from './SectionHeader';
import { NumericCard } from './NumericCard';

// Pre-popolamento in creazione (wizard "+ Aggiungi sotto-fase"): ricava
// sezioni_ids + campi condivisi dal gruppo e li passa al form standard.
// Replica il ramo `group.fasi.length > 0` di openFaseWizard.
export interface FasePrefill {
  sezioniIds?: string[];
  scala?: number;
  tempoMinuti?: number;
  modoValutazione?: 'autonoma' | 'sincrona';
  metodoMedia?: string;
  commissioneId?: string | null;
}

export interface FaseFormDialogProps {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  concorsoId: string;
  existing?: FaseRecord;
  prefill?: FasePrefill;
  nextOrdine: number;
  onSaved: () => void;
}

export function FaseFormDialog({
  open,
  onOpenChange,
  concorsoId,
  existing,
  prefill,
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
    if (isEdit && existing.commissioneId) {
      const comm = commissioni?.find((c) => c.id === existing.commissioneId);
      if (comm) return comm.commissari.length;
    }
    return tutti;
  }, [commissari, commissioni, isEdit, existing]);

  const suggerito = useMemo(() => suggerisciMetodo(nCommissari), [nCommissari]);

  const [values, setValues] = useState<FaseFormValues>(() =>
    buildDefaults(existing, undefined, suggerito.metodo, prefill),
  );

  // Reset/riempimento quando si apre o cambia la fase / i criteri caricati.
  useEffect(() => {
    if (!open) return;
    setValues(buildDefaults(existing, criteriExisting, suggerito.metodo, prefill));
  }, [open, existing, criteriExisting, suggerito.metodo, prefill]);

  const set = <K extends keyof FaseFormValues>(key: K, val: FaseFormValues[K]) =>
    setValues((p) => ({ ...p, [key]: val }));

  // ── Criteri editor handlers ──────────────────────────────────────────────
  const totalPeso = values.criteri.reduce((s, c) => s + (c.peso || 0), 0);

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
    return row ? row.enabled : true;
  };
  const toggleTb = (key: string) => {
    setValues((p) => {
      const base: TiebreakStep[] = TIEBREAK_STEPS.map((s) => ({
        key: s.key,
        enabled: (() => {
          const src = p.tiebreakStrategy;
          if (!Array.isArray(src)) return true;
          const row = src.find((r) => r.key === s.key);
          return row ? row.enabled : true;
        })(),
      }));
      const next = base.map((s) => (s.key === key ? { ...s, enabled: !s.enabled } : s));
      return { ...p, tiebreakStrategy: next, tiebreakTouched: true };
    });
  };

  // ── Submit ─────────────────────────────────────────────────────────────────
  const onSubmit = async (e: SyntheticEvent) => {
    e.preventDefault();
    const nome = values.nome.trim();
    if (!nome) {
      toast.error('Il nome è obbligatorio');
      return;
    }

    const scala = Number(values.scala) || 10;
    const tempoMinuti = Number(values.tempoMinuti) || 0;
    const ammessi = values.ammessi === '' || values.ammessi == null ? null : values.ammessi;
    const dataPrevista = values.dataPrevista || null;

    // Criteri: pesi % → int 0-100 (il server normalizza a 100 con largest-remainder).
    const criteriParsed: CriterioInput[] = values.criteri
      .map((c, i) => ({
        nome: c.label.trim(),
        peso: Math.max(0, Math.min(100, c.peso || 0)),
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

  const metodoConsigliatoNome = METODI_MEDIA[suggerito.metodo].nome;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-4xl sm:p-8">
        <DialogHeader>
          <DialogTitle>{isEdit ? `Modifica fase: ${existing.nome}` : 'Nuova fase'}</DialogTitle>
          <DialogDescription className="sr-only">
            Configura nome, esecuzione, metodo di media, criteri, scope e regole di spareggio della fase.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={onSubmit} className="space-y-7 overflow-y-auto max-h-[76dvh] pr-2">
          {/* ====== Sezione 1: Generale ====== */}
          <section className="rounded-xl border border-slate-100 bg-slate-50/40 px-5 py-4">
            <SectionHeader num={1} title="Informazioni generali" />
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
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
          <section className="rounded-xl border border-slate-100 bg-slate-50/40 px-5 py-4">
            <SectionHeader num={2} title="Modalità di esecuzione" />

            {/* Tre card numeriche: scala / tempo / posti */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-4">
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
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-4">
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
            <p className="c-field__label mb-2 mt-4">Modalità di valutazione</p>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
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
          <section className="rounded-xl border border-slate-100 bg-slate-50/40 px-5 py-4">
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
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
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
          <section className="rounded-xl border border-slate-100 bg-slate-50/40 px-5 py-4">
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
                <div key={i} className="grid grid-cols-12 gap-3 items-end">
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
          <section className="rounded-xl border border-slate-100 bg-slate-50/40 px-5 py-4">
            <SectionHeader num={5} title="Restrizione e assegnazione" />
            <div className="space-y-5">
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
          <section className="rounded-xl border border-slate-100 bg-slate-50/40 px-5 py-4">
            <SectionHeader num={6} title="Regole in caso di ex aequo" />
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
