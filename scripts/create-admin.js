// Bootstrap script — crea il primo admin nella collezione `accounts`.
// Node ≥ 18 (usa fetch nativo).
// Usage: node scripts/create-admin.js <email> <password> [nome] [cognome]

const PB_URL = process.env.PB_URL || 'http://127.0.0.1:8090';
const [email, password, nome = 'Admin', cognome = ''] = process.argv.slice(2);

if (!email || !password) {
  console.error('Usage: node scripts/create-admin.js <email> <password> [nome] [cognome]');
  console.error('Example: node scripts/create-admin.js admin@esempio.it password123 Mario Rossi');
  process.exit(1);
}
if (password.length < 6) {
  console.error('La password deve essere lunga almeno 6 caratteri.');
  process.exit(1);
}

async function main() {
  console.log(`→ PocketBase: ${PB_URL}`);

  // Verify accounts collection exists by probing the public records endpoint.
  const probe = await fetch(`${PB_URL}/api/collections/accounts/records?perPage=1`).catch(() => null);
  if (!probe || probe.status === 404) {
    console.error(`✗ La collezione "accounts" non esiste. Avvia PB con --migrationsDir ./pb_migrations o esegui setup-pb.js.`);
    process.exit(2);
  }
  // listRule requires auth, so 401/403 here is fine — it confirms the collection exists.

  // Probe via auth: if the email exists, surface a friendly message.
  const authProbe = await fetch(`${PB_URL}/api/collections/accounts/auth-with-password`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ identity: email, password: 'x' }),
  }).then(r => r.json()).catch(() => ({}));
  // If PB responds with auth error specific to wrong password (not "user not found"), the email exists.
  if (authProbe?.code === 400 && /Failed to authenticate/i.test(authProbe?.message || '')) {
    // PB returns the same 400 for both "wrong pwd" and "no such user", but if the user really exists,
    // creating with the same email will fail. We'll let PB handle that and surface our message below.
  }

  const body = {
    email, password, passwordConfirm: password,
    nome, cognome,
    role: 'admin',
    attivo: true,
    emailVisibility: true,
  };

  const r = await fetch(`${PB_URL}/api/collections/accounts/records`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) {
    // Friendly handling of common errors
    const emailErr = data?.data?.email?.message || '';
    if (/already in use/i.test(emailErr)) {
      console.error(`\n✗ L'email "${email}" è già registrata su PocketBase.\n`);
      console.error('  Puoi:');
      console.error(`  1. Accedere all'app con quella email se ricordi la password (apri ${PB_URL.replace('8090','8000')})`);
      console.error('  2. Eliminare l\'account esistente dall\'admin UI di PB:');
      console.error(`     ${PB_URL}/_/  →  Collections  →  accounts  →  cerca "${email}"  →  elimina`);
      console.error('  3. Usare un\'email diversa per questo nuovo admin');
      console.error('  4. Resettare la password via admin UI (più rapido se vuoi tenere lo stesso account)');
      process.exit(5);
    }
    console.error('✗ Creazione fallita:', JSON.stringify(data, null, 2));
    process.exit(4);
  }
  console.log(`✓ Admin creato: ${data.email} (${data.nome} ${data.cognome})`);
  console.log(`\nOra puoi accedere all'app con queste credenziali su ${PB_URL.replace('8090','8000')}.`);
}

main().catch(e => { console.error('✗', e?.message || e); process.exit(1); });
