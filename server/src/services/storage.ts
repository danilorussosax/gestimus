import { mkdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { join, normalize, resolve } from 'node:path';
import { randomBytes } from 'node:crypto';
import { env } from '../env.js';

export type ResourceKind = 'concorso' | 'commissario' | 'candidato' | 'iscrizione';

const ALLOWED_MIME = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
]);

const EXT_FROM_MIME: Record<string, string> = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
  'image/gif': '.gif',
  'application/pdf': '.pdf',
  'application/msword': '.doc',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': '.docx',
};

// H8: verifica magic bytes vs mime dichiarato dal client. Un HTML/SVG con MIME
// finto image/png verrebbe servito da /uploads/ e potrebbe eseguire script nel
// browser. Confrontiamo i primi byte del buffer con la firma attesa.
function magicMatches(buffer: Buffer, mimeType: string): boolean {
  const b = buffer;
  const startsWith = (...bytes: number[]) => bytes.every((v, i) => b[i] === v);
  switch (mimeType) {
    case 'image/jpeg':
      return startsWith(0xff, 0xd8, 0xff);
    case 'image/png':
      return startsWith(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a);
    case 'image/gif':
      return startsWith(0x47, 0x49, 0x46, 0x38); // GIF8
    case 'image/webp':
      // RIFF....WEBP
      return startsWith(0x52, 0x49, 0x46, 0x46) && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50;
    case 'application/pdf':
      return startsWith(0x25, 0x50, 0x44, 0x46); // %PDF
    case 'application/msword':
      return startsWith(0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1); // OLE2
    case 'application/vnd.openxmlformats-officedocument.wordprocessingml.document':
      return startsWith(0x50, 0x4b, 0x03, 0x04) || startsWith(0x50, 0x4b, 0x05, 0x06); // ZIP (docx)
    default:
      return false;
  }
}

function uploadsRoot(): string {
  return resolve(env.UPLOADS_DIR);
}

export function tenantUploadDir(tenantSlug: string, resource: ResourceKind, id: string): string {
  // Sanitize input: tenant slug e id sono validati a monte (subdomain + UUID),
  // ma normalizziamo come difesa-in-profondità
  const safeSlug = tenantSlug.replace(/[^a-z0-9-]/gi, '');
  const safeId = id.replace(/[^a-zA-Z0-9-]/g, '');
  return resolve(uploadsRoot(), safeSlug, resource, safeId);
}

export function publicPath(tenantSlug: string, resource: ResourceKind, id: string, filename: string): string {
  return `/uploads/${tenantSlug}/${resource}/${id}/${filename}`;
}

export type StoredFile = {
  filename: string;
  path: string; // path filesystem assoluto
  publicUrl: string; // path relativo servito da nginx/Caddy
  sizeBytes: number;
  mimeType: string;
};

/**
 * Salva un buffer su disco sotto uploads/<tenant>/<resource>/<id>/<nome>.
 * Ritorna info utili per aggiornare il DB.
 */
export async function saveFile(args: {
  tenantSlug: string;
  resource: ResourceKind;
  id: string;
  buffer: Buffer;
  mimeType: string;
  originalFilename: string;
}): Promise<StoredFile> {
  if (!ALLOWED_MIME.has(args.mimeType)) {
    throw Object.assign(new Error(`mime type non consentito: ${args.mimeType}`), { code: 'UNSUPPORTED_MIME' });
  }
  if (!magicMatches(args.buffer, args.mimeType)) {
    throw Object.assign(
      new Error(`contenuto file non corrisponde al tipo dichiarato (${args.mimeType})`),
      { code: 'MIME_MISMATCH' },
    );
  }
  const maxBytes = env.UPLOADS_MAX_FILE_SIZE_MB * 1024 * 1024;
  if (args.buffer.length > maxBytes) {
    throw Object.assign(new Error(`file troppo grande (max ${env.UPLOADS_MAX_FILE_SIZE_MB} MB)`), {
      code: 'FILE_TOO_LARGE',
    });
  }

  const dir = tenantUploadDir(args.tenantSlug, args.resource, args.id);
  await mkdir(dir, { recursive: true });

  // N131: l'estensione viene SEMPRE derivata dal MIME (già validato contro
  // ALLOWED_MIME + magic bytes), mai dal filename originale. Il vecchio fallback
  // `extname(originalFilename)` poteva preservare un'estensione pericolosa
  // (es. .html) per un MIME ammesso ma non mappato → stored XSS. Tutti i MIME
  // ammessi sono in EXT_FROM_MIME; in caso contrario nessuna estensione.
  const ext = EXT_FROM_MIME[args.mimeType] ?? '';
  const filename = `${randomBytes(8).toString('hex')}${ext}`;
  const absPath = join(dir, filename);

  // Difesa contro path traversal: dopo join, il path deve restare dentro la dir
  const normalized = normalize(absPath);
  if (!normalized.startsWith(dir)) {
    throw Object.assign(new Error('path traversal rilevato'), { code: 'INVALID_PATH' });
  }

  // M151: scrittura atomica — write su file temporaneo + rename. Un crash a
  // metà writeFile lascerebbe altrimenti un file parziale/corrotto al path
  // finale (rename è atomico sullo stesso filesystem).
  const tmpPath = `${absPath}.tmp-${randomBytes(4).toString('hex')}`;
  await writeFile(tmpPath, args.buffer);
  await rename(tmpPath, absPath);

  return {
    filename,
    path: absPath,
    publicUrl: publicPath(args.tenantSlug, args.resource, args.id, filename),
    sizeBytes: args.buffer.length,
    mimeType: args.mimeType,
  };
}

export async function deleteFile(path: string): Promise<void> {
  const root = uploadsRoot();
  const normalized = normalize(resolve(path));
  if (!normalized.startsWith(root)) {
    throw new Error('file fuori da uploads root, rifiuto delete');
  }
  await rm(normalized, { force: true });
}

export async function fileExists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

export { createReadStream };
