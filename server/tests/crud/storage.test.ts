import 'dotenv/config';
import { test, describe, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Override UPLOADS_DIR a un tempfolder prima di importare lo storage
const tmpDir = mkdtempSync(join(tmpdir(), 'gestimus-uploads-'));
process.env.UPLOADS_DIR = tmpDir;

const { saveFile, fileExists } = await import('../../src/services/storage.js');

describe('Storage service', () => {
  after(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  test('saveFile crea path corretto e ritorna metadati', async () => {
    const result = await saveFile({
      tenantSlug: 'ente1',
      resource: 'commissario',
      id: '019e4eb5-4f47-71b6-9283-bc5da3aaa62e',
      buffer: Buffer.from('fake-jpg-content'),
      mimeType: 'image/jpeg',
      originalFilename: 'foto.jpg',
    });
    assert.match(result.publicUrl, /^\/uploads\/ente1\/commissario\/019e4eb5-4f47-71b6-9283-bc5da3aaa62e\/[a-f0-9]+\.jpg$/);
    assert.equal(await fileExists(result.path), true);
    const stored = readFileSync(result.path);
    assert.equal(stored.toString(), 'fake-jpg-content');
  });

  test('rifiuta mime non consentito', async () => {
    await assert.rejects(
      saveFile({
        tenantSlug: 'ente1',
        resource: 'candidato',
        id: '019e4eb5-4f47-71b6-9283-bc5da3aaa62e',
        buffer: Buffer.from('content'),
        mimeType: 'application/x-executable',
        originalFilename: 'evil.exe',
      }),
      /mime type non consentito/,
    );
  });

  test('rifiuta file > UPLOADS_MAX_FILE_SIZE_MB', async () => {
    const huge = Buffer.alloc(10 * 1024 * 1024); // 10 MB > default 5 MB
    await assert.rejects(
      saveFile({
        tenantSlug: 'ente1',
        resource: 'candidato',
        id: '019e4eb5-4f47-71b6-9283-bc5da3aaa62e',
        buffer: huge,
        mimeType: 'image/jpeg',
        originalFilename: 'huge.jpg',
      }),
      /file troppo grande/,
    );
  });

  test('sanitize tenant slug e id (no path traversal)', async () => {
    const result = await saveFile({
      tenantSlug: 'ente1/../../etc',
      resource: 'concorso',
      id: '../../passwd',
      buffer: Buffer.from('x'),
      mimeType: 'image/png',
      originalFilename: 'x.png',
    });
    // path normalizzato resta dentro la dir
    assert.ok(result.path.startsWith(tmpDir));
    assert.ok(!result.path.includes('..'));
  });
});
