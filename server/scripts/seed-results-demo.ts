/**
 * seed-results-demo.ts — popola un concorso DEMO completo (per ente1) con dati
 * sufficienti a far comparire una classifica reale nella tab Risultati:
 * sezione, commissione + presidente + 3 commissari, una fase CONCLUSA con
 * criteri, 6 candidati, e tutte le valutazioni (3 commissari × 3 criteri).
 *
 * Idempotente: rimuove un eventuale concorso demo precedente (stesso nome) e
 * ricrea. Usa dbSuper (BYPASSRLS) → setta esplicitamente tenant_id ovunque.
 *
 *   npx tsx scripts/seed-results-demo.ts
 */
import { eq } from 'drizzle-orm';
import { dbSuper } from '../src/db/client.js';
import {
  tenants, concorsi, sezioni, commissari, commissioni, commissioniCommissari,
  commissioniSezioni, fasi, criteri, candidati, candidatiFase, valutazioni,
} from '../src/db/schema.js';
import { slugifyKey } from '@gestimus/scoring/scoring';

const CONCORSO_NOME = 'Demo Risultati 2026';
const CRITERI_DEF = [
  { nome: 'Tecnica', peso: 100, ordine: 1 },
  { nome: 'Musicalità', peso: 100, ordine: 2 },
  { nome: 'Interpretazione', peso: 100, ordine: 3 },
];
const COMMISSARI_DEF = [
  { nome: 'Anna', cognome: 'Rossi' },
  { nome: 'Marco', cognome: 'Bianchi' },
  { nome: 'Elena', cognome: 'Verdi' },
];
const CANDIDATI_DEF = [
  { nome: 'Giulia', cognome: 'Ferrari', strumento: 'Violino' },
  { nome: 'Luca', cognome: 'Romano', strumento: 'Pianoforte' },
  { nome: 'Sara', cognome: 'Costa', strumento: 'Flauto' },
  { nome: 'Matteo', cognome: 'Greco', strumento: 'Violoncello' },
  { nome: 'Chiara', cognome: 'Conti', strumento: 'Clarinetto' },
  { nome: 'Davide', cognome: 'Marino', strumento: 'Tromba' },
];

async function main() {
  const [ente1] = await dbSuper.select({ id: tenants.id }).from(tenants).where(eq(tenants.slug, 'ente1')).limit(1);
  if (!ente1) throw new Error("tenant 'ente1' non trovato — esegui prima il seed di base (npm run db:seed)");
  const tenantId = ente1.id;

  // Idempotenza: rimuovi un demo precedente (CASCADE pulisce i figli).
  await dbSuper.delete(concorsi).where(eq(concorsi.nome, CONCORSO_NOME));

  // 1) Concorso
  const [c] = await dbSuper.insert(concorsi).values({
    tenantId, nome: CONCORSO_NOME, anno: 2026, stato: 'ATTIVO', anonimo: false,
  }).returning({ id: concorsi.id });
  const concorsoId = c!.id;

  // 2) Sezione
  const [sez] = await dbSuper.insert(sezioni).values({
    tenantId, concorsoId, nome: 'Sezione Unica', ordine: 1,
  }).returning({ id: sezioni.id });

  // 3) Commissari + commissione + presidente
  const commIds: string[] = [];
  for (const cm of COMMISSARI_DEF) {
    const [row] = await dbSuper.insert(commissari).values({
      tenantId, concorsoId, nome: cm.nome, cognome: cm.cognome, stato: 'ATTIVO',
    }).returning({ id: commissari.id });
    commIds.push(row!.id);
  }
  const [commissione] = await dbSuper.insert(commissioni).values({
    tenantId, concorsoId, nome: 'Commissione', presidenteCommissarioId: commIds[0],
  }).returning({ id: commissioni.id });
  const commissioneId = commissione!.id;
  for (const cid of commIds) {
    await dbSuper.insert(commissioniCommissari).values({ tenantId, commissioneId, commissarioId: cid });
  }
  await dbSuper.insert(commissioniSezioni).values({ tenantId, commissioneId, sezioneId: sez!.id });

  // 4) Fase + criteri. NB: la creo IN_CORSO perché un trigger DB
  // (freeze_valutazione_fase_conclusa) vieta di inserire valutazioni su una fase
  // già CONCLUSA. La concludo DOPO aver inserito le valutazioni (vedi sotto).
  const [fase] = await dbSuper.insert(fasi).values({
    tenantId, concorsoId, commissioneId, ordine: 1, nome: 'Eliminatoria',
    scala: 100, metodoMedia: 'aritmetica', stato: 'IN_CORSO', ammessi: 3,
  }).returning({ id: fasi.id });
  const faseId = fase!.id;
  for (const cr of CRITERI_DEF) {
    await dbSuper.insert(criteri).values({ tenantId, faseId, nome: cr.nome, peso: cr.peso, ordine: cr.ordine });
  }
  // chiavi criterio come le deriva il frontend (criteriFromRecords → slugifyKey)
  const criterioKeys = CRITERI_DEF.map((cr) => slugifyKey(cr.nome));

  // 5) Candidati + candidati_fase + valutazioni
  for (let i = 0; i < CANDIDATI_DEF.length; i++) {
    const cd = CANDIDATI_DEF[i]!;
    const [cand] = await dbSuper.insert(candidati).values({
      tenantId, concorsoId, numeroCandidato: i + 1, nome: cd.nome, cognome: cd.cognome, strumento: cd.strumento,
    }).returning({ id: candidati.id });
    const ammesso = i < 3; // top 3 promossi
    const [cf] = await dbSuper.insert(candidatiFase).values({
      tenantId, faseId, candidatoId: cand!.id, stato: 'COMPLETATO', ammessoProssimaFase: ammesso, posizione: i + 1,
    }).returning({ id: candidatiFase.id });
    // voto base decrescente per candidato → classifica ordinata e distinta
    const votoBase = 90 - i * 7; // 90,83,76,69,62,55
    for (const commId of commIds) {
      for (const key of criterioKeys) {
        await dbSuper.insert(valutazioni).values({
          tenantId, candidatoFaseId: cf!.id, commissarioId: commId, criterio: key, voto: votoBase,
        });
      }
    }
  }

  // Ora che le valutazioni sono inserite, concludi la fase (il trigger freeze è
  // sulla tabella valutazioni, non su fasi → l'UPDATE di stato è consentito).
  await dbSuper.update(fasi).set({ stato: 'CONCLUSA' }).where(eq(fasi.id, faseId));

  console.log(`✓ Demo creato: concorso "${CONCORSO_NOME}" (${concorsoId})`);
  console.log(`  ente1 → 1 fase CONCLUSA, ${CRITERI_DEF.length} criteri, ${COMMISSARI_DEF.length} commissari, ${CANDIDATI_DEF.length} candidati con valutazioni complete.`);
  console.log(`  URL: http://ente1.gestimus.local/admin?c=${concorsoId}&tab=risultati`);
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
