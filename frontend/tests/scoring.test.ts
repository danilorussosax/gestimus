import { describe, it, expect } from 'vitest';
import {
  PESI,
  DEFAULT_CRITERI_KEYS,
  defaultCriteri,
  slugifyKey,
  getCriteri,
  getPesiFor,
  criteriFromRecords,
  pesato,
  mediaCandidato,
  getMetodoMedia,
  suggerisciMetodo,
  computeAggregate,
  getScala,
  voteStep,
  getModoValutazione,
  fmtVoto,
  suggestEliminatoria,
  METODI_MEDIA,
} from '@/lib/scoring';

describe('defaultCriteri', () => {
  it('ordine 1 → pesi PESI[1], 4 criteri default', () => {
    const c = defaultCriteri(1);
    expect(c).toHaveLength(4);
    expect(c.map((x) => x.key)).toEqual([...DEFAULT_CRITERI_KEYS]);
    expect(c.find((x) => x.key === 'tecnica')!.peso).toBe(PESI[1].tecnica);
  });
  it('ordine sconosciuto → fallback su PESI[1]', () => {
    expect(defaultCriteri(99)).toEqual(defaultCriteri(1));
  });
  it('senza argomenti → ordine 1', () => {
    expect(defaultCriteri()).toEqual(defaultCriteri(1));
  });
  it('le label sono quelle di default', () => {
    expect(defaultCriteri(2).find((c) => c.key === 'musicalita')!.label).toBe('Musicalità');
  });
});

describe('slugifyKey', () => {
  it('lowercase + underscore al posto di spazi/punteggiatura', () => {
    expect(slugifyKey('Tecnica Pura')).toBe('tecnica_pura');
  });
  it('rimuove diacritici', () => {
    expect(slugifyKey('Musicalità')).toBe('musicalita');
  });
  it('taglia underscore iniziali/finali', () => {
    expect(slugifyKey('  ciao  ')).toBe('ciao');
    expect(slugifyKey('--ciao--')).toBe('ciao');
  });
  it('null/undefined/vuoto → "crit"', () => {
    expect(slugifyKey(null)).toBe('crit');
    expect(slugifyKey(undefined)).toBe('crit');
    expect(slugifyKey('')).toBe('crit');
    expect(slugifyKey('!!!')).toBe('crit');
  });
  it('tronca a 30 caratteri', () => {
    expect(slugifyKey('a'.repeat(50)).length).toBe(30);
  });
  it('numero coerced a stringa', () => {
    expect(slugifyKey(42)).toBe('42');
  });
});

describe('getCriteri — risoluzione criteri', () => {
  it('da array fase.criteri (preferito)', () => {
    const fase = { criteri: [{ key: 'a', label: 'A', peso: 60 }, { key: 'b', label: 'B', peso: 40 }] };
    const c = getCriteri(fase);
    expect(c).toEqual([
      { key: 'a', label: 'A', peso: 60 },
      { key: 'b', label: 'B', peso: 40 },
    ]);
  });
  it('key derivata da slug(label) se mancante', () => {
    const c = getCriteri({ criteri: [{ label: 'Tecnica Avanzata', peso: 1 }] });
    expect(c[0].key).toBe('tecnica_avanzata');
  });
  it('peso non numerico → 0', () => {
    const c = getCriteri({ criteri: [{ key: 'a', label: 'A', peso: 'x' }] });
    expect(c[0].peso).toBe(0);
  });
  it('da fase.pesi (legacy mapping)', () => {
    const c = getCriteri({ pesi: { tecnica: 0.5, interpretazione: 0.5, intonazione: 0, musicalita: 0 } });
    expect(c.map((x) => x.key)).toEqual([...DEFAULT_CRITERI_KEYS]);
    expect(c.find((x) => x.key === 'tecnica')!.peso).toBe(0.5);
  });
  it('oggetto con solo ordine → defaultCriteri(ordine)', () => {
    expect(getCriteri({ ordine: 2 })).toEqual(defaultCriteri(2));
  });
  it('oggetto vuoto → defaultCriteri(1)', () => {
    expect(getCriteri({})).toEqual(defaultCriteri(1));
  });
  it('numero → defaultCriteri(numero)', () => {
    expect(getCriteri(3)).toEqual(defaultCriteri(3));
  });
  it('null → defaultCriteri(undefined) = ordine 1', () => {
    expect(getCriteri(null)).toEqual(defaultCriteri(1));
  });
});

describe('getPesiFor', () => {
  it('mappa key→peso da getCriteri', () => {
    const m = getPesiFor({ criteri: [{ key: 'a', label: 'A', peso: 70 }, { key: 'b', label: 'B', peso: 30 }] });
    expect(m).toEqual({ a: 70, b: 30 });
  });
});

describe('criteriFromRecords', () => {
  it('mappa record DB (nome/peso) → runtime', () => {
    const c = criteriFromRecords([{ nome: 'Tecnica', peso: 50 }, { nome: 'Interpretazione', peso: 50 }]);
    expect(c).toEqual([
      { key: 'tecnica', label: 'Tecnica', peso: 50 },
      { key: 'interpretazione', label: 'Interpretazione', peso: 50 },
    ]);
  });
  it('non-array → []', () => {
    expect(criteriFromRecords(null)).toEqual([]);
    expect(criteriFromRecords(undefined)).toEqual([]);
    expect(criteriFromRecords({} as never)).toEqual([]);
  });
  it('record senza nome → label fallback "Criterio N", key da slugifyKey(undefined)="crit"', () => {
    const c = criteriFromRecords([{ peso: 10 }]);
    expect(c[0].label).toBe('Criterio 1');
    // slugifyKey(undefined) ritorna 'crit' (mai falsy) → il fallback `crit_${i+1}` non scatta
    expect(c[0].key).toBe('crit');
  });
});

describe('pesato — media pesata su scala voti', () => {
  const fase = { criteri: criteriFromRecords([{ nome: 'Tecnica', peso: 50 }, { nome: 'Interpretazione', peso: 50 }]) };
  it('chiave assente del voto contribuisce 0', () => {
    expect(pesato({ tecnica: 8 }, fase)).toBeCloseTo(4.0, 6); // (8*50 + 0*50)/100
  });
  it('voti null/undefined → 0', () => {
    expect(pesato(null, fase)).toBe(0);
    expect(pesato(undefined, fase)).toBe(0);
  });
  it('valore non numerico trattato come 0', () => {
    expect(pesato({ tecnica: 'abc', interpretazione: 6 }, fase)).toBeCloseTo(3.0, 6); // (0+6*50)/100
  });
  it('pesi tutti 0 → media aritmetica semplice', () => {
    const f = { criteri: [{ key: 'a', label: 'A', peso: 0 }, { key: 'b', label: 'B', peso: 0 }] };
    expect(pesato({ a: 8, b: 4 }, f)).toBeCloseTo(6.0, 6);
  });
});

describe('mediaCandidato — aggregazione su più commissari', () => {
  const fase = { criteri: criteriFromRecords([{ nome: 'Tecnica', peso: 100 }]), metodoMedia: 'aritmetica' };
  it('media dei totali pesati dei commissari', () => {
    const vals = [
      { commissario_id: 'c1', criterio: 'tecnica', voto: 8 },
      { commissario_id: 'c2', criterio: 'tecnica', voto: 6 },
    ];
    expect(mediaCandidato(vals, fase)).toBeCloseTo(7.0, 6);
  });
  it('nessuna valutazione → 0', () => {
    expect(mediaCandidato([], fase)).toBe(0);
  });
  it('metodo olimpica scarta gli estremi', () => {
    const f = { criteri: criteriFromRecords([{ nome: 'Tecnica', peso: 100 }]), metodoMedia: 'olimpica' };
    const vals = [
      { commissario_id: 'c1', criterio: 'tecnica', voto: 1 },
      { commissario_id: 'c2', criterio: 'tecnica', voto: 5 },
      { commissario_id: 'c3', criterio: 'tecnica', voto: 6 },
      { commissario_id: 'c4', criterio: 'tecnica', voto: 10 },
    ];
    expect(mediaCandidato(vals, f)).toBeCloseTo(5.5, 6); // (5+6)/2
  });
});

describe('getMetodoMedia', () => {
  it('default aritmetica', () => {
    expect(getMetodoMedia(null)).toBe('aritmetica');
    expect(getMetodoMedia({})).toBe('aritmetica');
  });
  it('camelCase metodoMedia', () => {
    expect(getMetodoMedia({ metodoMedia: 'olimpica' })).toBe('olimpica');
  });
  it('snake_case metodo_media', () => {
    expect(getMetodoMedia({ metodo_media: 'mediana' })).toBe('mediana');
  });
  it('metodo sconosciuto → aritmetica', () => {
    expect(getMetodoMedia({ metodoMedia: 'inesistente' })).toBe('aritmetica');
  });
});

describe('suggerisciMetodo', () => {
  it('<=2 commissari → aritmetica', () => {
    expect(suggerisciMetodo(2).metodo).toBe('aritmetica');
    expect(suggerisciMetodo(0).metodo).toBe('aritmetica');
  });
  it('3 → mediana', () => {
    expect(suggerisciMetodo(3).metodo).toBe('mediana');
  });
  it('4-5 → olimpica', () => {
    expect(suggerisciMetodo(4).metodo).toBe('olimpica');
    expect(suggerisciMetodo(5).metodo).toBe('olimpica');
  });
  it('6-7 → mediana', () => {
    expect(suggerisciMetodo(7).metodo).toBe('mediana');
  });
  it('8-12 → winsorizzata', () => {
    expect(suggerisciMetodo(12).metodo).toBe('winsorizzata');
  });
  it('>12 → deviazione_std', () => {
    expect(suggerisciMetodo(20).metodo).toBe('deviazione_std');
  });
  it('input non numerico → 0 → aritmetica', () => {
    expect(suggerisciMetodo('x').metodo).toBe('aritmetica');
  });
});

describe('computeAggregate — tutti i metodi', () => {
  it('aritmetica', () => {
    expect(computeAggregate([2, 4, 6], 'aritmetica')).toBe(4);
  });
  it('default = aritmetica', () => {
    expect(computeAggregate([2, 4, 6])).toBe(4);
  });
  it('olimpica scarta min e max', () => {
    expect(computeAggregate([1, 5, 6, 10], 'olimpica')).toBeCloseTo(5.5, 6);
  });
  it('olimpica con <=2 elementi → aritmetica', () => {
    expect(computeAggregate([4, 6], 'olimpica')).toBe(5);
  });
  it('mediana dispari', () => {
    expect(computeAggregate([3, 1, 2], 'mediana')).toBe(2);
  });
  it('mediana pari', () => {
    expect(computeAggregate([1, 2, 3, 4], 'mediana')).toBe(2.5);
  });
  it('winsorizzata limita gli estremi', () => {
    // [1,5,6,10] → cap a [5,5,6,6] → media 5.5
    expect(computeAggregate([1, 5, 6, 10], 'winsorizzata')).toBeCloseTo(5.5, 6);
  });
  it('deviazione_std esclude outlier oltre 2σ', () => {
    // dataset con un outlier estremo
    const r = computeAggregate([5, 5, 5, 5, 5, 5, 100], 'deviazione_std');
    expect(r).toBeLessThan(20);
  });
  it('deviazione_std con <3 elementi → aritmetica', () => {
    expect(computeAggregate([4, 6], 'deviazione_std')).toBe(5);
  });
  it('array vuoto → 0', () => {
    expect(computeAggregate([], 'aritmetica')).toBe(0);
    expect(computeAggregate([], 'mediana')).toBe(0);
  });
  it('valori non finiti filtrati', () => {
    expect(computeAggregate([4, NaN, 6, Infinity], 'aritmetica')).toBe(5);
  });
  it('input non-array → 0', () => {
    expect(computeAggregate(null)).toBe(0);
    expect(computeAggregate('x' as never)).toBe(0);
  });
});

describe('getScala', () => {
  it('null → 10', () => {
    expect(getScala(null)).toBe(10);
  });
  it('numero diretto', () => {
    expect(getScala(100)).toBe(100);
  });
  it('da oggetto fase.scala', () => {
    expect(getScala({ scala: 20 })).toBe(20);
  });
  it('scala non valida → 10', () => {
    expect(getScala({ scala: 'abc' })).toBe(10);
  });
  it('minimo 2', () => {
    expect(getScala(1)).toBe(2);
    expect(getScala({ scala: 0 })).toBe(10); // 0 || 10 = 10
  });
});

describe('voteStep', () => {
  it('scala <=10 → step 0.5', () => {
    expect(voteStep(10)).toBe(0.5);
    expect(voteStep(5)).toBe(0.5);
  });
  it('scala >10 → step 1', () => {
    expect(voteStep(100)).toBe(1);
  });
  it('input non numerico → default 10 → 0.5', () => {
    expect(voteStep('x')).toBe(0.5);
  });
});

describe('getModoValutazione', () => {
  it('default autonoma', () => {
    expect(getModoValutazione(null)).toBe('autonoma');
    expect(getModoValutazione({})).toBe('autonoma');
  });
  it('sincrona camelCase', () => {
    expect(getModoValutazione({ modoValutazione: 'sincrona' })).toBe('sincrona');
  });
  it('sincrona snake_case', () => {
    expect(getModoValutazione({ modo_valutazione: 'sincrona' })).toBe('sincrona');
  });
});

describe('fmtVoto', () => {
  it('scala <=10 → 2 decimali', () => {
    expect(fmtVoto(7, 10)).toBe('7.00');
    expect(fmtVoto(7.333, 10)).toBe('7.33');
  });
  it('scala >10 intero → 0 decimali', () => {
    expect(fmtVoto(85, 100)).toBe('85');
  });
  it('scala >10 non intero → 1 decimale', () => {
    expect(fmtVoto(85.5, 100)).toBe('85.5');
  });
  it('valore non numerico → 0', () => {
    expect(fmtVoto('x', 10)).toBe('0.00');
    expect(fmtVoto(null, 10)).toBe('0.00');
  });
});

describe('suggestEliminatoria', () => {
  it('media >= 80% → MERITO ammesso', () => {
    expect(suggestEliminatoria({ media: 8.5, scala: 10 })).toEqual({ ammesso: true, fascia: 'MERITO' });
  });
  it('media >= 65% e < 80% → STANDARD ammesso', () => {
    expect(suggestEliminatoria({ media: 7, scala: 10 })).toEqual({ ammesso: true, fascia: 'STANDARD' });
  });
  it('media 60-65% con <=2 voti sotto soglia → STANDARD ammesso', () => {
    expect(suggestEliminatoria({ media: 6.2, voti: [6, 6, 5], scala: 10 })).toEqual({ ammesso: true, fascia: 'STANDARD' });
  });
  it('media 60-65% con >2 voti sotto soglia → ELIMINATO', () => {
    expect(suggestEliminatoria({ media: 6.2, voti: [5, 5, 5], scala: 10 })).toEqual({ ammesso: false, fascia: 'ELIMINATO' });
  });
  it('media < 60% → ELIMINATO', () => {
    expect(suggestEliminatoria({ media: 4, scala: 10 })).toEqual({ ammesso: false, fascia: 'ELIMINATO' });
  });
  it('scala 100 — invarianza alle soglie relative', () => {
    expect(suggestEliminatoria({ media: 85, scala: 100 })).toEqual({ ammesso: true, fascia: 'MERITO' });
  });
});

describe('METODI_MEDIA — metadati catalogo', () => {
  it('contiene tutti i metodi attesi con descrizione', () => {
    for (const k of ['aritmetica', 'olimpica', 'winsorizzata', 'mediana', 'deviazione_std']) {
      expect(METODI_MEDIA[k]).toBeDefined();
      expect(typeof METODI_MEDIA[k].nome).toBe('string');
      expect(METODI_MEDIA[k].nome.length).toBeGreaterThan(0);
    }
  });
});
