import React, { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { X } from 'lucide-react';
import { toast } from 'sonner';
import { httpErrorMessage } from '@/lib/api';
import { platformApi, type Tenant, type TenantPiano, TENANT_PLANS } from '@/api/platform';
import { PIANI } from '@/lib/piani';
import { usePiani } from '@/hooks/usePiani';

export function EditMetaDialog({ t, onClose, onSaved }: { t: Tenant; onClose: () => void; onSaved: () => void }) {
  const { piani, pianiMap } = usePiani();
  // Piani dal catalogo dinamico (attivi); fallback alla lista statica se vuoto.
  const planKeys = piani.length ? piani.filter((p) => p.attivo).map((p) => p.key) : [...TENANT_PLANS];
  const [nome, setNome] = useState(t.nome);
  const [piano, setPiano] = useState<TenantPiano>(t.piano);
  const [pianoScadenza, setPianoScadenza] = useState(t.pianoScadenza ?? '');
  const [dominio, setDominio] = useState(t.dominio ?? '');
  const [cleanupDays, setCleanupDays] = useState(t.cleanupAfterDays);
  const [require2fa, setRequire2fa] = useState(t.require2faAdmin);
  const [note, setNote] = useState(t.note ?? '');

  const mut = useMutation({
    mutationFn: () => platformApi.updateTenant(t.id, {
      nome, piano, pianoScadenza: pianoScadenza || null,
      dominio: dominio.trim() || null, cleanupAfterDays: cleanupDays,
      require2faAdmin: require2fa, note: note.trim() || null,
    }),
    onSuccess: () => { toast.success('Modifiche salvate'); onSaved(); },
    onError: (err) => toast.error(httpErrorMessage(err)),
  });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-slate-900/40" onClick={onClose} />
      <div className="relative bg-white border border-slate-200 rounded-xl shadow-xl w-full max-w-lg max-h-[90vh] flex flex-col">
        <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between">
          <h2 className="text-base font-semibold text-ink-900">Modifica {t.nome}</h2>
          <button className="p-1.5 rounded-md hover:bg-slate-100 text-ink-700" onClick={onClose}><X className="w-4 h-4" /></button>
        </div>
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-3">
          <div>
            <label className="text-sm font-medium text-ink-900">Nome ente</label>
            <input className="c-input mt-1" value={nome} onChange={(e) => setNome(e.target.value)} />
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            <div>
              <label className="text-sm font-medium text-ink-900">Piano</label>
              <select
                className="c-input mt-1"
                value={piano}
                onChange={(e) => setPiano(e.target.value as TenantPiano)}
              >
                {planKeys.map((k) => <option key={k} value={k}>{(pianiMap[k] ?? PIANI.trial).nome}</option>)}
              </select>
            </div>
            <div>
              <label className="text-sm font-medium text-ink-900">Scadenza piano</label>
              <input type="date" className="c-input mt-1" value={pianoScadenza} onChange={(e) => setPianoScadenza(e.target.value)} />
            </div>
          </div>
          <div>
            <label className="text-sm font-medium text-ink-900">Dominio custom</label>
            <input className="c-input mt-1" value={dominio} onChange={(e) => setDominio(e.target.value)} placeholder="es. ente1.gestimus.it" />
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            <div>
              <label className="text-sm font-medium text-ink-900">Cleanup days (0 = mai)</label>
              <input type="number" className="c-input mt-1" min={0} max={3650} value={cleanupDays} onChange={(e) => setCleanupDays(Number(e.target.value))} />
            </div>
            <div>
              <label className="text-sm font-medium block text-ink-900">2FA admin</label>
              <label className="inline-flex items-center gap-2 mt-2">
                <input type="checkbox" checked={require2fa} onChange={(e) => setRequire2fa(e.target.checked)} />
                <span className="text-sm">Richiesto per gli admin</span>
              </label>
            </div>
          </div>
          <div>
            <label className="text-sm font-medium text-ink-900">Note</label>
            <textarea className="c-input mt-1" rows={3} value={note} onChange={(e) => setNote(e.target.value)} />
          </div>
        </div>
        <div className="px-5 py-3 border-t border-slate-200 bg-slate-50 flex justify-end gap-2">
          <button className="c-btn c-btn--ghost c-btn--sm" onClick={onClose}>Annulla</button>
          <button className="c-btn c-btn--primary c-btn--sm" onClick={() => mut.mutate()} disabled={mut.isPending}>
            {mut.isPending ? 'Salvataggio…' : 'Salva'}
          </button>
        </div>
      </div>
    </div>
  );
}
