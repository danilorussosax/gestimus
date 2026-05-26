import { useState, useEffect } from 'react';
import { toast } from 'sonner';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from '@/components/ui/dialog';
import { candidatiApi, type CandidatoFull } from '@/api/candidati';
import { useConcorsi } from '@/api/concorsi';
import { httpErrorMessage } from '@/lib/api';
import { displayName, norm } from '../candidati-utils';

interface StoricoRow {
  cand: CandidatoFull;
  concorsoNome: string;
  concorsoAnno: number | null;
  fasi: number;
  esibizioni: number;
  valutazioni: number;
}

export interface StoricoModalProps {
  open: boolean;
  candidato: CandidatoFull | null;
  onClose: () => void;
}

export function StoricoModal({ open, candidato, onClose }: StoricoModalProps) {
  const { data: concorsi = [] } = useConcorsi();
  const [rows, setRows] = useState<StoricoRow[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open || !candidato) return;
    let alive = true;
    setLoading(true);
    setRows([]);
    void (async () => {
      try {
        const all = await candidatiApi.listAll();
        const key = `${norm(candidato.nome)}|${norm(candidato.cognome)}`;
        const matches = all.filter(
          (c) =>
            c.id !== candidato.id &&
            `${norm(c.nome)}|${norm(c.cognome)}` === key,
        );
        const concorsoById = new Map(concorsi.map((c) => [c.id, c]));
        // Conteggi reali (bounded ai pochi match): fasi del concorso →
        // candidati-fase del candidato → valutazioni di ciascun cf.
        const built: StoricoRow[] = [];
        for (const c of matches) {
          const concorso = concorsoById.get(c.concorsoId);
          let fasiCount = 0;
          let esibizioni = 0;
          let valutazioni = 0;
          try {
            const fasi = await candidatiApi.fasi(c.concorsoId);
            fasiCount = fasi.length;
            for (const f of fasi) {
              const cfs = await candidatiApi.candidatiFase(f.id);
              const mine = cfs.filter((cf) => cf.candidatoId === c.id);
              esibizioni += mine.length;
              for (const cf of mine) {
                const vs = await candidatiApi.valutazioni(cf.id);
                valutazioni += vs.length;
              }
            }
          } catch {
            /* conteggi best-effort */
          }
          built.push({
            cand: c,
            concorsoNome: concorso?.nome ?? '—',
            concorsoAnno: concorso?.anno ?? null,
            fasi: fasiCount,
            esibizioni,
            valutazioni,
          });
        }
        built.sort((a, b) => (b.concorsoAnno ?? 0) - (a.concorsoAnno ?? 0));
        if (alive) setRows(built);
      } catch (e) {
        if (alive) toast.error(httpErrorMessage(e));
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [open, candidato, concorsi]);

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-2xl max-h-[85dvh] flex flex-col">
        <DialogHeader>
          <DialogTitle>Storico di {candidato ? displayName(candidato) : ''}</DialogTitle>
          <DialogDescription>
            Partecipazioni dello stesso candidato in altri concorsi.
          </DialogDescription>
        </DialogHeader>

        <div className="overflow-y-auto flex-1">
          {loading ? (
            <p className="text-sm text-slate-500 italic text-center py-8">Caricamento…</p>
          ) : rows.length === 0 ? (
            <p className="text-sm text-slate-500 italic text-center py-8">
              Nessuna partecipazione storica trovata.
            </p>
          ) : (
            <div className="space-y-3">
              {rows.map((r) => (
                <div key={r.cand.id} className="bg-white border border-slate-200 rounded-xl p-4">
                  <div className="flex items-center justify-between gap-3 mb-2">
                    <div>
                      <span className="font-semibold text-slate-900">{r.concorsoNome}</span>
                      <span className="text-xs text-slate-500 ml-2">{r.concorsoAnno ?? '—'}</span>
                    </div>
                    <span className="text-xs text-slate-500">
                      #{r.cand.numeroCandidato ?? '—'}
                    </span>
                  </div>
                  <div className="grid grid-cols-4 gap-2 text-xs">
                    <div className="bg-slate-50 rounded-lg px-2 py-1.5 text-center">
                      <div className="text-slate-500">fasi</div>
                      <div className="font-bold text-slate-800">{r.fasi}</div>
                    </div>
                    <div className="bg-slate-50 rounded-lg px-2 py-1.5 text-center">
                      <div className="text-slate-500">esibizioni</div>
                      <div className="font-bold text-slate-800">{r.esibizioni}</div>
                    </div>
                    <div className="bg-slate-50 rounded-lg px-2 py-1.5 text-center">
                      <div className="text-slate-500">valutazioni</div>
                      <div className="font-bold text-slate-800">{r.valutazioni}</div>
                    </div>
                    <div className="bg-slate-50 rounded-lg px-2 py-1.5 text-center">
                      <div className="text-slate-500">strumento</div>
                      <div className="font-bold text-slate-800 truncate text-[11px]">
                        {r.cand.strumento || '—'}
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <DialogFooter>
          <button className="c-btn c-btn--outline" onClick={onClose}>
            Chiudi
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
