import { Component, type ErrorInfo, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import * as Sentry from '@sentry/react';
import { isSentryInitialized } from '@/lib/sentry';

interface Props {
  children: ReactNode;
  /** UI di fallback resa quando il sotto-albero throwa. Riceve l'eventId Sentry
   *  (se disponibile) e una callback per resettare lo stato di questo boundary. */
  fallback: (eventId: string | null, reset: () => void) => ReactNode;
}
interface State {
  error: Error | null;
  eventId: string | null;
}

/**
 * Error boundary a livello di rotta: cattura gli errori di render di una
 * singola sezione pesante (Commissario, AdminWorkspace, Statistiche) senza
 * far crollare l'intera app come farebbe l'AppErrorBoundary di root.
 * Il reset passato al fallback ripristina solo lo stato locale di questo boundary.
 */
class RouteErrorBoundaryInner extends Component<Props, State> {
  state: State = { error: null, eventId: null };

  static getDerivedStateFromError(error: Error): State {
    return { error, eventId: null };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    if (isSentryInitialized()) {
      const eventId = Sentry.captureException(error, {
        contexts: { react: { componentStack: info.componentStack } },
      });
      this.setState({ eventId });
    } else {
      console.error('[RouteErrorBoundary]', error, info);
    }
  }

  reset = () => {
    this.setState({ error: null, eventId: null });
  };

  render() {
    if (!this.state.error) return this.props.children;
    return this.props.fallback(this.state.eventId, this.reset);
  }
}

export function RouteErrorBoundary({ children }: { children: ReactNode }) {
  const { t } = useTranslation();
  return (
    <RouteErrorBoundaryInner
      fallback={(eventId, reset) => (
        <div className="flex min-h-[40vh] items-center justify-center p-6">
          <div className="w-full max-w-md rounded-xl border bg-card p-6 text-center shadow-xs">
            <h2 className="font-display text-lg font-semibold">
              {t('error.section_title', { defaultValue: 'Questa sezione ha avuto un problema' })}
            </h2>
            <p className="mt-2 text-sm text-muted-foreground">
              {t('error.section_body', {
                defaultValue:
                  'Non è stato possibile caricare questa sezione. Riprova; le altre parti dell’app restano disponibili.',
              })}
            </p>
            {eventId && (
              <p className="mt-3 select-all rounded-md bg-muted/40 px-2 py-1 font-mono text-xs">
                {eventId}
              </p>
            )}
            <div className="mt-5 flex justify-center">
              <button
                type="button"
                onClick={reset}
                className="rounded-md bg-primary px-3 py-1.5 text-sm text-primary-foreground hover:bg-primary/90"
              >
                {t('common.retry', { defaultValue: 'Riprova' })}
              </button>
            </div>
          </div>
        </div>
      )}
    >
      {children}
    </RouteErrorBoundaryInner>
  );
}
