#!/usr/bin/env node
// Seed dati di esempio per tutti i tenant del multitenant locale.
// Usage: node scripts/seed-all-tenants.js

const PORTS = {
  ente1: Number(process.env.PORT_ENTE1) || 8091,
  ente2: Number(process.env.PORT_ENTE2) || 8092,
};

// Credenziali da env (con default solo se SEED_ALLOW_DEFAULTS=1).
// Non committare password reali: questo script è per seed di sviluppo locale.
const ALLOW_DEFAULTS = process.env.SEED_ALLOW_DEFAULTS === '1';
const ADMIN = {
  email: process.env.SEED_ADMIN_LOCAL || 'admin',
  pwd: process.env.SEED_ADMIN_PWD || (ALLOW_DEFAULTS ? 'admin123' : null),
};
if (!ADMIN.pwd) {
  console.error('✗ SEED_ADMIN_PWD non impostata. Esporta la password o usa SEED_ALLOW_DEFAULTS=1 per i default insicuri.');
  process.exit(1);
}

async function api(pbUrl, method, path, body, token) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  const res = await fetch(`${pbUrl}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`${method} ${path}: ${data?.message || res.status}`);
  return data;
}

async function login(pbUrl) {
  const email = `${ADMIN.email}@${pbUrl.includes('8092') ? 'ente2' : 'ente1'}.test`;
  const auth = await api(pbUrl, 'POST', '/api/collections/accounts/auth-with-password', {
    identity: email,
    password: ADMIN.pwd,
  });
  return auth.token;
}

async function seedTenant(name, port) {
  const PB = `http://127.0.0.1:${port}`;
  const token = await login(PB);
  console.log(`\n━━━ ${name} (porta ${port}) ━━━`);

  // 1. Concorso
  const nome = name === 'ente1'
    ? 'Concorso Internazionale di Musica 2026'
    : 'Concorso Giovani Talenti 2026';
  const concorso = await api(PB, 'POST', '/api/collections/concorsi/records', {
    nome,
    anno: 2026,
    data_inizio: '2026-06-15',
    stato: 'ATTIVO',
    anonimo: false,
  }, token);
  console.log(`  ✓ Concorso: ${concorso.nome}`);

  // 2. Sezioni
  const sezioni = {};
  for (const [slug, sNome] of [
    ['archi', 'Archi'],
    ['fiati', 'Fiati'],
    ['camera', 'Musica da Camera'],
    ['pianoforte', 'Pianoforte'],
  ]) {
    const s = await api(PB, 'POST', '/api/collections/sezioni/records', {
      concorso: concorso.id,
      nome: sNome,
      ordine: Object.keys(sezioni).length + 1,
    }, token);
    sezioni[slug] = s;
  }
  console.log(`  ✓ ${Object.keys(sezioni).length} sezioni`);

  // 3. Categorie
  const categorie = {};
  const catDefs = [
    { sezione: 'archi', nome: 'Senior (18-30)', ordine: 1 },
    { sezione: 'archi', nome: 'Junior (12-17)', ordine: 2 },
    { sezione: 'fiati', nome: 'Ottoni', ordine: 1 },
    { sezione: 'fiati', nome: 'Legni', ordine: 2 },
    { sezione: 'camera', nome: 'Ensemble', ordine: 1 },
    { sezione: 'pianoforte', nome: 'Senior', ordine: 1 },
    { sezione: 'pianoforte', nome: 'Junior', ordine: 2 },
  ];
  for (const d of catDefs) {
    const c = await api(PB, 'POST', '/api/collections/categorie/records', {
      sezione: sezioni[d.sezione].id,
      nome: d.nome,
      ordine: d.ordine,
    }, token);
    categorie[`${d.sezione}-${d.nome}`] = c;
  }
  console.log(`  ✓ ${catDefs.length} categorie`);

  // 4. Commissari
  const commissariList = [
    { nome: 'Anna', cognome: 'Rossi', specialita: 'Pianoforte', email: 'anna.rossi@esempio.it', is_presidente: true },
    { nome: 'Marco', cognome: 'Bianchi', specialita: 'Violino', email: 'marco.bianchi@esempio.it', is_presidente: false },
    { nome: 'Giulia', cognome: 'Esposito', specialita: 'Composizione', email: 'giulia.esposito@esempio.it', is_presidente: false },
    { nome: 'Franco', cognome: 'Neri', specialita: 'Flauto', email: 'franco.neri@esempio.it', is_presidente: false },
  ];
  const commissari = [];
  for (const d of commissariList) {
    const c = await api(PB, 'POST', '/api/collections/commissari/records', {
      concorso: concorso.id,
      ...d,
      telefono: `+39 ${Math.floor(Math.random() * 9000000000 + 1000000000)}`,
      nazionalita: 'Italiana',
      stato: 'ATTIVO',
    }, token);
    commissari.push(c);
  }
  console.log(`  ✓ ${commissari.length} commissari`);

  // 5. Candidati individuali
  const strumenti = ['Pianoforte', 'Violino', 'Violoncello', 'Flauto', 'Clarinetto', 'Tromba', 'Chitarra', 'Arpa'];
  const nomi = ['Sofia', 'Lorenzo', 'Alessandro', 'Martina', 'Davide', 'Chiara', 'Federico', 'Elena', 'Tommaso', 'Alice', 'Andrea', 'Emma'];
  const cognomi = ['Romano', 'Russo', 'Ferrari', 'Conti', 'Marino', 'Greco', 'Bruno', 'Galli', 'Lombardi', 'Moretti', 'De Luca', 'Costa'];
  const naz = ['Italiana', 'Francese', 'Tedesca', 'Spagnola', 'Giapponese', 'Statunitense', 'Polacca'];

  const candidati = [];
  for (let i = 0; i < 12; i++) {
    const eta = 16 + (i % 12);
    const birthYear = 2026 - eta;
    const month = String((i * 3) % 12 + 1).padStart(2, '0');
    const day = String((i * 7) % 28 + 1).padStart(2, '0');
    const strum = strumenti[i % strumenti.length];

    // Assegna sezione/categoria
    let sezIds = [];
    let catIds = [];
    if (['Violino', 'Violoncello'].includes(strum)) {
      sezIds = [sezioni.archi.id];
      catIds = eta >= 18 ? [categorie['archi-Senior (18-30)'].id] : [categorie['archi-Junior (12-17)'].id];
    } else if (['Flauto', 'Clarinetto'].includes(strum)) {
      sezIds = [sezioni.fiati.id];
      catIds = [categorie['fiati-Legni'].id];
    } else if (['Tromba'].includes(strum)) {
      sezIds = [sezioni.fiati.id];
      catIds = [categorie['fiati-Ottoni'].id];
    } else {
      sezIds = [sezioni.pianoforte.id];
      catIds = eta >= 18 ? [categorie['pianoforte-Senior'].id] : [categorie['pianoforte-Junior'].id];
    }

    const c = await api(PB, 'POST', '/api/collections/candidati/records', {
      concorso: concorso.id,
      numero_candidato: i + 1,
      nome: nomi[i],
      cognome: cognomi[i],
      strumento: strum,
      data_nascita: `${birthYear}-${month}-${day} 00:00:00.000Z`,
      nazionalita: naz[i % naz.length],
      tipo: 'individuale',
      sezioni: sezIds,
      categorie: catIds,
    }, token);
    candidati.push(c);
  }
  console.log(`  ✓ ${candidati.length} candidati individuali`);

  // 6. Gruppi
  // Gruppo 1: Quartetto d'archi
  const quartetto = await api(PB, 'POST', '/api/collections/candidati/records', {
    concorso: concorso.id,
    numero_candidato: candidati.length + 1,
    nome: 'Quartetto d\'Archi Brillante',
    cognome: '',
    strumento: 'Quartetto d\'archi',
    nazionalita: 'Italiana',
    tipo: 'gruppo',
    sezioni: [sezioni.camera.id],
    categorie: [categorie['camera-Ensemble'].id],
  }, token);

  // Aggiungi 4 membri al quartetto
  const membriQuartetto = [
    { idx: 0, strum: 'violino I' },
    { idx: 3, strum: 'violino II' },
    { idx: 6, strum: 'viola' },
    { idx: 9, strum: 'violoncello' },
  ];
  for (const m of membriQuartetto) {
    await api(PB, 'POST', '/api/collections/candidati_gruppo/records', {
      gruppo: quartetto.id,
      candidato: candidati[m.idx].id,
      strumento_gruppo: m.strum,
    }, token);
  }

  // Gruppo 2: Duo flauto e chitarra
  const duo = await api(PB, 'POST', '/api/collections/candidati/records', {
    concorso: concorso.id,
    numero_candidato: candidati.length + 2,
    nome: 'Duo Armonico',
    cognome: '',
    strumento: 'Duo flauto e chitarra',
    nazionalita: 'Italiana',
    tipo: 'gruppo',
    sezioni: [sezioni.camera.id],
    categorie: [categorie['camera-Ensemble'].id],
  }, token);

  await api(PB, 'POST', '/api/collections/candidati_gruppo/records', {
    gruppo: duo.id,
    candidato: candidati[1].id,
    strumento_gruppo: 'flauto',
  }, token);
  await api(PB, 'POST', '/api/collections/candidati_gruppo/records', {
    gruppo: duo.id,
    candidato: candidati[4].id,
    strumento_gruppo: 'chitarra',
  }, token);

  console.log(`  ✓ 2 gruppi (Quartetto + Duo)`);

  // 7. Fasi
  const fasiData = [
    { nome: 'Eliminatoria', ordine: 1, scala: 10, modo: 'autonoma', ammessi: 6 },
    { nome: 'Semifinale', ordine: 2, scala: 10, modo: 'autonoma', ammessi: 3 },
    { nome: 'Finale', ordine: 3, scala: 10, modo: 'sincrona' },
  ];
  for (const f of fasiData) {
    await api(PB, 'POST', '/api/collections/fasi/records', {
      concorso: concorso.id,
      ...f,
      stato: 'PIANIFICATA',
      commissari_ids: commissari.map(x => x.id),
      criteri: [
        { key: 'tecnica', label: 'Tecnica', peso: 0.35 },
        { key: 'interpretazione', label: 'Interpretazione', peso: 0.35 },
        { key: 'intonazione', label: 'Intonazione', peso: 0.15 },
        { key: 'musicalita', label: 'Musicalità', peso: 0.15 },
      ],
    }, token);
  }
  console.log(`  ✓ ${fasiData.length} fasi`);

  // 8. Rinomina admin con nome reale
  await api(PB, 'PATCH', `/api/collections/accounts/records?filter=role%3D%22admin%22&perPage=1`, {}, token).catch(() => {});
  console.log(`  ✓ Completato\n`);
}

async function main() {
  // Verifica che tutti i PB siano raggiungibili
  for (const [name, port] of Object.entries(PORTS)) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/api/health`);
      if (!res.ok) throw new Error('unhealthy');
    } catch {
      console.error(`✗ PB ${name} (porta ${port}) non raggiungibile. Avvia i server.`);
      process.exit(1);
    }
  }

  await seedTenant('ente1', PORTS.ente1);
  await seedTenant('ente2', PORTS.ente2);

  console.log('✅ Dati di esempio creati per tutti i tenant.');
}

main().catch(e => { console.error('✗', e.message); process.exit(1); });