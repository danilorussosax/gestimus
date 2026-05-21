// Node ≥ 18. Setup PocketBase collections via the admin REST API.
// Usage: node scripts/setup-pb.js <admin-email> <admin-password>
// Override URL via env: PB_URL=http://host:port node scripts/setup-pb.js ...

const PB_URL = process.env.PB_URL || 'http://127.0.0.1:8090';
const [email, password] = process.argv.slice(2);

if (!email || !password) {
  console.error('Usage: node scripts/setup-pb.js <admin-email> <admin-password>');
  process.exit(1);
}

async function api(method, path, body, token) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = token;
  const res = await fetch(`${PB_URL}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} on ${method} ${path}: ${JSON.stringify(data)}`);
  return data;
}

const baseRules = { listRule: '', viewRule: '', createRule: '', updateRule: '', deleteRule: '' };

function buildCollections(refs) {
  // refs is filled in after each create with the actual collection id
  return [
    {
      name: 'concorsi',
      type: 'base',
      ...baseRules,
      schema: [
        { name: 'nome', type: 'text', required: true, options: { max: 255 } },
        { name: 'anno', type: 'number', required: true, options: { min: 1900, max: 2200, noDecimal: true } },
        { name: 'data_inizio', type: 'date', options: {} },
        { name: 'stato', type: 'select', options: { maxSelect: 1, values: ['ATTIVO','CONCLUSO'] } },
        { name: 'legacy_id', type: 'number', options: { noDecimal: true } },
      ],
    },
    {
      name: 'commissari',
      type: 'base',
      ...baseRules,
      schema: [
        { name: 'concorso', type: 'relation', required: true, options: { collectionId: refs.concorsi, cascadeDelete: true, maxSelect: 1 } },
        { name: 'nome', type: 'text', required: true, options: { max: 255 } },
        { name: 'cognome', type: 'text', options: { max: 255 } },
        { name: 'specialita', type: 'text', options: { max: 255 } },
        { name: 'email', type: 'email', options: {} },
        { name: 'telefono', type: 'text', options: { max: 50 } },
        { name: 'data_nascita', type: 'date', options: {} },
        { name: 'nazionalita', type: 'text', options: { max: 100 } },
        { name: 'foto', type: 'file', options: { maxSelect: 1, maxSize: 2097152, mimeTypes: ['image/jpeg','image/png','image/webp','image/gif'] } },
        { name: 'cv', type: 'file', options: { maxSelect: 1, maxSize: 5242880 } },
        { name: 'bio', type: 'text', options: {} },
        { name: 'stato', type: 'select', options: { maxSelect: 1, values: ['ATTIVO','INATTIVO'] } },
        { name: 'is_presidente', type: 'bool', options: {} },
        { name: 'legacy_id', type: 'number', options: { noDecimal: true } },
      ],
    },
    {
      name: 'candidati',
      type: 'base',
      ...baseRules,
      schema: [
        { name: 'concorso', type: 'relation', required: true, options: { collectionId: refs.concorsi, cascadeDelete: true, maxSelect: 1 } },
        { name: 'numero_candidato', type: 'number', required: true, options: { min: 1, noDecimal: true } },
        { name: 'nome', type: 'text', required: true, options: { max: 255 } },
        { name: 'cognome', type: 'text', options: { max: 255 } },
        { name: 'strumento', type: 'text', required: true, options: { max: 255 } },
        { name: 'data_nascita', type: 'date', options: {} },
        { name: 'nazionalita', type: 'text', options: { max: 100 } },
        { name: 'foto', type: 'file', options: { maxSelect: 1, maxSize: 2097152, mimeTypes: ['image/jpeg','image/png','image/webp','image/gif'] } },
        { name: 'cv', type: 'file', options: { maxSelect: 1, maxSize: 5242880 } },
        { name: 'docenti_preparatori', type: 'json', options: {} },
        { name: 'data_iscrizione', type: 'date', options: {} },
        { name: 'sezioni', type: 'relation', options: { collectionId: refs.sezioni, cascadeDelete: false, maxSelect: 99, minSelect: 0 } },
        { name: 'categorie', type: 'relation', options: { collectionId: refs.categorie, cascadeDelete: false, maxSelect: 99, minSelect: 0 } },
        { name: 'legacy_id', type: 'number', options: { noDecimal: true } },
      ],
    },
    {
      name: 'fasi',
      type: 'base',
      ...baseRules,
      schema: [
        { name: 'concorso', type: 'relation', required: true, options: { collectionId: refs.concorsi, cascadeDelete: true, maxSelect: 1 } },
        { name: 'ordine', type: 'number', required: true, options: { min: 1, noDecimal: true } },
        { name: 'nome', type: 'text', required: true, options: { max: 255 } },
        { name: 'ammessi', type: 'number', options: { min: 1, noDecimal: true } },
        { name: 'data_prevista', type: 'date', options: {} },
        { name: 'scala', type: 'number', options: { min: 2, max: 1000, noDecimal: true } },
        { name: 'modo_valutazione', type: 'select', options: { maxSelect: 1, values: ['autonoma','sincrona'] } },
        { name: 'metodo_media', type: 'select', options: { maxSelect: 1, values: ['aritmetica','olimpica','winsorizzata','mediana','deviazione_std'] } },
        { name: 'pesi', type: 'json', options: {} },
        { name: 'criteri', type: 'json', options: { maxSize: 1048576 } },
        { name: 'tempo_minuti', type: 'number', options: { min: 0, max: 600, noDecimal: true } },
        { name: 'commissari_ids', type: 'json', options: {} },
        { name: 'sezioni', type: 'relation', options: { collectionId: refs.sezioni, cascadeDelete: false, maxSelect: 99, minSelect: 0 } },
        { name: 'stato', type: 'select', options: { maxSelect: 1, values: ['PIANIFICATA','IN_CORSO','CONCLUSA'] } },
        { name: 'legacy_id', type: 'number', options: { noDecimal: true } },
      ],
    },
    {
      name: 'candidati_fase',
      type: 'base',
      ...baseRules,
      schema: [
        { name: 'fase', type: 'relation', required: true, options: { collectionId: refs.fasi, cascadeDelete: true, maxSelect: 1 } },
        { name: 'candidato', type: 'relation', required: true, options: { collectionId: refs.candidati, cascadeDelete: true, maxSelect: 1 } },
        { name: 'posizione', type: 'number', options: { min: 1, noDecimal: true } },
        { name: 'stato', type: 'select', options: { maxSelect: 1, values: ['IN_ATTESA','IN_ESECUZIONE','COMPLETATO','ELIMINATO'] } },
        { name: 'ammesso_prossima_fase', type: 'bool', options: {} },
        { name: 'legacy_id', type: 'number', options: { noDecimal: true } },
      ],
    },
    {
      name: 'valutazioni',
      type: 'base',
      ...baseRules,
      schema: [
        { name: 'candidato_fase', type: 'relation', required: true, options: { collectionId: refs.candidati_fase, cascadeDelete: true, maxSelect: 1 } },
        { name: 'commissario', type: 'relation', required: true, options: { collectionId: refs.commissari, cascadeDelete: true, maxSelect: 1 } },
        { name: 'criterio', type: 'text', required: true, options: { max: 50 } },
        { name: 'voto', type: 'number', required: true, options: {} },
        { name: 'note', type: 'text', options: {} },
        { name: 'timestamp', type: 'date', options: {} },
        { name: 'legacy_id', type: 'number', options: { noDecimal: true } },
      ],
    },
    {
      name: 'sezioni',
      type: 'base',
      ...baseRules,
      schema: [
        { name: 'concorso', type: 'relation', required: true, options: { collectionId: refs.concorsi, cascadeDelete: true, maxSelect: 1 } },
        { name: 'nome', type: 'text', required: true, options: { max: 255 } },
        { name: 'descrizione', type: 'text', options: {} },
        { name: 'ordine', type: 'number', options: { noDecimal: true, min: 1 } },
        { name: 'legacy_id', type: 'number', options: { noDecimal: true } },
      ],
    },
    {
      name: 'categorie',
      type: 'base',
      ...baseRules,
      schema: [
        { name: 'sezione', type: 'relation', required: true, options: { collectionId: refs.sezioni, cascadeDelete: true, maxSelect: 1 } },
        { name: 'nome', type: 'text', required: true, options: { max: 255 } },
        { name: 'descrizione', type: 'text', options: {} },
        { name: 'ordine', type: 'number', options: { noDecimal: true, min: 1 } },
        { name: 'legacy_id', type: 'number', options: { noDecimal: true } },
      ],
    },
    {
      name: 'commissioni',
      type: 'base',
      ...baseRules,
      schema: [
        { name: 'concorso', type: 'relation', required: true, options: { collectionId: refs.concorsi, cascadeDelete: true, maxSelect: 1 } },
        { name: 'nome', type: 'text', required: true, options: { max: 255 } },
        { name: 'descrizione', type: 'text', options: {} },
        { name: 'commissari', type: 'relation', options: { collectionId: refs.commissari, cascadeDelete: false, maxSelect: 99, minSelect: 0 } },
        { name: 'sezioni', type: 'relation', options: { collectionId: refs.sezioni, cascadeDelete: false, maxSelect: 99, minSelect: 0 } },
        { name: 'categorie', type: 'relation', options: { collectionId: refs.categorie, cascadeDelete: false, maxSelect: 99, minSelect: 0 } },
        { name: 'include_tutte_categorie', type: 'bool', options: {} },
        { name: 'legacy_id', type: 'number', options: { noDecimal: true } },
      ],
    },
    {
      name: 'accounts',
      type: 'auth',
      listRule:   'role = "admin" || @request.auth.id != ""',
      viewRule:   'role = "admin" || @request.auth.id != ""',
      createRule: '',
      updateRule: '',
      deleteRule: '@request.auth.role = "admin"',
      options: {
        allowEmailAuth: true,
        allowOAuth2Auth: false,
        allowUsernameAuth: false,
        requireEmail: true,
        minPasswordLength: 6,
      },
      schema: [
        { name: 'nome', type: 'text', options: { max: 255 } },
        { name: 'cognome', type: 'text', options: { max: 255 } },
        { name: 'role', type: 'select', required: true, options: { maxSelect: 1, values: ['admin','commissario'] } },
        { name: 'commissario', type: 'relation', options: { collectionId: refs.commissari, cascadeDelete: false, maxSelect: 1, minSelect: 0 } },
        { name: 'attivo', type: 'bool', options: {} },
      ],
    },
  ];
}

async function main() {
  console.log(`→ PocketBase: ${PB_URL}`);
  const auth = await api('POST', '/api/admins/auth-with-password', { identity: email, password });
  const token = auth.token;
  console.log('✓ Authenticated');

  const refs = {};
  // First pass: create collections in dependency order (parent → child).
  const order = ['concorsi','commissari','sezioni','categorie','candidati','fasi','candidati_fase','valutazioni','commissioni','accounts'];
  for (const name of order) {
    const cols = buildCollections(refs);
    const def = cols.find(c => c.name === name);

    // Try to find existing
    try {
      const existing = await api('GET', `/api/collections/${name}`, null, token);
      refs[name] = existing.id;
      console.log(`· Skipped (exists): ${name}`);
      continue;
    } catch (_) { /* not found, will create */ }

    try {
      const rec = await api('POST', '/api/collections', def, token);
      refs[name] = rec.id;
      console.log(`✓ Created: ${name}`);
    } catch (e) {
      console.error(`✗ Failed to create ${name}:`, e.message);
      process.exit(2);
    }
  }
  console.log('\nDone. Open the admin UI to verify: ' + PB_URL + '/_/');
}

main().catch(e => {
  console.error('✗', e.message);
  process.exit(1);
});
