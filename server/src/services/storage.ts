import { mkdir, rm, stat, writeFile } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { extname, join, normalize, resolve } from 'node:path';
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
  const maxBytes = env.UPLOADS_MAX_FILE_SIZE_MB * 1024 * 1024;
  if (args.buffer.length > maxBytes) {
    throw Object.assign(new Error(`file troppo grande (max ${env.UPLOADS_MAX_FILE_SIZE_MB} MB)`), {
      code: 'FILE_TOO_LARGE',
    });
  }

  const dir = tenantUploadDir(args.tenantSlug, args.resource, args.id);
  await mkdir(dir, { recursive: true });

  const ext = EXT_FROM_MIME[args.mimeType] ?? extname(args.originalFilename) ?? '';
  const filename = `${randomBytes(8).toString('hex')}${ext}`;
  const absPath = join(dir, filename);

  // Difesa contro path traversal: dopo join, il path deve restare dentro la dir
  const normalized = normalize(absPath);
  if (!normalized.startsWith(dir)) {
    throw Object.assign(new Error('path traversal rilevato'), { code: 'INVALID_PATH' });
  }

  await writeFile(absPath, args.buffer);

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
