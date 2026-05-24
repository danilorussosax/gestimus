import dayjs from 'dayjs';
// I locale dayjs ('it', 'en', 'es') vengono importati da src/i18n/index.ts.
// Il locale attivo viene impostato dinamicamente al cambio lingua.
import customParseFormat from 'dayjs/plugin/customParseFormat';
import isoWeek from 'dayjs/plugin/isoWeek';
import isSameOrAfter from 'dayjs/plugin/isSameOrAfter';
import isSameOrBefore from 'dayjs/plugin/isSameOrBefore';
import duration from 'dayjs/plugin/duration';
import relativeTime from 'dayjs/plugin/relativeTime';

dayjs.extend(customParseFormat);
dayjs.extend(isoWeek);
dayjs.extend(isSameOrAfter);
dayjs.extend(isSameOrBefore);
dayjs.extend(duration);
dayjs.extend(relativeTime);

export { dayjs };

export function formatDate(value: string | Date, fmt = 'DD MMM YYYY') {
  return dayjs(value).format(fmt);
}

export function formatTime(value: string | Date) {
  return dayjs(value).format('HH:mm');
}

export function formatRange(start: string | Date, end: string | Date) {
  const s = dayjs(start);
  const e = dayjs(end);
  if (s.isSame(e, 'day')) {
    return `${s.format('DD MMM YYYY')} · ${s.format('HH:mm')} – ${e.format('HH:mm')}`;
  }
  return `${s.format('DD MMM HH:mm')} → ${e.format('DD MMM HH:mm')}`;
}

export function formatDuration(start: string | Date, end: string | Date) {
  const minutes = dayjs(end).diff(dayjs(start), 'minute');
  if (minutes < 60) return `${minutes} min`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m === 0 ? `${h}h` : `${h}h ${m}m`;
}

export function toLocalDateInput(date: Date | string = new Date()) {
  return dayjs(date).format('YYYY-MM-DD');
}

export function toLocalDateTimeInput(date: Date | string = new Date()) {
  return dayjs(date).format('YYYY-MM-DDTHH:mm');
}

export function fromLocalInput(value: string): Date {
  return dayjs(value).toDate();
}

export function relativeFromNow(date: string | Date) {
  return dayjs(date).fromNow();
}

export function startOfWeek() {
  return dayjs().startOf('isoWeek');
}
