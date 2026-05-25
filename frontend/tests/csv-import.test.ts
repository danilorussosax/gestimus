import { describe, it, expect } from 'vitest';
import {
  normKey,
  detectCsvSeparator,
  parseCSV,
  parseImportDate,
  splitMulti,
  buildHeaderMap,
  normalizeRow,
  importTemplateText,
  IMPORT_FIELD_ALIASES,
  IMPORT_REQUIRED,
  MAX_IMPORT_ROWS,
  type NormalizedCandidato,
  type NormalizedSezione,
  type NormalizedCommissario,
} from '@/lib/csv-import';

describe('normKey', () => {
  it('lowercase, niente spazi/diacritici/punteggiatura', () => {
    expect(normKey('Data Nascita')).toBe('datanascita');
    expect(normKey('Nazionalità')).toBe('nazionalita');
    expect(normKey('e-mail')).toBe('email');
  });
  it('null/undefined → vuoto', () => {
    expect(normKey(null)).toBe('');
    expect(normKey(undefined)).toBe('');
  });
});

describe('detectCsvSeparator', () => {
  it('punto e virgola', () => {
    expect(detectCsvSeparator('a;b;c\n1;2;3')).toBe(';');
  });
  it('virgola', () => {
    expect(detectCsvSeparator('a,b,c\n1,2,3')).toBe(',');
  });
  it('tab', () => {
    expect(detectCsvSeparator('a\tb\tc')).toBe('\t');
  });
  it('ignora separatori dentro le virgolette', () => {
    // virgole solo dentro quote → conta i ; reali
    expect(detectCsvSeparator('"a,b";c;d')).toBe(';');
  });
  it('parità → preferisce ;', () => {
    expect(detectCsvSeparator('a;b,c')).toBe(';');
  });
  it('nessun separatore → default ;', () => {
    expect(detectCsvSeparator('soloprimacolonna')).toBe(';');
  });
});

describe('parseCSV', () => {
  it('parsing base', () => {
    expect(parseCSV('a,b\n1,2', ',')).toEqual([['a', 'b'], ['1', '2']]);
  });
  it('campi quotati con separatore interno', () => {
    expect(parseCSV('"a,b",c', ',')).toEqual([['a,b', 'c']]);
  });
  it('virgolette escape ("")', () => {
    expect(parseCSV('"di ""prova""",x', ',')).toEqual([['di "prova"', 'x']]);
  });
  it('gestisce CRLF', () => {
    expect(parseCSV('a,b\r\n1,2', ',')).toEqual([['a', 'b'], ['1', '2']]);
  });
  it('rimuove BOM iniziale', () => {
    const out = parseCSV('﻿nome,cognome\nAnna,Rossi', ',');
    expect(out[0]).toEqual(['nome', 'cognome']);
  });
  it('rimuove byte NUL', () => {
    const out = parseCSV('a\x00b,c', ',');
    expect(out).toEqual([['ab', 'c']]);
  });
  it('scarta righe completamente vuote', () => {
    expect(parseCSV('a,b\n\n1,2\n,', ',')).toEqual([['a', 'b'], ['1', '2']]);
  });
  it('ultima riga senza newline finale', () => {
    expect(parseCSV('a,b\n1,2', ',')).toEqual([['a', 'b'], ['1', '2']]);
  });
});

describe('parseImportDate', () => {
  it('ISO YYYY-MM-DD normalizzata con padding', () => {
    expect(parseImportDate('2002-4-5')).toBe('2002-04-05');
    expect(parseImportDate('2002-04-15')).toBe('2002-04-15');
  });
  it('DD/MM/YYYY', () => {
    expect(parseImportDate('15/06/2003')).toBe('2003-06-15');
  });
  it('DD-MM-YYYY e DD.MM.YYYY', () => {
    expect(parseImportDate('15-06-2003')).toBe('2003-06-15');
    expect(parseImportDate('15.06.2003')).toBe('2003-06-15');
  });
  it('anno a 2 cifre: >30 → 19xx, <=30 → 20xx', () => {
    expect(parseImportDate('01/01/99')).toBe('1999-01-01');
    expect(parseImportDate('01/01/10')).toBe('2010-01-01');
  });
  it('vuoto → stringa vuota', () => {
    expect(parseImportDate('')).toBe('');
    expect(parseImportDate(null)).toBe('');
    expect(parseImportDate('   ')).toBe('');
  });
  it('giorno/mese fuori range → null', () => {
    expect(parseImportDate('45/06/2003')).toBeNull();
    expect(parseImportDate('15/13/2003')).toBeNull();
  });
  it('formato non riconosciuto → null', () => {
    expect(parseImportDate('domani')).toBeNull();
  });
});

describe('splitMulti', () => {
  it('split su | con trim e rimozione vuoti', () => {
    expect(splitMulti('Mario | Lucia |  | Anna')).toEqual(['Mario', 'Lucia', 'Anna']);
  });
  it('singolo valore', () => {
    expect(splitMulti('Solo')).toEqual(['Solo']);
  });
  it('vuoto/null → []', () => {
    expect(splitMulti('')).toEqual([]);
    expect(splitMulti(null)).toEqual([]);
  });
});

describe('buildHeaderMap', () => {
  it('mappa intestazioni → campi logici via alias', () => {
    const map = buildHeaderMap('candidati', ['Nome', 'Cognome', 'Strumento', 'Data Nascita', 'Nazionalità']);
    expect(map.nome).toBe(0);
    expect(map.cognome).toBe(1);
    expect(map.strumento).toBe(2);
    expect(map.data_nascita).toBe(3);
    expect(map.nazionalita).toBe(4);
  });
  it('riconosce alias inglesi', () => {
    const map = buildHeaderMap('commissari', ['firstname', 'surname', 'discipline', 'mail']);
    expect(map.nome).toBe(0);
    expect(map.cognome).toBe(1);
    expect(map.specialita).toBe(2);
    expect(map.email).toBe(3);
  });
  it('colonna non riconosciuta → assente nella mappa', () => {
    const map = buildHeaderMap('sezioni', ['sezione', 'colonna_strana']);
    expect(map.sezione).toBe(0);
    expect(map.categoria).toBeUndefined();
  });
});

describe('normalizeRow — candidati', () => {
  // NB: l'header "nomegruppo" mappa la colonna del nome gruppo; "gruppo_nome"
  // NON mapperebbe (normalizza a "grupponome", assente dagli alias).
  const map = buildHeaderMap('candidati', [
    'nome', 'cognome', 'strumento', 'data_nascita', 'nazionalita', 'docenti', 'sezione', 'categoria', 'tipo', 'nomegruppo',
  ]);
  it('riga individuale valida → nessun errore', () => {
    const { data, errors } = normalizeRow('candidati', map, [
      'Anna', 'Rossi', 'Pianoforte', '2002-04-15', 'Italiana', 'Mario|Lucia', 'Pianoforte', 'Junior', 'individuale', '',
    ]);
    const c = data as NormalizedCandidato;
    expect(errors).toEqual([]);
    expect(c.tipo).toBe('individuale');
    expect(c.dataNascita).toBe('2002-04-15');
    expect(c.docentiPreparatori).toEqual(['Mario', 'Lucia']);
    expect(c.sezioneNome).toBe('Pianoforte');
    expect(c.categoriaNome).toBe('Junior');
  });
  it('riconosce gruppo da tipo="gruppo"', () => {
    const { data } = normalizeRow('candidati', map, [
      'Quartetto', '', "Quartetto d'archi", '', '', '', 'Archi', 'Camera', 'gruppo', 'Quartetto Brillante',
    ]);
    const c = data as NormalizedCandidato;
    expect(c.tipo).toBe('gruppo');
    expect(c.gruppoNome).toBe('Quartetto Brillante');
  });
  it('gruppo dedotto dalla sola presenza del nome gruppo (tipo vuoto)', () => {
    // Nessun "tipo" ma colonna nome gruppo valorizzata → isGruppo true.
    const { data } = normalizeRow('candidati', map, [
      'Ens', '', 'Vario', '', '', '', '', '', '', 'Mio Ensemble',
    ]);
    expect((data as NormalizedCandidato).tipo).toBe('gruppo');
    expect((data as NormalizedCandidato).gruppoNome).toBe('Mio Ensemble');
  });
  it("header 'gruppo_nome' NON mappa la colonna (quirk alias grupponame)", () => {
    const m = buildHeaderMap('candidati', ['nome', 'gruppo_nome']);
    expect(m.gruppo_nome).toBeUndefined();
  });
  it('tipo orchestra', () => {
    const { data } = normalizeRow('candidati', map, [
      'Orch', '', 'Vario', '', '', '', '', '', 'orchestra', 'Orchestra Giovanile',
    ]);
    expect((data as NormalizedCandidato).tipo).toBe('orchestra');
  });
  it('per gruppi cognome e data non sono obbligatori', () => {
    const { errors } = normalizeRow('candidati', map, [
      'Quartetto', '', 'Archi', '', '', '', '', '', 'gruppo', 'Q',
    ]);
    expect(errors).toEqual([]);
  });
  it('individuale: campi obbligatori mancanti → errori', () => {
    const { errors } = normalizeRow('candidati', map, [
      '', '', '', '', '', '', '', '', 'individuale', '',
    ]);
    expect(errors).toContain('Campo obbligatorio mancante: nome');
    expect(errors).toContain('Campo obbligatorio mancante: cognome');
    expect(errors).toContain('Campo obbligatorio mancante: strumento');
  });
  it('data invalida → errore di data', () => {
    const { errors } = normalizeRow('candidati', map, [
      'Anna', 'Rossi', 'Piano', 'data-rotta', 'Italiana', '', 'Sez', 'Cat', 'individuale', '',
    ]);
    expect(errors.some((e) => e.startsWith('Data non valida'))).toBe(true);
  });
});

describe('normalizeRow — sezioni', () => {
  const map = buildHeaderMap('sezioni', ['sezione', 'categoria', 'descrizione', 'eta_min', 'eta_max']);
  it('riga valida', () => {
    const { data, errors } = normalizeRow('sezioni', map, ['Archi', 'Junior', 'Fino a 14', '0', '14']);
    const s = data as NormalizedSezione;
    expect(errors).toEqual([]);
    expect(s.eta_min).toBe(0);
    expect(s.eta_max).toBe(14);
  });
  it('sezione mancante → errore', () => {
    const { errors } = normalizeRow('sezioni', map, ['', 'Junior', '', '', '']);
    expect(errors).toContain('Campo obbligatorio mancante: sezione');
  });
  it('intervallo età invertito → errore', () => {
    const { errors } = normalizeRow('sezioni', map, ['Archi', '', '', '20', '10']);
    expect(errors.some((e) => e.includes('invertito'))).toBe(true);
  });
  it('età fuori range → errore + null', () => {
    const { data, errors } = normalizeRow('sezioni', map, ['Archi', '', '', '200', '']);
    expect((data as NormalizedSezione).eta_min).toBeNull();
    expect(errors.some((e) => e.includes('Età non valida'))).toBe(true);
  });
  it('età con virgola decimale troncata', () => {
    const { data } = normalizeRow('sezioni', map, ['Archi', '', '', '14,7', '']);
    expect((data as NormalizedSezione).eta_min).toBe(14);
  });
});

describe('normalizeRow — commissari', () => {
  const map = buildHeaderMap('commissari', ['nome', 'cognome', 'specialita', 'email', 'telefono', 'data_nascita', 'nazionalita', 'bio']);
  it('riga valida', () => {
    const { data, errors } = normalizeRow('commissari', map, [
      'Giovanni', 'Verdi', 'Pianoforte', 'g@x.it', '+39 333', '1968-09-20', 'Italiana', 'docente',
    ]);
    const c = data as NormalizedCommissario;
    expect(errors).toEqual([]);
    expect(c.dataNascita).toBe('1968-09-20');
    expect(c.email).toBe('g@x.it');
  });
  it('data_nascita assente → dataNascita null senza errore', () => {
    const { data, errors } = normalizeRow('commissari', map, [
      'Sara', 'Conti', 'Composizione', '', '', '', 'Italiana', '',
    ]);
    expect((data as NormalizedCommissario).dataNascita).toBeNull();
    expect(errors).toEqual([]);
  });
  it('campi obbligatori mancanti → errori', () => {
    const { errors } = normalizeRow('commissari', map, ['', '', '', '', '', '', '', '']);
    expect(errors).toContain('Campo obbligatorio mancante: nome');
    expect(errors).toContain('Campo obbligatorio mancante: specialita');
  });
});

describe('importTemplateText', () => {
  it('candidati: header + righe esempio', () => {
    const t = importTemplateText('candidati');
    expect(t.split('\n')[0]).toContain('nome');
    expect(t.split('\n').length).toBeGreaterThan(1);
  });
  it('sezioni e commissari producono testo non vuoto', () => {
    expect(importTemplateText('sezioni').length).toBeGreaterThan(0);
    expect(importTemplateText('commissari').length).toBeGreaterThan(0);
  });
  it('il template è parsabile dal proprio parser', () => {
    const t = importTemplateText('candidati');
    const sep = detectCsvSeparator(t);
    const rows = parseCSV(t, sep);
    const map = buildHeaderMap('candidati', rows[0]);
    expect(map.nome).toBeDefined();
    expect(map.strumento).toBeDefined();
  });
});

describe('costanti import', () => {
  it('MAX_IMPORT_ROWS è 500', () => {
    expect(MAX_IMPORT_ROWS).toBe(500);
  });
  it('IMPORT_REQUIRED coerente con gli alias disponibili', () => {
    for (const kind of ['candidati', 'commissari', 'sezioni'] as const) {
      for (const req of IMPORT_REQUIRED[kind]) {
        expect(Object.keys(IMPORT_FIELD_ALIASES[kind])).toContain(req);
      }
    }
  });
});
