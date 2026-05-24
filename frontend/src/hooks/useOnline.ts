import { useEffect, useState } from 'react';

/**
 * Restituisce lo stato di connettività del browser come booleano reattivo.
 * Si basa su `navigator.onLine` + eventi `online`/`offline`.
 *
 * Limiti noti: `navigator.onLine` può essere true anche quando la rete è
 * presente ma il backend è irraggiungibile (es. captive portal, server
 * down). Per quelli React Query gestisce già retry/error UI a livello
 * della singola query — questo hook serve solo per il banner globale
 * "Sei offline" (skill rule `offline-support`).
 */
export function useOnline(): boolean {
  const [online, setOnline] = useState(() =>
    typeof navigator === 'undefined' ? true : navigator.onLine,
  );

  useEffect(() => {
    const setOn = () => {
      setOnline(true);
    };
    const setOff = () => {
      setOnline(false);
    };
    window.addEventListener('online', setOn);
    window.addEventListener('offline', setOff);
    return () => {
      window.removeEventListener('online', setOn);
      window.removeEventListener('offline', setOff);
    };
  }, []);

  return online;
}
