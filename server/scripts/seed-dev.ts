import 'dotenv/config';
import { eq } from 'drizzle-orm';
import { dbSuper, shutdownPools } from '../src/db/client.js';
import { tenants, accounts, concorsi, platformConfig } from '../src/db/schema.js';
import { hashPassword } from '../src/services/password.js';

const DEMO_PASSWORDS = {
  admin: 'Admin123!',
  commissario: 'Demo123!',
  superadmin: 'Super123!',
} as const;

async function main() {
  console.log('🌱 Seeding dev data...');

  // platform_config singleton
  const existingConfig = await dbSuper.select().from(platformConfig);
  if (existingConfig.length === 0) {
    await dbSuper.insert(platformConfig).values({ id: 1 });
    console.log('  ✓ platform_config initialized');
  }

  // Tenant platform (per il super-admin)
  const platform = await upsertTenant({
    slug: 'platform',
    nome: 'Gestimus Platform',
    piano: 'ultra',
    stato: 'attivo',
  });

  // Tenant demo
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
  const archived = await upsertTenant({
    slug: 'ente-archiviato',
    nome: 'Ente Demo Archiviato',
    piano: 'trial',
    stato: 'archiviato',
    archiviatoAt: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000),
    cleanupAfterDays: 30,
  });

  // Account con password hashate Argon2
  console.log('  · hashing passwords (Argon2id, può richiedere qualche secondo)...');
  const adminHash = await hashPassword(DEMO_PASSWORDS.admin);
  const commissarioHash = await hashPassword(DEMO_PASSWORDS.commissario);
  const superHash = await hashPassword(DEMO_PASSWORDS.superadmin);

  await upsertAccount({
    tenantId: ente1.id,
    email: 'admin@ente1.test',
    passwordHash: adminHash,
    role: 'admin',
  });
  await upsertAccount({
    tenantId: ente1.id,
    email: 'commissario@ente1.test',
    passwordHash: commissarioHash,
    role: 'commissario',
  });
  await upsertAccount({
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

  // Concorsi demo
  await upsertConcorso(ente1.id, 'Concorso Solisti 2026', 2026);
  await upsertConcorso(ente1.id, 'Premio Camera 2026', 2026);
  await upsertConcorso(ente2.id, 'Rassegna Giovani 2026', 2026);
  await upsertConcorso(archived.id, 'Concorso Storico (archiviato)', 2024);

  console.log('🌱 Seed completed.\n');
  console.log('Account demo (subdomain → email → password):');
  console.log(`  ente1.gestimus.local    → admin@ente1.test         → ${DEMO_PASSWORDS.admin}`);
  console.log(`  ente1.gestimus.local    → commissario@ente1.test   → ${DEMO_PASSWORDS.commissario}`);
  console.log(`  ente2.gestimus.local    → admin@ente2.test         → ${DEMO_PASSWORDS.admin}`);
  console.log(`  platform.gestimus.local → super@platform.test      → ${DEMO_PASSWORDS.superadmin}`);

  await shutdownPools();
}

async function upsertTenant(data: {
  slug: string;
  nome: string;
  piano: string;
  stato: string;
  archiviatoAt?: Date;
  cleanupAfterDays?: number;
}) {
  const existing = await dbSuper.query.tenants.findFirst({
    where: eq(tenants.slug, data.slug),
  });
  if (existing) {
    console.log(`  · tenant '${data.slug}' già esistente (${existing.id})`);
    return existing;
  }
  const [created] = await dbSuper
    .insert(tenants)
    .values({
      slug: data.slug,
      nome: data.nome,
      piano: data.piano,
      stato: data.stato,
      archiviatoAt: data.archiviatoAt ?? null,
      cleanupAfterDays: data.cleanupAfterDays ?? 30,
      cleanupScheduledAt:
        data.archiviatoAt && data.cleanupAfterDays
          ? new Date(data.archiviatoAt.getTime() + data.cleanupAfterDays * 24 * 60 * 60 * 1000)
          : null,
    })
    .returning();
  console.log(`  ✓ tenant '${data.slug}' creato (${created!.id})`);
  return created!;
}

async function upsertAccount(data: {
  tenantId: string;
  email: string;
  passwordHash: string;
  role: 'admin' | 'commissario' | 'superadmin';
}) {
  const existing = await dbSuper.query.accounts.findFirst({
    where: eq(accounts.email, data.email),
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
  console.log(`  ✓ account '${data.email}' (role=${data.role})`);
  return created!;
}

async function upsertConcorso(tenantId: string, nome: string, anno: number) {
  // Controlla per evitare duplicati al ri-seed
  const existing = await dbSuper
    .select()
    .from(concorsi)
    .where(eq(concorsi.nome, nome))
    .limit(1);
  if (existing.length > 0) {
    console.log(`  · concorso '${nome}' già esistente`);
    return existing[0]!;
  }
  const [created] = await dbSuper
    .insert(concorsi)
    .values({ tenantId, nome, anno, stato: 'ATTIVO' })
    .returning();
  console.log(`  ✓ concorso '${nome}'`);
  return created!;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
