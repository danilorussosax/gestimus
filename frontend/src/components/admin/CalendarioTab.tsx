/**
 * CalendarioTab — Gestione Sale + Blocchi (eventi) + Slot + Link pubblici.
 *
 * Ricostruzione fedele della vista vanilla `js/views/admin/calendario.js`
 * (+ `js/calendario-pdf.js`). Board drag-and-drop a due livelli:
 *   - card-blocco (eventi_calendario) trascinabile tra lane giorno × sala
 *   - card-candidato (slot) trascinabile per riordinare dentro il blocco
 * In entrambi i casi gli orari individuali si ricalcolano lato server.
 *
 * Props: concorsoId: string
 *
 * Feature (1:1 con la vista vanilla):
 *   - Header: titolo/sottotitolo, bottone "Scarica PDF", bottone "Nuovo blocco"
 *   - Sale: chips con edit/delete + modale CRUD (nome, indirizzo)
 *   - Board: giorni × lane (ogni sala + "senza sala"), card-blocco ESIBIZIONE/EVENTO
 *     con drag tra lane (sposta data/sala → server ricalcola), azioni
 *     genera-slot / edit / delete per card
 *   - Slot list per card ESIBIZIONE con drag-reorder (riordina-slot)
 *   - Form blocco: tipo (cascade EVENTO/ESIBIZIONE), fase/sezione/categoria
 *     (categorie dipendono dalla sezione), durata, data, ore, sala, note
 *   - Link pubblici: create (scopo CONCORSO/SEZIONE/GIORNO + flag), copy,
 *     tabellone (display), toggle attivo, revoke
 *   - Export PDF intero concorso (giorni → blocchi → slot + giuria)
 *
 * Dipendenze query (@/api/calendario): sale, eventi, pubblicazioni; più
 * sezioni/fasi/categorie/candidati/candidati-fase per popolare board+slot e
 * concorso/commissari/commissioni per il PDF.
 */

import { useState, useCallback, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient, useQueries } from '@tanstack/react-query';
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
  Download,
  GripVertical,
} from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  DialogClose,
} from '@/components/ui/dialog';
import { cn } from '@/lib/utils';
import { faseFullLabel } from '@/lib/fase-label';
import { http, httpErrorMessage } from '@/lib/api';
import { calendarioApi } from '@/api/calendario';
import { getConcorso } from '@/api/concorsi';
import { commissariApi } from '@/api/commissari';
import { commissioniApi } from '@/api/commissioni';
import { normalizeCandidato } from '@/api/candidati';
import { exportCalendarioPdf } from '@/lib/calendario-pdf';
import type {
  Sala,
  Evento,
  Sezione,
  Fase,
  Categoria,
  Candidato,
  CandidatoFase,
} from '@/types';
import type { CalendarioPubblicazione, SalaCreate } from '@/api/calendario';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function hhmm(s: string | null | undefined) {
  return s ? String(s).slice(0, 5) : '';
}

function fmtDay(iso: string) {
  if (!iso) return '';
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

/** Nome visualizzato del candidato (individuale vs gruppo/orchestra). */
function displayName(cand: Candidato | null | undefined): string {
  if (!cand) return '—';
  if (cand.tipo === 'gruppo' || cand.tipo === 'orchestra') return cand.nome || '—';
  return `${cand.nome || ''} ${cand.cognome || ''}`.trim() || '—';
}

function publicCalUrl(token: string, display = false) {
  // Router path-based (React Router), non hash: /calendario?token=…[&display=1]
  return `${window.location.origin}/calendario?token=${encodeURIComponent(token)}${display ? '&display=1' : ''}`;
}

const SALA_NONE = '__none__';

// ─── Slot model (card-candidato) ───────────────────────────────────────────────
// Uno slot è un candidato_fase con eventoId valorizzato + oraPrevista. La label è
// "NNN · displayName" (come candLabel in vanilla).
interface Slot {
  id: string;
  oraPrevista: string | null;
  posizione: number | null;
  label: string;
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
const CANDIDATI_KEY = (cid: string) => ['candidati', cid];
const CF_KEY = (faseId: string) => ['candidati-fase', faseId];

// ─── ConfirmDialog (modale, sostituisce confirmDialog vanilla) ─────────────────

interface ConfirmState {
  open: boolean;
  title: string;
  message: string;
  danger?: boolean;
  confirmLabel?: string;
  onConfirm: () => void;
}

function ConfirmDialog({
  state,
  onClose,
}: {
  state: ConfirmState;
  onClose: () => void;
}) {
  return (
    <Dialog open={state.open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{state.title}</DialogTitle>
          <DialogDescription>{state.message}</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <button type="button" className="c-btn c-btn--outline" onClick={onClose}>
            Annulla
          </button>
          <button
            type="button"
            className={cn('c-btn', state.danger ? 'c-btn--danger' : 'c-btn--primary')}
            onClick={() => { state.onConfirm(); onClose(); }}
          >
            {state.confirmLabel ?? 'Conferma'}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
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
  const { t } = useTranslation();
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
          <DialogTitle>{sala ? t('cal.sale.title') : t('cal.sale.add')}</DialogTitle>
        </DialogHeader>

        <form
          id="sala-form"
          onSubmit={handleSubmit((d) =>
            saveMut.mutate({ concorsoId, nome: d.nome, indirizzo: d.indirizzo || null }),
          )}
          className="space-y-3"
        >
          <label className="block">
            <span className="c-label">{t('cal.sale.nome')}</span>
            <input id="sala-nome" className="c-input" {...register('nome')} />
            {errors.nome && <p className="mt-1 text-xs text-destructive">{errors.nome.message}</p>}
          </label>
          <label className="block">
            <span className="c-label">{t('cal.sale.indirizzo')}</span>
            <input id="sala-ind" className="c-input" {...register('indirizzo')} />
          </label>
        </form>

        <DialogFooter>
          <DialogClose asChild>
            <button type="button" className="c-btn c-btn--outline">Annulla</button>
          </DialogClose>
          <button type="submit" form="sala-form" className="c-btn c-btn--primary" disabled={isSubmitting}>
            Salva
          </button>
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
  const { t } = useTranslation();
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

  // Le categorie dipendono dalla sezione scelta (cascade, come in vanilla).
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
        payload = { ...base, titolo: d.titolo || null, faseId: null, sezioneId: null, categoriaId: null, durataCandidatoMinuti: null };
      } else {
        payload = {
          ...base,
          faseId: d.faseId || null,
          sezioneId: d.sezioneId || null,
          categoriaId: d.categoriaId || null,
          durataCandidatoMinuti: d.durataCandidatoMinuti === '' || d.durataCandidatoMinuti == null ? null : Number(d.durataCandidatoMinuti),
        };
      }
      if (evento) {
        return calendarioApi.updateEvento(evento.id, payload);
      } else {
        const created = await calendarioApi.createEvento(payload);
        // Come in vanilla: alla creazione di un'ESIBIZIONE genera subito gli slot.
        if (d.tipo === 'ESIBIZIONE') {
          await calendarioApi.generaSlot(created.id);
        }
        return created;
      }
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: EVENTI_KEY(concorsoId) });
      void qc.invalidateQueries({ queryKey: ['candidati-fase'] });
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
          <DialogTitle>{evento ? t('cal.block.edit') : t('cal.block.add')}</DialogTitle>
        </DialogHeader>

        <form
          id="block-form"
          onSubmit={handleSubmit((d) => saveMut.mutate(d))}
          className="space-y-3"
        >
          {/* Tipo */}
          <label className="block">
            <span className="c-label">{t('cal.block.tipo')}</span>
            <select
              className="c-select"
              value={tipo}
              onChange={(e) => setValue('tipo', e.target.value as 'ESIBIZIONE' | 'EVENTO')}
            >
              <option value="ESIBIZIONE">{t('cal.block.tipo.esibizione')}</option>
              <option value="EVENTO">{t('cal.block.tipo.evento')}</option>
            </select>
          </label>

          {/* Titolo (solo EVENTO) */}
          {tipo === 'EVENTO' && (
            <label className="block">
              <span className="c-label">{t('cal.block.titolo')}</span>
              <input className="c-input" {...register('titolo')} />
            </label>
          )}

          {/* Campi esibizione */}
          {tipo === 'ESIBIZIONE' && (
            <div className="space-y-3">
              <label className="block">
                <span className="c-label">{t('cal.block.fase')}</span>
                <select
                  className="c-select"
                  value={watch('faseId') ?? ''}
                  onChange={(e) => setValue('faseId', e.target.value)}
                >
                  <option value="">{t('cal.block.nessuna_fase')}</option>
                  {fasi.map((f) => (
                    <option key={f.id} value={f.id}>
                      {f.ordine}. {faseFullLabel(f, sezioni)}
                    </option>
                  ))}
                </select>
              </label>

              <div className="grid grid-cols-2 gap-3">
                <label className="block">
                  <span className="c-label">{t('cal.block.sezione')}</span>
                  <select
                    className="c-select"
                    value={watch('sezioneId') ?? ''}
                    onChange={(e) => { setValue('sezioneId', e.target.value); setValue('categoriaId', ''); }}
                  >
                    <option value="">{t('cal.block.tutte_sezioni')}</option>
                    {sezioni.map((s) => (
                      <option key={s.id} value={s.id}>{s.nome}</option>
                    ))}
                  </select>
                </label>
                <label className="block">
                  <span className="c-label">{t('cal.block.categoria')}</span>
                  <select
                    className="c-select"
                    value={watch('categoriaId') ?? ''}
                    onChange={(e) => setValue('categoriaId', e.target.value)}
                  >
                    <option value="">{t('cal.block.tutte_categorie')}</option>
                    {filteredCategorie.map((c) => (
                      <option key={c.id} value={c.id}>{c.nome}</option>
                    ))}
                  </select>
                </label>
              </div>

              <label className="block">
                <span className="c-label">{t('cal.block.durata')}</span>
                <input
                  type="number"
                  min={0}
                  className="c-input"
                  {...register('durataCandidatoMinuti')}
                />
              </label>
            </div>
          )}

          {/* Data + ore */}
          <div className="grid grid-cols-3 gap-3">
            <label className="block">
              <span className="c-label">{t('cal.block.data')}</span>
              <input type="date" className="c-input" {...register('data')} />
              {errors.data && <p className="mt-1 text-xs text-destructive">{errors.data.message}</p>}
            </label>
            <label className="block">
              <span className="c-label">{t('cal.block.ora_inizio')}</span>
              <input type="time" className="c-input" {...register('oraInizio')} />
            </label>
            <label className="block">
              <span className="c-label">{t('cal.block.ora_fine')}</span>
              <input type="time" className="c-input" {...register('oraFine')} />
            </label>
          </div>

          {/* Sala */}
          <label className="block">
            <span className="c-label">{t('cal.block.sala')}</span>
            <select
              className="c-select"
              value={watch('salaId') ?? ''}
              onChange={(e) => setValue('salaId', e.target.value)}
            >
              <option value="">{t('cal.sala.senza')}</option>
              {sale.map((s) => (
                <option key={s.id} value={s.id}>{s.nome}</option>
              ))}
            </select>
          </label>

          {/* Note */}
          <label className="block">
            <span className="c-label">{t('cal.block.note')}</span>
            <input className="c-input" {...register('note')} />
          </label>
        </form>

        <DialogFooter>
          <DialogClose asChild>
            <button type="button" className="c-btn c-btn--outline">Annulla</button>
          </DialogClose>
          <button type="submit" form="block-form" className="c-btn c-btn--primary" disabled={isSubmitting}>
            Salva
          </button>
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
  const { t } = useTranslation();
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
    mutationFn: (d: LinkForm) => {
      // Validazioni come in vanilla onPrimary.
      if (d.scopo === 'SEZIONE' && !d.sezioneId) throw new Error(t('cal.block.sezione'));
      if (d.scopo === 'GIORNO' && !d.giorno) throw new Error(t('cal.block.data'));
      return calendarioApi.createPubblicazione({
        concorsoId,
        scopo: d.scopo,
        etichetta: d.etichetta || null,
        mostraNomi: d.mostraNomi,
        mostraCommissione: d.mostraCommissione,
        sezioneId: d.scopo === 'SEZIONE' ? (d.sezioneId || null) : null,
        giorno: d.scopo === 'GIORNO' ? (d.giorno || null) : null,
      });
    },
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
          <DialogTitle>{t('cal.links.add')}</DialogTitle>
        </DialogHeader>

        <form
          id="link-form"
          onSubmit={handleSubmit((d) => createMut.mutate(d))}
          className="space-y-3"
        >
          <label className="block">
            <span className="c-label">{t('cal.links.scopo')}</span>
            <select
              className="c-select"
              value={scopo}
              onChange={(e) => {
                const next = e.target.value as 'CONCORSO' | 'SEZIONE' | 'GIORNO';
                setValue('scopo', next);
                // Allo switch su SEZIONE pre-seleziona la prima sezione nello state
                // del form: il <select> ne mostra una già a video ma senza un
                // evento change il valore resta `undefined` → il create fallirebbe
                // (server: "scopo SEZIONE richiede sezioneId").
                if (next === 'SEZIONE' && !watch('sezioneId') && sezioni[0]) {
                  setValue('sezioneId', sezioni[0].id);
                }
              }}
            >
              <option value="CONCORSO">{t('cal.links.scopo.concorso')}</option>
              <option value="SEZIONE">{t('cal.links.scopo.sezione')}</option>
              <option value="GIORNO">{t('cal.links.scopo.giorno')}</option>
            </select>
          </label>

          {scopo === 'SEZIONE' && (
            <label className="block">
              <span className="c-label">{t('cal.block.sezione')}</span>
              <select
                className="c-select"
                value={watch('sezioneId') ?? ''}
                onChange={(e) => setValue('sezioneId', e.target.value)}
              >
                <option value="" disabled>—</option>
                {sezioni.map((s) => (
                  <option key={s.id} value={s.id}>{s.nome}</option>
                ))}
              </select>
            </label>
          )}

          {scopo === 'GIORNO' && (
            <label className="block">
              <span className="c-label">{t('cal.block.data')}</span>
              <input type="date" className="c-input" {...register('giorno')} />
            </label>
          )}

          <label className="block">
            <span className="c-label">{t('cal.links.etichetta')}</span>
            <input className="c-input" {...register('etichetta')} />
          </label>

          <label className="flex items-center gap-2 text-sm" style={{ color: 'hsl(var(--foreground))' }}>
            <input
              type="checkbox"
              checked={watch('mostraNomi')}
              onChange={(e) => setValue('mostraNomi', e.target.checked)}
            />
            {t('cal.links.mostra_nomi')}
          </label>
          <label className="flex items-center gap-2 text-sm" style={{ color: 'hsl(var(--foreground))' }}>
            <input
              type="checkbox"
              checked={watch('mostraCommissione')}
              onChange={(e) => setValue('mostraCommissione', e.target.checked)}
            />
            {t('cal.links.mostra_commissione')}
          </label>
        </form>

        <DialogFooter>
          <DialogClose asChild>
            <button type="button" className="c-btn c-btn--outline">Annulla</button>
          </DialogClose>
          <button type="submit" form="link-form" className="c-btn c-btn--primary" disabled={isSubmitting}>
            Crea
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── BlockCard ────────────────────────────────────────────────────────────────

interface BlockCardProps {
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

// ─── PubRow ───────────────────────────────────────────────────────────────────

interface PubRowProps {
  pub: CalendarioPubblicazione;
  sezioni: Sezione[];
  onRevoke: () => void;
  onToggle: () => void;
}

function PubRow({ pub, sezioni, onRevoke, onToggle }: PubRowProps) {
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
  const { data: candidati = [] } = useQuery({
    queryKey: CANDIDATI_KEY(concorsoId),
    queryFn: () =>
      http
        .get<Candidato[]>('candidati', { concorsoId, limit: 1000 })
        .then((rows) => rows.map(normalizeCandidato)),
  });

  // candidati_fase per ogni fase referenziata da un blocco ESIBIZIONE → da qui
  // derivano gli slot (cf con eventoId valorizzato). Una query per fase.
  const faseIds = useMemo(
    () => [...new Set(eventi.map((e) => e.faseId).filter((x): x is string => !!x))],
    [eventi],
  );
  const cfQueries = useQueries({
    queries: faseIds.map((fid) => ({
      queryKey: CF_KEY(fid),
      queryFn: () => http.get<CandidatoFase[]>('candidati-fase', { faseId: fid, limit: 1000 }),
    })),
  });
  const allCf = useMemo(
    () => cfQueries.flatMap((q) => q.data ?? []),
    [cfQueries],
  );

  // Lookup candidato → label "NNN · displayName" (come candLabel vanilla).
  const candById = useMemo(() => new Map(candidati.map((c) => [c.id, c])), [candidati]);
  const candLabel = useCallback(
    (candidatoId: string) => {
      const cand = candById.get(candidatoId);
      if (!cand) return '—';
      const num = String(cand.numeroCandidato ?? '').padStart(3, '0');
      return `${num} · ${displayName(cand)}`;
    },
    [candById],
  );

  // Slot per evento (cf con eventoId === ev.id, ordinati per oraPrevista/posizione).
  const slotsByEvento = useMemo(() => {
    const m = new Map<string, Slot[]>();
    for (const cf of allCf) {
      if (!cf.eventoId) continue;
      const arr = m.get(cf.eventoId) ?? [];
      arr.push({
        id: cf.id,
        oraPrevista: cf.oraPrevista,
        posizione: cf.posizione,
        label: candLabel(cf.candidatoId),
      });
      m.set(cf.eventoId, arr);
    }
    for (const arr of m.values()) {
      arr.sort(
        (a, b) =>
          (a.oraPrevista || '').localeCompare(b.oraPrevista || '') ||
          (a.posizione ?? 0) - (b.posizione ?? 0),
      );
    }
    return m;
  }, [allCf, candLabel]);

  // ── UI State ───────────────────────────────────────────────────────────────
  const [salaDialog, setSalaDialog] = useState<{ open: boolean; sala: Sala | null }>({ open: false, sala: null });
  const [blockDialog, setBlockDialog] = useState<{ open: boolean; evento: Evento | null; prefillData?: string }>({ open: false, evento: null });
  const [linkDialog, setLinkDialog] = useState(false);
  const [draggingBlockId, setDraggingBlockId] = useState<string | null>(null);
  const [draggingSlot, setDraggingSlot] = useState<{ cfId: string; eventoId: string } | null>(null);
  const [confirmState, setConfirmState] = useState<ConfirmState>({
    open: false, title: '', message: '', onConfirm: () => {},
  });
  const closeConfirm = () => setConfirmState((s) => ({ ...s, open: false }));

  // ── Mutations ──────────────────────────────────────────────────────────────
  const deleteSalaMut = useMutation({
    mutationFn: (id: string) => calendarioApi.deleteSala(id),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: SALE_KEY(concorsoId) });
      void qc.invalidateQueries({ queryKey: EVENTI_KEY(concorsoId) });
      toast.success('Sala eliminata');
    },
    onError: (e) => toast.error(httpErrorMessage(e)),
  });

  const deleteEventoMut = useMutation({
    mutationFn: (id: string) => calendarioApi.deleteEvento(id),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: EVENTI_KEY(concorsoId) });
      void qc.invalidateQueries({ queryKey: ['candidati-fase'] });
      toast.success('Blocco eliminato');
    },
    onError: (e) => toast.error(httpErrorMessage(e)),
  });

  const updateEventoMut = useMutation({
    mutationFn: ({ id, body }: { id: string; body: Record<string, unknown> }) =>
      calendarioApi.updateEvento(id, body),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: EVENTI_KEY(concorsoId) });
      void qc.invalidateQueries({ queryKey: ['candidati-fase'] });
    },
    onError: (e) => toast.error(httpErrorMessage(e)),
  });

  const generaSlotMut = useMutation({
    mutationFn: (eventoId: string) => calendarioApi.generaSlot(eventoId),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['candidati-fase'] });
      void qc.invalidateQueries({ queryKey: EVENTI_KEY(concorsoId) });
      toast.success(t('cal.block.genera_done'));
    },
    onError: (e) => toast.error(httpErrorMessage(e)),
  });

  const riordinaSlotMut = useMutation({
    mutationFn: ({ eventoId, ordine }: { eventoId: string; ordine: string[] }) =>
      calendarioApi.riordinaSlot(eventoId, ordine),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ['candidati-fase'] }); },
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

  // ── PDF export (intero concorso) ─────────────────────────────────────────────
  const pdfMut = useMutation({
    mutationFn: async () => {
      const [concorso, commissari, commissioni] = await Promise.all([
        getConcorso(concorsoId),
        commissariApi.list(concorsoId),
        commissioniApi.list(concorsoId),
      ]);
      const days = [...new Set(eventi.map((e) => e.data).filter((d): d is string => !!d))].sort();
      const giorni = days.map((data) => ({
        data,
        blocchi: eventi
          .filter((e) => e.data === data)
          .map((ev) => {
            const sez = ev.sezioneId ? sezioni.find((s) => s.id === ev.sezioneId) : null;
            const cat = ev.categoriaId ? categorie.find((c) => c.id === ev.categoriaId) : null;
            const fase = ev.faseId ? fasi.find((f) => f.id === ev.faseId) : null;
            const comm = fase?.commissioneId
              ? commissioni.find((c) => c.id === fase.commissioneId)
              : null;
            const commissione = comm
              ? (comm.commissari ?? [])
                  .map((id) => {
                    const m = commissari.find((x) => x.id === id);
                    return m ? { nome: m.nome, cognome: m.cognome ?? '', specialita: m.specialita ?? '' } : null;
                  })
                  .filter((x): x is { nome: string; cognome: string; specialita: string } => !!x)
              : [];
            return {
              oraInizio: ev.oraInizio,
              oraFine: ev.oraFine,
              tipo: ev.tipo,
              titolo: ev.titolo,
              sala: ev.salaId ? { nome: sale.find((s) => s.id === ev.salaId)?.nome ?? '' } : null,
              sezione: sez ? { nome: sez.nome } : null,
              categoria: cat ? { nome: cat.nome } : null,
              fase: fase ? { nome: fase.nome } : null,
              commissione,
              slot: (slotsByEvento.get(ev.id) ?? []).map((s) => ({
                oraPrevista: s.oraPrevista,
                etichetta: s.label,
              })),
            };
          }),
      }));
      await exportCalendarioPdf({
        titolo: concorso.nome,
        sottotitolo: `${t('cal.pdf.title')} · ${concorso.anno ?? ''}`,
        logoUrl: concorso.logoUrl || '/logo.png',
        mostraCommissione: true,
        giorni,
      });
    },
    onError: (e) => toast.error(httpErrorMessage(e)),
  });

  // ── Board data ─────────────────────────────────────────────────────────────
  const days = [...new Set(eventi.map((e) => e.data).filter(Boolean))].sort();
  const lanes = [
    ...sale.map((s) => ({ id: s.id, nome: s.nome })),
    { id: SALA_NONE, nome: t('cal.sala.senza') },
  ];

  // Drop handler per il blocco (lane).
  const handleLaneDrop = useCallback(
    (e: React.DragEvent<HTMLDivElement>, day: string, salaId: string | null) => {
      e.preventDefault();
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

  const isLoading = loadSale || loadEventi;

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="text-sm font-bold uppercase tracking-wider" style={{ color: 'hsl(var(--foreground))' }}>
            {t('cal.title')}
          </h3>
          <p className="text-sm" style={{ color: 'hsl(var(--muted-foreground))' }}>{t('cal.subtitle')}</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            className="c-btn c-btn--outline c-btn--sm"
            onClick={() => pdfMut.mutate()}
            disabled={pdfMut.isPending}
          >
            <Download className="h-[15px] w-[15px]" />
            <span>{t('cal.pdf.export')}</span>
          </button>
          <button
            type="button"
            className="c-btn c-btn--primary"
            onClick={() => setBlockDialog({ open: true, evento: null })}
          >
            <Plus className="h-4 w-4" />
            <span>{t('cal.block.add')}</span>
          </button>
        </div>
      </div>

      {/* Sale */}
      <div className="rounded-2xl p-4" style={{ background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))' }}>
        <div className="mb-3 flex items-center justify-between">
          <h4 className="text-sm font-bold" style={{ color: 'hsl(var(--foreground))' }}>{t('cal.sale.title')}</h4>
          <button
            type="button"
            className="c-btn c-btn--outline c-btn--sm"
            onClick={() => setSalaDialog({ open: true, sala: null })}
          >
            <Plus className="h-[14px] w-[14px]" />
            <span>{t('cal.sale.add')}</span>
          </button>
        </div>
        {loadSale ? (
          <div className="h-8 w-48 animate-pulse rounded" style={{ background: 'hsl(var(--muted))' }} />
        ) : sale.length === 0 ? (
          <p className="text-sm italic" style={{ color: 'hsl(var(--muted-foreground))' }}>{t('cal.sale.empty')}</p>
        ) : (
          <ul className="flex flex-wrap gap-2">
            {sale.map((s) => (
              <li
                key={s.id}
                className="inline-flex items-center gap-2 rounded-full py-1 pl-3 pr-1.5"
                style={{ background: 'hsl(var(--primary) / 0.06)' }}
              >
                <span className="text-sm" style={{ color: 'hsl(var(--foreground))' }}>{s.nome}</span>
                <button
                  type="button"
                  onClick={() => setSalaDialog({ open: true, sala: s })}
                  className="p-1"
                  style={{ color: 'hsl(var(--muted-foreground))' }}
                  onMouseOver={(e) => (e.currentTarget.style.color = 'hsl(var(--primary))')}
                  onMouseOut={(e) => (e.currentTarget.style.color = 'hsl(var(--muted-foreground))')}
                  aria-label="edit"
                >
                  <Pencil className="h-[13px] w-[13px]" />
                </button>
                <button
                  type="button"
                  onClick={() =>
                    setConfirmState({
                      open: true,
                      title: `${t('modal.delete')} — ${s.nome}`,
                      message: t('cal.block.delete_confirm'),
                      danger: true,
                      confirmLabel: t('modal.delete'),
                      onConfirm: () => deleteSalaMut.mutate(s.id),
                    })
                  }
                  className="p-1"
                  style={{ color: 'hsl(var(--muted-foreground))' }}
                  onMouseOver={(e) => (e.currentTarget.style.color = 'hsl(var(--destructive))')}
                  onMouseOut={(e) => (e.currentTarget.style.color = 'hsl(var(--muted-foreground))')}
                  aria-label="delete"
                >
                  <Trash2 className="h-[13px] w-[13px]" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Board */}
      {isLoading ? (
        <div className="space-y-3">
          <div className="h-6 w-40 animate-pulse rounded" style={{ background: 'hsl(var(--muted))' }} />
          <div className="grid grid-cols-2 gap-3">
            <div className="h-32 animate-pulse rounded-2xl" style={{ background: 'hsl(var(--muted))' }} />
            <div className="h-32 animate-pulse rounded-2xl" style={{ background: 'hsl(var(--muted))' }} />
          </div>
        </div>
      ) : eventi.length === 0 ? (
        <div
          className="rounded-2xl py-12 text-center"
          style={{ border: '2px dashed hsl(var(--border))' }}
        >
          <p className="text-sm italic" style={{ color: 'hsl(var(--muted-foreground))' }}>{t('cal.board.empty')}</p>
        </div>
      ) : (
        days.map((day) => (
          <section key={day} className="space-y-2">
            <h4 className="text-sm font-bold capitalize" style={{ color: 'hsl(var(--foreground))' }}>{fmtDay(day)}</h4>
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
                    className="min-h-[80px] rounded-2xl p-2 ring-1 transition"
                    style={{
                      background: 'hsl(var(--muted) / 0.4)',
                      '--tw-ring-color': 'hsl(var(--border))',
                    } as React.CSSProperties}
                    onDragOver={(e) => {
                      if (draggingBlockId) {
                        e.preventDefault();
                        e.currentTarget.style.outline = '2px solid hsl(var(--primary))';
                        e.currentTarget.style.outlineOffset = '-2px';
                      }
                    }}
                    onDragLeave={(e) => {
                      e.currentTarget.style.outline = '';
                      e.currentTarget.style.outlineOffset = '';
                    }}
                    onDrop={(e) => {
                      e.currentTarget.style.outline = '';
                      e.currentTarget.style.outlineOffset = '';
                      handleLaneDrop(e, day, lane.id === SALA_NONE ? null : lane.id);
                    }}
                  >
                    <p
                      className="mb-2 px-1 text-[11px] font-semibold uppercase tracking-wide"
                      style={{ color: 'hsl(var(--muted-foreground))' }}
                    >
                      {lane.nome}
                    </p>
                    <div className="space-y-2">
                      {blocks.map((ev) => (
                        <BlockCard
                          key={ev.id}
                          evento={ev}
                          sezioni={sezioni}
                          categorie={categorie}
                          fasi={fasi}
                          slots={slotsByEvento.get(ev.id) ?? []}
                          onEdit={() => setBlockDialog({ open: true, evento: ev })}
                          onDelete={() =>
                            setConfirmState({
                              open: true,
                              title: t('cal.block.edit'),
                              message: t('cal.block.delete_confirm'),
                              danger: true,
                              confirmLabel: t('modal.delete'),
                              onConfirm: () => deleteEventoMut.mutate(ev.id),
                            })
                          }
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
      <div className="rounded-2xl p-4" style={{ background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))' }}>
        <div className="mb-3 flex items-center justify-between">
          <h4 className="text-sm font-bold" style={{ color: 'hsl(var(--foreground))' }}>
            {t('cal.links.title')}
          </h4>
          <button type="button" className="c-btn c-btn--outline c-btn--sm" onClick={() => setLinkDialog(true)}>
            <Plus className="h-[14px] w-[14px]" />
            <span>{t('cal.links.add')}</span>
          </button>
        </div>

        {loadPub ? (
          <div className="h-12 w-full animate-pulse rounded" style={{ background: 'hsl(var(--muted))' }} />
        ) : pubblicazioni.length === 0 ? (
          <p className="text-sm italic" style={{ color: 'hsl(var(--muted-foreground))' }}>{t('cal.links.empty')}</p>
        ) : (
          <ul className="space-y-2">
            {pubblicazioni.map((pub) => (
              <PubRow
                key={pub.id}
                pub={pub}
                sezioni={sezioni}
                onToggle={() =>
                  togglePubMut.mutate({ id: pub.id, attivo: !pub.attivo })
                }
                onRevoke={() =>
                  setConfirmState({
                    open: true,
                    title: t('cal.links.revoke'),
                    message: t('cal.links.revoke_confirm'),
                    danger: true,
                    confirmLabel: t('cal.links.revoke'),
                    onConfirm: () => deletePubMut.mutate(pub.id),
                  })
                }
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
      <ConfirmDialog state={confirmState} onClose={closeConfirm} />
    </div>
  );
}

// Re-export for use as tab prop
export type { CalendarioTabProps };
export default CalendarioTab;
