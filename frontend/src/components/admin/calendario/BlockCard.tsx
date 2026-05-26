import { useTranslation } from 'react-i18next';
import { Clock, Pencil, Trash2, GripVertical } from 'lucide-react';
import type { Evento, Sezione, Categoria, Fase } from '@/types';
import { hhmm } from '../calendario-utils';
import type { Slot } from '../calendario-schemas';

export interface BlockCardProps {
  evento: Evento;
  sezioni: Sezione[];
  categorie: Categoria[];
  fasi: Fase[];
  slots: Slot[];
  onEdit: () => void;
  onDelete: () => void;
  onGeneraSlot: () => void;
  onDragStart: (id: string) => void;
  onDragEnd: () => void;
  // Slot drag
  draggingSlot: { cfId: string; eventoId: string } | null;
  setDraggingSlot: (s: { cfId: string; eventoId: string } | null) => void;
  onSlotReorder: (eventoId: string, orderedIds: string[]) => void;
}

export function BlockCard({
  evento,
  sezioni,
  categorie,
  fasi,
  slots,
  onEdit,
  onDelete,
  onGeneraSlot,
  onDragStart,
  onDragEnd,
  draggingSlot,
  setDraggingSlot,
  onSlotReorder,
}: BlockCardProps) {
  const { t } = useTranslation();
  const sez = evento.sezioneId ? sezioni.find((s) => s.id === evento.sezioneId) : null;
  const cat = evento.categoriaId ? categorie.find((c) => c.id === evento.categoriaId) : null;
  const fase = evento.faseId ? fasi.find((f) => f.id === evento.faseId) : null;
  const head =
    [sez?.nome, cat?.nome, fase?.nome].filter(Boolean).join(' · ') ||
    evento.titolo ||
    (evento.tipo === 'EVENTO' ? t('cal.block.tipo.evento') : t('cal.block.tipo.esibizione'));
  const orario = [hhmm(evento.oraInizio), hhmm(evento.oraFine)].filter(Boolean).join('–');

  return (
    <article
      data-block-id={evento.id}
      draggable
      onDragStart={(e) => {
        onDragStart(evento.id);
        e.dataTransfer.effectAllowed = 'move';
        try { e.dataTransfer.setData('text/plain', evento.id); } catch { /* noop */ }
      }}
      onDragEnd={onDragEnd}
      className="group cursor-move rounded-xl bg-white ring-1 shadow-soft"
      style={{ '--tw-ring-color': 'hsl(var(--border))' } as React.CSSProperties}
    >
      <header
        className="flex items-start justify-between gap-2 px-3 py-2"
        style={{ borderBottom: '1px solid hsl(var(--border))' }}
      >
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold" style={{ color: 'hsl(var(--foreground))' }}>{head}</p>
          {orario && (
            <p className="font-mono text-[11px]" style={{ color: 'hsl(var(--primary))' }}>{orario}</p>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-0.5 opacity-60 transition group-hover:opacity-100">
          <button
            type="button"
            onClick={onGeneraSlot}
            title={t('cal.block.genera')}
            className="p-1"
            style={{ color: 'hsl(var(--muted-foreground))' }}
            onMouseOver={(e) => (e.currentTarget.style.color = 'hsl(var(--primary))')}
            onMouseOut={(e) => (e.currentTarget.style.color = 'hsl(var(--muted-foreground))')}
          >
            <Clock className="h-[13px] w-[13px]" />
          </button>
          <button
            type="button"
            onClick={onEdit}
            className="p-1"
            style={{ color: 'hsl(var(--muted-foreground))' }}
            onMouseOver={(e) => (e.currentTarget.style.color = 'hsl(var(--primary))')}
            onMouseOut={(e) => (e.currentTarget.style.color = 'hsl(var(--muted-foreground))')}
          >
            <Pencil className="h-[13px] w-[13px]" />
          </button>
          <button
            type="button"
            onClick={onDelete}
            className="p-1"
            style={{ color: 'hsl(var(--muted-foreground))' }}
            onMouseOver={(e) => (e.currentTarget.style.color = 'hsl(var(--destructive))')}
            onMouseOut={(e) => (e.currentTarget.style.color = 'hsl(var(--muted-foreground))')}
          >
            <Trash2 className="h-[13px] w-[13px]" />
          </button>
        </div>
      </header>

      {evento.tipo === 'EVENTO' ? (
        <p className="px-3 py-2 text-xs italic" style={{ color: 'hsl(var(--muted-foreground))' }}>
          {evento.titolo || t('cal.block.tipo.evento')}
        </p>
      ) : (
        <ul
          data-slotlist={evento.id}
          className="min-h-[28px] space-y-1 p-1.5"
          onDragOver={(e) => {
            if (draggingSlot?.eventoId === evento.id) e.preventDefault();
          }}
          onDrop={(e) => {
            if (draggingSlot?.eventoId !== evento.id) return;
            e.preventDefault();
            const targetLi = (e.target as HTMLElement).closest<HTMLElement>('[data-slot-id]');
            const beforeId = targetLi?.dataset.slotId ?? null;
            const movingId = draggingSlot.cfId;
            setDraggingSlot(null);
            if (beforeId === movingId) return;
            const ids = slots.map((s) => s.id);
            const from = ids.indexOf(movingId);
            if (from < 0) return;
            ids.splice(from, 1);
            const to = beforeId ? ids.indexOf(beforeId) : ids.length;
            ids.splice(to < 0 ? ids.length : to, 0, movingId);
            onSlotReorder(evento.id, ids);
          }}
        >
          {slots.length === 0 ? (
            <li className="px-2 py-1 text-[11px] italic" style={{ color: 'hsl(var(--muted-foreground))' }}>
              {t('cal.block.nessuno_slot')}
            </li>
          ) : (
            slots.map((slot) => (
              <li
                key={slot.id}
                data-slot-id={slot.id}
                draggable
                onDragStart={(e) => {
                  e.stopPropagation();
                  setDraggingSlot({ cfId: slot.id, eventoId: evento.id });
                  e.dataTransfer.effectAllowed = 'move';
                  try { e.dataTransfer.setData('text/plain', slot.id); } catch { /* noop */ }
                }}
                onDragEnd={() => setDraggingSlot(null)}
                className="flex cursor-grab items-center gap-2 rounded-lg px-2 py-1 text-xs hover:bg-primary/5"
                style={{ background: 'hsl(var(--background))' }}
              >
                <span style={{ color: 'hsl(var(--muted-foreground))' }}>
                  <GripVertical className="h-3 w-3" />
                </span>
                <span className="w-10 font-mono tabular-nums" style={{ color: 'hsl(var(--muted-foreground))' }}>
                  {hhmm(slot.oraPrevista) || '—'}
                </span>
                <span className="flex-1 truncate" style={{ color: 'hsl(var(--foreground))' }}>
                  {slot.label}
                </span>
              </li>
            ))
          )}
        </ul>
      )}
    </article>
  );
}
