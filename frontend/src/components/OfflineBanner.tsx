import { AnimatePresence, motion } from 'framer-motion';
import { WifiOff } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useOnline } from '@/hooks/useOnline';

/**
 * Banner globale "Sei offline". Appare quando `navigator.onLine === false`
 * e si nasconde quando la connettività ritorna. Skill rule
 * `offline-support` (PWA / mobile): l'utente deve sapere quando l'app
 * è in modalità degraded — i Service Worker servono comunque la shell
 * e i dati cache, ma le mutation falliscono fino al recupero rete.
 *
 * Posizionato come fixed top-0, sotto allo skip-link e safe-area iOS.
 * `role="status"` + `aria-live="polite"` per annunciarlo agli screen
 * reader senza interrompere il task corrente.
 */
export function OfflineBanner() {
  const online = useOnline();
  const { t } = useTranslation();

  return (
    <AnimatePresence>
      {!online && (
        <motion.div
          role="status"
          aria-live="polite"
          initial={{ y: -32, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: -32, opacity: 0 }}
          transition={{ duration: 0.2 }}
          className="safe-pt fixed inset-x-0 top-0 z-[60] flex items-center justify-center gap-2 bg-warning px-4 py-2 text-xs font-medium text-warning-foreground shadow-md"
        >
          <WifiOff className="h-4 w-4" aria-hidden />
          <span>{t('common.offline_banner')}</span>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
