// =============================================================================
// FasiTab — gestione fasi del concorso (admin)
//
// Porta js/views/admin/fasi.js su React 19 + TS + TanStack Query.
// Il form "Nuova/Modifica fase" replica 1:1 la versione vanilla (openFaseForm):
//   Sezione 1 — Informazioni generali (nome, data prevista)
//   Sezione 2 — Modalità di esecuzione (scala/tempo/posti card numeriche con
//               preset, testi esito promosso/eliminato, modo valutazione)
//   Sezione 3 — Metodo di calcolo della media (5 metodi, banner consigliato)
//   Sezione 4 — Criteri di valutazione (editor pesi/add/remove, totale live)
//   Sezione 5 — Restrizione e assegnazione (sezioni-scope multi-select,
//               commissione assegnata)
//   Sezione 6 — Regole di rottura della parità (cascata tiebreak override)
//
// Layout/classi replicano la sorgente vanilla (c-tile, c-btn, c-tag, c-field,
// brand/ink palette, design-system classes, card numerate).
// =============================================================================

import { useState, useEffect, useCallback, useMemo, type ReactNode, type FormEvent } from 'react';
import { toast } from 'sonner';
import { useQueryClient } from '@tanstack/react-query';
import {
  Plus, Pencil, Trash2, ChevronUp, ChevronDown,
  Play, StopCircle, Shuffle, TriangleAlert,
} from 'lucide-react';

import { cn } from '@/lib/utils';
import { httpErrorMessage } from '@/lib/api';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from '@/components/ui/dialog';
import {
  useFasi,
  createFase,
  updateFase,
  deleteFase,
  startFase,
  concludiFase,
  sorteggiaFase,
  reorderFasi,
  syncCriteri,
  FASI_QUERY_KEY,
  type FaseRecord,
  type CreateFaseBody,
  type UpdateFaseBody,
  type TiebreakStep,
} from '@/api/fasi';
import {
  useCriteri,
  listCriteri,
  type CriterioInput,
  type CriterioRecord,
} from '@/api/criteri';
import { useSezioni, type SezioneRecord } from '@/api/sezioni';
import { useCommissioni, type CommissioneRecord } from '@/api/commissioni';
import { useCommissari } from '@/api/commissari';
import type { FaseStato } from '@/types';

// ---------------------------------------------------------------------------
// Constants — testo ESATTO da js/scoring.js (METODI_MEDIA) e js/views/admin/fasi.js
// ---------------------------------------------------------------------------

// Descrittori dei 5 metodi di media. Testo identico a js/scoring.js METODI_MEDIA.
interface MetodoDescriptor {
  nome: string;
  icon: string;
  breve: string;
  pro: string;
  contro: string;
  consigliata: string;
}

const METODI_MEDIA: Record<string, MetodoDescriptor> = {
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
function suggerisciMetodo(nCommissari: number): { metodo: string; motivo: string } {
  const n = Number(nCommissari) || 0;
  if (n <= 2) return { metodo: 'aritmetica', motivo: `Con ${n} commissari un filtro statistico non ha abbastanza dati per essere significativo.` };
  if (n === 3) return { metodo: 'mediana', motivo: 'Con 3 commissari la mediana è la scelta più robusta — non viene influenzata da un singolo voto estremo.' };
  if (n <= 5) return { metodo: 'olimpica', motivo: `Con ${n} commissari la media olimpica scarta i due estremi e mantiene un numero significativo di voti.` };
  if (n <= 7) return { metodo: 'mediana', motivo: `Con ${n} commissari la mediana resta la più semplice e robusta.` };
  if (n <= 12) return { metodo: 'winsorizzata', motivo: `Con ${n} commissari la winsorizzazione attenua gli outlier mantenendo tutti i voti nel calcolo.` };
  return { metodo: 'deviazione_std', motivo: `Con ${n} commissari la deviazione standard è statisticamente affidabile e identifica voti anomali.` };
}

// Descrittori delle due modalità di valutazione — identico a MODI_VALUTAZIONE in fasi.js.
interface ModoDescriptor {
  icon: string;
  nome: string;
  breve: string;
  scenari: string[];
  tip: string;
}

const MODI_VALUTAZIONE: Record<'autonoma' | 'sincrona', ModoDescriptor> = {
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
interface TiebreakStepDef {
  key: string;
  icon: string;
  titolo: string;
  breve: string;
}

const TIEBREAK_STEPS: TiebreakStepDef[] = [
  { key: 'scomposizione', icon: '🧩', titolo: 'Scomposizione del voto', breve: 'Confronta i criteri uno per uno, in ordine di peso decrescente. Vince chi ha la media più alta sul criterio più importante che li differenzia.' },
  { key: 'presidente', icon: '🎯', titolo: 'Voto del Presidente di giuria', breve: 'Il voto del Presidente diventa decisivo: vince chi ha la media più alta calcolata sui soli voti del Presidente.' },
  { key: 'eta', icon: '🌱', titolo: 'Criterio anagrafico', breve: 'Vince il candidato più giovane al momento dell\'esibizione. Per i gruppi si usa la media delle date di nascita dei membri.' },
  { key: 'ex_aequo', icon: '🤝', titolo: 'Ex aequo (extrema ratio)', breve: 'Se nessuna regola precedente risolve la parità, viene dichiarato ex aequo: stessa posizione ai candidati, la posizione successiva non viene assegnata; il premio si divide in parti uguali.' },
];

const STATO_COLORS: Record<FaseStato, string> = {
  PIANIFICATA: 'bg-slate-100 text-slate-700 border-slate-200',
  IN_CORSO: 'bg-blue-100 text-blue-800 border-blue-200',
  CONCLUSA: 'bg-emerald-100 text-emerald-800 border-emerald-200',
};

// Tip della guida "Come configurare le fasi" — testo identico al vanilla
// (admin.fasi.guide.* in it.json). I body contengono HTML deliberato.
const GUIDE_TIPS: { emoji: string; title: string; body: string }[] = [
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
const DEFAULT_CRITERI: CriterioFV[] = [
  { label: 'Tecnica', key: 'tecnica', peso: 35 },
  { label: 'Interpretazione', key: 'interpretazione', peso: 35 },
  { label: 'Intonazione', key: 'intonazione', peso: 15 },
  { label: 'Musicalità', key: 'musicalita', peso: 15 },
];

// ---------------------------------------------------------------------------
// Form value types (state-driven, niente RHF/Zod: il form vanilla è imperativo)
// ---------------------------------------------------------------------------

interface CriterioFV {
  label: string;
  key: string;
  peso: number; // percentuale 0-100
}

interface FaseFormValues {
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

function prettyStato(stato: FaseStato): string {
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
const SHARED_FIELDS = [
  'commissioneId',
  'scala',
  'metodoMedia',
  'modoValutazione',
  'tempoMinuti',
  'pesi',
] as const;
type SharedField = (typeof SHARED_FIELDS)[number];

// Ritorna il valore se TUTTE le fasi concordano, altrimenti undefined.
// Confronto strutturale via JSON.stringify (replica sharedValue vanilla).
function sharedValue<K extends SharedField>(
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
function computeDrift(fasi: FaseRecord[]): SharedField[] {
  if (!fasi || fasi.length < 2) return [];
  return SHARED_FIELDS.filter((k) => sharedValue(fasi, k) === undefined);
}

type GroupType = 'shared' | 'single' | 'multi';

interface FaseGroup {
  key: string;
  type: GroupType;
  sezioneIds: string[];
  fasi: FaseRecord[];
}

// Raggruppa le fasi del concorso per signature di sezioniIds e garantisce
// che ogni sezione del concorso abbia un gruppo (anche vuoto, per la CTA).
function gruppoFasi(fasi: FaseRecord[], sezioni: SezioneRecord[]): FaseGroup[] {
  const groups = new Map<string, FaseGroup>();
  for (const f of fasi) {
    const ids = Array.isArray(f.sezioniIds) ? [...f.sezioniIds].sort() : [];
    const key = ids.length === 0 ? '__shared__' : ids.length === 1 ? `s:${ids[0]}` : `m:${ids.join(',')}`;
    const type: GroupType = ids.length === 0 ? 'shared' : ids.length === 1 ? 'single' : 'multi';
    if (!groups.has(key)) groups.set(key, { key, type, sezioneIds: ids, fasi: [] });
    groups.get(key)!.fasi.push(f);
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
function iconaPerSezione(nome: string | undefined): string {
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

function fmtDate(iso: string | null | undefined): string {
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

// ---------------------------------------------------------------------------
// SectionHeader — header sezione numerata (cerchio brand + titolo)
// ---------------------------------------------------------------------------

function SectionHeader({ num, title, right }: { num: number; title: string; right?: ReactNode }) {
  return (
    <header className="flex items-center justify-between gap-2 mb-3 flex-wrap">
      <div className="flex items-center gap-2">
        <span className="w-6 h-6 rounded-full bg-brand-100 text-brand-700 text-xs font-bold inline-flex items-center justify-center shrink-0">
          {num}
        </span>
        <h3 className="font-semibold text-slate-900">{title}</h3>
      </div>
      {right}
    </header>
  );
}

// ---------------------------------------------------------------------------
// NumericCard — card numerica con preset (scala / tempo / posti)
// Replica numericCardHtml.
// ---------------------------------------------------------------------------

interface NumericCardProps {
  icon: string;
  title: string;
  desc: string;
  tip: ReactNode;
  value: string | number;
  min: number;
  max: number;
  suffix?: string | null;
  presets: { v: string | number; label: string }[];
  onChange: (v: string | number) => void;
}

function NumericCard({ icon, title, desc, tip, value, min, max, suffix, presets, onChange }: NumericCardProps) {
  const isEmpty = value === '' || value == null;
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-3 flex flex-col gap-2 hover:shadow-soft transition-shadow">
      <div className="flex items-center gap-2">
        <span className="text-xl shrink-0" aria-hidden="true">{icon}</span>
        <p className="font-semibold text-sm text-slate-900 min-w-0">{title}</p>
      </div>
      <p className="text-xs text-slate-600 leading-snug">{desc}</p>
      <div className="relative">
        <input
          type="number"
          min={min}
          max={max}
          value={isEmpty ? '' : value}
          placeholder="—"
          onChange={(e) => onChange(e.target.value === '' ? '' : Number(e.target.value))}
          className={cn('c-input pr-12 text-xl font-bold tabular-nums')}
        />
        {suffix && (
          <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs font-medium text-slate-500 pointer-events-none">
            {suffix}
          </span>
        )}
      </div>
      <div className="flex flex-wrap gap-1">
        {presets.map((p) => (
          <button
            key={String(p.v)}
            type="button"
            onClick={() => onChange(p.v)}
            className="text-[11px] font-medium text-slate-700 bg-slate-100 hover:bg-brand-100 hover:text-brand-800 px-2 py-1 rounded-md transition-colors"
          >
            {p.label}
          </button>
        ))}
      </div>
      <p className="text-[11px] text-slate-500 leading-snug mt-auto pt-1 border-t border-slate-100">{tip}</p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// FaseFormDialog
// ---------------------------------------------------------------------------

// Pre-popolamento in creazione (wizard "+ Aggiungi sotto-fase"): ricava
// sezioni_ids + campi condivisi dal gruppo e li passa al form standard.
// Replica il ramo `group.fasi.length > 0` di openFaseWizard.
interface FasePrefill {
  sezioniIds?: string[];
  scala?: number;
  tempoMinuti?: number;
  modoValutazione?: 'autonoma' | 'sincrona';
  metodoMedia?: string;
  commissioneId?: string | null;
}

interface FaseFormDialogProps {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  concorsoId: string;
  existing?: FaseRecord;
  prefill?: FasePrefill;
  nextOrdine: number;
  onSaved: () => void;
}

function buildDefaults(
  fase: FaseRecord | undefined,
  criteriExisting: CriterioRecord[] | undefined,
  suggeritoMetodo: string,
  prefill?: FasePrefill,
): FaseFormValues {
  const criteri: CriterioFV[] =
    criteriExisting && criteriExisting.length > 0
      ? criteriExisting.map((c) => ({ label: c.nome, key: '', peso: Number(c.peso) || 0 }))
      : DEFAULT_CRITERI.map((c) => ({ ...c }));
  return {
    nome: fase?.nome ?? '',
    dataPrevista: fase?.dataPrevista ?? '',
    scala: fase?.scala ?? prefill?.scala ?? 10,
    tempoMinuti: fase?.tempoMinuti ?? prefill?.tempoMinuti ?? 0,
    ammessi: fase?.ammessi ?? '',
    testoEsitoPromosso: fase?.testoEsitoPromosso ?? '',
    testoEsitoEliminato: fase?.testoEsitoEliminato ?? '',
    modoValutazione:
      (fase?.modoValutazione ?? prefill?.modoValutazione) === 'sincrona' ? 'sincrona' : 'autonoma',
    metodoMedia: fase?.metodoMedia ?? prefill?.metodoMedia ?? suggeritoMetodo,
    criteri,
    sezioniIds: Array.isArray(fase?.sezioniIds)
      ? [...fase.sezioniIds]
      : prefill?.sezioniIds
        ? [...prefill.sezioniIds]
        : [],
    commissioneId: fase?.commissioneId ?? prefill?.commissioneId ?? '',
    tiebreakStrategy: Array.isArray(fase?.tiebreakStrategy) ? fase.tiebreakStrategy : null,
    tiebreakTouched: Array.isArray(fase?.tiebreakStrategy) && fase.tiebreakStrategy.length > 0,
  };
}

function FaseFormDialog({
  open,
  onOpenChange,
  concorsoId,
  existing,
  prefill,
  nextOrdine,
  onSaved,
}: FaseFormDialogProps) {
  const isEdit = !!existing;
  const qc = useQueryClient();
  const [saving, setSaving] = useState(false);

  // Dati per le sezioni 3 (n. commissari → metodo consigliato) e 5 (scope).
  const { data: sezioni } = useSezioni(concorsoId);
  const { data: commissioni } = useCommissioni(concorsoId);
  const { data: commissari } = useCommissari(concorsoId);
  const { data: criteriExisting } = useCriteri(existing?.id);

  // Numero di commissari: in edit = membri della commissione assegnata (se c'è),
  // altrimenti tutti i commissari del concorso (come db.getFaseCommissariIds).
  const nCommissari = useMemo(() => {
    const tutti = commissari?.length ?? 0;
    if (isEdit && existing?.commissioneId) {
      const comm = commissioni?.find((c) => c.id === existing.commissioneId);
      if (comm) return comm.commissari.length;
    }
    return tutti;
  }, [commissari, commissioni, isEdit, existing]);

  const suggerito = useMemo(() => suggerisciMetodo(nCommissari), [nCommissari]);

  const [values, setValues] = useState<FaseFormValues>(() =>
    buildDefaults(existing, undefined, suggerito.metodo, prefill),
  );

  // Reset/riempimento quando si apre o cambia la fase / i criteri caricati.
  useEffect(() => {
    if (!open) return;
    setValues(buildDefaults(existing, criteriExisting, suggerito.metodo, prefill));
  }, [open, existing, criteriExisting, suggerito.metodo, prefill]);

  const set = <K extends keyof FaseFormValues>(key: K, val: FaseFormValues[K]) =>
    setValues((p) => ({ ...p, [key]: val }));

  // ── Criteri editor handlers ──────────────────────────────────────────────
  const totalPeso = values.criteri.reduce((s, c) => s + (Number(c.peso) || 0), 0);

  const updateCriterio = (idx: number, field: keyof CriterioFV, val: string | number) =>
    setValues((p) => ({
      ...p,
      criteri: p.criteri.map((c, i) => (i === idx ? { ...c, [field]: val } : c)),
    }));

  const addCriterio = () =>
    setValues((p) => ({ ...p, criteri: [...p.criteri, { label: '', key: '', peso: 0 }] }));

  const removeCriterio = (idx: number) =>
    setValues((p) => ({
      ...p,
      criteri: p.criteri.length > 1 ? p.criteri.filter((_, i) => i !== idx) : p.criteri,
    }));

  // ── Tiebreak: stato "abilitato" per step ──────────────────────────────────
  const isInherited = !values.tiebreakStrategy || values.tiebreakStrategy.length === 0;
  const tbEnabled = (key: string): boolean => {
    const source = values.tiebreakStrategy;
    if (!Array.isArray(source)) return true;
    const row = source.find((s) => s.key === key);
    return row ? !!row.enabled : true;
  };
  const toggleTb = (key: string) => {
    setValues((p) => {
      const base: TiebreakStep[] = TIEBREAK_STEPS.map((s) => ({
        key: s.key,
        enabled: (() => {
          const src = p.tiebreakStrategy;
          if (!Array.isArray(src)) return true;
          const row = src.find((r) => r.key === s.key);
          return row ? !!row.enabled : true;
        })(),
      }));
      const next = base.map((s) => (s.key === key ? { ...s, enabled: !s.enabled } : s));
      return { ...p, tiebreakStrategy: next, tiebreakTouched: true };
    });
  };

  // ── Submit ─────────────────────────────────────────────────────────────────
  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    const nome = values.nome.trim();
    if (!nome) {
      toast.error('Il nome è obbligatorio');
      return;
    }

    const scala = Number(values.scala) || 10;
    const tempoMinuti = Number(values.tempoMinuti) || 0;
    const ammessi = values.ammessi === '' || values.ammessi == null ? null : Number(values.ammessi);
    const dataPrevista = values.dataPrevista || null;

    // Criteri: pesi % → int 0-100 (il server normalizza a 100 con largest-remainder).
    const criteriParsed: CriterioInput[] = values.criteri
      .map((c, i) => ({
        nome: c.label.trim(),
        peso: Math.max(0, Math.min(100, Number(c.peso) || 0)),
        ordine: i,
      }))
      .filter((c) => c.nome);

    if (criteriParsed.length === 0) {
      toast.error('Almeno un criterio richiesto');
      return;
    }

    // Warning soft (non bloccante): somma pesi ≠ 100%.
    const totPct = Math.round(criteriParsed.reduce((s, c) => s + c.peso, 0));
    if (totPct !== 100) {
      const ok = window.confirm(`La somma dei pesi è ${totPct}% (consigliato 100%). Vuoi salvare comunque?`);
      if (!ok) return;
    }

    // Tiebreak: salva l'array solo se l'admin ha toccato i toggle, altrimenti null (eredita).
    let tiebreakStrategy: TiebreakStep[] | null = null;
    if (values.tiebreakTouched) {
      tiebreakStrategy = TIEBREAK_STEPS.map((s) => ({ key: s.key, enabled: tbEnabled(s.key) }));
    }

    const sezioniIds = values.sezioniIds.filter(Boolean);
    const commissioneId = values.commissioneId || null;

    setSaving(true);
    try {
      const common = {
        nome,
        ammessi,
        dataPrevista,
        scala,
        modoValutazione: values.modoValutazione,
        metodoMedia: values.metodoMedia,
        tempoMinuti,
        sezioniIds,
        commissioneId,
        tiebreakStrategy,
        testoEsitoPromosso: values.testoEsitoPromosso.trim() || null,
        testoEsitoEliminato: values.testoEsitoEliminato.trim() || null,
      };

      if (isEdit && existing) {
        const body: UpdateFaseBody = common;
        await updateFase(existing.id, body);
        await syncCriteri(existing.id, criteriParsed);
        toast.success('Fase aggiornata');
      } else {
        const body: CreateFaseBody = { concorsoId, ordine: nextOrdine, ...common };
        const created = await createFase(body);
        await syncCriteri(created.id, criteriParsed);
        toast.success('Fase creata');
      }

      await qc.invalidateQueries({ queryKey: FASI_QUERY_KEY(concorsoId) });
      onSaved();
      onOpenChange(false);
    } catch (err) {
      toast.error(httpErrorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  const metodoConsigliatoNome = METODI_MEDIA[suggerito.metodo]?.nome ?? suggerito.metodo;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-4xl sm:p-8">
        <DialogHeader>
          <DialogTitle>{isEdit ? `Modifica fase: ${existing?.nome}` : 'Nuova fase'}</DialogTitle>
          <DialogDescription className="sr-only">
            Configura nome, esecuzione, metodo di media, criteri, scope e regole di spareggio della fase.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={onSubmit} className="space-y-7 overflow-y-auto max-h-[76dvh] pr-2">
          {/* ====== Sezione 1: Generale ====== */}
          <section className="rounded-xl border border-slate-100 bg-slate-50/40 px-5 py-4">
            <SectionHeader num={1} title="Informazioni generali" />
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <label className="c-field">
                <span className="c-field__label">Nome</span>
                <input
                  type="text"
                  required
                  value={values.nome}
                  onChange={(e) => set('nome', e.target.value)}
                  placeholder="Eliminatoria"
                  autoFocus
                  className="c-input"
                />
              </label>
              <label className="c-field">
                <span className="c-field__label">Data prevista</span>
                <input
                  type="date"
                  value={values.dataPrevista}
                  onChange={(e) => set('dataPrevista', e.target.value)}
                  className="c-input"
                />
              </label>
            </div>
          </section>

          {/* ====== Sezione 2: Esecuzione ====== */}
          <section className="rounded-xl border border-slate-100 bg-slate-50/40 px-5 py-4">
            <SectionHeader num={2} title="Modalità di esecuzione" />

            {/* Tre card numeriche: scala / tempo / posti */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-4">
              <NumericCard
                icon="🎯"
                title="Scala di voto"
                desc="Voto massimo che un commissario può assegnare."
                value={values.scala}
                min={1}
                max={100}
                suffix={null}
                presets={[
                  { v: 10, label: '0–10' },
                  { v: 25, label: '0–25' },
                  { v: 100, label: '0–100' },
                ]}
                onChange={(v) => set('scala', v === '' ? '' : Number(v))}
                tip={
                  <>
                    <strong>10</strong> è lo standard nei conservatori italiani, <strong>100</strong> nei concorsi internazionali.
                  </>
                }
              />
              <NumericCard
                icon="⏱"
                title="Tempo per candidato"
                desc="Minuti previsti per l'esibizione. Attiva un cronometro condiviso."
                value={values.tempoMinuti}
                min={0}
                max={600}
                suffix="min"
                presets={[
                  { v: 0, label: 'Libero' },
                  { v: 5, label: '5 min' },
                  { v: 10, label: '10 min' },
                  { v: 15, label: '15 min' },
                ]}
                onChange={(v) => set('tempoMinuti', v === '' ? '' : Number(v))}
                tip={
                  <>
                    <strong>0</strong> = nessun limite cronometrato.
                  </>
                }
              />
              <NumericCard
                icon="🏆"
                title="Posti per la fase successiva"
                desc="Quanti candidati al massimo passano alla fase seguente."
                value={values.ammessi}
                min={0}
                max={9999}
                suffix={null}
                presets={[
                  { v: '', label: 'Tutti' },
                  { v: 5, label: 'Top 5' },
                  { v: 10, label: 'Top 10' },
                  { v: 20, label: 'Top 20' },
                ]}
                onChange={(v) => set('ammessi', v === '' ? '' : Number(v))}
                tip={
                  <>
                    <strong>Vuoto</strong> = tutti gli ammessi dal verdetto della commissione.
                  </>
                }
              />
            </div>

            {/* Testi custom esito */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-4">
              <label className="c-field">
                <span className="c-field__label">Testo esito "ammesso"</span>
                <input
                  className="c-input"
                  maxLength={80}
                  value={values.testoEsitoPromosso}
                  onChange={(e) => set('testoEsitoPromosso', e.target.value)}
                  placeholder="es. AMMESSO ALLA SEMIFINALE"
                />
                <span className="text-[11px] text-slate-500 mt-1 block">
                  Testo mostrato nella colonna esito per i candidati ammessi alla fase successiva. Vuoto = default "PROMOSSO".
                </span>
              </label>
              <label className="c-field">
                <span className="c-field__label">Testo esito "eliminato"</span>
                <input
                  className="c-input"
                  maxLength={80}
                  value={values.testoEsitoEliminato}
                  onChange={(e) => set('testoEsitoEliminato', e.target.value)}
                  placeholder="es. NON AMMESSO"
                />
                <span className="text-[11px] text-slate-500 mt-1 block">
                  Testo mostrato per i non ammessi. Vuoto = default "ELIMINATO".
                </span>
              </label>
            </div>

            {/* Modalità di valutazione: due radio-card */}
            <p className="c-field__label mb-2 mt-4">Modalità di valutazione</p>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {(['autonoma', 'sincrona'] as const).map((key) => {
                const m = MODI_VALUTAZIONE[key];
                const selected = values.modoValutazione === key;
                return (
                  <button
                    key={key}
                    type="button"
                    onClick={() => set('modoValutazione', key)}
                    className={cn(
                      'text-left rounded-xl border bg-white p-3 transition-all hover:shadow-soft flex flex-col gap-2',
                      selected
                        ? 'ring-2 ring-brand-500 bg-brand-50/40 border-brand-300'
                        : 'border-slate-200 hover:border-brand-200',
                    )}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex items-center gap-2 min-w-0">
                        <span className="text-xl shrink-0" aria-hidden="true">{m.icon}</span>
                        <p className="font-semibold text-sm text-slate-900">{m.nome}</p>
                      </div>
                      <span className="text-base text-brand-600 leading-none shrink-0">
                        {selected ? '●' : '○'}
                      </span>
                    </div>
                    <p className="text-xs text-slate-600 leading-snug">{m.breve}</p>
                    <div className="text-[11px] text-slate-500 space-y-0.5 mt-1 pt-2 border-t border-slate-100">
                      <p className="font-semibold text-slate-700 mb-0.5">Quando usarla:</p>
                      {m.scenari.map((s) => (
                        <p key={s} className="flex gap-1.5">
                          <span className="text-brand-500">·</span>
                          <span>{s}</span>
                        </p>
                      ))}
                      <p className="text-slate-400 italic mt-1">{m.tip}</p>
                    </div>
                  </button>
                );
              })}
            </div>
          </section>

          {/* ====== Sezione 3: Metodo di calcolo media ====== */}
          <section className="rounded-xl border border-slate-100 bg-slate-50/40 px-5 py-4">
            <SectionHeader
              num={3}
              title="Metodo di calcolo della media"
              right={
                <div className="text-xs bg-amber-50 text-amber-900 border border-amber-200 rounded-full px-3 py-1 inline-flex items-center gap-1.5">
                  <span>👥</span>
                  <span>
                    <strong>{nCommissari}</strong> commissari {isEdit ? 'su questa fase' : 'nel concorso'}
                  </span>
                </div>
              }
            />
            <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-3 mb-3 flex items-start gap-3">
              <span className="text-lg shrink-0">🎯</span>
              <div className="text-sm">
                <p className="font-semibold text-emerald-900">Consigliato: {metodoConsigliatoNome}</p>
                <p className="text-emerald-800 text-xs mt-0.5">{suggerito.motivo}</p>
              </div>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {Object.entries(METODI_MEDIA).map(([key, m]) => {
                const isSel = key === values.metodoMedia;
                const isSug = key === suggerito.metodo;
                return (
                  <button
                    key={key}
                    type="button"
                    onClick={() => set('metodoMedia', key)}
                    className={cn(
                      'text-left rounded-xl border bg-white p-3 transition-all hover:shadow-soft flex flex-col gap-2',
                      isSel
                        ? 'ring-2 ring-brand-500 bg-brand-50/40 border-brand-300'
                        : 'border-slate-200 hover:border-brand-200',
                    )}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex items-center gap-2 min-w-0">
                        <span className="text-xl shrink-0" aria-hidden="true">{m.icon}</span>
                        <div className="min-w-0">
                          <p className="font-semibold text-sm text-slate-900 truncate">{m.nome}</p>
                          {isSug && (
                            <span className="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider text-emerald-700 bg-emerald-100 border border-emerald-200 px-1.5 py-0.5 rounded-full mt-0.5">
                              🎯 consigliato
                            </span>
                          )}
                        </div>
                      </div>
                      <span className="text-base text-brand-600 leading-none shrink-0">
                        {isSel ? '●' : '○'}
                      </span>
                    </div>
                    <p className="text-xs text-slate-600 leading-snug">{m.breve}</p>
                    <div className="text-[11px] text-slate-500 space-y-0.5 mt-1 pt-2 border-t border-slate-100">
                      <p>
                        <span className="font-semibold text-emerald-700">+</span> {m.pro}
                      </p>
                      <p>
                        <span className="font-semibold text-rose-700">−</span> {m.contro}
                      </p>
                      <p className="text-slate-400 italic">{m.consigliata}</p>
                    </div>
                  </button>
                );
              })}
            </div>
          </section>

          {/* ====== Sezione 4: Criteri ====== */}
          <section className="rounded-xl border border-slate-100 bg-slate-50/40 px-5 py-4">
            <SectionHeader
              num={4}
              title="Criteri di valutazione"
              right={
                <p className="text-xs font-mono text-slate-600">
                  Totale pesi:{' '}
                  <span className={cn('font-bold', totalPeso === 100 ? 'text-emerald-600' : 'text-amber-600')}>
                    {totalPeso}%
                  </span>
                </p>
              }
            />
            <p className="text-xs text-slate-600 mb-2">
              Ogni criterio contribuisce alla media finale in base al suo peso. La somma dei pesi dovrebbe essere 100%.
            </p>
            <div className="space-y-2">
              {values.criteri.map((c, i) => (
                <div key={i} className="grid grid-cols-12 gap-3 items-end">
                  <label className="col-span-5 c-field">
                    {i === 0 && <span className="c-field__label">Etichetta</span>}
                    <input
                      type="text"
                      className="c-input"
                      value={c.label}
                      onChange={(e) => updateCriterio(i, 'label', e.target.value)}
                      placeholder="Tecnica"
                    />
                  </label>
                  <label className="col-span-4 c-field">
                    {i === 0 && <span className="c-field__label">Chiave (opzionale)</span>}
                    <input
                      type="text"
                      className="c-input font-mono text-xs"
                      value={c.key}
                      onChange={(e) => updateCriterio(i, 'key', e.target.value)}
                      placeholder="auto"
                    />
                  </label>
                  <label className="col-span-2 c-field">
                    {i === 0 && <span className="c-field__label">Peso (%)</span>}
                    <div className="relative">
                      <input
                        type="number"
                        step={1}
                        min={0}
                        max={100}
                        className="c-input pr-7"
                        value={c.peso}
                        onChange={(e) => updateCriterio(i, 'peso', Number(e.target.value))}
                      />
                      <span className="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-slate-500 pointer-events-none">
                        %
                      </span>
                    </div>
                  </label>
                  <button
                    type="button"
                    onClick={() => removeCriterio(i)}
                    className="col-span-1 h-9 text-rose-600 hover:bg-rose-50 rounded-md flex items-center justify-center"
                    title="Rimuovi"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              ))}
            </div>
            <button
              type="button"
              onClick={addCriterio}
              className="mt-2 text-xs font-medium text-brand-700 hover:text-brand-900 inline-flex items-center gap-1"
            >
              + Aggiungi criterio
            </button>
          </section>

          {/* ====== Sezione 5: Restrizione e assegnazione ====== */}
          <section className="rounded-xl border border-slate-100 bg-slate-50/40 px-5 py-4">
            <SectionHeader num={5} title="Restrizione e assegnazione" />
            <div className="space-y-5">
              {/* Sezioni di scope */}
              <div>
                <p className="c-field__label mb-2">Limita ai candidati delle sezioni</p>
                <p className="text-[11px] text-slate-500 leading-snug mb-2">
                  Lascia tutto deselezionato per includere <strong>tutti</strong> i candidati del concorso. Selezionando una o più sezioni, solo i candidati che vi appartengono parteciperanno a questa fase: le fasi diventano tracce parallele per sezione.
                </p>
                {(sezioni?.length ?? 0) === 0 ? (
                  <div className="text-xs text-slate-500 italic bg-slate-50 border border-dashed border-slate-200 rounded-lg px-3 py-2">
                    Nessuna sezione definita. Crea le sezioni dal tab <em>Sezioni</em> per poter scopare le fasi.
                  </div>
                ) : (
                  <div className="flex flex-wrap gap-1.5">
                    {sezioni?.map((s) => {
                      const isSel = values.sezioniIds.includes(s.id);
                      return (
                        <button
                          key={s.id}
                          type="button"
                          onClick={() =>
                            set(
                              'sezioniIds',
                              isSel
                                ? values.sezioniIds.filter((id) => id !== s.id)
                                : [...values.sezioniIds, s.id],
                            )
                          }
                          className={cn(
                            'text-xs font-medium px-3 py-1.5 rounded-full border transition-colors',
                            isSel
                              ? 'bg-brand-600 text-white border-brand-600 hover:bg-brand-700'
                              : 'bg-white text-slate-700 border-slate-200 hover:border-brand-300 hover:bg-brand-50',
                          )}
                        >
                          {s.nome}
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* Commissione assegnata */}
              <div>
                <p className="c-field__label mb-2">Commissione assegnata</p>
                <p className="text-[11px] text-slate-500 leading-snug mb-2">
                  Una commissione raggruppa commissari + sezioni + categorie. Assegnandone una alla fase, solo i suoi membri valuteranno. Lascia "Nessuna" per usare automaticamente <strong>tutti i commissari del concorso</strong>.
                </p>
                <select
                  className="c-input"
                  value={values.commissioneId}
                  onChange={(e) => set('commissioneId', e.target.value)}
                >
                  <option value="">— Nessuna (tutti i commissari del concorso)</option>
                  {commissioni?.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.nome} · {c.commissari.length} commissari
                    </option>
                  ))}
                </select>
                {(commissioni?.length ?? 0) === 0 && (
                  <p className="text-[11px] text-amber-700 italic mt-1">
                    Nessuna commissione creata per questo concorso. Crea una commissione dal tab <em>Commissioni</em> per poterla assegnare.
                  </p>
                )}
              </div>
            </div>
          </section>

          {/* ====== Sezione 6: Regole di spareggio ====== */}
          <section className="rounded-xl border border-slate-100 bg-slate-50/40 px-5 py-4">
            <SectionHeader num={6} title="Regole in caso di ex aequo" />
            <div className="space-y-3">
              {isInherited && (
                <div className="bg-amber-50 border border-amber-200 rounded-xl px-3 py-2 text-xs text-amber-900 flex items-center gap-2">
                  <span>ℹ️</span>
                  <span>
                    Questa fase usa la cascata di default del concorso. Modifica i toggle qui sotto per applicare una policy specifica a questa fase.
                  </span>
                </div>
              )}
              <p className="text-xs text-slate-600">
                L'ordine della cascata è fisso: si parte dal primo step abilitato e si scende solo se la parità resta. Lascia almeno "Ex aequo" attivo per chiudere casi residui in modo legalmente difendibile.
              </p>
              <div className="space-y-2">
                {TIEBREAK_STEPS.map((s, i) => (
                  <label
                    key={s.key}
                    className="flex items-start gap-3 rounded-xl border border-slate-200 bg-white px-3 py-2.5 hover:border-brand-200 transition cursor-pointer"
                  >
                    <input
                      type="checkbox"
                      className="mt-1 w-4 h-4"
                      checked={tbEnabled(s.key)}
                      onChange={() => toggleTb(s.key)}
                    />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="w-6 h-6 rounded-full bg-brand-100 text-brand-700 text-[11px] font-bold inline-flex items-center justify-center">
                          {i + 1}
                        </span>
                        <span className="text-base" aria-hidden="true">{s.icon}</span>
                        <span className="font-semibold text-sm text-slate-900">{s.titolo}</span>
                      </div>
                      <p className="text-[12px] text-slate-600 mt-1 leading-relaxed">{s.breve}</p>
                    </div>
                  </label>
                ))}
              </div>
            </div>
          </section>

          <DialogFooter>
            <button
              type="button"
              className="c-btn c-btn--outline"
              onClick={() => onOpenChange(false)}
              disabled={saving}
            >
              Annulla
            </button>
            <button type="submit" className="c-btn c-btn--primary" disabled={saving}>
              {saving ? 'Salvataggio…' : isEdit ? 'Salva' : 'Crea'}
            </button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// ConfirmDialog
// ---------------------------------------------------------------------------

interface ConfirmDialogProps {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  title: string;
  description: string;
  confirmLabel?: string;
  danger?: boolean;
  onConfirm: () => void | Promise<void>;
  loading?: boolean;
}

function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel = 'Conferma',
  danger = false,
  onConfirm,
  loading = false,
}: ConfirmDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <button
            type="button"
            className="c-btn c-btn--outline"
            onClick={() => onOpenChange(false)}
            disabled={loading}
          >
            Annulla
          </button>
          <button
            type="button"
            className={cn('c-btn', danger ? 'c-btn--danger' : 'c-btn--primary')}
            onClick={async () => {
              await onConfirm();
              onOpenChange(false);
            }}
            disabled={loading}
          >
            {loading ? 'Attendere…' : confirmLabel}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// FaseCard — card singola fase nella lista (stile vanilla faseCardHtml)
// ---------------------------------------------------------------------------

interface FaseCardProps {
  fase: FaseRecord;
  isFirst: boolean;
  isLast: boolean;
  onEdit: () => void;
  onDelete: () => void;
  onStart: () => void;
  onConclude: () => void;
  onSorteggio: () => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
}

function FaseCard({
  fase,
  isFirst,
  isLast,
  onEdit,
  onDelete,
  onStart,
  onConclude,
  onSorteggio,
  onMoveUp,
  onMoveDown,
}: FaseCardProps) {
  const stato = fase.stato ?? 'PIANIFICATA';

  return (
    <div className="bg-white border border-slate-200 rounded-2xl p-4 shadow-soft hover:shadow-md transition-shadow">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-xs font-mono uppercase tracking-wider text-slate-500">
              #{fase.ordine}
            </span>
            <h3 className="font-bold text-slate-900 text-lg">{fase.nome}</h3>
            <span
              className={cn(
                'inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider border',
                STATO_COLORS[stato],
              )}
            >
              {prettyStato(stato)}
            </span>
            {fase.modoValutazione === 'sincrona' && (
              <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full bg-purple-100 text-purple-800 border border-purple-200">
                sincrona
              </span>
            )}
          </div>

          <div className="mt-1 text-xs text-slate-600 flex flex-wrap gap-x-4 gap-y-1">
            <span>Scala {fase.scala}</span>
            {fase.metodoMedia && <span>Media: {fase.metodoMedia}</span>}
            {fase.ammessi != null && <span>Ammessi: {fase.ammessi}</span>}
            {fase.dataPrevista && <span>Data: {fmtDate(fase.dataPrevista)}</span>}
            {fase.tempoMinuti != null && fase.tempoMinuti > 0 && (
              <span>Tempo: {fase.tempoMinuti}′</span>
            )}
          </div>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={onMoveUp}
            disabled={isFirst}
            title="Sposta su"
            className="w-9 h-9 inline-flex items-center justify-center rounded-lg text-slate-600 bg-slate-50 hover:bg-slate-100 border border-slate-200 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <ChevronUp className="h-[18px] w-[18px]" />
          </button>
          <button
            type="button"
            onClick={onMoveDown}
            disabled={isLast}
            title="Sposta giù"
            className="w-9 h-9 inline-flex items-center justify-center rounded-lg text-slate-600 bg-slate-50 hover:bg-slate-100 border border-slate-200 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <ChevronDown className="h-[18px] w-[18px]" />
          </button>
          <button
            type="button"
            onClick={onEdit}
            title="Modifica"
            className="w-9 h-9 inline-flex items-center justify-center rounded-lg text-brand-700 bg-brand-50 hover:bg-brand-100 border border-brand-100 transition-colors"
          >
            <Pencil className="h-[18px] w-[18px]" />
          </button>
          <button
            type="button"
            onClick={onDelete}
            disabled={stato === 'IN_CORSO'}
            title={stato === 'IN_CORSO' ? 'Non eliminabile mentre è IN_CORSO' : 'Elimina'}
            className="w-9 h-9 inline-flex items-center justify-center rounded-lg text-rose-600 bg-rose-50 hover:bg-rose-100 border border-rose-100 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <Trash2 className="h-[18px] w-[18px]" />
          </button>
        </div>
      </div>

      <div className="mt-3 flex flex-wrap gap-2">
        {stato === 'PIANIFICATA' && (
          <button
            type="button"
            onClick={onStart}
            className="text-xs font-medium text-white bg-emerald-600 hover:bg-emerald-700 px-3 py-1.5 rounded-md shadow-sm inline-flex items-center gap-1"
          >
            <Play className="h-3.5 w-3.5" />
            Avvia
          </button>
        )}
        {stato === 'IN_CORSO' && (
          <button
            type="button"
            onClick={onConclude}
            className="text-xs font-medium text-white bg-rose-600 hover:bg-rose-700 px-3 py-1.5 rounded-md shadow-sm inline-flex items-center gap-1"
          >
            <StopCircle className="h-3.5 w-3.5" />
            Concludi
          </button>
        )}
        {stato !== 'CONCLUSA' && (
          <button
            type="button"
            onClick={onSorteggio}
            className="text-xs font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 px-3 py-1.5 rounded-md inline-flex items-center gap-1"
          >
            <Shuffle className="h-3.5 w-3.5" />
            Sorteggio
          </button>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// InnerFaseRow — riga compatta di sotto-fase dentro la card-gruppo.
// Porta innerFaseRowHtml: ordine, nome, stato, drift pills, azioni workflow.
// ---------------------------------------------------------------------------

interface InnerFaseRowProps {
  fase: FaseRecord;
  drift: SharedField[];
  isFirst: boolean;
  isLast: boolean;
  commissioni: CommissioneRecord[] | undefined;
  onEdit: () => void;
  onDelete: () => void;
  onStart: () => void;
  onConclude: () => void;
  onSorteggio: () => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
}

function InnerFaseRow({
  fase,
  drift,
  isFirst,
  isLast,
  commissioni,
  onEdit,
  onDelete,
  onStart,
  onConclude,
  onSorteggio,
  onMoveUp,
  onMoveDown,
}: InnerFaseRowProps) {
  const stato = fase.stato ?? 'PIANIFICATA';
  const tempo = Number(fase.tempoMinuti) || 0;

  // Pillole "override": mostriamo SOLO i campi che divergono dal gruppo,
  // così si vede dov'è lo scostamento (replica i driftPills di innerFaseRowHtml).
  const driftPills: string[] = [];
  if (drift.includes('scala')) driftPills.push(`scala ${fase.scala || 10}`);
  if (drift.includes('tempoMinuti') && tempo > 0) driftPills.push(`⏱ ${tempo}′`);
  if (drift.includes('modoValutazione')) driftPills.push(fase.modoValutazione ?? 'autonoma');
  if (drift.includes('metodoMedia')) driftPills.push(`media ${fase.metodoMedia ?? 'aritmetica'}`);
  if (drift.includes('pesi')) driftPills.push('criteri specifici');
  if (drift.includes('commissioneId')) {
    const c = fase.commissioneId ? commissioni?.find((x) => x.id === fase.commissioneId) : null;
    driftPills.push(c ? `🎼 ${c.nome}` : 'nessuna comm.');
  }

  return (
    <div className="px-5 py-3.5 flex items-start gap-3 hover:bg-slate-50/60 transition-colors">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-xs font-mono uppercase tracking-wider text-slate-400">#{fase.ordine}</span>
          <h4 className="font-semibold text-slate-900 text-base">{fase.nome}</h4>
          <span
            className={cn(
              'inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider border',
              STATO_COLORS[stato],
            )}
          >
            {prettyStato(stato)}
          </span>
          {driftPills.length > 0 && (
            <span
              className="text-[10px] font-medium text-amber-700 inline-flex items-center gap-1"
              title="Valori specifici di questa sotto-fase"
            >
              ▾ {driftPills.join(' · ')}
            </span>
          )}
        </div>
        <div className="mt-0.5 text-xs text-slate-500 flex flex-wrap gap-x-3 gap-y-0.5">
          {fase.ammessi != null ? (
            <span>
              <strong>{fase.ammessi}</strong> passano
            </span>
          ) : (
            <span className="italic">tutti gli ammessi passano</span>
          )}
          {fase.dataPrevista && <span>📅 {fmtDate(fase.dataPrevista)}</span>}
        </div>
        <div className="mt-2 flex flex-wrap gap-1.5">
          {stato === 'PIANIFICATA' && (
            <button
              type="button"
              onClick={onStart}
              className="text-[11px] font-medium text-white bg-emerald-600 hover:bg-emerald-700 px-2.5 py-1 rounded-md shadow-sm inline-flex items-center gap-1"
            >
              <Play className="h-3 w-3" /> Avvia
            </button>
          )}
          {stato === 'IN_CORSO' && (
            <button
              type="button"
              onClick={onConclude}
              className="text-[11px] font-medium text-white bg-rose-600 hover:bg-rose-700 px-2.5 py-1 rounded-md shadow-sm inline-flex items-center gap-1"
            >
              <StopCircle className="h-3 w-3" /> Concludi
            </button>
          )}
          {stato !== 'CONCLUSA' && (
            <button
              type="button"
              onClick={onSorteggio}
              className="text-[11px] font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 px-2.5 py-1 rounded-md inline-flex items-center gap-1"
            >
              <Shuffle className="h-3 w-3" /> Sorteggio
            </button>
          )}
        </div>
      </div>
      <div className="flex items-center gap-1 shrink-0">
        <button
          type="button"
          onClick={onMoveUp}
          disabled={isFirst}
          title="Sposta su"
          className="w-8 h-8 inline-flex items-center justify-center rounded-md text-slate-500 hover:bg-slate-100 disabled:opacity-30 disabled:cursor-not-allowed"
        >
          <ChevronUp className="h-4 w-4" />
        </button>
        <button
          type="button"
          onClick={onMoveDown}
          disabled={isLast}
          title="Sposta giù"
          className="w-8 h-8 inline-flex items-center justify-center rounded-md text-slate-500 hover:bg-slate-100 disabled:opacity-30 disabled:cursor-not-allowed"
        >
          <ChevronDown className="h-4 w-4" />
        </button>
        <button
          type="button"
          onClick={onEdit}
          title="Modifica"
          className="w-8 h-8 inline-flex items-center justify-center rounded-md text-brand-700 hover:bg-brand-50"
        >
          <Pencil className="h-4 w-4" />
        </button>
        <button
          type="button"
          onClick={onDelete}
          disabled={stato === 'IN_CORSO'}
          title={stato === 'IN_CORSO' ? 'Non eliminabile mentre è IN_CORSO' : 'Elimina'}
          className="w-8 h-8 inline-flex items-center justify-center rounded-md text-rose-600 hover:bg-rose-50 disabled:opacity-30 disabled:cursor-not-allowed"
        >
          <Trash2 className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// GroupCard — card-gruppo (FASE MADRE). Porta gruppoFasiCardHtml:
// header con titolo scope/sottotitolo/icona, commissione condivisa, drift
// pills, count badge, pulsanti (Configura fasi / + Aggiungi sotto-fase /
// Configurazione condivisa / Elimina gruppo) e body con le sotto-fasi.
// ---------------------------------------------------------------------------

interface GroupCardProps {
  group: FaseGroup;
  sezioni: SezioneRecord[] | undefined;
  commissioni: CommissioneRecord[] | undefined;
  renderRow: (fase: FaseRecord) => ReactNode;
  onWizard: () => void;
  onAddFase: () => void;
  onEditShared: () => void;
  onDeleteGroup: () => void;
}

function GroupCard({
  group,
  sezioni,
  commissioni,
  renderRow,
  onWizard,
  onAddFase,
  onEditShared,
  onDeleteGroup,
}: GroupCardProps) {
  const sezioniRecord = group.sezioneIds
    .map((id) => sezioni?.find((s) => s.id === id))
    .filter((s): s is SezioneRecord => !!s);

  const title =
    group.type === 'shared'
      ? 'Fasi globali (tutte le sezioni)'
      : group.type === 'multi'
        ? `Fasi su: ${sezioniRecord.map((s) => s.nome).join(' + ')}`
        : (sezioniRecord[0]?.nome ?? '???');
  const subtitle =
    group.type === 'shared'
      ? 'Si applicano a tutti i candidati del concorso, indipendentemente dalla sezione.'
      : group.type === 'single'
        ? 'Fase madre della sezione: le sotto-fasi qui sotto formano la sequenza di valutazione.'
        : 'Caso avanzato: la fase coinvolge più sezioni contemporaneamente.';
  const groupIcon =
    group.type === 'shared' ? '🌐' : group.type === 'multi' ? '🔗' : iconaPerSezione(sezioniRecord[0]?.nome);

  const drift = computeDrift(group.fasi);
  const sharedComm = sharedValue(group.fasi, 'commissioneId');
  const sharedScala = sharedValue(group.fasi, 'scala');
  const sharedModo = sharedValue(group.fasi, 'modoValutazione');
  const sharedTempo = sharedValue(group.fasi, 'tempoMinuti');
  const commAssegnata = sharedComm ? commissioni?.find((c) => c.id === sharedComm) : null;

  const anyRunning = group.fasi.some((f) => f.stato === 'IN_CORSO');
  const hasFasi = group.fasi.length > 0;

  return (
    <section className="bg-white border border-slate-200 rounded-2xl shadow-soft overflow-hidden">
      <header className="bg-gradient-to-br from-brand-50/60 to-white border-b border-slate-200 px-5 py-4 flex items-start justify-between gap-3 flex-wrap">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-xl" aria-hidden="true">{groupIcon}</span>
            <h3 className="font-bold text-slate-900 text-lg truncate">{title}</h3>
            {hasFasi ? (
              <span className="text-[10px] font-mono uppercase tracking-wider px-2 py-0.5 rounded-full bg-slate-100 text-slate-700">
                {group.fasi.length} {group.fasi.length === 1 ? 'sotto-fase' : 'sotto-fasi'}
              </span>
            ) : (
              <span className="text-[10px] font-mono uppercase tracking-wider px-2 py-0.5 rounded-full bg-slate-50 text-slate-400 border border-dashed border-slate-200">
                vuoto
              </span>
            )}
          </div>
          <p className="text-xs text-slate-600 mt-1 leading-snug">{subtitle}</p>
          {hasFasi && (
            <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[11px]">
              {commAssegnata ? (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-purple-50 text-purple-700 border border-purple-200">
                  🎼 {commAssegnata.nome}
                </span>
              ) : drift.includes('commissioneId') ? (
                <span
                  className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-amber-50 text-amber-800 border border-amber-200"
                  title="I valori divergono tra le sotto-fasi"
                >
                  ⚠ Commissioni diverse
                </span>
              ) : (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-slate-50 text-slate-600 border border-slate-200 italic">
                  Nessuna commissione
                </span>
              )}
              {sharedScala !== undefined ? (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-slate-50 text-slate-700 border border-slate-200">
                  Scala {sharedScala}
                </span>
              ) : (
                drift.includes('scala') && (
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-amber-50 text-amber-800 border border-amber-200">
                    ⚠ scala diff.
                  </span>
                )
              )}
              {sharedModo ? (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-slate-50 text-slate-700 border border-slate-200">
                  {sharedModo}
                </span>
              ) : (
                drift.includes('modoValutazione') && (
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-amber-50 text-amber-800 border border-amber-200">
                    ⚠ modo diff.
                  </span>
                )
              )}
              {sharedTempo !== undefined && sharedTempo != null && sharedTempo > 0 ? (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-slate-50 text-slate-700 border border-slate-200">
                  ⏱ {sharedTempo}′
                </span>
              ) : (
                drift.includes('tempoMinuti') && (
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-amber-50 text-amber-800 border border-amber-200">
                    ⚠ tempo diff.
                  </span>
                )
              )}
              {drift.includes('pesi') && (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-amber-50 text-amber-800 border border-amber-200">
                  ⚠ criteri diff.
                </span>
              )}
            </div>
          )}
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {group.fasi.length > 1 && (
            <button
              type="button"
              onClick={onEditShared}
              className="text-xs font-medium text-brand-700 hover:bg-brand-50 px-3 py-1.5 rounded-lg border border-brand-100"
            >
              ⚙ Configurazione condivisa
            </button>
          )}
          {hasFasi && (
            <button
              type="button"
              onClick={onDeleteGroup}
              disabled={anyRunning}
              title={
                anyRunning
                  ? "Impossibile: c'è almeno una sotto-fase IN_CORSO. Concludila prima."
                  : 'Elimina tutte le sotto-fasi del gruppo'
              }
              className="text-xs font-medium text-rose-700 hover:bg-rose-50 px-3 py-1.5 rounded-lg border border-rose-100 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              🗑 Elimina gruppo
            </button>
          )}
          {hasFasi ? (
            <button
              type="button"
              onClick={onAddFase}
              className="text-xs font-medium text-white bg-brand-600 hover:bg-brand-700 px-3 py-1.5 rounded-lg shadow-sm"
            >
              ＋ Aggiungi sotto-fase
            </button>
          ) : (
            <button
              type="button"
              onClick={onWizard}
              className="text-xs font-medium text-white bg-brand-600 hover:bg-brand-700 px-3 py-1.5 rounded-lg shadow-sm"
            >
              Configura fasi
            </button>
          )}
        </div>
      </header>
      {hasFasi ? (
        <div className="divide-y divide-slate-100">{group.fasi.map((f) => renderRow(f))}</div>
      ) : (
        <div className="px-5 py-8 text-center">
          <div className="text-3xl mb-2" aria-hidden="true">🎼</div>
          <p className="text-sm text-slate-600 max-w-md mx-auto">
            Nessuna fase configurata per questa sezione. Usa il wizard per crearne una unica o una sequenza
            (eliminatoria → semifinale → finale).
          </p>
        </div>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------
// FaseWizardDialog — wizard sequenza (porta openFaseWizard, ramo "initial").
// Crea 1 fase unica O una sequenza per il gruppo: template chooser + lista
// nomi/ammessi + configurazione comune (scala/tempo/commissione/modo/metodo/
// criteri). Crea i record sequenzialmente e sincronizza i criteri.
// ---------------------------------------------------------------------------

interface WizItem {
  nome: string;
  ammessi: number | '';
}

const WIZ_TEMPLATES: Record<string, { label: string; items: WizItem[] }> = {
  unica: { label: 'Fase unica', items: [{ nome: 'Audizione', ammessi: '' }] },
  elim_fin: {
    label: 'Eliminatoria + Finale',
    items: [
      { nome: 'Eliminatoria', ammessi: 10 },
      { nome: 'Finale', ammessi: '' },
    ],
  },
  elim_semi_fin: {
    label: 'Eliminatoria + Semifinale + Finale',
    items: [
      { nome: 'Eliminatoria', ammessi: 20 },
      { nome: 'Semifinale', ammessi: 6 },
      { nome: 'Finale', ammessi: '' },
    ],
  },
  custom: { label: 'Personalizzato', items: [{ nome: 'Fase 1', ammessi: '' }] },
};

interface FaseWizardDialogProps {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  concorsoId: string;
  group: FaseGroup;
  nextOrdine: number;
  onSaved: () => void;
}

function FaseWizardDialog({
  open,
  onOpenChange,
  concorsoId,
  group,
  nextOrdine,
  onSaved,
}: FaseWizardDialogProps) {
  const qc = useQueryClient();
  const { data: sezioni } = useSezioni(concorsoId);
  const { data: commissioni } = useCommissioni(concorsoId);
  const { data: commissari } = useCommissari(concorsoId);

  const suggerito = useMemo(() => suggerisciMetodo(commissari?.length ?? 0), [commissari]);

  const groupLabel =
    group.type === 'shared'
      ? 'tutte le sezioni'
      : group.sezioneIds
          .map((id) => sezioni?.find((s) => s.id === id)?.nome)
          .filter(Boolean)
          .join(', ');

  const [tpl, setTpl] = useState<string>('unica');
  const [items, setItems] = useState<WizItem[]>(WIZ_TEMPLATES.unica.items.map((i) => ({ ...i })));
  const [scala, setScala] = useState<number | ''>(10);
  const [tempoMinuti, setTempoMinuti] = useState<number | ''>(0);
  const [commissioneId, setCommissioneId] = useState('');
  const [modoValutazione, setModoValutazione] = useState<'autonoma' | 'sincrona'>('autonoma');
  const [metodoMedia, setMetodoMedia] = useState(suggerito.metodo);
  const [criteri, setCriteri] = useState<CriterioFV[]>(DEFAULT_CRITERI.map((c) => ({ ...c })));
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setTpl('unica');
    setItems(WIZ_TEMPLATES.unica.items.map((i) => ({ ...i })));
    setScala(10);
    setTempoMinuti(0);
    setCommissioneId('');
    setModoValutazione('autonoma');
    setMetodoMedia(suggerito.metodo);
    setCriteri(DEFAULT_CRITERI.map((c) => ({ ...c })));
  }, [open, suggerito.metodo]);

  const totalPeso = criteri.reduce((s, c) => s + (Number(c.peso) || 0), 0);

  const pickTemplate = (k: string) => {
    setTpl(k);
    setItems(WIZ_TEMPLATES[k].items.map((i) => ({ ...i })));
  };
  const addItem = () =>
    setItems((p) => [...p, { nome: `Fase ${p.length + 1}`, ammessi: '' }]);
  const removeItem = (idx: number) =>
    setItems((p) => (p.length > 1 ? p.filter((_, i) => i !== idx) : p));
  const updateItem = (idx: number, field: keyof WizItem, val: string | number) =>
    setItems((p) => p.map((it, i) => (i === idx ? { ...it, [field]: val } : it)));

  const updateCriterio = (idx: number, field: keyof CriterioFV, val: string | number) =>
    setCriteri((p) => p.map((c, i) => (i === idx ? { ...c, [field]: val } : c)));
  const addCriterio = () => setCriteri((p) => [...p, { label: '', key: '', peso: 0 }]);
  const removeCriterio = (idx: number) =>
    setCriteri((p) => (p.length > 1 ? p.filter((_, i) => i !== idx) : p));

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    const cleanItems = items
      .map((it) => ({ nome: it.nome.trim(), ammessi: it.ammessi }))
      .filter((it) => it.nome);
    if (cleanItems.length === 0) {
      toast.error('Aggiungi almeno una fase');
      return;
    }
    const lower = cleanItems.map((i) => i.nome.toLowerCase());
    const dupes = lower.filter((n, i, a) => a.indexOf(n) !== i);
    if (dupes.length > 0) {
      toast.error(`Nomi duplicati: ${[...new Set(dupes)].join(', ')}`);
      return;
    }

    const criteriParsed: CriterioInput[] = criteri
      .map((c, i) => ({
        nome: c.label.trim(),
        peso: Math.max(0, Math.min(100, Number(c.peso) || 0)),
        ordine: i,
      }))
      .filter((c) => c.nome);
    if (criteriParsed.length === 0) {
      toast.error('Almeno un criterio richiesto');
      return;
    }
    const totPct = Math.round(criteriParsed.reduce((s, c) => s + c.peso, 0));
    if (totPct !== 100) {
      const ok = window.confirm(`La somma dei pesi è ${totPct}% (consigliato 100%). Continuo?`);
      if (!ok) return;
    }

    setSaving(true);
    const created: string[] = [];
    try {
      // Creazione sequenziale: l'ordine globale è progressivo dal nextOrdine.
      for (let i = 0; i < cleanItems.length; i++) {
        const it = cleanItems[i];
        const ammessi = it.ammessi === '' || it.ammessi == null ? null : Number(it.ammessi);
        const rec = await createFase({
          concorsoId,
          ordine: nextOrdine + i,
          nome: it.nome,
          scala: Number(scala) || 10,
          tempoMinuti: Number(tempoMinuti) || 0,
          ammessi,
          dataPrevista: null,
          modoValutazione,
          metodoMedia,
          sezioniIds: group.sezioneIds.slice(),
          commissioneId: commissioneId || null,
        });
        created.push(rec.id);
        await syncCriteri(rec.id, criteriParsed);
      }
      toast.success(`${created.length} ${created.length === 1 ? 'fase creata' : 'fasi create'}`);
      await qc.invalidateQueries({ queryKey: FASI_QUERY_KEY(concorsoId) });
      onSaved();
      onOpenChange(false);
    } catch (err) {
      toast.error(
        `Errore dopo ${created.length} fasi: ${httpErrorMessage(err)}`,
      );
      await qc.invalidateQueries({ queryKey: FASI_QUERY_KEY(concorsoId) });
      onSaved();
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-4xl sm:p-8">
        <DialogHeader>
          <DialogTitle>Configura fasi per {groupLabel}</DialogTitle>
          <DialogDescription className="sr-only">
            Scegli un template di fasi, definisci nomi e posti, e la configurazione comune.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={onSubmit} className="space-y-7 overflow-y-auto max-h-[76dvh] pr-2">
          <div className="bg-brand-50/60 border border-brand-100 rounded-xl px-4 py-3 text-sm text-slate-700">
            <p>
              Stai configurando le fasi per: {groupLabel}.{' '}
              <span className="text-slate-500">
                Tutte le sotto-fasi create qui condivideranno i campi della "configurazione comune" qui sotto.
              </span>
            </p>
          </div>

          {/* Step 1: template */}
          <section className="rounded-xl border border-slate-100 bg-slate-50/40 px-5 py-4">
            <SectionHeader num={1} title="Quante fasi?" />
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
              {Object.entries(WIZ_TEMPLATES).map(([k, def]) => {
                const sel = k === tpl;
                return (
                  <button
                    key={k}
                    type="button"
                    onClick={() => pickTemplate(k)}
                    className={cn(
                      'text-left rounded-xl border px-3 py-2.5 transition',
                      sel
                        ? 'border-brand-300 bg-brand-50/40 ring-2 ring-brand-500'
                        : 'border-slate-200 hover:border-brand-300 hover:bg-brand-50/30',
                    )}
                  >
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-bold text-slate-900">{def.label}</span>
                      <span className="ml-auto text-brand-600 text-xs">{sel ? '●' : '○'}</span>
                    </div>
                    <p className="text-[11px] text-slate-500 mt-0.5">
                      {def.items.map((i) => i.nome).join(' → ')}
                    </p>
                  </button>
                );
              })}
            </div>
          </section>

          {/* Step 2: lista fasi */}
          <section className="rounded-xl border border-slate-100 bg-slate-50/40 px-5 py-4">
            <SectionHeader
              num={2}
              title="Nome e posti per ogni fase"
              right={
                <button
                  type="button"
                  onClick={addItem}
                  className="text-xs font-medium text-brand-700 hover:text-brand-900 inline-flex items-center gap-1"
                >
                  + Aggiungi fase
                </button>
              }
            />
            <p className="text-xs text-slate-500 mb-2">
              "Ammessi" = quanti candidati passano alla fase successiva. Vuoto = passano tutti gli ammessi dal
              verdetto della commissione.
            </p>
            <div className="space-y-2">
              {items.map((it, i) => (
                <div key={i} className="grid grid-cols-12 gap-2 items-center">
                  <div className="col-span-1 text-center text-xs font-mono text-slate-400">#{i + 1}</div>
                  <input
                    type="text"
                    className="col-span-7 c-input"
                    placeholder="Nome fase"
                    value={it.nome}
                    onChange={(e) => updateItem(i, 'nome', e.target.value)}
                  />
                  <input
                    type="number"
                    min={0}
                    className="col-span-3 c-input"
                    placeholder="Ammessi (vuoto = tutti)"
                    value={it.ammessi === '' || it.ammessi == null ? '' : it.ammessi}
                    onChange={(e) => updateItem(i, 'ammessi', e.target.value === '' ? '' : Number(e.target.value))}
                  />
                  <button
                    type="button"
                    onClick={() => removeItem(i)}
                    className="col-span-1 text-rose-600 hover:bg-rose-50 rounded-md text-lg"
                    title="Rimuovi"
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>
          </section>

          {/* Step 3: configurazione comune */}
          <section className="rounded-xl border border-slate-100 bg-slate-50/40 px-5 py-4">
            <SectionHeader num={3} title="Configurazione comune (vale per tutte le sotto-fasi)" />
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-4">
              <NumericCard
                icon="🎯"
                title="Scala di voto"
                desc="Voto massimo che un commissario può assegnare."
                value={scala}
                min={1}
                max={100}
                suffix={null}
                presets={[
                  { v: 10, label: '0–10' },
                  { v: 25, label: '0–25' },
                  { v: 100, label: '0–100' },
                ]}
                onChange={(v) => setScala(v === '' ? '' : Number(v))}
                tip={
                  <>
                    <strong>10</strong> standard, <strong>100</strong> concorsi internazionali.
                  </>
                }
              />
              <NumericCard
                icon="⏱"
                title="Tempo per candidato"
                desc="Minuti previsti per l'esibizione."
                value={tempoMinuti}
                min={0}
                max={600}
                suffix="min"
                presets={[
                  { v: 0, label: 'Libero' },
                  { v: 5, label: '5 min' },
                  { v: 10, label: '10 min' },
                  { v: 15, label: '15 min' },
                ]}
                onChange={(v) => setTempoMinuti(v === '' ? '' : Number(v))}
                tip={
                  <>
                    <strong>0</strong> = nessun limite.
                  </>
                }
              />
              <div className="rounded-xl border border-slate-200 bg-white p-3 flex flex-col gap-2">
                <div className="flex items-center gap-2">
                  <span className="text-xl">🎼</span>
                  <p className="font-semibold text-sm">Commissione</p>
                </div>
                <p className="text-xs text-slate-600">
                  Stessa commissione per tutte le sotto-fasi. Vuoto = tutti i commissari del concorso.
                </p>
                <select className="c-input" value={commissioneId} onChange={(e) => setCommissioneId(e.target.value)}>
                  <option value="">— Nessuna —</option>
                  {commissioni?.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.nome} · {c.commissari.length} comm.
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <p className="c-field__label mb-2 mt-1">Modalità di valutazione</p>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-4">
              {(['autonoma', 'sincrona'] as const).map((key) => {
                const m = MODI_VALUTAZIONE[key];
                const selected = modoValutazione === key;
                return (
                  <button
                    key={key}
                    type="button"
                    onClick={() => setModoValutazione(key)}
                    className={cn(
                      'text-left rounded-xl border bg-white p-3 transition-all hover:shadow-soft flex flex-col gap-2',
                      selected
                        ? 'ring-2 ring-brand-500 bg-brand-50/40 border-brand-300'
                        : 'border-slate-200 hover:border-brand-200',
                    )}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex items-center gap-2 min-w-0">
                        <span className="text-xl shrink-0" aria-hidden="true">{m.icon}</span>
                        <p className="font-semibold text-sm text-slate-900">{m.nome}</p>
                      </div>
                      <span className="text-base text-brand-600 leading-none shrink-0">{selected ? '●' : '○'}</span>
                    </div>
                    <p className="text-xs text-slate-600 leading-snug">{m.breve}</p>
                  </button>
                );
              })}
            </div>

            <p className="c-field__label mb-2">Metodo di calcolo media</p>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-4">
              {Object.entries(METODI_MEDIA).map(([key, m]) => {
                const isSel = key === metodoMedia;
                const isSug = key === suggerito.metodo;
                return (
                  <button
                    key={key}
                    type="button"
                    onClick={() => setMetodoMedia(key)}
                    className={cn(
                      'text-left rounded-xl border bg-white p-3 transition-all hover:shadow-soft flex flex-col gap-2',
                      isSel
                        ? 'ring-2 ring-brand-500 bg-brand-50/40 border-brand-300'
                        : 'border-slate-200 hover:border-brand-200',
                    )}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex items-center gap-2 min-w-0">
                        <span className="text-xl shrink-0" aria-hidden="true">{m.icon}</span>
                        <div className="min-w-0">
                          <p className="font-semibold text-sm text-slate-900 truncate">{m.nome}</p>
                          {isSug && (
                            <span className="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider text-emerald-700 bg-emerald-100 border border-emerald-200 px-1.5 py-0.5 rounded-full mt-0.5">
                              🎯 consigliato
                            </span>
                          )}
                        </div>
                      </div>
                      <span className="text-base text-brand-600 leading-none shrink-0">{isSel ? '●' : '○'}</span>
                    </div>
                    <p className="text-xs text-slate-600 leading-snug">{m.breve}</p>
                  </button>
                );
              })}
            </div>

            <p className="c-field__label mb-2 flex items-center justify-between">
              <span>Criteri di valutazione</span>
              <span className="text-xs font-mono text-slate-600">
                Tot:{' '}
                <span className={cn('font-bold', totalPeso === 100 ? 'text-emerald-600' : 'text-amber-600')}>
                  {totalPeso}%
                </span>
              </span>
            </p>
            <div className="space-y-2">
              {criteri.map((c, i) => (
                <div key={i} className="grid grid-cols-12 gap-3 items-end">
                  <label className="col-span-7 c-field">
                    {i === 0 && <span className="c-field__label">Etichetta</span>}
                    <input
                      type="text"
                      className="c-input"
                      value={c.label}
                      onChange={(e) => updateCriterio(i, 'label', e.target.value)}
                      placeholder="Tecnica"
                    />
                  </label>
                  <label className="col-span-4 c-field">
                    {i === 0 && <span className="c-field__label">Peso (%)</span>}
                    <div className="relative">
                      <input
                        type="number"
                        step={1}
                        min={0}
                        max={100}
                        className="c-input pr-7"
                        value={c.peso}
                        onChange={(e) => updateCriterio(i, 'peso', Number(e.target.value))}
                      />
                      <span className="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-slate-500 pointer-events-none">
                        %
                      </span>
                    </div>
                  </label>
                  <button
                    type="button"
                    onClick={() => removeCriterio(i)}
                    className="col-span-1 h-9 text-rose-600 hover:bg-rose-50 rounded-md flex items-center justify-center"
                    title="Rimuovi"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              ))}
            </div>
            <button
              type="button"
              onClick={addCriterio}
              className="mt-2 text-xs font-medium text-brand-700 hover:text-brand-900 inline-flex items-center gap-1"
            >
              + Aggiungi criterio
            </button>
          </section>

          <DialogFooter>
            <button type="button" className="c-btn c-btn--outline" onClick={() => onOpenChange(false)} disabled={saving}>
              Annulla
            </button>
            <button type="submit" className="c-btn c-btn--primary" disabled={saving}>
              {saving ? 'Creazione…' : 'Crea fasi'}
            </button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// SharedFieldsDialog — batch edit dei campi condivisi (porta openSharedFieldsModal).
// Per ogni campo una checkbox "modifica": solo i campi spuntati vengono
// propagati a TUTTE le sotto-fasi del gruppo (commissione/scala/tempo/modo/
// metodo via updateFase; criteri via syncCriteri). I campi in drift mostrano
// un tag di avviso.
// ---------------------------------------------------------------------------

interface SharedFieldsDialogProps {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  concorsoId: string;
  group: FaseGroup;
  commissioni: CommissioneRecord[] | undefined;
  onSaved: () => void;
}

function SharedFieldsDialog({
  open,
  onOpenChange,
  concorsoId,
  group,
  commissioni,
  onSaved,
}: SharedFieldsDialogProps) {
  const qc = useQueryClient();
  const fasi = group.fasi;
  const drift = computeDrift(fasi);

  // Valori consensus (se tutte le fasi concordano) o fallback.
  const curComm = (sharedValue(fasi, 'commissioneId')) ?? '';
  const curScala = (sharedValue(fasi, 'scala')) ?? 10;
  const curTempo = (sharedValue(fasi, 'tempoMinuti')) ?? 0;
  const curModo = (sharedValue(fasi, 'modoValutazione') as string | null | undefined) ?? 'autonoma';
  const curMetodo = (sharedValue(fasi, 'metodoMedia')) ?? 'aritmetica';

  const [toggles, setToggles] = useState<Record<string, boolean>>({});
  const [commValue, setCommValue] = useState('');
  const [scalaValue, setScalaValue] = useState<number | ''>(10);
  const [tempoValue, setTempoValue] = useState<number | ''>(0);
  const [modoValue, setModoValue] = useState<'autonoma' | 'sincrona'>('autonoma');
  const [metodoValue, setMetodoValue] = useState('aritmetica');
  const [criteri, setCriteri] = useState<CriterioFV[]>([]);
  const [criteriLoading, setCriteriLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  // All'apertura: ricarica i valori consensus + i criteri della prima fase
  // (rappresentano la base da propagare quando si attiva il toggle criteri).
  useEffect(() => {
    if (!open) return;
    setToggles({});
    setCommValue(curComm || '');
    setScalaValue(curScala ?? 10);
    setTempoValue(curTempo ?? 0);
    setModoValue(curModo === 'sincrona' ? 'sincrona' : 'autonoma');
    setMetodoValue(curMetodo || 'aritmetica');
    setCriteri(DEFAULT_CRITERI.map((c) => ({ ...c })));
    const base = fasi[0];
    if (base) {
      setCriteriLoading(true);
      listCriteri(base.id)
        .then((rows) => {
          if (rows.length > 0) {
            setCriteri(rows.map((r) => ({ label: r.nome, key: '', peso: Number(r.peso) || 0 })));
          }
        })
        .catch(() => {})
        .finally(() => setCriteriLoading(false));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const totalPeso = criteri.reduce((s, c) => s + (Number(c.peso) || 0), 0);
  const updateCriterio = (idx: number, field: keyof CriterioFV, val: string | number) =>
    setCriteri((p) => p.map((c, i) => (i === idx ? { ...c, [field]: val } : c)));
  const addCriterio = () => setCriteri((p) => [...p, { label: '', key: '', peso: 0 }]);
  const removeCriterio = (idx: number) =>
    setCriteri((p) => (p.length > 1 ? p.filter((_, i) => i !== idx) : p));

  const toggle = (key: string) => setToggles((p) => ({ ...p, [key]: !p[key] }));

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    const patch: UpdateFaseBody = {};
    if (toggles.commissioneId) patch.commissioneId = commValue || null;
    if (toggles.scala) patch.scala = Number(scalaValue) || 0;
    if (toggles.tempoMinuti) patch.tempoMinuti = Number(tempoValue) || 0;
    if (toggles.modoValutazione) patch.modoValutazione = modoValue;
    if (toggles.metodoMedia) patch.metodoMedia = metodoValue;

    let criteriPatch: CriterioInput[] | null = null;
    if (toggles.criteri) {
      criteriPatch = criteri
        .map((c, i) => ({ nome: c.label.trim(), peso: Math.max(0, Math.min(100, Number(c.peso) || 0)), ordine: i }))
        .filter((c) => c.nome);
      if (criteriPatch.length === 0) {
        toast.error('Almeno un criterio richiesto');
        return;
      }
    }

    if (Object.keys(patch).length === 0 && !criteriPatch) {
      toast.warning('Seleziona almeno un campo da modificare');
      return;
    }

    setSaving(true);
    // Applica a TUTTE le sotto-fasi; allSettled per non perdere update parziali.
    const results = await Promise.allSettled(
      fasi.map(async (f) => {
        if (Object.keys(patch).length > 0) await updateFase(f.id, patch);
        if (criteriPatch) await syncCriteri(f.id, criteriPatch);
      }),
    );
    const ok = results.filter((r) => r.status === 'fulfilled').length;
    const ko = results.filter((r) => r.status === 'rejected');
    if (ko.length === 0) {
      toast.success(`Configurazione propagata a ${ok} sotto-fasi`);
    } else {
      toast.error(`Aggiornate ${ok}/${fasi.length} — ${ko.length} errori`);
    }
    await qc.invalidateQueries({ queryKey: FASI_QUERY_KEY(concorsoId) });
    setSaving(false);
    onSaved();
    onOpenChange(false);
  };

  const fieldWrap = (key: string, label: string, isDrift: boolean, control: ReactNode, help: string) => (
    <div className={cn('border rounded-xl p-3', isDrift ? 'border-amber-200 bg-amber-50/30' : 'border-slate-200 bg-white')}>
      <label className="flex items-start gap-3">
        <input type="checkbox" className="mt-1 w-4 h-4" checked={!!toggles[key]} onChange={() => toggle(key)} />
        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <span className="font-semibold text-sm text-slate-800">{label}</span>
            {isDrift && (
              <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full bg-amber-100 text-amber-800 border border-amber-200">
                ⚠ diverso tra fasi
              </span>
            )}
          </div>
          <div className="mt-2">{control}</div>
          <p className="text-[11px] text-slate-500 mt-1.5">{help}</p>
        </div>
      </label>
    </div>
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-4xl sm:p-8">
        <DialogHeader>
          <DialogTitle>Configurazione condivisa</DialogTitle>
          <DialogDescription className="sr-only">
            Modifica i campi condivisi e propagali a tutte le sotto-fasi del gruppo.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={onSubmit} className="space-y-4 overflow-y-auto max-h-[76dvh] pr-2">
          <div className="bg-brand-50/60 border border-brand-100 rounded-xl px-4 py-3 text-sm text-slate-700">
            <p>
              Modifica i campi che vuoi applicare a tutte le {fasi.length} sotto-fasi di questo gruppo. I campi senza
              spunta restano invariati su ogni sotto-fase.
            </p>
          </div>

          {fieldWrap(
            'commissioneId',
            'Commissione',
            drift.includes('commissioneId'),
            <select className="c-input w-full" value={commValue} onChange={(e) => setCommValue(e.target.value)}>
              <option value="">— Nessuna —</option>
              {commissioni?.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.nome} · {c.commissari.length} comm.
                </option>
              ))}
            </select>,
            drift.includes('commissioneId')
              ? 'Attiva la spunta e imposta il nuovo valore: verrà propagato a tutte le sotto-fasi, sovrascrivendo le differenze attuali.'
              : 'Attiva la spunta per modificare questo campo su tutte le sotto-fasi.',
          )}

          {fieldWrap(
            'scala',
            'Scala di voto',
            drift.includes('scala'),
            <input
              type="number"
              className="c-input w-full"
              min={1}
              max={100}
              value={scalaValue}
              onChange={(e) => setScalaValue(e.target.value === '' ? '' : Number(e.target.value))}
            />,
            drift.includes('scala')
              ? 'Attiva la spunta e imposta il nuovo valore: verrà propagato a tutte le sotto-fasi, sovrascrivendo le differenze attuali.'
              : 'Attiva la spunta per modificare questo campo su tutte le sotto-fasi.',
          )}

          {fieldWrap(
            'tempoMinuti',
            'Tempo per candidato (min)',
            drift.includes('tempoMinuti'),
            <input
              type="number"
              className="c-input w-full"
              min={0}
              max={600}
              value={tempoValue}
              onChange={(e) => setTempoValue(e.target.value === '' ? '' : Number(e.target.value))}
            />,
            drift.includes('tempoMinuti')
              ? 'Attiva la spunta e imposta il nuovo valore: verrà propagato a tutte le sotto-fasi, sovrascrivendo le differenze attuali.'
              : 'Attiva la spunta per modificare questo campo su tutte le sotto-fasi.',
          )}

          {fieldWrap(
            'modoValutazione',
            'Modalità di valutazione',
            drift.includes('modoValutazione'),
            <select
              className="c-input w-full"
              value={modoValue}
              onChange={(e) => setModoValue(e.target.value === 'sincrona' ? 'sincrona' : 'autonoma')}
            >
              <option value="autonoma">Autonoma</option>
              <option value="sincrona">Sincrona</option>
            </select>,
            drift.includes('modoValutazione')
              ? 'Attiva la spunta e imposta il nuovo valore: verrà propagato a tutte le sotto-fasi, sovrascrivendo le differenze attuali.'
              : 'Attiva la spunta per modificare questo campo su tutte le sotto-fasi.',
          )}

          {fieldWrap(
            'metodoMedia',
            'Metodo di media',
            drift.includes('metodoMedia'),
            <select className="c-input w-full" value={metodoValue} onChange={(e) => setMetodoValue(e.target.value)}>
              {Object.entries(METODI_MEDIA).map(([k, m]) => (
                <option key={k} value={k}>
                  {m.nome}
                </option>
              ))}
            </select>,
            drift.includes('metodoMedia')
              ? 'Attiva la spunta e imposta il nuovo valore: verrà propagato a tutte le sotto-fasi, sovrascrivendo le differenze attuali.'
              : 'Attiva la spunta per modificare questo campo su tutte le sotto-fasi.',
          )}

          {/* Criteri: blocco dedicato con editor pesi (toggle key="criteri") */}
          <div
            className={cn(
              'border rounded-xl p-3',
              drift.includes('pesi') ? 'border-amber-200 bg-amber-50/30' : 'border-slate-200 bg-white',
            )}
          >
            <label className="flex items-start gap-3">
              <input
                type="checkbox"
                className="mt-1 w-4 h-4"
                checked={!!toggles.criteri}
                onChange={() => toggle('criteri')}
              />
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <span className="font-semibold text-sm text-slate-800">Criteri di valutazione</span>
                  {drift.includes('pesi') && (
                    <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full bg-amber-100 text-amber-800 border border-amber-200">
                      ⚠ diverso tra fasi
                    </span>
                  )}
                  <span className="text-xs font-mono text-slate-600 ml-auto">
                    Tot:{' '}
                    <span className={cn('font-bold', totalPeso === 100 ? 'text-emerald-600' : 'text-amber-600')}>
                      {totalPeso}%
                    </span>
                  </span>
                </div>
                <p className="text-[11px] text-slate-500 mt-1.5 mb-2">
                  Attiva la spunta per propagare la stessa lista di criteri/pesi a tutte le sotto-fasi.
                </p>
                {criteriLoading ? (
                  <p className="text-xs text-slate-400 italic">Caricamento criteri…</p>
                ) : (
                  <div className="space-y-2">
                    {criteri.map((c, i) => (
                      <div key={i} className="grid grid-cols-12 gap-2 items-end">
                        <label className="col-span-8 c-field">
                          {i === 0 && <span className="c-field__label">Etichetta</span>}
                          <input
                            type="text"
                            className="c-input"
                            value={c.label}
                            onChange={(e) => updateCriterio(i, 'label', e.target.value)}
                            placeholder="Tecnica"
                          />
                        </label>
                        <label className="col-span-3 c-field">
                          {i === 0 && <span className="c-field__label">Peso (%)</span>}
                          <input
                            type="number"
                            step={1}
                            min={0}
                            max={100}
                            className="c-input"
                            value={c.peso}
                            onChange={(e) => updateCriterio(i, 'peso', Number(e.target.value))}
                          />
                        </label>
                        <button
                          type="button"
                          onClick={() => removeCriterio(i)}
                          className="col-span-1 h-9 text-rose-600 hover:bg-rose-50 rounded-md flex items-center justify-center"
                          title="Rimuovi"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    ))}
                    <button
                      type="button"
                      onClick={addCriterio}
                      className="text-xs font-medium text-brand-700 hover:text-brand-900 inline-flex items-center gap-1"
                    >
                      + Aggiungi criterio
                    </button>
                  </div>
                )}
              </div>
            </label>
          </div>

          <DialogFooter>
            <button type="button" className="c-btn c-btn--outline" onClick={() => onOpenChange(false)} disabled={saving}>
              Annulla
            </button>
            <button type="submit" className="c-btn c-btn--primary" disabled={saving}>
              {saving ? 'Applicazione…' : 'Applica alle sotto-fasi'}
            </button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// FasiTab (exported)
// ---------------------------------------------------------------------------

export function FasiTab({ concorsoId }: { concorsoId: string }) {
  const qc = useQueryClient();
  const { data: fasi, isLoading, isError } = useFasi(concorsoId);
  // Sezioni: servono per enumerare i gruppi (una "fase madre" per sezione).
  const { data: sezioni } = useSezioni(concorsoId);
  const { data: commissioni } = useCommissioni(concorsoId);

  const sorted = [...(fasi ?? [])].sort((a, b) => a.ordine - b.ordine);

  // Vista raggruppata: attiva quando il concorso ha sezioni. Senza sezioni
  // (legacy / micro-concorsi) si usa la vista piatta come prima.
  const useGrouped = (sezioni?.length ?? 0) > 0;
  const groups = useMemo(
    () => gruppoFasi(sorted, sezioni ?? []),
    // sorted è ricalcolato a ogni render (nuovo array) ma il contenuto cambia solo con `fasi`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [fasi, sezioni],
  );

  // form: { existing } = modifica fase; { prefill } = "+ Aggiungi sotto-fase"
  // (delega al form con sezioni_ids + campi condivisi del gruppo pre-popolati).
  const [formDialog, setFormDialog] = useState<{
    open: boolean;
    existing?: FaseRecord;
    prefill?: FasePrefill;
  }>({ open: false });

  const [wizardDialog, setWizardDialog] = useState<{ open: boolean; group?: FaseGroup }>({
    open: false,
  });
  const [sharedDialog, setSharedDialog] = useState<{ open: boolean; group?: FaseGroup }>({
    open: false,
  });

  const [confirmState, setConfirmState] = useState<{
    open: boolean;
    title: string;
    description: string;
    confirmLabel?: string;
    danger?: boolean;
    loading: boolean;
    onConfirm: () => Promise<void>;
  }>({
    open: false,
    title: '',
    description: '',
    loading: false,
    onConfirm: async () => {},
  });

  const openConfirm = useCallback(
    (opts: {
      title: string;
      description: string;
      confirmLabel?: string;
      danger?: boolean;
      onConfirm: () => Promise<void>;
    }) => {
      setConfirmState({ open: true, loading: false, ...opts });
    },
    [],
  );

  const invalidate = useCallback(
    () => qc.invalidateQueries({ queryKey: FASI_QUERY_KEY(concorsoId) }),
    [qc, concorsoId],
  );

  // ── Reorder ───────────────────────────────────────────────────────────────
  const handleReorder = async (faseId: string, direction: 'up' | 'down') => {
    const idx = sorted.findIndex((f) => f.id === faseId);
    const newIdx = direction === 'up' ? idx - 1 : idx + 1;
    if (newIdx < 0 || newIdx >= sorted.length) return;
    const ids = sorted.map((f) => f.id);
    [ids[idx], ids[newIdx]] = [ids[newIdx], ids[idx]];
    try {
      await reorderFasi(concorsoId, ids);
      await invalidate();
    } catch (e) {
      toast.error(httpErrorMessage(e));
    }
  };

  // ── Delete ────────────────────────────────────────────────────────────────
  const handleDelete = (fase: FaseRecord) => {
    openConfirm({
      title: 'Elimina fase',
      description: `Eliminare definitivamente "${fase.nome}"? Tutte le valutazioni associate andranno perse.`,
      confirmLabel: 'Elimina',
      danger: true,
      onConfirm: async () => {
        try {
          await deleteFase(fase.id);
          toast.success('Fase eliminata');
          await invalidate();
        } catch (e) {
          toast.error(httpErrorMessage(e));
        }
      },
    });
  };

  // ── Start ─────────────────────────────────────────────────────────────────
  const handleStart = (fase: FaseRecord) => {
    openConfirm({
      title: 'Avvia fase',
      description: `Avviare "${fase.nome}"? Lo stato cambierà a IN CORSO.`,
      confirmLabel: 'Avvia',
      onConfirm: async () => {
        try {
          await startFase(fase.id);
          toast.success('Fase avviata');
          await invalidate();
        } catch (e) {
          toast.error(httpErrorMessage(e));
        }
      },
    });
  };

  // ── Conclude ──────────────────────────────────────────────────────────────
  const handleConclude = (fase: FaseRecord) => {
    openConfirm({
      title: 'Concludi fase',
      description: `Concludere "${fase.nome}"? Non sarà più modificabile.`,
      confirmLabel: 'Concludi',
      onConfirm: async () => {
        try {
          await concludiFase(fase.id);
          toast.success('Fase conclusa');
          await invalidate();
        } catch (e) {
          toast.error(httpErrorMessage(e));
        }
      },
    });
  };

  // ── Sorteggio ─────────────────────────────────────────────────────────────
  const handleSorteggio = (fase: FaseRecord) => {
    openConfirm({
      title: 'Sorteggio ordine candidati',
      description: `Generare un nuovo ordine casuale dei candidati per "${fase.nome}"?`,
      confirmLabel: 'Sorteggia',
      onConfirm: async () => {
        try {
          const result = await sorteggiaFase(fase.id);
          toast.success(`Ordine sorteggiato (seed: ${result.seed})`);
          await invalidate();
        } catch (e) {
          toast.error(httpErrorMessage(e));
        }
      },
    });
  };

  // ── Add sotto-fase (delega al form con prefill dei campi condivisi) ─────────
  // Replica il ramo `group.fasi.length > 0` di openFaseWizard.
  const handleAddFase = (group: FaseGroup) => {
    const prefill: FasePrefill = { sezioniIds: group.sezioneIds.slice() };
    const sScala = sharedValue(group.fasi, 'scala');
    if (sScala !== undefined) prefill.scala = sScala;
    const sTempo = sharedValue(group.fasi, 'tempoMinuti');
    if (sTempo !== undefined && sTempo != null) prefill.tempoMinuti = sTempo;
    const sModo = sharedValue(group.fasi, 'modoValutazione');
    if (sModo === 'autonoma' || sModo === 'sincrona') prefill.modoValutazione = sModo;
    const sMetodo = sharedValue(group.fasi, 'metodoMedia');
    if (sMetodo) prefill.metodoMedia = sMetodo;
    const sComm = sharedValue(group.fasi, 'commissioneId');
    if (sComm !== undefined) prefill.commissioneId = sComm;
    setFormDialog({ open: true, prefill });
  };

  // ── Elimina gruppo: cancella TUTTE le sotto-fasi del gruppo ─────────────────
  // Blocco preventivo se c'è qualcosa IN_CORSO (replica delete-group vanilla).
  const handleDeleteGroup = (group: FaseGroup) => {
    const running = group.fasi.filter((f) => f.stato === 'IN_CORSO');
    if (running.length > 0) {
      toast.error(`Impossibile eliminare: ${running.length} sotto-fasi sono IN_CORSO. Concludile prima.`);
      return;
    }
    const concluse = group.fasi.filter((f) => f.stato === 'CONCLUSA').length;
    const scopeLabel =
      group.type === 'shared'
        ? 'Fasi globali (tutte le sezioni)'
        : group.sezioneIds
            .map((id) => sezioni?.find((s) => s.id === id)?.nome)
            .filter(Boolean)
            .join(', ');
    openConfirm({
      title: 'Elimina gruppo di fasi',
      description:
        `Stai per eliminare tutte e ${group.fasi.length} le sotto-fasi del gruppo "${scopeLabel}".` +
        (concluse > 0
          ? ` ⚠ ${concluse} sotto-fasi sono CONCLUSE: tutte le valutazioni associate andranno perse irrimediabilmente.`
          : '') +
        " L'operazione non è reversibile.",
      confirmLabel: 'Elimina tutte',
      danger: true,
      onConfirm: async () => {
        // Sequenziale: ogni delete invalida il dataset → evito race.
        const failed: string[] = [];
        for (const f of group.fasi) {
          try {
            await deleteFase(f.id);
          } catch (e) {
            failed.push(`${f.nome}: ${httpErrorMessage(e)}`);
          }
        }
        if (failed.length === 0) {
          toast.success(`${group.fasi.length} sotto-fasi eliminate`);
        } else {
          const ok = group.fasi.length - failed.length;
          toast.error(`Eliminate ${ok}/${group.fasi.length} — ${failed.slice(0, 3).join(' · ')}`);
        }
        await invalidate();
      },
    });
  };

  // ── Render ────────────────────────────────────────────────────────────────

  const nextOrdine = sorted.length > 0 ? (sorted[sorted.length - 1]?.ordine ?? 0) + 1 : 1;

  if (isLoading) {
    return (
      <div className="space-y-3">
        {[1, 2, 3].map((i) => (
          <div
            key={i}
            className="h-28 rounded-2xl border border-slate-200 bg-slate-50 animate-pulse"
          />
        ))}
      </div>
    );
  }

  if (isError) {
    return (
      <div className="flex items-center gap-2 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
        <TriangleAlert className="h-4 w-4 shrink-0" />
        Errore nel caricamento delle fasi.
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* ── Header ────────────────────────────────────────────────────── */}
      {/* In vista raggruppata il pulsante crea una FASE GLOBALE (sezioni_ids
          vuoto). Le altre creazioni partono dalle card-gruppo. In vista piatta
          (legacy) è il classico "Nuova fase". */}
      <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
        <p className="text-sm text-slate-600">
          {sorted.length} {sorted.length === 1 ? 'fase' : 'fasi'}
        </p>
        <button
          type="button"
          onClick={() => setFormDialog({ open: true, prefill: { sezioniIds: [] } })}
          className="text-sm font-medium text-slate-700 bg-white border border-slate-200 hover:bg-slate-50 px-3 py-2 rounded-lg inline-flex items-center gap-1"
        >
          {useGrouped ? (
            <>＋ Fase globale</>
          ) : (
            <>
              <Plus className="h-4 w-4" />
              Nuova fase
            </>
          )}
        </button>
      </div>

      {/* ── Guidance banner (collapsible) ─────────────────────────────── */}
      <details
        open={sorted.length === 0}
        className="bg-brand-50/60 border border-brand-100 rounded-2xl mb-4 group"
      >
        <summary className="cursor-pointer list-none px-4 py-3 flex items-center gap-2.5 select-none">
          <span className="w-7 h-7 rounded-full bg-brand-100 text-brand-700 inline-flex items-center justify-center text-sm shrink-0">
            💡
          </span>
          <span className="text-sm font-semibold text-brand-900">Guida alle fasi del concorso</span>
          <span className="ml-auto text-brand-600 group-open:rotate-180 transition-transform text-sm" aria-hidden="true">
            ▾
          </span>
        </summary>
        <div className="px-4 pb-4 pt-1 text-[13px] text-slate-700 leading-relaxed">
          {/* Intro + 10 tip di guida — testo identico al vanilla (fasiGuidanceHtml).
              SICUREZZA: i body contengono HTML (<strong>/<em>/<code>) deliberato →
              dangerouslySetInnerHTML. Il contenuto è una COSTANTE hardcoded
              (GUIDE_TIPS, sotto) e la stringa letterale qui: NON proviene mai dal
              backend né da input utente. Se in futuro diventasse dinamico,
              sostituire con rendering markdown/JSX o sanitizzare con DOMPurify. */}
          <p
            className="mb-3"
            dangerouslySetInnerHTML={{
              __html:
                'La pagina è organizzata <strong>per sezione</strong>: ogni card è una "fase madre" che contiene una o più <em>sotto-fasi</em> (eliminatoria, semifinale, finale…). I candidati ammessi al termine di una sotto-fase passano automaticamente alla successiva della stessa sezione.',
            }}
          />
          <ul className="space-y-1.5 pl-1">
            {GUIDE_TIPS.map((tip) => (
              <li key={tip.title}>
                {tip.emoji} <strong>{tip.title}</strong> —{' '}
                <span dangerouslySetInnerHTML={{ __html: tip.body }} />
              </li>
            ))}
          </ul>
          <p className="mt-3 text-xs text-slate-500 italic">
            Suggerimento: prima di configurare le fasi assicurati di aver definito sezioni,
            candidati, commissari e (opzionalmente) commissioni.
          </p>
        </div>
      </details>

      {/* ── Body: vista raggruppata (fase madre per sezione) o piatta (legacy) ── */}
      {useGrouped ? (
        <div className="space-y-4">
          {groups.map((g) => (
            <GroupCard
              key={g.key}
              group={g}
              sezioni={sezioni}
              commissioni={commissioni}
              onWizard={() => setWizardDialog({ open: true, group: g })}
              onAddFase={() => handleAddFase(g)}
              onEditShared={() => setSharedDialog({ open: true, group: g })}
              onDeleteGroup={() => handleDeleteGroup(g)}
              renderRow={(fase) => {
                // isFirst/isLast usano l'ordine GLOBALE: il reorder è globale,
                // non per-gruppo (replica move-up/down della vista vanilla).
                const globalIdx = sorted.findIndex((f) => f.id === fase.id);
                return (
                  <InnerFaseRow
                    key={fase.id}
                    fase={fase}
                    drift={computeDrift(g.fasi)}
                    isFirst={globalIdx === 0}
                    isLast={globalIdx === sorted.length - 1}
                    commissioni={commissioni}
                    onEdit={() => setFormDialog({ open: true, existing: fase })}
                    onDelete={() => handleDelete(fase)}
                    onStart={() => handleStart(fase)}
                    onConclude={() => handleConclude(fase)}
                    onSorteggio={() => handleSorteggio(fase)}
                    onMoveUp={() => handleReorder(fase.id, 'up')}
                    onMoveDown={() => handleReorder(fase.id, 'down')}
                  />
                );
              }}
            />
          ))}
        </div>
      ) : sorted.length === 0 ? (
        <div className="bg-white border-2 border-dashed border-slate-200 rounded-2xl p-8 sm:p-10 text-center">
          <div className="text-5xl mb-3">🎼</div>
          <h3 className="text-lg font-bold text-slate-800">Nessuna fase configurata</h3>
          <p className="text-sm text-slate-600 mt-2 max-w-xl mx-auto">
            Crea la prima fase del concorso per definire come si svolgerà la valutazione.
          </p>
          <ol className="text-left max-w-md mx-auto mt-5 space-y-2.5 text-sm text-slate-700">
            <li className="flex gap-3 items-start">
              <span className="w-5 h-5 rounded-full bg-brand-100 text-brand-700 text-xs font-bold inline-flex items-center justify-center shrink-0 mt-0.5">
                1
              </span>
              <span>Clicca <strong>Nuova fase</strong> per creare la prima fase (es. "Eliminatoria").</span>
            </li>
            <li className="flex gap-3 items-start">
              <span className="w-5 h-5 rounded-full bg-brand-100 text-brand-700 text-xs font-bold inline-flex items-center justify-center shrink-0 mt-0.5">
                2
              </span>
              <span>Configura scala di voto, criteri e commissione per ciascuna fase.</span>
            </li>
            <li className="flex gap-3 items-start">
              <span className="w-5 h-5 rounded-full bg-brand-100 text-brand-700 text-xs font-bold inline-flex items-center justify-center shrink-0 mt-0.5">
                3
              </span>
              <span>Avvia la fase quando sei pronto: i commissari potranno iniziare a votare.</span>
            </li>
          </ol>
          <button
            type="button"
            onClick={() => setFormDialog({ open: true, prefill: { sezioniIds: [] } })}
            className="mt-6 c-btn c-btn--primary inline-flex items-center gap-1.5"
          >
            <Plus className="h-4 w-4" />
            Crea la prima fase
          </button>
        </div>
      ) : (
        <div className="space-y-3">
          {sorted.map((fase, idx) => (
            <FaseCard
              key={fase.id}
              fase={fase}
              isFirst={idx === 0}
              isLast={idx === sorted.length - 1}
              onEdit={() => setFormDialog({ open: true, existing: fase })}
              onDelete={() => handleDelete(fase)}
              onStart={() => handleStart(fase)}
              onConclude={() => handleConclude(fase)}
              onSorteggio={() => handleSorteggio(fase)}
              onMoveUp={() => handleReorder(fase.id, 'up')}
              onMoveDown={() => handleReorder(fase.id, 'down')}
            />
          ))}
        </div>
      )}

      {/* ── Form dialog (modifica / + sotto-fase / fase globale) ──────────── */}
      {formDialog.open && (
        <FaseFormDialog
          key={formDialog.existing?.id ?? `new:${JSON.stringify(formDialog.prefill ?? {})}`}
          open={formDialog.open}
          onOpenChange={(v) => setFormDialog((p) => ({ ...p, open: v }))}
          concorsoId={concorsoId}
          existing={formDialog.existing}
          prefill={formDialog.prefill}
          nextOrdine={nextOrdine}
          onSaved={() => setFormDialog({ open: false })}
        />
      )}

      {/* ── Wizard dialog (sequenza fasi per un gruppo vuoto) ─────────────── */}
      {wizardDialog.open && wizardDialog.group && (
        <FaseWizardDialog
          key={wizardDialog.group.key}
          open={wizardDialog.open}
          onOpenChange={(v) => setWizardDialog((p) => ({ ...p, open: v }))}
          concorsoId={concorsoId}
          group={wizardDialog.group}
          nextOrdine={nextOrdine}
          onSaved={() => setWizardDialog({ open: false })}
        />
      )}

      {/* ── Shared-fields dialog (batch edit campi condivisi) ─────────────── */}
      {sharedDialog.open && sharedDialog.group && (
        <SharedFieldsDialog
          key={sharedDialog.group.key}
          open={sharedDialog.open}
          onOpenChange={(v) => setSharedDialog((p) => ({ ...p, open: v }))}
          concorsoId={concorsoId}
          group={sharedDialog.group}
          commissioni={commissioni}
          onSaved={() => setSharedDialog({ open: false })}
        />
      )}

      {/* ── Confirm dialog ────────────────────────────────────────────── */}
      <ConfirmDialog
        open={confirmState.open}
        onOpenChange={(v) => setConfirmState((p) => ({ ...p, open: v }))}
        title={confirmState.title}
        description={confirmState.description}
        confirmLabel={confirmState.confirmLabel}
        danger={confirmState.danger}
        loading={confirmState.loading}
        onConfirm={confirmState.onConfirm}
      />
    </div>
  );
}

export default FasiTab;
