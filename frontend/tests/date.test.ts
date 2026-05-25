import { describe, it, expect } from 'vitest';
import {
  formatDate,
  formatTime,
  formatDuration,
  toLocalDateInput,
  toLocalDateTimeInput,
  fromLocalInput,
  dayjs,
} from '@/lib/date';

describe('formatDate', () => {
  it('formato personalizzato numerico', () => {
    expect(formatDate('2024-03-15', 'YYYY-MM-DD')).toBe('2024-03-15');
  });
  it('accetta un oggetto Date', () => {
    const d = new Date('2024-03-15T10:00:00');
    expect(formatDate(d, 'YYYY-MM-DD')).toBe('2024-03-15');
  });
});

describe('formatTime', () => {
  it('HH:mm', () => {
    expect(formatTime('2024-03-15T09:05:00')).toBe('09:05');
    expect(formatTime('2024-03-15T23:59:00')).toBe('23:59');
  });
});

describe('formatDuration', () => {
  it('< 60 minuti → "N min"', () => {
    const start = '2024-03-15T10:00:00';
    const end = '2024-03-15T10:45:00';
    expect(formatDuration(start, end)).toBe('45 min');
  });
  it('ore esatte → "Nh"', () => {
    expect(formatDuration('2024-03-15T10:00:00', '2024-03-15T12:00:00')).toBe('2h');
  });
  it('ore e minuti → "Nh Mm"', () => {
    expect(formatDuration('2024-03-15T10:00:00', '2024-03-15T11:30:00')).toBe('1h 30m');
  });
  it('durata zero → "0 min"', () => {
    expect(formatDuration('2024-03-15T10:00:00', '2024-03-15T10:00:00')).toBe('0 min');
  });
});

describe('toLocalDateInput / toLocalDateTimeInput', () => {
  it('YYYY-MM-DD', () => {
    expect(toLocalDateInput('2024-03-15T10:00:00')).toBe('2024-03-15');
  });
  it('YYYY-MM-DDTHH:mm', () => {
    expect(toLocalDateTimeInput('2024-03-15T10:05:00')).toBe('2024-03-15T10:05');
  });
});

describe('fromLocalInput', () => {
  it('ritorna un Date valido', () => {
    const d = fromLocalInput('2024-03-15T10:00');
    expect(d).toBeInstanceOf(Date);
    expect(dayjs(d).format('YYYY-MM-DD')).toBe('2024-03-15');
  });
});

describe('dayjs export', () => {
  it('round-trip format → parse coerente', () => {
    const iso = '2024-12-31T23:30:00';
    expect(dayjs(iso).format('YYYY-MM-DDTHH:mm')).toBe('2024-12-31T23:30');
  });
});
