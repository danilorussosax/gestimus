import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  effectiveStrategy,
  defaultTiebreakStrategy,
  mediaCandidatoSuCriterio,
  votoPresidente,
  etaCandidato,
  stepInfo,
  TIEBREAK_STEPS,
  rankWithTieBreak,
  computeAdmittedIds,
} from '@/lib/tiebreak';
import { criteriFromRecords } from '@/lib/scoring';

afterEach(() => {
  vi.useRealTimers();
});

describe('TIEBREAK_STEPS / defaultTiebreakStrategy', () => {
  it('ordine fisso dei passi', () => {
    expect(TIEBREAK_STEPS).toEqual(['scomposizione', 'presidente', 'eta', 'ex_aequo']);
  });
  it('default → tutti abilitati nell\'ordine fisso', () => {
    const s = defaultTiebreakStrategy();
    expect(s.map((x) => x.key)).toEqual(['scomposizione', 'presidente', 'eta', 'ex_aequo']);
    expect(s.every((x) => x.enabled)).toBe(true);
  });
});

describe('effectiveStrategy — edge cases', () => {
  it('fase senza strategy, concorso null → default', () => {
    expect(effectiveStrategy({}, null)).toEqual(defaultTiebreakStrategy());
  });
  it('fase con array vuoto → ignorato, fallback a default', () => {
    expect(effectiveStrategy({ tiebreakStrategy: [] }, null)).toEqual(defaultTiebreakStrategy());
  });
  it('accetta snake_case tiebreak_strategy della fase', () => {
    const s = effectiveStrategy({ tiebreak_strategy: [{ key: 'eta', enabled: false }] }, null);
    expect(s.find((x) => x.key === 'eta')!.enabled).toBe(false);
  });
  it('accetta snake_case default_tiebreak_strategy del concorso', () => {
    const s = effectiveStrategy({}, { default_tiebreak_strategy: [{ key: 'presidente', enabled: false }] });
    expect(s.find((x) => x.key === 'presidente')!.enabled).toBe(false);
  });
  it('passo non menzionato nella strategy → default enabled=true', () => {
    const s = effectiveStrategy({ tiebreakStrategy: [{ key: 'ex_aequo', enabled: false }] }, null);
    // gli altri non menzionati restano enabled
    expect(s.find((x) => x.key === 'scomposizione')!.enabled).toBe(true);
    expect(s.find((x) => x.key === 'ex_aequo')!.enabled).toBe(false);
  });
});

describe('mediaCandidatoSuCriterio', () => {
  const fase = { metodoMedia: 'aritmetica', criteri: criteriFromRecords([{ nome: 'Tecnica', peso: 100 }]) };
  it('media sul criterio fra i commissari che lo hanno votato', () => {
    const vals = [
      { commissario_id: 'c1', criterio: 'tecnica', voto: 8 },
      { commissario_id: 'c2', criterio: 'tecnica', voto: 6 },
    ];
    expect(mediaCandidatoSuCriterio(vals, fase, 'tecnica')).toBeCloseTo(7.0, 6);
  });
  it('commissario senza quel criterio conta 0', () => {
    const vals = [
      { commissario_id: 'c1', criterio: 'tecnica', voto: 8 },
      { commissario_id: 'c2', criterio: 'interpretazione', voto: 6 },
    ];
    // c2 non ha votato tecnica → 0; media (8+0)/2 = 4
    expect(mediaCandidatoSuCriterio(vals, fase, 'tecnica')).toBeCloseTo(4.0, 6);
  });
  it('nessuna valutazione → 0', () => {
    expect(mediaCandidatoSuCriterio([], fase, 'tecnica')).toBe(0);
  });
});

describe('votoPresidente', () => {
  const fase = { criteri: criteriFromRecords([{ nome: 'Tecnica', peso: 0.5 }, { nome: 'Interpretazione', peso: 0.5 }]) };
  it('presidenteId null → null', () => {
    expect(votoPresidente([], fase, null)).toBeNull();
  });
  it('nessuna valutazione del presidente → null', () => {
    const vals = [{ commissario_id: 'altro', criterio: 'tecnica', voto: 8 }];
    expect(votoPresidente(vals, fase, 'pres')).toBeNull();
  });
  it('somma pesata dei soli voti del presidente', () => {
    const vals = [
      { commissario_id: 'pres', criterio: 'tecnica', voto: 8 },
      { commissario_id: 'pres', criterio: 'interpretazione', voto: 6 },
      { commissario_id: 'altro', criterio: 'tecnica', voto: 2 },
    ];
    expect(votoPresidente(vals, fase, 'pres')).toBeCloseTo(8 * 0.5 + 6 * 0.5, 6); // 7
  });
});

describe('etaCandidato', () => {
  it('candidato null → null', () => {
    expect(etaCandidato(null, '2020-01-01')).toBeNull();
  });
  it('senza data_nascita → null', () => {
    expect(etaCandidato({}, '2020-01-01')).toBeNull();
  });
  it('età in anni decimali (data_nascita snake_case)', () => {
    const eta = etaCandidato({ data_nascita: '2000-01-01' }, '2020-01-01');
    expect(eta).toBeCloseTo(20, 1);
  });
  it('accetta dataNascita camelCase', () => {
    const eta = etaCandidato({ dataNascita: '2000-01-01' }, '2020-01-01');
    expect(eta).toBeCloseTo(20, 1);
  });
  it('data di nascita futura → null', () => {
    expect(etaCandidato({ data_nascita: '2999-01-01' }, '2020-01-01')).toBeNull();
  });
  it('data invalida → null', () => {
    expect(etaCandidato({ data_nascita: 'non-una-data' }, '2020-01-01')).toBeNull();
  });
  it('gruppo senza getMembri → null', () => {
    expect(etaCandidato({ tipo: 'gruppo', id: 'g1' }, '2020-01-01')).toBeNull();
  });
  it('gruppo: media delle età dei membri', () => {
    const getMembri = () => [
      { data_nascita: '2000-01-01' },
      { data_nascita: '2010-01-01' },
    ];
    const eta = etaCandidato({ tipo: 'gruppo', id: 'g1' }, '2020-01-01', [], getMembri);
    expect(eta).toBeCloseTo(15, 1); // media di 20 e 10
  });
  it('gruppo senza membri validi → null', () => {
    const getMembri = () => [];
    expect(etaCandidato({ tipo: 'orchestra', id: 'o1' }, '2020-01-01', [], getMembri)).toBeNull();
  });
  it('refDate assente → usa ora corrente (non lancia)', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2020-01-01T00:00:00Z'));
    const eta = etaCandidato({ data_nascita: '2000-01-01' }, null);
    expect(eta).toBeCloseTo(20, 0);
  });
});

describe('stepInfo', () => {
  it('ritorna metadati per ogni passo noto', () => {
    for (const k of TIEBREAK_STEPS) {
      const info = stepInfo(k);
      expect(info).not.toBeNull();
      expect(info!.titolo.length).toBeGreaterThan(0);
    }
  });
  it('passo sconosciuto → null', () => {
    expect(stepInfo('inesistente')).toBeNull();
  });
});

describe('rankWithTieBreak — passo "presidente" come separatore', () => {
  const fase = { id: 'f1', ordine: 1, scala: 10, metodoMedia: 'aritmetica', sezioniIds: [],
    criteri: criteriFromRecords([{ nome: 'Tecnica', peso: 100 }]) };

  it('a parità di media, il voto del presidente decide', () => {
    const rows = [
      { cf: { id: 'cf1' }, cand: { id: 'c1', numero_candidato: 1 }, media: 8,
        valutazioni: [{ commissario_id: 'pres', criterio: 'tecnica', voto: 5 }] },
      { cf: { id: 'cf2' }, cand: { id: 'c2', numero_candidato: 2 }, media: 8,
        valutazioni: [{ commissario_id: 'pres', criterio: 'tecnica', voto: 9 }] },
    ];
    // disabilita scomposizione per forzare lo step presidente
    const strategy = [
      { key: 'scomposizione' as const, enabled: false },
      { key: 'presidente' as const, enabled: true },
      { key: 'eta' as const, enabled: true },
      { key: 'ex_aequo' as const, enabled: true },
    ];
    const ranked = rankWithTieBreak(rows, fase, { strategy, presidenteId: 'pres' });
    // cf2 (voto presidente 9) deve precedere cf1 (voto 5)
    const first = ranked.find((r) => r.posizione_finale === 1)!;
    expect(first.cf.id).toBe('cf2');
    expect(ranked.some((r) => r.tiebreak_log.some((l) => l.step === 'presidente'))).toBe(true);
  });
});

describe('computeAdmittedIds — robustezza', () => {
  const fase = { id: 'f1', ordine: 1, scala: 10, metodoMedia: 'aritmetica', sezioniIds: [] };
  function ranked2() {
    const rows = [
      { cf: { id: 'cf1' }, cand: { id: 'c1', numero_candidato: 1 }, media: 9, valutazioni: [] },
      { cf: { id: 'cf2' }, cand: { id: 'c2', numero_candidato: 2 }, media: 8, valutazioni: [] },
    ];
    return rankWithTieBreak(rows, fase, { strategy: defaultTiebreakStrategy() });
  }
  it('ammessi negativo → null', () => {
    expect(computeAdmittedIds(ranked2(), -3)).toBeNull();
  });
  it('ammessi NaN → null', () => {
    expect(computeAdmittedIds(ranked2(), NaN)).toBeNull();
  });
  it('ammessi >= totale → tutti', () => {
    expect(computeAdmittedIds(ranked2(), 10)).toEqual(['cf1', 'cf2']);
  });
});
