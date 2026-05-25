import { describe, it, expect } from 'vitest';
import { iconaPerSezione } from '@/lib/sezione-icon';

describe('iconaPerSezione', () => {
  it('canto/voce → microfono', () => {
    expect(iconaPerSezione('Canto lirico')).toBe('🎤');
    expect(iconaPerSezione('Soprano')).toBe('🎤');
    expect(iconaPerSezione('Voice')).toBe('🎤');
  });
  it('coro → spartito', () => {
    expect(iconaPerSezione('Coro')).toBe('🎼');
    expect(iconaPerSezione('Choir')).toBe('🎼');
  });
  it('pianoforte/organo → tastiera', () => {
    expect(iconaPerSezione('Pianoforte')).toBe('🎹');
    expect(iconaPerSezione('Organo')).toBe('🎹');
    expect(iconaPerSezione('Fisarmonica')).toBe('🎹');
  });
  it('chitarra → chitarra', () => {
    expect(iconaPerSezione('Chitarra classica')).toBe('🎸');
    expect(iconaPerSezione('Guitar')).toBe('🎸');
  });
  it('legni → sax', () => {
    expect(iconaPerSezione('Flauto')).toBe('🎷');
    expect(iconaPerSezione('Clarinetto')).toBe('🎷');
  });
  it('ottoni → tromba', () => {
    expect(iconaPerSezione('Tromba')).toBe('🎺');
    expect(iconaPerSezione('Corno')).toBe('🎺');
  });
  it('percussioni → batteria', () => {
    expect(iconaPerSezione('Percussioni')).toBe('🥁');
    expect(iconaPerSezione('Marimba')).toBe('🥁');
  });
  it('archi → violino', () => {
    expect(iconaPerSezione('Violino')).toBe('🎻');
    expect(iconaPerSezione('Violoncello')).toBe('🎻');
    expect(iconaPerSezione('Contrabbasso')).toBe('🎻');
  });
  it('arpa → nota', () => {
    expect(iconaPerSezione('Arpa')).toBe('🎵');
  });
  it('composizione → spartito', () => {
    expect(iconaPerSezione('Composizione')).toBe('🎼');
  });
  it('direzione → microfono studio', () => {
    expect(iconaPerSezione('Direzione d\'orchestra')).toBe('🎙');
  });
  it('musica da camera → note multiple', () => {
    expect(iconaPerSezione('Musica da camera')).toBe('🎶');
    expect(iconaPerSezione('Quartetto')).toBe('🎶');
  });
  it('case-insensitive', () => {
    expect(iconaPerSezione('PIANOFORTE')).toBe('🎹');
  });
  it('sconosciuto/null/undefined → nota generica', () => {
    expect(iconaPerSezione('Sezione misteriosa')).toBe('🎵');
    expect(iconaPerSezione(null)).toBe('🎵');
    expect(iconaPerSezione(undefined)).toBe('🎵');
    expect(iconaPerSezione('')).toBe('🎵');
  });
});
