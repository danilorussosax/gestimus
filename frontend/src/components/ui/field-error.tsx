import * as React from 'react';
import { cn } from '@/lib/utils';

export interface FieldErrorProps extends React.HTMLAttributes<HTMLParagraphElement> {
  /**
   * Id usato anche dall'input come `aria-describedby`. Se il messaggio è
   * assente non viene reso nulla — ma il tag `<p>` è comunque omesso, quindi
   * ricordati di mantenere `aria-describedby` opzionale lato input
   * (`errors.x ? 'x-error' : undefined`) per non puntare a un id inesistente.
   */
  id: string;
  children?: React.ReactNode;
}

/**
 * Messaggio d'errore di un campo form, accessibile:
 *   - associato all'input via `aria-describedby={id}` (lato chiamante)
 *   - annunciato dagli screen reader come `role="alert"` quando appare
 *     (closes WCAG 2 SC 3.3.1 Error Identification + 4.1.3 Status Messages)
 */
export function FieldError({ id, className, children, ...rest }: FieldErrorProps) {
  if (!children) return null;
  return (
    <p id={id} role="alert" className={cn('text-xs text-destructive', className)} {...rest}>
      {children}
    </p>
  );
}
