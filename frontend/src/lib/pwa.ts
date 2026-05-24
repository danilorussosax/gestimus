// =============================================================================
// PWA helpers: registrazione SW + Add-to-Home-Screen prompt
//
// vite-plugin-pwa con `registerType: 'prompt'` non auto-attiva l'aggiornamento:
// quando arriva una nuova versione del SW, l'utente vede un toast "Nuova
// versione disponibile" con bottone "Ricarica". L'attivazione è quindi
// controllata, niente reload sorpresa durante la stesura di un form.
//
// `BeforeInstallPromptEvent` non è ancora nelle lib TS di default → tipi
// minimal locali. Su iOS Safari l'evento non viene emesso (Apple non
// implementa la prompt API), quindi su iOS mostriamo istruzioni manuali.
// =============================================================================

interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
}

type SwUpdateHandler = (reload: () => void) => void;

const VISIT_COUNT_KEY = 'cadenza:visit-count';
const A2HS_DISMISSED_KEY = 'cadenza:a2hs-dismissed';
const A2HS_INSTALLED_KEY = 'cadenza:a2hs-installed';

let deferredPrompt: BeforeInstallPromptEvent | null = null;

/** Incrementa il contatore visite (1 per "session"). Usato dalla logica A2HS:
 *  il prompt comparirà SOLO dopo la 2ª visita per evitare di assillare il
 *  primo accesso (spesso un click esplorativo). */
export function bumpVisitCount(): number {
  try {
    const current = Number(localStorage.getItem(VISIT_COUNT_KEY) ?? '0');
    const next = current + 1;
    localStorage.setItem(VISIT_COUNT_KEY, String(next));
    return next;
  } catch {
    return 0;
  }
}

export function getVisitCount(): number {
  try {
    return Number(localStorage.getItem(VISIT_COUNT_KEY) ?? '0');
  } catch {
    return 0;
  }
}

export function isA2hsDismissed(): boolean {
  try {
    return localStorage.getItem(A2HS_DISMISSED_KEY) === '1';
  } catch {
    return false;
  }
}

export function setA2hsDismissed(): void {
  try {
    localStorage.setItem(A2HS_DISMISSED_KEY, '1');
  } catch {
    /* noop */
  }
}

export function isA2hsInstalled(): boolean {
  try {
    return localStorage.getItem(A2HS_INSTALLED_KEY) === '1';
  } catch {
    return false;
  }
}

/** True quando la pagina è già in modalità app installata (display:standalone
 *  o iOS Safari `navigator.standalone`). Usato per nascondere il prompt. */
export function isStandalone(): boolean {
  if (typeof window === 'undefined') return false;
  if (window.matchMedia('(display-mode: standalone)').matches) return true;
  // iOS legacy:
  return Boolean((window.navigator as unknown as { standalone?: boolean }).standalone);
}

export function isIos(): boolean {
  if (typeof navigator === 'undefined') return false;
  // `navigator.platform` è deprecato ma resta l'unico segnale affidabile per
  // discriminare iPadOS desktop UA. Soppressione locale: usato in fallback.

  const platform = navigator.platform;
  return (
    /iPad|iPhone|iPod/.test(navigator.userAgent) ||
    (platform === 'MacIntel' && navigator.maxTouchPoints > 1)
  );
}

/** Restituisce il prompt salvato. Il chiamante invoca `prompt()` e attende la
 *  scelta utente. È disponibile UNA sola volta: dopo l'invocazione
 *  `userChoice` consuma l'evento. */
export function getDeferredPrompt(): BeforeInstallPromptEvent | null {
  return deferredPrompt;
}

export function clearDeferredPrompt(): void {
  deferredPrompt = null;
}

/** Setup globale: registra il SW + listener `beforeinstallprompt` +
 *  marker installazione completata. Da chiamare una volta in `main.tsx`. */
export function setupPwa(onUpdate?: SwUpdateHandler): void {
  if (typeof window === 'undefined') return;

  // 1) Listener prompt installazione: il browser emette l'evento quando
  //    l'app è eligibile (HTTPS, manifest valido, SW registrato). Lo
  //    salviamo per poter chiamare `.prompt()` dopo che l'utente clicca
  //    il nostro CTA.
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredPrompt = e as BeforeInstallPromptEvent;
  });
  window.addEventListener('appinstalled', () => {
    deferredPrompt = null;
    try {
      localStorage.setItem(A2HS_INSTALLED_KEY, '1');
    } catch {
      /* noop */
    }
  });

  // 2) Service Worker via workbox-window: tipo `prompt` → notifichiamo l'app
  //    quando c'è un nuovo SW in waiting. La `Workbox` istanzia tutto solo
  //    se il browser supporta SW e siamo in un contesto sicuro (HTTPS o
  //    localhost). In dev (`vite dev`) il SW è disabilitato dal config.
  if ('serviceWorker' in navigator && import.meta.env.PROD) {
    void import('workbox-window')
      .then(({ Workbox }) => {
        const wb = new Workbox('/sw.js');
        const reload = () => {
          wb.addEventListener('controlling', () => {
            window.location.reload();
          });
          // skipWaiting + reload: il SW in waiting subentra al SW attivo.
          wb.messageSkipWaiting();
        };
        wb.addEventListener('waiting', () => {
          if (onUpdate) onUpdate(reload);
        });
        void wb.register();
      })
      .catch(() => {
        // SW registration failure non deve impattare la UX dell'app.
      });
  }
}
