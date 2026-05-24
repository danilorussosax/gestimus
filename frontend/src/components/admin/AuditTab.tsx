/**
 * AuditTab — Visualizzatore audit log per un concorso.
 *
 * Props: concorsoId: string
 *
 * Il backend non filtra per concorsoId (la route /audit-log non accetta quel
 * parametro), quindi il filtro "Solo questo concorso" viene applicato
 * client-side cercando il concorsoId nel payload JSON degli entry.
 *
 * Il server filtra già per tenant (RLS), quindi "Tutti" mostra tutti gli
 * eventi del tenant corrente.
 */

import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Shield, RefreshCw } from 'lucide-react';
import { auditApi } from '@/api/audit';
import type { AuditEntry } from '@/types';

// ─── Mappatura action → [emoji, label] ────────────────────────────────────────

const ACTION_MAP: Record<string, [string, string]> = {
  'concorso.create':        ['🆕', 'Concorso creato'],
  'concorso.delete':        ['🗑', 'Concorso eliminato'],
  'fase.start':             ['▶',  'Fase avviata'],
  'fase.complete':          ['🏁', 'Fase conclusa'],
  'fase.sorteggio':         ['🎲', 'Sorteggio ordine'],
  'account.create':         ['🔑', 'Account creato'],
  'account.delete':         ['🗑', 'Account eliminato'],
  'account.update':         ['✏️', 'Account aggiornato'],
  'account.reset_password': ['🔓', 'Password reimpostata'],
  'auth.login':             ['🔓', 'Login'],
  'auth.logout':            ['🔒', 'Logout'],
  'sala.create':            ['🏛',  'Sala creata'],
  'sala.update':            ['✏️', 'Sala aggiornata'],
  'sala.delete':            ['🗑', 'Sala eliminata'],
  'evento.create':          ['📅', 'Blocco creato'],
  'evento.update':          ['✏️', 'Blocco aggiornato'],
  'evento.delete':          ['🗑', 'Blocco eliminato'],
  'evento.genera_slot':     ['⏱',  'Slot generati'],
  'evento.riordina_slot':   ['↕️', 'Slot riordinati'],
  'ente.update':            ['⚙️', 'Ente aggiornato'],
  'branding.update':        ['🎨', 'Branding aggiornato'],
  'calendario_pub.create':  ['🔗', 'Link pubblico creato'],
  'calendario_pub.update':  ['🔗', 'Link pubblico aggiornato'],
  'calendario_pub.delete':  ['🗑', 'Link pubblico rimosso'],
};

// ─── Row component ─────────────────────────────────────────────────────────────

function AuditRow({ entry }: { entry: AuditEntry }) {
  const mapping = ACTION_MAP[entry.action];
  const emoji = mapping?.[0] ?? '•';
  const label = mapping?.[1] ?? entry.action;
  const ts = new Date(entry.timestamp).toLocaleString('it-IT', {
    dateStyle: 'short',
    timeStyle: 'short',
  });
  const target = entry.targetId ? ` · ${entry.targetId.slice(0, 8)}…` : '';

  return (
    <div className="flex items-start gap-3 px-4 py-3 border-b border-slate-100 last:border-b-0 hover:bg-canvas transition-colors">
      {/* Icon */}
      <span
        className="text-base shrink-0 w-7 h-7 rounded-md bg-brand-50 text-brand-600 flex items-center justify-center"
        aria-hidden="true"
      >
        {emoji}
      </span>

      {/* Content */}
      <div className="flex-1 min-w-0">
        <div className="text-sm font-medium text-ink-900 truncate">
          {label}
          {target && <span className="font-normal text-ink-500">{target}</span>}
        </div>
        <div className="text-xs text-ink-500 mt-0.5">
          {entry.actorEmail ? (
            <span className="text-ink-700">{entry.actorEmail}</span>
          ) : (
            <span className="text-ink-500 italic">sistema</span>
          )}
        </div>
      </div>

      {/* Timestamp */}
      <div className="text-[11px] text-ink-500 font-mono shrink-0">{ts}</div>
    </div>
  );
}

// ─── Main component ────────────────────────────────────────────────────────────

interface AuditTabProps {
  concorsoId: string;
}

export function AuditTab({ concorsoId }: AuditTabProps) {
  const { t } = useTranslation();
  const [scope, setScope] = useState<'concorso' | 'all'>('concorso');
  const [query, setQuery] = useState('');

  const {
    data: entries = [],
    isLoading,
    isError,
    refetch,
    isFetching,
  } = useQuery({
    queryKey: ['audit-log'],
    queryFn: () => auditApi.list({ limit: 200 }),
    staleTime: 30_000,
  });

  // Filtra per scope client-side: cerca concorsoId nel payload JSON
  const scopedEntries = useMemo(() => {
    if (scope === 'all') return entries;
    return entries.filter((e) => {
      if (!e.payload) return false;
      const s = typeof e.payload === 'string' ? e.payload : JSON.stringify(e.payload);
      return s.includes(concorsoId);
    });
  }, [entries, scope, concorsoId]);

  // Filtra per testo libero
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return scopedEntries;
    return scopedEntries.filter((e) => {
      const hay = `${e.action} ${e.actorEmail ?? ''} ${e.targetId ?? ''}`.toLowerCase();
      return hay.includes(q);
    });
  }, [scopedEntries, query]);

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-2 mb-4">
        <div>
          <h3 className="text-sm font-bold text-ink-900 uppercase tracking-wider flex items-center gap-2">
            <Shield size={14} aria-hidden="true" />
            {t('admin.audit.title')}
          </h3>
          <p className="text-xs text-ink-500 mt-0.5">{t('admin.audit.subtitle')}</p>
        </div>

        <div className="flex items-center gap-2">
          {/* Scope toggle */}
          <div className="inline-flex bg-canvas border border-slate-200 rounded-lg p-0.5">
            {(['concorso', 'all'] as const).map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => setScope(s)}
                className={`text-xs font-medium px-3 py-1.5 rounded-md transition-colors ${
                  scope === s
                    ? 'bg-white text-ink-900 shadow-soft'
                    : 'text-ink-700 hover:text-ink-900'
                }`}
              >
                {s === 'concorso' ? t('admin.audit.scope_only') : t('admin.audit.scope_all')}
              </button>
            ))}
          </div>

          {/* Search */}
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t('admin.audit.search_ph')}
            className="c-input text-xs h-8 w-56 px-3"
          />

          {/* Refresh */}
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

      {/* List */}
      <div className="bg-white ring-1 ring-slate-900/5 rounded-xl overflow-hidden shadow-soft">
        {isLoading ? (
          <div className="space-y-0 divide-y divide-slate-100">
            {Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="flex items-center gap-3 px-4 py-3 animate-pulse">
                <span className="w-7 h-7 rounded-md bg-slate-100 shrink-0" />
                <div className="flex-1 space-y-1.5">
                  <span className="block h-3.5 w-48 bg-slate-100 rounded" />
                  <span className="block h-3 w-28 bg-slate-100 rounded" />
                </div>
                <span className="h-3 w-20 bg-slate-100 rounded shrink-0" />
              </div>
            ))}
          </div>
        ) : isError ? (
          <div className="px-4 py-12 text-center text-sm text-rose-600">
            {t('admin.audit.error', { msg: 'errore di rete' })}
          </div>
        ) : filtered.length === 0 ? (
          <div className="px-4 py-12 text-center text-sm text-ink-500">
            {t('admin.audit.empty')}
          </div>
        ) : (
          filtered.map((entry) => <AuditRow key={entry.id} entry={entry} />)
        )}
      </div>
    </div>
  );
}
