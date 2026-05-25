import { describe, it, expect } from 'vitest';
import { cn } from '@/lib/utils';

describe('cn — merge classi tailwind/clsx', () => {
  it('concatena classi semplici', () => {
    expect(cn('a', 'b')).toBe('a b');
  });
  it('ignora valori falsy', () => {
    expect(cn('a', false, null, undefined, '', 'b')).toBe('a b');
  });
  it('classe condizionale via oggetto', () => {
    expect(cn('base', { active: true, disabled: false })).toBe('base active');
  });
  it('tailwind-merge: l\'ultima classe in conflitto vince', () => {
    expect(cn('p-2', 'p-4')).toBe('p-4');
    expect(cn('text-red-500', 'text-blue-500')).toBe('text-blue-500');
  });
  it('array di classi', () => {
    expect(cn(['a', 'b'], 'c')).toBe('a b c');
  });
  it('nessun argomento → stringa vuota', () => {
    expect(cn()).toBe('');
  });
});
