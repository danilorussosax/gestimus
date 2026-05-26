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
import type { Sezione } from '@/types';
import { linkSchema, PUB_KEY } from '../calendario-schemas';
import type { LinkForm } from '../calendario-schemas';

export interface LinkDialogProps {
  open: boolean;
  concorsoId: string;
  sezioni: Sezione[];
  onClose: () => void;
}

export function LinkDialog({ open, concorsoId, sezioni, onClose }: LinkDialogProps) {
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
