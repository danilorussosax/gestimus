import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { Copy, ExternalLink, Eye, EyeOff, Trash2 } from 'lucide-react';
import type { CalendarioPubblicazione } from '@/api/calendario';
import type { Sezione } from '@/types';
import { publicCalUrl } from '../calendario-utils';

export interface PubRowProps {
  pub: CalendarioPubblicazione;
  sezioni: Sezione[];
  onRevoke: () => void;
  onToggle: () => void;
}

export function PubRow({ pub, sezioni, onRevoke, onToggle }: PubRowProps) {
  const { t } = useTranslation();
  const sezName = (id: string | null) => sezioni.find((s) => s.id === id)?.nome ?? '';
  const scopoLabel =
    pub.scopo === 'CONCORSO'
      ? t('cal.links.scopo.concorso')
      : pub.scopo === 'SEZIONE'
      ? `${t('cal.links.scopo.sezione')}: ${sezName(pub.sezioneId)}`
      : `${t('cal.links.scopo.giorno')}: ${pub.giorno ?? ''}`;

  async function copy() {
    try {
      await navigator.clipboard.writeText(publicCalUrl(pub.token, false));
      toast.success(t('cal.links.copied'));
    } catch {
      toast.info(publicCalUrl(pub.token, false), { duration: 6000 });
    }
  }

  return (
    <li
      className="flex flex-wrap items-center gap-2 rounded-xl px-3 py-2"
      style={{ border: '1px solid hsl(var(--border))' }}
    >
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium" style={{ color: 'hsl(var(--foreground))' }}>
          {pub.etichetta || scopoLabel}
        </p>
        <p className="text-[11px]" style={{ color: 'hsl(var(--muted-foreground))' }}>
          {scopoLabel}
          {' · '}
          {pub.mostraNomi ? '👤' : '🔒'}
          {pub.mostraCommissione ? ' ⚖️' : ''}
          {!pub.attivo ? ' · (off)' : ''}
        </p>
      </div>
      <button type="button" onClick={copy} className="c-btn c-btn--ghost c-btn--sm">
        <Copy className="h-[13px] w-[13px]" />
        <span>{t('cal.links.copy')}</span>
      </button>
      <a
        href={publicCalUrl(pub.token, true)}
        target="_blank"
        rel="noopener noreferrer"
        className="c-btn c-btn--ghost c-btn--sm"
      >
        <ExternalLink className="h-[13px] w-[13px]" />
        <span>{t('cal.links.display')}</span>
      </a>
      <button type="button" onClick={onToggle} className="c-btn c-btn--ghost c-btn--sm">
        {pub.attivo ? <Eye className="h-[13px] w-[13px]" /> : <EyeOff className="h-[13px] w-[13px]" />}
      </button>
      <button
        type="button"
        onClick={onRevoke}
        className="c-btn c-btn--ghost c-btn--sm"
        style={{ color: 'hsl(var(--destructive))' }}
      >
        <Trash2 className="h-[13px] w-[13px]" />
      </button>
    </li>
  );
}
