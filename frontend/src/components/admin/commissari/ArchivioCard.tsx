// ArchivioCard — card archivio (port di archivioCardHtml).
// Extracted from CommissariTab.tsx — pure lift-and-move.

import { useState } from 'react';
import { fileUrl } from '@/lib/api';
import type { CommissarioRecord } from '@/api/commissari';
import { displayName, ageFromDate } from '../commissari-utils';
import CvTextModal from './CvTextModal';

export default function ArchivioCard({
  commissario: c,
  inThis,
  onImport,
  importing,
}: {
  commissario: CommissarioRecord;
  inThis: boolean;
  onImport: () => void;
  importing: boolean;
}) {
  const eta = ageFromDate(c.dataNascita);
  const [cvOpen, setCvOpen] = useState(false);
  const fotoSrc = c.foto ? fileUrl(c.foto) : null;

  return (
    <>
      <div
        className={`bg-white border ${
          inThis ? 'border-emerald-200 bg-emerald-50/30' : 'border-slate-200'
        } rounded-2xl p-4 flex flex-col gap-3 hover:border-brand-300 transition`}
      >
        <div className="flex items-start gap-3">
          <div className="w-14 h-14 rounded-full bg-gradient-to-br from-amber-100 to-orange-100 overflow-hidden flex items-center justify-center text-2xl text-amber-700 shrink-0 ring-2 ring-white shadow-soft">
            {fotoSrc ? (
              <img src={fotoSrc} alt="" className="w-full h-full object-cover" />
            ) : (
              '🧑‍⚖️'
            )}
          </div>
          <div className="flex-1 min-w-0">
            <h4 className="font-semibold text-slate-900 truncate">{displayName(c)}</h4>
            <p className="text-xs text-slate-600 truncate">
              {c.specialita || '—'}
              {eta != null && ` · ${eta} anni`}
              {c.nazionalita && ` · ${c.nazionalita}`}
            </p>
            {c.email && (
              <p className="text-[11px] text-slate-500 truncate mt-0.5">✉ {c.email}</p>
            )}
            {c.telefono && <p className="text-[11px] text-slate-500 truncate">☎ {c.telefono}</p>}
          </div>
        </div>
        {c.bio && (
          <p className="text-[11px] text-slate-600 leading-relaxed line-clamp-2">{c.bio}</p>
        )}
        <div className="flex items-center gap-1.5 flex-wrap">
          {c.cv && (
            <button
              onClick={() => setCvOpen(true)}
              className="text-[11px] px-2 py-0.5 bg-emerald-50 text-emerald-700 hover:bg-emerald-100 rounded-full font-medium"
              title="Vedi CV"
            >
              📄 CV
            </button>
          )}
        </div>
        <div className="mt-auto pt-1">
          {inThis ? (
            <button
              disabled
              className="w-full text-xs font-semibold text-emerald-700 bg-emerald-100 px-3 py-2 rounded-lg cursor-default"
            >
              ✓ Già in questo concorso
            </button>
          ) : (
            <button
              onClick={onImport}
              disabled={importing}
              className="w-full text-xs font-semibold text-white bg-brand-600 hover:bg-brand-700 px-3 py-2 rounded-lg shadow-sm transition disabled:opacity-50"
            >
              {importing ? 'Importazione…' : '+ Aggiungi a questo concorso'}
            </button>
          )}
        </div>
      </div>

      {c.cv && cvOpen && <CvTextModal text={c.cv} onClose={() => setCvOpen(false)} />}
    </>
  );
}
