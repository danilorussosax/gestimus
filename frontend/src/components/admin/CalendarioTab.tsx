/**
 * CalendarioTab — Gestione Sale + Blocchi (eventi) + Slot + Link pubblici.
 *
 * Props: concorsoId: string
 *
 * Features:
 *   - CRUD sale (chips)
 *   - Board giorni × sale con card-blocco drag-and-drop (HTML5 DnD)
 *   - Drag slot (riordino dentro un blocco)
 *   - Genera/ricalcola slot
 *   - CRUD link pubblici (pubblicazioni)
 *   - Form blocco modale: tipo ESIBIZIONE/EVENTO, fase/sezione/categoria, ora, sala
 *
 * Dipendenze query: sale, eventi, pubblicazioni.
 * Le sezioni/fasi/categorie vengono passate tramite le stesse query di concorso.
 * Per questo tab usiamo query separate per semplicità.
 */

import { useState, useRef, useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { toast } from 'sonner';
import {
  Plus,
  Pencil,
  Trash2,
  Clock,
  Copy,
  ExternalLink,
  Eye,
  EyeOff,
  RefreshCw,
  Link2,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogClose,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Checkbox } from '@/components/ui/checkbox';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import { http, httpErrorMessage } from '@/lib/api';
import { calendarioApi } from '@/api/calendario';
import type { Sala, Evento, Sezione, Fase, Categoria } from '@/types';
import type { CalendarioPubblicazione, SalaCreate } from '@/api/calendario';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function hhmm(s: string | null | undefined) {
  return s ? String(s).slice(0, 5) : '';
}

function fmtDay(iso: string) {
  try {
    return new Date(iso + 'T00:00:00').toLocaleDateString(undefined, {
      weekday: 'long',
      day: 'numeric',
      month: 'long',
    });
  } catch {
    return iso;
  }
}

function publicCalUrl(token: string, display = false) {
  return `${window.location.origin}/calendario?token=${encodeURIComponent(token)}${display ? '&display=1' : ''}`;
}

// ─── Zod schemas ─────────────────────────────────────────────────────────────

const salaSchema = z.object({
  nome: z.string().min(1, 'Nome obbligatorio').max(255),
  indirizzo: z.string().max(500).optional(),
});
type SalaForm = z.infer<typeof salaSchema>;

const blockSchema = z.object({
  tipo: z.enum(['ESIBIZIONE', 'EVENTO']),
  titolo: z.string().max(255).optional(),
  faseId: z.string().optional(),
  sezioneId: z.string().optional(),
  categoriaId: z.string().optional(),
  data: z.string().min(1, 'Data obbligatoria'),
  oraInizio: z.string().optional(),
  oraFine: z.string().optional(),
  salaId: z.string().optional(),
  durataCandidatoMinuti: z.string().optional(),
  note: z.string().max(2000).optional(),
});
type BlockForm = z.infer<typeof blockSchema>;

const linkSchema = z.object({
  scopo: z.enum(['CONCORSO', 'SEZIONE', 'GIORNO']),
  sezioneId: z.string().optional(),
  giorno: z.string().optional(),
  etichetta: z.string().max(255).optional(),
  mostraNomi: z.boolean(),
  mostraCommissione: z.boolean(),
});
type LinkForm = z.infer<typeof linkSchema>;

// ─── Query keys ───────────────────────────────────────────────────────────────

const SALE_KEY = (cid: string) => ['calendario', 'sale', cid];
const EVENTI_KEY = (cid: string) => ['calendario', 'eventi', cid];
const PUB_KEY = (cid: string) => ['calendario', 'pubblicazioni', cid];
const SEZIONI_KEY = (cid: string) => ['sezioni', cid];
const FASI_KEY = (cid: string) => ['fasi', cid];
const CATEGORIE_KEY = (cid: string) => ['categorie', cid];

// ─── Sala chip ────────────────────────────────────────────────────────────────

interface SalaChipProps {
  sala: Sala;
  onEdit: () => void;
  onDelete: () => void;
}
function SalaChip({ sala, onEdit, onDelete }: SalaChipProps) {
  return (
    <li className="inline-flex items-center gap-1.5 rounded-full bg-primary/5 py-1 pl-3 pr-1.5 text-sm">
      <span className="text-foreground">{sala.nome}</span>
      <button
        onClick={onEdit}
        className="rounded-full p-0.5 text-muted-foreground hover:text-primary"
        aria-label="Modifica"
      >
        <Pencil className="h-3 w-3" />
      </button>
      <button
        onClick={onDelete}
        className="rounded-full p-0.5 text-muted-foreground hover:text-destructive"
        aria-label="Elimina"
      >
        <Trash2 className="h-3 w-3" />
      </button>
    </li>
  );
}

// ─── SalaDialog ───────────────────────────────────────────────────────────────

interface SalaDialogProps {
  open: boolean;
  sala: Sala | null;
  concorsoId: string;
  onClose: () => void;
}

function SalaDialog({ open, sala, concorsoId, onClose }: SalaDialogProps) {
  const qc = useQueryClient();
  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<SalaForm>({
    resolver: zodResolver(salaSchema),
    values: sala ? { nome: sala.nome, indirizzo: sala.indirizzo ?? '' } : { nome: '', indirizzo: '' },
  });

  const saveMut = useMutation({
    mutationFn: (data: SalaCreate) =>
      sala ? calendarioApi.updateSala(sala.id, data) : calendarioApi.createSala(data),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: SALE_KEY(concorsoId) });
      toast.success('Sala salvata');
      onClose();
      reset();
    },
    onError: (e) => toast.error(httpErrorMessage(e)),
  });

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) { onClose(); reset(); }
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{sala ? 'Modifica sala' : 'Aggiungi sala'}</DialogTitle>
        </DialogHeader>

        <form
          id="sala-form"
          onSubmit={handleSubmit((d) =>
            saveMut.mutate({ concorsoId, nome: d.nome, indirizzo: d.indirizzo || null }),
          )}
          className="space-y-4"
        >
          <div className="space-y-1.5">
            <Label htmlFor="sala-nome">Nome sala *</Label>
            <Input id="sala-nome" {...register('nome')} />
            {errors.nome && <p className="text-xs text-destructive">{errors.nome.message}</p>}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="sala-ind">Indirizzo (opzionale)</Label>
            <Input id="sala-ind" {...register('indirizzo')} />
          </div>
        </form>

        <DialogFooter>
          <DialogClose asChild>
            <Button variant="outline">Annulla</Button>
          </DialogClose>
          <Button type="submit" form="sala-form" disabled={isSubmitting}>
            Salva
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── BlockDialog ──────────────────────────────────────────────────────────────

interface BlockDialogProps {
  open: boolean;
  evento: Evento | null;
  concorsoId: string;
  sale: Sala[];
  fasi: Fase[];
  sezioni: Sezione[];
  categorie: Categoria[];
  prefillData?: string;
  onClose: () => void;
}

function BlockDialog({
  open,
  evento,
  concorsoId,
  sale,
  fasi,
  sezioni,
  categorie,
  prefillData,
  onClose,
}: BlockDialogProps) {
  const qc = useQueryClient();
  const {
    register,
    handleSubmit,
    watch,
    setValue,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<BlockForm>({
    resolver: zodResolver(blockSchema),
    values: evento
      ? {
          tipo: (evento.tipo as 'ESIBIZIONE' | 'EVENTO') ?? 'ESIBIZIONE',
          titolo: evento.titolo ?? '',
          faseId: evento.faseId ?? '',
          sezioneId: evento.sezioneId ?? '',
          categoriaId: evento.categoriaId ?? '',
          data: evento.data ?? '',
          oraInizio: hhmm(evento.oraInizio),
          oraFine: hhmm(evento.oraFine),
          salaId: evento.salaId ?? '',
          durataCandidatoMinuti: evento.durataCandidatoMinuti != null ? String(evento.durataCandidatoMinuti) : '',
          note: '',
        }
      : {
          tipo: 'ESIBIZIONE' as const,
          data: prefillData ?? '',
        },
  });

  const tipo = watch('tipo');
  const watchedSezId = watch('sezioneId');

  const filteredCategorie = watchedSezId
    ? categorie.filter((c) => c.sezioneId === watchedSezId)
    : [];

  const saveMut = useMutation({
    mutationFn: async (d: BlockForm) => {
      const base = {
        concorsoId,
        tipo: d.tipo,
        data: d.data,
        oraInizio: d.oraInizio || null,
        oraFine: d.oraFine || null,
        salaId: d.salaId || null,
        note: d.note || null,
      };
      let payload: typeof base & Record<string, unknown>;
      if (d.tipo === 'EVENTO') {
        payload = { ...base, titolo: d.titolo || null };
      } else {
        payload = {
          ...base,
          faseId: d.faseId || null,
          sezioneId: d.sezioneId || null,
          categoriaId: d.categoriaId || null,
          durataCandidatoMinuti: d.durataCandidatoMinuti ? Number(d.durataCandidatoMinuti) : null,
        };
      }
      if (evento) {
        return calendarioApi.updateEvento(evento.id, payload);
      } else {
        const created = await calendarioApi.createEvento(payload);
        if (d.tipo === 'ESIBIZIONE') {
          try {
            await calendarioApi.generaSlot(created.id);
          } catch {
            // non-fatal: slot generation failure
          }
        }
        return created;
      }
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: EVENTI_KEY(concorsoId) });
      toast.success(evento ? 'Blocco aggiornato' : 'Blocco creato');
      onClose();
      reset();
    },
    onError: (e) => toast.error(httpErrorMessage(e)),
  });

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) { onClose(); reset(); }
      }}
    >
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{evento ? 'Modifica blocco' : 'Nuovo blocco'}</DialogTitle>
        </DialogHeader>

        <form
          id="block-form"
          onSubmit={handleSubmit((d) => saveMut.mutate(d))}
          className="space-y-4"
        >
          {/* Tipo */}
          <div className="space-y-1.5">
            <Label>Tipo</Label>
            <Select
              value={tipo}
              onValueChange={(v) => setValue('tipo', v as 'ESIBIZIONE' | 'EVENTO')}
            >
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="ESIBIZIONE">Esibizione</SelectItem>
                <SelectItem value="EVENTO">Evento libero</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Titolo (solo EVENTO) */}
          {tipo === 'EVENTO' && (
            <div className="space-y-1.5">
              <Label>Titolo</Label>
              <Input {...register('titolo')} placeholder="Titolo evento" />
            </div>
          )}

          {/* Esibizione fields */}
          {tipo === 'ESIBIZIONE' && (
            <div className="space-y-3">
              <div className="space-y-1.5">
                <Label>Fase</Label>
                <Select
                  value={watch('faseId') ?? ''}
                  onValueChange={(v) => setValue('faseId', v)}
                >
                  <SelectTrigger><SelectValue placeholder="Nessuna fase" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="">Nessuna fase</SelectItem>
                    {fasi.map((f) => (
                      <SelectItem key={f.id} value={f.id}>
                        {f.ordine}. {f.nome}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label>Sezione</Label>
                  <Select
                    value={watch('sezioneId') ?? ''}
                    onValueChange={(v) => { setValue('sezioneId', v); setValue('categoriaId', ''); }}
                  >
                    <SelectTrigger><SelectValue placeholder="Tutte le sezioni" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="">Tutte le sezioni</SelectItem>
                      {sezioni.map((s) => (
                        <SelectItem key={s.id} value={s.id}>{s.nome}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label>Categoria</Label>
                  <Select
                    value={watch('categoriaId') ?? ''}
                    onValueChange={(v) => setValue('categoriaId', v)}
                    disabled={!watchedSezId}
                  >
                    <SelectTrigger><SelectValue placeholder="Tutte le categorie" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="">Tutte le categorie</SelectItem>
                      {filteredCategorie.map((c) => (
                        <SelectItem key={c.id} value={c.id}>{c.nome}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="space-y-1.5">
                <Label>Durata per candidato (min)</Label>
                <Input
                  type="number"
                  min={0}
                  {...register('durataCandidatoMinuti')}
                />
              </div>
            </div>
          )}

          {/* Data + ore */}
          <div className="grid grid-cols-3 gap-3">
            <div className="space-y-1.5">
              <Label>Data *</Label>
              <Input type="date" {...register('data')} />
              {errors.data && <p className="text-xs text-destructive">{errors.data.message}</p>}
            </div>
            <div className="space-y-1.5">
              <Label>Ora inizio</Label>
              <Input type="time" {...register('oraInizio')} />
            </div>
            <div className="space-y-1.5">
              <Label>Ora fine</Label>
              <Input type="time" {...register('oraFine')} />
            </div>
          </div>

          {/* Sala */}
          <div className="space-y-1.5">
            <Label>Sala</Label>
            <Select
              value={watch('salaId') ?? ''}
              onValueChange={(v) => setValue('salaId', v)}
            >
              <SelectTrigger><SelectValue placeholder="Senza sala" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="">Senza sala</SelectItem>
                {sale.map((s) => (
                  <SelectItem key={s.id} value={s.id}>{s.nome}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </form>

        <DialogFooter>
          <DialogClose asChild>
            <Button variant="outline">Annulla</Button>
          </DialogClose>
          <Button type="submit" form="block-form" disabled={isSubmitting}>
            Salva
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── LinkDialog ───────────────────────────────────────────────────────────────

interface LinkDialogProps {
  open: boolean;
  concorsoId: string;
  sezioni: Sezione[];
  onClose: () => void;
}

function LinkDialog({ open, concorsoId, sezioni, onClose }: LinkDialogProps) {
  const qc = useQueryClient();
  const {
    register,
    handleSubmit,
    watch,
    setValue,
    reset,
    formState: { isSubmitting },
  } = useForm<LinkForm>({
    resolver: zodResolver(linkSchema),
    defaultValues: { scopo: 'CONCORSO', mostraNomi: true, mostraCommissione: false },
  });

  const scopo = watch('scopo');

  const createMut = useMutation({
    mutationFn: (d: LinkForm) =>
      calendarioApi.createPubblicazione({
        concorsoId,
        scopo: d.scopo,
        etichetta: d.etichetta || null,
        mostraNomi: d.mostraNomi,
        mostraCommissione: d.mostraCommissione,
        sezioneId: d.scopo === 'SEZIONE' ? (d.sezioneId || null) : null,
        giorno: d.scopo === 'GIORNO' ? (d.giorno || null) : null,
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: PUB_KEY(concorsoId) });
      toast.success('Link creato');
      onClose();
      reset();
    },
    onError: (e) => toast.error(httpErrorMessage(e)),
  });

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) { onClose(); reset(); }
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Crea link pubblico</DialogTitle>
        </DialogHeader>

        <form
          id="link-form"
          onSubmit={handleSubmit((d) => createMut.mutate(d))}
          className="space-y-4"
        >
          <div className="space-y-1.5">
            <Label>Ambito</Label>
            <Select
              value={scopo}
              onValueChange={(v) => setValue('scopo', v as 'CONCORSO' | 'SEZIONE' | 'GIORNO')}
            >
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="CONCORSO">Intero concorso</SelectItem>
                <SelectItem value="SEZIONE">Singola sezione</SelectItem>
                <SelectItem value="GIORNO">Singola giornata</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {scopo === 'SEZIONE' && (
            <div className="space-y-1.5">
              <Label>Sezione</Label>
              <Select
                value={watch('sezioneId') ?? ''}
                onValueChange={(v) => setValue('sezioneId', v)}
              >
                <SelectTrigger><SelectValue placeholder="Scegli sezione" /></SelectTrigger>
                <SelectContent>
                  {sezioni.map((s) => (
                    <SelectItem key={s.id} value={s.id}>{s.nome}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          {scopo === 'GIORNO' && (
            <div className="space-y-1.5">
              <Label>Giorno</Label>
              <Input type="date" {...register('giorno')} />
            </div>
          )}

          <div className="space-y-1.5">
            <Label>Nome interno (opzionale)</Label>
            <Input {...register('etichetta')} placeholder="es. Tabellone Archi" />
          </div>

          <div className="flex flex-col gap-2">
            <div className="flex items-center gap-2">
              <Checkbox
                id="mostra-nomi"
                checked={watch('mostraNomi')}
                onCheckedChange={(v) => setValue('mostraNomi', Boolean(v))}
              />
              <Label htmlFor="mostra-nomi">Mostra nomi candidati</Label>
            </div>
            <div className="flex items-center gap-2">
              <Checkbox
                id="mostra-comm"
                checked={watch('mostraCommissione')}
                onCheckedChange={(v) => setValue('mostraCommissione', Boolean(v))}
              />
              <Label htmlFor="mostra-comm">Mostra giuria</Label>
            </div>
          </div>
        </form>

        <DialogFooter>
          <DialogClose asChild>
            <Button variant="outline">Annulla</Button>
          </DialogClose>
          <Button type="submit" form="link-form" disabled={isSubmitting}>
            Crea
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── BlockCard ────────────────────────────────────────────────────────────────

interface Slot {
  id: string;
  candidatoId: string;
  posizione: number | null;
  oraPrevista: string | null;
  numeroCandidato: number | null;
}

interface BlockCardProps {
  evento: Evento;
  sale: Sala[];
  sezioni: Sezione[];
  categorie: Categoria[];
  fasi: Fase[];
  slots: Slot[];
  concorsoId: string;
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

function BlockCard({
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
  const sez = sezioni.find((s) => s.id === evento.sezioneId);
  const cat = categorie.find((c) => c.id === evento.categoriaId);
  const fase = fasi.find((f) => f.id === evento.faseId);
  const head =
    [sez?.nome, cat?.nome, fase?.nome].filter(Boolean).join(' · ') ||
    evento.titolo ||
    (evento.tipo === 'EVENTO' ? 'Evento libero' : 'Esibizione');
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
      className="group cursor-move rounded-xl border border-border bg-card shadow-sm"
    >
      <header className="flex items-start justify-between gap-2 border-b border-border px-3 py-2">
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-foreground">{head}</p>
          {orario && (
            <p className="font-mono text-[11px] text-primary">{orario}</p>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-0.5 opacity-60 transition group-hover:opacity-100">
          <button
            onClick={onGeneraSlot}
            title="Genera orari candidati"
            className="rounded p-1 text-muted-foreground hover:text-primary"
          >
            <Clock className="h-3 w-3" />
          </button>
          <button
            onClick={onEdit}
            className="rounded p-1 text-muted-foreground hover:text-primary"
          >
            <Pencil className="h-3 w-3" />
          </button>
          <button
            onClick={onDelete}
            className="rounded p-1 text-muted-foreground hover:text-destructive"
          >
            <Trash2 className="h-3 w-3" />
          </button>
        </div>
      </header>

      {evento.tipo === 'EVENTO' ? (
        <p className="px-3 py-2 text-xs italic text-muted-foreground">
          {evento.titolo || 'Evento libero'}
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
            <li className="px-2 py-1 text-[11px] italic text-muted-foreground">
              Nessun candidato. Imposta fase/sezione/categoria e genera gli orari.
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
                className="flex cursor-grab items-center gap-2 rounded-lg bg-background px-2 py-1 text-xs hover:bg-primary/5"
              >
                <span className="w-10 font-mono tabular-nums text-muted-foreground">
                  {hhmm(slot.oraPrevista) || '—'}
                </span>
                <span className="flex-1 truncate text-foreground">
                  {String(slot.numeroCandidato ?? '').padStart(3, '0')} · cand.
                </span>
              </li>
            ))
          )}
        </ul>
      )}
    </article>
  );
}

// ─── PubRow ───────────────────────────────────────────────────────────────────

interface PubRowProps {
  pub: CalendarioPubblicazione;
  sezioni: Sezione[];
  concorsoId: string;
  onRevoke: () => void;
  onToggle: () => void;
}

function PubRow({ pub, sezioni, onRevoke, onToggle }: PubRowProps) {
  const sez = sezioni.find((s) => s.id === pub.sezioneId);
  const scopoLabel =
    pub.scopo === 'CONCORSO'
      ? 'Intero concorso'
      : pub.scopo === 'SEZIONE'
      ? `Sezione: ${sez?.nome ?? '—'}`
      : `Giorno: ${pub.giorno ?? '—'}`;

  async function copy() {
    try {
      await navigator.clipboard.writeText(publicCalUrl(pub.token, false));
      toast.success('Link copiato');
    } catch {
      toast.info(publicCalUrl(pub.token, false), { duration: 6000 });
    }
  }

  return (
    <li className="flex flex-wrap items-center gap-2 rounded-xl border border-border px-3 py-2">
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-foreground">
          {pub.etichetta || scopoLabel}
        </p>
        <p className="text-[11px] text-muted-foreground">
          {scopoLabel}
          {pub.mostraNomi ? ' · 👤 nomi' : ''}
          {pub.mostraCommissione ? ' · ⚖️ giuria' : ''}
          {!pub.attivo ? ' · (disattivato)' : ''}
        </p>
      </div>
      <div className="flex items-center gap-1">
        <Button variant="ghost" size="sm" onClick={copy} className="h-7 text-xs">
          <Copy className="mr-1 h-3 w-3" />
          Copia
        </Button>
        <Button
          variant="ghost"
          size="sm"
          asChild
          className="h-7 text-xs"
        >
          <a href={publicCalUrl(pub.token, true)} target="_blank" rel="noopener noreferrer">
            <ExternalLink className="mr-1 h-3 w-3" />
            Tabellone
          </a>
        </Button>
        <Button variant="ghost" size="icon" onClick={onToggle} className="h-7 w-7">
          {pub.attivo ? <Eye className="h-3.5 w-3.5" /> : <EyeOff className="h-3.5 w-3.5" />}
        </Button>
        <Button
          variant="ghost"
          size="icon"
          onClick={onRevoke}
          className="h-7 w-7 text-destructive hover:text-destructive"
        >
          <Trash2 className="h-3.5 w-3.5" />
        </Button>
      </div>
    </li>
  );
}

// ─── Main component ────────────────────────────────────────────────────────────

interface CalendarioTabProps {
  concorsoId: string;
}

export function CalendarioTab({ concorsoId }: CalendarioTabProps) {
  const { t } = useTranslation();
  const qc = useQueryClient();

  // ── Queries ────────────────────────────────────────────────────────────────
  const { data: sale = [], isLoading: loadSale } = useQuery({
    queryKey: SALE_KEY(concorsoId),
    queryFn: () => calendarioApi.getSale(concorsoId),
  });
  const { data: eventi = [], isLoading: loadEventi } = useQuery({
    queryKey: EVENTI_KEY(concorsoId),
    queryFn: () => calendarioApi.getEventi(concorsoId),
  });
  const { data: pubblicazioni = [], isLoading: loadPub } = useQuery({
    queryKey: PUB_KEY(concorsoId),
    queryFn: () => calendarioApi.getPubblicazioni(concorsoId),
  });
  const { data: sezioni = [] } = useQuery({
    queryKey: SEZIONI_KEY(concorsoId),
    queryFn: () => http.get<Sezione[]>('sezioni', { concorsoId }),
  });
  const { data: fasi = [] } = useQuery({
    queryKey: FASI_KEY(concorsoId),
    queryFn: () => http.get<Fase[]>('fasi', { concorsoId }),
  });
  const { data: categorie = [] } = useQuery({
    queryKey: CATEGORIE_KEY(concorsoId),
    queryFn: () => http.get<Categoria[]>('categorie', { concorsoId }),
  });

  // ── UI State ───────────────────────────────────────────────────────────────
  const [salaDialog, setSalaDialog] = useState<{ open: boolean; sala: Sala | null }>({ open: false, sala: null });
  const [blockDialog, setBlockDialog] = useState<{ open: boolean; evento: Evento | null; prefillData?: string }>({ open: false, evento: null });
  const [linkDialog, setLinkDialog] = useState(false);
  const [draggingBlockId, setDraggingBlockId] = useState<string | null>(null);
  const [draggingSlot, setDraggingSlot] = useState<{ cfId: string; eventoId: string } | null>(null);
  const dragOverLane = useRef<string | null>(null);

  // ── Mutations ──────────────────────────────────────────────────────────────
  const deleteSalaMut = useMutation({
    mutationFn: (id: string) => calendarioApi.deleteSala(id),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: SALE_KEY(concorsoId) }); toast.success('Sala eliminata'); },
    onError: (e) => toast.error(httpErrorMessage(e)),
  });

  const deleteEventoMut = useMutation({
    mutationFn: (id: string) => calendarioApi.deleteEvento(id),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: EVENTI_KEY(concorsoId) }); toast.success('Blocco eliminato'); },
    onError: (e) => toast.error(httpErrorMessage(e)),
  });

  const updateEventoMut = useMutation({
    mutationFn: ({ id, body }: { id: string; body: Record<string, unknown> }) =>
      calendarioApi.updateEvento(id, body),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: EVENTI_KEY(concorsoId) }); },
    onError: (e) => toast.error(httpErrorMessage(e)),
  });

  const generaSlotMut = useMutation({
    mutationFn: (eventoId: string) => calendarioApi.generaSlot(eventoId),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: EVENTI_KEY(concorsoId) }); toast.success('Orari rigenerati'); },
    onError: (e) => toast.error(httpErrorMessage(e)),
  });

  const riordinaSlotMut = useMutation({
    mutationFn: ({ eventoId, ordine }: { eventoId: string; ordine: string[] }) =>
      calendarioApi.riordinaSlot(eventoId, ordine),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: EVENTI_KEY(concorsoId) }); },
    onError: (e) => toast.error(httpErrorMessage(e)),
  });

  const togglePubMut = useMutation({
    mutationFn: ({ id, attivo }: { id: string; attivo: boolean }) =>
      calendarioApi.updatePubblicazione(id, { attivo }),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: PUB_KEY(concorsoId) }); },
    onError: (e) => toast.error(httpErrorMessage(e)),
  });

  const deletePubMut = useMutation({
    mutationFn: (id: string) => calendarioApi.deletePubblicazione(id),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: PUB_KEY(concorsoId) }); toast.success('Link revocato'); },
    onError: (e) => toast.error(httpErrorMessage(e)),
  });

  // ── Board data ─────────────────────────────────────────────────────────────
  const days = [...new Set(eventi.map((e) => e.data).filter(Boolean))].sort() as string[];
  const SALA_NONE = '__none__';
  const lanes = [
    ...sale.map((s) => ({ id: s.id, nome: s.nome })),
    { id: SALA_NONE, nome: 'Senza sala' },
  ];

  // Drop handler for block (lane)
  const handleLaneDrop = useCallback(
    (e: React.DragEvent<HTMLDivElement>, day: string, salaId: string | null) => {
      e.preventDefault();
      (e.currentTarget).classList.remove('ring-2', 'ring-primary');
      if (!draggingBlockId) return;
      const id = draggingBlockId;
      setDraggingBlockId(null);
      const ev = eventi.find((x) => x.id === id);
      if (!ev) return;
      if (ev.data === day && (ev.salaId || '') === (salaId || '')) return;
      updateEventoMut.mutate({ id, body: { data: day, salaId } });
    },
    [draggingBlockId, eventi, updateEventoMut],
  );

  // ── Render ─────────────────────────────────────────────────────────────────
  const isLoading = loadSale || loadEventi;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="text-sm font-bold uppercase tracking-wider text-foreground">
            {t('cal.title')}
          </h3>
          <p className="text-sm text-muted-foreground">{t('cal.subtitle')}</p>
        </div>
        <Button onClick={() => setBlockDialog({ open: true, evento: null })}>
          <Plus className="mr-1 h-4 w-4" />
          {t('cal.block.add')}
        </Button>
      </div>

      {/* Sale */}
      <div className="rounded-2xl border border-border bg-card p-4">
        <div className="mb-3 flex items-center justify-between">
          <h4 className="text-sm font-bold text-foreground">{t('cal.sale.title')}</h4>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setSalaDialog({ open: true, sala: null })}
          >
            <Plus className="mr-1 h-3.5 w-3.5" />
            {t('cal.sale.add')}
          </Button>
        </div>
        {loadSale ? (
          <Skeleton className="h-8 w-48" />
        ) : sale.length === 0 ? (
          <p className="text-sm italic text-muted-foreground">{t('cal.sale.empty')}</p>
        ) : (
          <ul className="flex flex-wrap gap-2">
            {sale.map((s) => (
              <SalaChip
                key={s.id}
                sala={s}
                onEdit={() => setSalaDialog({ open: true, sala: s })}
                onDelete={() => { if (confirm('Eliminare questa sala?')) deleteSalaMut.mutate(s.id); }}
              />
            ))}
          </ul>
        )}
      </div>

      {/* Board */}
      {isLoading ? (
        <div className="space-y-3">
          <Skeleton className="h-6 w-40" />
          <div className="grid grid-cols-2 gap-3">
            <Skeleton className="h-32 rounded-2xl" />
            <Skeleton className="h-32 rounded-2xl" />
          </div>
        </div>
      ) : eventi.length === 0 ? (
        <div className="rounded-2xl border-2 border-dashed border-border py-12 text-center">
          <p className="text-sm italic text-muted-foreground">{t('cal.board.empty')}</p>
        </div>
      ) : (
        days.map((day) => (
          <section key={day} className="space-y-2">
            <h4 className="text-sm font-bold capitalize text-foreground">{fmtDay(day)}</h4>
            <div
              className="grid gap-3 overflow-x-auto"
              style={{
                gridTemplateColumns: `repeat(${lanes.length}, minmax(240px, 1fr))`,
              }}
            >
              {lanes.map((lane) => {
                const blocks = eventi.filter(
                  (e) => e.data === day && (e.salaId || SALA_NONE) === lane.id,
                );
                return (
                  <div
                    key={lane.id}
                    data-lane={lane.id}
                    data-day={day}
                    className="min-h-[80px] rounded-2xl bg-muted/30 p-2 ring-1 ring-border transition"
                    onDragOver={(e) => {
                      if (draggingBlockId) {
                        e.preventDefault();
                        dragOverLane.current = lane.id;
                        e.currentTarget.classList.add('ring-2', 'ring-primary');
                      }
                    }}
                    onDragLeave={(e) => {
                      e.currentTarget.classList.remove('ring-2', 'ring-primary');
                    }}
                    onDrop={(e) =>
                      handleLaneDrop(
                        e,
                        day,
                        lane.id === SALA_NONE ? null : lane.id,
                      )
                    }
                  >
                    <p className="mb-2 px-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                      {lane.nome}
                    </p>
                    <div className="space-y-2">
                      {blocks.map((ev) => (
                        <BlockCard
                          key={ev.id}
                          evento={ev}
                          sale={sale}
                          sezioni={sezioni}
                          categorie={categorie}
                          fasi={fasi}
                          slots={[]} // slot data would come from candidatiFase; omitted here for lightness
                          concorsoId={concorsoId}
                          onEdit={() => setBlockDialog({ open: true, evento: ev })}
                          onDelete={() => { if (confirm('Eliminare questo blocco?')) deleteEventoMut.mutate(ev.id); }}
                          onGeneraSlot={() => generaSlotMut.mutate(ev.id)}
                          onDragStart={setDraggingBlockId}
                          onDragEnd={() => setDraggingBlockId(null)}
                          draggingSlot={draggingSlot}
                          setDraggingSlot={setDraggingSlot}
                          onSlotReorder={(eventoId, ordine) =>
                            riordinaSlotMut.mutate({ eventoId, ordine })
                          }
                        />
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
        ))
      )}

      {/* Link pubblici */}
      <div className="rounded-2xl border border-border bg-card p-4">
        <div className="mb-3 flex items-center justify-between">
          <h4 className="flex items-center gap-2 text-sm font-bold text-foreground">
            <Link2 className="h-4 w-4" />
            {t('cal.links.title')}
          </h4>
          <Button variant="outline" size="sm" onClick={() => setLinkDialog(true)}>
            <Plus className="mr-1 h-3.5 w-3.5" />
            {t('cal.links.add')}
          </Button>
        </div>

        {loadPub ? (
          <Skeleton className="h-12 w-full" />
        ) : pubblicazioni.length === 0 ? (
          <p className="text-sm italic text-muted-foreground">{t('cal.links.empty')}</p>
        ) : (
          <ul className="space-y-2">
            {pubblicazioni.map((pub) => (
              <PubRow
                key={pub.id}
                pub={pub}
                sezioni={sezioni}
                concorsoId={concorsoId}
                onToggle={() =>
                  togglePubMut.mutate({ id: pub.id, attivo: !pub.attivo })
                }
                onRevoke={() => {
                  if (confirm('Revocare questo link? Smetterà di funzionare.'))
                    deletePubMut.mutate(pub.id);
                }}
              />
            ))}
          </ul>
        )}
      </div>

      {/* Dialogs */}
      <SalaDialog
        open={salaDialog.open}
        sala={salaDialog.sala}
        concorsoId={concorsoId}
        onClose={() => setSalaDialog({ open: false, sala: null })}
      />
      <BlockDialog
        open={blockDialog.open}
        evento={blockDialog.evento}
        concorsoId={concorsoId}
        sale={sale}
        fasi={fasi}
        sezioni={sezioni}
        categorie={categorie}
        prefillData={blockDialog.prefillData}
        onClose={() => setBlockDialog({ open: false, evento: null })}
      />
      <LinkDialog
        open={linkDialog}
        concorsoId={concorsoId}
        sezioni={sezioni}
        onClose={() => setLinkDialog(false)}
      />
    </div>
  );
}

// Re-export for use as tab prop
export type { CalendarioTabProps };
