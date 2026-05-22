import 'dotenv/config';
import { sql } from 'drizzle-orm';
import { dbSuper, shutdownPools } from '../src/db/client.js';
import {
  accounts,
  candidati,
  commissari,
  concorsi,
  platformAuditLog,
  platformConfig,
  tenants,
} from '../src/db/schema.js';
import { hashPassword } from '../src/services/password.js';

/**
 * Seed di sviluppo: 2 tenant (ente1, ente2) + super-admin platform.
 * Ogni tenant ha 1 concorso, 5 commissari e 5 candidati.
 *
 * Modalità:
 *  - default                  : se i dati esistono già, è idempotente (non duplica)
 *  - SEED_RESET=1 npm run db:seed   : prima cancella TUTTI i tenant esistenti + audit
 *                                     platform, poi seeda. Usalo per ripartire pulito.
 */

const RESET = process.env.SEED_RESET === '1' || process.argv.includes('--reset');

const DEMO_PASSWORDS = {
  admin: 'Admin123!',
  commissario: 'Demo123!',
  superadmin: 'Super123!',
} as const;

async function main() {
  console.log('🌱 Seeding dev data...');

  if (RESET) {
    console.log('  ⚠ SEED_RESET attivo — cancello tutti i tenant esistenti...');
    // DELETE su tenants cascade su tutte le tabelle di dominio (RLS + FK ON DELETE CASCADE).
    await dbSuper.execute(sql`DELETE FROM tenants`);
    // platform_audit_log non ha FK su tenants → vada cancellato esplicitamente.
    await dbSuper.execute(sql`DELETE FROM platform_audit_log`);
    console.log('  ✓ tutti i tenant + platform_audit_log cancellati');
  }

  // platform_config singleton
  const existingConfig = await dbSuper.select().from(platformConfig);
  if (existingConfig.length === 0) {
    await dbSuper.insert(platformConfig).values({ id: 1 });
    console.log('  ✓ platform_config inizializzato');
  }

  // Tenant platform (super-admin)
  const platform = await upsertTenant({
    slug: 'platform',
    nome: 'Gestimus Platform',
    piano: 'ultra',
    stato: 'attivo',
  });

  // 2 tenant demo
  const ente1 = await upsertTenant({
    slug: 'ente1',
    nome: 'Conservatorio Demo Milano',
    piano: 'pro',
    stato: 'attivo',
  });
  const ente2 = await upsertTenant({
    slug: 'ente2',
    nome: 'Associazione Demo Roma',
    piano: 'starter',
    stato: 'attivo',
  });

  // Account (Argon2id)
  console.log('  · hashing passwords (Argon2id, può richiedere qualche secondo)...');
  const adminHash = await hashPassword(DEMO_PASSWORDS.admin);
  const commissarioHash = await hashPassword(DEMO_PASSWORDS.commissario);
  const superHash = await hashPassword(DEMO_PASSWORDS.superadmin);

  const ente1Admin = await upsertAccount({
    tenantId: ente1.id,
    email: 'admin@ente1.test',
    passwordHash: adminHash,
    role: 'admin',
  });
  const ente1Comm = await upsertAccount({
    tenantId: ente1.id,
    email: 'commissario@ente1.test',
    passwordHash: commissarioHash,
    role: 'commissario',
  });
  const ente2Admin = await upsertAccount({
    tenantId: ente2.id,
    email: 'admin@ente2.test',
    passwordHash: adminHash,
    role: 'admin',
  });
  await upsertAccount({
    tenantId: platform.id,
    email: 'super@platform.test',
    passwordHash: superHash,
    role: 'superadmin',
  });
  void ente1Admin;
  void ente2Admin;

  // Dataset per ente1 (1 concorso + 5 commissari + 5 candidati)
  const concorsoE1 = await upsertConcorso(ente1.id, 'Concorso Solisti 2026', 2026);
  await seedFiveCommissari(ente1.id, concorsoE1.id, ente1Comm.id, [
    ['Maria', 'Rossi', 'Violino'],
    ['Giuseppe', 'Verdi', 'Pianoforte'],
    ['Anna', 'Bianchi', 'Direzione'],
    ['Luigi', 'Conti', 'Violoncello'],
    ['Francesca', 'Greco', 'Flauto'],
  ]);
  await seedFiveCandidati(ente1.id, concorsoE1.id, [
    [1, 'Luca', 'Ferri', 'Violino', '2005-03-12'],
    [2, 'Sara', 'Mori', 'Violoncello', '2003-08-22'],
    [3, 'Davide', 'Conti', 'Pianoforte', '2002-01-30'],
    [4, 'Elena', 'Russo', 'Flauto', '2008-06-15'],
    [5, 'Matteo', 'Galli', 'Violino', '2004-11-04'],
  ]);

  // Dataset per ente2 (1 concorso + 5 commissari + 5 candidati)
  const concorsoE2 = await upsertConcorso(ente2.id, 'Rassegna Giovani 2026', 2026);
  await seedFiveCommissari(ente2.id, concorsoE2.id, null, [
    ['Carlo', 'Marini', 'Pianoforte'],
    ['Silvia', 'Costa', 'Violino'],
    ['Roberto', 'Esposito', 'Direzione'],
    ['Giulia', 'Bruno', 'Canto'],
    ['Marco', 'De Luca', 'Chitarra'],
  ]);
  await seedFiveCandidati(ente2.id, concorsoE2.id, [
    [1, 'Alice', 'Romano', 'Pianoforte', '2007-05-10'],
    [2, 'Tommaso', 'Lombardi', 'Violino', '2006-09-18'],
    [3, 'Chiara', 'Marini', 'Canto', '2005-02-25'],
    [4, 'Federico', 'Sanna', 'Chitarra', '2003-12-01'],
    [5, 'Beatrice', 'Vitale', 'Pianoforte', '2008-07-14'],
  ]);

  console.log('\n🌱 Seed completato.\n');
  console.log('Account demo (subdomain → email → password):');
  console.log(`  ente1.gestimus.local    → admin@ente1.test         → ${DEMO_PASSWORDS.admin}`);
  console.log(`  ente1.gestimus.local    → commissario@ente1.test   → ${DEMO_PASSWORDS.commissario}`);
  console.log(`  ente2.gestimus.local    → admin@ente2.test         → ${DEMO_PASSWORDS.admin}`);
  console.log(`  platform.gestimus.local → super@platform.test      → ${DEMO_PASSWORDS.superadmin}`);

  await shutdownPools();
}

// ============================================================================
// Helpers
// ============================================================================

async function upsertTenant(data: {
  slug: string;
  nome: string;
  piano: string;
  stato: string;
}) {
  const existing = await dbSuper.query.tenants.findFirst({
    where: (t, { eq }) => eq(t.slug, data.slug),
  });
  if (existing) {
    console.log(`  · tenant '${data.slug}' già esistente`);
    return existing;
  }
  const [created] = await dbSuper
    .insert(tenants)
    .values({
      slug: data.slug,
      nome: data.nome,
      piano: data.piano,
      stato: data.stato,
      cleanupAfterDays: 30,
    })
    .returning();
  console.log(`  ✓ tenant '${data.slug}' creato`);
  return created!;
}

async function upsertAccount(data: {
  tenantId: string;
  email: string;
  passwordHash: string;
  role: 'admin' | 'commissario' | 'superadmin';
}) {
  const existing = await dbSuper.query.accounts.findFirst({
    where: (a, { eq }) => eq(a.email, data.email),
  });
  if (existing) {
    console.log(`  · account '${data.email}' già esistente`);
    return existing;
  }
  const [created] = await dbSuper
    .insert(accounts)
    .values({
      tenantId: data.tenantId,
      email: data.email,
      passwordHash: data.passwordHash,
      role: data.role,
      emailVerified: true,
    })
    .returning();
  console.log(`  ✓ account '${data.email}' (${data.role})`);
  return created!;
}

async function upsertConcorso(tenantId: string, nome: string, anno: number) {
  const existing = await dbSuper.query.concorsi.findFirst({
    where: (c, { and, eq }) => and(eq(c.tenantId, tenantId), eq(c.nome, nome)),
  });
  if (existing) {
    console.log(`  · concorso '${nome}' già esistente`);
    return existing;
  }
  const [created] = await dbSuper
    .insert(concorsi)
    .values({ tenantId, nome, anno, stato: 'ATTIVO' })
    .returning();
  console.log(`  ✓ concorso '${nome}'`);
  return created!;
}

async function seedFiveCommissari(
  tenantId: string,
  concorsoId: string,
  bindAccountId: string | null,
  list: Array<[string, string, string]>,
) {
  // Skip se già presenti almeno 5 commissari nel concorso
  const existing = await dbSuper.query.commissari.findMany({
    where: (c, { eq }) => eq(c.concorsoId, concorsoId),
  });
  if (existing.length >= 5) {
    console.log(`  · 5 commissari per concorso già presenti (${existing.length})`);
    return existing;
  }
  const inserted = await dbSuper
    .insert(commissari)
    .values(list.map(([nome, cognome, specialita]) => ({
      tenantId,
      concorsoId,
      nome,
      cognome,
      specialita,
    })))
    .returning();
  console.log(`  ✓ 5 commissari per concorso ${concorsoId}`);
  // Bind opzionale dell'account commissario al primo commissario inserito
  if (bindAccountId) {
    await dbSuper
      .update(accounts)
      .set({ commissarioId: inserted[0]!.id })
      .where(sql`${accounts.id} = ${bindAccountId}`);
    console.log(`    · account commissario bindato a ${inserted[0]!.nome} ${inserted[0]!.cognome}`);
  }
  return inserted;
}

async function seedFiveCandidati(
  tenantId: string,
  concorsoId: string,
  list: Array<[number, string, string, string, string]>,
) {
  const existing = await dbSuper.query.candidati.findMany({
    where: (c, { eq }) => eq(c.concorsoId, concorsoId),
  });
  if (existing.length >= 5) {
    console.log(`  · 5 candidati per concorso già presenti (${existing.length})`);
    return existing;
  }
  const inserted = await dbSuper
    .insert(candidati)
    .values(list.map(([n, nome, cognome, strumento, dataNascita]) => ({
      tenantId,
      concorsoId,
      numeroCandidato: n,
      nome,
      cognome,
      strumento,
      dataNascita,
    })))
    .returning();
  console.log(`  ✓ 5 candidati per concorso ${concorsoId}`);
  return inserted;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
