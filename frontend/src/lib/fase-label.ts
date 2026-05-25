// Etichetta completa di una fase: "<fase madre> · <nome fase>".
// La "fase madre" è lo scope di sezione (vedi raggruppamento FasiTab):
//   - sezioniIds = []        → "Globale · <nome>"
//   - sezioniIds = [X]       → "<Sezione X> · <nome>"
//   - sezioniIds = [X, Y, …] → "<Sezione X + Sezione Y> · <nome>"
// Serve a distinguere più fasi figlie con lo stesso nome (es. due
// "Eliminatoria" su sezioni diverse) nei menù a tendina (calendario, verbali).

interface FaseLike {
  nome?: string | null;
  sezioniIds?: string[] | null;
}
interface SezioneLike {
  id: string;
  nome: string;
}

export function faseFullLabel(fase: FaseLike, sezioni: readonly SezioneLike[]): string {
  const nome = fase.nome ?? '—';
  const ids = Array.isArray(fase.sezioniIds) ? fase.sezioniIds : [];
  if (ids.length === 0) return `Globale · ${nome}`;
  const names = ids
    .map((id) => sezioni.find((s) => s.id === id)?.nome)
    .filter((n): n is string => Boolean(n));
  const scope = names.length ? names.join(' + ') : 'Sezione';
  return `${scope} · ${nome}`;
}
