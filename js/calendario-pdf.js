// Export PDF del calendario. Modulo condiviso tra la vista admin e la pagina
// pubblica: entrambe costruiscono la stessa forma `giorni → blocchi → slot` e
// chiamano exportCalendarioPdf. Modellato su exportProtocolloPdf
// (js/views/admin/risultati.js): jsPDF + autoTable caricati via CDN in index.html.

import { toast } from './utils.js';
import { t } from './i18n.js';

const INK = [46, 38, 61];
const INK_SOFT = [93, 89, 108];
const LINE = [231, 229, 235];

function loadImageDataURL(src) {
  return new Promise((resolve) => {
    try {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => {
        try {
          const canvas = document.createElement('canvas');
          canvas.width = img.naturalWidth; canvas.height = img.naturalHeight;
          canvas.getContext('2d').drawImage(img, 0, 0);
          resolve(canvas.toDataURL('image/png'));
        } catch { resolve(null); }
      };
      img.onerror = () => resolve(null);
      img.src = src;
    } catch { resolve(null); }
  });
}

function fmtDay(iso) {
  if (!iso) return '';
  try { return new Date(iso + 'T00:00:00').toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }); }
  catch { return iso; }
}
const hhmm = (s) => (s ? String(s).slice(0, 5) : '');

/**
 * @param {object} opts
 * @param {string} opts.titolo               titolo concorso/evento
 * @param {string} [opts.sottotitolo]        riga sotto il titolo
 * @param {string} [opts.logoUrl]            logo (concorso o ente)
 * @param {boolean} [opts.mostraCommissione] include la giuria sotto ogni blocco
 * @param {Array}  opts.giorni               [{ data, blocchi:[{ oraInizio, oraFine, sala:{nome}, sezione:{nome}, categoria:{nome}, fase:{nome}, tipo, titolo, slot:[{oraPrevista, etichetta}], commissione:[{nome,cognome,specialita}] }] }]
 */
export async function exportCalendarioPdf(opts) {
  if (!window.jspdf || !window.jspdf.jsPDF) { toast(t('admin.risultati.pdf_not_loaded') || 'PDF non caricato, ricarica la pagina', 'warn'); return; }
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ unit: 'pt', format: 'a4' });
  if (typeof doc.autoTable !== 'function') { toast(t('admin.risultati.pdf_not_loaded') || 'Plugin PDF non caricato, ricarica la pagina', 'warn'); return; }

  const margin = 40;
  const pageW = doc.internal.pageSize.getWidth();

  if (opts.logoUrl) {
    try { const d = await loadImageDataURL(opts.logoUrl); if (d) doc.addImage(d, 'PNG', margin, margin - 10, 42, 42); } catch { /* logo non bloccante */ }
  }
  doc.setFont('helvetica', 'bold'); doc.setFontSize(18); doc.setTextColor(...INK);
  doc.text(String(opts.titolo || t('cal.pdf.title')), margin + (opts.logoUrl ? 52 : 0), margin + 10);
  doc.setFont('helvetica', 'normal'); doc.setFontSize(10); doc.setTextColor(...INK_SOFT);
  const sub = opts.sottotitolo || `${t('cal.pdf.title')} · ${new Date().toLocaleDateString()}`;
  doc.text(sub, margin + (opts.logoUrl ? 52 : 0), margin + 26);
  doc.setDrawColor(...LINE); doc.line(margin, margin + 50, pageW - margin, margin + 50);

  let y = margin + 70;
  const giorni = opts.giorni || [];
  if (giorni.length === 0) {
    doc.setTextColor(...INK_SOFT); doc.text(t('cal.pub.empty'), margin, y);
  }

  for (const g of giorni) {
    if (y > 720) { doc.addPage(); y = margin; }
    doc.setFont('helvetica', 'bold'); doc.setFontSize(13); doc.setTextColor(...INK);
    doc.text(fmtDay(g.data), margin, y); y += 8;

    for (const b of (g.blocchi || [])) {
      const head = [b.sezione?.nome, b.categoria?.nome, b.fase?.nome].filter(Boolean).join(' · ')
        || b.titolo || (b.tipo === 'EVENTO' ? t('cal.block.tipo.evento') : t('cal.block.tipo.esibizione'));
      const orario = [hhmm(b.oraInizio), hhmm(b.oraFine)].filter(Boolean).join('–');
      const sala = b.sala?.nome ? ` · ${b.sala.nome}` : '';
      const title = `${orario ? orario + '  ' : ''}${head}${sala}`;

      const body = (b.slot || []).map((s) => [hhmm(s.oraPrevista) || '—', s.etichetta || '']);
      doc.autoTable({
        startY: y + 6,
        head: [[{ content: title, colSpan: 2, styles: { halign: 'left', fillColor: [243, 242, 249], textColor: INK, fontStyle: 'bold' } }]],
        body: body.length ? body : [[{ content: b.tipo === 'EVENTO' ? (b.titolo || t('cal.block.tipo.evento')) : '—', colSpan: 2, styles: { textColor: INK_SOFT } }]],
        theme: 'grid',
        styles: { fontSize: 9, cellPadding: 4, lineColor: LINE, textColor: INK },
        columnStyles: { 0: { cellWidth: 70 } },
        margin: { left: margin, right: margin },
      });
      y = doc.lastAutoTable.finalY + 6;
      if (opts.mostraCommissione && Array.isArray(b.commissione) && b.commissione.length) {
        const names = b.commissione.map((m) => [m.nome, m.cognome].filter(Boolean).join(' ') + (m.specialita ? ` (${m.specialita})` : '')).join(', ');
        doc.setFont('helvetica', 'italic'); doc.setFontSize(8); doc.setTextColor(...INK_SOFT);
        const wrapped = doc.splitTextToSize(`${t('cal.pub.giuria')}: ${names}`, pageW - 2 * margin);
        if (y + wrapped.length * 10 > 800) { doc.addPage(); y = margin; }
        doc.text(wrapped, margin, y + 8); y += wrapped.length * 10 + 6;
      }
      if (y > 760) { doc.addPage(); y = margin; }
    }
    y += 10;
  }

  doc.save(`${(opts.titolo || 'calendario').replace(/[^\w-]+/g, '_')}.pdf`);
}
