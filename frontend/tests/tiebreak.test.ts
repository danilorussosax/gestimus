import { describe, it, expect } from 'vitest';
import {
  effectiveStrategy,
  rankWithTieBreak,
  defaultTiebreakStrategy,
  computeAdmittedIds,
} from '@/lib/tiebreak';

// Fase minimale: scala 10, criteri di default, nessuno scope sezione.
const fase = {
  id: 'f1',
  ordine: 1,
  scala: 10,
  metodoMedia: 'aritmetica',
  sezioniIds: [],
};

// Due candidati con MEDIA IDENTICA e NESSUN dato per spareggiare
// (valutazioni vuote → scomposizione/presidente non separano; niente
// data_nascita → età non separa). Così la cascata arriva all'ultimo passo.
function tiedRows() {
  return [
    { cf: { id: 'cf1', candidatoId: 'c1', stato: 'COMPLETATO', ammessoProssimaFase: false },
      cand: { id: 'c1', numero_candidato: 5 }, media: 8, valutazioni: [] },
    { cf: { id: 'cf2', candidatoId: 'c2', stato: 'COMPLETATO', ammessoProssimaFase: false },
      cand: { id: 'c2', numero_candidato: 3 }, media: 8, valutazioni: [] },
  ];
}

describe('effectiveStrategy — priorità override fase > default concorso > tutto attivo', () => {
  it('senza config usa tutti i passi attivi', () => {
    const s = effectiveStrategy({ sezioniIds: [] }, null);
    expect(s).toEqual(defaultTiebreakStrategy());
    expect(s.every((x) => x.enabled)).toBe(true);
  });

  it('eredita il default del CONCORSO quando la fase non ha override', () => {
    const concorso = {
      defaultTiebreakStrategy: [
        { key: 'scomposizione', enabled: true },
        { key: 'presidente', enabled: false },
        { key: 'eta', enabled: true },
        { key: 'ex_aequo', enabled: false },
      ],
    };
    const s = effectiveStrategy({ sezioniIds: [] }, concorso);
    expect(s.find((x) => x.key === 'presidente')!.enabled).toBe(false);
    expect(s.find((x) => x.key === 'ex_aequo')!.enabled).toBe(false);
    // ordine fisso preservato
    expect(s.map((x) => x.key)).toEqual(['scomposizione', 'presidente', 'eta', 'ex_aequo']);
  });

  it("l'override della FASE vince sul default del concorso", () => {
    const concorso = { defaultTiebreakStrategy: [{ key: 'ex_aequo', enabled: false }] };
    const faseOverride = { sezioniIds: [], tiebreakStrategy: [{ key: 'ex_aequo', enabled: true }] };
    const s = effectiveStrategy(faseOverride, concorso);
    expect(s.find((x) => x.key === 'ex_aequo')!.enabled).toBe(true);
  });
});

describe('rankWithTieBreak — passi disattivati NON applicati', () => {
  it('ex_aequo ATTIVO → parità dichiarata ex aequo (stessa posizione)', () => {
    const ranked = rankWithTieBreak(tiedRows(), fase, {
      strategy: effectiveStrategy(fase, null), // tutti attivi
    });
    expect(ranked.every((r) => r.ex_aequo_group)).toBe(true);
    expect(ranked[0].posizione_finale).toBe(ranked[1].posizione_finale);
    expect(ranked.some((r) => r.tiebreak_log.some((l) => l.step === 'ex_aequo'))).toBe(true);
  });

  it('ex_aequo DISATTIVATO (default concorso, fase eredita) → NESSUN ex aequo', () => {
    const concorso = {
      defaultTiebreakStrategy: [
        { key: 'scomposizione', enabled: true },
        { key: 'presidente', enabled: true },
        { key: 'eta', enabled: true },
        { key: 'ex_aequo', enabled: false },
      ],
    };
    const ranked = rankWithTieBreak(tiedRows(), fase, {
      strategy: effectiveStrategy(fase, concorso),
    });
    // nessun gruppo ex aequo, posizioni distinte, log = parita_residua
    expect(ranked.every((r) => r.ex_aequo_group == null)).toBe(true);
    expect(new Set(ranked.map((r) => r.posizione_finale)).size).toBe(2);
    expect(ranked.some((r) => r.tiebreak_log.some((l) => l.step === 'parita_residua'))).toBe(true);
    expect(ranked.some((r) => r.tiebreak_log.some((l) => l.step === 'ex_aequo'))).toBe(false);
  });

  it('un passo intermedio disattivato non compare nella cascata applicata', () => {
    const faseOverride = {
      ...fase,
      tiebreakStrategy: [
        { key: 'scomposizione', enabled: false },
        { key: 'presidente', enabled: false },
        { key: 'eta', enabled: false },
        { key: 'ex_aequo', enabled: true },
      ],
    };
    const ranked = rankWithTieBreak(tiedRows(), faseOverride, {
      strategy: effectiveStrategy(faseOverride, null),
    });
    // tutti i passi separatori disattivati → si va diretti a ex_aequo
    expect(ranked.every((r) => r.ex_aequo_group)).toBe(true);
    // nessun log di scomposizione/presidente/eta (disattivati → non eseguiti)
    const steps = ranked.flatMap((r) => r.tiebreak_log.map((l) => l.step));
    expect(steps).not.toContain('scomposizione');
    expect(steps).not.toContain('presidente');
    expect(steps).not.toContain('eta');
  });
});

describe('computeAdmittedIds — top-N ammessi con ex aequo al taglio inclusi (N144)', () => {
  // 4 candidati con medie distinte: c1=9, c2=8, c3=7, c4=6 → posizioni 1..4
  function ranked4() {
    const rows = [
      { cf: { id: 'cf1', candidatoId: 'c1', stato: 'COMPLETATO', ammessoProssimaFase: false }, cand: { id: 'c1', numero_candidato: 1 }, media: 9, valutazioni: [] },
      { cf: { id: 'cf2', candidatoId: 'c2', stato: 'COMPLETATO', ammessoProssimaFase: false }, cand: { id: 'c2', numero_candidato: 2 }, media: 8, valutazioni: [] },
      { cf: { id: 'cf3', candidatoId: 'c3', stato: 'COMPLETATO', ammessoProssimaFase: false }, cand: { id: 'c3', numero_candidato: 3 }, media: 7, valutazioni: [] },
      { cf: { id: 'cf4', candidatoId: 'c4', stato: 'COMPLETATO', ammessoProssimaFase: false }, cand: { id: 'c4', numero_candidato: 4 }, media: 6, valutazioni: [] },
    ];
    return rankWithTieBreak(rows, fase, { strategy: effectiveStrategy(fase, null) });
  }

  it('ammessi=2 → i primi due cf', () => {
    expect(computeAdmittedIds(ranked4(), 2)).toEqual(['cf1', 'cf2']);
  });

  it('ammessi mancante/0 → null (server mantiene lo stato)', () => {
    expect(computeAdmittedIds(ranked4(), null)).toBeNull();
    expect(computeAdmittedIds(ranked4(), 0)).toBeNull();
    expect(computeAdmittedIds(ranked4(), undefined)).toBeNull();
  });

  it('ex aequo al taglio: due pari in posizione 1 con ammessi=1 → entrambi inclusi', () => {
    // c1 e c2 pari su media 8, nessun separatore, ex_aequo attivo → entrambi pos.1
    const ranked = rankWithTieBreak(tiedRows(), {
      ...fase,
      tiebreakStrategy: [
        { key: 'scomposizione', enabled: false },
        { key: 'presidente', enabled: false },
        { key: 'eta', enabled: false },
        { key: 'ex_aequo', enabled: true },
      ],
    }, { strategy: effectiveStrategy({ ...fase, tiebreakStrategy: [{ key: 'ex_aequo', enabled: true }] }, null) });
    const admitted = computeAdmittedIds(ranked, 1);
    // entrambi in posizione_finale 1 → posizione_finale <= 1 → entrambi ammessi
    expect(admitted).toHaveLength(2);
    expect(admitted).toEqual(expect.arrayContaining(['cf1', 'cf2']));
  });
});
