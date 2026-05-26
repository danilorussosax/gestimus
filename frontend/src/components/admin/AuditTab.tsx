/**
 * AuditTab — Visualizzatore audit log per un concorso.
 *
 * Props: concorsoId: string
 *
 * Scope toggle:
 *   "Solo questo concorso" → filtra client-side cercando concorsoId nel payload
 *   "Tutti i concorsi"     → mostra tutti gli eventi del tenant (RLS già applicato)
 *
 * Fedele all'implementazione vanilla js/views/admin/audit.js.
 * Mapping action→[emoji, label] riproduce AUDIT_LABEL_KEYS esattamente.
 */

import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { RefreshCw } from 'lucide-react';
import { auditApi } from '@/api/audit';
import type { AuditEntry } from '@/types';

// ─── Mappatura action → [emoji, i18n-key] ─────────────────────────────────────
// Riproduce esattamente AUDIT_LABEL_KEYS da js/views/admin/audit.js.

const AUDIT_LABEL_KEYS: Record<string, [string, string]> = {
  'concorso.create': ['🆕', 'admin.audit.label.concorso_create'],
  'concorso.delete': ['🗑',  'admin.audit.label.concorso_delete'],
  'fase.start':      ['▶',   'admin.audit.label.fase_start'],
  'fase.complete':   ['🏁',  'admin.audit.label.fase_complete'],
  'fase.sorteggio':  ['🎲',  'admin.audit.label.fase_sorteggio'],
  'account.create':  ['🔑',  'admin.audit.label.account_create'],
  'account.delete':  ['🗑',  'admin.audit.label.account_delete'],
  'auth.login':      ['🔓',  'admin.audit.label.auth_login'],
  'auth.logout':     ['🔒',  'admin.audit.label.auth_logout'],
};

// ─── Row component ─────────────────────────────────────────────────────────────

function AuditRow({ entry }: { entry: AuditEntry }) {
  const { t } = useTranslation();

  const mapping = AUDIT_LABEL_KEYS[entry.action];
  const emoji = mapping ? mapping[0] : '•';
  const label = mapping ? t(mapping[1]) : entry.action;

  const ts = new Date(entry.createdAt).toLocaleString('it-IT', {
    dateStyle: 'short',
    timeStyle: 'short',
  });

  // Il backend non fornisce un'etichetta target leggibile: mostriamo il
  // targetType (es. "concorso", "fase") quando presente.
  const target = entry.targetType ? ` · ${entry.targetType}` : '';

  return (
    <div className="flex items-start gap-3 px-4 py-3 border-b border-slate-100 last:border-b-0 hover:bg-canvas">
      {/* Icona azione */}
      <span
        className="text-base shrink-0 w-7 h-7 rounded-md bg-brand-50 text-brand-600 flex items-center justify-center"
        aria-hidden="true"
      >
        {emoji}
      </span>

      {/* Contenuto principale */}
      <div className="flex-1 min-w-0">
        <div className="text-sm font-medium text-ink-900 truncate">
          {label}
          {target && <span className="font-normal text-ink-500">{target}</span>}
        </div>
        <div className="text-xs text-ink-500 mt-0.5">
          {entry.actorAccountId ? (
            <span className="text-ink-700 font-mono">{entry.actorAccountId.slice(0, 8)}</span>
          ) : (
            <span className="text-ink-500 italic">{t('admin.audit.system')}</span>
          )}
        </div>
      </div>

      {/* Timestamp */}
      <div className="text-[11px] text-ink-500 font-mono shrink-0">{ts}</div>
    </div>
  );
}

// ─── Skeleton row (stato loading) ──────────────────────────────────────────────

function SkeletonRow() {
  return (
    <div className="flex items-center gap-3 px-4 py-3 animate-pulse">
      <span className="w-7 h-7 rounded-md bg-slate-100 shrink-0" />
      <div className="flex-1 space-y-1.5">
        <span className="block h-3.5 w-48 bg-slate-100 rounded" />
        <span className="block h-3 w-28 bg-slate-100 rounded" />
      </div>
      <span className="h-3 w-20 bg-slate-100 rounded shrink-0" />
    </div>
  );
}

// ─── Main component ────────────────────────────────────────────────────────────

interface AuditTabProps {
  concorsoId: string;
}

const AUDIT_PAGE_SIZE = 200;

export function AuditTab({ concorsoId }: AuditTabProps) {
  const { t } = useTranslation();
  const [scope, setScope] = useState<'concorso' | 'all'>('concorso');
  const [query, setQuery] = useState('');
  const [offset, setOffset] = useState(0);

  // queryKey include scope+offset: cambiarli ricarica la pagina corretta.
  // placeholderData mantiene la pagina precedente durante il fetch (niente
  // flash di skeleton al cambio pagina).
  const {
    data,
    isLoading,
    isError,
    error,
    refetch,
    isFetching,
  } = useQuery({
    queryKey: ['audit-log', scope, offset] as const,
    queryFn: () => auditApi.list({ limit: AUDIT_PAGE_SIZE, offset }),
    staleTime: 30_000,
    placeholderData: (prev) => prev,
  });
  const entries = data?.items ?? [];
  const total = data?.total ?? 0;

  // Filtro scope client-side: include l'evento se il suo targetId è il concorso
  // OPPURE se il concorsoId compare nel payload serializzato (vanilla:
  // targetId === concorso.id || payload.concorsoId === concorso.id).
  const scopedEntries = useMemo(() => {
    if (scope === 'all') return entries;
    return entries.filter((e) => {
      if (e.targetId === concorsoId) return true;
      if (!e.payload) return false;
      const s = typeof e.payload === 'string' ? e.payload : JSON.stringify(e.payload);
      return s.includes(concorsoId);
    });
  }, [entries, scope, concorsoId]);

  // Filtro testo libero — cerca nei campi disponibili lato backend
  // (action, actorAccountId, targetType, targetId).
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return scopedEntries;
    return scopedEntries.filter((e) => {
      const hay = `${e.action} ${e.actorAccountId ?? ''} ${e.targetType ?? ''} ${e.targetId ?? ''}`.toLowerCase();
      return hay.includes(q);
    });
  }, [scopedEntries, query]);

  // Messaggio di errore
  const errMsg = error instanceof Error ? error.message : 'errore di rete';

  return (
    <div className="space-y-4">
      {/* Header: titolo + controlli */}
      <div className="flex flex-wrap items-center justify-between gap-2 mb-4">
        <div>
          <h3 className="text-sm font-bold text-ink-900 uppercase tracking-wider">
            {t('admin.audit.title')}
          </h3>
          <p className="text-xs text-ink-500 mt-0.5">{t('admin.audit.subtitle')}</p>
        </div>

        <div className="flex items-center gap-2">
          {/* Toggle scope: "Solo questo concorso" / "Tutti i concorsi" */}
          <div className="inline-flex bg-canvas border border-slate-200 rounded-lg p-0.5">
            {(['concorso', 'all'] as const).map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => { setScope(s); setOffset(0); }}
                className={`text-xs font-medium px-3 py-1.5 rounded-md${
                  scope === s
                    ? ' bg-white text-ink-900 shadow-soft'
                    : ' text-ink-700'
                }`}
              >
                {s === 'concorso' ? t('admin.audit.scope_only') : t('admin.audit.scope_all')}
              </button>
            ))}
          </div>

          {/* Ricerca libera */}
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t('admin.audit.search_ph')}
            className="text-xs border border-slate-200 rounded-lg px-3 py-1.5 w-56 focus:ring-2 focus:ring-brand-500 focus:border-brand-500"
          />

          {/* Pulsante refresh */}
          <button
            type="button"
            onClick={() => void refetch()}
            aria-label={t('common.refresh')}
            className="c-btn c-btn--ghost !h-8 !w-8 !p-0"
          >
            <RefreshCw
              size={14}
              className={isFetching ? 'animate-spin' : ''}
              aria-hidden="true"
            />
          </button>
        </div>
      </div>

      {/* Lista eventi */}
      <div className="bg-white ring-1 ring-slate-900/5 rounded-xl overflow-hidden shadow-soft">
        {isLoading ? (
          <div className="divide-y divide-slate-100">
            {Array.from({ length: 8 }).map((_, i) => (
              <SkeletonRow key={i} />
            ))}
          </div>
        ) : isError ? (
          <div className="px-4 py-12 text-center text-sm text-rose-600">
            {t('admin.audit.error', { msg: errMsg })}
          </div>
        ) : filtered.length === 0 ? (
          <div className="px-4 py-12 text-center text-sm text-ink-500">
            {t('admin.audit.empty')}
          </div>
        ) : (
          filtered.map((entry) => <AuditRow key={entry.id} entry={entry} />)
        )}
      </div>

      {/* Paginazione server-side (contratto items/total/limit/offset). I filtri
          scope/testo raffinano la pagina corrente lato client. */}
      {!isLoading && !isError && total > AUDIT_PAGE_SIZE && (
        <div className="flex items-center justify-between gap-2 text-xs text-ink-600">
          <span>
            {t('admin.audit.range', {
              defaultValue: '{{from}}–{{to}} di {{total}}',
              from: offset + 1,
              to: Math.min(offset + entries.length, total),
              total,
            })}
          </span>
          <div className="flex items-center gap-1">
            <button
              type="button"
              className="c-btn c-btn--ghost c-btn--sm"
              disabled={offset === 0 || isFetching}
              onClick={() => setOffset((o) => Math.max(0, o - AUDIT_PAGE_SIZE))}
            >
              {t('common.prev', { defaultValue: '‹ Precedenti' })}
            </button>
            <button
              type="button"
              className="c-btn c-btn--ghost c-btn--sm"
              disabled={offset + AUDIT_PAGE_SIZE >= total || isFetching}
              onClick={() => setOffset((o) => o + AUDIT_PAGE_SIZE)}
            >
              {t('common.next', { defaultValue: 'Successivi ›' })}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
