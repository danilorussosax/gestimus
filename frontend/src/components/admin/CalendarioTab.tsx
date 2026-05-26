/**
 * CalendarioTab — Gestione Sale + Blocchi (eventi) + Slot + Link pubblici.
 *
 * Ricostruzione fedele della vista vanilla `js/views/admin/calendario.js`
 * (+ `js/calendario-pdf.js`). Board drag-and-drop a due livelli:
 *   - card-blocco (eventi_calendario) trascinabile tra lane giorno × sala
 *   - card-candidato (slot) trascinabile per riordinare dentro il blocco
 * In entrambi i casi gli orari individuali si ricalcolano lato server.
 *
 * Props: concorsoId: string
 *
 * Feature (1:1 con la vista vanilla):
 *   - Header: titolo/sottotitolo, bottone "Scarica PDF", bottone "Nuovo blocco"
 *   - Sale: chips con edit/delete + modale CRUD (nome, indirizzo)
 *   - Board: giorni × lane (ogni sala + "senza sala"), card-blocco ESIBIZIONE/EVENTO
 *     con drag tra lane (sposta data/sala → server ricalcola), azioni
 *     genera-slot / edit / delete per card
 *   - Slot list per card ESIBIZIONE con drag-reorder (riordina-slot)
 *   - Form blocco: tipo (cascade EVENTO/ESIBIZIONE), fase/sezione/categoria
 *     (categorie dipendono dalla sezione), durata, data, ore, sala, note
 *   - Link pubblici: create (scopo CONCORSO/SEZIONE/GIORNO + flag), copy,
 *     tabellone (display), toggle attivo, revoke
 *   - Export PDF intero concorso (giorni → blocchi → slot + giuria)
 *
 * Dipendenze query (@/api/calendario): sale, eventi, pubblicazioni; più
 * sezioni/fasi/categorie/candidati/candidati-fase per popolare board+slot e
 * concorso/commissari/commissioni per il PDF.
 */

import { useState, useCallback, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient, useQueries } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { Plus, Pencil, Trash2, Download } from 'lucide-react';
import { http, httpErrorMessage } from '@/lib/api';
import { calendarioApi } from '@/api/calendario';
import { getConcorso } from '@/api/concorsi';
import { commissariApi } from '@/api/commissari';
import { commissioniApi } from '@/api/commissioni';
import { normalizeCandidato } from '@/api/candidati';
import { exportCalendarioPdf } from '@/lib/calendario-pdf';
import type {
  Sala,
  Evento,
  Sezione,
  Fase,
  Categoria,
  Candidato,
  CandidatoFase,
} from '@/types';

import { fmtDay, displayName, SALA_NONE } from './calendario-utils';
import {
  SALE_KEY,
  EVENTI_KEY,
  PUB_KEY,
  SEZIONI_KEY,
  FASI_KEY,
  CATEGORIE_KEY,
  CANDIDATI_KEY,
  CF_KEY,
} from './calendario-schemas';
import type { Slot } from './calendario-schemas';
import { ConfirmDialog } from './calendario/ConfirmDialog';
import type { ConfirmState } from './calendario/ConfirmDialog';
import { SalaDialog } from './calendario/SalaDialog';
import { PubRow } from './calendario/PubRow';
import { LinkDialog } from './calendario/LinkDialog';
import { BlockCard } from './calendario/BlockCard';
import { BlockDialog } from './calendario/BlockDialog';

// ─── Main component ────────────────────────────────────────────────────────────

interface CalendarioTabProps {
  concorsoId: string;
}

export function CalendarioTab({ concorsoId }: CalendarioTabProps) {
  const { t } = useTranslation();
  const qc = useQueryClient();

  // ── Queries ────────────────────────────────────────────────────────────────
  const { data: sale = [], isLoading: loadSale } = useQuery({
    queryKey: SALE_KEY(concorsoId),
    queryFn: () => calendarioApi.getSale(concorsoId),
  });
  const { data: eventi = [], isLoading: loadEventi } = useQuery({
    queryKey: EVENTI_KEY(concorsoId),
    queryFn: () => calendarioApi.getEventi(concorsoId),
  });
  const { data: pubblicazioni = [], isLoading: loadPub } = useQuery({
    queryKey: PUB_KEY(concorsoId),
    queryFn: () => calendarioApi.getPubblicazioni(concorsoId),
  });
  const { data: sezioni = [] } = useQuery({
    queryKey: SEZIONI_KEY(concorsoId),
    queryFn: () => http.get<Sezione[]>('sezioni', { concorsoId }),
  });
  const { data: fasi = [] } = useQuery({
    queryKey: FASI_KEY(concorsoId),
    queryFn: () => http.get<Fase[]>('fasi', { concorsoId }),
  });
  const { data: categorie = [] } = useQuery({
    queryKey: CATEGORIE_KEY(concorsoId),
    queryFn: () => http.get<Categoria[]>('categorie', { concorsoId }),
  });
  const { data: candidati = [] } = useQuery({
    queryKey: CANDIDATI_KEY(concorsoId),
    queryFn: () =>
      http
        .get<Candidato[]>('candidati', { concorsoId, limit: 1000 })
        .then((rows) => rows.map(normalizeCandidato)),
  });

  // candidati_fase per ogni fase referenziata da un blocco ESIBIZIONE → da qui
  // derivano gli slot (cf con eventoId valorizzato). Una query per fase.
  const faseIds = useMemo(
    () => [...new Set(eventi.map((e) => e.faseId).filter((x): x is string => !!x))],
    [eventi],
  );
  const cfQueries = useQueries({
    queries: faseIds.map((fid) => ({
      queryKey: CF_KEY(fid),
      queryFn: () => http.get<CandidatoFase[]>('candidati-fase', { faseId: fid, limit: 1000 }),
    })),
  });
  const allCf = useMemo(
    () => cfQueries.flatMap((q) => q.data ?? []),
    [cfQueries],
  );

  // Lookup candidato → label "NNN · displayName" (come candLabel vanilla).
  const candById = useMemo(() => new Map(candidati.map((c) => [c.id, c])), [candidati]);
  const candLabel = useCallback(
    (candidatoId: string) => {
      const cand = candById.get(candidatoId);
      if (!cand) return '—';
      const num = String(cand.numeroCandidato ?? '').padStart(3, '0');
      return `${num} · ${displayName(cand)}`;
    },
    [candById],
  );

  // Slot per evento (cf con eventoId === ev.id, ordinati per oraPrevista/posizione).
  const slotsByEvento = useMemo(() => {
    const m = new Map<string, Slot[]>();
    for (const cf of allCf) {
      if (!cf.eventoId) continue;
      const arr = m.get(cf.eventoId) ?? [];
      arr.push({
        id: cf.id,
        oraPrevista: cf.oraPrevista,
        posizione: cf.posizione,
        label: candLabel(cf.candidatoId),
      });
      m.set(cf.eventoId, arr);
    }
    for (const arr of m.values()) {
      arr.sort(
        (a, b) =>
          (a.oraPrevista ?? '').localeCompare(b.oraPrevista ?? '') ||
          (a.posizione ?? 0) - (b.posizione ?? 0),
      );
    }
    return m;
  }, [allCf, candLabel]);

  // ── UI State ───────────────────────────────────────────────────────────────
  const [salaDialog, setSalaDialog] = useState<{ open: boolean; sala: Sala | null }>({ open: false, sala: null });
  const [blockDialog, setBlockDialog] = useState<{ open: boolean; evento: Evento | null; prefillData?: string }>({ open: false, evento: null });
  const [linkDialog, setLinkDialog] = useState(false);
  const [draggingBlockId, setDraggingBlockId] = useState<string | null>(null);
  const [draggingSlot, setDraggingSlot] = useState<{ cfId: string; eventoId: string } | null>(null);
  const [confirmState, setConfirmState] = useState<ConfirmState>({
    open: false, title: '', message: '', onConfirm: () => { /* placeholder */ },
  });
  const closeConfirm = () => setConfirmState((s) => ({ ...s, open: false }));

  // ── Mutations ──────────────────────────────────────────────────────────────
  const deleteSalaMut = useMutation({
    mutationFn: (id: string) => calendarioApi.deleteSala(id),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: SALE_KEY(concorsoId) });
      void qc.invalidateQueries({ queryKey: EVENTI_KEY(concorsoId) });
      toast.success('Sala eliminata');
    },
    onError: (e) => toast.error(httpErrorMessage(e)),
  });

  const deleteEventoMut = useMutation({
    mutationFn: (id: string) => calendarioApi.deleteEvento(id),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: EVENTI_KEY(concorsoId) });
      void qc.invalidateQueries({ queryKey: ['candidati-fase'] });
      toast.success('Blocco eliminato');
    },
    onError: (e) => toast.error(httpErrorMessage(e)),
  });

  const updateEventoMut = useMutation({
    mutationFn: ({ id, body }: { id: string; body: Record<string, unknown> }) =>
      calendarioApi.updateEvento(id, body),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: EVENTI_KEY(concorsoId) });
      void qc.invalidateQueries({ queryKey: ['candidati-fase'] });
    },
    onError: (e) => toast.error(httpErrorMessage(e)),
  });

  const generaSlotMut = useMutation({
    mutationFn: (eventoId: string) => calendarioApi.generaSlot(eventoId),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['candidati-fase'] });
      void qc.invalidateQueries({ queryKey: EVENTI_KEY(concorsoId) });
      toast.success(t('cal.block.genera_done'));
    },
    onError: (e) => toast.error(httpErrorMessage(e)),
  });

  const riordinaSlotMut = useMutation({
    mutationFn: ({ eventoId, ordine }: { eventoId: string; ordine: string[] }) =>
      calendarioApi.riordinaSlot(eventoId, ordine),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ['candidati-fase'] }); },
    onError: (e) => toast.error(httpErrorMessage(e)),
  });

  const togglePubMut = useMutation({
    mutationFn: ({ id, attivo }: { id: string; attivo: boolean }) =>
      calendarioApi.updatePubblicazione(id, { attivo }),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: PUB_KEY(concorsoId) }); },
    onError: (e) => toast.error(httpErrorMessage(e)),
  });

  const deletePubMut = useMutation({
    mutationFn: (id: string) => calendarioApi.deletePubblicazione(id),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: PUB_KEY(concorsoId) }); toast.success('Link revocato'); },
    onError: (e) => toast.error(httpErrorMessage(e)),
  });

  // ── PDF export (intero concorso) ─────────────────────────────────────────────
  const pdfMut = useMutation({
    mutationFn: async () => {
      const [concorso, commissari, commissioni] = await Promise.all([
        getConcorso(concorsoId),
        commissariApi.list(concorsoId),
        commissioniApi.list(concorsoId),
      ]);
      const days = [...new Set(eventi.map((e) => e.data).filter((d): d is string => !!d))].sort();
      const giorni = days.map((data) => ({
        data,
        blocchi: eventi
          .filter((e) => e.data === data)
          .map((ev) => {
            const sez = ev.sezioneId ? sezioni.find((s) => s.id === ev.sezioneId) : null;
            const cat = ev.categoriaId ? categorie.find((c) => c.id === ev.categoriaId) : null;
            const fase = ev.faseId ? fasi.find((f) => f.id === ev.faseId) : null;
            const comm = fase?.commissioneId
              ? commissioni.find((c) => c.id === fase.commissioneId)
              : null;
            const commissione = comm
              ? (comm.commissari ?? [])
                  .map((id) => {
                    const m = commissari.find((x) => x.id === id);
                    return m ? { nome: m.nome, cognome: m.cognome ?? '', specialita: m.specialita ?? '' } : null;
                  })
                  .filter((x): x is { nome: string; cognome: string; specialita: string } => !!x)
              : [];
            return {
              oraInizio: ev.oraInizio,
              oraFine: ev.oraFine,
              tipo: ev.tipo,
              titolo: ev.titolo,
              sala: ev.salaId ? { nome: sale.find((s) => s.id === ev.salaId)?.nome ?? '' } : null,
              sezione: sez ? { nome: sez.nome } : null,
              categoria: cat ? { nome: cat.nome } : null,
              fase: fase ? { nome: fase.nome } : null,
              commissione,
              slot: (slotsByEvento.get(ev.id) ?? []).map((s) => ({
                oraPrevista: s.oraPrevista,
                etichetta: s.label,
              })),
            };
          }),
      }));
      await exportCalendarioPdf({
        titolo: concorso.nome,
        sottotitolo: `${t('cal.pdf.title')} · ${concorso.anno ?? ''}`,
        logoUrl: concorso.logoUrl || '/logo.png',
        mostraCommissione: true,
        giorni,
      });
    },
    onError: (e) => toast.error(httpErrorMessage(e)),
  });

  // ── Board data ─────────────────────────────────────────────────────────────
  const days = [...new Set(eventi.map((e) => e.data).filter(Boolean))].sort();
  const lanes = [
    ...sale.map((s) => ({ id: s.id, nome: s.nome })),
    { id: SALA_NONE, nome: t('cal.sala.senza') },
  ];

  // Drop handler per il blocco (lane).
  const handleLaneDrop = useCallback(
    (e: React.DragEvent<HTMLDivElement>, day: string, salaId: string | null) => {
      e.preventDefault();
      if (!draggingBlockId) return;
      const id = draggingBlockId;
      setDraggingBlockId(null);
      const ev = eventi.find((x) => x.id === id);
      if (!ev) return;
      if (ev.data === day && (ev.salaId ?? '') === (salaId ?? '')) return;
      updateEventoMut.mutate({ id, body: { data: day, salaId } });
    },
    [draggingBlockId, eventi, updateEventoMut],
  );

  const isLoading = loadSale || loadEventi;

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="text-sm font-bold uppercase tracking-wider" style={{ color: 'hsl(var(--foreground))' }}>
            {t('cal.title')}
          </h3>
          <p className="text-sm" style={{ color: 'hsl(var(--muted-foreground))' }}>{t('cal.subtitle')}</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            className="c-btn c-btn--outline c-btn--sm"
            onClick={() => pdfMut.mutate()}
            disabled={pdfMut.isPending}
          >
            <Download className="h-[15px] w-[15px]" />
            <span>{t('cal.pdf.export')}</span>
          </button>
          <button
            type="button"
            className="c-btn c-btn--primary"
            onClick={() => setBlockDialog({ open: true, evento: null })}
          >
            <Plus className="h-4 w-4" />
            <span>{t('cal.block.add')}</span>
          </button>
        </div>
      </div>

      {/* Sale */}
      <div className="rounded-2xl p-4" style={{ background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))' }}>
        <div className="mb-3 flex items-center justify-between">
          <h4 className="text-sm font-bold" style={{ color: 'hsl(var(--foreground))' }}>{t('cal.sale.title')}</h4>
          <button
            type="button"
            className="c-btn c-btn--outline c-btn--sm"
            onClick={() => setSalaDialog({ open: true, sala: null })}
          >
            <Plus className="h-[14px] w-[14px]" />
            <span>{t('cal.sale.add')}</span>
          </button>
        </div>
        {loadSale ? (
          <div className="h-8 w-48 animate-pulse rounded" style={{ background: 'hsl(var(--muted))' }} />
        ) : sale.length === 0 ? (
          <p className="text-sm italic" style={{ color: 'hsl(var(--muted-foreground))' }}>{t('cal.sale.empty')}</p>
        ) : (
          <ul className="flex flex-wrap gap-2">
            {sale.map((s) => (
              <li
                key={s.id}
                className="inline-flex items-center gap-2 rounded-full py-1 pl-3 pr-1.5"
                style={{ background: 'hsl(var(--primary) / 0.06)' }}
              >
                <span className="text-sm" style={{ color: 'hsl(var(--foreground))' }}>{s.nome}</span>
                <button
                  type="button"
                  onClick={() => setSalaDialog({ open: true, sala: s })}
                  className="p-1"
                  style={{ color: 'hsl(var(--muted-foreground))' }}
                  onMouseOver={(e) => (e.currentTarget.style.color = 'hsl(var(--primary))')}
                  onMouseOut={(e) => (e.currentTarget.style.color = 'hsl(var(--muted-foreground))')}
                  aria-label="edit"
                >
                  <Pencil className="h-[13px] w-[13px]" />
                </button>
                <button
                  type="button"
                  onClick={() =>
                    setConfirmState({
                      open: true,
                      title: `${t('modal.delete')} — ${s.nome}`,
                      message: t('cal.block.delete_confirm'),
                      danger: true,
                      confirmLabel: t('modal.delete'),
                      onConfirm: () => deleteSalaMut.mutate(s.id),
                    })
                  }
                  className="p-1"
                  style={{ color: 'hsl(var(--muted-foreground))' }}
                  onMouseOver={(e) => (e.currentTarget.style.color = 'hsl(var(--destructive))')}
                  onMouseOut={(e) => (e.currentTarget.style.color = 'hsl(var(--muted-foreground))')}
                  aria-label="delete"
                >
                  <Trash2 className="h-[13px] w-[13px]" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Board */}
      {isLoading ? (
        <div className="space-y-3">
          <div className="h-6 w-40 animate-pulse rounded" style={{ background: 'hsl(var(--muted))' }} />
          <div className="grid grid-cols-2 gap-3">
            <div className="h-32 animate-pulse rounded-2xl" style={{ background: 'hsl(var(--muted))' }} />
            <div className="h-32 animate-pulse rounded-2xl" style={{ background: 'hsl(var(--muted))' }} />
          </div>
        </div>
      ) : eventi.length === 0 ? (
        <div
          className="rounded-2xl py-12 text-center"
          style={{ border: '2px dashed hsl(var(--border))' }}
        >
          <p className="text-sm italic" style={{ color: 'hsl(var(--muted-foreground))' }}>{t('cal.board.empty')}</p>
        </div>
      ) : (
        days.map((day) => (
          <section key={day} className="space-y-2">
            <h4 className="text-sm font-bold capitalize" style={{ color: 'hsl(var(--foreground))' }}>{fmtDay(day)}</h4>
            <div
              className="grid gap-3 overflow-x-auto"
              style={{
                gridTemplateColumns: `repeat(${lanes.length}, minmax(240px, 1fr))`,
              }}
            >
              {lanes.map((lane) => {
                const blocks = eventi.filter(
                  (e) => e.data === day && (e.salaId || SALA_NONE) === lane.id,
                );
                return (
                  <div
                    key={lane.id}
                    data-lane={lane.id}
                    data-day={day}
                    className="min-h-[80px] rounded-2xl p-2 ring-1 transition"
                    style={{
                      background: 'hsl(var(--muted) / 0.4)',
                      '--tw-ring-color': 'hsl(var(--border))',
                    } as React.CSSProperties}
                    onDragOver={(e) => {
                      if (draggingBlockId) {
                        e.preventDefault();
                        e.currentTarget.style.outline = '2px solid hsl(var(--primary))';
                        e.currentTarget.style.outlineOffset = '-2px';
                      }
                    }}
                    onDragLeave={(e) => {
                      e.currentTarget.style.outline = '';
                      e.currentTarget.style.outlineOffset = '';
                    }}
                    onDrop={(e) => {
                      e.currentTarget.style.outline = '';
                      e.currentTarget.style.outlineOffset = '';
                      handleLaneDrop(e, day, lane.id === SALA_NONE ? null : lane.id);
                    }}
                  >
                    <p
                      className="mb-2 px-1 text-[11px] font-semibold uppercase tracking-wide"
                      style={{ color: 'hsl(var(--muted-foreground))' }}
                    >
                      {lane.nome}
                    </p>
                    <div className="space-y-2">
                      {blocks.map((ev) => (
                        <BlockCard
                          key={ev.id}
                          evento={ev}
                          sezioni={sezioni}
                          categorie={categorie}
                          fasi={fasi}
                          slots={slotsByEvento.get(ev.id) ?? []}
                          onEdit={() => setBlockDialog({ open: true, evento: ev })}
                          onDelete={() =>
                            setConfirmState({
                              open: true,
                              title: t('cal.block.edit'),
                              message: t('cal.block.delete_confirm'),
                              danger: true,
                              confirmLabel: t('modal.delete'),
                              onConfirm: () => deleteEventoMut.mutate(ev.id),
                            })
                          }
                          onGeneraSlot={() => generaSlotMut.mutate(ev.id)}
                          onDragStart={setDraggingBlockId}
                          onDragEnd={() => setDraggingBlockId(null)}
                          draggingSlot={draggingSlot}
                          setDraggingSlot={setDraggingSlot}
                          onSlotReorder={(eventoId, ordine) =>
                            riordinaSlotMut.mutate({ eventoId, ordine })
                          }
                        />
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
        ))
      )}

      {/* Link pubblici */}
      <div className="rounded-2xl p-4" style={{ background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))' }}>
        <div className="mb-3 flex items-center justify-between">
          <h4 className="text-sm font-bold" style={{ color: 'hsl(var(--foreground))' }}>
            {t('cal.links.title')}
          </h4>
          <button type="button" className="c-btn c-btn--outline c-btn--sm" onClick={() => setLinkDialog(true)}>
            <Plus className="h-[14px] w-[14px]" />
            <span>{t('cal.links.add')}</span>
          </button>
        </div>

        {loadPub ? (
          <div className="h-12 w-full animate-pulse rounded" style={{ background: 'hsl(var(--muted))' }} />
        ) : pubblicazioni.length === 0 ? (
          <p className="text-sm italic" style={{ color: 'hsl(var(--muted-foreground))' }}>{t('cal.links.empty')}</p>
        ) : (
          <ul className="space-y-2">
            {pubblicazioni.map((pub) => (
              <PubRow
                key={pub.id}
                pub={pub}
                sezioni={sezioni}
                onToggle={() =>
                  togglePubMut.mutate({ id: pub.id, attivo: !pub.attivo })
                }
                onRevoke={() =>
                  setConfirmState({
                    open: true,
                    title: t('cal.links.revoke'),
                    message: t('cal.links.revoke_confirm'),
                    danger: true,
                    confirmLabel: t('cal.links.revoke'),
                    onConfirm: () => deletePubMut.mutate(pub.id),
                  })
                }
              />
            ))}
          </ul>
        )}
      </div>

      {/* Dialogs */}
      <SalaDialog
        open={salaDialog.open}
        sala={salaDialog.sala}
        concorsoId={concorsoId}
        onClose={() => setSalaDialog({ open: false, sala: null })}
      />
      <BlockDialog
        open={blockDialog.open}
        evento={blockDialog.evento}
        concorsoId={concorsoId}
        sale={sale}
        fasi={fasi}
        sezioni={sezioni}
        categorie={categorie}
        prefillData={blockDialog.prefillData}
        onClose={() => setBlockDialog({ open: false, evento: null })}
      />
      <LinkDialog
        open={linkDialog}
        concorsoId={concorsoId}
        sezioni={sezioni}
        onClose={() => setLinkDialog(false)}
      />
      <ConfirmDialog state={confirmState} onClose={closeConfirm} />
    </div>
  );
}

// Re-export for use as tab prop
export type { CalendarioTabProps };
export default CalendarioTab;
