// =============================================================================
// fasi-utils — layer di dominio puro per la gestione fasi (admin)
//
// Costanti (descrittori metodi/modi/tiebreak, guida, criteri di default), tipi
// del form fase e helper PURI (grouping/sorting, drift dei campi condivisi,
// suggerimento metodo, icona sezione, date). Estratto da FasiTab.tsx per
// isolare la logica testabile dal componente. Nessun JSX, nessuno stato React.
// =============================================================================

import type { FaseRecord, TiebreakStep } from '@/api/fasi';
import type { SezioneRecord } from '@/api/sezioni';
import type { FaseStato } from '@/types';

// ---------------------------------------------------------------------------
// Constants — testo ESATTO da js/scoring.js (METODI_MEDIA) e js/views/admin/fasi.js
// ---------------------------------------------------------------------------

// Descrittori dei 5 metodi di media. Testo identico a js/scoring.js METODI_MEDIA.
export interface MetodoDescriptor {
  nome: string;
  icon: string;
  breve: string;
  pro: string;
  contro: string;
  consigliata: string;
}

export const METODI_MEDIA: Record<string, MetodoDescriptor> = {
  aritmetica: {
    nome: 'Media aritmetica',
    icon: '∑',
    breve: 'Somma di tutti i voti diviso il numero di commissari.',
    pro: 'Usa tutti i dati, semplice e trasparente.',
    contro: 'Vulnerabile a un singolo outlier (un voto molto alto o molto basso).',
    consigliata: 'Sempre, se non vuoi correggere statisticamente gli estremi.',
  },
  olimpica: {
    nome: 'Media olimpica',
    icon: '🥇',
    breve: 'Scarta il voto più alto e il più basso, media aritmetica dei restanti.',
    pro: 'Annulla un singolo outlier per estremo. Standard nei concorsi Olimpici / pattinaggio.',
    contro: 'Con 3 commissari resta un solo voto utile (n−2 = 1) → poco significativa.',
    consigliata: 'Da 4 commissari in su.',
  },
  winsorizzata: {
    nome: 'Media winsorizzata',
    icon: '✂️',
    breve: 'Limita gli estremi al secondo valore più alto/basso, poi fa la media aritmetica.',
    pro: 'Attenua gli outlier senza scartarli del tutto, mantiene n dati.',
    contro: 'Servono almeno 4-5 voti perché il "secondo estremo" sia rappresentativo.',
    consigliata: 'Da 5 commissari in su.',
  },
  mediana: {
    nome: 'Voto mediano',
    icon: '⊥',
    breve: 'Valore centrale dei voti ordinati (con n pari, media dei due centrali).',
    pro: 'Massimamente robusta agli outlier — resiste anche a metà dei voti estremi.',
    contro: 'Ignora le distanze fra i voti: 7 / 7 / 7 e 5 / 7 / 9 hanno la stessa mediana.',
    consigliata: 'Robusta per qualsiasi N≥3, particolarmente buona per N piccoli (3–5).',
  },
  deviazione_std: {
    nome: 'Filtro deviazione standard',
    icon: 'σ',
    breve: 'Esclude i voti oltre ±2σ dalla media, poi ricalcola la media.',
    pro: 'Robusta anche con outlier multipli quando il campione è grande.',
    contro: 'σ stimata su pochi voti (n<7) è instabile, può scartare voti legittimi.',
    consigliata: 'Solo con almeno 7 commissari, idealmente 10+.',
  },
};

// suggerisciMetodo — testo identico a js/scoring.js.
export function suggerisciMetodo(nCommissari: number): { metodo: string; motivo: string } {
  const n = Number(nCommissari) || 0;
  if (n <= 2) return { metodo: 'aritmetica', motivo: `Con ${n} commissari un filtro statistico non ha abbastanza dati per essere significativo.` };
  if (n === 3) return { metodo: 'mediana', motivo: 'Con 3 commissari la mediana è la scelta più robusta — non viene influenzata da un singolo voto estremo.' };
  if (n <= 5) return { metodo: 'olimpica', motivo: `Con ${n} commissari la media olimpica scarta i due estremi e mantiene un numero significativo di voti.` };
  if (n <= 7) return { metodo: 'mediana', motivo: `Con ${n} commissari la mediana resta la più semplice e robusta.` };
  if (n <= 12) return { metodo: 'winsorizzata', motivo: `Con ${n} commissari la winsorizzazione attenua gli outlier mantenendo tutti i voti nel calcolo.` };
  return { metodo: 'deviazione_std', motivo: `Con ${n} commissari la deviazione standard è statisticamente affidabile e identifica voti anomali.` };
}

// Descrittori delle due modalità di valutazione — identico a MODI_VALUTAZIONE in fasi.js.
export interface ModoDescriptor {
  icon: string;
  nome: string;
  breve: string;
  scenari: string[];
  tip: string;
}

export const MODI_VALUTAZIONE: Record<'autonoma' | 'sincrona', ModoDescriptor> = {
  autonoma: {
    icon: '👤',
    nome: 'Valutazione autonoma',
    breve: 'Ogni commissario procede al proprio ritmo, valutando in sequenza i candidati.',
    scenari: [
      'Valutazioni in differita su registrazioni audio/video',
      'Audizioni dal vivo con commissari indipendenti',
      'Concorsi con candidati numerosi (sblocca tutti i giurati in parallelo)',
    ],
    tip: 'Default consigliato per la maggior parte dei concorsi musicali.',
  },
  sincrona: {
    icon: '🎼',
    nome: 'Valutazione sincrona',
    breve: 'Tutta la commissione vota lo stesso candidato in contemporanea. Il presidente gestisce l\'avanzamento.',
    scenari: [
      'Audizioni dal vivo con candidato fisicamente presente in sala',
      'Finali con un solo candidato per volta sul palco',
      'Fasi con tempo cronometrato e cambio candidato visibile a tutti',
    ],
    tip: 'Richiede un presidente di giuria designato per pilotare il flusso.',
  },
};

// Cascata tiebreak — STEPS identici a tiebreakStrategyHtml in common.js.
export interface TiebreakStepDef {
  key: string;
  icon: string;
  titolo: string;
  breve: string;
}

export const TIEBREAK_STEPS: TiebreakStepDef[] = [
  { key: 'scomposizione', icon: '🧩', titolo: 'Scomposizione del voto', breve: 'Confronta i criteri uno per uno, in ordine di peso decrescente. Vince chi ha la media più alta sul criterio più importante che li differenzia.' },
  { key: 'presidente', icon: '🎯', titolo: 'Voto del Presidente di giuria', breve: 'Il voto del Presidente diventa decisivo: vince chi ha la media più alta calcolata sui soli voti del Presidente.' },
  { key: 'eta', icon: '🌱', titolo: 'Criterio anagrafico', breve: 'Vince il candidato più giovane al momento dell\'esibizione. Per i gruppi si usa la media delle date di nascita dei membri.' },
  { key: 'ex_aequo', icon: '🤝', titolo: 'Ex aequo (extrema ratio)', breve: 'Se nessuna regola precedente risolve la parità, viene dichiarato ex aequo: stessa posizione ai candidati, la posizione successiva non viene assegnata; il premio si divide in parti uguali.' },
];

export const STATO_COLORS: Record<FaseStato, string> = {
  PIANIFICATA: 'bg-slate-100 text-slate-700 border-slate-200',
  IN_CORSO: 'bg-blue-100 text-blue-800 border-blue-200',
  CONCLUSA: 'bg-emerald-100 text-emerald-800 border-emerald-200',
};

// Tip della guida "Come configurare le fasi" — testo identico al vanilla
// (admin.fasi.guide.* in it.json). I body contengono HTML deliberato.
export const GUIDE_TIPS: { emoji: string; title: string; body: string }[] = [
  { emoji: '🗂', title: 'Vista per sezione', body: 'Vedi una card per ciascuna sezione del concorso. Le sezioni senza fasi mostrano un pulsante <em>Configura fasi</em> per partire da zero. Le fasi globali (valide per tutte le sezioni) appaiono in cima.' },
  { emoji: '🧙', title: 'Wizard di creazione', body: 'Da <em>Configura fasi</em> scegli un template: <strong>fase unica</strong> (es. 5/10 candidati), <strong>eliminatoria + finale</strong>, <strong>eliminatoria + semifinale + finale</strong> (es. 200 candidati: 200 → 20 → 6) o <strong>personalizzato</strong>. Poi indichi nome e posti per ogni sotto-fase, infine la configurazione comune (commissione/scala/criteri/modo/tempo) che il sistema propaga a tutte.' },
  { emoji: '🔗', title: 'Configurazione condivisa', body: 'Commissione, scala, criteri, modo e tempo sono "ereditati" dalle sotto-fasi (impostati dal wizard). Il bottone <strong>⚙ Configurazione condivisa</strong> in cima al gruppo permette di modificarli in blocco. Le sotto-fasi con valori divergenti mostrano un badge <strong>⚠ diverso tra fasi</strong>.' },
  { emoji: '🔧', title: 'Override puntuali', body: 'Clicca la singola sotto-fase per cambiare un campo solo per quella (es. <em>Finale 15′</em> mentre il resto del gruppo è a 10′). I valori specifici compaiono in chiaro nella riga della sotto-fase.' },
  { emoji: '🎻', title: 'Tracce parallele', body: "Ogni sezione procede in modo <strong>indipendente</strong>: puoi avviare la finale dei fiati mentre l'eliminatoria degli archi è ancora in corso. Le sotto-fasi della stessa sezione si concatenano in base al numero <strong>#ordine</strong>." },
  { emoji: '🌐', title: 'Fasi globali', body: 'Il pulsante <strong>+ Fase globale</strong> in alto crea una fase senza scope di sezione: vale per tutti i candidati (utile per sorteggi iniziali o cerimonie). Una fase globale fa da spartiacque: ogni sezione la aspetta prima di partire.' },
  { emoji: '🏆', title: 'Posti per la sotto-fase successiva', body: 'Vuoto = passano <em>tutti</em> i candidati ammessi dal verdetto. Imposta un numero per limitare il passaggio ai migliori N (es. 20 in semifinale, 6 in finale).' },
  { emoji: '🗑', title: 'Eliminazione', body: '🗑 sulla riga elimina la singola sotto-fase. <strong>🗑 Elimina gruppo</strong> sul header del gruppo cancella tutte le sotto-fasi insieme (bloccato se almeno una è IN_CORSO; segnalato in modo evidente se ci sono fasi CONCLUSE con voti).' },
  { emoji: '⚖', title: 'Spareggi ed ex aequo', body: 'Cascata fissa a 4 regole (ognuna abilitabile/disabilitabile): <strong>1. scomposizione del voto</strong> (vince il criterio col peso più alto) → <strong>2. voto del Presidente</strong> → <strong>3. età</strong> (più giovane vince) → <strong>4. ex aequo</strong> (stessa posizione; salta la successiva, montepremi diviso). Si configura nella <em>Sezione 6</em> del form fase (default ereditato dal concorso).' },
  { emoji: '▶️', title: 'Flusso di lavoro', body: 'PIANIFICATA → IN_CORSO (avviata dal presidente con pre-flight check) → CONCLUSA. A fase chiusa i voti sono bloccati e gli ammessi diventano la base della sotto-fase seguente della stessa sezione.' },
];

// Criteri di default in creazione — identici a openFaseForm (peso decimale → %).
export const DEFAULT_CRITERI: CriterioFV[] = [
  { label: 'Tecnica', key: 'tecnica', peso: 35 },
  { label: 'Interpretazione', key: 'interpretazione', peso: 35 },
  { label: 'Intonazione', key: 'intonazione', peso: 15 },
  { label: 'Musicalità', key: 'musicalita', peso: 15 },
];

// ---------------------------------------------------------------------------
// Form value types (state-driven, niente RHF/Zod: il form vanilla è imperativo)
// ---------------------------------------------------------------------------

export interface CriterioFV {
  label: string;
  key: string;
  peso: number; // percentuale 0-100
}

export interface FaseFormValues {
  nome: string;
  dataPrevista: string;
  scala: number | '';
  tempoMinuti: number | '';
  ammessi: number | '';
  testoEsitoPromosso: string;
  testoEsitoEliminato: string;
  modoValutazione: 'autonoma' | 'sincrona';
  metodoMedia: string;
  criteri: CriterioFV[];
  sezioniIds: string[];
  commissioneId: string;
  // tiebreak: array di {key, enabled} se l'admin ha toccato i toggle, altrimenti null
  tiebreakStrategy: TiebreakStep[] | null;
  tiebreakTouched: boolean;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export function prettyStato(stato: FaseStato): string {
  return stato.replace(/_/g, ' ');
}

// ---------------------------------------------------------------------------
// Raggruppamento fasi ("fase madre per sezione") — porta gruppoFasi / SHARED_FIELDS
// / sharedValue / computeDrift da js/views/admin/fasi.js.
//
// Le fasi vengono raggruppate dalla UI in base a `sezioniIds` (signature):
//   - sezioniIds = []        → gruppo "shared"  (vale per tutte le sezioni)
//   - sezioniIds = [X]       → gruppo "single"  (FASE MADRE della sezione X)
//   - sezioniIds = [X,Y,...] → gruppo "multi"   (caso avanzato/raro)
// Il record "fase madre" NON esiste come riga: la madre è la card che
// raggruppa le sotto-fasi. Si garantisce un gruppo per OGNI sezione del
// concorso (anche vuoto), così ogni sezione mostra la sua card-madre con CTA.
// ---------------------------------------------------------------------------

// Campi "condivisi" tra le sotto-fasi di un gruppo. Su FaseRecord il campo
// criteri vive separato (entità criteri) ma il record list espone `pesi`:
// lo usiamo per il confronto strutturale del drift criteri.
export const SHARED_FIELDS = [
  'commissioneId',
  'scala',
  'metodoMedia',
  'modoValutazione',
  'tempoMinuti',
  'pesi',
] as const;
export type SharedField = (typeof SHARED_FIELDS)[number];

// Ritorna il valore se TUTTE le fasi concordano, altrimenti undefined.
// Confronto strutturale via JSON.stringify (replica sharedValue vanilla).
export function sharedValue<K extends SharedField>(
  fasi: FaseRecord[],
  key: K,
): FaseRecord[K] | undefined {
  if (!fasi || fasi.length === 0) return undefined;
  const first = JSON.stringify(fasi[0][key] ?? null);
  for (let i = 1; i < fasi.length; i++) {
    if (JSON.stringify(fasi[i][key] ?? null) !== first) return undefined;
  }
  return fasi[0][key];
}

// Lista dei campi condivisi che divergono tra le sotto-fasi del gruppo.
export function computeDrift(fasi: FaseRecord[]): SharedField[] {
  if (!fasi || fasi.length < 2) return [];
  return SHARED_FIELDS.filter((k) => sharedValue(fasi, k) === undefined);
}

export type GroupType = 'shared' | 'single' | 'multi';

export interface FaseGroup {
  key: string;
  type: GroupType;
  sezioneIds: string[];
  fasi: FaseRecord[];
}

// Raggruppa le fasi del concorso per signature di sezioniIds e garantisce
// che ogni sezione del concorso abbia un gruppo (anche vuoto, per la CTA).
export function gruppoFasi(fasi: FaseRecord[], sezioni: SezioneRecord[]): FaseGroup[] {
  const groups = new Map<string, FaseGroup>();
  for (const f of fasi) {
    const ids = Array.isArray(f.sezioniIds) ? [...f.sezioniIds].sort() : [];
    const key = ids.length === 0 ? '__shared__' : ids.length === 1 ? `s:${ids[0]}` : `m:${ids.join(',')}`;
    const type: GroupType = ids.length === 0 ? 'shared' : ids.length === 1 ? 'single' : 'multi';
    let g = groups.get(key);
    if (!g) { g = { key, type, sezioneIds: ids, fasi: [] }; groups.set(key, g); }
    g.fasi.push(f);
  }
  // Ordina le sotto-fasi per ordine globale (sequenza di valutazione).
  for (const g of groups.values()) g.fasi.sort((a, b) => a.ordine - b.ordine);
  // Sezioni senza fasi → card vuota con CTA "Configura fasi".
  for (const s of sezioni) {
    const key = `s:${s.id}`;
    if (!groups.has(key)) groups.set(key, { key, type: 'single', sezioneIds: [s.id], fasi: [] });
  }
  // Ordering: shared in cima, poi per nome sezione, poi i multi-section in fondo.
  const rank: Record<GroupType, number> = { shared: 0, single: 1, multi: 2 };
  return [...groups.values()].sort((a, b) => {
    if (rank[a.type] !== rank[b.type]) return rank[a.type] - rank[b.type];
    if (a.type === 'single') {
      const sa = sezioni.find((s) => s.id === a.sezioneIds[0])?.nome ?? '';
      const sb = sezioni.find((s) => s.id === b.sezioneIds[0])?.nome ?? '';
      return sa.localeCompare(sb);
    }
    return 0;
  });
}

// Emoji per categoria strumentale, dedotta dal nome della sezione.
// Porta iconaPerSezione da js/views/admin/common.js (stesso ordine di pattern).
export function iconaPerSezione(nome: string | undefined): string {
  const s = String(nome ?? '').toLowerCase();
  if (/canto|voce|voice|soprano|tenor|baritono|contralto|mezzosoprano|lirica|opera/.test(s)) return '🎤';
  if (/coro|choir|coral/.test(s)) return '🎼';
  if (/piano|tastier|harpsichord|clavicembal|fisarmonic|accordion|organo|\borgan\b/.test(s)) return '🎹';
  if (/chitarr|guitar/.test(s)) return '🎸';
  if (/sax|flaut|flute|clarinet|oboe|fagott|bassoon|legni|woodwind/.test(s)) return '🎷';
  if (/tromb[oa]ne|tromb[ae]|trumpet|corno|horn|tuba|ottoni|brass|fiati|wind/.test(s)) return '🎺';
  if (/percuss|drum|batter|marimba|vibrafon|xilo|timpan/.test(s)) return '🥁';
  if (/viol|arch|cello|contrabb|double\s*bass|string/.test(s)) return '🎻';
  if (/arpa|harp/.test(s)) return '🎵';
  if (/composiz|composit/.test(s)) return '🎼';
  if (/direz|conduct|maestro/.test(s)) return '🎙';
  if (/camera|chamber|ensemble|quartett|quintet|musica\s*da\s*camera/.test(s)) return '🎶';
  return '🎵';
}

export function fmtDate(iso: string | null | undefined): string {
  if (!iso) return '';
  try {
    return new Date(iso).toLocaleDateString('it-IT', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
    });
  } catch {
    return iso;
  }
}
