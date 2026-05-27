import 'dotenv/config';
import { dbSuper, shutdownPools } from '../src/db/client.js';
import { accounts, platformConfig, tenants } from '../src/db/schema.js';
import { hashPassword } from '../src/services/password.js';

/**
 * Seed di PRODUZIONE: crea il minimo per partire — `platform_config`, il tenant
 * `platform` (super-admin) e UN account super-admin. NON crea dati demo.
 *
 * A differenza di `seed-dev`, la password del super-admin NON è hardcoded:
 * arriva da env, così il provisioning genera una credenziale forte.
 *
 *   GESTIMUS_ADMIN_EMAIL=...      (obbligatorio) email del super-admin
 *   GESTIMUS_ADMIN_PASSWORD=...   (obbligatorio, min 12 char) password iniziale
 *   SUPERADMIN_SUBDOMAIN=platform (default) slug del tenant platform
 *
 * Idempotente: se l'account esiste già non lo tocca (non resetta la password).
 * I tenant reali si creano poi dalla UI platform loggati come super-admin.
 */
const EMAIL = process.env.GESTIMUS_ADMIN_EMAIL;
const PASSWORD = process.env.GESTIMUS_ADMIN_PASSWORD;
const SUBDOMAIN = process.env.SUPERADMIN_SUBDOMAIN ?? 'platform';

async function main() {
  if (!EMAIL || !PASSWORD) {
    console.error('✗ GESTIMUS_ADMIN_EMAIL e GESTIMUS_ADMIN_PASSWORD sono obbligatori');
    process.exit(1);
  }
  if (PASSWORD.length < 12) {
    console.error('✗ GESTIMUS_ADMIN_PASSWORD troppo corta (minimo 12 caratteri)');
    process.exit(1);
  }

  // platform_config singleton (id = 1)
  const cfg = await dbSuper.select().from(platformConfig);
  if (cfg.length === 0) {
    await dbSuper.insert(platformConfig).values({ id: 1 });
    console.log('✓ platform_config inizializzato');
  }

  // Tenant platform (host del super-admin)
  let platform = await dbSuper.query.tenants.findFirst({
    where: (t, { eq }) => eq(t.slug, SUBDOMAIN),
  });
  if (!platform) {
    const [created] = await dbSuper
      .insert(tenants)
      .values({
        slug: SUBDOMAIN,
        nome: 'Gestimus Platform',
        piano: 'ultra',
        stato: 'attivo',
        cleanupAfterDays: 30,
      })
      .returning();
    platform = created!;
    console.log(`✓ tenant '${SUBDOMAIN}' creato`);
  } else {
    console.log(`· tenant '${SUBDOMAIN}' già esistente`);
  }

  // Account super-admin
  const existing = await dbSuper.query.accounts.findFirst({
    where: (a, { eq }) => eq(a.email, EMAIL),
  });
  if (existing) {
    console.log(`· account '${EMAIL}' già esistente — password NON modificata`);
  } else {
    const passwordHash = await hashPassword(PASSWORD);
    await dbSuper.insert(accounts).values({
      tenantId: platform.id,
      email: EMAIL,
      passwordHash,
      role: 'superadmin',
      emailVerified: true,
    });
    console.log(`✓ super-admin '${EMAIL}' creato (tenant '${SUBDOMAIN}')`);
  }

  console.log('\n✓ Seed di produzione completato.');
  await shutdownPools();
}

main().catch((err) => {
  console.error('\n✗ Seed prod fallito:', err);
  process.exit(1);
});
