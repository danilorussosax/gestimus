/**
 * calendario-pdf.ts
 * Port di js/calendario-pdf.js → exportCalendarioPdf()
 *
 * Costruisce un PDF A4 del calendario a partire dalla forma
 * `giorni → blocchi → slot`. Modellato su protocollo-pdf.ts:
 * jspdf + jspdf-autotable come moduli npm.
 *
 * Export:
 *   exportCalendarioPdf(opts) → Promise<void>  (avvia il download)
 */

// jspdf + jspdf-autotable sono caricati on-demand (dynamic import dentro
// exportCalendarioPdf): pesano ~377KB gz con html2canvas/canvg e non devono
// entrare nel bundle iniziale.
import { toast } from 'sonner';
import i18n from '@/i18n';

const t = (key: string, fallback?: string) => {
  const v = i18n.t(key);
  return v === key && fallback != null ? fallback : v;
};

const INK: [number, number, number] = [46, 38, 61];
const INK_SOFT: [number, number, number] = [93, 89, 108];
const LINE: [number, number, number] = [231, 229, 235];

// ─── Tipi ───────────────────────────────────────────────────────────────────

export interface PdfSlot {
  oraPrevista: string | null;
  etichetta: string;
}
export interface PdfCommissario {
  nome: string;
  cognome: string;
  specialita: string;
}
export interface PdfBlocco {
  oraInizio: string | null;
  oraFine: string | null;
  tipo: string;
  titolo: string | null;
  sala: { nome: string } | null;
  sezione: { nome: string } | null;
  categoria: { nome: string } | null;
  fase: { nome: string } | null;
  commissione: PdfCommissario[];
  slot: PdfSlot[];
}
export interface PdfGiorno {
  data: string;
  blocchi: PdfBlocco[];
}
export interface CalendarioPdfOpts {
  titolo: string;
  sottotitolo?: string;
  logoUrl?: string | null;
  mostraCommissione?: boolean;
  giorni: PdfGiorno[];
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function loadImageDataURL(src: string): Promise<string | null> {
  return new Promise((resolve) => {
    try {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => {
        try {
          const canvas = document.createElement('canvas');
          canvas.width = img.naturalWidth;
          canvas.height = img.naturalHeight;
          canvas.getContext('2d')!.drawImage(img, 0, 0);
          resolve(canvas.toDataURL('image/png'));
        } catch {
          resolve(null);
        }
      };
      img.onerror = () => resolve(null);
      img.src = src;
    } catch {
      resolve(null);
    }
  });
}

function fmtDay(iso: string): string {
  if (!iso) return '';
  try {
    return new Date(iso + 'T00:00:00').toLocaleDateString(undefined, {
      weekday: 'long',
      day: 'numeric',
      month: 'long',
      year: 'numeric',
    });
  } catch {
    return iso;
  }
}

const hhmm = (s: string | null | undefined) => (s ? String(s).slice(0, 5) : '');

// ─── Export principale ──────────────────────────────────────────────────────

export async function exportCalendarioPdf(opts: CalendarioPdfOpts): Promise<void> {
  const [{ jsPDF }, { autoTable }] = await Promise.all([
    import('jspdf'),
    import('jspdf-autotable'),
  ]);
  const doc = new jsPDF({ unit: 'pt', format: 'a4' });

  const margin = 40;
  const pageW = doc.internal.pageSize.getWidth();

  if (opts.logoUrl) {
    try {
      const d = await loadImageDataURL(opts.logoUrl);
      if (d) doc.addImage(d, 'PNG', margin, margin - 10, 42, 42);
    } catch {
      /* logo non bloccante */
    }
  }
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(18);
  doc.setTextColor(...INK);
  doc.text(String(opts.titolo || t('cal.pdf.title')), margin + (opts.logoUrl ? 52 : 0), margin + 10);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10);
  doc.setTextColor(...INK_SOFT);
  const sub = opts.sottotitolo || `${t('cal.pdf.title')} · ${new Date().toLocaleDateString()}`;
  doc.text(sub, margin + (opts.logoUrl ? 52 : 0), margin + 26);
  doc.setDrawColor(...LINE);
  doc.line(margin, margin + 50, pageW - margin, margin + 50);

  let y = margin + 70;
  const giorni = opts.giorni || [];
  if (giorni.length === 0) {
    doc.setTextColor(...INK_SOFT);
    doc.text(t('cal.pub.empty'), margin, y);
  }

  for (const g of giorni) {
    if (y > 720) {
      doc.addPage();
      y = margin;
    }
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(13);
    doc.setTextColor(...INK);
    doc.text(fmtDay(g.data), margin, y);
    y += 8;

    for (const b of g.blocchi || []) {
      const head =
        [b.sezione?.nome, b.categoria?.nome, b.fase?.nome].filter(Boolean).join(' · ') ||
        b.titolo ||
        (b.tipo === 'EVENTO' ? t('cal.block.tipo.evento') : t('cal.block.tipo.esibizione'));
      const orario = [hhmm(b.oraInizio), hhmm(b.oraFine)].filter(Boolean).join('–');
      const sala = b.sala?.nome ? ` · ${b.sala.nome}` : '';
      const title = `${orario ? orario + '  ' : ''}${head}${sala}`;

      const body = (b.slot || []).map((s) => [hhmm(s.oraPrevista) || '—', s.etichetta || '']);
      autoTable(doc, {
        startY: y + 6,
        head: [
          [
            {
              content: title,
              colSpan: 2,
              styles: { halign: 'left', fillColor: [243, 242, 249], textColor: INK, fontStyle: 'bold' },
            },
          ],
        ],
        body: body.length
          ? body
          : [
              [
                {
                  content: b.tipo === 'EVENTO' ? b.titolo || t('cal.block.tipo.evento') : '—',
                  colSpan: 2,
                  styles: { textColor: INK_SOFT },
                },
              ],
            ],
        theme: 'grid',
        styles: { fontSize: 9, cellPadding: 4, lineColor: LINE, textColor: INK },
        columnStyles: { 0: { cellWidth: 70 } },
        margin: { left: margin, right: margin },
      });
      const lastTable = (doc as unknown as { lastAutoTable?: { finalY?: number } }).lastAutoTable;
      y = (lastTable?.finalY ?? y) + 6;

      if (opts.mostraCommissione && Array.isArray(b.commissione) && b.commissione.length) {
        const names = b.commissione
          .map(
            (m) =>
              [m.nome, m.cognome].filter(Boolean).join(' ') +
              (m.specialita ? ` (${m.specialita})` : ''),
          )
          .join(', ');
        doc.setFont('helvetica', 'italic');
        doc.setFontSize(8);
        doc.setTextColor(...INK_SOFT);
        const wrapped = doc.splitTextToSize(`${t('cal.pub.giuria')}: ${names}`, pageW - 2 * margin);
        if (y + wrapped.length * 10 > 800) {
          doc.addPage();
          y = margin;
        }
        doc.text(wrapped, margin, y + 8);
        y += wrapped.length * 10 + 6;
      }
      if (y > 760) {
        doc.addPage();
        y = margin;
      }
    }
    y += 10;
  }

  doc.save(`${(opts.titolo || 'calendario').replace(/[^\w-]+/g, '_')}.pdf`);
  toast.success('Calendario PDF generato.');
}
