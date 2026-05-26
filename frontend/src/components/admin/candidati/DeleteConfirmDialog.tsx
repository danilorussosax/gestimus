import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from '@/components/ui/dialog';
import type { CandidatoFull } from '@/api/candidati';
import { displayName } from '../candidati-utils';

export interface DeleteConfirmProps {
  open: boolean;
  candidato: CandidatoFull | null;
  onCancel: () => void;
  onConfirm: () => void;
  isPending: boolean;
}

export function DeleteConfirmDialog({ open, candidato, onCancel, onConfirm, isPending }: DeleteConfirmProps) {
  return (
    <Dialog open={open} onOpenChange={(v) => !v && onCancel()}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Elimina candidato</DialogTitle>
          <DialogDescription>
            Eliminare definitivamente <strong>{candidato ? displayName(candidato) : ''}</strong>?
            L&apos;operazione non è reversibile.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <button className="c-btn c-btn--outline" onClick={onCancel}>
            Annulla
          </button>
          <button className="c-btn c-btn--danger" onClick={onConfirm} disabled={isPending}>
            {isPending ? 'Eliminazione…' : 'Elimina'}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
