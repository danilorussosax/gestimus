import 'dotenv/config';
import { sql } from 'drizzle-orm';
import { dbSuper, shutdownPools } from '../src/db/client.js';
import {
  accounts,
  auditLog,
  candidati,
  candidatiFase,
  candidatiMembri,
  categorie,
  commissari,
  commissioni,
  commissioniCategorie,
  commissioniCommissari,
  commissioniSezioni,
  concorsi,
  criteri,
  fasi,
  fasiSezioni,
  iscrizioni,
  sezioni,
  tenants,
  valutazioni,
} from '../src/db/schema.js';
import { hashPassword } from '../src/services/password.js';

/**
 * Seed "screenshot": popola il tenant `ente1` con un concorso DEMO completo,
 * pensato per coprire tutte le 24 schermate del manuale amministratore
 * (docs/manuale-admin.md) generate da scripts/take-screenshots.mjs.
 *
 * Crea:
 *  - 1 concorso ATTIVO (iscrizioni aperte) con default tiebreak
 *  - 4 sezioni (Pianoforte, Archi, Fiati, Canto) + categorie
 *    · Canto resta SENZA fasi → mostra il wizard "Configura fasi"
 *  - 6 commissari (Anna Conti = presidente, legata all'account commissario)
 *  - 2 commissioni con presidente
 *  - Fasi raggruppate per sezione:
 *    · Pianoforte: Eliminatoria (CONCLUSA, con voti) → Semifinale (IN_CORSO,
 *      scala 25 = DRIFT) → Finale (PIANIFICATA)
 *    · Archi: Eliminatoria + Finale (PIANIFICATA)
 *    · Fiati: Eliminatoria + Semifinale + Finale (PIANIFICATA)
 *  - 4 criteri per fase (Tecnica/Interpretazione/Intonazione/Musicalità)
 *  - ~11 candidati (incl. 1 gruppo)
 *  - candidati_fase + valutazioni per la fase CONCLUSA (classifica/podio/verbale)
 *  - iscrizioni in stati misti (INVIATA/EMAIL_VERIFICATA/APPROVATA/RIFIUTATA)
 *
 * È DISTRUTTIVO sul solo tenant `ente1`: cancella i suoi concorsi (cascade) e
 * ricostruisce. Non tocca platform/ente2. Idempotente per riesecuzione.
 *
 * Uso:  cd server && npx tsx scripts/seed-screenshots.ts
 */

const DEMO_PASSWORDS = {
  admin: 'Admin123!',
  commissario: 'Demo123!',
} as const;

// Criteri standard di fase. La `key` usata nelle valutazioni = slugify(nome)
// (vedi frontend/src/lib/scoring.ts criteriFromRecords/slugifyKey).
const CRITERI_STD: Array<{ nome: string; key: string; peso: number }> = [
  { nome: 'Tecnica', key: 'tecnica', peso: 35 },
  { nome: 'Interpretazione', key: 'interpretazione', peso: 35 },
  { nome: 'Intonazione', key: 'intonazione', peso: 15 },
  { nome: 'Musicalità', key: 'musicalita', peso: 15 },
];

const clamp = (n: number, min: number, max: number) => Math.max(min, Math.min(max, n));
const round1 = (n: number) => Math.round(n * 10) / 10;

async function main() {
  console.log('📸 Seed screenshot (tenant ente1)...');

  // ── Tenant ente1 ───────────────────────────────────────────────────────────
  const ente1 = await dbSuper.query.tenants.findFirst({
    where: (t, { eq }) => eq(t.slug, 'ente1'),
  });
  if (!ente1) {
    throw new Error("Tenant 'ente1' non trovato. Esegui prima `npm run db:seed`.");
  }
  const tenantId = ente1.id;

  // Branding ente per le schermate pre-login / header.
  await dbSuper
    .update(tenants)
    .set({
      nome: 'Conservatorio Demo Milano',
      brandingPublic: {
        nomePubblico: 'Conservatorio Demo Milano',
        sottotitolo: 'Concorsi e audizioni musicali',
        coloreAccent: '#7c3aed',
        coloreSfondo: '#0f172a',
      },
      enteSettings: {
        email: 'segreteria@conservatoriodemo.it',
        telefono: '+39 02 1234567',
        sede: 'Via della Musica 1, Milano',
        sitoWeb: 'https://conservatoriodemo.example',
      },
    })
    .where(sql`${tenants.id} = ${tenantId}`);

  // ── Account admin + commissario (assicura esistano) ─────────────────────────
  const adminHash = await hashPassword(DEMO_PASSWORDS.admin);
  const commissarioHash = await hashPassword(DEMO_PASSWORDS.commissario);
  const adminAccount = await ensureAccount(tenantId, 'admin@ente1.test', adminHash, 'admin');
  const commissarioAccount = await ensureAccount(
    tenantId,
    'commissario@ente1.test',
    commissarioHash,
    'commissario',
  );

  // ── Wipe concorsi del tenant (cascade) ──────────────────────────────────────
  // Stacca prima il binding account→commissario per evitare FK dangling.
  await dbSuper
    .update(accounts)
    .set({ commissarioId: null })
    .where(sql`${accounts.tenantId} = ${tenantId}`);
  await dbSuper.execute(sql`DELETE FROM concorsi WHERE tenant_id = ${tenantId}`);
  console.log('  ✓ concorsi ente1 azzerati');

  // ── Concorso ─────────────────────────────────────────────────────────────────
  const [concorso] = await dbSuper
    .insert(concorsi)
    .values({
      tenantId,
      nome: 'Concorso Internazionale Demo 2026',
      anno: 2026,
      dataInizio: '2026-09-14',
      stato: 'ATTIVO',
      anonimo: false,
      iscrizioniAperte: true,
      iscrizioniScadenza: '2026-08-31',
      defaultTiebreakStrategy: [
        { key: 'scomposizione', enabled: true },
        { key: 'presidente', enabled: true },
        { key: 'eta', enabled: true },
        { key: 'ex_aequo', enabled: true },
      ],
    })
    .returning();
  const concorsoId = concorso!.id;
  console.log('  ✓ concorso creato');

  // ── Sezioni + categorie ──────────────────────────────────────────────────────
  const sezPiano = await mkSezione(tenantId, concorsoId, 'Pianoforte', 'Pianoforte solista', 1);
  const sezArchi = await mkSezione(tenantId, concorsoId, 'Archi', 'Violino, viola, violoncello', 2);
  const sezFiati = await mkSezione(tenantId, concorsoId, 'Fiati', 'Legni e ottoni', 3);
  const sezCanto = await mkSezione(tenantId, concorsoId, 'Canto', 'Canto lirico (senza fasi: demo wizard)', 4);

  const catPianoJr = await mkCategoria(tenantId, sezPiano, 'Junior', 'Fino a 14 anni', 0, 14, 1);
  const catPianoSr = await mkCategoria(tenantId, sezPiano, 'Senior', 'Dai 15 anni', 15, 30, 2);
  await mkCategoria(tenantId, sezArchi, 'Junior', 'Fino a 14 anni', 0, 14, 1);
  const catArchiSr = await mkCategoria(tenantId, sezArchi, 'Senior', 'Dai 15 anni', 15, 30, 2);
  const catArchiCam = await mkCategoria(tenantId, sezArchi, 'Cameristica', 'Gruppi e ensemble', 0, 99, 3);
  await mkCategoria(tenantId, sezFiati, 'Junior', 'Fino a 14 anni', 0, 14, 1);
  const catFiatiSr = await mkCategoria(tenantId, sezFiati, 'Senior', 'Dai 15 anni', 15, 30, 2);
  await mkCategoria(tenantId, sezCanto, 'Lirica', 'Canto lirico', 16, 35, 1);
  console.log('  ✓ 4 sezioni + categorie');

  // ── Commissari ────────────────────────────────────────────────────────────────
  const com = await mkCommissari(tenantId, concorsoId, [
    ['Anna', 'Conti', 'Pianoforte', 'anna.conti@demo.it', 'Italiana', '1968-04-12'],
    ['Bruno', 'Ricci', 'Pianoforte', 'bruno.ricci@demo.it', 'Italiana', '1972-11-03'],
    ['Carla', 'Moret', 'Composizione', 'carla.moret@demo.fr', 'Francese', '1965-06-21'],
    ['David', 'Hahn', 'Violino', 'david.hahn@demo.de', 'Tedesca', '1970-02-17'],
    ['Elena', 'Ros', 'Violoncello', 'elena.ros@demo.es', 'Spagnola', '1975-09-30'],
    ['Marco', 'Sala', 'Flauto', 'marco.sala@demo.it', 'Italiana', '1969-12-08'],
  ]);
  const [anna, bruno, carla, david, elena] = com;
  // Bio per qualche commissario (badge "bio" sulla card).
  await dbSuper
    .update(commissari)
    .set({ bio: 'Diplomata al Conservatorio di Milano, concertista e docente. Membro di giurie internazionali.' })
    .where(sql`${commissari.id} = ${anna!.id}`);

  // Lega l'account commissario ad Anna (presidente).
  await dbSuper
    .update(accounts)
    .set({ commissarioId: anna!.id })
    .where(sql`${accounts.id} = ${commissarioAccount.id}`);
  console.log('  ✓ 6 commissari (Anna = presidente, legata all’account)');

  // ── Commissioni ────────────────────────────────────────────────────────────────
  const giuriaPiano = await mkCommissione(
    tenantId,
    concorsoId,
    'Giuria Pianoforte',
    anna!.id,
    [anna!.id, bruno!.id, carla!.id],
    [sezPiano],
    [catPianoJr, catPianoSr],
  );
  const giuriaArchi = await mkCommissione(
    tenantId,
    concorsoId,
    'Giuria Archi',
    david!.id,
    [david!.id, elena!.id, carla!.id],
    [sezArchi],
    [catArchiSr, catArchiCam],
  );
  console.log('  ✓ 2 commissioni con presidente');

  // ── Candidati ────────────────────────────────────────────────────────────────
  // Pianoforte (6, per la fase CONCLUSA) + Archi (2 + 1 gruppo) + Fiati (2) + Canto (1)
  let n = 0;
  const next = () => ++n;
  const cPiano = await mkCandidati(tenantId, concorsoId, sezPiano, catPianoSr, [
    [next(), 'Sofia', 'Greco', 'Pianoforte', '2004-03-15', 'Italiana'],
    [next(), 'Liam', 'Novak', 'Pianoforte', '2003-07-22', 'Ceca'],
    [next(), 'Yuki', 'Tanaka', 'Pianoforte', '2005-01-09', 'Giapponese'],
    [next(), 'Marta', 'Russo', 'Pianoforte', '2004-11-30', 'Italiana'],
    [next(), 'Pawel', 'Kowal', 'Pianoforte', '2003-05-18', 'Polacca'],
    [next(), 'Chiara', 'Fontana', 'Pianoforte', '2005-08-02', 'Italiana'],
  ]);
  await mkCandidati(tenantId, concorsoId, sezArchi, catArchiSr, [
    [next(), 'Diego', 'Marin', 'Violino', '2004-02-11', 'Italiana'],
    [next(), 'Hannah', 'Berg', 'Violoncello', '2003-10-25', 'Tedesca'],
  ]);
  // Candidato gruppo (quartetto) in Archi/Cameristica.
  const [quartetto] = await mkCandidati(tenantId, concorsoId, sezArchi, catArchiCam, [
    [next(), 'Quartetto Aurora', '', "Quartetto d'archi", '', ''],
  ], { isGruppo: true, gruppoNome: 'Quartetto Aurora' });
  await dbSuper.insert(candidatiMembri).values([
    { tenantId, candidatoId: quartetto!.id, nome: 'Giulia', cognome: 'Pini', strumento: 'Violino I', dataNascita: '2002-04-01' },
    { tenantId, candidatoId: quartetto!.id, nome: 'Tomas', cognome: 'Vit', strumento: 'Violino II', dataNascita: '2003-06-12' },
    { tenantId, candidatoId: quartetto!.id, nome: 'Sara', cognome: 'Lo', strumento: 'Viola', dataNascita: '2002-09-19' },
    { tenantId, candidatoId: quartetto!.id, nome: 'Iván', cognome: 'Soto', strumento: 'Violoncello', dataNascita: '2001-12-05' },
  ]);
  await mkCandidati(tenantId, concorsoId, sezFiati, catFiatiSr, [
    [next(), 'Noah', 'Klein', 'Clarinetto', '2004-06-14', 'Austriaca'],
    [next(), 'Aiko', 'Mori', 'Flauto', '2005-03-28', 'Giapponese'],
  ]);
  await mkCandidati(tenantId, concorsoId, sezCanto, null, [
    [next(), 'Valentina', 'Costa', 'Soprano', '2000-07-07', 'Italiana'],
  ]);
  console.log(`  ✓ ${n} candidati (incl. 1 gruppo con membri)`);

  // ── Fasi ────────────────────────────────────────────────────────────────────
  // Pianoforte: Eliminatoria CONCLUSA → Semifinale IN_CORSO (scala 25 drift) → Finale
  // NB: creata IN_CORSO per poter inserire le valutazioni (un trigger DB blocca
  // le scritture su valutazioni quando la fase è CONCLUSA). Viene chiusa a fine seed.
  const pElim = await mkFase(tenantId, concorsoId, {
    ordine: 1, nome: 'Eliminatoria', stato: 'IN_CORSO', scala: 10, ammessi: 3,
    commissioneId: giuriaPiano, sezioni: [sezPiano], dataPrevista: '2026-09-14',
    metodoMedia: 'aritmetica', modoValutazione: 'autonoma', tempoMinuti: 15,
  });
  const pSemi = await mkFase(tenantId, concorsoId, {
    ordine: 2, nome: 'Semifinale', stato: 'IN_CORSO', scala: 25, ammessi: 2,
    commissioneId: giuriaPiano, sezioni: [sezPiano], dataPrevista: '2026-09-15',
    metodoMedia: 'mediana', modoValutazione: 'sincrona', tempoMinuti: 25,
  });
  await mkFase(tenantId, concorsoId, {
    ordine: 3, nome: 'Finale', stato: 'PIANIFICATA', scala: 10, ammessi: null,
    commissioneId: giuriaPiano, sezioni: [sezPiano], dataPrevista: '2026-09-16',
    metodoMedia: 'aritmetica', modoValutazione: 'sincrona', tempoMinuti: 30,
  });
  // Archi
  await mkFase(tenantId, concorsoId, {
    ordine: 4, nome: 'Eliminatoria', stato: 'PIANIFICATA', scala: 10, ammessi: 4,
    commissioneId: giuriaArchi, sezioni: [sezArchi], dataPrevista: '2026-09-14',
    metodoMedia: 'aritmetica', modoValutazione: 'autonoma', tempoMinuti: 15,
  });
  await mkFase(tenantId, concorsoId, {
    ordine: 5, nome: 'Finale', stato: 'PIANIFICATA', scala: 10, ammessi: null,
    commissioneId: giuriaArchi, sezioni: [sezArchi], dataPrevista: '2026-09-16',
    metodoMedia: 'aritmetica', modoValutazione: 'sincrona', tempoMinuti: 30,
  });
  // Fiati
  for (const [i, [nome, scala]] of (
    [['Eliminatoria', 10], ['Semifinale', 10], ['Finale', 10]] as Array<[string, number]>
  ).entries()) {
    await mkFase(tenantId, concorsoId, {
      ordine: 6 + i, nome, stato: 'PIANIFICATA', scala, ammessi: i === 2 ? null : 3,
      commissioneId: null, sezioni: [sezFiati], dataPrevista: '2026-09-15',
      metodoMedia: 'aritmetica', modoValutazione: 'autonoma', tempoMinuti: 15,
    });
  }
  console.log('  ✓ fasi: Pianoforte(3) Archi(2) Fiati(3); Canto vuota (wizard)');

  // ── candidati_fase + valutazioni per Eliminatoria Pianoforte (CONCLUSA) ──────
  // Voti decrescenti → classifica chiara. 3 commissari (Anna/Bruno/Carla).
  const giuria = [anna!.id, bruno!.id, carla!.id];
  const comOffset: Record<string, number> = { [anna!.id]: 0.1, [bruno!.id]: 0.0, [carla!.id]: -0.1 };
  const critOffset: Record<string, number> = { tecnica: 0.2, interpretazione: 0.0, intonazione: -0.1, musicalita: -0.1 };
  const bases = [9.2, 8.7, 8.3, 7.6, 7.0, 6.4];

  const elimValutazioni: Array<typeof valutazioni.$inferInsert> = [];
  for (let i = 0; i < cPiano.length; i++) {
    const cand = cPiano[i]!;
    const [cf] = await dbSuper
      .insert(candidatiFase)
      .values({
        tenantId,
        faseId: pElim,
        candidatoId: cand.id,
        posizione: i + 1,
        stato: 'COMPLETATO',
        ammessoProssimaFase: i < 3,
      })
      .returning();
    const base = bases[i]!;
    for (const comId of giuria) {
      for (const c of CRITERI_STD) {
        const voto = round1(clamp(base + (comOffset[comId] ?? 0) + (critOffset[c.key] ?? 0), 0, 10));
        elimValutazioni.push({
          tenantId,
          candidatoFaseId: cf!.id,
          commissarioId: comId,
          criterio: c.key,
          voto,
        });
      }
    }
  }
  await dbSuper.insert(valutazioni).values(elimValutazioni);
  // Ora chiudi la fase (freeze): le valutazioni diventano immutabili.
  await dbSuper.update(fasi).set({ stato: 'CONCLUSA' }).where(sql`${fasi.id} = ${pElim}`);
  console.log(`  ✓ Eliminatoria Pianoforte: 6 candidati_fase + ${elimValutazioni.length} valutazioni → CONCLUSA`);

  // Semifinale IN_CORSO: i 3 ammessi entrano in fase. Votano SOLO Bruno e Carla,
  // NON Anna (= account commissario): così la sua vista mostra la scheda di
  // valutazione del candidato corrente, e i Risultati mostrano medie provvisorie
  // (non zero). Scala 25.
  const semiVotanti = [bruno!.id, carla!.id];
  const semiBases = [21, 19, 17];
  const semiValutazioni: Array<typeof valutazioni.$inferInsert> = [];
  for (let i = 0; i < 3; i++) {
    const [cf] = await dbSuper
      .insert(candidatiFase)
      .values({
        tenantId,
        faseId: pSemi,
        candidatoId: cPiano[i]!.id,
        posizione: i + 1,
        stato: i === 0 ? 'IN_ESECUZIONE' : 'IN_ATTESA',
      })
      .returning();
    const base = semiBases[i]!;
    for (const comId of semiVotanti) {
      for (const c of CRITERI_STD) {
        const voto = round1(clamp(base + (comOffset[comId] ?? 0) * 2 + (critOffset[c.key] ?? 0) * 2, 0, 25));
        semiValutazioni.push({ tenantId, candidatoFaseId: cf!.id, commissarioId: comId, criterio: c.key, voto });
      }
    }
  }
  await dbSuper.insert(valutazioni).values(semiValutazioni);
  console.log(`  ✓ Semifinale Pianoforte: 3 candidati_fase (IN_CORSO) + ${semiValutazioni.length} valutazioni (Bruno+Carla)`);

  // ── Iscrizioni (stati misti) ─────────────────────────────────────────────────
  const gdpr = { privacy: true, regolamento: true, immagini: true };
  await dbSuper.insert(iscrizioni).values([
    {
      tenantId, concorsoId, stato: 'INVIATA', nome: 'Giorgio', cognome: 'Bianchi',
      email: 'giorgio.bianchi@demo.it', telefono: '+39 333 1112222', dataNascita: '2006-05-10',
      nazionalita: 'Italiana', strumento: 'Pianoforte', sezioneId: sezPiano, categoriaId: catPianoJr,
      consensiGdpr: gdpr, noteLibere: 'Disponibile solo nel weekend.',
    },
    {
      tenantId, concorsoId, stato: 'EMAIL_VERIFICATA', nome: 'Lucie', cognome: 'Martin',
      email: 'lucie.martin@demo.fr', telefono: '+33 6 11 22 33 44', dataNascita: '2002-09-01',
      nazionalita: 'Francese', strumento: 'Violino', sezioneId: sezArchi, categoriaId: catArchiSr,
      consensiGdpr: gdpr, emailVerifiedAt: new Date(),
    },
    {
      tenantId, concorsoId, stato: 'APPROVATA', nome: 'Sofia', cognome: 'Greco',
      email: 'sofia.greco@demo.it', dataNascita: '2004-03-15', nazionalita: 'Italiana',
      strumento: 'Pianoforte', sezioneId: sezPiano, categoriaId: catPianoSr,
      consensiGdpr: gdpr, emailVerifiedAt: new Date(), approvataAt: new Date(),
    },
    {
      tenantId, concorsoId, stato: 'RIFIUTATA', nome: 'Test', cognome: 'Spam',
      email: 'spam@demo.test', strumento: 'Pianoforte', sezioneId: sezPiano,
      consensiGdpr: gdpr, note: 'Iscrizione incompleta / fuori regolamento.',
    },
    {
      tenantId, concorsoId, stato: 'INVIATA', nome: 'Aiko', cognome: 'Mori',
      email: 'aiko.mori@demo.jp', dataNascita: '2005-03-28', nazionalita: 'Giapponese',
      strumento: 'Flauto', sezioneId: sezFiati, categoriaId: catFiatiSr, consensiGdpr: gdpr,
    },
  ]);
  console.log('  ✓ 5 iscrizioni (INVIATA/EMAIL_VERIFICATA/APPROVATA/RIFIUTATA)');

  // ── Audit log (eventi demo, scope concorso) ─────────────────────────────────
  // payload.concorsoId → la tab Audit ("Solo questo concorso") li mostra.
  const actor = adminAccount.id;
  const mins = (m: number) => new Date(Date.now() - m * 60_000);
  await dbSuper.insert(auditLog).values([
    { tenantId, actorAccountId: actor, action: 'concorso.create', targetType: 'concorso', targetId: concorsoId, payload: { concorsoId, nome: concorso!.nome }, createdAt: mins(240) },
    { tenantId, actorAccountId: actor, action: 'account.create', targetType: 'account', payload: { concorsoId, email: 'commissario@ente1.test' }, createdAt: mins(180) },
    { tenantId, actorAccountId: actor, action: 'categorie.copy', targetType: 'sezione', payload: { concorsoId, copiate: 2, saltate: 0 }, createdAt: mins(150) },
    { tenantId, actorAccountId: actor, action: 'fase.start', targetType: 'fase', targetId: pElim, payload: { concorsoId, fase: 'Eliminatoria' }, createdAt: mins(90) },
    { tenantId, actorAccountId: actor, action: 'fase.sorteggio', targetType: 'fase', targetId: pElim, payload: { concorsoId, fase: 'Eliminatoria', seed: 1839220114, count: 6 }, createdAt: mins(80) },
    { tenantId, actorAccountId: actor, action: 'fase.complete', targetType: 'fase', targetId: pElim, payload: { concorsoId, fase: 'Eliminatoria' }, createdAt: mins(30) },
    { tenantId, actorAccountId: actor, action: 'fase.start', targetType: 'fase', targetId: pSemi, payload: { concorsoId, fase: 'Semifinale' }, createdAt: mins(20) },
  ]);
  console.log('  ✓ 7 eventi audit log (scope concorso)');

  console.log('\n✅ Seed screenshot completato.');
  console.log('   Admin:       admin@ente1.test / Admin123!');
  console.log('   Commissario: commissario@ente1.test / Demo123! (Anna, presidente Giuria Pianoforte)');
}

// ── Helpers ──────────────────────────────────────────────────────────────────

async function ensureAccount(
  tenantId: string,
  email: string,
  passwordHash: string,
  role: 'admin' | 'commissario' | 'superadmin',
) {
  const existing = await dbSuper.query.accounts.findFirst({
    where: (a, { eq }) => eq(a.email, email),
  });
  if (existing) return existing;
  const [created] = await dbSuper
    .insert(accounts)
    .values({ tenantId, email, passwordHash, role, emailVerified: true })
    .returning();
  console.log(`  ✓ account ${email} (${role}) creato`);
  return created!;
}

async function mkSezione(tenantId: string, concorsoId: string, nome: string, descrizione: string, ordine: number) {
  const [s] = await dbSuper.insert(sezioni).values({ tenantId, concorsoId, nome, descrizione, ordine }).returning();
  return s!.id;
}

async function mkCategoria(
  tenantId: string, sezioneId: string, nome: string, descrizione: string,
  etaMin: number, etaMax: number, ordine: number,
) {
  const [c] = await dbSuper
    .insert(categorie)
    .values({ tenantId, sezioneId, nome, descrizione, etaMin, etaMax, ordine })
    .returning();
  return c!.id;
}

async function mkCommissari(
  tenantId: string, concorsoId: string,
  list: Array<[string, string, string, string, string, string]>,
) {
  return dbSuper
    .insert(commissari)
    .values(list.map(([nome, cognome, specialita, email, nazionalita, dataNascita]) => ({
      tenantId, concorsoId, nome, cognome, specialita, email, nazionalita, dataNascita, stato: 'ATTIVO',
    })))
    .returning();
}

async function mkCommissione(
  tenantId: string, concorsoId: string, nome: string,
  presidenteCommissarioId: string,
  commissarioIds: string[], sezioniIds: string[], categorieIds: string[],
) {
  const [c] = await dbSuper
    .insert(commissioni)
    .values({ tenantId, concorsoId, nome, presidenteCommissarioId })
    .returning();
  const id = c!.id;
  if (commissarioIds.length) {
    await dbSuper.insert(commissioniCommissari).values(
      commissarioIds.map((commissarioId) => ({ tenantId, commissioneId: id, commissarioId })),
    );
  }
  if (sezioniIds.length) {
    await dbSuper.insert(commissioniSezioni).values(
      sezioniIds.map((sezioneId) => ({ tenantId, commissioneId: id, sezioneId })),
    );
  }
  if (categorieIds.length) {
    await dbSuper.insert(commissioniCategorie).values(
      categorieIds.map((categoriaId) => ({ tenantId, commissioneId: id, categoriaId })),
    );
  }
  return id;
}

async function mkCandidati(
  tenantId: string, concorsoId: string,
  sezioneId: string, categoriaId: string | null,
  list: Array<[number, string, string, string, string, string]>,
  opts: { isGruppo?: boolean; gruppoNome?: string } = {},
) {
  return dbSuper
    .insert(candidati)
    .values(list.map(([numeroCandidato, nome, cognome, strumento, dataNascita, nazionalita]) => ({
      tenantId, concorsoId, numeroCandidato, nome,
      cognome: cognome || null,
      strumento,
      dataNascita: dataNascita || null,
      nazionalita: nazionalita || null,
      sezioneId, categoriaId,
      isGruppo: opts.isGruppo ?? false,
      gruppoNome: opts.gruppoNome ?? null,
      docentiPreparatori: ['M. Bianchi', 'L. Verdi'],
    })))
    .returning();
}

async function mkFase(
  tenantId: string, concorsoId: string,
  f: {
    ordine: number; nome: string; stato: 'PIANIFICATA' | 'IN_CORSO' | 'CONCLUSA';
    scala: number; ammessi: number | null; commissioneId: string | null; sezioni: string[];
    dataPrevista: string; metodoMedia: string; modoValutazione: 'autonoma' | 'sincrona'; tempoMinuti: number;
  },
) {
  const [fase] = await dbSuper
    .insert(fasi)
    .values({
      tenantId, concorsoId,
      commissioneId: f.commissioneId,
      ordine: f.ordine, nome: f.nome, ammessi: f.ammessi, dataPrevista: f.dataPrevista,
      scala: f.scala, modoValutazione: f.modoValutazione, metodoMedia: f.metodoMedia,
      tempoMinuti: f.tempoMinuti, stato: f.stato,
    })
    .returning();
  const faseId = fase!.id;
  if (f.sezioni.length) {
    await dbSuper.insert(fasiSezioni).values(
      f.sezioni.map((sezioneId) => ({ tenantId, faseId, sezioneId })),
    );
  }
  await dbSuper.insert(criteri).values(
    CRITERI_STD.map((c, i) => ({ tenantId, faseId, nome: c.nome, peso: c.peso, ordine: i + 1 })),
  );
  return faseId;
}

main()
  .then(() => shutdownPools())
  .then(() => process.exit(0))
  .catch(async (err) => {
    console.error('❌ Seed screenshot fallito:', err);
    await shutdownPools().catch(() => {});
    process.exit(1);
  });
