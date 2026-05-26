import { useState, useEffect, type SyntheticEvent, type ReactNode } from 'react';
import { toast } from 'sonner';
import { useQueryClient } from '@tanstack/react-query';
import { Trash2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from '@/components/ui/dialog';
import {
  updateFase,
  syncCriteri,
  FASI_QUERY_KEY,
  type UpdateFaseBody,
} from '@/api/fasi';
import { listCriteri, type CriterioInput } from '@/api/criteri';
import { type CommissioneRecord } from '@/api/commissioni';
import {
  METODI_MEDIA,
  DEFAULT_CRITERI,
  computeDrift,
  sharedValue,
  type CriterioFV,
  type FaseGroup,
} from '../fasi-utils';

export interface SharedFieldsDialogProps {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  concorsoId: string;
  group: FaseGroup;
  commissioni: CommissioneRecord[] | undefined;
  onSaved: () => void;
}

export function SharedFieldsDialog({
  open,
  onOpenChange,
  concorsoId,
  group,
  commissioni,
  onSaved,
}: SharedFieldsDialogProps) {
  const qc = useQueryClient();
  const fasi = group.fasi;
  const drift = computeDrift(fasi);

  // Valori consensus (se tutte le fasi concordano) o fallback.
  const curComm = (sharedValue(fasi, 'commissioneId')) ?? '';
  const curScala = (sharedValue(fasi, 'scala')) ?? 10;
  const curTempo = (sharedValue(fasi, 'tempoMinuti')) ?? 0;
  const curModo = (sharedValue(fasi, 'modoValutazione') as string | null | undefined) ?? 'autonoma';
  const curMetodo = (sharedValue(fasi, 'metodoMedia')) ?? 'aritmetica';

  const [toggles, setToggles] = useState<Record<string, boolean>>({});
  const [commValue, setCommValue] = useState('');
  const [scalaValue, setScalaValue] = useState<number | ''>(10);
  const [tempoValue, setTempoValue] = useState<number | ''>(0);
  const [modoValue, setModoValue] = useState<'autonoma' | 'sincrona'>('autonoma');
  const [metodoValue, setMetodoValue] = useState('aritmetica');
  const [criteri, setCriteri] = useState<CriterioFV[]>([]);
  const [criteriLoading, setCriteriLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  // All'apertura: ricarica i valori consensus + i criteri della prima fase
  // (rappresentano la base da propagare quando si attiva il toggle criteri).
  useEffect(() => {
    if (!open) return;
    setToggles({});
    setCommValue(curComm || '');
    setScalaValue(curScala ?? 10);
    setTempoValue(curTempo ?? 0);
    setModoValue(curModo === 'sincrona' ? 'sincrona' : 'autonoma');
    setMetodoValue(curMetodo || 'aritmetica');
    setCriteri(DEFAULT_CRITERI.map((c) => ({ ...c })));
    const base = fasi[0];
    if (base) {
      setCriteriLoading(true);
      listCriteri(base.id)
        .then((rows) => {
          if (rows.length > 0) {
            setCriteri(rows.map((r) => ({ label: r.nome, key: '', peso: r.peso || 0 })));
          }
        })
        .catch(() => { /* caricamento criteri non bloccante */ })
        .finally(() => setCriteriLoading(false));
    }
    // Solo `open`: il reset dei criteri deve avvenire all'apertura del dialog.
    // Aggiungere `fasi` rieseguirebbe l'effetto a ogni refetch della lista,
    // sovrascrivendo le modifiche ai criteri in corso dell'utente.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const totalPeso = criteri.reduce((s, c) => s + (c.peso || 0), 0);
  const updateCriterio = (idx: number, field: keyof CriterioFV, val: string | number) =>
    setCriteri((p) => p.map((c, i) => (i === idx ? { ...c, [field]: val } : c)));
  const addCriterio = () => setCriteri((p) => [...p, { label: '', key: '', peso: 0 }]);
  const removeCriterio = (idx: number) =>
    setCriteri((p) => (p.length > 1 ? p.filter((_, i) => i !== idx) : p));

  const toggle = (key: string) => setToggles((p) => ({ ...p, [key]: !p[key] }));

  const onSubmit = async (e: SyntheticEvent) => {
    e.preventDefault();
    const patch: UpdateFaseBody = {};
    if (toggles.commissioneId) patch.commissioneId = commValue || null;
    if (toggles.scala) patch.scala = Number(scalaValue) || 0;
    if (toggles.tempoMinuti) patch.tempoMinuti = Number(tempoValue) || 0;
    if (toggles.modoValutazione) patch.modoValutazione = modoValue;
    if (toggles.metodoMedia) patch.metodoMedia = metodoValue;

    let criteriPatch: CriterioInput[] | null = null;
    if (toggles.criteri) {
      criteriPatch = criteri
        .map((c, i) => ({ nome: c.label.trim(), peso: Math.max(0, Math.min(100, c.peso || 0)), ordine: i }))
        .filter((c) => c.nome);
      if (criteriPatch.length === 0) {
        toast.error('Almeno un criterio richiesto');
        return;
      }
    }

    if (Object.keys(patch).length === 0 && !criteriPatch) {
      toast.warning('Seleziona almeno un campo da modificare');
      return;
    }

    setSaving(true);
    // Applica a TUTTE le sotto-fasi; allSettled per non perdere update parziali.
    const results = await Promise.allSettled(
      fasi.map(async (f) => {
        if (Object.keys(patch).length > 0) await updateFase(f.id, patch);
        if (criteriPatch) await syncCriteri(f.id, criteriPatch);
      }),
    );
    const ok = results.filter((r) => r.status === 'fulfilled').length;
    const ko = results.filter((r) => r.status === 'rejected');
    if (ko.length === 0) {
      toast.success(`Configurazione propagata a ${ok} sotto-fasi`);
    } else {
      toast.error(`Aggiornate ${ok}/${fasi.length} — ${ko.length} errori`);
    }
    await qc.invalidateQueries({ queryKey: FASI_QUERY_KEY(concorsoId) });
    setSaving(false);
    onSaved();
    onOpenChange(false);
  };

  const fieldWrap = (key: string, label: string, isDrift: boolean, control: ReactNode, help: string) => (
    <div className={cn('border rounded-xl p-3', isDrift ? 'border-amber-200 bg-amber-50/30' : 'border-slate-200 bg-white')}>
      <label className="flex items-start gap-3">
        <input type="checkbox" className="mt-1 w-4 h-4" checked={toggles[key]} onChange={() => toggle(key)} />
        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <span className="font-semibold text-sm text-slate-800">{label}</span>
            {isDrift && (
              <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full bg-amber-100 text-amber-800 border border-amber-200">
                ⚠ diverso tra fasi
              </span>
            )}
          </div>
          <div className="mt-2">{control}</div>
          <p className="text-[11px] text-slate-500 mt-1.5">{help}</p>
        </div>
      </label>
    </div>
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-4xl sm:p-8">
        <DialogHeader>
          <DialogTitle>Configurazione condivisa</DialogTitle>
          <DialogDescription className="sr-only">
            Modifica i campi condivisi e propagali a tutte le sotto-fasi del gruppo.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={onSubmit} className="space-y-4 overflow-y-auto max-h-[76dvh] pr-2">
          <div className="bg-brand-50/60 border border-brand-100 rounded-xl px-4 py-3 text-sm text-slate-700">
            <p>
              Modifica i campi che vuoi applicare a tutte le {fasi.length} sotto-fasi di questo gruppo. I campi senza
              spunta restano invariati su ogni sotto-fase.
            </p>
          </div>

          {fieldWrap(
            'commissioneId',
            'Commissione',
            drift.includes('commissioneId'),
            <select className="c-input w-full" value={commValue} onChange={(e) => setCommValue(e.target.value)}>
              <option value="">— Nessuna —</option>
              {commissioni?.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.nome} · {c.commissari.length} comm.
                </option>
              ))}
            </select>,
            drift.includes('commissioneId')
              ? 'Attiva la spunta e imposta il nuovo valore: verrà propagato a tutte le sotto-fasi, sovrascrivendo le differenze attuali.'
              : 'Attiva la spunta per modificare questo campo su tutte le sotto-fasi.',
          )}

          {fieldWrap(
            'scala',
            'Scala di voto',
            drift.includes('scala'),
            <input
              type="number"
              className="c-input w-full"
              min={1}
              max={100}
              value={scalaValue}
              onChange={(e) => setScalaValue(e.target.value === '' ? '' : Number(e.target.value))}
            />,
            drift.includes('scala')
              ? 'Attiva la spunta e imposta il nuovo valore: verrà propagato a tutte le sotto-fasi, sovrascrivendo le differenze attuali.'
              : 'Attiva la spunta per modificare questo campo su tutte le sotto-fasi.',
          )}

          {fieldWrap(
            'tempoMinuti',
            'Tempo per candidato (min)',
            drift.includes('tempoMinuti'),
            <input
              type="number"
              className="c-input w-full"
              min={0}
              max={600}
              value={tempoValue}
              onChange={(e) => setTempoValue(e.target.value === '' ? '' : Number(e.target.value))}
            />,
            drift.includes('tempoMinuti')
              ? 'Attiva la spunta e imposta il nuovo valore: verrà propagato a tutte le sotto-fasi, sovrascrivendo le differenze attuali.'
              : 'Attiva la spunta per modificare questo campo su tutte le sotto-fasi.',
          )}

          {fieldWrap(
            'modoValutazione',
            'Modalità di valutazione',
            drift.includes('modoValutazione'),
            <select
              className="c-input w-full"
              value={modoValue}
              onChange={(e) => setModoValue(e.target.value === 'sincrona' ? 'sincrona' : 'autonoma')}
            >
              <option value="autonoma">Autonoma</option>
              <option value="sincrona">Sincrona</option>
            </select>,
            drift.includes('modoValutazione')
              ? 'Attiva la spunta e imposta il nuovo valore: verrà propagato a tutte le sotto-fasi, sovrascrivendo le differenze attuali.'
              : 'Attiva la spunta per modificare questo campo su tutte le sotto-fasi.',
          )}

          {fieldWrap(
            'metodoMedia',
            'Metodo di media',
            drift.includes('metodoMedia'),
            <select className="c-input w-full" value={metodoValue} onChange={(e) => setMetodoValue(e.target.value)}>
              {Object.entries(METODI_MEDIA).map(([k, m]) => (
                <option key={k} value={k}>
                  {m.nome}
                </option>
              ))}
            </select>,
            drift.includes('metodoMedia')
              ? 'Attiva la spunta e imposta il nuovo valore: verrà propagato a tutte le sotto-fasi, sovrascrivendo le differenze attuali.'
              : 'Attiva la spunta per modificare questo campo su tutte le sotto-fasi.',
          )}

          {/* Criteri: blocco dedicato con editor pesi (toggle key="criteri") */}
          <div
            className={cn(
              'border rounded-xl p-3',
              drift.includes('pesi') ? 'border-amber-200 bg-amber-50/30' : 'border-slate-200 bg-white',
            )}
          >
            <label className="flex items-start gap-3">
              <input
                type="checkbox"
                className="mt-1 w-4 h-4"
                checked={toggles.criteri}
                onChange={() => toggle('criteri')}
              />
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <span className="font-semibold text-sm text-slate-800">Criteri di valutazione</span>
                  {drift.includes('pesi') && (
                    <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full bg-amber-100 text-amber-800 border border-amber-200">
                      ⚠ diverso tra fasi
                    </span>
                  )}
                  <span className="text-xs font-mono text-slate-600 ml-auto">
                    Tot:{' '}
                    <span className={cn('font-bold', totalPeso === 100 ? 'text-emerald-600' : 'text-amber-600')}>
                      {totalPeso}%
                    </span>
                  </span>
                </div>
                <p className="text-[11px] text-slate-500 mt-1.5 mb-2">
                  Attiva la spunta per propagare la stessa lista di criteri/pesi a tutte le sotto-fasi.
                </p>
                {criteriLoading ? (
                  <p className="text-xs text-slate-400 italic">Caricamento criteri…</p>
                ) : (
                  <div className="space-y-2">
                    {criteri.map((c, i) => (
                      <div key={i} className="grid grid-cols-12 gap-2 items-end">
                        <label className="col-span-8 c-field">
                          {i === 0 && <span className="c-field__label">Etichetta</span>}
                          <input
                            type="text"
                            className="c-input"
                            value={c.label}
                            onChange={(e) => updateCriterio(i, 'label', e.target.value)}
                            placeholder="Tecnica"
                          />
                        </label>
                        <label className="col-span-3 c-field">
                          {i === 0 && <span className="c-field__label">Peso (%)</span>}
                          <input
                            type="number"
                            step={1}
                            min={0}
                            max={100}
                            className="c-input"
                            value={c.peso}
                            onChange={(e) => updateCriterio(i, 'peso', Number(e.target.value))}
                          />
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
                    <button
                      type="button"
                      onClick={addCriterio}
                      className="text-xs font-medium text-brand-700 hover:text-brand-900 inline-flex items-center gap-1"
                    >
                      + Aggiungi criterio
                    </button>
                  </div>
                )}
              </div>
            </label>
          </div>

          <DialogFooter>
            <button type="button" className="c-btn c-btn--outline" onClick={() => onOpenChange(false)} disabled={saving}>
              Annulla
            </button>
            <button type="submit" className="c-btn c-btn--primary" disabled={saving}>
              {saving ? 'Applicazione…' : 'Applica alle sotto-fasi'}
            </button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
