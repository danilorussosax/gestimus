// =============================================================================
// ImportCsvDialog — modale di import CSV riusabile (commissari/candidati/sezioni)
//
// Port fedele di openImportModal (js/views/admin/import.js) sul modello React +
// server. Props: { concorsoId, kind, open, onOpenChange, onDone }.
//
//   - textarea incolla CSV OPPURE file input (.csv/.tsv/.txt)
//   - rilevamento separatore automatico (; , \t)
//   - tabella anteprima live con stato per riga (✓ / ✗ con motivo)
//   - validazione (intestazioni obbligatorie, cap righe, righe valide)
//   - creazione riga-per-riga via le api esistenti, con barra di progresso e
//     riepilogo per-riga (ok/ko) + toast
//   - hint template scaricabile per kind
//
// La risoluzione sezione/categoria dei candidati e l'import gerarchico delle
// sezioni (sezione → categorie, dedup) sono gestiti qui, riusando le liste
// caricate e le api modules.
//
// Design system: c-btn/c-input/c-textarea/c-select/c-table/c-tag, brand/ink,
//   icone lucide, toast 'sonner'.
// =============================================================================

import { useState, useRef, useMemo, useEffect, useCallback } from 'react';
import { toast } from 'sonner';
import { Upload, Download, FileUp, Loader2, CheckCircle2, XCircle } from 'lucide-react';

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { httpErrorMessage } from '@/lib/api';
import {
  type ImportKind,
  IMPORT_REQUIRED,
  MAX_IMPORT_ROWS,
  detectCsvSeparator,
  parseCSV,
  buildHeaderMap,
  normalizeRow,
  normKey,
  importTemplateText,
  type NormalizedRow,
  type NormalizedCommissario,
  type NormalizedCandidato,
  type NormalizedSezione,
} from '@/lib/csv-import';

import { commissariApi } from '@/api/commissari';
import { candidatiApi } from '@/api/candidati';
import { sezioniApi } from '@/api/sezioni';
import { categorieApi } from '@/api/categorie';

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------
export interface ImportCsvDialogProps {
  concorsoId: string;
  kind: ImportKind;
  open: boolean;
  onOpenChange: (v: boolean) => void;
  /** Chiamato a import concluso (anche parziale) per fare refetch nel parent. */
  onDone?: () => void;
}

// ---------------------------------------------------------------------------
// Testi per kind
// ---------------------------------------------------------------------------
const KIND_LABEL: Record<ImportKind, string> = {
  commissari: 'commissari',
  candidati: 'candidati',
  sezioni: 'sezioni e categorie',
};

const KIND_COLS_HELP: Record<ImportKind, string> = {
  commissari:
    'Colonne: nome*, cognome*, specialita*, email, telefono, data_nascita, nazionalita, bio.',
  candidati:
    'Colonne: nome*, cognome*, strumento*, data_nascita*, nazionalita*, docenti, sezione, categoria, tipo, gruppo_nome. Per i gruppi (tipo=gruppo) cognome e data_nascita sono opzionali.',
  sezioni:
    'Colonne: sezione*, categoria, descrizione, eta_min, eta_max. La sezione si ripete su più righe per raggruppare le sue categorie.',
};

// Colonne visibili in anteprima per kind.
interface PreviewCol {
  key: string;
  label: string;
}
const PREVIEW_COLS: Record<ImportKind, PreviewCol[]> = {
  commissari: [
    { key: 'nome', label: 'Nome' },
    { key: 'cognome', label: 'Cognome' },
    { key: 'specialita', label: 'Specialità' },
    { key: 'email', label: 'Email' },
    { key: 'telefono', label: 'Telefono' },
    { key: 'dataNascita', label: 'Nascita' },
  ],
  candidati: [
    { key: 'nome', label: 'Nome' },
    { key: 'cognome', label: 'Cognome' },
    { key: 'strumento', label: 'Strumento' },
    { key: 'dataNascita', label: 'Nascita' },
    { key: 'nazionalita', label: 'Nazionalità' },
    { key: 'sezioneNome', label: 'Sezione' },
    { key: 'categoriaNome', label: 'Categoria' },
  ],
  sezioni: [
    { key: 'sezione', label: 'Sezione' },
    { key: 'categoria', label: 'Categoria' },
    { key: 'descrizione', label: 'Descrizione' },
    { key: 'eta', label: 'Età' },
  ],
};

// ---------------------------------------------------------------------------
// fmtBytes (port di utils.fmtBytes)
// ---------------------------------------------------------------------------
function fmtBytes(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const i = Math.min(units.length - 1, Math.floor(Math.log(n) / Math.log(1024)));
  return `${(n / Math.pow(1024, i)).toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

function previewValue(kind: ImportKind, row: NormalizedRow, colKey: string): string {
  const d = row.data as unknown as Record<string, unknown>;
  if (kind === 'sezioni' && colKey === 'eta') {
    const s = row.data as NormalizedSezione;
    if (s.eta_min == null && s.eta_max == null) return '';
    return `${s.eta_min ?? ''}–${s.eta_max ?? ''}`;
  }
  const v = d[colKey];
  if (Array.isArray(v)) return v.join(', ');
  return v == null ? '' : String(v);
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------
export default function ImportCsvDialog({
  concorsoId,
  kind,
  open,
  onOpenChange,
  onDone,
}: ImportCsvDialogProps) {
  const [text, setText] = useState('');
  const [status, setStatus] = useState('');
  const [summary, setSummary] = useState<{ msg: string; error: boolean } | null>(null);
  const [parsed, setParsed] = useState<NormalizedRow[]>([]);
  const [assignToConcorso, setAssignToConcorso] = useState(true); // solo commissari
  const [importing, setImporting] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number; ok: number; ko: number } | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);

  // Reset alla (ri)apertura.
  useEffect(() => {
    if (!open) return;
    setText('');
    setStatus('');
    setSummary(null);
    setParsed([]);
    setAssignToConcorso(true);
    setImporting(false);
    setProgress(null);
  }, [open]);

  const okCount = useMemo(() => parsed.filter((p) => p.errors.length === 0).length, [parsed]);
  const koCount = parsed.length - okCount;
  const cols = PREVIEW_COLS[kind];

  // ----- Parse + preview -----
  const doParse = useCallback(
    (raw: string) => {
      const trimmed = (raw || '').trim();
      if (!trimmed) {
        setSummary({ msg: 'Incolla del testo CSV o carica un file.', error: false });
        setParsed([]);
        return;
      }
      const sep = detectCsvSeparator(trimmed);
      const rows = parseCSV(trimmed, sep);
      if (rows.length < 2) {
        setSummary({ msg: 'Servono almeno una riga di intestazione e una di dati.', error: true });
        setParsed([]);
        return;
      }
      const header = rows[0];
      const headerMap = buildHeaderMap(kind, header);
      const missingReq = IMPORT_REQUIRED[kind].filter((f) => !(f in headerMap));
      if (missingReq.length > 0) {
        setSummary({
          msg: `Colonne obbligatorie mancanti: ${missingReq.join(', ')}`,
          error: true,
        });
        setParsed([]);
        return;
      }
      const dataRows = rows.slice(1);
      if (dataRows.length > MAX_IMPORT_ROWS) {
        setSummary({
          msg: `Troppe righe (${dataRows.length}). Massimo ${MAX_IMPORT_ROWS} per import.`,
          error: true,
        });
        setParsed([]);
        return;
      }
      const out: NormalizedRow[] = dataRows.map((r, i) => ({
        ...normalizeRow(kind, headerMap, r),
        rawIndex: i + 2,
      }));
      const ok = out.filter((p) => p.errors.length === 0).length;
      const ko = out.length - ok;
      const sepLabel = sep === '\t' ? 'tab' : sep;
      setSummary({
        msg: `Separatore "${sepLabel}" · ${out.length} righe · ${ok} valide${ko ? ` · ${ko} con errori` : ''}`,
        error: false,
      });
      setParsed(out);
    },
    [kind],
  );

  // ----- File upload -----
  const onFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    try {
      const txt = await file.text();
      setText(txt);
      setStatus(`${file.name} · ${fmtBytes(file.size)}`);
      doParse(txt);
    } catch (err) {
      toast.error(`Lettura file fallita: ${(err as Error)?.message ?? ''}`);
    }
  };

  // ----- Template download -----
  const onDownloadTemplate = () => {
    const blob = new Blob([importTemplateText(kind)], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `template_${kind}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // ----- Import (create rows) -----
  const runImport = async () => {
    const valid = parsed.filter((p) => p.errors.length === 0);
    if (valid.length === 0) {
      toast.error('Nessuna riga valida da importare.');
      return;
    }
    setImporting(true);
    setProgress({ done: 0, total: valid.length, ok: 0, ko: 0 });

    try {
      if (kind === 'sezioni') {
        await importSezioni(valid);
      } else if (kind === 'candidati') {
        await importCandidati(valid);
      } else {
        await importCommissari(valid);
      }
      onDone?.();
      onOpenChange(false);
    } catch (e) {
      toast.error(`Errore durante l'import: ${httpErrorMessage(e)}`);
    } finally {
      setImporting(false);
    }
  };

  // ----- Import sezioni (gerarchico: sezioni → categorie, dedup per nome) -----
  const importSezioni = async (valid: NormalizedRow[]) => {
    const norm = (s: unknown) => String(s ?? '').trim().toLowerCase();
    const existingSez = await sezioniApi.list(concorsoId);
    const sezByName = new Map(existingSez.map((s) => [norm(s.nome), s]));
    // Categorie già presenti per ciascuna sezione (per dedup).
    const catNamesBySez = new Map<string, Set<string>>();
    await Promise.all(
      existingSez.map(async (s) => {
        const cats = await categorieApi.listBySezione(s.id);
        catNamesBySez.set(s.id, new Set(cats.map((c) => norm(c.nome))));
      }),
    );

    let okSez = 0;
    let okCat = 0;
    let ko = 0;
    for (let i = 0; i < valid.length; i++) {
      const d = valid[i].data as NormalizedSezione;
      try {
        let sez = sezByName.get(norm(d.sezione));
        if (!sez) {
          // Riga sezione-only → descrizione sulla sezione; se c'è anche una
          // categoria la descrizione spetta alla categoria.
          sez = await sezioniApi.create({
            concorsoId,
            nome: d.sezione.trim(),
            descrizione: d.categoria ? '' : d.descrizione || undefined,
          });
          sezByName.set(norm(d.sezione), sez);
          catNamesBySez.set(sez.id, new Set());
          okSez++;
        }
        if (d.categoria) {
          const seen = catNamesBySez.get(sez.id)!;
          if (!seen.has(norm(d.categoria))) {
            await categorieApi.create({
              sezioneId: sez.id,
              nome: d.categoria.trim(),
              descrizione: d.descrizione || undefined,
              etaMin: d.eta_min ?? undefined,
              etaMax: d.eta_max ?? undefined,
            });
            seen.add(norm(d.categoria));
            okCat++;
          }
        }
      } catch (e) {
        console.error('import sezioni row failed', valid[i], e);
        ko++;
      }
      setProgress({ done: i + 1, total: valid.length, ok: okSez + okCat, ko });
    }
    if (ko === 0) toast.success(`Import completato: ${okSez} sezioni, ${okCat} categorie.`);
    else toast.warning(`Import parziale: ${okSez + okCat} creati, ${ko} errori.`);
  };

  // ----- Import candidati (risolve sezione/categoria per nome) -----
  const importCandidati = async (valid: NormalizedRow[]) => {
    const norm = (s: unknown) => normKey(s);
    const [sezioni, categorie] = await Promise.all([
      candidatiApi.sezioni(concorsoId),
      candidatiApi.categorie(concorsoId),
    ]);
    const sezByName = new Map(sezioni.map((s) => [norm(s.nome), s]));

    let ok = 0;
    let ko = 0;
    for (let i = 0; i < valid.length; i++) {
      const d = valid[i].data as NormalizedCandidato;
      try {
        let sezioneId: string | null = null;
        if (d.sezioneNome) {
          const s = sezByName.get(norm(d.sezioneNome));
          if (s) sezioneId = s.id;
        }
        // Categoria scoped alla sezione scelta; se la sezione manca ma la
        // categoria è univoca, deriviamo la sezione dal record categoria.
        let categoriaId: string | null = null;
        if (d.categoriaNome) {
          const matches = categorie.filter(
            (c) =>
              norm(c.nome) === norm(d.categoriaNome) &&
              (sezioneId == null || c.sezioneId === sezioneId),
          );
          if (matches.length === 1) {
            categoriaId = matches[0].id;
            if (!sezioneId) sezioneId = matches[0].sezioneId;
          }
        }

        const isGroup = d.tipo === 'gruppo' || d.tipo === 'orchestra';
        await candidatiApi.create({
          concorsoId,
          nome: d.nome,
          cognome: d.cognome || null,
          strumento: d.strumento,
          dataNascita: d.dataNascita || null,
          nazionalita: d.nazionalita || null,
          docentiPreparatori: d.docentiPreparatori,
          sezioneId,
          categoriaId: sezioneId ? categoriaId : null,
          isGruppo: isGroup,
          gruppoNome: isGroup ? d.gruppoNome || null : null,
          tipoGruppo: d.tipo === 'orchestra' ? 'orchestra' : d.tipo === 'gruppo' ? 'ensemble' : null,
        });
        ok++;
      } catch (e) {
        console.error('import candidato row failed', valid[i], e);
        ko++;
      }
      setProgress({ done: i + 1, total: valid.length, ok, ko });
    }
    if (ko === 0) toast.success(`Import completato: ${ok} candidati.`);
    else toast.warning(`Import parziale: ${ok} creati, ${ko} errori.`);
  };

  // ----- Import commissari -----
  const importCommissari = async (valid: NormalizedRow[]) => {
    let ok = 0;
    let ko = 0;
    for (let i = 0; i < valid.length; i++) {
      const d = valid[i].data as NormalizedCommissario;
      try {
        await commissariApi.create({
          // Il server richiede un concorsoId; quando il checkbox è attivo il
          // record entra nel concorso corrente (ATTIVO).
          concorsoId,
          nome: d.nome,
          cognome: d.cognome || undefined,
          specialita: d.specialita || undefined,
          email: d.email || undefined,
          telefono: d.telefono || undefined,
          dataNascita: d.dataNascita,
          nazionalita: d.nazionalita || undefined,
          bio: d.bio || undefined,
          stato: assignToConcorso ? 'ATTIVO' : 'INATTIVO',
        });
        ok++;
      } catch (e) {
        console.error('import commissario row failed', valid[i], e);
        ko++;
      }
      setProgress({ done: i + 1, total: valid.length, ok, ko });
    }
    if (ko === 0) toast.success(`Import completato: ${ok} commissari.`);
    else toast.warning(`Import parziale: ${ok} creati, ${ko} errori.`);
  };

  const progressPct = progress && progress.total > 0 ? Math.round((progress.done / progress.total) * 100) : 0;

  return (
    <Dialog open={open} onOpenChange={(v) => !importing && onOpenChange(v)}>
      <DialogContent className="sm:max-w-4xl max-h-[90dvh] flex flex-col">
        <DialogHeader>
          <DialogTitle>Importa {KIND_LABEL[kind]} da CSV</DialogTitle>
          <DialogDescription>{KIND_COLS_HELP[kind]}</DialogDescription>
        </DialogHeader>

        <div className="space-y-4 overflow-y-auto flex-1 pr-1 text-sm">
          {/* Hint + azioni file/template */}
          <div className="bg-brand-50 border border-brand-100 rounded-xl p-3 text-brand-900 text-xs leading-relaxed">
            <p>Le colonne contrassegnate con * sono obbligatorie. Le intestazioni vengono riconosciute automaticamente (anche varianti/alias).</p>
            <p className="mt-1">Separatore rilevato automaticamente: virgola, punto e virgola o tabulazione.</p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              className="c-btn c-btn--sm c-btn--outline"
              onClick={() => fileInputRef.current?.click()}
              disabled={importing}
            >
              <FileUp className="h-4 w-4" /> Carica file CSV
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept=".csv,.tsv,.txt,text/csv"
              className="hidden"
              onChange={onFileChange}
            />
            <button
              type="button"
              className="c-btn c-btn--sm c-btn--ghost text-slate-600"
              onClick={onDownloadTemplate}
              disabled={importing}
            >
              <Download className="h-4 w-4" /> Scarica template
            </button>
            {status && <span className="text-xs text-slate-500">{status}</span>}
          </div>

          {/* Textarea incolla CSV */}
          <label className="block">
            <span className="c-field__label">Incolla il CSV qui</span>
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              rows={6}
              spellCheck={false}
              className="c-textarea mt-1 font-mono text-xs"
              placeholder={importTemplateText(kind)}
              disabled={importing}
            />
          </label>

          {/* Bottone analizza + riepilogo */}
          <div className="flex items-center gap-2 flex-wrap">
            <button
              type="button"
              className="c-btn c-btn--sm c-btn--secondary"
              onClick={() => doParse(text)}
              disabled={importing}
            >
              <Upload className="h-4 w-4" /> Analizza
            </button>
            {summary && (
              <span className={`text-xs ${summary.error ? 'text-rose-600 font-semibold' : 'text-slate-600'}`}>
                {summary.msg}
              </span>
            )}
          </div>

          {/* Anteprima */}
          {parsed.length > 0 && (
            <div className="border border-slate-200 rounded-xl overflow-hidden">
              <div className="max-h-[360px] overflow-auto">
                <table className="c-table w-full text-xs">
                  <thead className="bg-slate-50 sticky top-0">
                    <tr>
                      <th className="text-left font-semibold text-slate-600 px-2 py-1.5 border-b border-slate-200">#</th>
                      {cols.map((c) => (
                        <th key={c.key} className="text-left font-semibold text-slate-600 px-2 py-1.5 border-b border-slate-200">
                          {c.label}
                        </th>
                      ))}
                      <th className="text-left font-semibold text-slate-600 px-2 py-1.5 border-b border-slate-200">Stato</th>
                    </tr>
                  </thead>
                  <tbody>
                    {parsed.map((p) => (
                      <tr key={p.rawIndex} className={p.errors.length ? 'bg-rose-50/40' : ''}>
                        <td className="px-2 py-1 border-b border-slate-100 font-mono text-slate-400">{p.rawIndex}</td>
                        {cols.map((c) => (
                          <td key={c.key} className="px-2 py-1 border-b border-slate-100 text-slate-700">
                            {previewValue(kind, p, c.key)}
                          </td>
                        ))}
                        <td className="px-2 py-1 border-b border-slate-100">
                          {p.errors.length === 0 ? (
                            <span className="inline-flex items-center gap-1 text-emerald-700 font-semibold">
                              <CheckCircle2 className="h-3.5 w-3.5" />
                            </span>
                          ) : (
                            <span
                              className="inline-flex items-center gap-1 text-rose-700 font-medium"
                              title={p.errors.join(' · ')}
                            >
                              <XCircle className="h-3.5 w-3.5 shrink-0" />
                              <span className="truncate">{p.errors.join(' · ')}</span>
                            </span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Opzione commissari: assegna al concorso */}
          {kind === 'commissari' && parsed.length > 0 && (
            <label className="flex items-start gap-2 text-xs text-slate-700">
              <input
                type="checkbox"
                checked={assignToConcorso}
                onChange={(e) => setAssignToConcorso(e.target.checked)}
                className="mt-0.5 w-3.5 h-3.5 rounded border-slate-300 text-brand-600"
                disabled={importing}
              />
              <span>Assegna i commissari importati a questo concorso (altrimenti restano in archivio).</span>
            </label>
          )}

          {/* Barra di progresso */}
          {progress && (
            <div>
              <div className="w-full h-2 bg-slate-200 rounded-full overflow-hidden">
                <div className="h-full bg-brand-500 transition-all" style={{ width: `${progressPct}%` }} />
              </div>
              <p className="text-xs text-slate-500 mt-1">
                {progress.done}/{progress.total} elaborate · {progress.ok} ok
                {progress.ko ? ` · ${progress.ko} errori` : ''}
              </p>
            </div>
          )}
        </div>

        <DialogFooter className="pt-2">
          <button
            type="button"
            className="c-btn c-btn--outline"
            onClick={() => onOpenChange(false)}
            disabled={importing}
          >
            Annulla
          </button>
          <button
            type="button"
            className="c-btn c-btn--primary"
            onClick={runImport}
            disabled={importing || okCount === 0}
          >
            {importing ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" /> Importazione…
              </>
            ) : (
              <>
                <Upload className="h-4 w-4" /> Importa {okCount > 0 ? okCount : ''} {koCount ? `(${koCount} scartate)` : ''}
              </>
            )}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
