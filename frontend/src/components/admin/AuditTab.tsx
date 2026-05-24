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
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import { auditApi } from '@/api/audit';
import type { AuditEntry } from '@/types';

// ─── Mappatura action → [emoji, label] ────────────────────────────────────────

const ACTION_MAP: Record<string, [string, string]> = {
  'concorso.create':      ['🆕', 'Concorso creato'],
  'concorso.delete':      ['🗑', 'Concorso eliminato'],
  'fase.start':           ['▶',  'Fase avviata'],
  'fase.complete':        ['🏁', 'Fase conclusa'],
  'fase.sorteggio':       ['🎲', 'Sorteggio ordine'],
  'account.create':       ['🔑', 'Account creato'],
  'account.delete':       ['🗑', 'Account eliminato'],
  'account.update':       ['✏️', 'Account aggiornato'],
  'account.reset_password': ['🔓', 'Password reimpostata'],
  'auth.login':           ['🔓', 'Login'],
  'auth.logout':          ['🔒', 'Logout'],
  'sala.create':          ['🏛',  'Sala creata'],
  'sala.update':          ['✏️', 'Sala aggiornata'],
  'sala.delete':          ['🗑', 'Sala eliminata'],
  'evento.create':        ['📅', 'Blocco creato'],
  'evento.update':        ['✏️', 'Blocco aggiornato'],
  'evento.delete':        ['🗑', 'Blocco eliminato'],
  'evento.genera_slot':   ['⏱',  'Slot generati'],
  'evento.riordina_slot': ['↕️', 'Slot riordinati'],
  'ente.update':          ['⚙️', 'Ente aggiornato'],
  'branding.update':      ['🎨', 'Branding aggiornato'],
  'calendario_pub.create':['🔗', 'Link pubblico creato'],
  'calendario_pub.update':['🔗', 'Link pubblico aggiornato'],
  'calendario_pub.delete':['🗑', 'Link pubblico rimosso'],
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
  const targetSuffix = entry.targetId ? ` · ${entry.targetId.slice(0, 8)}…` : '';

  return (
    <div className="flex items-start gap-3 border-b border-border px-4 py-3 last:border-b-0 hover:bg-muted/30 transition-colors">
      {/* Icon */}
      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-primary/5 text-sm" aria-hidden>
        {emoji}
      </span>

      {/* Content */}
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-foreground">
          {label}
          {targetSuffix && (
            <span className="font-normal text-muted-foreground">{targetSuffix}</span>
          )}
        </p>
        <div className="mt-0.5 flex items-center gap-1 text-xs text-muted-foreground">
          {entry.actorEmail ? (
            <span className="text-foreground/70">{entry.actorEmail}</span>
          ) : (
            <span className="italic">sistema</span>
          )}
        </div>
      </div>

      {/* Timestamp */}
      <div className="shrink-0 font-mono text-[11px] text-muted-foreground">{ts}</div>
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
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="flex items-center gap-2 text-sm font-bold uppercase tracking-wider text-foreground">
            <Shield className="h-4 w-4" />
            {t('admin.audit.title')}
          </h3>
          <p className="mt-0.5 text-xs text-muted-foreground">{t('admin.audit.subtitle')}</p>
        </div>

        <div className="flex items-center gap-2">
          {/* Scope toggle */}
          <div className="inline-flex items-center rounded-lg border border-border bg-background p-0.5">
            {(['concorso', 'all'] as const).map((s) => (
              <button
                key={s}
                onClick={() => setScope(s)}
                className={cn(
                  'rounded-md px-3 py-1.5 text-xs font-medium transition-colors',
                  scope === s
                    ? 'bg-card text-foreground shadow-sm'
                    : 'text-muted-foreground hover:text-foreground',
                )}
              >
                {s === 'concorso' ? t('admin.audit.scope_only') : t('admin.audit.scope_all')}
              </button>
            ))}
          </div>

          {/* Search */}
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t('admin.audit.search_ph')}
            className="h-8 w-52 text-xs"
          />

          {/* Refresh */}
          <Button
            variant="ghost"
            size="icon"
            onClick={() => void refetch()}
            aria-label={t('common.refresh')}
            className="h-8 w-8"
          >
            <RefreshCw className={cn('h-3.5 w-3.5', isFetching && 'animate-spin')} />
          </Button>
        </div>
      </div>

      {/* Table */}
      <div className="overflow-hidden rounded-xl border border-border bg-card shadow-sm">
        {isLoading ? (
          <div className="space-y-px px-4 py-2">
            {Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="flex items-center gap-3 py-3">
                <Skeleton className="h-7 w-7 rounded-md" />
                <div className="flex-1 space-y-1.5">
                  <Skeleton className="h-3.5 w-48" />
                  <Skeleton className="h-3 w-28" />
                </div>
                <Skeleton className="h-3 w-20" />
              </div>
            ))}
          </div>
        ) : isError ? (
          <div className="px-4 py-12 text-center text-sm text-destructive">
            {t('admin.audit.error', { msg: 'errore di rete' })}
          </div>
        ) : filtered.length === 0 ? (
          <div className="px-4 py-12 text-center text-sm text-muted-foreground">
            {t('admin.audit.empty')}
          </div>
        ) : (
          filtered.map((entry) => <AuditRow key={entry.id} entry={entry} />)
        )}
      </div>
    </div>
  );
}
