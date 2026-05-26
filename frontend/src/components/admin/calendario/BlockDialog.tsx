import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { toast } from 'sonner';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogClose,
} from '@/components/ui/dialog';
import { httpErrorMessage } from '@/lib/api';
import { calendarioApi } from '@/api/calendario';
import { faseFullLabel } from '@/lib/fase-label';
import type { Evento, Sala, Fase, Sezione, Categoria } from '@/types';
import { blockSchema, EVENTI_KEY } from '../calendario-schemas';
import type { BlockForm } from '../calendario-schemas';
import { hhmm } from '../calendario-utils';

export interface BlockDialogProps {
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

export function BlockDialog({
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
