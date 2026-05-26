// CredentialsModal — mostra email/password una sola volta (port di
// showCredentialsModal). Extracted from CommissariTab.tsx — pure lift-and-move.

import { useState } from 'react';
import { toast } from 'sonner';
import VanillaModal from './VanillaModal';

export default function CredentialsModal({
  email,
  password,
  title,
  subject,
  onClose,
}: {
  email: string;
  password: string;
  title: string;
  subject?: string;
  onClose: () => void;
}) {
  const [copiedEmail, setCopiedEmail] = useState(false);
  const [copiedPwd, setCopiedPwd] = useState(false);

  const copy = async (what: 'email' | 'password') => {
    const value = what === 'email' ? email : password;
    try {
      await navigator.clipboard.writeText(value);
      if (what === 'email') {
        setCopiedEmail(true);
        setTimeout(() => setCopiedEmail(false), 1500);
      } else {
        setCopiedPwd(true);
        setTimeout(() => setCopiedPwd(false), 1500);
      }
    } catch {
      toast.warning('Copia non riuscita — seleziona manualmente');
    }
  };

  return (
    <VanillaModal
      title={title}
      width="max-w-lg"
      onClose={onClose}
      footer={
        <>
          <button type="button" className="text-sm font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 px-3.5 py-2 rounded-lg" onClick={onClose}>
            Chiudi
          </button>
          <button type="button" className="text-sm font-semibold text-white bg-brand-600 hover:bg-brand-700 px-3.5 py-2 rounded-lg shadow-sm" onClick={onClose}>
            Ho copiato
          </button>
        </>
      }
    >
      <div className="space-y-3">
        {subject && (
          <p className="text-sm">
            Trasmetti queste credenziali a <strong>{subject}</strong>.
          </p>
        )}
        <div className="bg-slate-900 text-emerald-300 rounded-xl p-4 font-mono text-sm space-y-2">
          <div className="flex items-center gap-2">
            <span className="text-slate-400 shrink-0">email</span>
            <span className="flex-1 truncate select-all">{email}</span>
            <button
              type="button"
              className="text-[10px] bg-slate-800 hover:bg-slate-700 px-2 py-1 rounded text-emerald-300"
              onClick={() => copy('email')}
            >
              {copiedEmail ? '✓ Copiato' : 'Copia'}
            </button>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-slate-400 shrink-0">pwd&nbsp;&nbsp;</span>
            <span className="flex-1 truncate select-all">{password}</span>
            <button
              type="button"
              className="text-[10px] bg-slate-800 hover:bg-slate-700 px-2 py-1 rounded text-emerald-300"
              onClick={() => copy('password')}
            >
              {copiedPwd ? '✓ Copiato' : 'Copia'}
            </button>
          </div>
        </div>
        <div className="bg-amber-50 border border-amber-200 text-amber-900 text-xs rounded-lg px-3 py-2">
          ⚠ <strong>Salva la password ora.</strong> Non sarà più visualizzata: per perderla serve un reset.
        </div>
      </div>
    </VanillaModal>
  );
}
