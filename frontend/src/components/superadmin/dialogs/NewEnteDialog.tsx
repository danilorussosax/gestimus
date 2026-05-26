import React, { useEffect, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { Download, Eye, RefreshCw, X } from 'lucide-react';
import { toast } from 'sonner';
import { httpErrorMessage } from '@/lib/api';
import { platformApi, type TenantPiano, TENANT_PLANS } from '@/api/platform';
import { PIANI, pianoPriceLabel } from '@/lib/piani';
import { genPassword, kebabize, passwordScore } from '@/components/superadmin/format';

export function NewEnteDialog({ existingSlugs, onClose, onCreated }: {
  existingSlugs: string[];
  onClose: () => void;
  onCreated: () => void;
}) {
  const [nome, setNome] = useState('');
  const [slug, setSlug] = useState('');
  const [slugTouched, setSlugTouched] = useState(false);
  const [piano, setPiano] = useState<TenantPiano>('trial');
  const [pianoScadenza, setPianoScadenza] = useState('');
  const [cleanupDays, setCleanupDays] = useState(30);
  const [adminEmail, setAdminEmail] = useState('');
  const [adminPass, setAdminPass] = useState(genPassword);
  const [showPass, setShowPass] = useState(true);
  const reserved = new Set([...existingSlugs.map((s) => s.toLowerCase()), 'platform']);

  const slugErr = (() => {
    if (!slug) return '';
    if (slug.length < 2 || slug.length > 63) return `Lunghezza fuori range (${slug.length})`;
    if (!/^[a-z0-9][a-z0-9-]*[a-z0-9]$/.test(slug)) return 'Solo a-z, 0-9 e trattino.';
    if (reserved.has(slug)) return `Slug "${slug}" già in uso o riservato`;
    return '';
  })();

  useEffect(() => {
    if (!slugTouched) setSlug(kebabize(nome));
  }, [nome, slugTouched]);

  const score = passwordScore(adminPass);
  const scoreCls = ['', 'bg-rose-500', 'bg-amber-500', 'bg-emerald-500', 'bg-emerald-600'][score];
  const scoreLabel = ['', 'Debole', 'Media', 'Buona', 'Forte'][score];

  const createMut = useMutation({
    mutationFn: () => platformApi.createTenant({
      slug, nome, piano, pianoScadenza: pianoScadenza || null, cleanupAfterDays: cleanupDays,
      adminEmail, adminPassword: adminPass,
    }),
    onSuccess: () => { toast.success(`Ente "${slug}" creato. Comunica le credenziali in modo sicuro.`); onCreated(); },
    onError: (err) => toast.error(httpErrorMessage(err)),
  });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-slate-900/40" onClick={onClose} />
      <div className="relative bg-white border border-slate-200 rounded-xl shadow-xl w-full max-w-2xl max-h-[90vh] flex flex-col">
        <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between">
          <h2 className="text-base font-semibold text-ink-900">Nuovo ente</h2>
          <button className="p-1.5 rounded-md hover:bg-slate-100 text-ink-700" onClick={onClose}><X className="w-4 h-4" /></button>
        </div>
        <div className="flex-1 overflow-y-auto px-5 py-5 space-y-5">
          {/* Step 1: Identificazione */}
          <section>
            <header className="flex items-center gap-2 mb-3">
              <span className="w-6 h-6 inline-flex items-center justify-center rounded-full bg-brand-600 text-white text-xs font-bold">1</span>
              <h3 className="text-sm font-semibold text-ink-900">Identificazione</h3>
            </header>
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <label className="text-sm font-medium block mb-1">
                  Nome ente <span className="text-rose-600">*</span>
                </label>
                <input
                  className="c-input"
                  placeholder="es. Conservatorio Verdi"
                  autoComplete="off"
                  value={nome}
                  onChange={(e) => setNome(e.target.value)}
                />
                <p className="text-xs text-ink-500 mt-1">Visibile agli utenti del tenant.</p>
              </div>
              <div>
                <label className="text-sm font-medium block mb-1">
                  Slug <span className="text-rose-600">*</span>
                </label>
                <input
                  className="c-input font-mono text-sm"
                  placeholder="conservatorio-verdi"
                  autoComplete="off"
                  value={slug}
                  onChange={(e) => { setSlugTouched(true); setSlug(e.target.value.toLowerCase()); }}
                />
                {slugErr
                  ? <p className="text-xs text-rose-700 mt-1">{slugErr}</p>
                  : slug
                    ? <p className="text-xs text-brand-700 mt-1 font-mono">→ {slug}.gestimus.local:4000</p>
                    : <p className="text-xs text-ink-500 mt-1">2-63 caratteri, kebab-case (a-z, 0-9, trattino).</p>}
              </div>
            </div>
          </section>

          {/* Step 2: Piano */}
          <section>
            <header className="flex items-center gap-2 mb-3">
              <span className="w-6 h-6 inline-flex items-center justify-center rounded-full bg-brand-600 text-white text-xs font-bold">2</span>
              <h3 className="text-sm font-semibold text-ink-900">Piano</h3>
              <span className="text-xs text-ink-500">— modificabile in seguito da "Cambia piano"</span>
            </header>
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {TENANT_PLANS.map((k) => (
                <label
                  key={k}
                  className={`cursor-pointer block border-2 rounded-lg p-3 transition-colors${piano === k ? ' border-brand-500 bg-brand-50' : ' border-slate-200 hover:border-slate-300'}`}
                  onClick={() => setPiano(k)}
                >
                  <input type="radio" name="ne-piano" value={k} checked={piano === k} onChange={() => setPiano(k)} className="sr-only" />
                  <div className="flex items-baseline justify-between mb-1">
                    <span className="font-semibold text-ink-900">
                      {PIANI[k].nome}
                      {PIANI[k].featured && (
                        <span className="ml-1.5 text-[10px] font-bold uppercase tracking-wide text-brand-700 bg-brand-100 rounded px-1.5 py-0.5">consigliato</span>
                      )}
                    </span>
                    <span className="text-xs text-ink-700">{pianoPriceLabel(k)}</span>
                  </div>
                  <p className="text-[11px] text-ink-600 leading-snug">{PIANI[k].descrizione}</p>
                  <div className="mt-1 text-[11px] text-ink-500 flex gap-3">
                    <span>📊 {PIANI[k].limit_concorsi ?? '∞'} concorsi</span>
                    <span>👥 {PIANI[k].limit_iscritti_annui ?? '∞'} iscr/anno</span>
                  </div>
                  {piano === k && (
                    <div className="mt-2 pt-2 border-t border-slate-200 text-xs text-emerald-700 font-medium inline-flex items-center gap-1">
                      Selezionato
                    </div>
                  )}
                </label>
              ))}
            </div>
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <div>
                <label className="text-sm font-medium block mb-1">Cleanup days post-archiviazione</label>
                <input
                  type="number"
                  className="c-input"
                  min={0}
                  max={3650}
                  value={cleanupDays}
                  onChange={(e) => setCleanupDays(Number(e.target.value))}
                />
                <p className="text-xs text-ink-500 mt-1">Giorni tra archiviazione e hard-delete (0 = mai).</p>
              </div>
              <div>
                <label className="text-sm font-medium block mb-1">Scadenza piano</label>
                <input
                  type="date"
                  className="c-input"
                  value={pianoScadenza}
                  onChange={(e) => setPianoScadenza(e.target.value)}
                />
                <p className="text-xs text-ink-500 mt-1">Lascia vuoto se non scade.</p>
              </div>
            </div>
          </section>

          {/* Step 3: Amministratore */}
          <section>
            <header className="flex items-center gap-2 mb-3">
              <span className="w-6 h-6 inline-flex items-center justify-center rounded-full bg-brand-600 text-white text-xs font-bold">3</span>
              <h3 className="text-sm font-semibold text-ink-900">Primo amministratore</h3>
            </header>
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <label className="text-sm font-medium block mb-1">
                  Email admin <span className="text-rose-600">*</span>
                </label>
                <input
                  type="email"
                  className="c-input"
                  placeholder="admin@ente.it"
                  autoComplete="off"
                  value={adminEmail}
                  onChange={(e) => setAdminEmail(e.target.value)}
                />
              </div>
              <div>
                <label className="text-sm font-medium block mb-1">
                  Password <span className="text-rose-600">*</span>
                </label>
                <div className="flex gap-1.5">
                  <div className="relative flex-1">
                    <input
                      type={showPass ? 'text' : 'password'}
                      className="c-input pr-9 font-mono text-sm"
                      autoComplete="new-password"
                      value={adminPass}
                      onChange={(e) => setAdminPass(e.target.value)}
                    />
                    <button
                      type="button"
                      className="absolute right-1.5 top-1/2 -translate-y-1/2 p-1 text-ink-700 hover:text-ink-900"
                      title="Nascondi/mostra"
                      onClick={() => setShowPass((v) => !v)}
                    >
                      <Eye className="w-3.5 h-3.5" />
                    </button>
                  </div>
                  <button
                    type="button"
                    className="c-btn c-btn--ghost c-btn--sm"
                    title="Genera nuova"
                    onClick={() => { setAdminPass(genPassword()); setShowPass(true); }}
                  >
                    <RefreshCw className="w-3.5 h-3.5" />
                  </button>
                  <button
                    type="button"
                    className="c-btn c-btn--ghost c-btn--sm"
                    title="Copia"
                    onClick={() => { void navigator.clipboard.writeText(adminPass); toast.success('Password copiata negli appunti'); }}
                  >
                    <Download className="w-3.5 h-3.5" />
                  </button>
                </div>
                <div className="mt-1.5">
                  <div className="h-1 bg-slate-200 rounded-full overflow-hidden">
                    <div className={`h-full transition-all ${scoreCls}`} style={{ width: `${score * 25}%` }} />
                  </div>
                  <p className="text-[11px] text-ink-500 mt-0.5">
                    {adminPass ? `Robustezza: ${scoreLabel}${adminPass.length < 8 ? ' (min 8 caratteri)' : ''}` : ''}
                  </p>
                </div>
              </div>
            </div>
            <div className="mt-3 bg-amber-50 border border-amber-200 rounded-md px-3 py-2 text-xs text-amber-900 flex items-start gap-2">
              <span>Comunica le credenziali al cliente in modo sicuro (gestore password, mai email in chiaro). L'admin può cambiare la password al primo accesso.</span>
            </div>
          </section>
        </div>
        <div className="px-5 py-3 border-t border-slate-200 bg-slate-50 flex justify-end gap-2">
          <button className="c-btn c-btn--ghost c-btn--sm" onClick={onClose}>Annulla</button>
          <button
            className="c-btn c-btn--primary c-btn--sm"
            onClick={() => createMut.mutate()}
            disabled={createMut.isPending || !!slugErr || !slug || !nome || !adminEmail || adminPass.length < 8}
          >
            {createMut.isPending ? 'Creazione…' : 'Crea ente'}
          </button>
        </div>
      </div>
    </div>
  );
}
