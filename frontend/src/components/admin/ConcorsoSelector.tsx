/**
 * ConcorsoSelector — admin landing LIST/grid.
 *
 * Port of vanilla js/views/admin/concorso-selector.js (renderConcorsoSelector):
 *  - a responsive GRID of concorso cards (nome, anno, stato tag,
 *    candidati / fasi / commissari counts)
 *  - clicking a card ENTERS that concorso (via the onPick callback, which the
 *    AdminWorkspace wires to `navigate('/admin?c=ID')`)
 *  - per-card edit / delete
 *  - a dashed "Nuovo concorso" tile that opens the create modal
 *  - create / edit modals (openCreateConcorso / openEditConcorso) with
 *    nome, anno, data inizio, stato (edit), logo upload, anonimo toggle
 *
 * Data wiring is exclusively through '@/api/concorsi'.
 */

import { useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import { ArrowRight, Pencil, Trash2, Plus, Copy } from 'lucide-react';

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import { http, fileUrl, httpErrorMessage } from '@/lib/api';
import {
  useConcorsi,
  useActiveConcorso,
  useCreateConcorso,
  useUpdateConcorso,
  useDeleteConcorso,
  useDuplicaConcorso,
} from '@/api/concorsi';
import type { Concorso } from '@/types';

// ---------------------------------------------------------------------------
// Tenant-wide count queries — single fetch per collection, grouped by
// concorsoId client-side (mirrors vanilla db.fasiByConcorso etc.). We keep
// these local so we don't have to touch the per-concorso API hooks.
// ---------------------------------------------------------------------------

interface HasConcorso { concorsoId: string }

function useTenantRows(resource: string, queryKey: string) {
  return useQuery<HasConcorso[]>({
    queryKey: ['tenant-all', queryKey],
    queryFn: () => http.get<HasConcorso[]>(resource, { limit: 2000 }),
    staleTime: 30_000,
  });
}

// ---------------------------------------------------------------------------
// Logo resize helper (mirrors vanilla readImageResized / ImpostazioniConcorso)
// ---------------------------------------------------------------------------

function readImageResized(file: File, maxPx: number, quality: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(url);
      const ratio = Math.min(1, maxPx / Math.max(img.width, img.height));
      const w = Math.round(img.width * ratio);
      const h = Math.round(img.height * ratio);
      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d');
      if (!ctx) { reject(new Error('canvas context')); return; }
      ctx.drawImage(img, 0, 0, w, h);
      resolve(canvas.toDataURL(file.type === 'image/svg+xml' ? 'image/png' : file.type, quality));
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('load')); };
    img.src = url;
  });
}

const statoTag = (stato: Concorso['stato']) =>
  stato === 'ATTIVO' ? 'c-tag c-tag--green' : 'c-tag c-tag--gray c-tag--no-dot';

// ---------------------------------------------------------------------------
// Create / Edit modal
// ---------------------------------------------------------------------------

interface ConcorsoFormDialogProps {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  /** When present → edit mode; otherwise create. */
  existing?: Concorso | null;
  /** Called with the created/updated concorso so the caller can enter it. */
  onSaved?: (c: Concorso) => void;
}

export function ConcorsoFormDialog({ open, onOpenChange, existing, onSaved }: ConcorsoFormDialogProps) {
  const { t } = useTranslation();
  const isEdit = !!existing;
  const createMutation = useCreateConcorso();
  const updateMutation = useUpdateConcorso();
  const logoInputRef = useRef<HTMLInputElement>(null);
  const [pendingLogo, setPendingLogo] = useState<{ dataURL: string; name: string } | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const currentYear = new Date().getFullYear();

  const onLogoChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) {
      toast.error(t('admin.concorso.field_logo_too_big'));
      if (logoInputRef.current) logoInputRef.current.value = '';
      return;
    }
    try {
      const dataURL = await readImageResized(file, 800, 0.85);
      setPendingLogo({ dataURL, name: file.name });
    } catch {
      toast.error(t('admin.concorso.field_logo_error'));
    }
  };

  const handleSubmit = async (e: React.SyntheticEvent) => {
    e.preventDefault();
    const el = (e.currentTarget as HTMLFormElement).elements;
    const get = (name: string) =>
      (el.namedItem(name) as HTMLInputElement | HTMLSelectElement | null)?.value ?? '';
    const nome = get('nome').trim();
    const annoRaw = get('anno').trim();
    const dataInizio = get('data_inizio').trim();
    const statoRaw = get('stato');
    const anonimo =
      (el.namedItem('anonimo') as HTMLInputElement | null)?.checked ?? false;

    if (!nome) {
      toast.error(t('admin.concorso.required_nome'));
      return;
    }

    setSubmitting(true);
    try {
      if (existing) {
        const body: Parameters<typeof updateMutation.mutateAsync>[0]['body'] = {
          nome,
          anno: Number(annoRaw),
          dataInizio: dataInizio || undefined,
          stato: (statoRaw || 'ATTIVO') as 'ATTIVO' | 'CONCLUSO' | 'ARCHIVIATO',
          anonimo,
        };
        if (pendingLogo) body.logo = pendingLogo.dataURL;
        const c = await updateMutation.mutateAsync({ id: existing.id, body });
        toast.success(t('admin.concorso.updated'));
        onOpenChange(false);
        onSaved?.(c);
      } else {
        const c = await createMutation.mutateAsync({
          nome,
          anno: Number(annoRaw),
          dataInizio: dataInizio || undefined,
          anonimo,
          ...(pendingLogo ? { logo: pendingLogo.dataURL } : {}),
        });
        toast.success(t('admin.concorso.created'));
        onOpenChange(false);
        onSaved?.(c);
      }
      setPendingLogo(null);
      if (logoInputRef.current) logoInputRef.current.value = '';
    } catch (err) {
      toast.error(httpErrorMessage(err));
    } finally {
      setSubmitting(false);
    }
  };

  const logoPreviewSrc =
    pendingLogo?.dataURL ?? (existing?.logoUrl ? fileUrl(existing.logoUrl) : null);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {isEdit ? t('admin.concorso.edit_title') : t('admin.concorso.new_title')}
          </DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <label className="c-field">
            <span className="c-field__label">{t('admin.concorso.field_nome')}</span>
            <input
              name="nome"
              type="text"
              required
              defaultValue={existing?.nome ?? ''}
              className="c-input"
              placeholder="Concorso Internazionale 2026"
              autoFocus
            />
          </label>

          <div className="grid grid-cols-2 gap-4">
            <label className="c-field">
              <span className="c-field__label">{t('admin.concorso.field_anno')}</span>
              <input
                name="anno"
                type="number"
                min={2000}
                max={2100}
                required
                defaultValue={existing?.anno ?? currentYear}
                className="c-input"
              />
            </label>
            <label className="c-field">
              <span className="c-field__label">{t('admin.concorso.field_data_inizio')}</span>
              <input
                name="data_inizio"
                type="date"
                defaultValue={existing?.dataInizio ?? ''}
                className="c-input"
              />
            </label>
          </div>

          {existing && (
            <label className="c-field">
              <span className="c-field__label">{t('admin.concorso.field_stato')}</span>
              <select name="stato" className="c-input" defaultValue={existing.stato}>
                <option value="ATTIVO">ATTIVO</option>
                <option value="ARCHIVIATO">ARCHIVIATO</option>
              </select>
            </label>
          )}

          <label className="c-field">
            <span className="c-field__label">{t('admin.concorso.field_logo')}</span>
            <input
              ref={logoInputRef}
              name="logo"
              type="file"
              accept="image/*"
              className="c-input"
              onChange={onLogoChange}
            />
            {logoPreviewSrc && (
              <img
                src={logoPreviewSrc}
                alt=""
                className="mt-2 w-20 h-20 rounded-xl object-contain border border-brand-100"
              />
            )}
          </label>

          <label className="flex items-center gap-2 text-sm text-ink-700">
            <input
              name="anonimo"
              type="checkbox"
              defaultChecked={existing?.anonimo ?? false}
              className="rounded border-slate-300"
            />
            <span>{t('admin.concorso.field_anonimo')}</span>
          </label>

          <DialogFooter>
            <button
              type="button"
              className="c-btn c-btn--outline"
              onClick={() => onOpenChange(false)}
            >
              {t('common.cancel')}
            </button>
            <button type="submit" className="c-btn c-btn--primary" disabled={submitting}>
              {submitting ? '…' : isEdit ? t('common.save') : t('common.create')}
            </button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Delete confirm modal
// ---------------------------------------------------------------------------

interface DeleteDialogProps {
  concorso: Concorso | null;
  counts: { candidati: number; fasi: number; commissari: number };
  onClose: () => void;
}

function DeleteConcorsoDialog({ concorso, counts, onClose }: DeleteDialogProps) {
  const { t } = useTranslation();
  const deleteMutation = useDeleteConcorso();
  const [busy, setBusy] = useState(false);

  const onConfirm = async () => {
    if (!concorso) return;
    setBusy(true);
    try {
      try {
        await deleteMutation.mutateAsync({ id: concorso.id });
      } catch {
        // Server returns 409 when candidati/iscrizioni are linked → force.
        await deleteMutation.mutateAsync({ id: concorso.id, force: true });
      }
      toast.success(t('admin.concorso.deleted'));
      onClose();
    } catch (err) {
      toast.error(t('admin.concorso.delete_error', { msg: httpErrorMessage(err) }));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={!!concorso} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('admin.concorso.delete_title')}</DialogTitle>
        </DialogHeader>
        <p className="text-sm text-ink-700">
          {concorso
            ? t('admin.concorso.delete_msg', {
                nome: concorso.nome,
                candidati: counts.candidati,
                fasi: counts.fasi,
                commissari: counts.commissari,
              })
            : ''}
        </p>
        <DialogFooter>
          <button type="button" className="c-btn c-btn--outline" onClick={onClose}>
            {t('common.cancel')}
          </button>
          <button
            type="button"
            className="c-btn c-btn--danger"
            onClick={onConfirm}
            disabled={busy}
          >
            {busy ? '…' : t('common.delete')}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Compact variant — inline dropdown used in places that just need to switch the
// active concorso (e.g. the standalone Dashboard header). Rendered when no
// `onPick` callback is supplied, preserving the previous drop-in API.
// ---------------------------------------------------------------------------

function statoBadgeVariant(stato: Concorso['stato']): 'success' | 'warning' | 'muted' {
  if (stato === 'ATTIVO') return 'success';
  if (stato === 'CHIUSO') return 'muted';
  return 'warning';
}

function ConcorsoQuickSwitch({ className }: { className?: string }) {
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
      <SelectTrigger className={cn('w-52 truncate', className)} aria-label={t('admin.concorso.active')}>
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

// ---------------------------------------------------------------------------

interface ConcorsoSelectorProps {
  /**
   * Called when a card (or a freshly created/edited concorso) is entered.
   * When provided → full LIST/grid landing. When omitted → compact inline
   * dropdown (back-compat with the previous selector drop-in).
   */
  onPick?: (id: string) => void;
  /** Extra classes for the section / trigger wrapper. */
  className?: string;
}

export function ConcorsoSelector({ onPick, className }: ConcorsoSelectorProps) {
  const { t } = useTranslation();
  const { data: concorsi = [], isLoading } = useConcorsi();
  const { data: fasi = [] } = useTenantRows('fasi', 'fasi');
  const { data: candidati = [] } = useTenantRows('candidati', 'candidati');
  const { data: commissari = [] } = useTenantRows('commissari', 'commissari');

  const duplicaMutation = useDuplicaConcorso();

  const [createOpen, setCreateOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<Concorso | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Concorso | null>(null);
  // id del concorso in fase di duplicazione → disabilita il bottone della riga.
  const [duplicatingId, setDuplicatingId] = useState<string | null>(null);

  const handleDuplica = async (c: Concorso) => {
    setDuplicatingId(c.id);
    try {
      await duplicaMutation.mutateAsync(c.id);
      toast.success(t('admin.concorso.duplicated', 'Concorso duplicato'));
    } catch (err) {
      toast.error(httpErrorMessage(err));
    } finally {
      setDuplicatingId(null);
    }
  };

  // Group counts per concorso once (mirrors db.fasiByConcorso / candidatiByConcorso).
  const countsByConcorso = useMemo(() => {
    const map = new Map<string, { candidati: number; fasi: number; commissari: number }>();
    const bump = (id: string, key: 'candidati' | 'fasi' | 'commissari') => {
      const cur = map.get(id) ?? { candidati: 0, fasi: 0, commissari: 0 };
      cur[key] += 1;
      map.set(id, cur);
    };
    for (const f of fasi) bump(f.concorsoId, 'fasi');
    for (const c of candidati) bump(c.concorsoId, 'candidati');
    for (const cm of commissari) bump(cm.concorsoId, 'commissari');
    return map;
  }, [fasi, candidati, commissari]);

  const countsFor = (id: string) =>
    countsByConcorso.get(id) ?? { candidati: 0, fasi: 0, commissari: 0 };

  // No onPick → compact inline dropdown (e.g. Dashboard header).
  if (!onPick) {
    return <ConcorsoQuickSwitch className={className} />;
  }

  if (isLoading) {
    return (
      <section className={className}>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {[1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-40 rounded-2xl" />
          ))}
        </div>
      </section>
    );
  }

  return (
    <section className={`view-fade ${className ?? ''}`}>
      <header className="c-page-header max-w-7xl mx-auto">
        <p className="c-page-header__eyebrow">{t('admin.selector.eyebrow')}</p>
        <h1 className="c-page-header__title">{t('admin.selector.title')}</h1>
        <p className="c-page-header__sub">{t('admin.selector.subtitle')}</p>
      </header>

      <div className="c-page max-w-7xl mx-auto">
        <div className="flex items-center justify-end mb-3">
          <Link to="/" className="c-btn c-btn--outline c-btn--sm">
            {t('app.dashboard')}
          </Link>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {concorsi.map((c) => {
            const n = countsFor(c.id);
            return (
              <div
                key={c.id}
                className="bg-white border border-brand-100 rounded-2xl p-5 hover:shadow-soft transition-shadow group"
              >
                <div className="flex items-start justify-between gap-3 mb-3">
                  <div className="min-w-0 flex-1">
                    <p className="c-tile__eyebrow">{t('admin.selector.tile_eyebrow')}</p>
                    <h3 className="c-tile__title truncate">{c.nome}</h3>
                  </div>
                  <span className={statoTag(c.stato)}>{c.stato}</span>
                </div>
                <p className="text-xs text-muted-foreground mb-3">
                  {t('admin.selector.tile_year', { anno: c.anno })} · {n.candidati}{' '}
                  {t('home.concorsi.col_candidati').toLowerCase()} · {n.fasi}{' '}
                  {t('home.concorsi.col_fasi').toLowerCase()} · {n.commissari} commissari
                </p>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => onPick(c.id)}
                    className="flex-1 c-btn c-btn--primary c-btn--sm justify-center"
                  >
                    {t('admin.selector.open')} <ArrowRight size={14} />
                  </button>
                  <button
                    type="button"
                    onClick={(e) => { e.stopPropagation(); setEditTarget(c); }}
                    className="c-btn c-btn--ghost c-btn--sm !px-2"
                    title={t('common.edit')}
                  >
                    <Pencil size={14} />
                  </button>
                  <button
                    type="button"
                    onClick={(e) => { e.stopPropagation(); void handleDuplica(c); }}
                    disabled={duplicatingId === c.id}
                    className="c-btn c-btn--ghost c-btn--sm !px-2"
                    title={t('admin.concorso.duplicate', 'Duplica')}
                  >
                    <Copy size={14} />
                  </button>
                  <button
                    type="button"
                    onClick={(e) => { e.stopPropagation(); setDeleteTarget(c); }}
                    className="c-btn c-btn--ghost c-btn--sm !px-2 text-rose-600 hover:bg-rose-50"
                    title={t('common.delete')}
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              </div>
            );
          })}

          {/* Dashed "Nuovo concorso" tile */}
          <button
            type="button"
            onClick={() => setCreateOpen(true)}
            className="c-tile c-tile--padded c-tile--clickable flex flex-col items-center justify-center text-center"
            style={{ minHeight: '9rem', background: 'hsl(var(--accent))', borderStyle: 'dashed' }}
          >
            <span className="text-3xl font-light text-primary leading-none">
              <Plus size={28} />
            </span>
            <span className="mt-2 text-sm font-medium text-primary">
              {t('admin.selector.create_new')}
            </span>
          </button>
        </div>
      </div>

      {/* Create */}
      <ConcorsoFormDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        onSaved={(c) => onPick(c.id)}
      />

      {/* Edit */}
      <ConcorsoFormDialog
        open={!!editTarget}
        onOpenChange={(v) => { if (!v) setEditTarget(null); }}
        existing={editTarget}
      />

      {/* Delete */}
      <DeleteConcorsoDialog
        concorso={deleteTarget}
        counts={deleteTarget ? countsFor(deleteTarget.id) : { candidati: 0, fasi: 0, commissari: 0 }}
        onClose={() => setDeleteTarget(null)}
      />
    </section>
  );
}

export default ConcorsoSelector;
