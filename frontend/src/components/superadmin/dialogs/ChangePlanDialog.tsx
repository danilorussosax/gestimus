import React, { useEffect, useState } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { X } from 'lucide-react';
import { toast } from 'sonner';
import { httpErrorMessage } from '@/lib/api';
import { platformApi, type Tenant, type TenantPiano, type ChangePlanBody, TENANT_PLANS } from '@/api/platform';
import { PIANI, pianoPriceLabel, pianoDurataLabel } from '@/lib/piani';
import { fmtDate } from '@/components/superadmin/format';
import { PianoBadge } from '@/components/superadmin/ui';

export function ChangePlanDialog({ t, onClose, onSaved }: { t: Tenant; onClose: () => void; onSaved: () => void }) {
  const [piano, setPiano] = useState<TenantPiano>(t.piano);
  const [pianoScadenza, setPianoScadenza] = useState(t.pianoScadenza ?? '');
  const [maxConcorsi, setMaxConcorsi] = useState('');
  const [maxCommissari, setMaxCommissari] = useState('');
  const [maxCandidati, setMaxCandidati] = useState('');

  const configQ = useQuery({
    queryKey: ['platform', 'config', t.id],
    queryFn: () => platformApi.getTenantConfig(t.id),
  });
  useEffect(() => {
    const cfg = configQ.data;
    if (cfg) {
      setMaxConcorsi(cfg.maxConcorsi != null ? String(cfg.maxConcorsi) : '');
      setMaxCommissari(cfg.maxCommissari != null ? String(cfg.maxCommissari) : '');
      setMaxCandidati(cfg.maxCandidatiPerConcorso != null ? String(cfg.maxCandidatiPerConcorso) : '');
    }
  }, [configQ.data]);

  const parseOpt = (v: string): number | null => v.trim() === '' ? null : Number(v);

  const selectedPiano = PIANI[piano] ?? PIANI.trial;
  const changed = piano !== t.piano;

  const mut = useMutation({
    mutationFn: () => {
      const body: ChangePlanBody = {
        piano, pianoScadenza: pianoScadenza || null,
        overrides: {
          maxConcorsi: parseOpt(maxConcorsi),
          maxCommissari: parseOpt(maxCommissari),
          maxCandidatiPerConcorso: parseOpt(maxCandidati),
        },
      };
      return platformApi.changePlan(t.id, body);
    },
    onSuccess: () => { toast.success(`Piano aggiornato: ${piano}`); onSaved(); },
    onError: (err) => toast.error(httpErrorMessage(err)),
  });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-slate-900/40" onClick={onClose} />
      <div className="relative bg-white border border-slate-200 rounded-xl shadow-xl w-full max-w-lg max-h-[90vh] flex flex-col">
        <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between">
          <h2 className="text-base font-semibold text-ink-900">Cambia piano — {t.nome}</h2>
          <button className="p-1.5 rounded-md hover:bg-slate-100 text-ink-700" onClick={onClose}><X className="w-4 h-4" /></button>
        </div>
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-5">
          {/* Piano attuale */}
          <section className="bg-slate-50 border border-slate-200 rounded-lg p-4">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-[11px] uppercase tracking-wide font-semibold text-ink-500">Piano attualmente attivo</h3>
              <PianoBadge piano={t.piano} />
            </div>
            <div className="grid sm:grid-cols-2 gap-3 text-sm">
              <div><span className="text-ink-700">Scadenza:</span> <strong>{t.pianoScadenza ? fmtDate(t.pianoScadenza) : <em className="font-normal text-ink-500">non impostata</em>}</strong></div>
              <div><span className="text-ink-700">Limite concorsi:</span> <strong>{(PIANI[t.piano]?.limit_concorsi ?? null) == null ? <em className="font-normal text-ink-500">illimitato</em> : PIANI[t.piano].limit_concorsi}</strong></div>
            </div>
          </section>

          {/* Nuovo piano */}
          <section>
            <h3 className="text-[11px] uppercase tracking-wide font-semibold text-ink-500 mb-2">Nuovo piano</h3>
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <label className="text-sm font-medium block mb-1">Piano</label>
                <select className="c-input" value={piano} onChange={(e) => setPiano(e.target.value as TenantPiano)}>
                  {TENANT_PLANS.map((k) => <option key={k} value={k}>{PIANI[k].nome}{k === t.piano ? ' (attuale)' : ''}</option>)}
                </select>
              </div>
              <div>
                <label className="text-sm font-medium block mb-1">Scadenza piano</label>
                <input type="date" className="c-input" value={pianoScadenza} onChange={(e) => setPianoScadenza(e.target.value)} />
                <p className="text-xs text-ink-500 mt-1">Lascia vuoto se non scade.</p>
              </div>
            </div>
            <div className="mt-3 bg-brand-50 border border-brand-100 rounded-lg p-3 text-sm">
              <div className="flex items-center gap-2 mb-1">
                <strong className="text-ink-900">{selectedPiano.nome}</strong>
                <span className="text-ink-700">·</span>
                <span className="text-ink-700">{pianoPriceLabel(piano)}</span>
                {changed
                  ? <span className="ml-auto text-xs text-emerald-700 font-medium">↑ cambio</span>
                  : <span className="ml-auto text-xs text-ink-500">nessun cambio</span>}
              </div>
              <p className="text-xs text-ink-600 mb-1">{selectedPiano.descrizione}</p>
              <p className="text-[11px] text-ink-500">Durata: {pianoDurataLabel(piano)}</p>
              <ul className="text-xs text-ink-900 grid sm:grid-cols-2 gap-1 mt-2">
                <li>Concorsi: <strong>{selectedPiano.limit_concorsi ?? <em className="font-normal">illimitato</em>}</strong></li>
                <li>Iscrizioni/anno: <strong>{selectedPiano.limit_iscritti_annui ?? <em className="font-normal">illimitato</em>}</strong></li>
              </ul>
            </div>
          </section>

          {/* Override limiti */}
          <section>
            <h3 className="text-[11px] uppercase tracking-wide font-semibold text-ink-500 mb-2">Override limiti per-tenant (opzionale)</h3>
            <p className="text-xs text-ink-700 mb-3">Imposta un override solo se vuoi forzare un limite diverso da quello di default del piano. Lascia vuoto per ereditare il piano.</p>
            <div className="grid gap-3 sm:grid-cols-3">
              <div>
                <label className="text-xs font-medium block mb-1">maxConcorsi</label>
                <input type="number" min={0} className="c-input c-input--sm" placeholder="usa piano" value={maxConcorsi} onChange={(e) => setMaxConcorsi(e.target.value)} />
              </div>
              <div>
                <label className="text-xs font-medium block mb-1">maxCommissari</label>
                <input type="number" min={0} className="c-input c-input--sm" placeholder="usa piano" value={maxCommissari} onChange={(e) => setMaxCommissari(e.target.value)} />
              </div>
              <div>
                <label className="text-xs font-medium block mb-1">maxCandidatiPerConcorso</label>
                <input type="number" min={0} className="c-input c-input--sm" placeholder="usa piano" value={maxCandidati} onChange={(e) => setMaxCandidati(e.target.value)} />
              </div>
            </div>
          </section>
        </div>
        <div className="px-5 py-3 border-t border-slate-200 bg-slate-50 flex justify-end gap-2">
          <button className="c-btn c-btn--ghost c-btn--sm" onClick={onClose}>Annulla</button>
          <button className="c-btn c-btn--primary c-btn--sm" onClick={() => mut.mutate()} disabled={mut.isPending}>
            {mut.isPending ? 'Salvataggio…' : 'Conferma cambio piano'}
          </button>
        </div>
      </div>
    </div>
  );
}
