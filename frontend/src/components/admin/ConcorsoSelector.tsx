/**
 * ConcorsoSelector — compact <Select> that lists all concorsi for the current
 * tenant and sets the active one via useActiveConcorso().
 *
 * Designed to drop into the admin shell header (AppLayout sidebar / topbar).
 * Renders nothing until the list is loaded (avoids CLS).
 */

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { useConcorsi, useActiveConcorso } from '@/api/concorsi';
import type { Concorso } from '@/types';
import { useTranslation } from 'react-i18next';

function statoBadgeVariant(
  stato: Concorso['stato'],
): 'success' | 'warning' | 'muted' {
  if (stato === 'ATTIVO') return 'success';
  if (stato === 'CHIUSO') return 'muted';
  return 'warning';
}

interface ConcorsoSelectorProps {
  /** Extra classes for the trigger button. */
  className?: string;
}

export function ConcorsoSelector({ className }: ConcorsoSelectorProps) {
  const { t } = useTranslation();
  const { data: concorsi = [], isLoading } = useConcorsi();
  const { activeId, setActiveId } = useActiveConcorso();

  if (isLoading) {
    return <Skeleton className={cn('h-10 w-52', className)} />;
  }

  if (concorsi.length === 0) {
    return (
      <span className={cn('text-xs text-muted-foreground px-1', className)}>
        {t('app.no_concorso')}
      </span>
    );
  }

  return (
    <Select value={activeId ?? ''} onValueChange={setActiveId}>
      <SelectTrigger
        className={cn('w-52 truncate', className)}
        aria-label={t('admin.concorso.active')}
      >
        <SelectValue placeholder={t('admin.concorso.active')} />
      </SelectTrigger>
      <SelectContent>
        {concorsi.map((c) => (
          <SelectItem key={c.id} value={c.id}>
            <span className="flex items-center gap-2 truncate">
              <span className="truncate">{c.nome}</span>
              <Badge
                variant={statoBadgeVariant(c.stato)}
                className="shrink-0 text-[10px] px-1.5 py-0"
              >
                {c.anno}
              </Badge>
            </span>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

export default ConcorsoSelector;
