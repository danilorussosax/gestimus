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
import { toast } from 'sonner';
import {
  ChevronRight, RefreshCw, Download, CheckCircle2, XCircle,
  AlertCircle, Mail, Phone, MapPin, Music, Shield, Paperclip,
  ExternalLink,
} from 'lucide-react';

import { cn } from '@/lib/utils';
import { httpErrorMessage } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';

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

function fmtDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('it-IT', {
    day: '2-digit',
    month: 'short',
    year: '2-digit',
  });
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
// Stato badges / pills
// ---------------------------------------------------------------------------

type StatoDbAll = IscrizioneStatoDb | '';

const STATO_CONFIG: Record<
  IscrizioneStatoDb,
  { label: string; color: string; pill: string; icon: React.ReactNode }
> = {
  BOZZA: {
    label: 'Bozza',
    color: 'bg-slate-100 text-slate-700',
    pill: 'bg-slate-100 text-slate-700 border-slate-200',
    icon: null,
  },
  INVIATA: {
    label: 'In attesa',
    color: 'bg-amber-100 text-amber-800',
    pill: 'bg-amber-50 text-amber-800 border-amber-200',
    icon: <AlertCircle className="h-3 w-3" />,
  },
  EMAIL_VERIFICATA: {
    label: 'Email verificata',
    color: 'bg-sky-100 text-sky-800',
    pill: 'bg-sky-50 text-sky-800 border-sky-200',
    icon: <Mail className="h-3 w-3" />,
  },
  APPROVATA: {
    label: 'Approvata',
    color: 'bg-emerald-100 text-emerald-800',
    pill: 'bg-emerald-50 text-emerald-800 border-emerald-200',
    icon: <CheckCircle2 className="h-3 w-3" />,
  },
  RIFIUTATA: {
    label: 'Rifiutata',
    color: 'bg-rose-100 text-rose-800',
    pill: 'bg-rose-50 text-rose-800 border-rose-200',
    icon: <XCircle className="h-3 w-3" />,
  },
};

function StatoBadge({ stato }: { stato: IscrizioneStatoDb }) {
  const cfg = STATO_CONFIG[stato];
  if (!cfg) return <span className="text-xs text-muted-foreground">{stato}</span>;
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider',
        cfg.color,
      )}
    >
      {cfg.icon}
      {cfg.label}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Reject dialog
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
          <DialogTitle className="flex items-center gap-2 text-rose-700">
            <XCircle className="h-5 w-5" />
            Rifiuta iscrizione
          </DialogTitle>
          <DialogDescription>
            Rifiutare l&apos;iscrizione di <strong>{iscrizione ? displayName(iscrizione) : ''}</strong>?
            Il motivo (opzionale) verrà comunicato al candidato.
          </DialogDescription>
        </DialogHeader>
        <div>
          <Label className="mb-1 block">Motivo del rifiuto <span className="text-muted-foreground text-xs">(opzionale)</span></Label>
          <Textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            rows={3}
            placeholder="es. Documentazione incompleta, fascia d'età non corrispondente…"
          />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onCancel}>Annulla</Button>
          <Button variant="destructive" onClick={handleConfirm} disabled={isPending}>
            {isPending ? 'Rifiuto in corso…' : 'Rifiuta iscrizione'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// AllegatiSection (inside detail dialog)
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
    foto: 'Foto',
    documento: 'Documento',
    ricevuta: 'Ricevuta',
    altro: 'Altro',
  };

  if (loading) {
    return <p className="text-xs text-muted-foreground italic">Caricamento allegati…</p>;
  }
  if (error) {
    return <p className="text-xs text-destructive">{error}</p>;
  }
  if (!allegati || allegati.length === 0) {
    return <p className="text-xs text-muted-foreground italic">Nessun allegato.</p>;
  }

  return (
    <ul className="space-y-1.5">
      {allegati.map((a) => (
        <li
          key={a.id}
          className="flex items-center justify-between gap-3 bg-muted/30 border border-border rounded-lg px-3 py-2"
        >
          <div className="flex items-center gap-2 min-w-0">
            <Paperclip className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
            <span className="text-xs text-foreground truncate">
              {TIPO_LABEL[a.tipo] ?? a.tipo} · {a.nomeFile}
              {a.sizeBytes && (
                <span className="text-muted-foreground ml-1">{fmtBytes(a.sizeBytes)}</span>
              )}
            </span>
          </div>
          <a
            href={iscrizioniApi.downloadAllegatoUrl(a.id)}
            target="_blank"
            rel="noopener noreferrer"
            className="shrink-0 text-xs text-primary font-semibold hover:underline flex items-center gap-1"
          >
            <Download className="h-3 w-3" />
            Scarica
          </a>
        </li>
      ))}
    </ul>
  );
}

// ---------------------------------------------------------------------------
// IscrizioneDetailDialog
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
    : [];

  const gdpr = isc.consensiGdpr ?? {};

  const gdprLabels: Record<string, string> = {
    privacy: 'Privacy (GDPR)',
    immagini: 'Uso immagini',
    regolamento: 'Accettazione regolamento',
    newsletter: 'Newsletter',
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-2xl max-h-[90dvh] flex flex-col">
        <DialogHeader>
          <div className="flex items-start justify-between gap-3">
            <div>
              <DialogTitle>
                {displayName(isc)} · {isc.strumento ?? '—'}
              </DialogTitle>
              <div className="flex items-center gap-2 mt-1.5">
                <StatoBadge stato={isc.stato} />
                <span className="text-xs text-muted-foreground">
                  Inviata il {fmtDateTime(isc.createdAt)}
                </span>
              </div>
            </div>
          </div>
        </DialogHeader>

        <div className="overflow-y-auto flex-1 space-y-5 text-sm pr-1">
          {/* ---- Anagrafica ---- */}
          <section>
            <h3 className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground mb-2">
              Anagrafica
            </h3>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-4 gap-y-2 text-xs">
              <div>
                <span className="text-muted-foreground">Nato il:</span>{' '}
                <strong>{fmtDate(isc.dataNascita)}</strong>
                {age != null && <span className="text-muted-foreground ml-1">({age} anni)</span>}
              </div>
              <div>
                <span className="text-muted-foreground">Luogo nascita:</span>{' '}
                <strong>{isc.luogoNascita ?? '—'}</strong>
              </div>
              <div>
                <span className="text-muted-foreground">Nazionalità:</span>{' '}
                <strong>{isc.nazionalita ?? '—'}</strong>
              </div>
              {isc.sesso && (
                <div>
                  <span className="text-muted-foreground">Sesso:</span>{' '}
                  <strong>{isc.sesso}</strong>
                </div>
              )}
              {isc.codiceFiscale && (
                <div className="col-span-2">
                  <span className="text-muted-foreground">Codice fiscale:</span>{' '}
                  <strong className="font-mono">{isc.codiceFiscale}</strong>
                </div>
              )}
            </div>
          </section>

          {/* ---- Contatti ---- */}
          <section>
            <h3 className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground mb-2">
              Contatti
            </h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-1.5 text-xs">
              <div className="flex items-center gap-1.5">
                <Mail className="h-3 w-3 text-muted-foreground shrink-0" />
                <a href={`mailto:${isc.email}`} className="text-primary hover:underline truncate">
                  {isc.email}
                </a>
              </div>
              {isc.telefono && (
                <div className="flex items-center gap-1.5">
                  <Phone className="h-3 w-3 text-muted-foreground shrink-0" />
                  <a href={`tel:${isc.telefono}`} className="hover:underline">
                    {isc.telefono}
                  </a>
                </div>
              )}
              {(isc.indirizzo || isc.citta) && (
                <div className="flex items-start gap-1.5 sm:col-span-2">
                  <MapPin className="h-3 w-3 text-muted-foreground shrink-0 mt-0.5" />
                  <span>
                    {[isc.indirizzo, isc.citta, isc.cap, isc.provincia && `(${isc.provincia})`, isc.paese]
                      .filter(Boolean)
                      .join(', ')}
                  </span>
                </div>
              )}
            </div>
          </section>

          {/* ---- Tutore (minorenne) ---- */}
          {(isMinor || tutore?.nome) && (
            <section className="bg-amber-50 border border-amber-200 rounded-xl p-3">
              <h3 className="font-mono text-[10px] uppercase tracking-wider text-amber-800 mb-2 flex items-center gap-1">
                <AlertCircle className="h-3.5 w-3.5" />
                Candidato minorenne · dati tutore
              </h3>
              <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
                <div>
                  <span className="text-slate-600">Nome:</span>{' '}
                  <strong>{[tutore?.nome, tutore?.cognome].filter(Boolean).join(' ') || '—'}</strong>
                </div>
                {tutore?.email && (
                  <div>
                    <span className="text-slate-600">Email:</span>{' '}
                    <strong>{tutore.email}</strong>
                  </div>
                )}
                {tutore?.telefono && (
                  <div>
                    <span className="text-slate-600">Telefono:</span>{' '}
                    <strong>{tutore.telefono}</strong>
                  </div>
                )}
              </div>
            </section>
          )}

          {/* ---- Dati artistici ---- */}
          <section>
            <h3 className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground mb-2 flex items-center gap-1">
              <Music className="h-3.5 w-3.5" />
              Dati artistici
            </h3>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-4 gap-y-2 text-xs">
              {isGruppo && (
                <div>
                  <span className="text-muted-foreground">Tipo:</span>{' '}
                  <strong>{isc.tipoGruppo ?? 'gruppo'}</strong>
                </div>
              )}
              <div>
                <span className="text-muted-foreground">Strumento:</span>{' '}
                <strong>{isc.strumento ?? '—'}</strong>
              </div>
              {isc.anniStudio != null && (
                <div>
                  <span className="text-muted-foreground">Anni studio:</span>{' '}
                  <strong>{isc.anniStudio}</strong>
                </div>
              )}
              {isc.scuolaProvenienza && (
                <div className="col-span-3">
                  <span className="text-muted-foreground">Scuola / Conservatorio:</span>{' '}
                  <strong>{isc.scuolaProvenienza}</strong>
                </div>
              )}
              {docenti.length > 0 && (
                <div className="col-span-3">
                  <span className="text-muted-foreground">Docenti:</span>{' '}
                  <strong>{docenti.join(' · ')}</strong>
                </div>
              )}
            </div>
          </section>

          {/* ---- Membri gruppo ---- */}
          {isGruppo && membri.length > 0 && (
            <section>
              <h3 className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground mb-2">
                {isc.tipoGruppo === 'orchestra' ? "Membri dell'orchestra" : 'Membri del gruppo'}
                {isc.gruppoNome && ` — ${isc.gruppoNome}`}
              </h3>
              <ul className="space-y-1 text-xs">
                {membri.map((m, i) => (
                  <li key={i}>
                    · <strong>{[m.nome, m.cognome].filter(Boolean).join(' ')}</strong>
                    {m.strumento && ` — ${m.strumento}`}
                    {m.data_nascita && ` (${fmtDate(m.data_nascita)})`}
                  </li>
                ))}
              </ul>
            </section>
          )}

          {/* ---- Programma ---- */}
          {programma.length > 0 && (
            <section>
              <h3 className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground mb-2">
                Programma musicale ({programma.length} brani)
              </h3>
              <ol className="space-y-1 text-xs list-decimal pl-5">
                {programma.map((p, i) => (
                  <li key={i}>
                    <strong>{p.titolo ?? '—'}</strong>
                    {p.autore && ` — ${p.autore}`}
                    {p.durata_min != null && (
                      <span className="text-muted-foreground"> ({p.durata_min} min)</span>
                    )}
                  </li>
                ))}
              </ol>
            </section>
          )}

          {/* ---- Consensi GDPR ---- */}
          <section className="bg-muted/40 border border-border rounded-xl p-3">
            <h3 className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground mb-2 flex items-center gap-1">
              <Shield className="h-3.5 w-3.5" />
              Consensi GDPR
            </h3>
            {Object.keys(gdpr).length === 0 ? (
              <p className="text-xs text-muted-foreground italic">Nessun dato consensi.</p>
            ) : (
              <div className="text-xs space-y-1">
                {Object.entries(gdpr).map(([key, val]) => (
                  <div key={key} className="flex items-center gap-1.5">
                    {val ? (
                      <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600 shrink-0" />
                    ) : (
                      <XCircle className="h-3.5 w-3.5 text-rose-500 shrink-0" />
                    )}
                    <span className={cn(!val && 'text-muted-foreground')}>
                      {gdprLabels[key] ?? key}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </section>

          {/* ---- Note libere ---- */}
          {isc.noteLibere && (
            <section>
              <h3 className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground mb-2">
                Note del candidato
              </h3>
              <p className="bg-muted/30 border border-border rounded-lg p-3 text-xs whitespace-pre-wrap">
                {isc.noteLibere}
              </p>
            </section>
          )}

          {/* ---- Note admin / motivo rifiuto ---- */}
          {isc.note && (
            <section>
              <h3 className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground mb-2">Note admin</h3>
              <p className="bg-amber-50 border border-amber-200 rounded-lg p-3 text-xs whitespace-pre-wrap">
                {isc.note}
              </p>
            </section>
          )}

          {/* ---- Allegati ---- */}
          <section>
            <h3 className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground mb-2 flex items-center gap-1">
              <Paperclip className="h-3.5 w-3.5" />
              Allegati
            </h3>
            <AllegatiSection iscrizioneId={isc.id} />
          </section>

          {/* ---- IP / user agent (debug) ---- */}
          {(isc.ipAddress || isc.emailVerifiedAt) && (
            <section className="text-[10px] text-muted-foreground space-y-0.5 border-t pt-3">
              {isc.emailVerifiedAt && <p>Email verificata il {fmtDateTime(isc.emailVerifiedAt)}</p>}
              {isc.approvataAt && <p>Approvata il {fmtDateTime(isc.approvataAt)}</p>}
              {isc.ipAddress && <p>IP: {isc.ipAddress}</p>}
            </section>
          )}
        </div>

        <DialogFooter className="pt-2 gap-2 flex-wrap">
          <Button variant="outline" onClick={onClose}>
            Chiudi
          </Button>
          {isActive && (
            <>
              <Button
                variant="outline"
                className="text-rose-700 border-rose-300 hover:bg-rose-50"
                onClick={onReject}
              >
                <XCircle className="h-4 w-4" />
                Rifiuta
              </Button>
              <Button
                className="bg-emerald-600 hover:bg-emerald-700 text-white"
                onClick={onApprove}
                disabled={isApprovePending}
              >
                {isApprovePending ? (
                  'Approvazione…'
                ) : (
                  <>
                    <CheckCircle2 className="h-4 w-4" />
                    Approva iscrizione
                  </>
                )}
              </Button>
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
  const {
    iscrizioni,
    isLoading,
    isError,
    approveMutation,
    rejectMutation,
    refetch,
  } = useIscrizioni(concorsoId);

  const [filterStato, setFilterStato] = useState<StatoDbAll>('');
  const [detail, setDetail] = useState<IscrizioneFull | null>(null);
  const [rejectDialog, setRejectDialog] = useState<IscrizioneFull | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);

  // Counts per filter pills
  const counts = useMemo(() => ({
    total: iscrizioni.length,
    BOZZA: iscrizioni.filter((i) => i.stato === 'BOZZA').length,
    INVIATA: iscrizioni.filter((i) => i.stato === 'INVIATA').length,
    EMAIL_VERIFICATA: iscrizioni.filter((i) => i.stato === 'EMAIL_VERIFICATA').length,
    APPROVATA: iscrizioni.filter((i) => i.stato === 'APPROVATA').length,
    RIFIUTATA: iscrizioni.filter((i) => i.stato === 'RIFIUTATA').length,
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
      toast.success(`Iscrizione rifiutata`);
      setRejectDialog(null);
      setDetail(null);
    } catch (e) {
      toast.error(httpErrorMessage(e));
    }
  };

  // CSV export
  const handleExportCsv = () => {
    const csvField = (v: unknown): string => {
      let s = String(v ?? '');
      if (s.length && /^[=+\-@\t\r]/.test(s)) s = `'${s}`;
      return `"${s.replaceAll('"', '""')}"`;
    };
    const headers = [
      'Data', 'Stato', 'Nome', 'Cognome', 'Email', 'Telefono',
      'Data nascita', 'Nazionalità', 'Sesso', 'Strumento', 'Tipo',
      'Anni studio', 'Scuola', 'Indirizzo', 'Città', 'CAP', 'Provincia',
    ];
    const lines = [headers.map(csvField).join(',')];
    for (const i of filtered) {
      lines.push([
        new Date(i.createdAt).toLocaleString('it-IT'),
        i.stato,
        i.nome, i.cognome, i.email, i.telefono,
        i.dataNascita, i.nazionalita, i.sesso, i.strumento,
        i.isGruppo ? (i.tipoGruppo ?? 'gruppo') : 'individuale',
        i.anniStudio, i.scuolaProvenienza,
        i.indirizzo, i.citta, i.cap, i.provincia,
      ].map(csvField).join(','));
    }
    const blob = new Blob(['﻿' + lines.join('\n')], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `iscrizioni.csv`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success(`${filtered.length} iscrizioni esportate`);
  };

  // -------------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------------
  if (isLoading) {
    return (
      <div className="space-y-3">
        {[1, 2, 3, 4].map((i) => (
          <Skeleton key={i} className="h-12 w-full rounded-xl" />
        ))}
      </div>
    );
  }

  if (isError) {
    return <p className="text-sm text-destructive">Errore nel caricamento delle iscrizioni.</p>;
  }

  const FILTER_PILLS: { stato: StatoDbAll; label: string; count: number }[] = [
    { stato: '', label: 'Tutte', count: counts.total },
    { stato: 'INVIATA', label: 'In attesa', count: counts.INVIATA },
    { stato: 'EMAIL_VERIFICATA', label: 'Email verificata', count: counts.EMAIL_VERIFICATA },
    { stato: 'APPROVATA', label: 'Approvate', count: counts.APPROVATA },
    { stato: 'RIFIUTATA', label: 'Rifiutate', count: counts.RIFIUTATA },
  ];

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">
          {filtered.length} iscrizioni
          {filterStato && ` filtrate per "${STATO_CONFIG[filterStato]?.label ?? filterStato}"`}
        </p>
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            variant="outline"
            className="gap-1.5"
            onClick={handleRefresh}
            disabled={isRefreshing}
          >
            <RefreshCw className={cn('h-3.5 w-3.5', isRefreshing && 'animate-spin')} />
            Aggiorna
          </Button>
          <Button size="sm" variant="outline" className="gap-1.5" onClick={handleExportCsv}>
            <Download className="h-3.5 w-3.5" />
            Esporta CSV
          </Button>
          <a
            href="#/iscrizione"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 text-xs font-medium text-emerald-700 border border-emerald-300 hover:bg-emerald-50 px-3 py-1.5 rounded-md transition-colors"
          >
            <ExternalLink className="h-3.5 w-3.5" />
            Form pubblico
          </a>
        </div>
      </div>

      {/* Filter pills */}
      <div className="flex flex-wrap gap-1.5">
        {FILTER_PILLS.map(({ stato, label, count }) => {
          const active = filterStato === stato;
          const colors =
            stato === '' ? 'bg-slate-100 text-slate-700 border-slate-200'
            : stato === 'INVIATA' ? 'bg-amber-50 text-amber-800 border-amber-200'
            : stato === 'EMAIL_VERIFICATA' ? 'bg-sky-50 text-sky-800 border-sky-200'
            : stato === 'APPROVATA' ? 'bg-emerald-50 text-emerald-800 border-emerald-200'
            : 'bg-rose-50 text-rose-800 border-rose-200';
          return (
            <button
              key={stato}
              type="button"
              onClick={() => setFilterStato(stato)}
              className={cn(
                'inline-flex items-center gap-1.5 text-xs font-medium border px-3 py-1.5 rounded-full transition-all',
                active ? 'bg-primary text-primary-foreground border-primary' : colors,
                'hover:brightness-95',
              )}
            >
              {label}
              <span
                className={cn(
                  'text-[10px] font-bold px-1.5 py-0.5 rounded-full',
                  active ? 'bg-white/20 text-white' : 'bg-white text-slate-600',
                )}
              >
                {count}
              </span>
            </button>
          );
        })}
      </div>

      {/* Empty state */}
      {iscrizioni.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-2xl border-2 border-dashed border-border py-14 text-center">
          <Mail className="mx-auto h-10 w-10 text-muted-foreground/40 mb-3" />
          <p className="text-sm text-muted-foreground italic">
            Nessuna iscrizione ricevuta.
          </p>
          <p className="text-xs text-muted-foreground mt-1">
            Le iscrizioni inviate dal form pubblico compariranno qui.
          </p>
          <a
            href="#/iscrizione"
            target="_blank"
            rel="noopener noreferrer"
            className="mt-4 inline-flex items-center gap-1.5 text-sm font-medium bg-primary text-primary-foreground hover:bg-primary/90 px-4 py-2 rounded-md transition-colors"
          >
            <ExternalLink className="h-4 w-4" />
            Apri form di iscrizione pubblico
          </a>
        </div>
      ) : filtered.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-2xl border-2 border-dashed border-border py-10 text-center">
          <p className="text-sm text-muted-foreground italic">
            Nessuna iscrizione con questo stato.
          </p>
        </div>
      ) : (
        <div className="bg-card border border-border rounded-2xl overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-muted/40 text-xs uppercase tracking-wider text-muted-foreground">
              <tr>
                <th className="text-left px-3 py-2.5">Data</th>
                <th className="text-left px-3 py-2.5">Candidato</th>
                <th className="text-left px-3 py-2.5 hidden sm:table-cell">Email</th>
                <th className="text-left px-3 py-2.5 hidden md:table-cell">Strumento</th>
                <th className="text-left px-3 py-2.5">Stato</th>
                <th className="text-right px-3 py-2.5">Azioni</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {filtered.map((isc) => (
                <tr
                  key={isc.id}
                  className="hover:bg-muted/30 transition-colors cursor-pointer"
                  onClick={() => setDetail(isc)}
                >
                  <td className="px-3 py-2.5 text-xs text-muted-foreground whitespace-nowrap">
                    <span className="block">{fmtDate(isc.createdAt)}</span>
                    <span className="text-muted-foreground/60">
                      {new Date(isc.createdAt).toLocaleTimeString('it-IT', {
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </span>
                  </td>
                  <td className="px-3 py-2.5">
                    <p className="font-medium text-foreground">{displayName(isc)}</p>
                    {isc.isGruppo && isc.gruppoNome && (
                      <p className="text-[11px] text-purple-700">{isc.gruppoNome}</p>
                    )}
                  </td>
                  <td className="px-3 py-2.5 text-xs text-muted-foreground hidden sm:table-cell truncate max-w-40">
                    {isc.email}
                  </td>
                  <td className="px-3 py-2.5 text-xs text-muted-foreground hidden md:table-cell">
                    {isc.strumento ?? '—'}
                  </td>
                  <td className="px-3 py-2.5">
                    <StatoBadge stato={isc.stato} />
                  </td>
                  <td className="px-3 py-2.5 text-right" onClick={(e) => e.stopPropagation()}>
                    <div className="inline-flex items-center gap-1">
                      {(isc.stato === 'INVIATA' || isc.stato === 'EMAIL_VERIFICATA') && (
                        <>
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-7 px-2 text-[11px] text-emerald-700 hover:bg-emerald-50 hover:text-emerald-800"
                            onClick={() => handleApprove(isc)}
                            disabled={approveMutation.isPending}
                            title="Approva iscrizione"
                          >
                            <CheckCircle2 className="h-3.5 w-3.5" />
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-7 px-2 text-[11px] text-rose-600 hover:bg-rose-50 hover:text-rose-700"
                            onClick={() => setRejectDialog(isc)}
                            title="Rifiuta iscrizione"
                          >
                            <XCircle className="h-3.5 w-3.5" />
                          </Button>
                        </>
                      )}
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-7 px-2 text-muted-foreground hover:text-foreground"
                        onClick={() => setDetail(isc)}
                        title="Vedi dettagli"
                      >
                        <ChevronRight className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Detail dialog */}
      <IscrizioneDetailDialog
        open={!!detail}
        iscrizione={detail}
        onClose={() => setDetail(null)}
        onApprove={() => detail && handleApprove(detail)}
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
        onConfirm={(reason) => rejectDialog && handleReject(rejectDialog, reason)}
        isPending={rejectMutation.isPending}
      />
    </div>
  );
}

export default IscrizioniTab;
