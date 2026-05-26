import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { X } from 'lucide-react';
import { platformApi, type Tenant } from '@/api/platform';
import { fmtDate } from '@/components/superadmin/format';

export function AuditDialog({ t, onClose }: { t: Tenant; onClose: () => void }) {
  const auditQ = useQuery({
    queryKey: ['platform', 'audit', t.id],
    queryFn: () => platformApi.getAudit({ tenantId: t.id, limit: 100 }),
  });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-slate-900/40" onClick={onClose} />
      <div className="relative bg-white border border-slate-200 rounded-xl shadow-xl w-full max-w-2xl flex flex-col max-h-[85vh]">
        <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between">
          <h2 className="text-base font-semibold text-ink-900">Audit log — {t.nome}</h2>
          <button className="p-1.5 rounded-md hover:bg-slate-100 text-ink-700" onClick={onClose}><X className="w-4 h-4" /></button>
        </div>
        <div className="overflow-x-auto max-h-[60vh] px-1">
          {auditQ.isLoading
            ? <p className="text-sm text-ink-700 italic p-4">Caricamento…</p>
            : (auditQ.data?.length ?? 0) === 0
              ? <p className="text-sm text-ink-700 italic p-4">Nessuna riga di audit per questo tenant.</p>
              : (
                <table className="min-w-full text-xs">
                  <thead className="bg-slate-50 text-left sticky top-0">
                    <tr>
                      <th className="px-3 py-2 font-semibold text-ink-700">Quando</th>
                      <th className="px-3 py-2 font-semibold text-ink-700">Action</th>
                      <th className="px-3 py-2 font-semibold text-ink-700">Payload</th>
                      <th className="px-3 py-2 font-semibold text-ink-700">IP</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {(auditQ.data ?? []).map((r) => (
                      <tr key={r.id}>
                        <td className="px-3 py-2 whitespace-nowrap text-ink-700">{fmtDate(r.createdAt)}</td>
                        <td className="px-3 py-2"><code>{r.action}</code></td>
                        <td className="px-3 py-2"><pre className="text-xs whitespace-pre-wrap max-w-xs overflow-hidden">{r.payload ? JSON.stringify(r.payload) : ''}</pre></td>
                        <td className="px-3 py-2 text-ink-700">{r.ip ?? '—'}</td>
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
