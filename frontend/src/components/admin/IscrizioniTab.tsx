// =============================================================================
// IscrizioniTab — gestione iscrizioni pubbliche (admin)
//
// Features:
//  - Tabella iscrizioni con filtri per stato (pill filter)
//  - Approve action (crea candidato) e Reject (con motivo)
//  - Dettaglio iscrizione (expandable dialog) con anagrafica, GDPR, allegati
//  - Export CSV
// =============================================================================

import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { getConcorso } from '@/api/concorsi';
import {
  ChevronRight, Download, ExternalLink,
} from 'lucide-react';

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
  useIscrizioni,
  iscrizioniApi,
  type IscrizioneFull,
  type IscrizioneStatoDb,
  type IscrizioneAllegato,
} from '@/api/iscrizioni';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function displayName(isc: Pick<IscrizioneFull, 'nome' | 'cognome'>): string {
  return [isc.nome, isc.cognome].filter(Boolean).join(' ');
}

function ageFromDate(dateStr: string | null | undefined): number | null {
  if (!dateStr) return null;
  const dob = new Date(dateStr);
  if (isNaN(dob.getTime())) return null;
  const today = new Date();
  let age = today.getFullYear() - dob.getFullYear();
  const m = today.getMonth() - dob.getMonth();
  if (m < 0 || (m === 0 && today.getDate() < dob.getDate())) age--;
  return age >= 0 ? age : null;
}

function fmtDateTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('it-IT');
}

function fmtBytes(n: number | null): string {
  if (!n) return '';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

// ---------------------------------------------------------------------------
// Stato badge — mirrors vanilla iscrizioneRowHtml colors exactly
// ---------------------------------------------------------------------------

type StatoDbAll = IscrizioneStatoDb | '';

const STATO_COLORS: Record<IscrizioneStatoDb, string> = {
  BOZZA:           'bg-slate-100 text-slate-700',
  INVIATA:         'bg-amber-100 text-amber-800',
  EMAIL_VERIFICATA:'bg-sky-100 text-sky-800',
  APPROVATA:       'bg-emerald-100 text-emerald-800',
  RIFIUTATA:       'bg-rose-100 text-rose-800',
};

const STATO_LABEL: Record<IscrizioneStatoDb, string> = {
  BOZZA:           'Bozza',
  INVIATA:         'In attesa',
  EMAIL_VERIFICATA:'Verificata',
  APPROVATA:       'Approvata',
  RIFIUTATA:       'Rifiutata',
};

function StatoBadge({ stato }: { stato: IscrizioneStatoDb }) {
  const color = STATO_COLORS[stato];
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider ${color}`}>
      {STATO_LABEL[stato]}
    </span>
  );
}

// Detail-dialog stato badge (full label, matches vanilla detail header)
const STATO_DETAIL_COLORS: Record<IscrizioneStatoDb, string> = {
  BOZZA:           'bg-slate-100 text-slate-700',
  INVIATA:         'bg-amber-100 text-amber-800',
  EMAIL_VERIFICATA:'bg-sky-100 text-sky-800',
  APPROVATA:       'bg-emerald-100 text-emerald-800',
  RIFIUTATA:       'bg-rose-100 text-rose-800',
};

// ---------------------------------------------------------------------------
// Reject dialog — keeps shadcn Dialog for a11y but styled with legacy classes
// ---------------------------------------------------------------------------

interface RejectDialogProps {
  open: boolean;
  iscrizione: IscrizioneFull | null;
  onCancel: () => void;
  onConfirm: (reason: string) => void;
  isPending: boolean;
}

function RejectDialog({ open, iscrizione, onCancel, onConfirm, isPending }: RejectDialogProps) {
  const [reason, setReason] = useState('');

  const handleConfirm = () => {
    onConfirm(reason);
    setReason('');
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onCancel()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="text-rose-700">
            ✕ Rifiuta iscrizione
          </DialogTitle>
          <DialogDescription>
            Rifiutare l&apos;iscrizione di <strong>{iscrizione ? displayName(iscrizione) : ''}</strong>?
            Il motivo (opzionale) verrà comunicato al candidato.
          </DialogDescription>
        </DialogHeader>
        <div>
          <label className="c-label">
            Motivo del rifiuto <span className="text-slate-500 text-xs">(opzionale)</span>
          </label>
          <textarea
            className="c-textarea"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            rows={3}
            placeholder="es. Documentazione incompleta, fascia d'età non corrispondente…"
          />
        </div>
        <DialogFooter>
          <button type="button" className="c-btn c-btn--outline" onClick={onCancel}>Annulla</button>
          <button
            type="button"
            className="c-btn c-btn--destructive"
            onClick={handleConfirm}
            disabled={isPending}
          >
            {isPending ? 'Rifiuto in corso…' : 'Rifiuta iscrizione'}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// AllegatiSection (inside detail dialog) — mirrors vanilla onMount allegati
// ---------------------------------------------------------------------------

function AllegatiSection({ iscrizioneId }: { iscrizioneId: string }) {
  const [allegati, setAllegati] = useState<IscrizioneAllegato[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);

  const load = async () => {
    if (loaded) return;
    setLoading(true);
    setError(null);
    try {
      const data = await iscrizioniApi.allegati(iscrizioneId);
      setAllegati(data);
      setLoaded(true);
    } catch (e) {
      setError(httpErrorMessage(e));
    } finally {
      setLoading(false);
    }
  };

  // auto-load on mount
  useState(() => { void load(); });

  const TIPO_LABEL: Record<string, string> = {
    foto:      '📷 Foto',
    documento: '📄 Documento',
    ricevuta:  '💳 Ricevuta',
    altro:     '✍ Altro',
  };

  if (loading) {
    return <span className="text-xs text-slate-500 italic">Caricamento…</span>;
  }
  if (error) {
    return <span className="text-xs text-rose-600">{error}</span>;
  }
  if (!allegati || allegati.length === 0) {
    return <span className="text-xs text-slate-400 italic">Nessun allegato</span>;
  }

  return (
    <ul className="space-y-1.5">
      {allegati.map((a) => (
        <li
          key={a.id}
          className="flex items-center justify-between gap-3 bg-slate-50 border border-slate-200 rounded-lg px-3 py-2"
        >
          <span className="min-w-0 truncate text-xs text-slate-700">
            {TIPO_LABEL[a.tipo] ?? a.tipo} · {a.nomeFile}
            {a.sizeBytes != null && (
              <span className="text-slate-400 ml-1">{fmtBytes(a.sizeBytes)}</span>
            )}
          </span>
          <a
            href={iscrizioniApi.downloadAllegatoUrl(a.id)}
            target="_blank"
            rel="noopener noreferrer"
            className="shrink-0 text-xs text-brand-700 font-semibold hover:underline"
          >
            ⬇ Scarica
          </a>
        </li>
      ))}
    </ul>
  );
}

// ---------------------------------------------------------------------------
// IscrizioneDetailDialog — mirrors vanilla openIscrizioneDetail modal
// ---------------------------------------------------------------------------

interface DetailDialogProps {
  open: boolean;
  iscrizione: IscrizioneFull | null;
  onClose: () => void;
  onApprove: () => void;
  onReject: () => void;
  isApprovePending: boolean;
}

function IscrizioneDetailDialog({
  open,
  iscrizione: isc,
  onClose,
  onApprove,
  onReject,
  isApprovePending,
}: DetailDialogProps) {
  if (!isc) return null;

  const age = ageFromDate(isc.dataNascita);
  const isMinor = age !== null && age < 18;
  const isActive = isc.stato !== 'APPROVATA' && isc.stato !== 'RIFIUTATA';

  const programma = Array.isArray(isc.programma)
    ? (isc.programma as { titolo?: string; autore?: string; durata_min?: number }[])
    : (() => {
        try { return JSON.parse(String(isc.programma ?? '[]')) as { titolo?: string; autore?: string; durata_min?: number }[]; }
        catch { return []; }
      })();

  // Durata totale: somma dei brani (nel vecchio stack era un campo dedicato
  // isc.durata_totale_min; ora lo deriviamo dal programma).
  const durataTotaleMin = programma.reduce((acc, p) => acc + (Number(p.durata_min) || 0), 0);

  const docenti = Array.isArray(isc.docentiPreparatori)
    ? (isc.docentiPreparatori as string[])
    : (() => {
        try { return JSON.parse(String(isc.docentiPreparatori ?? '[]')) as string[]; }
        catch { return []; }
      })();

  const tutore = isc.tutore as Record<string, string> | null | undefined;
  const isGruppo = isc.isGruppo;
  const membri = Array.isArray(isc.membri)
    ? (isc.membri as { nome?: string; cognome?: string; strumento?: string; data_nascita?: string }[])
    : (() => {
        try { return JSON.parse(String(isc.membri ?? '[]')) as { nome?: string; cognome?: string; strumento?: string; data_nascita?: string }[]; }
        catch { return []; }
      })();

  const gdpr = isc.consensiGdpr ?? {};

  const detailStatoCls = STATO_DETAIL_COLORS[isc.stato];

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-2xl max-h-[90dvh] flex flex-col">
        <DialogHeader>
          <DialogTitle>
            {displayName(isc)} · {isc.strumento ?? '—'}
          </DialogTitle>
        </DialogHeader>

        <div className="overflow-y-auto flex-1 space-y-5 text-sm pr-1">
          {/* ---- Header: stato + data ---- */}
          <div className="flex items-center justify-between gap-3 flex-wrap pb-3 border-b border-slate-100">
            <div className="flex items-center gap-2">
              <span className={`text-xs font-bold uppercase tracking-wider px-2 py-1 rounded ${detailStatoCls}`}>
                {isc.stato}
              </span>
              <span className="text-xs text-slate-500">
                creata il {fmtDateTime(isc.createdAt)}
              </span>
            </div>
          </div>

          {/* ---- Anagrafica ---- */}
          <section>
            <h3 className="font-mono text-[10px] uppercase tracking-wider text-slate-500 mb-2">Anagrafica</h3>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-4 gap-y-2 text-xs">
              <div>
                <span className="text-slate-500">Nato il:</span>{' '}
                <strong>{isc.dataNascita ?? '—'}</strong>
                {age != null && <span className="text-slate-400 ml-1">({age} anni)</span>}
              </div>
              <div>
                <span className="text-slate-500">Luogo nascita:</span>{' '}
                <strong>{isc.luogoNascita ?? '—'}</strong>
              </div>
              <div>
                <span className="text-slate-500">Nazionalità:</span>{' '}
                <strong>{isc.nazionalita ?? '—'}</strong>
              </div>
              <div>
                <span className="text-slate-500">Sesso:</span>{' '}
                <strong>{isc.sesso ?? '—'}</strong>
              </div>
              <div className="col-span-2">
                <span className="text-slate-500">Codice fiscale:</span>{' '}
                <strong className="font-mono">{isc.codiceFiscale ?? '—'}</strong>
              </div>
            </div>
          </section>

          {/* ---- Contatti ---- */}
          <section>
            <h3 className="font-mono text-[10px] uppercase tracking-wider text-slate-500 mb-2">Contatti</h3>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-4 gap-y-2 text-xs">
              <div className="col-span-2">
                <span className="text-slate-500">Email:</span>{' '}
                <strong>
                  <a href={`mailto:${isc.email}`} className="text-brand-700 hover:underline">
                    {isc.email}
                  </a>
                </strong>
              </div>
              <div>
                <span className="text-slate-500">Telefono:</span>{' '}
                <strong>
                  <a href={`tel:${isc.telefono ?? ''}`} className="hover:underline">
                    {isc.telefono ?? '—'}
                  </a>
                </strong>
              </div>
              <div className="col-span-3">
                <span className="text-slate-500">Indirizzo:</span>{' '}
                <strong>
                  {`${isc.indirizzo ?? '—'}, ${isc.citta ?? '—'} ${isc.cap ?? ''} (${isc.provincia ?? '—'}) · ${isc.paese ?? '—'}`}
                </strong>
              </div>
            </div>
          </section>

          {/* ---- Tutore (minorenne) ---- */}
          {(isMinor || tutore?.nome) && (
            <section className="bg-amber-50 border border-amber-200 rounded-xl p-3">
              <h3 className="font-mono text-[10px] uppercase tracking-wider text-amber-800 mb-2">
                ⚠ Candidato minorenne · dati tutore
              </h3>
              <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
                <div>
                  <span className="text-slate-600">Nome:</span>{' '}
                  <strong>{[tutore?.nome, tutore?.cognome].filter(Boolean).join(' ') || '—'}</strong>
                </div>
                <div>
                  <span className="text-slate-600">Email:</span>{' '}
                  <strong>{tutore?.email ?? '—'}</strong>
                </div>
                <div>
                  <span className="text-slate-600">Telefono:</span>{' '}
                  <strong>{tutore?.telefono ?? '—'}</strong>
                </div>
              </div>
            </section>
          )}

          {/* ---- Dati artistici ---- */}
          <section>
            <h3 className="font-mono text-[10px] uppercase tracking-wider text-slate-500 mb-2">Dati artistici</h3>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-4 gap-y-2 text-xs">
              <div>
                <span className="text-slate-500">Tipo:</span>{' '}
                <strong>{isGruppo ? (isc.tipoGruppo ?? 'gruppo') : 'individuale'}</strong>
              </div>
              <div>
                <span className="text-slate-500">Strumento:</span>{' '}
                <strong>{isc.strumento ?? '—'}</strong>
              </div>
              <div>
                <span className="text-slate-500">Anni studio:</span>{' '}
                <strong>{isc.anniStudio != null ? String(isc.anniStudio) : '—'}</strong>
              </div>
              <div className="col-span-3">
                <span className="text-slate-500">Scuola/Conservatorio:</span>{' '}
                <strong>{isc.scuolaProvenienza ?? '—'}</strong>
              </div>
              {docenti.length > 0 && (
                <div className="col-span-3">
                  <span className="text-slate-500">Docenti:</span>{' '}
                  <strong>{docenti.join(' · ')}</strong>
                </div>
              )}
            </div>
          </section>

          {/* ---- Membri gruppo ---- */}
          {isGruppo && membri.length > 0 && (
            <section>
              <h3 className="font-mono text-[10px] uppercase tracking-wider text-slate-500 mb-2">
                {isc.tipoGruppo === 'orchestra' ? "Membri dell'orchestra" : 'Membri del gruppo'}
                {isc.gruppoNome ? ` (${isc.gruppoNome})` : ''}
              </h3>
              <ul className="space-y-1 text-xs">
                {membri.map((m, i) => (
                  <li key={i}>
                    · <strong>{`${m.nome ?? ''} ${m.cognome ?? ''}`}</strong>
                    {` — ${m.strumento ?? '—'}`}
                    {m.data_nascita ? ` (${m.data_nascita})` : ''}
                  </li>
                ))}
              </ul>
            </section>
          )}

          {/* ---- Programma ---- */}
          <section>
            <h3 className="font-mono text-[10px] uppercase tracking-wider text-slate-500 mb-2">
              Programma musicale ({programma.length} brani · {durataTotaleMin} min)
            </h3>
            {programma.length > 0 ? (
              <ol className="space-y-1 text-xs list-decimal pl-5">
                {programma.map((p, i) => (
                  <li key={i}>
                    <strong>{p.titolo ?? '—'}</strong>
                    {' '}— {p.autore ?? 'autore sconosciuto'}
                    <span className="text-slate-500"> ({p.durata_min ?? 0} min)</span>
                  </li>
                ))}
              </ol>
            ) : (
              <p className="text-xs italic text-slate-500">Nessun brano inserito.</p>
            )}
          </section>

          {/* ---- Note libere ---- */}
          {isc.noteLibere && (
            <section>
              <h3 className="font-mono text-[10px] uppercase tracking-wider text-slate-500 mb-2">Note del candidato</h3>
              <p className="bg-slate-50 border border-slate-200 rounded-lg p-3 text-xs whitespace-pre-wrap">
                {isc.noteLibere}
              </p>
            </section>
          )}

          {/* ---- Consensi GDPR (3 righe fisse, come nel vanilla) ---- */}
          <section className="bg-slate-50 border border-slate-200 rounded-xl p-3">
            <h3 className="font-mono text-[10px] uppercase tracking-wider text-slate-500 mb-2">Consensi</h3>
            <div className="text-xs space-y-1">
              <p>{gdpr.privacy ? '✅' : '❌'} Privacy (GDPR)</p>
              <p>{gdpr.immagini ? '✅' : '⚪'} Uso immagini</p>
              <p>{gdpr.regolamento ? '✅' : '❌'} Regolamento</p>
            </div>
          </section>

          {/* ---- Note admin / motivo rifiuto ----
               Nel nuovo stack reason del rifiuto e note admin condividono il
               campo `note`: se RIFIUTATA lo mostriamo come "Motivo del rifiuto"
               (rosa), altrimenti come "Note admin" (ambra). Riproduce le due
               sezioni distinte del vanilla. */}
          {isc.note && (
            isc.stato === 'RIFIUTATA' ? (
              <section>
                <h3 className="font-mono text-[10px] uppercase tracking-wider text-rose-700 mb-2">Motivo del rifiuto</h3>
                <p className="bg-rose-50 border border-rose-200 rounded-lg p-3 text-xs whitespace-pre-wrap">
                  {isc.note}
                </p>
              </section>
            ) : (
              <section>
                <h3 className="font-mono text-[10px] uppercase tracking-wider text-slate-500 mb-2">Note admin</h3>
                <p className="bg-amber-50 border border-amber-200 rounded-lg p-3 text-xs whitespace-pre-wrap">
                  {isc.note}
                </p>
              </section>
            )
          )}

          {/* ---- Allegati ---- */}
          <section>
            <h3 className="font-mono text-[10px] uppercase tracking-wider text-slate-500 mb-2">Allegati</h3>
            <AllegatiSection iscrizioneId={isc.id} />
          </section>

          {/* ---- IP / timestamps (debug) ---- */}
          {(isc.ipAddress || isc.emailVerifiedAt) && (
            <section className="text-[10px] text-slate-500 space-y-0.5 border-t pt-3">
              {isc.emailVerifiedAt && <p>Email verificata il {fmtDateTime(isc.emailVerifiedAt)}</p>}
              {isc.approvataAt && <p>Approvata il {fmtDateTime(isc.approvataAt)}</p>}
              {isc.ipAddress && <p>IP: {isc.ipAddress}</p>}
            </section>
          )}
        </div>

        {/* Footer — mirrors vanilla modal footer: Chiudi / Rifiuta / Approva */}
        <DialogFooter className="pt-2 gap-2 flex-wrap">
          <button type="button" className="c-btn c-btn--outline" onClick={onClose}>
            Chiudi
          </button>
          {isActive && (
            <>
              <button
                type="button"
                className="c-btn c-btn--outline text-rose-700 border-rose-300 hover:bg-rose-50"
                onClick={onReject}
              >
                ✕ Rifiuta
              </button>
              <button
                type="button"
                className="c-btn c-btn--primary"
                onClick={onApprove}
                disabled={isApprovePending}
              >
                {isApprovePending ? 'Approvazione…' : '✓ Approva'}
              </button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// IscrizioniTab (exported)
// ---------------------------------------------------------------------------

export function IscrizioniTab({ concorsoId }: { concorsoId: string }) {
  const { t } = useTranslation();
  const {
    iscrizioni,
    isLoading,
    isError,
    approveMutation,
    rejectMutation,
    refetch,
  } = useIscrizioni(concorsoId);

  // Nome concorso per il filename CSV.
  const { data: concorso } = useQuery({
    queryKey: ['concorsi', concorsoId],
    queryFn: () => getConcorso(concorsoId),
    enabled: !!concorsoId,
    staleTime: 60_000,
  });

  const [filterStato, setFilterStato] = useState<StatoDbAll>('');
  const [detail, setDetail] = useState<IscrizioneFull | null>(null);
  const [rejectDialog, setRejectDialog] = useState<IscrizioneFull | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isExporting, setIsExporting] = useState(false);

  // Counts per filter pills
  const counts = useMemo(() => ({
    total:           iscrizioni.length,
    BOZZA:           iscrizioni.filter((i) => i.stato === 'BOZZA').length,
    INVIATA:         iscrizioni.filter((i) => i.stato === 'INVIATA').length,
    EMAIL_VERIFICATA:iscrizioni.filter((i) => i.stato === 'EMAIL_VERIFICATA').length,
    APPROVATA:       iscrizioni.filter((i) => i.stato === 'APPROVATA').length,
    RIFIUTATA:       iscrizioni.filter((i) => i.stato === 'RIFIUTATA').length,
  }), [iscrizioni]);

  const filtered = useMemo(
    () => (filterStato ? iscrizioni.filter((i) => i.stato === filterStato) : iscrizioni),
    [iscrizioni, filterStato],
  );

  const handleRefresh = async () => {
    setIsRefreshing(true);
    try { await refetch(); } finally { setIsRefreshing(false); }
  };

  const handleApprove = async (isc: IscrizioneFull) => {
    try {
      await approveMutation.mutateAsync({ id: isc.id });
      toast.success(`Iscrizione di ${displayName(isc)} approvata`);
      setDetail(null);
    } catch (e) {
      toast.error(httpErrorMessage(e));
    }
  };

  const handleReject = async (isc: IscrizioneFull, reason: string) => {
    try {
      await rejectMutation.mutateAsync({ id: isc.id, reason });
      toast.success('Iscrizione rifiutata');
      setRejectDialog(null);
      setDetail(null);
    } catch (e) {
      toast.error(httpErrorMessage(e));
    }
  };

  // Export CSV — generato lato SERVER (admin-only, tracciato in audit per PII).
  // Esporta TUTTE le iscrizioni del concorso (non solo quelle filtrate/caricate
  // in pagina): la sorgente di verità è il DB, non lo stato della tabella.
  const handleExportCsv = async () => {
    if (isExporting) return;
    setIsExporting(true);
    try {
      const blob = await iscrizioniApi.exportCsv(concorsoId);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      const safeName = ((concorso?.nome ?? '') || 'iscrizioni')
        // eslint-disable-next-line no-control-regex -- sanitizzazione nome file CSV
        .replace(/[\\/\x00-\x1f]+/g, '_')
        .replaceAll(' ', '_') || 'iscrizioni';
      a.download = `iscrizioni-${safeName}.csv`;
      a.click();
      URL.revokeObjectURL(url);
      toast.success(t('iscrizioni.exportSuccess'));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : httpErrorMessage(e));
    } finally {
      setIsExporting(false);
    }
  };

  // -------------------------------------------------------------------------
  // Filter pill helper — mirrors vanilla iscFilterPill exactly
  // -------------------------------------------------------------------------

  const FILTER_PILLS: { stato: StatoDbAll; label: string; count: number; colors: string }[] = [
    { stato: '',               label: 'Tutte',           count: counts.total,           colors: 'bg-slate-100 text-slate-700 border-slate-200' },
    { stato: 'INVIATA',        label: 'In attesa',       count: counts.INVIATA,         colors: 'bg-amber-50 text-amber-800 border-amber-200' },
    { stato: 'EMAIL_VERIFICATA', label: 'Email verificata', count: counts.EMAIL_VERIFICATA, colors: 'bg-sky-50 text-sky-800 border-sky-200' },
    { stato: 'APPROVATA',      label: 'Approvate',       count: counts.APPROVATA,       colors: 'bg-emerald-50 text-emerald-800 border-emerald-200' },
    { stato: 'RIFIUTATA',      label: 'Rifiutate',       count: counts.RIFIUTATA,       colors: 'bg-rose-50 text-rose-800 border-rose-200' },
  ];

  // -------------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------------

  if (isLoading) {
    return (
      <div className="text-center py-10 text-slate-500">Caricamento…</div>
    );
  }

  if (isError) {
    return (
      <div className="bg-rose-50 border border-rose-200 rounded-2xl p-4 text-sm text-rose-800">
        Errore nel caricamento delle iscrizioni.
      </div>
    );
  }

  return (
    <div>
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-2 mb-4">
        <p className="text-sm text-slate-600">
          {filtered.length} iscrizioni
          {filterStato ? ` (filtrate per "${filterStato}")` : ''}
        </p>
        <div className="flex items-center gap-1.5">
          <a
            href="/iscrizione"
            target="_blank"
            rel="noopener noreferrer"
            className="c-btn c-btn--outline c-btn--sm !gap-1 text-emerald-700 border-emerald-300 hover:bg-emerald-50"
            title="Apri il form pubblico di iscrizione in una nuova scheda"
          >
            <ExternalLink size={14} />
            <span>Form pubblico</span>
          </a>
          <button
            type="button"
            className="c-btn c-btn--ghost c-btn--sm !gap-1"
            onClick={handleRefresh}
            disabled={isRefreshing}
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width={14}
              height={14}
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth={2}
              strokeLinecap="round"
              strokeLinejoin="round"
              className={isRefreshing ? 'animate-spin' : ''}
            >
              <path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8" />
              <path d="M21 3v5h-5" />
              <path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16" />
              <path d="M8 16H3v5" />
            </svg>
            <span>Aggiorna</span>
          </button>
          <button
            type="button"
            className="c-btn c-btn--ghost c-btn--sm !gap-1"
            onClick={() => void handleExportCsv()}
            disabled={isExporting}
          >
            <Download size={14} />
            <span>{isExporting ? t('iscrizioni.exporting') : t('iscrizioni.exportCsv')}</span>
          </button>
        </div>
      </div>

      {/* Filter pills — mirrors vanilla iscFilterPill */}
      <div className="flex flex-wrap gap-1.5 mb-4">
        {FILTER_PILLS.map(({ stato, label, count, colors }) => {
          const active = filterStato === stato;
          const cls = active ? 'bg-brand-600 text-white border-brand-600' : colors;
          return (
            <button
              key={stato}
              type="button"
              data-isc-filter={stato}
              onClick={() => setFilterStato(stato)}
              className={`text-xs font-medium border ${cls} px-3 py-1.5 rounded-full inline-flex items-center gap-1.5 hover:brightness-95 transition`}
            >
              <span>{label}</span>
              <span
                className={`text-[10px] font-bold ${active ? 'bg-white/20 text-white' : 'bg-white text-slate-600'} px-1.5 py-0.5 rounded-full`}
              >
                {count}
              </span>
            </button>
          );
        })}
      </div>

      {/* Main content */}
      {filtered.length === 0 ? (
        /* Empty — identico al vanilla: stesso blocco sia a lista vuota che a
           filtro senza risultati, cambia solo il suffisso del testo. */
        <div className="bg-white border-2 border-dashed border-slate-200 rounded-2xl py-12 text-center">
          <div className="text-4xl mb-2">📭</div>
          <p className="text-sm text-slate-500 italic">
            Nessuna iscrizione{filterStato ? ' con questo stato' : ''}.
          </p>
          <p className="text-sm text-slate-500 italic mt-1">Le iscrizioni inviate dal form pubblico compariranno qui.</p>
          <a
            href="/iscrizione"
            target="_blank"
            rel="noopener noreferrer"
            className="c-btn c-btn--primary c-btn--sm mt-5 inline-flex items-center gap-1.5"
          >
            <ExternalLink size={14} />
            <span>Apri form di iscrizione pubblico</span>
          </a>
        </div>
      ) : (
        /* Table — mirrors vanilla exactly */
        <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-xs uppercase tracking-wider text-slate-600">
              <tr>
                <th className="text-left px-3 py-2.5">Data</th>
                <th className="text-left px-3 py-2.5">Candidato</th>
                <th className="text-left px-3 py-2.5 hidden sm:table-cell">Email</th>
                <th className="text-left px-3 py-2.5 hidden md:table-cell">Strumento</th>
                <th className="text-left px-3 py-2.5">Stato</th>
                <th className="text-right px-3 py-2.5">Azioni</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filtered.map((isc) => {
                const created = new Date(isc.createdAt).toLocaleDateString('it-IT', {
                  day: '2-digit', month: 'short', year: '2-digit',
                });
                const ora = new Date(isc.createdAt).toLocaleTimeString('it-IT', {
                  hour: '2-digit', minute: '2-digit',
                });
                return (
                  <tr
                    key={isc.id}
                    className="hover:bg-slate-50 transition-colors cursor-pointer"
                    onClick={() => setDetail(isc)}
                  >
                    <td className="px-3 py-2.5 text-xs text-slate-600 whitespace-nowrap">
                      {created}<br />
                      <span className="text-slate-400">{ora}</span>
                    </td>
                    <td className="px-3 py-2.5">
                      <p className="font-medium text-slate-900">{isc.nome} {isc.cognome ?? ''}</p>
                      {isc.isGruppo && isc.tipoGruppo === 'orchestra' && (
                        <p className="text-[11px] text-indigo-700">{isc.gruppoNome || 'Orchestra'}</p>
                      )}
                      {isc.isGruppo && isc.tipoGruppo !== 'orchestra' && (
                        <p className="text-[11px] text-purple-700">{isc.gruppoNome || 'Gruppo'}</p>
                      )}
                    </td>
                    <td className="px-3 py-2.5 text-xs text-slate-600 hidden sm:table-cell">
                      {isc.email}
                    </td>
                    <td className="px-3 py-2.5 text-xs text-slate-700 hidden md:table-cell">
                      {isc.strumento ?? '—'}
                    </td>
                    <td className="px-3 py-2.5">
                      <StatoBadge stato={isc.stato} />
                    </td>
                    <td
                      className="px-3 py-2.5 text-right"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <button
                        type="button"
                        className="c-btn c-btn--ghost c-btn--sm !px-2"
                        title="Vedi dettagli"
                        onClick={() => setDetail(isc)}
                      >
                        <ChevronRight size={14} />
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Detail dialog */}
      <IscrizioneDetailDialog
        open={!!detail}
        iscrizione={detail}
        onClose={() => setDetail(null)}
        onApprove={() => { if (detail) void handleApprove(detail); }}
        onReject={() => {
          if (detail) { setRejectDialog(detail); setDetail(null); }
        }}
        isApprovePending={approveMutation.isPending}
      />

      {/* Reject dialog */}
      <RejectDialog
        open={!!rejectDialog}
        iscrizione={rejectDialog}
        onCancel={() => setRejectDialog(null)}
        onConfirm={(reason) => { if (rejectDialog) void handleReject(rejectDialog, reason); }}
        isPending={rejectMutation.isPending}
      />
    </div>
  );
}

export default IscrizioniTab;
