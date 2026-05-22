import 'dotenv/config';
import { and, eq } from 'drizzle-orm';
import { dbSuper, shutdownPools } from '../src/db/client.js';
import {
  accounts,
  candidati,
  candidatiFase,
  categorie,
  commissari,
  commissioni,
  commissioniCommissari,
  commissioniSezioni,
  concorsi,
  criteri,
  fasi,
  platformConfig,
  sezioni,
  tenants,
  valutazioni,
} from '../src/db/schema.js';
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
  const solisti = await upsertConcorso(ente1.id, 'Concorso Solisti 2026', 2026);
  await upsertConcorso(ente1.id, 'Premio Camera 2026', 2026);
  await upsertConcorso(ente2.id, 'Rassegna Giovani 2026', 2026);
  await upsertConcorso(archived.id, 'Concorso Storico (archiviato)', 2024);

  // Dataset completo per "Concorso Solisti 2026" (ente1):
  // sezioni → categorie → commissari → commissione → fasi → criteri → candidati →
  // candidati_fase → valutazioni di esempio.
  const commissarioAccount = await dbSuper.query.accounts.findFirst({
    where: eq(accounts.email, 'commissario@ente1.test'),
  });
  await seedConcorsoData(ente1.id, solisti.id, commissarioAccount?.id ?? null);

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

/**
 * Mini-dataset realistico per un concorso: sezioni, categorie, commissari,
 * commissione, fasi con criteri, candidati con candidati_fase, valutazioni.
 * Idempotente: skippa se rileva già la sezione "Archi" sul concorso.
 */
async function seedConcorsoData(
  tenantId: string,
  concorsoId: string,
  commissarioAccountId: string | null,
) {
  const existing = await dbSuper
    .select()
    .from(sezioni)
    .where(and(eq(sezioni.concorsoId, concorsoId), eq(sezioni.nome, 'Archi')))
    .limit(1);
  if (existing.length > 0) {
    console.log('  · dataset concorso solisti già presente');
    return;
  }

  // Sezioni
  const [sezArchi] = await dbSuper
    .insert(sezioni)
    .values({ tenantId, concorsoId, nome: 'Archi', ordine: 1 })
    .returning();
  const [sezPiano] = await dbSuper
    .insert(sezioni)
    .values({ tenantId, concorsoId, nome: 'Pianoforte', ordine: 2 })
    .returning();
  console.log('  ✓ 2 sezioni (Archi, Pianoforte)');

  // Categorie
  await dbSuper.insert(categorie).values([
    { tenantId, sezioneId: sezArchi!.id, nome: 'Junior', etaMin: 8, etaMax: 14, ordine: 1 },
    { tenantId, sezioneId: sezArchi!.id, nome: 'Senior', etaMin: 15, etaMax: 35, ordine: 2 },
    { tenantId, sezioneId: sezPiano!.id, nome: 'Junior', etaMin: 8, etaMax: 14, ordine: 1 },
    { tenantId, sezioneId: sezPiano!.id, nome: 'Senior', etaMin: 15, etaMax: 35, ordine: 2 },
  ]);
  console.log('  ✓ 4 categorie');

  // Commissari (3 persone)
  const commRows = await dbSuper
    .insert(commissari)
    .values([
      { tenantId, concorsoId, nome: 'Maria', cognome: 'Rossi', specialita: 'Violino' },
      { tenantId, concorsoId, nome: 'Giuseppe', cognome: 'Verdi', specialita: 'Pianoforte' },
      { tenantId, concorsoId, nome: 'Anna', cognome: 'Bianchi', specialita: 'Direzione' },
    ])
    .returning();
  // Lega il commissario@ente1.test al primo commissario (utile per la view commissario)
  if (commissarioAccountId) {
    await dbSuper
      .update(accounts)
      .set({ commissarioId: commRows[0]!.id })
      .where(eq(accounts.id, commissarioAccountId));
  }
  console.log('  ✓ 3 commissari + binding account commissario@ente1.test');

  // Commissione
  const [commissione] = await dbSuper
    .insert(commissioni)
    .values({
      tenantId,
      concorsoId,
      nome: 'Commissione principale',
      presidenteCommissarioId: commRows[2]!.id,
    })
    .returning();
  await dbSuper.insert(commissioniCommissari).values(
    commRows.map((c) => ({ tenantId, commissioneId: commissione!.id, commissarioId: c.id })),
  );
  await dbSuper
    .insert(commissioniSezioni)
    .values([
      { tenantId, commissioneId: commissione!.id, sezioneId: sezArchi!.id },
      { tenantId, commissioneId: commissione!.id, sezioneId: sezPiano!.id },
    ]);
  console.log('  ✓ commissione con 3 membri (presidente Anna Bianchi)');

  // Fasi + criteri
  const fasiInsert = await dbSuper
    .insert(fasi)
    .values([
      {
        tenantId,
        concorsoId,
        ordine: 1,
        nome: 'Eliminatorie',
        scala: 100,
        modoValutazione: 'autonoma',
        metodoMedia: 'aritmetica',
        commissioneId: commissione!.id,
      },
      {
        tenantId,
        concorsoId,
        ordine: 2,
        nome: 'Finale',
        scala: 100,
        modoValutazione: 'sincrona',
        metodoMedia: 'olimpica',
        commissioneId: commissione!.id,
      },
    ])
    .returning();
  await dbSuper.insert(criteri).values([
    { tenantId, faseId: fasiInsert[0]!.id, nome: 'Tecnica', peso: 40, ordine: 1 },
    { tenantId, faseId: fasiInsert[0]!.id, nome: 'Musicalità', peso: 35, ordine: 2 },
    { tenantId, faseId: fasiInsert[0]!.id, nome: 'Interpretazione', peso: 25, ordine: 3 },
    { tenantId, faseId: fasiInsert[1]!.id, nome: 'Tecnica', peso: 40, ordine: 1 },
    { tenantId, faseId: fasiInsert[1]!.id, nome: 'Musicalità', peso: 60, ordine: 2 },
  ]);
  console.log('  ✓ 2 fasi (Eliminatorie/Finale) con criteri pesati');

  // Candidati (4 nella sezione Archi/Senior)
  const candInsert = await dbSuper
    .insert(candidati)
    .values([
      {
        tenantId, concorsoId, numeroCandidato: 1, nome: 'Luca', cognome: 'Ferri',
        strumento: 'Violino', sezioneId: sezArchi!.id,
        categoriaId: null, dataNascita: '2005-03-12',
      },
      {
        tenantId, concorsoId, numeroCandidato: 2, nome: 'Sara', cognome: 'Mori',
        strumento: 'Violoncello', sezioneId: sezArchi!.id,
        categoriaId: null, dataNascita: '2003-08-22',
      },
      {
        tenantId, concorsoId, numeroCandidato: 3, nome: 'Davide', cognome: 'Conti',
        strumento: 'Pianoforte', sezioneId: sezPiano!.id,
        categoriaId: null, dataNascita: '2002-01-30',
      },
      {
        tenantId, concorsoId, numeroCandidato: 4, nome: 'Elena', cognome: 'Russo',
        strumento: 'Pianoforte', sezioneId: sezPiano!.id,
        categoriaId: null, dataNascita: '2008-06-15',
      },
    ])
    .returning();
  console.log('  ✓ 4 candidati');

  // Candidati nella fase Eliminatorie
  const cfRows = await dbSuper
    .insert(candidatiFase)
    .values(
      candInsert.map((c, i) => ({
        tenantId,
        faseId: fasiInsert[0]!.id,
        candidatoId: c.id,
        posizione: i + 1,
        stato: 'IN_ATTESA' as const,
      })),
    )
    .returning();

  // Qualche valutazione parziale (commissario Maria Rossi sui primi 2 candidati)
  await dbSuper.insert(valutazioni).values([
    {
      tenantId,
      candidatoFaseId: cfRows[0]!.id,
      commissarioId: commRows[0]!.id,
      criterio: 'Tecnica',
      voto: 85,
    },
    {
      tenantId,
      candidatoFaseId: cfRows[0]!.id,
      commissarioId: commRows[0]!.id,
      criterio: 'Musicalità',
      voto: 78,
    },
    {
      tenantId,
      candidatoFaseId: cfRows[1]!.id,
      commissarioId: commRows[0]!.id,
      criterio: 'Tecnica',
      voto: 92,
    },
  ]);
  console.log('  ✓ candidati assegnati a Eliminatorie + 3 valutazioni demo');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
