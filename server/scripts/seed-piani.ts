import { dbSuper } from '../src/db/client.js';
import { piani } from '../src/db/schema.js';

/**
 * Piani SaaS di default — reference data che DEVE esistere in ogni install.
 * Stessi valori della migrazione `2026_05_27_piani_catalog.sql`, replicati qui
 * per i percorsi che NON eseguono le migrazioni versionate (`db:sql:up`):
 *   - CI: `drizzle-kit push` + `db:seed` (no migrazioni)
 *   - fresh prod: `drizzle-kit push` + baseline + `db:seed:prod` (baseline marca
 *     le migrazioni come applicate SENZA eseguirle → il seed della migrazione
 *     non gira).
 * Senza questo, la tabella `piani` resta vuota e la creazione tenant fallisce
 * (validazione piano dinamica → key non trovata). Chiamato da seed-dev e
 * seed-prod; idempotente (no overwrite di piani già presenti/modificati).
 */
export const DEFAULT_PIANI = [
  { key: 'trial',   nome: 'Trial gratuito', descrizione: 'Demo a tempo: 30 giorni per provare il sistema senza impegno.', prezzo: 0,   durataGiorni: 30,   limitConcorsi: 1,    limitCommissari: null, limitCandidatiPerConcorso: null, limitIscrittiAnnui: 5,    badgeColor: 'sky',     isPpe: false, ppeSetupPerConcorso: null, ppePerIscritto: null, featured: false, attivo: true, ordine: 1 },
  { key: 'starter', nome: 'Starter',        descrizione: "Per chi organizza un paio di concorsi piccoli all'anno.",       prezzo: 150, durataGiorni: 365,  limitConcorsi: 2,    limitCommissari: null, limitCandidatiPerConcorso: null, limitIscrittiAnnui: 100,  badgeColor: 'emerald', isPpe: false, ppeSetupPerConcorso: null, ppePerIscritto: null, featured: false, attivo: true, ordine: 2 },
  { key: 'pro',     nome: 'Pro',            descrizione: 'Il piano consigliato — miglior rapporto qualità/prezzo per scuole e conservatori medi.', prezzo: 230, durataGiorni: 365, limitConcorsi: 5, limitCommissari: null, limitCandidatiPerConcorso: null, limitIscrittiAnnui: 500, badgeColor: 'brand', isPpe: false, ppeSetupPerConcorso: null, ppePerIscritto: null, featured: true, attivo: true, ordine: 3 },
  { key: 'ultra',   nome: 'Ultra',          descrizione: "Volumi alti, fino a 10 concorsi e 2000 iscritti l'anno.",        prezzo: 350, durataGiorni: 365,  limitConcorsi: 10,   limitCommissari: null, limitCandidatiPerConcorso: null, limitIscrittiAnnui: 2000, badgeColor: 'amber',   isPpe: false, ppeSetupPerConcorso: null, ppePerIscritto: null, featured: false, attivo: true, ordine: 4 },
  { key: 'ppe',     nome: 'Pay-per-Event',  descrizione: 'Niente canone: €100 setup per ogni concorso attivato + €1 per ogni iscritto (persona fisica: un quartetto = 4 iscritti).', prezzo: 0, durataGiorni: null, limitConcorsi: null, limitCommissari: null, limitCandidatiPerConcorso: null, limitIscrittiAnnui: null, badgeColor: 'slate', isPpe: true, ppeSetupPerConcorso: 100, ppePerIscritto: 1, featured: false, attivo: true, ordine: 5 },
];

/** Inserisce i piani di default mancanti (ON CONFLICT key DO NOTHING). */
export async function ensureDefaultPiani(): Promise<void> {
  for (const p of DEFAULT_PIANI) {
    await dbSuper.insert(piani).values(p).onConflictDoNothing({ target: piani.key });
  }
  console.log(`  ✓ piani di default verificati (${DEFAULT_PIANI.length})`);
}
