// =============================================================================
// lib/presidenti.ts — derivazione del PRESIDENTE (porting 1:1 della vanilla).
//
// Sorgente di verità: js/db.js (~righe 1063–1124). Nel modello attuale il
// presidente è un attributo PER-COMMISSIONE (commissioni.presidente_commissario_id,
// camelCase server: `presidenteCommissarioId`), NON più del singolo commissario.
// Una commissione ha quindi al più un presidente; un commissario può essere
// presidente di più commissioni; un concorso può avere più presidenti distinti.
//
// Le funzioni sono PURE: ricevono gli array di dati (commissioni/commissari/fasi)
// invece di leggere uno stato globale come faceva il vanilla `db.state`. La logica
// è identica al vanilla — qui usiamo i nomi di campo reali del server:
//   commissione.presidenteCommissarioId  (vanilla: presidente_id)
//   commissione.concorsoId               (vanilla: concorso_id)
//   commissione.commissari[]             (id dei commissari membri; non serve ai
//                                         calcoli del presidente ma fa parte della
//                                         shape reale del record)
//   commissario.id
//   fase.commissioneId                   (vanilla: commissione_id)
//   fase.concorsoId
//   fase.ordine
// =============================================================================

// ── Shape minime (structural) accettate dalle funzioni ──────────────────────
// Volutamente strette: bastano i campi usati dai calcoli, così sia i record API
// (CommissioneRecord/CommissarioRecord/FaseRecord) sia eventuali tipi locali che
// portano gli stessi campi soddisfano la firma.

export interface CommissioneLike {
  id: string;
  concorsoId: string;
  presidenteCommissarioId: string | null;
  /** id dei commissari membri (parte della shape server; non usato dai calcoli). */
  commissari?: string[];
}

export interface CommissarioLike {
  id: string;
}

export interface FaseLike {
  concorsoId: string;
  commissioneId: string | null;
  ordine: number;
}

// ── Helpers (porting 1:1 da db.js) ───────────────────────────────────────────

/**
 * Il commissario che è presidente di QUELLA commissione.
 * Vanilla: db.getPresidenteForCommissione(commissione_or_id).
 *
 * Accetta la commissione (oggetto) o il suo id. Restituisce il record
 * commissario oppure null se la commissione non esiste o non ha presidente.
 */
export function getPresidenteForCommissione<C extends CommissarioLike>(
  commissioneOrId: CommissioneLike | string | null | undefined,
  commissioni: CommissioneLike[],
  commissari: C[],
): C | null {
  const c =
    typeof commissioneOrId === 'string'
      ? commissioni.find((x) => x.id === commissioneOrId)
      : commissioneOrId;
  if (!c?.presidenteCommissarioId) return null;
  return commissari.find((x) => x.id === c.presidenteCommissarioId) ?? null;
}

/**
 * Presidente della commissione che gestisce questa fase (fase.commissioneId).
 * Vanilla: db.getPresidenteForFase(fase).
 */
export function getPresidenteForFase<C extends CommissarioLike>(
  fase: FaseLike | null | undefined,
  commissioni: CommissioneLike[],
  commissari: C[],
): C | null {
  if (!fase?.commissioneId) return null;
  return getPresidenteForCommissione(fase.commissioneId, commissioni, commissari);
}

/**
 * true se il commissario è presidente di ALMENO UNA commissione.
 * Vanilla: db.isPresidenteDiQualcheCommissione(commissario_id).
 */
export function isPresidenteDiQualcheCommissione(
  commissarioId: string,
  commissioni: CommissioneLike[],
): boolean {
  return commissioni.some((c) => c.presidenteCommissarioId === commissarioId);
}

/**
 * Presidente unico del concorso SOLO se tutte le commissioni convergono sullo
 * stesso commissario; altrimenti null.
 * Vanilla (deprecato): db.getPresidenteFor(concorso_id).
 */
export function getPresidenteForConcorso<C extends CommissarioLike>(
  concorsoId: string,
  commissioni: CommissioneLike[],
  commissari: C[],
): C | null {
  const ids = new Set(
    commissioni
      .filter((c) => c.concorsoId === concorsoId && c.presidenteCommissarioId)
      .map((c) => c.presidenteCommissarioId),
  );
  if (ids.size !== 1) return null;
  const [only] = ids;
  return commissari.find((x) => x.id === only) ?? null;
}

/**
 * Tutti i presidenti distinti del concorso, ognuno con la lista di commissioni
 * di cui è presidente. Una entry per presidente distinto; le entry senza
 * commissario risolto vengono scartate (come nel vanilla).
 * Vanilla: db.presidentiFor(concorso_id).
 */
export function presidentiFor<C extends CommissarioLike, K extends CommissioneLike>(
  concorsoId: string,
  commissioni: K[],
  commissari: C[],
): { presidente: C; commissioni: K[] }[] {
  const byPres = new Map<string, K[]>();
  for (const c of commissioni) {
    if (c.concorsoId !== concorsoId || !c.presidenteCommissarioId) continue;
    const arr = byPres.get(c.presidenteCommissarioId) ?? [];
    arr.push(c);
    byPres.set(c.presidenteCommissarioId, arr);
  }
  return Array.from(byPres.entries())
    .map(([pid, comms]) => ({
      presidente: commissari.find((x) => x.id === pid) ?? null,
      commissioni: comms,
    }))
    .filter((x): x is { presidente: C; commissioni: K[] } => x.presidente !== null);
}

/**
 * Presidente della commissione che gestisce la fase FINALE del concorso, cioè
 * quella con `ordine` MASSIMO (gli ordini possono avere buchi dopo cancellazioni
 * di fasi — vedi M211). null se non ci sono fasi del concorso.
 * Vanilla: db.getPresidenteForFinale(concorso_id).
 */
export function getPresidenteForFinale<C extends CommissarioLike>(
  concorsoId: string,
  commissioni: CommissioneLike[],
  commissari: C[],
  fasi: FaseLike[],
): C | null {
  const dellConcorso = fasi.filter((f) => f.concorsoId === concorsoId);
  if (dellConcorso.length === 0) return null;
  const finale = dellConcorso.reduce(
    (mx, f) => (f.ordine > mx.ordine ? f : mx),
    dellConcorso[0],
  );
  return getPresidenteForFase(finale, commissioni, commissari);
}
