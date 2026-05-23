// @ts-check
// Phase-specific evaluation logic.
// Each fase can define its own list of criteri ({key,label,peso}) — number,
// labels and weights are fully configurable. The classic 4-criterion scheme
// (Tecnica/Interpretazione/Intonazione/Musicalità) is the DEFAULT used when a
// fase doesn't override it (backward compat with the original spec).

// Default weights per fase ordine (legacy spec).
export const PESI = {
  1: { tecnica: 0.40, interpretazione: 0.30, intonazione: 0.20, musicalita: 0.10 },
  2: { tecnica: 0.35, interpretazione: 0.35, intonazione: 0.15, musicalita: 0.15 },
  3: { tecnica: 0.30, interpretazione: 0.40, intonazione: 0.10, musicalita: 0.20 },
};

// Default criteri keys & labels.
export const DEFAULT_CRITERI_KEYS = ['tecnica','interpretazione','intonazione','musicalita'];
export const DEFAULT_CRITERI_LABEL = {
  tecnica: 'Tecnica',
  interpretazione: 'Interpretazione',
  intonazione: 'Intonazione',
  musicalita: 'Musicalità',
};
// Legacy aliases (retained so old imports keep working).
export const CRITERI = DEFAULT_CRITERI_KEYS;
export const CRITERI_LABEL = DEFAULT_CRITERI_LABEL;

// Build the default criteri array for a given fase ordine.
export function defaultCriteri(ordine = 1) {
  const w = PESI[ordine] || PESI[1];
  return DEFAULT_CRITERI_KEYS.map(k => ({
    key: k,
    label: DEFAULT_CRITERI_LABEL[k],
    peso: w[k] || 0,
  }));
}

// Slugify a label into a safe key.
export function slugifyKey(s) {
  return String(s || '').toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 30) || 'crit';
}

// Resolve the criteri list of a fase. Supports:
//   • fase.criteri = [{key,label,peso}, …]  (preferred, dynamic)
//   • fase.pesi    = {tecnica:..., …}        (legacy mapping, builds default 4-criteri)
//   • else: defaults from PESI[ordine].
export function getCriteri(faseOrOrdine) {
  if (faseOrOrdine && typeof faseOrOrdine === 'object') {
    if (Array.isArray(faseOrOrdine.criteri) && faseOrOrdine.criteri.length > 0) {
      return faseOrOrdine.criteri.map((c, i) => ({
        key:   c.key   || slugifyKey(c.label) || `crit_${i+1}`,
        label: c.label || c.key || `Criterio ${i+1}`,
        peso:  Number(c.peso) || 0,
      }));
    }
    if (faseOrOrdine.pesi && typeof faseOrOrdine.pesi === 'object') {
      return DEFAULT_CRITERI_KEYS.map(k => ({
        key: k, label: DEFAULT_CRITERI_LABEL[k], peso: Number(faseOrOrdine.pesi[k]) || 0,
      }));
    }
    if (faseOrOrdine.ordine != null) return defaultCriteri(faseOrOrdine.ordine);
    return defaultCriteri(1);
  }
  return defaultCriteri(faseOrOrdine);
}

// Backward-compat: returns a {key: peso} map. Built from getCriteri.
export function getPesiFor(faseOrOrdine) {
  const out = {};
  getCriteri(faseOrOrdine).forEach(c => { out[c.key] = c.peso || 0; });
  return out;
}

// Total weighted score for a single commissario across the fase's criteri.
export function pesato(voti, faseOrOrdine) {
  const criteri = getCriteri(faseOrOrdine);
  return criteri.reduce((s, c) => s + (Number(voti[c.key]) || 0) * (c.peso || 0), 0);
}

// Aggregate per-candidato media across all commissioners' weighted totals.
// Uses the fase-configured criteri (number/labels/pesi) and metodo_media.
export function mediaCandidato(valutazioni, faseOrOrdine) {
  const criteri = getCriteri(faseOrOrdine);
  const metodo = getMetodoMedia(faseOrOrdine);
  const byCom = {};
  valutazioni.forEach(v => {
    (byCom[v.commissario_id] ||= {})[v.criterio] = v.voto;
  });
  const totals = Object.values(byCom).map(voti =>
    criteri.reduce((s, c) => s + (Number(voti[c.key]) || 0) * (c.peso || 0), 0)
  );
  if (!totals.length) return 0;
  return computeAggregate(totals, metodo);
}

// ---------------- Aggregation methods ----------------

export const METODI_MEDIA = {
  aritmetica: {
    nome: 'Media aritmetica',
    icon: '∑',
    breve: 'Somma di tutti i voti diviso il numero di commissari.',
    formula: 'media = (v₁ + v₂ + … + vₙ) / n',
    pro:    'Usa tutti i dati, semplice e trasparente.',
    contro: 'Vulnerabile a un singolo outlier (un voto molto alto o molto basso).',
    consigliata: 'Sempre, se non vuoi correggere statisticamente gli estremi.',
  },
  olimpica: {
    nome: 'Media olimpica',
    icon: '🥇',
    breve: 'Scarta il voto più alto e il più basso, media aritmetica dei restanti.',
    formula: 'media = Σ(voti escluso max e min) / (n − 2)',
    pro:    'Annulla un singolo outlier per estremo. Standard nei concorsi Olimpici / pattinaggio.',
    contro: 'Con 3 commissari resta un solo voto utile (n−2 = 1) → poco significativa.',
    consigliata: 'Da 4 commissari in su.',
  },
  winsorizzata: {
    nome: 'Media winsorizzata',
    icon: '✂️',
    breve: 'Limita gli estremi al secondo valore più alto/basso, poi fa la media aritmetica.',
    formula: 'voti[max] := voti[2°max], voti[min] := voti[2°min] → media',
    pro:    'Attenua gli outlier senza scartarli del tutto, mantiene n dati.',
    contro: 'Servono almeno 4-5 voti perché il "secondo estremo" sia rappresentativo.',
    consigliata: 'Da 5 commissari in su.',
  },
  mediana: {
    nome: 'Voto mediano',
    icon: '⊥',
    breve: 'Valore centrale dei voti ordinati (con n pari, media dei due centrali).',
    formula: 'mediana = voto in posizione (n+1)/2 dopo l\'ordinamento',
    pro:    'Massimamente robusta agli outlier — resiste anche a metà dei voti estremi.',
    contro: 'Ignora le distanze fra i voti: 7 / 7 / 7 e 5 / 7 / 9 hanno la stessa mediana.',
    consigliata: 'Robusta per qualsiasi N≥3, particolarmente buona per N piccoli (3–5).',
  },
  deviazione_std: {
    nome: 'Filtro deviazione standard',
    icon: 'σ',
    breve: 'Esclude i voti oltre ±2σ dalla media, poi ricalcola la media.',
    formula: 'escludi vᵢ con |vᵢ − μ| > 2·σ, quindi media dei rimanenti',
    pro:    'Robusta anche con outlier multipli quando il campione è grande.',
    contro: 'σ stimata su pochi voti (n<7) è instabile, può scartare voti legittimi.',
    consigliata: 'Solo con almeno 7 commissari, idealmente 10+.',
  },
};

export function getMetodoMedia(fase) {
  if (!fase) return 'aritmetica';
  const m = fase.metodo_media;
  return Object.prototype.hasOwnProperty.call(METODI_MEDIA, m) ? m : 'aritmetica';
}

export function suggerisciMetodo(nCommissari) {
  const n = Number(nCommissari) || 0;
  if (n <= 2) return { metodo: 'aritmetica', motivo: `Con ${n} commissari un filtro statistico non ha abbastanza dati per essere significativo.` };
  if (n === 3) return { metodo: 'mediana',    motivo: 'Con 3 commissari la mediana è la scelta più robusta — non viene influenzata da un singolo voto estremo.' };
  if (n <= 5)  return { metodo: 'olimpica',   motivo: `Con ${n} commissari la media olimpica scarta i due estremi e mantiene un numero significativo di voti.` };
  if (n <= 7)  return { metodo: 'mediana',    motivo: `Con ${n} commissari la mediana resta la più semplice e robusta.` };
  if (n <= 12) return { metodo: 'winsorizzata', motivo: `Con ${n} commissari la winsorizzazione attenua gli outlier mantenendo tutti i voti nel calcolo.` };
  return { metodo: 'deviazione_std', motivo: `Con ${n} commissari la deviazione standard è statisticamente affidabile e identifica voti anomali.` };
}

function aritmeticaArr(arr) {
  if (!arr.length) return 0;
  return arr.reduce((s,x) => s + x, 0) / arr.length;
}
function olimpicaArr(arr) {
  if (arr.length <= 2) return aritmeticaArr(arr);
  const sorted = [...arr].sort((a,b) => a - b);
  return aritmeticaArr(sorted.slice(1, -1));
}
function winsorizzataArr(arr) {
  if (arr.length <= 2) return aritmeticaArr(arr);
  const sorted = [...arr].sort((a,b) => a - b);
  const capped = [...sorted];
  capped[0] = sorted[1];
  capped[capped.length - 1] = sorted[sorted.length - 2];
  return aritmeticaArr(capped);
}
function medianaArr(arr) {
  if (!arr.length) return 0;
  const sorted = [...arr].sort((a,b) => a - b);
  const n = sorted.length;
  if (n % 2 === 1) return sorted[(n - 1) / 2];
  return (sorted[n/2 - 1] + sorted[n/2]) / 2;
}
function deviazioneStdArr(arr, k = 2) {
  if (arr.length < 3) return aritmeticaArr(arr);
  const mean = aritmeticaArr(arr);
  // L11: deviazione standard CAMPIONARIA (divisione per n-1, correzione di
  // Bessel). I voti dei commissari sono un campione, non la popolazione: con
  // n piccolo (3-5) la versione popolazione (÷n) sottostima la dispersione e
  // scarta voti legittimi.
  const variance = arr.reduce((s, x) => s + (x - mean) ** 2, 0) / (arr.length - 1);
  const std = Math.sqrt(variance);
  if (std === 0) return mean;
  const filtered = arr.filter(v => Math.abs(v - mean) <= k * std);
  return aritmeticaArr(filtered.length ? filtered : arr);
}

export function computeAggregate(values, metodo = 'aritmetica') {
  switch (metodo) {
    case 'olimpica':       return olimpicaArr(values);
    case 'winsorizzata':   return winsorizzataArr(values);
    case 'mediana':        return medianaArr(values);
    case 'deviazione_std': return deviazioneStdArr(values);
    case 'aritmetica':
    default:               return aritmeticaArr(values);
  }
}

// Resolve the score scale (max value of an individual vote) of a fase.
// Default 10. Backward compatible: if fase has no .scala, return 10.
export function getScala(faseOrScala) {
  if (faseOrScala == null) return 10;
  if (typeof faseOrScala === 'number') return faseOrScala || 10;
  return Number(faseOrScala.scala) || 10;
}

export function voteStep(scala) {
  return (Number(scala) || 10) <= 10 ? 0.5 : 1;
}

// Modalità di valutazione: 'autonoma' (default) o 'sincrona'.
// Sincrona: nessun commissario avanza finché tutti non hanno votato il candidato corrente.
export function getModoValutazione(fase) {
  if (!fase) return 'autonoma';
  return fase.modo_valutazione === 'sincrona' ? 'sincrona' : 'autonoma';
}

export function fmtVoto(v, scala) {
  const decimals = (Number(scala) || 10) <= 10 ? 1 : 0;
  return Number(v || 0).toFixed(decimals);
}

// Eliminatoria suggested admission: thresholds RELATIVE to scala.
// Spec defaults (scala=10):
//   - media >= 6.5  → ammesso (STANDARD), MERITO se >= 8.0;
//   - media 6.0–6.5 e al più 2 voti sotto 6 → ammesso con tolleranza (STANDARD).
// Generalized: norm = media/scala. Soglie 0.65 / 0.80 / 0.60.
export function suggestEliminatoria({ media, voti, scala = 10 }) {
  const s = Number(scala) || 10;
  const norm = s ? media / s : 0;
  if (norm >= 0.65) return { ammesso: true, fascia: norm >= 0.80 ? 'MERITO' : 'STANDARD' };
  if (norm >= 0.60) {
    const sotto = (voti || []).filter(v => (v / s) < 0.60).length;
    if (sotto <= 2) return { ammesso: true, fascia: 'STANDARD' };
  }
  return { ammesso: false, fascia: 'ELIMINATO' };
}