/**
 * VerbaleBlock.tsx
 * Port of js/views/admin/verbale.js → buildVerbaleBlock + bindVerbaleBlock
 *
 * Per-fase verbale editor with:
 *   - Tag placeholder chips (general + fase-specific)
 *   - Split editor/preview (textarea left, rendered preview right)
 *   - localStorage draft persistence per (concorso, fase)
 *   - Reset to default template
 *   - Export verbale to PDF
 */

import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { FileText, RefreshCw } from 'lucide-react';
import type { FaseRecord } from '@/api/fasi';
import type { CommissarioRecord } from '@/api/commissari';
import type { CommissioneRecord } from '@/api/commissioni';
import type { SezioneRecord } from '@/api/sezioni';
import type { Candidato, CandidatoFase } from '@/types';
import { fmtVoto, getScala, getMetodoMedia, getModoValutazione, METODI_MEDIA } from '@/lib/scoring';
import { faseFullLabel } from '@/lib/fase-label';
import type { RankedRow } from '@/lib/tiebreak';
import { jsPDF } from 'jspdf';
import { toast } from 'sonner';

// ─── Verbale tag definitions ─────────────────────────────────────────────────

interface VerbaleTagDef {
  tag: string;
  desc: string;
}

const VERBALE_TAGS_GENERAL: VerbaleTagDef[] = [
  { tag: 'concorso',       desc: 'Nome del concorso' },
  { tag: 'anno',           desc: 'Anno del concorso' },
  { tag: 'data',           desc: 'Data odierna' },
  { tag: 'presidente',     desc: 'Presidente della commissione' },
  { tag: 'commissione',    desc: 'Lista commissari (elenco puntato)' },
  { tag: 'commissari',     desc: 'Commissari (inline, separati da virgola)' },
  { tag: 'num_commissari', desc: 'Numero commissari' },
  { tag: 'num_candidati',  desc: 'Numero candidati iscritti' },
  { tag: 'fasi',           desc: 'Elenco fasi' },
  { tag: 'vincitore',      desc: 'Vincitore (1° classificato fase finale)' },
  { tag: 'podio',          desc: 'Top-3 fase finale' },
  { tag: 'risultati',      desc: 'Classifiche complete di tutte le fasi' },
  { tag: 'spareggi',       desc: 'Dettaglio spareggi applicati nel concorso' },
];

const VERBALE_TAGS_FASE: VerbaleTagDef[] = [
  { tag: 'fase',                desc: 'Nome della fase selezionata' },
  { tag: 'fase_numero',         desc: 'Numero d\'ordine della fase' },
  { tag: 'fase_data',           desc: 'Data prevista della fase' },
  { tag: 'fase_stato',          desc: 'Stato della fase' },
  { tag: 'fase_scala',          desc: 'Scala di votazione della fase' },
  { tag: 'fase_modo',           desc: 'Modalità di valutazione (sincrona/autonoma)' },
  { tag: 'fase_metodo',         desc: 'Metodo di calcolo della media' },
  { tag: 'fase_num_candidati',  desc: 'N° candidati nella fase' },
  { tag: 'fase_commissione',    desc: 'Commissari della fase (elenco puntato)' },
  { tag: 'fase_commissari',     desc: 'Commissari della fase (inline)' },
  { tag: 'fase_presidente',     desc: 'Presidente della commissione della fase' },
  { tag: 'fase_classifica',     desc: 'Classifica completa della fase' },
  { tag: 'fase_promossi',       desc: 'Solo candidati ammessi' },
  { tag: 'fase_eliminati',      desc: 'Solo candidati non ammessi' },
  { tag: 'fase_spareggi',       desc: 'Spareggi nella fase' },
];

const DEFAULT_VERBALE_TEMPLATE = `VERBALE DELLA COMMISSIONE GIUDICATRICE

Concorso: <concorso> (<anno>)
Data: <data>

Presidente: <presidente>
Commissari:
<commissione>

Numero commissari: <num_commissari>
Numero candidati totali: <num_candidati>

Fasi del concorso:
<fasi>

=== FASE: <fase> (N° <fase_numero>) ===
Stato: <fase_stato>
Data: <fase_data>
Scala di votazione: <fase_scala>
Modalità: <fase_modo>
Metodo media: <fase_metodo>
Candidati in gara: <fase_num_candidati>

Commissione:
<fase_commissione>

Classifica:
<fase_classifica>

Promossi:
<fase_promossi>

Spareggi applicati:
<fase_spareggi>

=== PODIO FINALE ===
<podio>

Spareggi nel concorso:
<spareggi>

Il presente verbale è redatto e sottoscritto dalla commissione.
`;

// ─── Helpers ──────────────────────────────────────────────────────────────────

function verbaleStorageKey(concorsoId: string, faseId: string | null): string {
  return faseId
    ? `verbale_draft_${concorsoId}_${faseId}`
    : `verbale_draft_${concorsoId}`;
}

function fmtFaseDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  try {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return iso;
    return d.toLocaleDateString('it-IT', { day: '2-digit', month: 'long', year: 'numeric' });
  } catch {
    return iso;
  }
}

function displayNameCand(cand: Candidato | null | undefined): string {
  if (!cand) return '—';
  const parts = [cand.cognome, cand.nome].filter(Boolean);
  return parts.length ? parts.join(' ') : cand.nome || '—';
}

function displayNameComm(c: CommissarioRecord | null | undefined): string {
  if (!c) return '—';
  const parts = [c.cognome, c.nome].filter(Boolean);
  return parts.length ? parts.join(' ') : c.nome;
}

function applyVerbaleTags(template: string, ctx: Record<string, string>): string {
  return template.replace(/<([a-z_]+)>/gi, (_full, name) => {
    const key = name.toLowerCase() as string;
    return Object.prototype.hasOwnProperty.call(ctx, key) ? ctx[key] : _full;
  });
}

// ─── Props ────────────────────────────────────────────────────────────────────

export interface VerbaleBlockProps {
  concorso: {
    id: string;
    nome: string;
    anno: number | null;
    anonimo: boolean;
    logoUrl?: string | null;
  };
  fasi: FaseRecord[];
  candidati: Candidato[];
  /** Key = faseId */
  rankedByFase: Map<string, RankedRow[]>;
  commissioni: CommissioneRecord[];
  commissari: CommissarioRecord[];
  sezioni: SezioneRecord[];
}

// ─── Context builder (mirrors verbale.js buildVerbaleContext) ─────────────────

function buildVerbaleContext(
  concorso: VerbaleBlockProps['concorso'],
  fasi: FaseRecord[],
  candidati: Candidato[],
  rankedByFase: Map<string, RankedRow[]>,
  commissioni: CommissioneRecord[],
  commissari: CommissarioRecord[],
  fase: FaseRecord | null,
): Record<string, string> {
  const today = new Date().toLocaleDateString('it-IT', {
    day: '2-digit',
    month: 'long',
    year: 'numeric',
  });

  // Resolve presidente(s) across all fasi of the concorso.
  const allPresidentiIds = new Set<string>();
  for (const f of fasi) {
    if (!f.commissioneId) continue;
    const comm = commissioni.find((c) => c.id === f.commissioneId);
    if (comm?.presidenteCommissarioId) allPresidentiIds.add(comm.presidenteCommissarioId);
  }

  const presidentiList = [...allPresidentiIds]
    .map((id) => commissari.find((c) => c.id === id))
    .filter((c): c is CommissarioRecord => !!c);

  const presidenteStr =
    presidentiList.length === 1
      ? displayNameComm(presidentiList[0])
      : presidentiList.length > 1
      ? presidentiList.map(displayNameComm).join(', ')
      : '—';

  // All commissari for the concorso (dedup across commissioni linked to these fasi).
  const commIds = new Set<string>();
  for (const f of fasi) {
    if (!f.commissioneId) continue;
    const comm = commissioni.find((c) => c.id === f.commissioneId);
    if (comm) comm.commissari.forEach((id) => commIds.add(id));
  }
  const allCommissari = [...commIds]
    .map((id) => commissari.find((c) => c.id === id))
    .filter((c): c is CommissarioRecord => !!c);
  const commissariNoPresIds = allCommissari.filter((c) => !allPresidentiIds.has(c.id));
  const commissioneList = commissariNoPresIds.map((c) => `· ${displayNameComm(c)}`).join('\n');
  const commissariInline = commissariNoPresIds.map(displayNameComm).join(', ');

  const fasiList = fasi.map((f) => `${f.ordine}. ${f.nome}`).join('\n');

  // Podio: final fase = highest ordine.
  const finale = fasi.reduce<FaseRecord | null>(
    (mx, f) => (!mx || f.ordine > mx.ordine ? f : mx),
    null,
  );
  let podio = '—';
  let vincitore = '—';
  if (finale?.stato === 'CONCLUSA') {
    const rows = rankedByFase.get(finale.id) ?? [];
    if (rows.length > 0) {
      const cand0 = candidati.find(
        (c) => c.id === (rows[0].cf as CandidatoFase).candidatoId,
      );
      vincitore = displayNameCand(cand0);
      podio = rows
        .filter((r) => (r.posizione_finale ?? Infinity) <= 3)
        .map((r) => {
          const pos = r.posizione_finale ?? 1;
          const place =
            pos === 1 ? '1° Premio' : pos === 2 ? '2° Premio' : '3° Premio';
          const cand = candidati.find(
            (c) => c.id === (r.cf as CandidatoFase).candidatoId,
          );
          const scala = getScala(finale);
          return `${pos}. ${displayNameCand(cand)} — ${place} (media ${r.media.toFixed(2)}/${scala})`;
        })
        .join('\n');
    }
  }

  // Classifica completa di tutte le fasi.
  const risultatiBlocks = fasi
    .map((f) => {
      const rows = rankedByFase.get(f.id) ?? [];
      if (rows.length === 0) return '';
      const scala = getScala(f);
      const lines = rows.map((r, i) => {
        const cf = r.cf as CandidatoFase;
        const cand = candidati.find((c) => c.id === cf.candidatoId);
        const esito =
          cf.stato !== 'COMPLETATO'
            ? 'in attesa'
            : cf.ammessoProssimaFase
            ? 'PROMOSSO'
            : 'ELIMINATO';
        return `  ${r.posizione_finale ?? (i + 1)}. ${displayNameCand(cand)} — ${fmtVoto(r.media, scala)}/${scala} — ${esito}`;
      });
      return `${f.nome}:\n${lines.join('\n')}`;
    })
    .filter(Boolean)
    .join('\n\n');

  // Spareggi a livello concorso.
  const spareggiBlocks = fasi
    .map((f) => {
      const rows = rankedByFase.get(f.id) ?? [];
      const involved = rows.filter(
        (r) =>
          (Array.isArray(r.tiebreak_log) && r.tiebreak_log.length > 1) ||
          r.ex_aequo_group,
      );
      if (involved.length === 0) return '';
      const lines = involved.map((r) => {
        const cand = candidati.find(
          (c) => c.id === (r.cf as CandidatoFase).candidatoId,
        );
        const motivazioni = (r.tiebreak_log ?? [])
          .filter((s) => s.motivazione)
          .map((s) => s.motivazione)
          .join(' → ');
        const exa = r.ex_aequo_group ? ' [EX AEQUO]' : '';
        return `  ${r.posizione_finale}° — #${String(cand?.numeroCandidato ?? '').padStart(3, '0')} ${displayNameCand(cand)}${exa}: ${motivazioni}`;
      });
      return `Fase ${f.ordine}: ${f.nome}\n${lines.join('\n')}`;
    })
    .filter(Boolean)
    .join('\n\n');

  const ctx: Record<string, string> = {
    concorso: concorso.nome || '',
    anno: String(concorso.anno ?? ''),
    data: today,
    presidente: presidenteStr,
    commissione: commissioneList || '—',
    commissari: commissariInline || '—',
    num_commissari: String(allCommissari.length),
    num_candidati: String(candidati.length),
    fasi: fasiList || '—',
    vincitore,
    podio,
    risultati: risultatiBlocks || '—',
    spareggi: spareggiBlocks || 'Nessuno spareggio applicato nel concorso.',
  };

  if (fase) {
    // Fase-specific context.
    const faseComm = fase.commissioneId
      ? commissioni.find((c) => c.id === fase.commissioneId)
      : null;
    const fasePresId = faseComm?.presidenteCommissarioId ?? null;
    const fasePres = fasePresId
      ? commissari.find((c) => c.id === fasePresId)
      : null;
    const faseAllCommissari = (faseComm?.commissari ?? [])
      .map((id) => commissari.find((c) => c.id === id))
      .filter((c): c is CommissarioRecord => !!c);
    const faseCommNoPresList = faseAllCommissari.filter(
      (c) => c.id !== fasePresId,
    );
    const faseCommListStr = faseCommNoPresList
      .map((c) => `· ${displayNameComm(c)}`)
      .join('\n');
    const faseCommInline = faseCommNoPresList.map(displayNameComm).join(', ');

    const cfCount = (rankedByFase.get(fase.id) ?? []).length;
    const metodoKey = getMetodoMedia(fase);
    const metodoLabel =
      (METODI_MEDIA as Record<string, { nome: string }>)[metodoKey]?.nome ?? metodoKey;
    const modo =
      getModoValutazione(fase) === 'sincrona'
        ? 'Sincrona'
        : 'Autonoma';

    // Fase classifica helpers.
    const faseRows = rankedByFase.get(fase.id) ?? [];
    const scala = getScala(fase);

    const faseClassifica = faseRows.length === 0
      ? '—'
      : faseRows.map((r, i) => {
          const cf = r.cf as CandidatoFase;
          const cand = candidati.find((c) => c.id === cf.candidatoId);
          const esito =
            cf.stato !== 'COMPLETATO'
              ? 'in attesa'
              : cf.ammessoProssimaFase
              ? 'PROMOSSO'
              : 'ELIMINATO';
          return `${r.posizione_finale ?? (i + 1)}. ${displayNameCand(cand)} — ${fmtVoto(r.media, scala)}/${scala} — ${esito}`;
        }).join('\n');

    const fasePromossi = faseRows.filter(
      (r) =>
        (r.cf as CandidatoFase).stato === 'COMPLETATO' &&
        (r.cf as CandidatoFase).ammessoProssimaFase,
    );
    const fasePromossiStr = fasePromossi.length === 0
      ? '—'
      : fasePromossi.map((r, i) => {
          const cand = candidati.find(
            (c) => c.id === (r.cf as CandidatoFase).candidatoId,
          );
          return `${r.posizione_finale ?? (i + 1)}. ${displayNameCand(cand)} — ${fmtVoto(r.media, scala)}/${scala}`;
        }).join('\n');

    const faseEliminati = faseRows.filter(
      (r) =>
        (r.cf as CandidatoFase).stato === 'COMPLETATO' &&
        !(r.cf as CandidatoFase).ammessoProssimaFase,
    );
    const faseEliminatiStr = faseEliminati.length === 0
      ? '—'
      : faseEliminati.map((r, i) => {
          const cand = candidati.find(
            (c) => c.id === (r.cf as CandidatoFase).candidatoId,
          );
          return `${r.posizione_finale ?? (i + 1)}. ${displayNameCand(cand)} — ${fmtVoto(r.media, scala)}/${scala}`;
        }).join('\n');

    const faseSpareggiInvolved = faseRows.filter(
      (r) =>
        (Array.isArray(r.tiebreak_log) && r.tiebreak_log.length > 1) ||
        r.ex_aequo_group,
    );
    const faseSpareggiStr =
      faseSpareggiInvolved.length === 0
        ? 'Nessuno spareggio applicato.'
        : faseSpareggiInvolved.map((r) => {
            const cand = candidati.find(
              (c) => c.id === (r.cf as CandidatoFase).candidatoId,
            );
            const motivazioni = (r.tiebreak_log ?? [])
              .filter((s) => s.motivazione)
              .map((s) => s.motivazione)
              .join(' → ');
            const exa = r.ex_aequo_group ? ' [EX AEQUO]' : '';
            return `${r.posizione_finale}° — #${String(cand?.numeroCandidato ?? '').padStart(3, '0')} ${displayNameCand(cand)}${exa}: ${motivazioni}`;
          }).join('\n');

    Object.assign(ctx, {
      fase: fase.nome || '',
      fase_numero: String(fase.ordine ?? ''),
      fase_data: fmtFaseDate(fase.dataPrevista),
      fase_stato: fase.stato || '',
      fase_scala: String(scala),
      fase_modo: modo,
      fase_metodo: metodoLabel,
      fase_num_candidati: String(cfCount),
      fase_commissione: faseCommListStr || '—',
      fase_commissari: faseCommInline || '—',
      fase_presidente: fasePres ? displayNameComm(fasePres) : '—',
      fase_classifica: faseClassifica,
      fase_promossi: fasePromossiStr,
      fase_eliminati: faseEliminatiStr,
      fase_spareggi: faseSpareggiStr,
    });
  }

  return ctx;
}

// ─── VerbaleBlock component ───────────────────────────────────────────────────

export function VerbaleBlock({
  concorso,
  fasi,
  candidati,
  rankedByFase,
  commissioni,
  commissari,
  sezioni,
}: VerbaleBlockProps) {
  const { t } = useTranslation();
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const [selectedFaseId, setSelectedFaseId] = useState<string>(
    fasi[0]?.id ?? '',
  );

  const selectedFase = useMemo(
    () => fasi.find((f) => f.id === selectedFaseId) ?? null,
    [fasi, selectedFaseId],
  );

  // Load draft from localStorage on mount / fase change.
  const [template, setTemplate] = useState<string>(() => {
    try {
      const key = verbaleStorageKey(concorso.id, fasi[0]?.id ?? null);
      return localStorage.getItem(key) ?? DEFAULT_VERBALE_TEMPLATE;
    } catch {
      return DEFAULT_VERBALE_TEMPLATE;
    }
  });

  // When selected fase changes, load its saved draft.
  useEffect(() => {
    try {
      const key = verbaleStorageKey(concorso.id, selectedFaseId || null);
      setTemplate(localStorage.getItem(key) ?? DEFAULT_VERBALE_TEMPLATE);
    } catch {
      setTemplate(DEFAULT_VERBALE_TEMPLATE);
    }
  }, [concorso.id, selectedFaseId]);

  // Persist on change.
  const handleTemplateChange = useCallback(
    (val: string) => {
      setTemplate(val);
      try {
        const key = verbaleStorageKey(concorso.id, selectedFaseId || null);
        localStorage.setItem(key, val);
      } catch {
        /* ignore */
      }
    },
    [concorso.id, selectedFaseId],
  );

  // Preview = rendered template.
  const preview = useMemo(() => {
    const ctx = buildVerbaleContext(
      concorso,
      fasi,
      candidati,
      rankedByFase,
      commissioni,
      commissari,
      selectedFase,
    );
    return applyVerbaleTags(template, ctx);
  }, [
    template,
    concorso,
    fasi,
    candidati,
    rankedByFase,
    commissioni,
    commissari,
    selectedFase,
  ]);

  // Insert tag at cursor.
  const insertTag = useCallback(
    (tag: string) => {
      const ta = textareaRef.current;
      if (!ta) {
        handleTemplateChange(template + `<${tag}>`);
        return;
      }
      const start = ta.selectionStart ?? template.length;
      const end = ta.selectionEnd ?? template.length;
      const tagStr = `<${tag}>`;
      const next = template.slice(0, start) + tagStr + template.slice(end);
      handleTemplateChange(next);
      // Restore cursor position after React re-render.
      requestAnimationFrame(() => {
        ta.focus();
        ta.setSelectionRange(start + tagStr.length, start + tagStr.length);
      });
    },
    [template, handleTemplateChange],
  );

  // Reset to default.
  const handleReset = () => {
    if (!window.confirm(t('admin.risultati.verbale.reset_msg') ?? 'Ripristinare il template di default? Il testo attuale verrà perso.')) {
      return;
    }
    try {
      const key = verbaleStorageKey(concorso.id, selectedFaseId || null);
      localStorage.removeItem(key);
    } catch {
      /* ignore */
    }
    setTemplate(DEFAULT_VERBALE_TEMPLATE);
  };

  // Export PDF.
  const handleExportPdf = async () => {
    if (!selectedFase) {
      toast.warning('Seleziona una fase prima di esportare il verbale.');
      return;
    }
    try {
      await exportVerbalePdf(
        concorso,
        selectedFase,
        template,
        fasi,
        candidati,
        rankedByFase,
        commissioni,
        commissari,
      );
    } catch (err) {
      console.error('Verbale PDF error', err);
      toast.error('Errore nella generazione del PDF verbale.');
    }
  };

  return (
    <div className="bg-white border border-slate-200 rounded-2xl p-5 space-y-4">
      {/* Header */}
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h3 className="font-semibold text-slate-900 text-lg flex items-center gap-2">
            <FileText className="h-[18px] w-[18px] text-brand-500" aria-hidden />
            {t('admin.risultati.verbale.heading') ?? 'Verbale della commissione'}
          </h3>
          <p className="text-sm text-slate-600 mt-1">
            {t('admin.risultati.verbale.help') ??
              'Scrivi il testo del verbale usando i tag dinamici; la preview si aggiorna in tempo reale.'}
          </p>
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            className="c-btn c-btn--outline c-btn--sm"
            onClick={handleReset}
          >
            <RefreshCw className="h-3 w-3" aria-hidden />
            {t('admin.risultati.verbale.reset') ?? 'Ripristina template'}
          </button>
          <button
            type="button"
            className="c-btn c-btn--primary c-btn--sm"
            disabled={fasi.length === 0}
            onClick={() => { void handleExportPdf(); }}
          >
            {t('admin.risultati.verbale.export_pdf') ?? 'Esporta verbale PDF'}
          </button>
        </div>
      </div>

      {fasi.length === 0 ? (
        <p className="text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-lg p-3">
          {t('admin.risultati.verbale.no_fasi') ??
            'Nessuna fase definita per questo concorso.'}
        </p>
      ) : (
        <>
          {/* Fase selector */}
          <div className="flex items-center gap-2 flex-wrap">
            <label className="text-xs uppercase tracking-wider text-slate-500">
              {t('admin.risultati.verbale.fase_label') ?? 'Fase di riferimento'}
            </label>
            <select
              className="border border-slate-300 rounded-lg px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-brand-300"
              value={selectedFaseId}
              onChange={(e) => setSelectedFaseId(e.target.value)}
            >
              {fasi.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.ordine}. {faseFullLabel(f, sezioni)}
                </option>
              ))}
            </select>
            <span className="text-xs text-slate-500">
              {t('admin.risultati.verbale.fase_help') ??
                'I tag <fase_*> vengono risolti per la fase selezionata.'}
            </span>
          </div>

          {/* Tag chips — general */}
          <div className="space-y-3">
            <div>
              <p className="text-xs uppercase tracking-wider text-slate-500 mb-1.5">
                {t('admin.risultati.verbale.tags_general') ?? 'Tag generali'}
              </p>
              <div className="flex flex-wrap gap-1.5">
                {VERBALE_TAGS_GENERAL.map((td) => (
                  <button
                    key={td.tag}
                    type="button"
                    title={td.desc}
                    onClick={() => insertTag(td.tag)}
                    className="text-xs font-mono px-2 py-1 bg-brand-50 hover:bg-brand-100 text-brand-700 border border-brand-200 rounded transition"
                  >
                    &lt;{td.tag}&gt;
                  </button>
                ))}
              </div>
            </div>
            {selectedFase && (
              <div>
                <p className="text-xs uppercase tracking-wider text-slate-500 mb-1.5">
                  {t('admin.risultati.verbale.tags_fase') ?? 'Tag fase corrente'}
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {VERBALE_TAGS_FASE.map((td) => (
                    <button
                      key={td.tag}
                      type="button"
                      title={td.desc}
                      onClick={() => insertTag(td.tag)}
                      className="text-xs font-mono px-2 py-1 bg-brand-50 hover:bg-brand-100 text-brand-700 border border-brand-200 rounded transition"
                    >
                      &lt;{td.tag}&gt;
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Editor / Preview */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <div>
              <label className="text-xs uppercase tracking-wider text-slate-500 mb-1.5 block">
                {t('admin.risultati.verbale.template_label') ?? 'Template'}
              </label>
              <textarea
                ref={textareaRef}
                rows={16}
                spellCheck={false}
                className="w-full border border-slate-300 rounded-lg p-3 text-sm font-mono leading-relaxed focus:outline-none focus:ring-2 focus:ring-brand-300"
                value={template}
                onChange={(e) => handleTemplateChange(e.target.value)}
              />
            </div>
            <div>
              <label className="text-xs uppercase tracking-wider text-slate-500 mb-1.5 block">
                {t('admin.risultati.verbale.preview_label') ?? 'Anteprima'}
              </label>
              <div className="w-full min-h-[400px] border border-slate-200 bg-slate-50 rounded-lg p-3 text-sm whitespace-pre-wrap leading-relaxed text-slate-800">
                {preview}
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

// ─── Verbale PDF export ───────────────────────────────────────────────────────

async function loadImageDataURL(src: string): Promise<string | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      try {
        const c = document.createElement('canvas');
        c.width = img.naturalWidth;
        c.height = img.naturalHeight;
        (c.getContext('2d')!).drawImage(img, 0, 0);
        resolve(c.toDataURL('image/png'));
      } catch {
        resolve(null);
      }
    };
    img.onerror = () => resolve(null);
    img.src = src;
  });
}

async function exportVerbalePdf(
  concorso: VerbaleBlockProps['concorso'],
  fase: FaseRecord,
  template: string,
  fasi: FaseRecord[],
  candidati: Candidato[],
  rankedByFase: Map<string, RankedRow[]>,
  commissioni: CommissioneRecord[],
  commissari: CommissarioRecord[],
): Promise<void> {
  const ctx = buildVerbaleContext(
    concorso,
    fasi,
    candidati,
    rankedByFase,
    commissioni,
    commissari,
    fase,
  );
  const text = applyVerbaleTags(template, ctx);

  const doc = new jsPDF({ unit: 'pt', format: 'a4' });
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const margin = 56;
  const maxW = pageW - margin * 2;

  try {
    const logoSrc = concorso.logoUrl ?? '/logo.png';
    const logoData = await loadImageDataURL(logoSrc);
    if (logoData) doc.addImage(logoData, 'PNG', margin, margin - 10, 42, 42);
  } catch {
    /* logo non bloccante */
  }

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(16);
  doc.setTextColor(46, 38, 61);
  doc.text(
    `Verbale — Fase ${fase.ordine}: ${fase.nome}`,
    margin + 52,
    margin + 10,
  );
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10);
  doc.setTextColor(93, 89, 108);
  doc.text(`${concorso.nome} · ${concorso.anno ?? ''}`, margin + 52, margin + 26);
  doc.setDrawColor(231, 229, 235);
  doc.line(margin, margin + 50, pageW - margin, margin + 50);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(11);
  doc.setTextColor(46, 38, 61);

  let cursorY = margin + 80;
  const lineHeight = 16;

  for (const para of text.split('\n')) {
    const wrapped: string[] = para === '' ? [''] : doc.splitTextToSize(para, maxW) as string[];
    for (const ln of wrapped) {
      if (cursorY > pageH - margin - 60) {
        doc.addPage();
        cursorY = margin;
      }
      doc.text(ln, margin, cursorY);
      cursorY += lineHeight;
    }
  }

  // Signature grid for commissari of this fase.
  const SIGN_TAGS = /<(commissari|commissione|fase_commissari|fase_commissione)>/i;
  const templateHasSign = SIGN_TAGS.test(template);
  const faseComm = fase.commissioneId
    ? commissioni.find((c) => c.id === fase.commissioneId)
    : null;
  const fasePresId = faseComm?.presidenteCommissarioId ?? null;
  const firmatari: CommissarioRecord[] =
    templateHasSign && faseComm
      ? (faseComm.commissari ?? [])
          .map((id) => commissari.find((c) => c.id === id))
          .filter((c): c is CommissarioRecord => !!c)
      : [];

  // Presidente first.
  firmatari.sort((a, b) =>
    b.id === fasePresId ? 1 : a.id === fasePresId ? -1 : 0,
  );

  if (firmatari.length > 0) {
    const cols = 2;
    const gap = 32;
    const colW = (pageW - margin * 2 - gap * (cols - 1)) / cols;
    const rowH = 64;
    const headingH = 26;

    let yCursor = cursorY + 30;
    if (yCursor + headingH + rowH > pageH - margin - 30) {
      doc.addPage();
      yCursor = margin;
    }

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(11);
    doc.setTextColor(46, 38, 61);
    doc.text('Firme dei commissari', margin, yCursor);
    yCursor += headingH;

    let i = 0;
    while (i < firmatari.length) {
      if (yCursor + rowH > pageH - margin - 30) {
        doc.addPage();
        yCursor = margin;
      }
      for (let col = 0; col < cols && i < firmatari.length; col++) {
        const comm = firmatari[i++];
        const x = margin + col * (colW + gap);
        const lineY = yCursor + 24;

        doc.setDrawColor(165, 163, 174);
        doc.line(x, lineY, x + colW - 12, lineY);

        const role = comm.id === fasePresId ? ' (Presidente)' : '';
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(10);
        doc.setTextColor(46, 38, 61);
        doc.text(`${[comm.cognome, comm.nome].filter(Boolean).join(' ')}${role}`, x, lineY + 14);

        if (comm.specialita) {
          doc.setFont('helvetica', 'normal');
          doc.setFontSize(8);
          doc.setTextColor(93, 89, 108);
          doc.text(comm.specialita, x, lineY + 26);
        }
      }
      yCursor += rowH;
    }
  }

  // Page numbers.
  const totalPages = doc.getNumberOfPages();
  for (let p = 1; p <= totalPages; p++) {
    doc.setPage(p);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.setTextColor(165, 163, 174);
    doc.text(
      `Pagina ${p} di ${totalPages}`,
      pageW - margin,
      pageH - 20,
      { align: 'right' },
    );
    doc.text(concorso.nome, margin, pageH - 20);
  }

  const safeName = concorso.nome.replace(/[^\w-]+/g, '_');
  const safeFase = `_F${fase.ordine}_${(fase.nome || '').replace(/[^\w-]+/g, '_')}`;
  doc.save(`Verbale_${safeName}${safeFase}_${concorso.anno ?? 'nd'}.pdf`);
  toast.success('Verbale PDF generato con successo.');
}

export default VerbaleBlock;
