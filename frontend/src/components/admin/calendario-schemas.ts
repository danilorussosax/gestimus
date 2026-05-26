import { z } from 'zod';

// ─── Slot model (card-candidato) ───────────────────────────────────────────────
// Uno slot è un candidato_fase con eventoId valorizzato + oraPrevista. La label è
// "NNN · displayName" (come candLabel in vanilla).
export interface Slot {
  id: string;
  oraPrevista: string | null;
  posizione: number | null;
  label: string;
}

// ─── Zod schemas ─────────────────────────────────────────────────────────────

export const salaSchema = z.object({
  nome: z.string().min(1, 'Nome obbligatorio').max(255),
  indirizzo: z.string().max(500).optional(),
});
export type SalaForm = z.infer<typeof salaSchema>;

export const blockSchema = z.object({
  tipo: z.enum(['ESIBIZIONE', 'EVENTO']),
  titolo: z.string().max(255).optional(),
  faseId: z.string().optional(),
  sezioneId: z.string().optional(),
  categoriaId: z.string().optional(),
  data: z.string().min(1, 'Data obbligatoria'),
  oraInizio: z.string().optional(),
  oraFine: z.string().optional(),
  salaId: z.string().optional(),
  durataCandidatoMinuti: z.string().optional(),
  note: z.string().max(2000).optional(),
});
export type BlockForm = z.infer<typeof blockSchema>;

export const linkSchema = z.object({
  scopo: z.enum(['CONCORSO', 'SEZIONE', 'GIORNO']),
  sezioneId: z.string().optional(),
  giorno: z.string().optional(),
  etichetta: z.string().max(255).optional(),
  mostraNomi: z.boolean(),
  mostraCommissione: z.boolean(),
});
export type LinkForm = z.infer<typeof linkSchema>;

// ─── Query keys ───────────────────────────────────────────────────────────────

export const SALE_KEY = (cid: string) => ['calendario', 'sale', cid];
export const EVENTI_KEY = (cid: string) => ['calendario', 'eventi', cid];
export const PUB_KEY = (cid: string) => ['calendario', 'pubblicazioni', cid];
export const SEZIONI_KEY = (cid: string) => ['sezioni', cid];
export const FASI_KEY = (cid: string) => ['fasi', cid];
export const CATEGORIE_KEY = (cid: string) => ['categorie', cid];
export const CANDIDATI_KEY = (cid: string) => ['candidati', cid];
export const CF_KEY = (faseId: string) => ['candidati-fase', faseId];
