import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { cn } from '@/lib/utils';

export interface ConfirmState {
  open: boolean;
  title: string;
  message: string;
  danger?: boolean;
  confirmLabel?: string;
  onConfirm: () => void;
}

export function ConfirmDialog({
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
