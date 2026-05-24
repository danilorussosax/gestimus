/**
 * IscrizioneConferma.tsx — Verifica email post-iscrizione.
 *
 * Legge ?token= (parametro "t" nell'URL per compatibilità col link email
 * generato dal backend: /#/iscrizione/verify?t=…).
 * Chiama POST /api/public/iscrizioni/:token/verify.
 *
 * Pagina pubblica — NON usa AppLayout.
 */

import { useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useMutation } from '@tanstack/react-query';
import { publicApi } from '@/api/public';

export default function IscrizioneConferma() {
  const [searchParams] = useSearchParams();
  // Il backend genera ?t=TOKEN, ma accettiamo anche ?token=
  const token = searchParams.get('t') ?? searchParams.get('token') ?? '';

  const mut = useMutation({
    mutationFn: () => publicApi.verifyEmail(token),
  });

  useEffect(() => {
    if (token) mut.mutate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  const isLoading = mut.isPending || (!mut.isSuccess && !mut.isError && !token);
  const isError = mut.isError || (!token && !mut.isPending);
  const errorMsg = (() => {
    if (!token) return 'Link non valido (token mancante).';
    if (mut.error) {
      const e = mut.error as { status?: number; message?: string };
      if (e.status === 404) return 'Link non valido o già utilizzato.';
      return e.message ?? 'Errore di rete.';
    }
    return '';
  })();

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100 flex items-center justify-center p-4">
      <div className={`bg-white border ${isError ? 'border-rose-200' : 'border-emerald-200'} rounded-3xl shadow-lg p-8 text-center max-w-xl w-full`}>
        {isLoading ? (
          <>
            <div className="inline-flex items-center justify-center w-16 h-16 mb-4 rounded-full bg-slate-100">
              <svg className="w-8 h-8 text-slate-400 animate-spin" viewBox="0 0 24 24" fill="none">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
              </svg>
            </div>
            <p className="text-slate-600">Verifica in corso…</p>
          </>
        ) : isError ? (
          <>
            <div className="text-5xl mb-4">⚠️</div>
            <h1 className="text-xl font-bold text-rose-900 mb-2">Impossibile verificare l'email</h1>
            <p className="text-sm text-slate-700">{errorMsg}</p>
            <p className="text-xs text-slate-500 mt-3">Se il problema persiste, contatta l'organizzazione del concorso.</p>
            <a href="/" className="inline-block mt-6 px-4 py-2 border border-slate-300 rounded-lg text-sm font-medium text-slate-700 hover:bg-slate-50 transition-colors">
              Torna alla home
            </a>
          </>
        ) : (
          <>
            <div className="text-5xl mb-4">✅</div>
            <h1 className="text-xl font-bold text-emerald-900 mb-2">Email verificata</h1>
            <p className="text-sm text-slate-700">
              Grazie! La tua iscrizione è stata confermata ed è in attesa di revisione da parte dell'organizzazione.
            </p>
            {mut.data?.alreadyVerified && (
              <p className="text-xs text-slate-500 mt-2">Nota: l'email era già stata verificata in precedenza.</p>
            )}
            <p className="text-xs text-slate-500 mt-4">Riceverai una comunicazione quando la tua domanda sarà stata esaminata.</p>
            <a href="/" className="inline-block mt-6 px-4 py-2 border border-slate-300 rounded-lg text-sm font-medium text-slate-700 hover:bg-slate-50 transition-colors">
              Chiudi
            </a>
          </>
        )}
      </div>
    </div>
  );
}
