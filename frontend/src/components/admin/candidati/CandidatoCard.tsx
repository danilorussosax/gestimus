import { Pencil, Trash2, Users, Music, History } from 'lucide-react';
import { fileUrl } from '@/lib/api';
import { iconaPerSezione } from '@/lib/sezione-icon';
import type { CandidatoFull, MembroGruppo } from '@/api/candidati';
import type { Sezione, Categoria } from '@/types';
import { displayName, ageFromDate, fmtDate } from '../candidati-utils';

export interface CandidatoCardProps {
  candidato: CandidatoFull;
  sezione?: Sezione;
  categoria?: Categoria;
  membri: MembroGruppo[];
  onEdit: () => void;
  onManageMembers: () => void;
  onHistory: () => void;
  onDelete: () => void;
}

export function CandidatoCard({
  candidato: c,
  sezione,
  categoria,
  membri,
  onEdit,
  onManageMembers,
  onHistory,
  onDelete,
}: CandidatoCardProps) {
  const isOrchestra = c.tipo === 'orchestra';
  const isGruppo = c.tipo === 'gruppo' || isOrchestra;
  const age = ageFromDate(c.dataNascita);
  const fotoSrc = c.fotoUrl ? fileUrl(c.fotoUrl) : null;
  const docenti = c.docentiPreparatori ?? [];
  const gruppoBadgeLabel = isOrchestra ? 'ORCHESTRA' : 'GRUPPO';

  return (
    <div
      className={[
        'bg-white border rounded-2xl p-4 flex items-start gap-3 hover:border-slate-300 transition',
        isGruppo ? 'border-purple-200 bg-purple-50/30' : 'border-slate-200',
      ].join(' ')}
    >
      {/* Avatar */}
      <div
        className={[
          'w-14 h-14 rounded-full overflow-hidden flex items-center justify-center text-2xl text-slate-400 shrink-0 ring-2 ring-white shadow-soft',
          isGruppo ? 'bg-purple-100' : 'bg-slate-100',
        ].join(' ')}
      >
        {fotoSrc ? (
          <img src={fotoSrc} alt="" className="w-full h-full object-cover" />
        ) : isGruppo ? (
          isOrchestra ? (
            <Music className="h-6 w-6 text-purple-500" />
          ) : (
            <Users className="h-6 w-6 text-purple-500" />
          )
        ) : (
          <span>👤</span>
        )}
      </div>

      {/* Info */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          {c.numeroCandidato != null && (
            <span className="font-mono text-[11px] text-slate-500">
              #{String(c.numeroCandidato).padStart(3, '0')}
            </span>
          )}
          {isGruppo && (
            <span className="text-[10px] px-1.5 py-0.5 bg-purple-100 text-purple-700 rounded-full font-bold uppercase tracking-wider">
              {gruppoBadgeLabel}
            </span>
          )}
          {!isGruppo && c.nazionalita && (
            <span className="text-[10px] px-1.5 py-0.5 bg-slate-100 text-slate-700 rounded-full font-medium">
              {c.nazionalita}
            </span>
          )}
        </div>

        <h4 className="font-semibold text-slate-900 truncate mt-0.5">{displayName(c)}</h4>

        <p className="text-xs text-slate-600 truncate">
          {c.strumento || '—'}
          {!isGruppo && age != null && ` · ${age} anni`}
        </p>

        {/* Pill membri (gruppo) */}
        {isGruppo && membri.length > 0 && (
          <div className="mt-1.5 flex items-center gap-1 flex-wrap">
            {membri.map((m) => (
              <span
                key={m.id}
                className="text-[10px] px-1.5 py-0.5 bg-purple-100 text-purple-700 rounded-full font-medium"
              >
                {m.nome} {m.cognome ?? ''}
                {m.strumento ? ` · ${m.strumento}` : ''}
              </span>
            ))}
          </div>
        )}

        {/* Conteggio membri */}
        {membri.length > 0 && (
          <p className="text-[10px] text-purple-600 mt-0.5 font-medium">
            {membri.length} membr{membri.length === 1 ? 'o' : 'i'}
          </p>
        )}

        {/* Data di nascita (individuale) */}
        {!isGruppo && c.dataNascita && (
          <p className="text-[11px] text-slate-500 mt-0.5">Nato/a il {fmtDate(c.dataNascita)}</p>
        )}

        {/* Sezione / categoria */}
        {(sezione || categoria) && (
          <div className="mt-1.5 flex items-center gap-1 flex-wrap">
            {sezione && (
              <span className="text-[10px] px-1.5 py-0.5 bg-brand-50 text-brand-700 rounded-full font-medium">
                {iconaPerSezione(sezione.nome)} {sezione.nome}
              </span>
            )}
            {categoria && (
              <span className="text-[10px] px-1.5 py-0.5 bg-cyan-50 text-cyan-700 rounded-full font-medium">
                📑 {categoria.nome}
              </span>
            )}
          </div>
        )}

        {/* Docenti */}
        {docenti.length > 0 && (
          <div className="mt-2 flex items-center gap-1.5 flex-wrap">
            <span
              className="text-[10px] px-1.5 py-0.5 bg-violet-50 text-violet-700 rounded-full font-medium"
              title={docenti.join(' · ')}
            >
              {docenti.length === 1
                ? '1 docente preparatore'
                : `${docenti.length} docenti preparatori`}
            </span>
          </div>
        )}
      </div>

      {/* Azioni */}
      <div className="flex flex-col gap-1 shrink-0">
        <button
          className="text-xs text-brand-600 hover:bg-brand-50 px-2 py-1 rounded-lg font-medium"
          onClick={onEdit}
        >
          <Pencil className="inline h-3 w-3 mr-0.5" />
          Modifica
        </button>
        {isGruppo && (
          <button
            className="text-xs text-purple-600 hover:bg-purple-50 px-2 py-1 rounded-lg font-medium"
            onClick={onManageMembers}
          >
            <Users className="inline h-3 w-3 mr-0.5" />
            Membri
          </button>
        )}
        {!isGruppo && (
          <button
            className="text-xs text-amber-600 hover:bg-amber-50 px-2 py-1 rounded-lg font-medium"
            onClick={onHistory}
          >
            <History className="inline h-3 w-3 mr-0.5" />
            Storico
          </button>
        )}
        <button
          className="text-xs text-rose-600 hover:bg-rose-50 px-2 py-1 rounded-lg font-medium"
          onClick={onDelete}
        >
          <Trash2 className="inline h-3 w-3 mr-0.5" />
          Elimina
        </button>
      </div>
    </div>
  );
}
