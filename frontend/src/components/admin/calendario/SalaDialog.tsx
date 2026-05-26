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
import type { Sala } from '@/types';
import type { SalaCreate } from '@/api/calendario';
import { salaSchema, SALE_KEY } from '../calendario-schemas';
import type { SalaForm } from '../calendario-schemas';

export interface SalaDialogProps {
  open: boolean;
  sala: Sala | null;
  concorsoId: string;
  onClose: () => void;
}

export function SalaDialog({ open, sala, concorsoId, onClose }: SalaDialogProps) {
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
