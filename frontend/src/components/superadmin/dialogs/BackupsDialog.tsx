import React from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { RefreshCw, X } from 'lucide-react';
import { toast } from 'sonner';
import { httpErrorMessage } from '@/lib/api';
import { platformApi, type Tenant } from '@/api/platform';
import { fmtBytes, fmtDate } from '@/components/superadmin/format';

export function BackupsDialog({ t, onClose, onCleanupRun }: { t: Tenant; onClose: () => void; onCleanupRun: () => void }) {
  const backupsQ = useQuery({
    queryKey: ['platform', 'backups'],
    queryFn: () => platformApi.listBackups(),
  });
  const rows = (backupsQ.data ?? []).filter((b) => b.tenantSlug === t.slug);

  const cleanupMut = useMutation({
    mutationFn: () => platformApi.runCleanup(),
    onSuccess: (r) => {
      const res = r as { candidatesFound?: number; deleted?: number; backedUp?: number; errors?: unknown[] };
      toast.success(`Job: candidati=${res.candidatesFound ?? 0}, eliminati=${res.deleted ?? 0}, backup=${res.backedUp ?? 0}, errori=${res.errors?.length ?? 0}`);
      onCleanupRun();
    },
    onError: (err) => toast.error(httpErrorMessage(err)),
  });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-slate-900/40" onClick={onClose} />
      <div className="relative bg-white border border-slate-200 rounded-xl shadow-xl w-full max-w-2xl flex flex-col max-h-[85vh]">
        <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between">
          <h2 className="text-base font-semibold text-ink-900">Backup — {t.nome}</h2>
          <button className="p-1.5 rounded-md hover:bg-slate-100 text-ink-700" onClick={onClose}><X className="w-4 h-4" /></button>
        </div>
        <div className="px-5 py-3 flex items-center justify-between border-b border-slate-100">
          <p className="text-sm text-ink-700">
            Dump pre-cancellazione (JSON gzipped). Retention: <code>BACKUP_RETENTION_DAYS</code> (default 90gg).
          </p>
          {t.stato === 'archiviato' && (
            <button
              className="c-btn c-btn--ghost c-btn--sm ml-3"
              onClick={() => {
                if (window.confirm('Eseguire ora il job di cleanup? Verranno hard-deletati i tenant archiviati con cleanup_scheduled_at scaduto.'))
                  cleanupMut.mutate();
              }}
              disabled={cleanupMut.isPending}
            >
              <RefreshCw className="w-3.5 h-3.5" /><span>Esegui cleanup ora</span>
            </button>
          )}
        </div>
        <div className="overflow-x-auto max-h-[60vh] px-1">
          {rows.length === 0
            ? <p className="text-sm text-ink-700 italic p-4">Nessun backup per questo tenant.</p>
            : (
              <table className="min-w-full text-sm">
                <thead className="bg-slate-50 text-left sticky top-0">
                  <tr>
                    <th className="px-3 py-2 font-semibold text-ink-700">File</th>
                    <th className="px-3 py-2 font-semibold text-ink-700">Size</th>
                    <th className="px-3 py-2 font-semibold text-ink-700">Modificato</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {rows.map((b, i) => (
                    <tr key={i}>
                      <td className="px-3 py-2"><code className="text-xs">{b.filename}</code></td>
                      <td className="px-3 py-2 text-ink-700">{fmtBytes(b.sizeBytes)}</td>
                      <td className="px-3 py-2 text-ink-700">{fmtDate(b.modifiedAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
        </div>
      </div>
    </div>
  );
}
