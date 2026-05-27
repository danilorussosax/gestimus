/**
 * PianoFormDialog — crea/modifica un piano d'acquisto (CRUD super-admin).
 *
 * Stile coerente con EditMetaDialog/ChangePlanDialog (overlay + c-input/c-btn).
 * Italiano hard-coded come il resto del super-admin (niente i18n).
 */
import React, { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { X } from 'lucide-react';
import { toast } from 'sonner';
import { httpErrorMessage } from '@/lib/api';
import {
  platformApi,
  type Piano,
  type CreatePianoBody,
} from '@/api/platform';

const BADGE_COLORS = ['sky', 'emerald', 'brand', 'amber', 'slate'] as const;

// Stato del form: numeri/nullable gestiti come stringa per gli input controllati.
interface FormState {
  key: string;
  nome: string;
  descrizione: string;
  prezzo: string;
  durataGiorni: string;
  limitConcorsi: string;
  limitCommissari: string;
  limitCandidatiPerConcorso: string;
  limitIscrittiAnnui: string;
  badgeColor: string;
  isPpe: boolean;
  ppeSetupPerConcorso: string;
  ppePerIscritto: string;
  featured: boolean;
  attivo: boolean;
  ordine: string;
}

function initialState(piano: Piano | null): FormState {
  const n = (v: number | null): string => (v == null ? '' : String(v));
  return {
    key: piano?.key ?? '',
    nome: piano?.nome ?? '',
    descrizione: piano?.descrizione ?? '',
    prezzo: piano ? String(piano.prezzo) : '0',
    durataGiorni: n(piano?.durataGiorni ?? null),
    limitConcorsi: n(piano?.limitConcorsi ?? null),
    limitCommissari: n(piano?.limitCommissari ?? null),
    limitCandidatiPerConcorso: n(piano?.limitCandidatiPerConcorso ?? null),
    limitIscrittiAnnui: n(piano?.limitIscrittiAnnui ?? null),
    badgeColor: piano?.badgeColor ?? 'slate',
    isPpe: piano?.isPpe ?? false,
    ppeSetupPerConcorso: n(piano?.ppeSetupPerConcorso ?? null),
    ppePerIscritto: n(piano?.ppePerIscritto ?? null),
    featured: piano?.featured ?? false,
    attivo: piano?.attivo ?? true,
    ordine: n(piano?.ordine ?? null),
  };
}

export function PianoFormDialog({
  piano,
  onClose,
  onSaved,
}: {
  /** null = creazione, valorizzato = modifica. */
  piano: Piano | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const isEdit = piano != null;
  const [f, setF] = useState<FormState>(() => initialState(piano));
  const set = <K extends keyof FormState>(k: K, v: FormState[K]) =>
    setF((s) => ({ ...s, [k]: v }));

  const numOrNull = (v: string): number | null => (v.trim() === '' ? null : Number(v));

  const mut = useMutation({
    mutationFn: () => {
      const body: CreatePianoBody = {
        key: f.key.trim(),
        nome: f.nome.trim(),
        descrizione: f.descrizione.trim(),
        prezzo: Number(f.prezzo) || 0,
        durataGiorni: numOrNull(f.durataGiorni),
        limitConcorsi: numOrNull(f.limitConcorsi),
        limitCommissari: numOrNull(f.limitCommissari),
        limitCandidatiPerConcorso: numOrNull(f.limitCandidatiPerConcorso),
        limitIscrittiAnnui: numOrNull(f.limitIscrittiAnnui),
        badgeColor: f.badgeColor,
        isPpe: f.isPpe,
        ppeSetupPerConcorso: f.isPpe ? numOrNull(f.ppeSetupPerConcorso) : null,
        ppePerIscritto: f.isPpe ? numOrNull(f.ppePerIscritto) : null,
        featured: f.featured,
        attivo: f.attivo,
        ordine: numOrNull(f.ordine),
      };
      if (isEdit) {
        // La key non si modifica.
        const { key: _key, ...rest } = body;
        return platformApi.updatePiano(piano.key, rest);
      }
      return platformApi.createPiano(body);
    },
    onSuccess: () => {
      toast.success(isEdit ? 'Piano aggiornato' : 'Piano creato');
      onSaved();
    },
    onError: (err) => toast.error(httpErrorMessage(err)),
  });

  const canSave = f.key.trim() !== '' && f.nome.trim() !== '' && !mut.isPending;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-slate-900/40" onClick={onClose} />
      <div className="relative bg-white border border-slate-200 rounded-xl shadow-xl w-full max-w-2xl max-h-[90vh] flex flex-col">
        <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between">
          <h2 className="text-base font-semibold text-ink-900">
            {isEdit ? `Modifica piano — ${piano.nome}` : 'Nuovo piano'}
          </h2>
          <button className="p-1.5 rounded-md hover:bg-slate-100 text-ink-700" onClick={onClose}>
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
          {/* Identità */}
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className="text-sm font-medium text-ink-900">Key (slug)</label>
              <input
                className="c-input mt-1 font-mono"
                value={f.key}
                disabled={isEdit}
                placeholder="es. pro"
                onChange={(e) => set('key', e.target.value)}
              />
              {isEdit && <p className="text-[11px] text-ink-500 mt-1">La key non è modificabile.</p>}
            </div>
            <div>
              <label className="text-sm font-medium text-ink-900">Nome</label>
              <input className="c-input mt-1" value={f.nome} onChange={(e) => set('nome', e.target.value)} />
            </div>
          </div>

          <div>
            <label className="text-sm font-medium text-ink-900">Descrizione</label>
            <textarea
              className="c-input mt-1"
              rows={2}
              value={f.descrizione}
              onChange={(e) => set('descrizione', e.target.value)}
            />
          </div>

          {/* Prezzo + durata */}
          <div className="grid gap-3 sm:grid-cols-3">
            <div>
              <label className="text-sm font-medium text-ink-900">Prezzo (€/anno)</label>
              <input
                type="number"
                min={0}
                className="c-input mt-1"
                value={f.prezzo}
                onChange={(e) => set('prezzo', e.target.value)}
              />
            </div>
            <div>
              <label className="text-sm font-medium text-ink-900">Durata (giorni)</label>
              <input
                type="number"
                min={0}
                className="c-input mt-1"
                placeholder="vuoto = no scadenza"
                value={f.durataGiorni}
                onChange={(e) => set('durataGiorni', e.target.value)}
              />
            </div>
            <div>
              <label className="text-sm font-medium text-ink-900">Ordine</label>
              <input
                type="number"
                className="c-input mt-1"
                placeholder="auto"
                value={f.ordine}
                onChange={(e) => set('ordine', e.target.value)}
              />
            </div>
          </div>

          {/* Limiti (vuoto = illimitato) */}
          <div>
            <p className="text-[11px] uppercase tracking-wide font-semibold text-ink-500 mb-2">
              Limiti (vuoto = illimitato)
            </p>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <div>
                <label className="text-xs font-medium text-ink-900">Concorsi</label>
                <input type="number" min={0} className="c-input c-input--sm mt-1" placeholder="∞" value={f.limitConcorsi} onChange={(e) => set('limitConcorsi', e.target.value)} />
              </div>
              <div>
                <label className="text-xs font-medium text-ink-900">Commissari</label>
                <input type="number" min={0} className="c-input c-input--sm mt-1" placeholder="∞" value={f.limitCommissari} onChange={(e) => set('limitCommissari', e.target.value)} />
              </div>
              <div>
                <label className="text-xs font-medium text-ink-900">Candidati/concorso</label>
                <input type="number" min={0} className="c-input c-input--sm mt-1" placeholder="∞" value={f.limitCandidatiPerConcorso} onChange={(e) => set('limitCandidatiPerConcorso', e.target.value)} />
              </div>
              <div>
                <label className="text-xs font-medium text-ink-900">Iscritti/anno</label>
                <input type="number" min={0} className="c-input c-input--sm mt-1" placeholder="∞" value={f.limitIscrittiAnnui} onChange={(e) => set('limitIscrittiAnnui', e.target.value)} />
              </div>
            </div>
          </div>

          {/* Badge color */}
          <div>
            <label className="text-sm font-medium text-ink-900">Colore badge</label>
            <select className="c-input mt-1" value={f.badgeColor} onChange={(e) => set('badgeColor', e.target.value)}>
              {BADGE_COLORS.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>

          {/* PPE */}
          <div className="border border-slate-200 rounded-lg p-3 space-y-3">
            <label className="inline-flex items-center gap-2 text-sm font-medium text-ink-900">
              <input type="checkbox" checked={f.isPpe} onChange={(e) => set('isPpe', e.target.checked)} />
              <span>Piano Pay-per-Event (PPE)</span>
            </label>
            {f.isPpe && (
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <label className="text-xs font-medium text-ink-900">Setup per concorso (€)</label>
                  <input type="number" min={0} className="c-input c-input--sm mt-1" value={f.ppeSetupPerConcorso} onChange={(e) => set('ppeSetupPerConcorso', e.target.value)} />
                </div>
                <div>
                  <label className="text-xs font-medium text-ink-900">Per iscritto (€)</label>
                  <input type="number" min={0} step="0.01" className="c-input c-input--sm mt-1" value={f.ppePerIscritto} onChange={(e) => set('ppePerIscritto', e.target.value)} />
                </div>
              </div>
            )}
          </div>

          {/* Flag */}
          <div className="flex flex-wrap gap-5">
            <label className="inline-flex items-center gap-2 text-sm font-medium text-ink-900">
              <input type="checkbox" checked={f.attivo} onChange={(e) => set('attivo', e.target.checked)} />
              <span>Attivo</span>
            </label>
            <label className="inline-flex items-center gap-2 text-sm font-medium text-ink-900">
              <input type="checkbox" checked={f.featured} onChange={(e) => set('featured', e.target.checked)} />
              <span>In evidenza (consigliato)</span>
            </label>
          </div>
        </div>

        <div className="px-5 py-3 border-t border-slate-200 bg-slate-50 flex justify-end gap-2">
          <button className="c-btn c-btn--ghost c-btn--sm" onClick={onClose}>Annulla</button>
          <button className="c-btn c-btn--primary c-btn--sm" onClick={() => mut.mutate()} disabled={!canSave}>
            {mut.isPending ? 'Salvataggio…' : isEdit ? 'Salva modifiche' : 'Crea piano'}
          </button>
        </div>
      </div>
    </div>
  );
}
