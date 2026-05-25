import { describe, it, expect } from 'vitest';
import { normalizeCandidato } from '@/api/candidati';

describe('normalizeCandidato — shape bridge backend → frontend', () => {
  it('isGruppo=false → tipo individuale', () => {
    const c = normalizeCandidato({ isGruppo: false, tipoGruppo: null, foto: null });
    expect(c.tipo).toBe('individuale');
  });
  it('isGruppo=true, tipoGruppo=ensemble → tipo gruppo', () => {
    const c = normalizeCandidato({ isGruppo: true, tipoGruppo: 'ensemble', foto: null });
    expect(c.tipo).toBe('gruppo');
  });
  it('isGruppo=true, tipoGruppo=orchestra → tipo orchestra', () => {
    const c = normalizeCandidato({ isGruppo: true, tipoGruppo: 'orchestra', foto: null });
    expect(c.tipo).toBe('orchestra');
  });
  it('isGruppo=true senza tipoGruppo → default gruppo', () => {
    const c = normalizeCandidato({ isGruppo: true, foto: null });
    expect(c.tipo).toBe('gruppo');
  });
  it('foto valorizzata → fotoUrl uguale', () => {
    const c = normalizeCandidato({ isGruppo: false, foto: 'path/to/foto.jpg' });
    expect(c.fotoUrl).toBe('path/to/foto.jpg');
  });
  it('foto assente → fotoUrl null', () => {
    const c = normalizeCandidato({ isGruppo: false });
    expect(c.fotoUrl).toBeNull();
  });
  it('conserva gli altri campi del record grezzo', () => {
    const raw = { isGruppo: false, foto: null, id: 'x', nome: 'Anna', strumento: 'Piano' } as never;
    const c = normalizeCandidato(raw);
    expect(c.id).toBe('x');
    expect(c.nome).toBe('Anna');
  });
});
