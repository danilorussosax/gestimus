// =============================================================================
// candidati-utils.ts — pure helpers + shared types for CandidatiTab
// =============================================================================

import { candidatiApi, type CandidatoFull } from '@/api/candidati';

// ---------------------------------------------------------------------------
// Helpers (port da js/utils.js)
// ---------------------------------------------------------------------------

/** displayName: per gruppi/orchestre solo il nome; altrimenti "Nome Cognome". */
export function displayName(
  c: Pick<CandidatoFull, 'nome' | 'cognome' | 'tipo'> | null | undefined,
): string {
  if (!c) return '—';
  if (c.tipo === 'gruppo' || c.tipo === 'orchestra') return c.nome || '—';
  return `${c.nome} ${c.cognome ?? ''}`.trim() || '—';
}

export function ageFromDate(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (isNaN(d.getTime())) return null;
  const today = new Date();
  let age = today.getFullYear() - d.getFullYear();
  const m = today.getMonth() - d.getMonth();
  if (m < 0 || (m === 0 && today.getDate() < d.getDate())) age--;
  return age >= 0 ? age : null;
}

/** fmtDate: gg mmm aaaa (it-IT) come il vanilla. */
export function fmtDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleDateString('it-IT', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
    });
  } catch {
    return iso;
  }
}

/** Normalizza per il match identità dello storico (accenti + case insensitive). */
export function norm(s: string | null | undefined): string {
  return (s ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .trim();
}

export const NATIONALITIES = [
  'Italiana', 'Albanese', 'Argentina', 'Australiana', 'Austriaca', 'Belga', 'Brasiliana',
  'Britannica', 'Bulgara', 'Canadese', 'Cinese', 'Coreana', 'Croata', 'Danese', 'Estone',
  'Finlandese', 'Francese', 'Giapponese', 'Greca', 'Indiana', 'Iraniana', 'Irlandese',
  'Israeliana', 'Lettone', 'Lituana', 'Maltese', 'Messicana', 'Moldava', 'Norvegese',
  'Olandese', 'Polacca', 'Portoghese', 'Rumena', 'Russa', 'Serba', 'Slovacca', 'Slovena',
  'Spagnola', 'Statunitense', 'Svedese', 'Svizzera', 'Tedesca', 'Turca', 'Ucraina', 'Ungherese',
];

// ---------------------------------------------------------------------------
// Membro inline (stato editabile nel form gruppo/orchestra)
// ---------------------------------------------------------------------------

export interface MembroDraft {
  id: string | null;
  nome: string;
  cognome: string;
  strumento: string;
  dataNascita: string;
}

/**
 * Resize client-side dell'immagine (port di readImageResized): preserva il
 * formato sorgente (PNG/WebP con alpha, JPEG ricompresso) e ridimensiona al
 * lato massimo `maxDim`. Restituisce un Blob da inviare via multipart upload.
 */
export async function readImageResized(
  file: File,
  maxDim = 480,
  quality = 0.85,
): Promise<{ blob: Blob; dataUrl: string }> {
  const dataURL: string = await new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(fr.result as string);
    fr.onerror = reject;
    fr.readAsDataURL(file);
  });
  const inputMime = (file.type || '').toLowerCase();
  const outputMime =
    inputMime === 'image/jpeg' || inputMime === 'image/jpg'
      ? 'image/jpeg'
      : inputMime === 'image/webp'
        ? 'image/webp'
        : 'image/png';
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const ratio = Math.min(1, maxDim / Math.max(img.width, img.height));
      const w = Math.round(img.width * ratio);
      const h = Math.round(img.height * ratio);
      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        reject(new Error('canvas context non disponibile'));
        return;
      }
      ctx.drawImage(img, 0, 0, w, h);
      const dataUrl = canvas.toDataURL(outputMime, quality);
      canvas.toBlob(
        (blob) => {
          if (blob) resolve({ blob, dataUrl });
          else reject(new Error('toBlob fallito'));
        },
        outputMime,
        quality,
      );
    };
    img.onerror = reject;
    img.src = dataURL;
  });
}

/**
 * Diff idempotente dei membri inline dopo create/update del candidato
 * (port di syncMembriGruppo):
 *  - se non è più gruppo/orchestra → cancella tutti i membri originali;
 *  - altrimenti elimina gli assenti, aggiorna quelli con id rimasti se cambiati,
 *    crea i nuovi (senza id). Le righe senza nome vengono scartate.
 */
export async function syncMembriGruppo(
  candidatoId: string,
  isGroupLike: boolean,
  original: MembroDraft[],
  current: MembroDraft[],
): Promise<void> {
  const sanitized = (current || [])
    .map((m) => ({
      id: m.id || null,
      nome: (m.nome || '').trim(),
      cognome: (m.cognome || '').trim(),
      strumento: (m.strumento || '').trim(),
      dataNascita: (m.dataNascita || '').trim(),
    }))
    .filter((m) => m.nome);

  if (!isGroupLike) {
    for (const o of original) {
      if (o.id) await candidatiApi.removeMembro(o.id);
    }
    return;
  }

  const keptIds = new Set(sanitized.filter((m) => m.id).map((m) => m.id));
  for (const o of original) {
    if (o.id && !keptIds.has(o.id)) {
      await candidatiApi.removeMembro(o.id);
    }
  }
  for (const m of sanitized) {
    if (m.id) {
      const old = original.find((o) => o.id === m.id);
      const changed =
        !old ||
        (old.nome || '') !== m.nome ||
        (old.cognome || '') !== m.cognome ||
        (old.strumento || '') !== m.strumento ||
        (old.dataNascita || '') !== m.dataNascita;
      if (changed) {
        await candidatiApi.updateMembro(m.id, {
          nome: m.nome,
          cognome: m.cognome || undefined,
          strumento: m.strumento || undefined,
          dataNascita: m.dataNascita || undefined,
        });
      }
    } else {
      await candidatiApi.addMembro({
        candidatoId,
        nome: m.nome,
        cognome: m.cognome || undefined,
        strumento: m.strumento || undefined,
        dataNascita: m.dataNascita || undefined,
      });
    }
  }
}
