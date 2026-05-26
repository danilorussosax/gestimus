// CommissarioCard — card commissario attivo (port di commissarioCardHtml).
// Extracted from CommissariTab.tsx — pure lift-and-move.

import { useState } from 'react';
import { fileUrl } from '@/lib/api';
import type { CommissarioRecord } from '@/api/commissari';
import { displayName, ageFromDate } from '../commissari-utils';
import CvTextModal from './CvTextModal';

export interface CardProps {
  commissario: CommissarioRecord;
  isPresidente: boolean;
  onEdit: () => void;
  onUnassign: () => void;
  onDelete: () => void;
}

export default function CommissarioCard({ commissario: c, isPresidente, onEdit, onUnassign, onDelete }: CardProps) {
  const eta = ageFromDate(c.dataNascita);
  const [cvOpen, setCvOpen] = useState(false);
  const fotoSrc = c.foto ? fileUrl(c.foto) : null;

  const ringCls = isPresidente ? 'ring-2 ring-amber-400' : 'ring-2 ring-white';
  const cardCls = isPresidente ? 'border-amber-300 bg-amber-50/40' : 'border-slate-200';

  return (
    <>
      <div
        className={`bg-white border ${cardCls} rounded-2xl p-4 flex items-start gap-3 hover:border-slate-300 transition`}
      >
        <div
          className={`w-14 h-14 rounded-full bg-gradient-to-br from-amber-100 to-orange-100 overflow-hidden flex items-center justify-center text-2xl text-amber-700 shrink-0 ${ringCls} shadow-soft`}
        >
          {fotoSrc ? (
            <img src={fotoSrc} alt="" className="w-full h-full object-cover" />
          ) : (
            '🧑‍⚖️'
          )}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h4 className="font-semibold text-slate-900 truncate">{displayName(c)}</h4>
            {isPresidente && (
              <span className="text-[10px] font-bold px-1.5 py-0.5 bg-amber-500 text-white rounded-full">
                🎯 PRESIDENTE
              </span>
            )}
            {c.nazionalita && (
              <span className="text-[10px] px-1.5 py-0.5 bg-slate-100 text-slate-700 rounded-full font-medium">
                {c.nazionalita}
              </span>
            )}
          </div>
          <p className="text-xs text-slate-600 truncate">
            {c.specialita || '—'}
            {eta != null && ` · ${eta} anni`}
          </p>
          {c.email && (
            <p className="text-[11px] text-slate-500 truncate mt-0.5">✉ {c.email}</p>
          )}
          {c.telefono && <p className="text-[11px] text-slate-500 truncate">☎ {c.telefono}</p>}
          <div className="mt-2 flex items-center gap-1.5 flex-wrap">
            {c.cv && (
              <button
                onClick={() => setCvOpen(true)}
                className="inline-flex items-center gap-1 text-[11px] px-2 py-0.5 bg-emerald-50 text-emerald-700 hover:bg-emerald-100 rounded-full font-medium"
                title="Vedi CV"
              >
                📄 CV
              </button>
            )}
            {c.bio && (
              <span
                className="text-[10px] px-1.5 py-0.5 bg-violet-50 text-violet-700 rounded-full font-medium"
                title={c.bio}
              >
                📝 bio
              </span>
            )}
          </div>
        </div>
        <div className="flex flex-col gap-1 shrink-0">
          <button
            onClick={onEdit}
            className="text-xs text-brand-600 hover:bg-brand-50 px-2 py-1 rounded-lg font-medium"
          >
            Modifica
          </button>
          <button
            onClick={onUnassign}
            className="text-xs text-amber-700 hover:bg-amber-50 px-2 py-1 rounded-lg font-medium"
            title="Rimuovi questo commissario dal concorso corrente (resta in archivio)"
          >
            ↩ Rimuovi
          </button>
          <button
            onClick={onDelete}
            className="text-xs text-rose-600 hover:bg-rose-50 px-2 py-1 rounded-lg font-medium"
            title="Elimina il commissario dall'archivio (sparisce dal concorso)"
          >
            🗑 Elimina
          </button>
        </div>
      </div>

      {c.cv && cvOpen && <CvTextModal text={c.cv} onClose={() => setCvOpen(false)} />}
    </>
  );
}
