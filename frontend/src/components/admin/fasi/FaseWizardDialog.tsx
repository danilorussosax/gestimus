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
  syncCriteri,
  FASI_QUERY_KEY,
} from '@/api/fasi';
import { type CriterioInput } from '@/api/criteri';
import { useSezioni } from '@/api/sezioni';
import { useCommissioni } from '@/api/commissioni';
import { useCommissari } from '@/api/commissari';
import {
  METODI_MEDIA,
  MODI_VALUTAZIONE,
  DEFAULT_CRITERI,
  suggerisciMetodo,
  WIZ_TEMPLATES,
  type WizItem,
  type CriterioFV,
  type FaseGroup,
} from '../fasi-utils';
import { SectionHeader } from './SectionHeader';
import { NumericCard } from './NumericCard';

export interface FaseWizardDialogProps {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  concorsoId: string;
  group: FaseGroup;
  nextOrdine: number;
  onSaved: () => void;
}

export function FaseWizardDialog({
  open,
  onOpenChange,
  concorsoId,
  group,
  nextOrdine,
  onSaved,
}: FaseWizardDialogProps) {
  const qc = useQueryClient();
  const { data: sezioni } = useSezioni(concorsoId);
  const { data: commissioni } = useCommissioni(concorsoId);
  const { data: commissari } = useCommissari(concorsoId);

  const suggerito = useMemo(() => suggerisciMetodo(commissari?.length ?? 0), [commissari]);

  const groupLabel =
    group.type === 'shared'
      ? 'tutte le sezioni'
      : group.sezioneIds
          .map((id) => sezioni?.find((s) => s.id === id)?.nome)
          .filter(Boolean)
          .join(', ');

  const [tpl, setTpl] = useState<string>('unica');
  const [items, setItems] = useState<WizItem[]>(WIZ_TEMPLATES.unica.items.map((i) => ({ ...i })));
  const [scala, setScala] = useState<number | ''>(10);
  const [tempoMinuti, setTempoMinuti] = useState<number | ''>(0);
  const [commissioneId, setCommissioneId] = useState('');
  const [modoValutazione, setModoValutazione] = useState<'autonoma' | 'sincrona'>('autonoma');
  const [metodoMedia, setMetodoMedia] = useState(suggerito.metodo);
  const [criteri, setCriteri] = useState<CriterioFV[]>(DEFAULT_CRITERI.map((c) => ({ ...c })));
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setTpl('unica');
    setItems(WIZ_TEMPLATES.unica.items.map((i) => ({ ...i })));
    setScala(10);
    setTempoMinuti(0);
    setCommissioneId('');
    setModoValutazione('autonoma');
    setMetodoMedia(suggerito.metodo);
    setCriteri(DEFAULT_CRITERI.map((c) => ({ ...c })));
  }, [open, suggerito.metodo]);

  const totalPeso = criteri.reduce((s, c) => s + (c.peso || 0), 0);

  const pickTemplate = (k: string) => {
    setTpl(k);
    setItems(WIZ_TEMPLATES[k].items.map((i) => ({ ...i })));
  };
  const addItem = () =>
    setItems((p) => [...p, { nome: `Fase ${p.length + 1}`, ammessi: '' }]);
  const removeItem = (idx: number) =>
    setItems((p) => (p.length > 1 ? p.filter((_, i) => i !== idx) : p));
  const updateItem = (idx: number, field: keyof WizItem, val: string | number) =>
    setItems((p) => p.map((it, i) => (i === idx ? { ...it, [field]: val } : it)));

  const updateCriterio = (idx: number, field: keyof CriterioFV, val: string | number) =>
    setCriteri((p) => p.map((c, i) => (i === idx ? { ...c, [field]: val } : c)));
  const addCriterio = () => setCriteri((p) => [...p, { label: '', key: '', peso: 0 }]);
  const removeCriterio = (idx: number) =>
    setCriteri((p) => (p.length > 1 ? p.filter((_, i) => i !== idx) : p));

  const onSubmit = async (e: SyntheticEvent) => {
    e.preventDefault();
    const cleanItems = items
      .map((it) => ({ nome: it.nome.trim(), ammessi: it.ammessi }))
      .filter((it) => it.nome);
    if (cleanItems.length === 0) {
      toast.error('Aggiungi almeno una fase');
      return;
    }
    const lower = cleanItems.map((i) => i.nome.toLowerCase());
    const dupes = lower.filter((n, i, a) => a.indexOf(n) !== i);
    if (dupes.length > 0) {
      toast.error(`Nomi duplicati: ${[...new Set(dupes)].join(', ')}`);
      return;
    }

    const criteriParsed: CriterioInput[] = criteri
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
    const totPct = Math.round(criteriParsed.reduce((s, c) => s + c.peso, 0));
    if (totPct !== 100) {
      const ok = window.confirm(`La somma dei pesi è ${totPct}% (consigliato 100%). Continuo?`);
      if (!ok) return;
    }

    setSaving(true);
    const created: string[] = [];
    try {
      // Creazione sequenziale: l'ordine globale è progressivo dal nextOrdine.
      for (let i = 0; i < cleanItems.length; i++) {
        const it = cleanItems[i];
        const ammessi = it.ammessi === '' || it.ammessi == null ? null : it.ammessi;
        const rec = await createFase({
          concorsoId,
          ordine: nextOrdine + i,
          nome: it.nome,
          scala: Number(scala) || 10,
          tempoMinuti: Number(tempoMinuti) || 0,
          ammessi,
          dataPrevista: null,
          modoValutazione,
          metodoMedia,
          sezioniIds: group.sezioneIds.slice(),
          commissioneId: commissioneId || null,
        });
        created.push(rec.id);
        await syncCriteri(rec.id, criteriParsed);
      }
      toast.success(`${created.length} ${created.length === 1 ? 'fase creata' : 'fasi create'}`);
      await qc.invalidateQueries({ queryKey: FASI_QUERY_KEY(concorsoId) });
      onSaved();
      onOpenChange(false);
    } catch (err) {
      toast.error(
        `Errore dopo ${created.length} fasi: ${httpErrorMessage(err)}`,
      );
      await qc.invalidateQueries({ queryKey: FASI_QUERY_KEY(concorsoId) });
      onSaved();
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-4xl sm:p-8">
        <DialogHeader>
          <DialogTitle>Configura fasi per {groupLabel}</DialogTitle>
          <DialogDescription className="sr-only">
            Scegli un template di fasi, definisci nomi e posti, e la configurazione comune.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={onSubmit} className="space-y-7 overflow-y-auto max-h-[76dvh] pr-2">
          <div className="bg-brand-50/60 border border-brand-100 rounded-xl px-4 py-3 text-sm text-slate-700">
            <p>
              Stai configurando le fasi per: {groupLabel}.{' '}
              <span className="text-slate-500">
                Tutte le sotto-fasi create qui condivideranno i campi della "configurazione comune" qui sotto.
              </span>
            </p>
          </div>

          {/* Step 1: template */}
          <section className="rounded-xl border border-slate-100 bg-slate-50/40 px-5 py-4">
            <SectionHeader num={1} title="Quante fasi?" />
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
              {Object.entries(WIZ_TEMPLATES).map(([k, def]) => {
                const sel = k === tpl;
                return (
                  <button
                    key={k}
                    type="button"
                    onClick={() => pickTemplate(k)}
                    className={cn(
                      'text-left rounded-xl border px-3 py-2.5 transition',
                      sel
                        ? 'border-brand-300 bg-brand-50/40 ring-2 ring-brand-500'
                        : 'border-slate-200 hover:border-brand-300 hover:bg-brand-50/30',
                    )}
                  >
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-bold text-slate-900">{def.label}</span>
                      <span className="ml-auto text-brand-600 text-xs">{sel ? '●' : '○'}</span>
                    </div>
                    <p className="text-[11px] text-slate-500 mt-0.5">
                      {def.items.map((i) => i.nome).join(' → ')}
                    </p>
                  </button>
                );
              })}
            </div>
          </section>

          {/* Step 2: lista fasi */}
          <section className="rounded-xl border border-slate-100 bg-slate-50/40 px-5 py-4">
            <SectionHeader
              num={2}
              title="Nome e posti per ogni fase"
              right={
                <button
                  type="button"
                  onClick={addItem}
                  className="text-xs font-medium text-brand-700 hover:text-brand-900 inline-flex items-center gap-1"
                >
                  + Aggiungi fase
                </button>
              }
            />
            <p className="text-xs text-slate-500 mb-2">
              "Ammessi" = quanti candidati passano alla fase successiva. Vuoto = passano tutti gli ammessi dal
              verdetto della commissione.
            </p>
            <div className="space-y-2">
              {items.map((it, i) => (
                <div key={i} className="grid grid-cols-12 gap-2 items-center">
                  <div className="col-span-1 text-center text-xs font-mono text-slate-400">#{i + 1}</div>
                  <input
                    type="text"
                    className="col-span-7 c-input"
                    placeholder="Nome fase"
                    value={it.nome}
                    onChange={(e) => updateItem(i, 'nome', e.target.value)}
                  />
                  <input
                    type="number"
                    min={0}
                    className="col-span-3 c-input"
                    placeholder="Ammessi (vuoto = tutti)"
                    value={it.ammessi === '' || it.ammessi == null ? '' : it.ammessi}
                    onChange={(e) => updateItem(i, 'ammessi', e.target.value === '' ? '' : Number(e.target.value))}
                  />
                  <button
                    type="button"
                    onClick={() => removeItem(i)}
                    className="col-span-1 text-rose-600 hover:bg-rose-50 rounded-md text-lg"
                    title="Rimuovi"
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>
          </section>

          {/* Step 3: configurazione comune */}
          <section className="rounded-xl border border-slate-100 bg-slate-50/40 px-5 py-4">
            <SectionHeader num={3} title="Configurazione comune (vale per tutte le sotto-fasi)" />
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-4">
              <NumericCard
                icon="🎯"
                title="Scala di voto"
                desc="Voto massimo che un commissario può assegnare."
                value={scala}
                min={1}
                max={100}
                suffix={null}
                presets={[
                  { v: 10, label: '0–10' },
                  { v: 25, label: '0–25' },
                  { v: 100, label: '0–100' },
                ]}
                onChange={(v) => setScala(v === '' ? '' : Number(v))}
                tip={
                  <>
                    <strong>10</strong> standard, <strong>100</strong> concorsi internazionali.
                  </>
                }
              />
              <NumericCard
                icon="⏱"
                title="Tempo per candidato"
                desc="Minuti previsti per l'esibizione."
                value={tempoMinuti}
                min={0}
                max={600}
                suffix="min"
                presets={[
                  { v: 0, label: 'Libero' },
                  { v: 5, label: '5 min' },
                  { v: 10, label: '10 min' },
                  { v: 15, label: '15 min' },
                ]}
                onChange={(v) => setTempoMinuti(v === '' ? '' : Number(v))}
                tip={
                  <>
                    <strong>0</strong> = nessun limite.
                  </>
                }
              />
              <div className="rounded-xl border border-slate-200 bg-white p-3 flex flex-col gap-2">
                <div className="flex items-center gap-2">
                  <span className="text-xl">🎼</span>
                  <p className="font-semibold text-sm">Commissione</p>
                </div>
                <p className="text-xs text-slate-600">
                  Stessa commissione per tutte le sotto-fasi. Vuoto = tutti i commissari del concorso.
                </p>
                <select className="c-input" value={commissioneId} onChange={(e) => setCommissioneId(e.target.value)}>
                  <option value="">— Nessuna —</option>
                  {commissioni?.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.nome} · {c.commissari.length} comm.
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <p className="c-field__label mb-2 mt-1">Modalità di valutazione</p>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-4">
              {(['autonoma', 'sincrona'] as const).map((key) => {
                const m = MODI_VALUTAZIONE[key];
                const selected = modoValutazione === key;
                return (
                  <button
                    key={key}
                    type="button"
                    onClick={() => setModoValutazione(key)}
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
                      <span className="text-base text-brand-600 leading-none shrink-0">{selected ? '●' : '○'}</span>
                    </div>
                    <p className="text-xs text-slate-600 leading-snug">{m.breve}</p>
                  </button>
                );
              })}
            </div>

            <p className="c-field__label mb-2">Metodo di calcolo media</p>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-4">
              {Object.entries(METODI_MEDIA).map(([key, m]) => {
                const isSel = key === metodoMedia;
                const isSug = key === suggerito.metodo;
                return (
                  <button
                    key={key}
                    type="button"
                    onClick={() => setMetodoMedia(key)}
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
                      <span className="text-base text-brand-600 leading-none shrink-0">{isSel ? '●' : '○'}</span>
                    </div>
                    <p className="text-xs text-slate-600 leading-snug">{m.breve}</p>
                  </button>
                );
              })}
            </div>

            <p className="c-field__label mb-2 flex items-center justify-between">
              <span>Criteri di valutazione</span>
              <span className="text-xs font-mono text-slate-600">
                Tot:{' '}
                <span className={cn('font-bold', totalPeso === 100 ? 'text-emerald-600' : 'text-amber-600')}>
                  {totalPeso}%
                </span>
              </span>
            </p>
            <div className="space-y-2">
              {criteri.map((c, i) => (
                <div key={i} className="grid grid-cols-12 gap-3 items-end">
                  <label className="col-span-7 c-field">
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

          <DialogFooter>
            <button type="button" className="c-btn c-btn--outline" onClick={() => onOpenChange(false)} disabled={saving}>
              Annulla
            </button>
            <button type="submit" className="c-btn c-btn--primary" disabled={saving}>
              {saving ? 'Creazione…' : 'Crea fasi'}
            </button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
