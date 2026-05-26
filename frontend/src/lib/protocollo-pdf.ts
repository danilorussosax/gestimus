/**
 * protocollo-pdf.ts
 * Port of js/views/admin/risultati.js → exportProtocolloPdf()
 *
 * Generates a multi-page A4 PDF protocol with:
 *   - header: logo (optional) + concorso title + anonimo flag
 *   - per-fase ranking tables (pos / num / candidato / strumento / media / esito)
 *   - presidente signature footer
 *   - page numbers in footer
 *
 * Exports:
 *   exportProtocolloPdf(opts) → Promise<void>  (triggers browser download)
 */

// jspdf + jspdf-autotable caricati on-demand (dynamic import dentro
// exportProtocolloPdf) per tenerli fuori dal bundle iniziale.
import type { FaseRecord } from '@/api/fasi';
import i18n from '@/i18n';
import type { Candidato, CandidatoFase } from '@/types';
import type { CommissarioRecord } from '@/api/commissari';
import type { CommissioneRecord } from '@/api/commissioni';
import type { SezioneRecord } from '@/api/sezioni';
import { fmtVoto, getScala } from './scoring';
import type { RankedRow } from './tiebreak';
import { toast } from 'sonner';

// ─── Public types ─────────────────────────────────────────────────────────────

export interface ProtocolloPdfOpts {
  concorso: {
    id: string;
    nome: string;
    anno: number | null;
    anonimo: boolean;
    logoUrl?: string | null;
  };
  /** All fasi of the concorso in ordine ascending. */
  fasi: FaseRecord[];
  /** All candidati of the concorso. */
  candidati: Candidato[];
  /**
   * Per-fase ranked rows. Key = fase.id.
   * `RankedRow.cf` must be cast to CandidatoFase.
   */
  rankedByFase: Map<string, RankedRow[]>;
  /** Sezioni list (for scope labels). */
  sezioni: SezioneRecord[];
  /** Commissioni list (for president resolution). */
  commissioni: CommissioneRecord[];
  /** Commissari list (for president name). */
  commissari: CommissarioRecord[];
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function displayName(c: CommissarioRecord | null | undefined): string {
  if (!c) return '—';
  const parts = [c.cognome, c.nome].filter(Boolean);
  return parts.length ? parts.join(' ') : c.nome;
}

function candidatoDisplayName(
  cand: Candidato | null | undefined,
  anon: boolean,
): string {
  if (!cand) return '—';
  if (anon) return `#${String(cand.numeroCandidato ?? '').padStart(3, '0')}`;
  const parts = [cand.cognome, cand.nome].filter(Boolean);
  return parts.length ? parts.join(' ') : cand.nome || '—';
}

function faseScopeLabel(
  fase: FaseRecord,
  sezioni: SezioneRecord[],
): string {
  const ids = Array.isArray(fase.sezioniIds) ? fase.sezioniIds : [];
  if (ids.length === 0) return '';
  const nomi = ids
    .map((id) => sezioni.find((s) => s.id === id)?.nome)
    .filter((n): n is string => !!n);
  if (nomi.length === 0) return '';
  return ' · ' + nomi.join(' + ');
}

function computeGroupSizes(fasi: FaseRecord[]): Map<string, number> {
  const counts = new Map<string, number>();
  const signatures = new Map<string, string>();
  for (const f of fasi) {
    const ids = Array.isArray(f.sezioniIds) ? [...f.sezioniIds].sort() : [];
    const sig = ids.length === 0 ? '__shared__' : ids.join(',');
    signatures.set(f.id, sig);
    counts.set(sig, (counts.get(sig) ?? 0) + 1);
  }
  const result = new Map<string, number>();
  for (const f of fasi) result.set(f.id, counts.get(signatures.get(f.id) ?? '') ?? 1);
  return result;
}

/** Resolve the presidente of the fase's commissione (if any). */
function resolvePresidenteForFase(
  fase: FaseRecord,
  commissioni: CommissioneRecord[],
  commissari: CommissarioRecord[],
): CommissarioRecord | null {
  if (!fase.commissioneId) return null;
  const comm = commissioni.find((c) => c.id === fase.commissioneId);
  if (!comm?.presidenteCommissarioId) return null;
  return commissari.find((c) => c.id === comm.presidenteCommissarioId) ?? null;
}

/**
 * Resolve the presidente of the fase with the highest ordine in the concorso
 * (i.e. the "final" fase). Used for the signature footer.
 */
function resolvePresidenteForFinale(
  fasi: FaseRecord[],
  commissioni: CommissioneRecord[],
  commissari: CommissarioRecord[],
): CommissarioRecord | null {
  if (fasi.length === 0) return null;
  const finale = fasi.reduce((mx, f) => (f.ordine > mx.ordine ? f : mx), fasi[0]);
  return resolvePresidenteForFase(finale, commissioni, commissari);
}

function loadImageDataURL(src: string): Promise<string | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      try {
        const c = document.createElement('canvas');
        c.width = img.naturalWidth;
        c.height = img.naturalHeight;
        const cctx = c.getContext('2d');
        if (!cctx) { resolve(null); return; }
        cctx.drawImage(img, 0, 0);
        resolve(c.toDataURL('image/png'));
      } catch {
        resolve(null);
      }
    };
    img.onerror = () => resolve(null);
    img.src = src;
  });
}

// ─── Main export ──────────────────────────────────────────────────────────────

export async function exportProtocolloPdf(opts: ProtocolloPdfOpts): Promise<void> {
  const { concorso, fasi, candidati, rankedByFase, sezioni, commissioni, commissari } =
    opts;

  const [{ jsPDF }, { autoTable }] = await Promise.all([
    import('jspdf'),
    import('jspdf-autotable'),
  ]);
  const doc = new jsPDF({ unit: 'pt', format: 'a4' });
  const pageW = doc.internal.pageSize.getWidth();
  const margin = 40;

  const presidente = resolvePresidenteForFinale(fasi, commissioni, commissari);

  // ── Header ────────────────────────────────────────────────────────────────
  try {
    const logoSrc = concorso.logoUrl ?? '/logo.png';
    const logoData = await loadImageDataURL(logoSrc);
    if (logoData) doc.addImage(logoData, 'PNG', margin, margin - 10, 42, 42);
  } catch {
    /* logo non bloccante */
  }

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(18);
  doc.setTextColor(46, 38, 61); // ink-900
  doc.text(concorso.nome, margin + 52, margin + 10);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10);
  doc.setTextColor(93, 89, 108); // ink-700
  const dateStr = new Date().toLocaleString('it-IT');
  doc.text(
    `Anno ${concorso.anno ?? '—'} · Generato il ${dateStr}`,
    margin + 52,
    margin + 26,
  );

  if (concorso.anonimo) {
    doc.setFontSize(9);
    doc.setTextColor(115, 103, 240); // brand-500
    doc.text(i18n.t('admin.risultati.pdf_anonimo'), margin + 52, margin + 40);
  }

  doc.setDrawColor(231, 229, 235);
  doc.line(margin, margin + 50, pageW - margin, margin + 50);

  let cursorY = margin + 70;

  const groupSize = computeGroupSizes(fasi);

  // ── Per-fase ranking tables ───────────────────────────────────────────────
  for (const fase of fasi) {
    const rows = rankedByFase.get(fase.id) ?? [];
    if (rows.length === 0) continue;

    const scala = getScala(fase);
    const nomeFaseConScope = `${fase.nome}${faseScopeLabel(fase, sezioni)}`;
    const showEsito = (groupSize.get(fase.id) ?? 1) > 1;

    const PROMOSSO_LABEL = (fase.testoEsitoPromosso ?? i18n.t('admin.risultati.pdf_promosso')).toUpperCase();
    const ELIMINATO_LABEL = (fase.testoEsitoEliminato ?? i18n.t('admin.risultati.pdf_eliminato')).toUpperCase();

    // ─ Fase header ─
    if (cursorY > 720) {
      doc.addPage();
      cursorY = margin;
    }
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(13);
    doc.setTextColor(46, 38, 61);
    doc.text(
      i18n.t('admin.risultati.pdf_phase', { ordine: fase.ordine, nome: nomeFaseConScope }),
      margin,
      cursorY,
    );

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    doc.setTextColor(93, 89, 108);
    doc.text(
      i18n.t('admin.risultati.pdf_phase_meta', {
        stato: fase.stato.replace(/_/g, ' '),
        scala,
        n: rows.length,
      }),
      margin,
      cursorY + 14,
    );
    cursorY += 22;

    // ─ Table head ─
    const COL = {
      pos: i18n.t('admin.risultati.pdf_col_pos'),
      num: i18n.t('admin.risultati.pdf_col_num'),
      cand: i18n.t('admin.risultati.pdf_col_cand'),
      strumento: i18n.t('admin.risultati.pdf_col_strumento'),
      media: i18n.t('admin.risultati.pdf_col_media'),
      esito: i18n.t('admin.risultati.pdf_col_esito'),
    };
    const head: string[][] = [
      showEsito
        ? [COL.pos, COL.num, COL.cand, COL.strumento, COL.media, COL.esito]
        : [COL.pos, COL.num, COL.cand, COL.strumento, COL.media],
    ];

    const body: string[][] = rows.map((r, i) => {
      const cf = r.cf as CandidatoFase;
      const cand = candidati.find((c) => c.id === cf.candidatoId) ?? (r.cand as Candidato | undefined);
      const pos = String(r.posizione_finale ?? (i + 1));
      const num = String(cand?.numeroCandidato ?? '').padStart(3, '0');
      const nome = candidatoDisplayName(cand, concorso.anonimo);
      const strumento = cand?.strumento ?? '';
      const media = fmtVoto(r.media, scala);

      const baseRow = [pos, num, nome, strumento, media];
      if (showEsito) {
        const esito =
          cf.stato !== 'COMPLETATO'
            ? '—'
            : cf.ammessoProssimaFase
            ? PROMOSSO_LABEL
            : ELIMINATO_LABEL;
        baseRow.push(esito);
      }
      return baseRow;
    });

    autoTable(doc, {
      startY: cursorY,
      margin: { left: margin, right: margin },
      head,
      body,
      styles: {
        fontSize: 9,
        cellPadding: 5,
        lineColor: [231, 229, 235] as [number, number, number],
        textColor: [46, 38, 61] as [number, number, number],
      },
      headStyles: {
        fillColor: [115, 103, 240] as [number, number, number],
        textColor: [255, 255, 255] as [number, number, number],
        fontStyle: 'bold',
      },
      alternateRowStyles: {
        fillColor: [248, 247, 250] as [number, number, number],
      },
      didParseCell: (d) => {
        // Highlight PROMOSSO cells green.
        if (
          showEsito &&
          d.section === 'body' &&
          d.column.index === 5 &&
          d.cell.raw === PROMOSSO_LABEL
        ) {
          d.cell.styles.textColor = [5, 150, 105] as [number, number, number];
          d.cell.styles.fontStyle = 'bold';
        }
      },
    });

    // jspdf-autotable v5: access finalY via getLastAutoTable().
    const lastTable = (doc as unknown as { lastAutoTable?: { finalY?: number } }).lastAutoTable;
    cursorY = (lastTable?.finalY ?? cursorY) + 24;
  }

  // ── Firma presidente (ultima pagina) ──────────────────────────────────────
  const totalPages = doc.getNumberOfPages();
  doc.setPage(totalPages);
  const pageH = doc.internal.pageSize.getHeight();
  if (cursorY > pageH - 100) {
    doc.addPage();
    cursorY = margin;
  }
  const sigY = Math.max(cursorY + 30, pageH - 110);
  doc.setDrawColor(165, 163, 174);
  doc.line(pageW - margin - 220, sigY, pageW - margin, sigY);
  doc.setFontSize(9);
  doc.setTextColor(93, 89, 108);
  doc.text(i18n.t('admin.risultati.pdf_signature'), pageW - margin - 220, sigY + 12);
  if (presidente) {
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(46, 38, 61);
    doc.text(displayName(presidente), pageW - margin - 220, sigY + 26);
  }

  // ── Numerazione pagine ────────────────────────────────────────────────────
  const finalTotalPages = doc.getNumberOfPages();
  for (let p = 1; p <= finalTotalPages; p++) {
    doc.setPage(p);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.setTextColor(165, 163, 174);
    doc.text(
      i18n.t('admin.risultati.pdf_page', { p, total: finalTotalPages }),
      pageW - margin,
      pageH - 20,
      { align: 'right' },
    );
    doc.text(concorso.nome, margin, pageH - 20);
  }

  const safeName = concorso.nome.replace(/[^\w-]+/g, '_');
  doc.save(`Protocollo_${safeName}_${concorso.anno ?? 'nd'}.pdf`);
  toast.success('Protocollo PDF generato con successo.');
}
