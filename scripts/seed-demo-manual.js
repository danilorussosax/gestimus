// scripts/seed-demo-manual.js
//
// Seed dati minimi per il manuale admin (screenshot in docs/screenshots/).
// Idempotente: non duplica record se già presenti.
//
// Crea/garantisce su `ente1` (http://ente1.test:8000):
//   - 1 concorso ATTIVO "Concorso Internazionale di Musica 2026"
//   - 3 sezioni: Pianoforte / Archi / Sezione IV – Solisti Fiati
//   - 4 commissari (con un presidente)
//   - 2 commissioni (Archi, Fiati)
//   - Fasi: Pianoforte → Eliminatoria+Semifinale+Finale, Archi → Elim+Finale, Fiati → Fase Unica
//   - 10 candidati distribuiti tra le sezioni
//   - 1 account commissario (commissario@demo.local / Demo1234!)
//   - Sposta la "Eliminatoria" di Pianoforte in IN_CORSO con relativi candidati_fase
//
// Uso:
//   PB_BASE=http://ente1.test:8000 ADMIN_EMAIL=admin@ente1.test ADMIN_PWD=admin123 \
//     node scripts/seed-demo-manual.js

const BASE = process.env.PB_BASE || 'http://ente1.test:8000';
const ADMIN_EMAIL = process.env.ADMIN_EMAIL || 'admin@ente1.test';
const ADMIN_PWD = process.env.ADMIN_PWD || 'admin123';

let TOKEN = null;

async function api(method, path, body) {
  const headers = { 'Content-Type': 'application/json' };
  if (TOKEN) headers.Authorization = TOKEN;
  const r = await fetch(`${BASE}${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) {
    throw new Error(`${method} ${path} → ${r.status}: ${JSON.stringify(data)}`);
  }
  return data;
}

async function listAll(collection, filter = '') {
  const out = [];
  let page = 1;
  while (true) {
    const q = filter ? `&filter=${encodeURIComponent(filter)}` : '';
    const r = await api('GET', `/api/collections/${collection}/records?perPage=200&page=${page}${q}`);
    out.push(...r.items);
    if (r.items.length < 200) break;
    page++;
  }
  return out;
}

async function findOrCreate(collection, matchFn, payload) {
  const all = await listAll(collection);
  const found = all.find(matchFn);
  if (found) return { rec: found, created: false };
  const rec = await api('POST', `/api/collections/${collection}/records`, payload);
  return { rec, created: true };
}

async function ensureFase({ concorsoId, sezioneId, nome, ordine, ammessi, scala = 10, modoVal = 'autonoma', metodoMedia = 'olimpica' }) {
  const all = await listAll('fasi', `concorso="${concorsoId}"`);
  const sigOk = (f) => Array.isArray(f.sezioni) && f.sezioni.length === 1 && f.sezioni[0] === sezioneId;
  let found = all.find((f) => f.nome === nome && sigOk(f));
  if (found) return { rec: found, created: false };
  const criteri = [
    { key: 'tecnica', label: 'Tecnica', peso: 0.35 },
    { key: 'interpretazione', label: 'Interpretazione', peso: 0.35 },
    { key: 'intonazione', label: 'Intonazione', peso: 0.15 },
    { key: 'musicalita', label: 'Musicalità', peso: 0.15 },
  ];
  const payload = {
    concorso: concorsoId,
    ordine,
    nome,
    ammessi: ammessi ?? null,
    scala,
    modo_valutazione: modoVal,
    metodo_media: metodoMedia,
    criteri,
    pesi: null,
    sezioni: [sezioneId],
    stato: 'PIANIFICATA',
    tempo_minuti: 0,
  };
  const rec = await api('POST', '/api/collections/fasi/records', payload);
  return { rec, created: true };
}

async function ensureCandidato({ concorsoId, numero, nome, cognome, strumento, sezioneId }) {
  const all = await listAll('candidati', `concorso="${concorsoId}"`);
  let found = all.find((c) => c.nome === nome && c.cognome === cognome);
  if (found) {
    // garantisce assegnazione sezione
    const sezioni = Array.isArray(found.sezioni) ? found.sezioni : [];
    if (sezioneId && !sezioni.includes(sezioneId)) {
      sezioni.push(sezioneId);
      await api('PATCH', `/api/collections/candidati/records/${found.id}`, { sezioni });
    }
    return { rec: found, created: false };
  }
  const rec = await api('POST', '/api/collections/candidati/records', {
    concorso: concorsoId,
    numero_candidato: numero,
    nome,
    cognome,
    strumento,
    nazionalita: 'Italiana',
    docenti_preparatori: [],
    sezioni: sezioneId ? [sezioneId] : [],
    categorie: [],
    tipo: 'individuale',
  });
  return { rec, created: true };
}

async function ensureCandidatoFase({ faseId, candidatoId, posizione }) {
  const all = await listAll('candidati_fase', `fase="${faseId}" && candidato="${candidatoId}"`);
  if (all.length) return { rec: all[0], created: false };
  const rec = await api('POST', '/api/collections/candidati_fase/records', {
    fase: faseId,
    candidato: candidatoId,
    posizione,
    stato: 'IN_ATTESA',
    ammesso_prossima_fase: false,
  });
  return { rec, created: true };
}

async function ensureCommissarioAccount({ email, password, nome, cognome, commissarioId }) {
  const all = await listAll('accounts');
  const found = all.find((a) => a.email === email);
  if (found) {
    if (commissarioId && found.commissario !== commissarioId) {
      await api('PATCH', `/api/collections/accounts/records/${found.id}`, { commissario: commissarioId, role: 'commissario', attivo: true });
    }
    return { rec: found, created: false };
  }
  // La createRule di `accounts` è null (solo superuser PB). Autentichiamoci come
  // PB admin per creare l'account commissario.
  const pbAdminEmail = process.env.PB_ADMIN_EMAIL || 'root@local.test';
  const pbAdminPwd = process.env.PB_ADMIN_PWD || 'Admin1234!';
  const pbAdminAuth = await fetch(`${BASE}/api/admins/auth-with-password`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ identity: pbAdminEmail, password: pbAdminPwd }),
  });
  if (!pbAdminAuth.ok) {
    console.warn(`  ⚠ PB admin auth fallita (${pbAdminAuth.status}). Salto creazione account commissario.`);
    return { rec: null, created: false, skipped: true };
  }
  const pbAdminData = await pbAdminAuth.json();
  const r = await fetch(`${BASE}/api/collections/accounts/records`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: pbAdminData.token },
    body: JSON.stringify({
      email,
      password,
      passwordConfirm: password,
      nome,
      cognome,
      role: 'commissario',
      commissario: commissarioId || '',
      attivo: true,
      emailVisibility: true,
    }),
  });
  const data = await r.json();
  if (!r.ok) throw new Error(`account create: ${r.status} ${JSON.stringify(data)}`);
  return { rec: data, created: true };
}

async function main() {
  console.log(`→ Seed demo manuale su ${BASE}`);
  const auth = await api('POST', '/api/collections/accounts/auth-with-password', {
    identity: ADMIN_EMAIL,
    password: ADMIN_PWD,
  });
  TOKEN = auth.token;
  console.log('✓ Auth admin OK');

  // 1) Concorso
  const concorsi = await listAll('concorsi');
  let concorso = concorsi.find((c) => c.stato === 'ATTIVO') || concorsi[0];
  if (!concorso) {
    concorso = await api('POST', '/api/collections/concorsi/records', {
      nome: 'Concorso Internazionale di Musica 2026',
      anno: 2026,
      stato: 'ATTIVO',
      iscrizioni_aperte: true,
    });
    console.log('+ concorso creato');
  } else {
    console.log(`· concorso esistente: ${concorso.nome}`);
  }
  const concorsoId = concorso.id;

  // 2) Sezioni
  const sezioniDef = [
    { nome: 'Pianoforte', ordine: 1 },
    { nome: 'Archi', ordine: 2 },
    { nome: 'Sezione IV – Solisti Fiati', ordine: 3 },
  ];
  const sezioniIds = {};
  for (const s of sezioniDef) {
    const { rec, created } = await findOrCreate('sezioni',
      (r) => r.concorso === concorsoId && r.nome === s.nome,
      { concorso: concorsoId, nome: s.nome, ordine: s.ordine },
    );
    sezioniIds[s.nome] = rec.id;
    console.log(`${created ? '+' : '·'} sezione ${s.nome}`);
  }

  // 3) Commissari
  const commDef = [
    { nome: 'Anna', cognome: 'Rossi', specialita: 'Pianoforte', email: 'anna.rossi@esempio.it', presidente: true },
    { nome: 'Marco', cognome: 'Bianchi', specialita: 'Violino', email: 'marco.bianchi@esempio.it' },
    { nome: 'Giulia', cognome: 'Esposito', specialita: 'Composizione', email: 'giulia.esposito@esempio.it' },
    { nome: 'Franco', cognome: 'Neri', specialita: 'Flauto', email: 'franco.neri@esempio.it' },
  ];
  const commsIds = {};
  for (const c of commDef) {
    const { rec, created } = await findOrCreate('commissari',
      (r) => r.concorso === concorsoId && r.nome === c.nome && r.cognome === c.cognome,
      {
        concorso: concorsoId,
        nome: c.nome,
        cognome: c.cognome,
        specialita: c.specialita,
        email: c.email,
        nazionalita: 'Italiana',
        stato: 'ATTIVO',
        is_presidente: !!c.presidente,
      },
    );
    commsIds[`${c.nome}_${c.cognome}`] = rec.id;
    console.log(`${created ? '+' : '·'} commissario ${c.nome} ${c.cognome}${c.presidente ? ' (presidente)' : ''}`);
  }

  // 4) Commissioni
  const commArchi = await findOrCreate('commissioni',
    (r) => r.concorso === concorsoId && r.nome === 'Commissione Archi',
    {
      concorso: concorsoId,
      nome: 'Commissione Archi',
      commissari: [commsIds.Anna_Rossi, commsIds.Marco_Bianchi, commsIds.Giulia_Esposito],
      sezioni: [sezioniIds.Archi],
      include_tutte_categorie: true,
      presidente: commsIds.Anna_Rossi,
    },
  );
  if (!commArchi.created && !commArchi.rec.presidente) {
    await api('PATCH', `/api/collections/commissioni/records/${commArchi.rec.id}`, { presidente: commsIds.Anna_Rossi });
  }
  console.log(`${commArchi.created ? '+' : '·'} commissione Archi`);
  const commFiati = await findOrCreate('commissioni',
    (r) => r.concorso === concorsoId && r.nome === 'Commissione Fiati',
    {
      concorso: concorsoId,
      nome: 'Commissione Fiati',
      commissari: [commsIds.Anna_Rossi, commsIds.Franco_Neri, commsIds.Giulia_Esposito],
      sezioni: [sezioniIds['Sezione IV – Solisti Fiati']],
      include_tutte_categorie: true,
      presidente: commsIds.Anna_Rossi,
    },
  );
  if (!commFiati.created && !commFiati.rec.presidente) {
    await api('PATCH', `/api/collections/commissioni/records/${commFiati.rec.id}`, { presidente: commsIds.Anna_Rossi });
  }
  console.log(`${commFiati.created ? '+' : '·'} commissione Fiati`);

  // 5) Fasi
  // Pianoforte (richiesto: 3 sotto-fasi per la vista raggruppata)
  const fasePianoElim = await ensureFase({ concorsoId, sezioneId: sezioniIds.Pianoforte, nome: 'Eliminatoria', ordine: 10, ammessi: 6 });
  await ensureFase({ concorsoId, sezioneId: sezioniIds.Pianoforte, nome: 'Semifinale', ordine: 11, ammessi: 3 });
  await ensureFase({ concorsoId, sezioneId: sezioniIds.Pianoforte, nome: 'Finale', ordine: 12, ammessi: null });
  console.log(`${fasePianoElim.created ? '+' : '·'} fasi Pianoforte garantite`);

  // 6) Candidati: 10 totali sparsi su sezioni
  const candidatiDef = [
    { nome: 'Lorenzo',     cognome: 'Russo',     strumento: 'Violino',     sez: 'Archi' },
    { nome: 'Alessandro',  cognome: 'Ferrari',   strumento: 'Violoncello', sez: 'Archi' },
    { nome: 'Martina',     cognome: 'Conti',     strumento: 'Flauto',      sez: 'Sezione IV – Solisti Fiati' },
    { nome: 'Davide',      cognome: 'Marino',    strumento: 'Clarinetto',  sez: 'Sezione IV – Solisti Fiati' },
    { nome: 'Federico',    cognome: 'Bruno',     strumento: 'Pianoforte',  sez: 'Pianoforte' },
    { nome: 'Sofia',       cognome: 'Greco',     strumento: 'Pianoforte',  sez: 'Pianoforte' },
    { nome: 'Beatrice',    cognome: 'Romano',    strumento: 'Pianoforte',  sez: 'Pianoforte' },
    { nome: 'Tommaso',     cognome: 'Galli',     strumento: 'Pianoforte',  sez: 'Pianoforte' },
    { nome: 'Elena',       cognome: 'Costa',     strumento: 'Violino',     sez: 'Archi' },
    { nome: 'Luca',        cognome: 'Moretti',   strumento: 'Oboe',        sez: 'Sezione IV – Solisti Fiati' },
  ];
  const candidatiIds = {};
  let numero = 1;
  for (const c of candidatiDef) {
    const { rec, created } = await ensureCandidato({
      concorsoId,
      numero: numero++,
      nome: c.nome,
      cognome: c.cognome,
      strumento: c.strumento,
      sezioneId: sezioniIds[c.sez],
    });
    candidatiIds[`${c.nome}_${c.cognome}`] = rec.id;
    console.log(`${created ? '+' : '·'} candidato ${c.nome} ${c.cognome}`);
  }

  // 7) Eliminatoria Pianoforte in IN_CORSO con candidati_fase
  // Aggiungi solo i candidati della sezione Pianoforte
  const pianoCandidates = candidatiDef.filter((c) => c.sez === 'Pianoforte');
  let pos = 1;
  for (const c of pianoCandidates) {
    await ensureCandidatoFase({
      faseId: fasePianoElim.rec.id,
      candidatoId: candidatiIds[`${c.nome}_${c.cognome}`],
      posizione: pos++,
    });
  }
  console.log(`· candidati_fase Eliminatoria Pianoforte: ${pos - 1}`);

  // Aggiungi commissione Pianoforte (Anna, Marco, Giulia) alla fase se manca
  const pianoCommissione = await findOrCreate('commissioni',
    (r) => r.concorso === concorsoId && r.nome === 'Commissione Pianoforte',
    {
      concorso: concorsoId,
      nome: 'Commissione Pianoforte',
      commissari: [commsIds.Anna_Rossi, commsIds.Marco_Bianchi, commsIds.Giulia_Esposito],
      sezioni: [sezioniIds.Pianoforte],
      include_tutte_categorie: true,
      presidente: commsIds.Anna_Rossi,
    },
  );
  if (!pianoCommissione.created && !pianoCommissione.rec.presidente) {
    await api('PATCH', `/api/collections/commissioni/records/${pianoCommissione.rec.id}`, { presidente: commsIds.Anna_Rossi });
  }
  console.log(`${pianoCommissione.created ? '+' : '·'} commissione Pianoforte`);

  // Sposta in IN_CORSO con commissione assegnata
  await api('PATCH', `/api/collections/fasi/records/${fasePianoElim.rec.id}`, {
    stato: 'IN_CORSO',
    commissione: pianoCommissione.rec.id,
  });
  console.log('· Eliminatoria Pianoforte → IN_CORSO');

  // 8) Account commissario per login
  const annaCommId = commsIds.Anna_Rossi;
  await ensureCommissarioAccount({
    email: 'commissario@demo.local',
    password: 'Demo1234!',
    nome: 'Anna',
    cognome: 'Rossi',
    commissarioId: annaCommId,
  });
  console.log('· account commissario@demo.local (Demo1234!)');

  console.log('\n✓ Seed completato.');
  console.log(`  - Admin: ${ADMIN_EMAIL} / ${ADMIN_PWD}`);
  console.log('  - Commissario: commissario@demo.local / Demo1234!');
}

main().catch((e) => {
  console.error('✗', e.message);
  process.exit(1);
});
