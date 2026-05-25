import { Component, type ErrorInfo, type ReactNode } from 'react';
import * as Sentry from '@sentry/react';
import { isSentryInitialized } from '@/lib/sentry';

interface Props {
  children: ReactNode;
}
interface State {
  error: Error | null;
  eventId: string | null;
}

/**
 * Catch-all per errori di rendering React (componenti che throw nel render
 * o nei lifecycle). Senza questo, un errore in un sotto-albero rompe
 * l'intera pagina con uno schermo bianco.
 *
 * Quando Sentry è inizializzato (VITE_SENTRY_DSN settato in build), l'evento
 * viene riportato e mostriamo l'eventId nella UI per supporto.
 */
export class AppErrorBoundary extends Component<Props, State> {
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
      console.error('[AppErrorBoundary]', error, info);
    }
  }

  reset = () => {
    this.setState({ error: null, eventId: null });
  };

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="flex min-h-dvh items-center justify-center bg-background p-6">
        <div className="w-full max-w-md rounded-xl border bg-card p-6 text-center shadow-xs">
          <h1 className="font-display text-xl font-semibold">Si è verificato un errore</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            La pagina non si è caricata correttamente. Ricarica per riprovare; se il problema
            persiste, contatta l'assistenza riportando il codice qui sotto.
          </p>
          {this.state.eventId && (
            <p className="mt-3 select-all rounded-md bg-muted/40 px-2 py-1 font-mono text-xs">
              {this.state.eventId}
            </p>
          )}
          <div className="mt-5 flex justify-center gap-2">
            <button
              type="button"
              onClick={this.reset}
              className="rounded-md border px-3 py-1.5 text-sm hover:bg-accent"
            >
              Riprova
            </button>
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="rounded-md bg-primary px-3 py-1.5 text-sm text-primary-foreground hover:bg-primary/90"
            >
              Ricarica
            </button>
          </div>
        </div>
      </div>
    );
  }
}
