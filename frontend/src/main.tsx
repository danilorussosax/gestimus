import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MotionConfig } from 'framer-motion';
import { toast } from 'sonner';
import App from './App';
import { AuthProvider } from '@/contexts/AuthContext';
import { ThemeProvider } from '@/contexts/ThemeContext';
import { Toaster } from '@/components/ui/sonner';
import { OfflineBanner } from '@/components/OfflineBanner';
import { AppErrorBoundary } from '@/components/AppErrorBoundary';
import { initSentry } from '@/lib/sentry';
import { bumpVisitCount, setupPwa } from '@/lib/pwa';
import '@/i18n';
import './index.css';

// Sentry: init prima del render così cattura errori di mount. No-op senza DSN.
initSentry();

// PWA: registra SW + listener install prompt. In dev è no-op.
setupPwa((reload) => {
  toast.message('Aggiornamento disponibile', {
    description: 'Ricarica per applicare la nuova versione.',
    duration: Infinity,
    action: { label: 'Ricarica', onClick: reload },
  });
});

bumpVisitCount();

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: 1, refetchOnWindowFocus: false, staleTime: 30 * 1000 },
  },
});

// eslint-disable-next-line @typescript-eslint/no-non-null-assertion
ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <AppErrorBoundary>
      <MotionConfig reducedMotion="user">
        <ThemeProvider>
          <QueryClientProvider client={queryClient}>
            <BrowserRouter>
              <AuthProvider>
                <App />
                <Toaster />
                <OfflineBanner />
              </AuthProvider>
            </BrowserRouter>
          </QueryClientProvider>
        </ThemeProvider>
      </MotionConfig>
    </AppErrorBoundary>
  </React.StrictMode>,
);
