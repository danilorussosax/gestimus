// Utility condivise dai moduli admin/* (cross-module helpers).

/**
 * Emoji per categoria strumentale, dedotta euristicamente dal nome della
 * sezione. L'ordine è importante: pattern più specifici prima di quelli
 * generici (es. "trombone" → ottoni prima che "tromb" matchi qualcosa di
 * più ampio). Fallback: 🎵.
 */
export function iconaPerSezione(nome) {
  const s = String(nome || '').toLowerCase();
  if (/canto|voce|voice|soprano|tenor|baritono|contralto|mezzosoprano|lirica|opera/.test(s)) return '🎤';
  if (/coro|choir|coral/.test(s)) return '🎼';
  if (/piano|tastier|harpsichord|clavicembal|fisarmonic|accordion|organo|\borgan\b/.test(s)) return '🎹';
  if (/chitarr|guitar/.test(s)) return '🎸';
  if (/sax|flaut|flute|clarinet|oboe|fagott|bassoon|legni|woodwind/.test(s)) return '🎷';
  if (/tromb[oa]ne|tromb[ae]|trumpet|corno|horn|tuba|ottoni|brass|fiati|wind/.test(s)) return '🎺';
  if (/percuss|drum|batter|marimba|vibrafon|xilo|timpan/.test(s)) return '🥁';
  if (/viol|arch|cello|contrabb|double\s*bass|string/.test(s)) return '🎻';
  if (/arpa|harp/.test(s)) return '🎵';
  if (/composiz|composit/.test(s)) return '🎼';
  if (/direz|conduct|maestro/.test(s)) return '🎙';
  if (/camera|chamber|ensemble|quartett|quintet|musica\s*da\s*camera/.test(s)) return '🎶';
  return '🎵';
}
