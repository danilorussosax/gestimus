// Helpers and hooks extracted from CommissariTab.tsx (pure lift-and-move).

import { useQuery } from '@tanstack/react-query';
import { accountsApi } from '@/api/accounts';

// ---------------------------------------------------------------------------
// Helpers (port di displayName / ageFromDate da js/utils.js)
// ---------------------------------------------------------------------------
export function displayName(c: { nome?: string | null; cognome?: string | null } | null | undefined): string {
  if (!c) return '—';
  return `${c.nome ?? ''} ${c.cognome ?? ''}`.trim() || '—';
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

// Elenco nazionalità (port di NATIONALITIES da js/utils.js).
export const NATIONALITIES = [
  'Italiana', 'Albanese', 'Argentina', 'Australiana', 'Austriaca', 'Belga', 'Brasiliana',
  'Britannica', 'Bulgara', 'Canadese', 'Cinese', 'Coreana', 'Croata', 'Danese', 'Estone',
  'Finlandese', 'Francese', 'Giapponese', 'Greca', 'Indiana', 'Iraniana', 'Irlandese',
  'Israeliana', 'Lettone', 'Lituana', 'Maltese', 'Messicana', 'Moldava', 'Norvegese',
  'Olandese', 'Polacca', 'Portoghese', 'Rumena', 'Russa', 'Serba', 'Slovacca', 'Slovena',
  'Spagnola', 'Statunitense', 'Svedese', 'Svizzera', 'Tedesca', 'Turca', 'Ucraina', 'Ungherese',
];

// Genera una password robusta (port di generatePassword da commissari.js).
export function generatePassword(length = 12): string {
  const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ23456789';
  const arr = new Uint32Array(length);
  crypto.getRandomValues(arr);
  let out = '';
  for (let i = 0; i < length; i++) out += chars[arr[i] % chars.length];
  return out;
}

// Ridimensiona un'immagine via canvas e restituisce un Blob (port di
// readImageResized — il vanilla produceva un dataURL; qui serve un Blob per
// l'upload multipart). Preserva la trasparenza per PNG/WebP.
export function readFileAsDataURL(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result as string);
    r.onerror = reject;
    r.readAsDataURL(file);
  });
}

export async function readImageResizedBlob(file: File, maxDim = 480, quality = 0.85): Promise<{ blob: Blob; dataURL: string }> {
  const dataURL = await readFileAsDataURL(file);
  const inputMime = (file?.type || '').toLowerCase();
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
        reject(new Error('canvas context unavailable'));
        return;
      }
      ctx.drawImage(img, 0, 0, w, h);
      canvas.toBlob(
        (blob) => {
          if (!blob) {
            reject(new Error('toBlob failed'));
            return;
          }
          resolve({ blob, dataURL: canvas.toDataURL(outputMime, quality) });
        },
        outputMime,
        quality,
      );
    };
    img.onerror = reject;
    img.src = dataURL;
  });
}

// ---------------------------------------------------------------------------
// Account hooks (sopra accountsApi, che non espone hook dedicati)
// ---------------------------------------------------------------------------
export function useAccounts() {
  return useQuery({
    queryKey: ['accounts'],
    queryFn: () => accountsApi.list({ limit: 500 }),
  });
}
