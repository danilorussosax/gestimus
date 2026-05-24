import { useCallback, useState } from 'react';

/**
 * Intercetta la chiusura di un Dialog/Sheet quando il form contiene
 * modifiche non salvate, e mostra una conferma all'utente.
 *
 * Su mobile la chiusura accidentale (tap fuori, swipe, back gesture iOS)
 * è frequente: senza questa intercettazione l'utente perde 8-10 campi
 * compilati senza preavviso. WCAG/HIG raccomanda
 * `sheet-dismiss-confirm` (Apple HIG) per i form long-running.
 *
 * Pattern d'uso:
 *   const { handleOpenChange, confirmOpen, confirm, cancel } =
 *     useDirtyDialogClose({
 *       isDirty: form.formState.isDirty,
 *       onClose: () => onOpenChange(false),
 *     });
 *
 *   <Dialog open={open} onOpenChange={(o) => o ? onOpenChange(true) : handleOpenChange()}>
 *     ...form...
 *   </Dialog>
 *   <ConfirmDiscardDialog
 *     open={confirmOpen}
 *     onConfirm={confirm}
 *     onCancel={cancel}
 *   />
 */
export interface UseDirtyDialogCloseOptions {
  /** Se true il form ha modifiche non salvate. */
  isDirty: boolean;
  /** Callback eseguita quando l'utente conferma la chiusura. */
  onClose: () => void;
}

export interface UseDirtyDialogCloseResult {
  /**
   * Chiamala al posto di `onOpenChange(false)`. Se il form è dirty
   * apre il dialog di conferma; altrimenti chiama subito `onClose`.
   */
  handleOpenChange: () => void;
  /** Stato del dialog di conferma. */
  confirmOpen: boolean;
  /** Setter per il dialog di conferma (per onOpenChange di shadcn AlertDialog). */
  setConfirmOpen: (open: boolean) => void;
  /** L'utente ha confermato: chiudi entrambi i dialog. */
  confirm: () => void;
  /** L'utente ha annullato: torna al form. */
  cancel: () => void;
}

export function useDirtyDialogClose({
  isDirty,
  onClose,
}: UseDirtyDialogCloseOptions): UseDirtyDialogCloseResult {
  const [confirmOpen, setConfirmOpen] = useState(false);

  const handleOpenChange = useCallback(() => {
    if (isDirty) {
      setConfirmOpen(true);
    } else {
      onClose();
    }
  }, [isDirty, onClose]);

  const confirm = useCallback(() => {
    setConfirmOpen(false);
    onClose();
  }, [onClose]);

  const cancel = useCallback(() => {
    setConfirmOpen(false);
  }, []);

  return { handleOpenChange, confirmOpen, setConfirmOpen, confirm, cancel };
}
