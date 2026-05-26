import React, { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { Trash2, X } from 'lucide-react';
import { toast } from 'sonner';
import { httpErrorMessage } from '@/lib/api';
import { platformApi, type Tenant, type TenantSmtp } from '@/api/platform';

export function SmtpDialog({ t, smtp, onClose, onSaved }: { t: Tenant; smtp?: TenantSmtp; onClose: () => void; onSaved: () => void }) {
  const [host, setHost] = useState('');
  const [port, setPort] = useState(587);
  const [user, setUser] = useState('');
  const [pass, setPass] = useState('');
  const [from, setFrom] = useState('');
  const [secure, setSecure] = useState(false);

  const saveMut = useMutation({
    mutationFn: () => platformApi.setTenantSmtp(t.id, { host, port, user, password: pass, from, secure }),
    onSuccess: () => { toast.success('SMTP salvato'); onSaved(); },
    onError: (err) => toast.error(httpErrorMessage(err)),
  });

  const delMut = useMutation({
    mutationFn: () => platformApi.deleteTenantSmtp(t.id),
    onSuccess: () => { toast.success('SMTP rimosso'); onSaved(); },
    onError: (err) => toast.error(httpErrorMessage(err)),
  });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-slate-900/40" onClick={onClose} />
      <div className="relative bg-white border border-slate-200 rounded-xl shadow-xl w-full max-w-md flex flex-col">
        <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between">
          <h2 className="text-base font-semibold text-ink-900">SMTP — {t.nome}</h2>
          <button className="p-1.5 rounded-md hover:bg-slate-100 text-ink-700" onClick={onClose}><X className="w-4 h-4" /></button>
        </div>
        <div className="px-5 py-4 space-y-3">
          <p className="text-sm text-ink-700">
            Stato: <strong>{smtp?.configured ? `configurato${smtp.encrypted ? ' (cifrato)' : ''}` : 'non configurato'}</strong>. La password è cifrata AES-GCM at-rest.
          </p>
          <div className="grid gap-2 sm:grid-cols-2">
            <div>
              <label className="text-sm font-medium">Host</label>
              <input className="c-input mt-0.5" placeholder="smtp.example.com" value={host} onChange={(e) => setHost(e.target.value)} />
            </div>
            <div>
              <label className="text-sm font-medium">Port</label>
              <input type="number" className="c-input mt-0.5" value={port} onChange={(e) => setPort(Number(e.target.value))} />
            </div>
          </div>
          <div><label className="text-sm font-medium">User</label><input className="c-input mt-0.5" value={user} onChange={(e) => setUser(e.target.value)} /></div>
          <div><label className="text-sm font-medium">Password</label><input type="password" className="c-input mt-0.5" value={pass} onChange={(e) => setPass(e.target.value)} /></div>
          <div>
            <label className="text-sm font-medium">From</label>
            <input className="c-input mt-0.5" placeholder='"Gestimus" <noreply@ente.it>' value={from} onChange={(e) => setFrom(e.target.value)} />
          </div>
          <label className="inline-flex items-center gap-2 text-sm mt-1">
            <input type="checkbox" checked={secure} onChange={(e) => setSecure(e.target.checked)} />
            <span>Connessione SSL/TLS implicita (porta 465)</span>
          </label>
          {smtp?.configured && (
            <div className="pt-2 border-t border-slate-200">
              <button
                className="c-btn c-btn--ghost c-btn--sm text-rose-700"
                onClick={() => { if (window.confirm(`Rimuovere la configurazione SMTP di ${t.nome}?`)) delMut.mutate(); }}
              >
                <Trash2 className="w-3.5 h-3.5" /><span>Rimuovi configurazione attuale</span>
              </button>
            </div>
          )}
        </div>
        <div className="px-5 py-3 border-t border-slate-200 bg-slate-50 flex justify-end gap-2">
          <button className="c-btn c-btn--ghost c-btn--sm" onClick={onClose}>Annulla</button>
          <button
            className="c-btn c-btn--primary c-btn--sm"
            onClick={() => saveMut.mutate()}
            disabled={saveMut.isPending || !host || !user || !pass || !from}
          >
            {saveMut.isPending ? 'Salvataggio…' : 'Salva'}
          </button>
        </div>
      </div>
    </div>
  );
}
