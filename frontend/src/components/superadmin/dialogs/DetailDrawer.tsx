import React from 'react';
import { Download, Edit, Folder, List, Mail, X } from 'lucide-react';
import { type Tenant, type TenantStats, type TenantSmtp } from '@/api/platform';
import { PIANI } from '@/lib/piani';
import { fmtBytes, fmtDate, cleanupCountdown } from '@/components/superadmin/format';
import { StatoBadge, PianoBadge, UsageBar, StatTile } from '@/components/superadmin/ui';

export function DetailDrawer({
  t, statsMap, smtpMap, onClose, onEdit, onSmtp, onAudit, onBackups,
}: {
  t: Tenant;
  statsMap: Map<string, TenantStats>;
  smtpMap: Map<string, TenantSmtp>;
  onClose: () => void;
  onEdit: (t: Tenant) => void;
  onSmtp: (t: Tenant) => void;
  onAudit: (t: Tenant) => void;
  onBackups: (t: Tenant) => void;
}) {
  const stats = statsMap.get(t.id);
  const smtp = smtpMap.get(t.id);
  const piano = (t.piano in (PIANI as object)) ? PIANI[t.piano] : PIANI.trial;

  return (
    <div className="fixed inset-0 z-40 flex justify-end">
      <div className="absolute inset-0 bg-slate-900/30" onClick={onClose} />
      <aside className="relative w-full sm:max-w-md bg-white shadow-xl flex flex-col h-full">
        <header className="px-5 py-4 border-b border-slate-200 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[11px] uppercase tracking-wider text-ink-500 mb-1">Dettaglio ente</p>
            <h2 className="text-lg font-semibold text-ink-900 truncate">{t.nome}</h2>
            <p className="text-xs text-ink-500 mt-0.5"><code>{t.slug}</code></p>
            <div className="flex flex-wrap gap-1.5 mt-2">
              <StatoBadge stato={t.stato} />
              <PianoBadge piano={t.piano} />
              {t.pianoScadenza && (
                <span className="text-[11px] text-ink-700">scade {fmtDate(t.pianoScadenza)}</span>
              )}
            </div>
          </div>
          <button
            className="p-1.5 rounded-md hover:bg-slate-100 text-ink-700"
            onClick={onClose}
            aria-label="Chiudi"
          >
            <X className="w-4 h-4" />
          </button>
        </header>

        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-5">
          <section>
            <h3 className="text-[11px] uppercase tracking-wide font-semibold text-ink-500 mb-2">Risorse</h3>
            <div className="space-y-3">
              <UsageBar label="Concorsi" used={stats?.concorsi ?? 0} limit={piano.limit_concorsi} />
              <UsageBar label="Iscrizioni / anno" used={stats?.iscrizioni ?? 0} limit={piano.limit_iscritti_annui} />
            </div>
            <div className="grid grid-cols-3 gap-2 mt-3">
              <StatTile value={stats?.commissari ?? '·'} label="commissari" />
              <StatTile value={stats?.candidati ?? '·'} label="candidati" />
              <StatTile value={stats?.accounts ?? '·'} label="account" />
            </div>
            <div className="flex items-center justify-between text-xs text-ink-700 mt-3 pt-3 border-t border-slate-100">
              <span className="inline-flex items-center gap-1.5"><Folder className="w-3 h-3" />Storage uploads</span>
              <strong className="text-ink-900">{stats ? fmtBytes(stats.diskUsageBytes) : '·'}</strong>
            </div>
          </section>

          <section>
            <h3 className="text-[11px] uppercase tracking-wide font-semibold text-ink-500 mb-2">Configurazione</h3>
            <dl className="text-sm space-y-1.5">
              <div className="flex justify-between">
                <dt className="text-ink-700">Dominio custom</dt>
                <dd>{t.dominio ? t.dominio : <span className="text-ink-500 italic">—</span>}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-ink-700">Cleanup days</dt>
                <dd>{t.cleanupAfterDays === 0 ? <span className="italic">mai</span> : t.cleanupAfterDays}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-ink-700">2FA admin</dt>
                <dd>{t.require2faAdmin ? 'richiesto' : 'opzionale'}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-ink-700">SMTP</dt>
                <dd>{smtp?.configured
                  ? `configurato${smtp.encrypted ? ' (cifrato)' : ''}`
                  : <span className="text-ink-500 italic">non configurato</span>}
                </dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-ink-700">Creato il</dt>
                <dd>{fmtDate(t.createdAt)}</dd>
              </div>
              {t.stato === 'archiviato' && (
                <div className="flex justify-between">
                  <dt className="text-ink-700">Cleanup</dt>
                  <dd className="text-amber-700">{cleanupCountdown(t)}</dd>
                </div>
              )}
            </dl>
          </section>

          {t.note && (
            <section>
              <h3 className="text-[11px] uppercase tracking-wide font-semibold text-ink-500 mb-2">Note</h3>
              <p className="text-sm text-ink-700 whitespace-pre-wrap">{t.note}</p>
            </section>
          )}
        </div>

        <footer className="border-t border-slate-200 px-5 py-3 bg-slate-50 flex flex-wrap gap-2">
          <button
            data-drawer-act="audit"
            className="c-btn c-btn--ghost c-btn--sm"
            onClick={() => onAudit(t)}
          >
            <List className="w-3.5 h-3.5" /><span>Audit</span>
          </button>
          <button
            data-drawer-act="backup"
            className="c-btn c-btn--ghost c-btn--sm"
            onClick={() => onBackups(t)}
          >
            <Download className="w-3.5 h-3.5" /><span>Backup</span>
          </button>
          <button
            data-drawer-act="smtp"
            className="c-btn c-btn--ghost c-btn--sm"
            onClick={() => onSmtp(t)}
          >
            <Mail className="w-3.5 h-3.5" /><span>SMTP</span>
          </button>
          <button
            data-drawer-act="edit"
            className="c-btn c-btn--primary c-btn--sm ml-auto"
            onClick={() => onEdit(t)}
          >
            <Edit className="w-3.5 h-3.5" /><span>Modifica</span>
          </button>
        </footer>
      </aside>
    </div>
  );
}
