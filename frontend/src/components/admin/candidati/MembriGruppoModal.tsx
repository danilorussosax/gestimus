import { useState, useEffect, useCallback } from 'react';
import { toast } from 'sonner';
import { Plus } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { candidatiApi, type CandidatoFull, type MembroGruppo } from '@/api/candidati';
import { httpErrorMessage } from '@/lib/api';
import { displayName } from '../candidati-utils';

export interface MembriModalProps {
  open: boolean;
  gruppo: CandidatoFull | null;
  /** Candidati del concorso, per il picker "aggiungi membro esistente". */
  candidati: CandidatoFull[];
  onClose: () => void;
}

export function MembriGruppoModal({ open, gruppo, candidati, onClose }: MembriModalProps) {
  const [membri, setMembri] = useState<MembroGruppo[]>([]);
  const [loading, setLoading] = useState(false);
  const [draft, setDraft] = useState({ nome: '', cognome: '', strumento: '', dataNascita: '' });
  const [pickSearch, setPickSearch] = useState('');
  const [busy, setBusy] = useState(false);

  const reload = useCallback(async () => {
    if (!gruppo) return;
    setLoading(true);
    try {
      const rows = await candidatiApi.membri(gruppo.id);
      setMembri(rows);
    } catch (e) {
      toast.error(httpErrorMessage(e));
    } finally {
      setLoading(false);
    }
  }, [gruppo]);

  useEffect(() => {
    if (open && gruppo) {
      setDraft({ nome: '', cognome: '', strumento: '', dataNascita: '' });
      setPickSearch('');
      void reload();
    }
  }, [open, gruppo, reload]);

  const addMembro = async () => {
    if (!gruppo || !draft.nome.trim()) {
      toast.error('Il nome del membro è obbligatorio');
      return;
    }
    setBusy(true);
    try {
      await candidatiApi.addMembro({
        candidatoId: gruppo.id,
        nome: draft.nome.trim(),
        cognome: draft.cognome.trim() || undefined,
        strumento: draft.strumento.trim() || undefined,
        dataNascita: draft.dataNascita.trim() || undefined,
      });
      setDraft({ nome: '', cognome: '', strumento: '', dataNascita: '' });
      await reload();
    } catch (e) {
      toast.error(httpErrorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  // Aggiunge un candidato individuale già esistente come membro, copiandone
  // l'anagrafica (porting della modale vanilla openMembriGruppoModal).
  const addExisting = async (cand: CandidatoFull) => {
    if (!gruppo) return;
    setBusy(true);
    try {
      await candidatiApi.addMembro({
        candidatoId: gruppo.id,
        nome: cand.nome,
        cognome: cand.cognome ?? undefined,
        strumento: cand.strumento ?? undefined,
        dataNascita: cand.dataNascita ?? undefined,
      });
      await reload();
    } catch (e) {
      toast.error(httpErrorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const removeMembro = async (id: string) => {
    setBusy(true);
    try {
      await candidatiApi.removeMembro(id);
      await reload();
    } catch (e) {
      toast.error(httpErrorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const isGroup = gruppo?.tipo === 'gruppo' || gruppo?.tipo === 'orchestra';

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Membri di {gruppo ? displayName(gruppo) : ''}</DialogTitle>
        </DialogHeader>

        {!isGroup ? (
          <p className="text-sm text-rose-600">Questo candidato non è un gruppo.</p>
        ) : (
          <div className="space-y-4">
            <div>
              <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">
                Membri attuali ({membri.length})
              </p>
              {loading ? (
                <p className="text-sm text-slate-400 italic">Caricamento…</p>
              ) : membri.length === 0 ? (
                <p className="text-sm text-slate-500 italic">Nessun membro inserito.</p>
              ) : (
                <div className="space-y-2">
                  {membri.map((m) => (
                    <div
                      key={m.id}
                      className="flex items-center justify-between bg-slate-50 border border-slate-200 rounded-lg px-3 py-2"
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        <span className="font-medium text-slate-800 text-sm truncate">
                          {[m.nome, m.cognome].filter(Boolean).join(' ')}
                        </span>
                        {m.strumento && (
                          <span className="text-[10px] px-1.5 py-0.5 bg-purple-50 text-purple-700 rounded-full">
                            {m.strumento}
                          </span>
                        )}
                      </div>
                      <button
                        className="text-xs text-rose-600 hover:bg-rose-50 px-2 py-1 rounded-lg font-medium shrink-0"
                        disabled={busy}
                        onClick={() => removeMembro(m.id)}
                      >
                        Elimina
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Picker: aggiungi un candidato individuale già esistente come membro */}
            <div className="pt-3 border-t border-slate-200">
              <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">
                Aggiungi da candidati esistenti
              </p>
              <input
                className="c-input mb-2"
                placeholder="Cerca candidato per nome…"
                value={pickSearch}
                onChange={(e) => setPickSearch(e.target.value)}
              />
              {(() => {
                const q = pickSearch.trim().toLowerCase();
                const pickable = candidati.filter(
                  (c) =>
                    c.id !== gruppo.id &&
                    c.tipo !== 'gruppo' &&
                    c.tipo !== 'orchestra' &&
                    (q === '' ||
                      `${c.nome} ${c.cognome ?? ''}`.toLowerCase().includes(q)),
                );
                if (pickable.length === 0) {
                  return (
                    <p className="text-xs text-slate-400 italic">
                      {q ? 'Nessun candidato trovato.' : 'Nessun candidato individuale disponibile.'}
                    </p>
                  );
                }
                return (
                  <div className="max-h-40 overflow-y-auto space-y-1">
                    {pickable.slice(0, 20).map((c) => (
                      <button
                        key={c.id}
                        type="button"
                        disabled={busy}
                        onClick={() => void addExisting(c)}
                        className="w-full flex items-center justify-between gap-2 text-left px-3 py-1.5 rounded-lg border border-slate-200 hover:bg-brand-50 disabled:opacity-50"
                      >
                        <span className="text-sm text-slate-800 truncate">
                          {[c.nome, c.cognome].filter(Boolean).join(' ')}
                          {c.strumento && (
                            <span className="ml-2 text-[10px] text-purple-700">{c.strumento}</span>
                          )}
                        </span>
                        <span className="text-xs text-brand-700 font-medium shrink-0">+ aggiungi</span>
                      </button>
                    ))}
                  </div>
                );
              })()}
            </div>

            <div className="pt-3 border-t border-slate-200">
              <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">
                Aggiungi membro manualmente
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                <input
                  className="c-input"
                  placeholder="Nome *"
                  value={draft.nome}
                  onChange={(e) => setDraft((d) => ({ ...d, nome: e.target.value }))}
                />
                <input
                  className="c-input"
                  placeholder="Cognome"
                  value={draft.cognome}
                  onChange={(e) => setDraft((d) => ({ ...d, cognome: e.target.value }))}
                />
                <input
                  className="c-input"
                  placeholder="Strumento"
                  value={draft.strumento}
                  onChange={(e) => setDraft((d) => ({ ...d, strumento: e.target.value }))}
                />
                <input
                  type="date"
                  className="c-input"
                  value={draft.dataNascita}
                  onChange={(e) => setDraft((d) => ({ ...d, dataNascita: e.target.value }))}
                />
              </div>
              <button
                type="button"
                className="c-btn c-btn--sm c-btn--primary mt-2"
                disabled={busy}
                onClick={addMembro}
              >
                <Plus className="h-4 w-4" /> Aggiungi
              </button>
            </div>
          </div>
        )}

        <DialogFooter>
          <button className="c-btn c-btn--outline" onClick={onClose}>
            Chiudi
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
