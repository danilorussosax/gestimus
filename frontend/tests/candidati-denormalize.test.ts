import { describe, it, expect } from 'vitest';
import { denormalizeBody, normalizeCandidato } from '@/api/candidati';

/**
 * Contratto WRITE-PATH (form ui → payload backend): `tipo` → `isGruppo` +
 * `tipoGruppo`, e i campi derivati `tipo`/`fotoUrl` non devono mai finire nel
 * payload (il backend li scarterebbe / li ignora). Un cambio di shape qui rompe
 * questi test invece di fallire in silenzio a runtime.
 */
describe('denormalizeBody — shape bridge frontend → backend', () => {
  it('tipo individuale → isGruppo:false, tipoGruppo:null', () => {
    const out = denormalizeBody({ tipo: 'individuale', nome: 'Anna' });
    expect(out).toMatchObject({ isGruppo: false, tipoGruppo: null, nome: 'Anna' });
    expect('tipo' in out).toBe(false);
  });

  it('tipo gruppo → isGruppo:true, tipoGruppo:ensemble', () => {
    const out = denormalizeBody({ tipo: 'gruppo' });
    expect(out).toMatchObject({ isGruppo: true, tipoGruppo: 'ensemble' });
  });

  it('tipo orchestra → isGruppo:true, tipoGruppo:orchestra', () => {
    const out = denormalizeBody({ tipo: 'orchestra' });
    expect(out).toMatchObject({ isGruppo: true, tipoGruppo: 'orchestra' });
  });

  it('tipo undefined (PATCH che non tocca il tipo) → niente isGruppo/tipoGruppo', () => {
    const out = denormalizeBody({ nome: 'Mario' }) as Record<string, unknown>;
    expect('isGruppo' in out).toBe(false);
    expect('tipoGruppo' in out).toBe(false);
    expect(out.nome).toBe('Mario');
  });

  it('tipo null → trattato come individuale', () => {
    const out = denormalizeBody({ tipo: null });
    expect(out).toMatchObject({ isGruppo: false, tipoGruppo: null });
  });

  it('rimuove sempre il campo derivato fotoUrl dal payload', () => {
    const out = denormalizeBody({ tipo: 'individuale', fotoUrl: 'x/y.jpg', nome: 'Z' } as never) as Record<string, unknown>;
    expect('fotoUrl' in out).toBe(false);
    expect(out.nome).toBe('Z');
  });

  it('round-trip raw → ui → payload preserva isGruppo/tipoGruppo', () => {
    for (const raw of [
      { isGruppo: false, tipoGruppo: null as null | 'ensemble' | 'orchestra' },
      { isGruppo: true, tipoGruppo: 'ensemble' as const },
      { isGruppo: true, tipoGruppo: 'orchestra' as const },
    ]) {
      const ui = normalizeCandidato({ ...raw, foto: null });
      const payload = denormalizeBody({ tipo: ui.tipo }) as { isGruppo: boolean; tipoGruppo: unknown };
      expect(payload.isGruppo).toBe(raw.isGruppo);
      expect(payload.tipoGruppo).toBe(raw.tipoGruppo);
    }
  });
});
