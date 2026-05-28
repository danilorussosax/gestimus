// =============================================================================
// FasiConcluseSummary — riepilogo per il commissario delle fasi CONCLUSA cui era
// assegnato. Mostra la classifica (per media) + l'esito DEFINITIVO (PROMOSSO/
// ELIMINATO da `cf.ammessoProssimaFase`, settato dal conclude lato server via
// computeAdmittedIds). NIENTE calcoli di "verdetto" lato client: l'esito è già
// nel DB.
// =============================================================================

import type { Fase, Candidato, CandidatoFase, Valutazione, Concorso } from '@/types';
import { mediaCandidato, criteriFromRecords, fmtVoto, getScala } from '@/lib/scoring';

export interface FasiConcluseSummaryProps {
  concorso: Pick<Concorso, 'anonimo'>;
  fasi: Fase[]; // fasi CONCLUSA cui il commissario è (o era) assegnato
  cfList: CandidatoFase[];
  valutazioni: Valutazione[];
  candidati: Candidato[];
}

export function FasiConcluseSummary({ concorso, fasi, cfList, valutazioni, candidati }: FasiConcluseSummaryProps) {
  if (fasi.length === 0) return null;
  const sortedFasi = [...fasi].sort((a, b) => (a.ordine ?? 0) - (b.ordine ?? 0));
  return (
    <section className="mt-8">
      <h3 className="text-lg font-bold text-slate-900 mb-4">Riepilogo fasi concluse</h3>
      <div className="space-y-4">
        {sortedFasi.map((fase) => (
          <FaseConclusaCard
            key={fase.id}
            fase={fase}
            cfList={cfList}
            valutazioni={valutazioni}
            candidati={candidati}
            anonimo={concorso.anonimo ?? false}
          />
        ))}
      </div>
    </section>
  );
}

function FaseConclusaCard({
  fase, cfList, valutazioni, candidati, anonimo,
}: {
  fase: Fase;
  cfList: CandidatoFase[];
  valutazioni: Valutazione[];
  candidati: Candidato[];
  anonimo: boolean;
}) {
  const scala = getScala(fase);
  const criteri = criteriFromRecords((fase as Fase & { criteri?: unknown }).criteri ?? []);
  const faseWithCriteri = { ...fase, criteri };
  const faseCfs = cfList.filter((cf) => cf.faseId === fase.id);
  const rows = faseCfs.map((cf) => {
    const cand = candidati.find((c) => c.id === cf.candidatoId) ?? null;
    const vs = valutazioni
      .filter((v) => v.candidatoFaseId === cf.id)
      .map((v) => ({ commissario_id: v.commissarioId, criterio: v.criterio, voto: v.voto }));
    return { cf, cand, media: mediaCandidato(vs, faseWithCriteri) };
  });
  rows.sort((a, b) => b.media - a.media);

  return (
    <div className="bg-white border border-slate-200 rounded-2xl p-4 sm:p-5 shadow-soft">
      <header className="flex items-center justify-between mb-3 flex-wrap gap-2">
        <h4 className="font-semibold text-slate-900">
          <span className="text-slate-400 font-mono mr-1.5">#{fase.ordine}</span>
          {fase.nome}
        </h4>
        <span className="text-[11px] font-mono uppercase tracking-wider bg-slate-200 text-slate-700 px-2 py-0.5 rounded-full">
          CONCLUSA
        </span>
      </header>
      {rows.length === 0 ? (
        <p className="text-sm text-slate-500 italic">Nessun candidato in questa fase.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-[11px] text-slate-500 uppercase tracking-wider border-b border-slate-200">
                <th className="text-left py-2 pr-2 font-semibold w-10">Pos</th>
                <th className="text-center py-2 px-2 font-semibold w-12">N°</th>
                <th className="text-left py-2 px-2 font-semibold">Candidato</th>
                <th className="text-center py-2 px-2 font-semibold w-20">Media</th>
                <th className="text-center py-2 pl-2 font-semibold w-24">Esito</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => {
                const num = r.cand?.numeroCandidato ?? null;
                const nomeVis = anonimo
                  ? `#${String(num ?? '').padStart(3, '0')}`
                  : `${r.cand?.cognome ?? ''} ${r.cand?.nome ?? ''}`.trim() || '—';
                const completato = r.cf.stato === 'COMPLETATO';
                return (
                  <tr key={r.cf.id} className="border-b border-slate-100 last:border-b-0">
                    <td className="py-2 pr-2 font-mono tabular-nums text-slate-700">{i + 1}</td>
                    <td className="text-center px-2 font-mono tabular-nums text-slate-700">{num ?? '—'}</td>
                    <td className="py-2 px-2 text-slate-900 truncate">{nomeVis}</td>
                    <td className="text-center px-2 font-mono tabular-nums font-medium">
                      {Number.isFinite(r.media) ? fmtVoto(r.media, scala) : '—'}
                    </td>
                    <td className="text-center pl-2">
                      {!completato ? (
                        <span className="text-xs text-slate-400 italic">in attesa</span>
                      ) : r.cf.ammessoProssimaFase ? (
                        <span className="text-xs font-bold text-emerald-700">PROMOSSO</span>
                      ) : (
                        <span className="text-xs font-bold text-rose-700">ELIMINATO</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
