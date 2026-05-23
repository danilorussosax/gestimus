// Tab "Iscrizioni" del pannello Admin: lista + dettaglio + CSV export.
// Estratto da js/views/admin.js (refactoring).

import { db } from '../../db.js';
import { escapeHtml, modal, toast } from '../../utils.js';
import { icon } from '../../icons.js';
import { t } from '../../i18n.js';

// Stato locale del tab Iscrizioni — sopravvive ai re-render della tab.
const _iscrizioniState = { items: [], filtro_stato: '', loading: false, error: null };

export async function renderIscrizioni(root, concorso) {
  // Render con dati cached, poi reload in background.
  doRender();
  await loadIscrizioni(concorso.id);
  doRender();

  function doRender() {
    const items = _iscrizioniState.items;
    const flt = _iscrizioniState.filtro_stato;
    const filtered = flt ? items.filter(i => i.stato === flt) : items;
    const counts = {
      total: items.length,
      pending: items.filter(i => i.stato === 'pending').length,
      verified: items.filter(i => i.stato === 'email_verified').length,
      approved: items.filter(i => i.stato === 'approved').length,
      rejected: items.filter(i => i.stato === 'rejected').length,
    };

    root.innerHTML = `
      <div class="flex flex-wrap items-center justify-between gap-2 mb-4">
        <p class="text-sm text-slate-600">${filtered.length} iscrizioni${flt ? ` (filtrate per "${escapeHtml(flt)}")` : ''}</p>
        <div class="flex items-center gap-1.5">
          <a href="#/iscrizione" target="_blank" class="c-btn c-btn--outline c-btn--sm !gap-1 text-emerald-700 border-emerald-300 hover:bg-emerald-50" title="Apri il form pubblico di iscrizione in una nuova scheda">${icon('externalLink', { size: 14 })} <span>Form pubblico</span></a>
          <button data-isc-refresh class="c-btn c-btn--ghost c-btn--sm !gap-1">${icon('refresh', { size: 14 })} <span>Aggiorna</span></button>
          <button data-isc-export class="c-btn c-btn--ghost c-btn--sm !gap-1">${icon('download', { size: 14 })} <span>Esporta CSV</span></button>
        </div>
      </div>

      <!-- Filtri stato come pills -->
      <div class="flex flex-wrap gap-1.5 mb-4" data-isc-filters>
        ${iscFilterPill('', 'Tutte', counts.total, flt === '')}
        ${iscFilterPill('pending', 'In attesa', counts.pending, flt === 'pending', 'bg-amber-50 text-amber-800 border-amber-200')}
        ${iscFilterPill('email_verified', 'Email verificata', counts.verified, flt === 'email_verified', 'bg-sky-50 text-sky-800 border-sky-200')}
        ${iscFilterPill('approved', 'Approvate', counts.approved, flt === 'approved', 'bg-emerald-50 text-emerald-800 border-emerald-200')}
        ${iscFilterPill('rejected', 'Rifiutate', counts.rejected, flt === 'rejected', 'bg-rose-50 text-rose-800 border-rose-200')}
      </div>

      ${_iscrizioniState.loading && items.length === 0 ? `
        <div class="text-center py-10 text-slate-500">Caricamento…</div>
      ` : _iscrizioniState.error ? `
        <div class="bg-rose-50 border border-rose-200 rounded-2xl p-4 text-sm text-rose-800">${escapeHtml(_iscrizioniState.error)}</div>
      ` : filtered.length === 0 ? `
        <div class="bg-white border-2 border-dashed border-slate-200 rounded-2xl py-12 text-center">
          <div class="text-4xl mb-2">📭</div>
          <p class="text-sm text-slate-500 italic">Nessuna iscrizione${flt ? ' con questo stato' : ''}.</p>
          <p class="text-sm text-slate-500 italic mt-1">Le iscrizioni inviate dal form pubblico compariranno qui.</p>
          <a href="#/iscrizione" target="_blank" class="c-btn c-btn--primary c-btn--sm mt-5 inline-flex items-center gap-1.5">
            ${icon('externalLink', { size: 14 })}
            <span>Apri form di iscrizione pubblico</span>
          </a>
        </div>
      ` : `
        <div class="bg-white border border-slate-200 rounded-2xl overflow-hidden">
          <table class="w-full text-sm">
            <thead class="bg-slate-50 text-xs uppercase tracking-wider text-slate-600">
              <tr>
                <th class="text-left px-3 py-2.5">Data</th>
                <th class="text-left px-3 py-2.5">Candidato</th>
                <th class="text-left px-3 py-2.5 hidden sm:table-cell">Email</th>
                <th class="text-left px-3 py-2.5 hidden md:table-cell">Strumento</th>
                <th class="text-left px-3 py-2.5">Stato</th>
                <th class="text-right px-3 py-2.5">Azioni</th>
              </tr>
            </thead>
            <tbody class="divide-y divide-slate-100">
              ${filtered.map(i => iscrizioneRowHtml(i)).join('')}
            </tbody>
          </table>
        </div>
      `}
    `;

    root.querySelector('[data-isc-refresh]')?.addEventListener('click', async () => {
      await loadIscrizioni(concorso.id, true);
      doRender();
    });
    root.querySelector('[data-isc-export]')?.addEventListener('click', () => exportIscrizioniCsv(filtered, concorso));
    root.querySelectorAll('[data-isc-filter]').forEach(b => b.addEventListener('click', () => {
      _iscrizioniState.filtro_stato = b.dataset.iscFilter;
      doRender();
    }));
    root.querySelectorAll('[data-isc-detail]').forEach(b => b.addEventListener('click', () => {
      const i = items.find(x => x.id === b.dataset.iscDetail);
      if (i) openIscrizioneDetail(i, concorso, async () => {
        await loadIscrizioni(concorso.id, true);
        doRender();
      });
    }));
  }

  async function loadIscrizioni(concorsoId, force = false) {
    if (_iscrizioniState.loading && !force) return;
    _iscrizioniState.loading = true;
    _iscrizioniState.error = null;
    try {
      _iscrizioniState.items = await db.listIscrizioni({ concorsoId });
    } catch (e) {
      _iscrizioniState.error = `Errore caricamento iscrizioni: ${e?.message || e}`;
    } finally {
      _iscrizioniState.loading = false;
    }
  }
}

function iscFilterPill(value, label, count, active, colors = 'bg-slate-100 text-slate-700 border-slate-200') {
  const cls = active
    ? 'bg-brand-600 text-white border-brand-600'
    : colors;
  return `<button data-isc-filter="${escapeHtml(value)}" class="text-xs font-medium border ${cls} px-3 py-1.5 rounded-full inline-flex items-center gap-1.5 hover:brightness-95 transition">
    <span>${escapeHtml(label)}</span>
    <span class="text-[10px] font-bold ${active ? 'bg-white/20 text-white' : 'bg-white text-slate-600'} px-1.5 py-0.5 rounded-full">${count}</span>
  </button>`;
}

function iscrizioneRowHtml(i) {
  const statoColors = {
    pending:        'bg-amber-100 text-amber-800',
    email_verified: 'bg-sky-100 text-sky-800',
    approved:       'bg-emerald-100 text-emerald-800',
    rejected:       'bg-rose-100 text-rose-800',
  };
  const statoLabel = {
    pending: 'In attesa',
    email_verified: 'Verificata',
    approved: 'Approvata',
    rejected: 'Rifiutata',
  };
  const created = new Date(i.created).toLocaleDateString('it-IT', { day: '2-digit', month: 'short', year: '2-digit' });
  const ora = new Date(i.created).toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' });
  return `
    <tr class="hover:bg-slate-50 transition-colors cursor-pointer" data-isc-detail="${escapeHtml(i.id)}">
      <td class="px-3 py-2.5 text-xs text-slate-600 whitespace-nowrap">${escapeHtml(created)}<br/><span class="text-slate-400">${escapeHtml(ora)}</span></td>
      <td class="px-3 py-2.5">
        <p class="font-medium text-slate-900">${escapeHtml(i.nome)} ${escapeHtml(i.cognome)}</p>
        ${i.tipo === 'gruppo' ? `<p class="text-[11px] text-purple-700">${escapeHtml(i.gruppo_nome || 'Gruppo')}</p>` : ''}
        ${i.tipo === 'orchestra' ? `<p class="text-[11px] text-indigo-700">${escapeHtml(i.gruppo_nome || 'Orchestra')}</p>` : ''}
      </td>
      <td class="px-3 py-2.5 text-xs text-slate-600 hidden sm:table-cell">${escapeHtml(i.email || '')}</td>
      <td class="px-3 py-2.5 text-xs text-slate-700 hidden md:table-cell">${escapeHtml(i.strumento || '—')}</td>
      <td class="px-3 py-2.5"><span class="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider ${statoColors[i.stato] || 'bg-slate-100 text-slate-700'}">${escapeHtml(statoLabel[i.stato] || i.stato)}</span></td>
      <td class="px-3 py-2.5 text-right">
        <button class="c-btn c-btn--ghost c-btn--sm !px-2" title="Vedi dettagli">${icon('arrowRight', { size: 14 })}</button>
      </td>
    </tr>
  `;
}

function openIscrizioneDetail(isc, concorso, onChanged) {
  const eta = isc.data_nascita ? Math.floor((Date.now() - new Date(isc.data_nascita).getTime()) / (365.25 * 24 * 3600 * 1000)) : null;
  const isMinor = eta !== null && eta < 18;
  // File URL: nel nuovo stack PG+Fastify gli allegati vivono nella tabella
  // iscrizioni_allegati e il path è già completo (es. /uploads/<tenant>/...).
  // Per ora ritorniamo il valore se è già un URL/path, altrimenti null
  // (TODO: caricare iscrizioniAllegati per id iscrizione).
  const fileUrl = (field) => {
    const v = isc[field];
    if (typeof v === 'string' && (v.startsWith('/') || v.startsWith('http'))) return v;
    return null;
  };
  const fotoUrl = fileUrl('foto');
  const docUrl  = fileUrl('documento_identita');
  const recUrl  = fileUrl('ricevuta_pagamento');
  const minUrl  = fileUrl('autorizzazione_minore');

  const programma = Array.isArray(isc.programma) ? isc.programma : (() => { try { return JSON.parse(isc.programma || '[]'); } catch { return []; } })();
  const docenti = Array.isArray(isc.docenti_preparatori) ? isc.docenti_preparatori : (() => { try { return JSON.parse(isc.docenti_preparatori || '[]'); } catch { return []; } })();
  const gruppoMembri = Array.isArray(isc.gruppo_membri) ? isc.gruppo_membri : (() => { try { return JSON.parse(isc.gruppo_membri || '[]'); } catch { return []; } })();

  modal({
    title: `${isc.nome} ${isc.cognome} · ${isc.strumento || '—'}`,
    wide: true,
    contentHtml: `
      <div class="space-y-5 text-sm">
        <!-- Header con stato e azioni -->
        <div class="flex items-center justify-between gap-3 flex-wrap pb-3 border-b border-slate-100">
          <div class="flex items-center gap-2">
            <span class="text-xs font-bold uppercase tracking-wider px-2 py-1 rounded ${isc.stato === 'approved' ? 'bg-emerald-100 text-emerald-800' : isc.stato === 'rejected' ? 'bg-rose-100 text-rose-800' : isc.stato === 'email_verified' ? 'bg-sky-100 text-sky-800' : 'bg-amber-100 text-amber-800'}">${escapeHtml(isc.stato)}</span>
            <span class="text-xs text-slate-500">creata il ${new Date(isc.created).toLocaleString('it-IT')}</span>
          </div>
          ${fotoUrl ? `<img src="${escapeHtml(fotoUrl)}" alt="" class="w-16 h-16 rounded-full object-cover ring-2 ring-slate-200" />` : ''}
        </div>

        <!-- Anagrafica -->
        <section>
          <h3 class="font-mono text-[10px] uppercase tracking-wider text-slate-500 mb-2">Anagrafica</h3>
          <div class="grid grid-cols-2 sm:grid-cols-3 gap-x-4 gap-y-2 text-xs">
            <div><span class="text-slate-500">Nato il:</span> <strong>${escapeHtml(isc.data_nascita || '—')}</strong>${eta !== null ? ` <span class="text-slate-400">(${eta} anni)</span>` : ''}</div>
            <div><span class="text-slate-500">Luogo nascita:</span> <strong>${escapeHtml(isc.luogo_nascita || '—')}</strong></div>
            <div><span class="text-slate-500">Nazionalità:</span> <strong>${escapeHtml(isc.nazionalita || '—')}</strong></div>
            <div><span class="text-slate-500">Sesso:</span> <strong>${escapeHtml(isc.sesso || '—')}</strong></div>
            <div class="col-span-2"><span class="text-slate-500">Codice fiscale:</span> <strong class="font-mono">${escapeHtml(isc.codice_fiscale || '—')}</strong></div>
          </div>
        </section>

        <!-- Contatti -->
        <section>
          <h3 class="font-mono text-[10px] uppercase tracking-wider text-slate-500 mb-2">Contatti</h3>
          <div class="grid grid-cols-2 sm:grid-cols-3 gap-x-4 gap-y-2 text-xs">
            <div class="col-span-2"><span class="text-slate-500">Email:</span> <strong><a href="mailto:${escapeHtml(isc.email)}" class="text-brand-700 hover:underline">${escapeHtml(isc.email)}</a></strong></div>
            <div><span class="text-slate-500">Telefono:</span> <strong><a href="tel:${escapeHtml(isc.telefono || '')}" class="hover:underline">${escapeHtml(isc.telefono || '—')}</a></strong></div>
            <div class="col-span-3"><span class="text-slate-500">Indirizzo:</span> <strong>${escapeHtml(isc.indirizzo || '—')}, ${escapeHtml(isc.citta || '—')} ${escapeHtml(isc.cap || '')} (${escapeHtml(isc.provincia || '—')}) · ${escapeHtml(isc.paese || '—')}</strong></div>
          </div>
        </section>

        ${isMinor || isc.tutore_nome ? `
        <!-- Tutore -->
        <section class="bg-amber-50 border border-amber-200 rounded-xl p-3">
          <h3 class="font-mono text-[10px] uppercase tracking-wider text-amber-800 mb-2">⚠ Candidato minorenne · dati tutore</h3>
          <div class="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
            <div><span class="text-slate-600">Nome:</span> <strong>${escapeHtml(isc.tutore_nome || '—')} ${escapeHtml(isc.tutore_cognome || '')}</strong></div>
            <div><span class="text-slate-600">Email:</span> <strong>${escapeHtml(isc.tutore_email || '—')}</strong></div>
            <div><span class="text-slate-600">Telefono:</span> <strong>${escapeHtml(isc.tutore_telefono || '—')}</strong></div>
          </div>
        </section>
        ` : ''}

        <!-- Dati artistici -->
        <section>
          <h3 class="font-mono text-[10px] uppercase tracking-wider text-slate-500 mb-2">Dati artistici</h3>
          <div class="grid grid-cols-2 sm:grid-cols-3 gap-x-4 gap-y-2 text-xs">
            <div><span class="text-slate-500">Tipo:</span> <strong>${escapeHtml(isc.tipo || 'individuale')}</strong></div>
            <div><span class="text-slate-500">Strumento:</span> <strong>${escapeHtml(isc.strumento || '—')}</strong></div>
            <div><span class="text-slate-500">Anni studio:</span> <strong>${escapeHtml(String(isc.anni_studio || '—'))}</strong></div>
            <div class="col-span-3"><span class="text-slate-500">Scuola/Conservatorio:</span> <strong>${escapeHtml(isc.scuola_provenienza || '—')}</strong></div>
            ${docenti.length > 0 ? `<div class="col-span-3"><span class="text-slate-500">Docenti:</span> <strong>${docenti.map(d => escapeHtml(d)).join(' · ')}</strong></div>` : ''}
          </div>
        </section>

        ${(isc.tipo === 'gruppo' || isc.tipo === 'orchestra') && gruppoMembri.length > 0 ? `
        <section>
          <h3 class="font-mono text-[10px] uppercase tracking-wider text-slate-500 mb-2">${isc.tipo === 'orchestra' ? 'Membri dell\'orchestra' : 'Membri del gruppo'} (${escapeHtml(isc.gruppo_nome || '')})</h3>
          <ul class="space-y-1 text-xs">
            ${gruppoMembri.map(m => `<li>· <strong>${escapeHtml(m.nome || '')} ${escapeHtml(m.cognome || '')}</strong> — ${escapeHtml(m.strumento || '—')}${m.data_nascita ? ` (${escapeHtml(m.data_nascita)})` : ''}</li>`).join('')}
          </ul>
        </section>
        ` : ''}

        <!-- Programma -->
        <section>
          <h3 class="font-mono text-[10px] uppercase tracking-wider text-slate-500 mb-2">Programma musicale (${programma.length} brani · ${isc.durata_totale_min || 0} min)</h3>
          ${programma.length > 0 ? `
            <ol class="space-y-1 text-xs list-decimal pl-5">
              ${programma.map(p => `<li><strong>${escapeHtml(p.titolo || '—')}</strong> — ${escapeHtml(p.autore || 'autore sconosciuto')} <span class="text-slate-500">(${escapeHtml(String(p.durata_min || 0))} min)</span></li>`).join('')}
            </ol>
          ` : '<p class="text-xs italic text-slate-500">Nessun brano inserito.</p>'}
        </section>

        <!-- Allegati -->
        <section>
          <h3 class="font-mono text-[10px] uppercase tracking-wider text-slate-500 mb-2">Allegati</h3>
          <div class="flex flex-wrap gap-2 text-xs">
            ${fotoUrl ? `<a href="${escapeHtml(fotoUrl)}" target="_blank" class="px-3 py-2 bg-slate-100 hover:bg-slate-200 rounded-lg inline-flex items-center gap-1.5">📷 Foto</a>` : '<span class="text-slate-400 italic">Foto non allegata</span>'}
            ${docUrl  ? `<a href="${escapeHtml(docUrl)}"  target="_blank" class="px-3 py-2 bg-slate-100 hover:bg-slate-200 rounded-lg inline-flex items-center gap-1.5">📄 Documento ID</a>` : '<span class="text-slate-400 italic">Doc identità non allegato</span>'}
            ${recUrl  ? `<a href="${escapeHtml(recUrl)}"  target="_blank" class="px-3 py-2 bg-slate-100 hover:bg-slate-200 rounded-lg inline-flex items-center gap-1.5">💳 Ricevuta</a>` : '<span class="text-slate-400 italic">Ricevuta non allegata</span>'}
            ${minUrl  ? `<a href="${escapeHtml(minUrl)}"  target="_blank" class="px-3 py-2 bg-slate-100 hover:bg-slate-200 rounded-lg inline-flex items-center gap-1.5">✍ Autorizzazione</a>` : ''}
          </div>
        </section>

        <!-- Note libere -->
        ${isc.note_libere ? `
        <section>
          <h3 class="font-mono text-[10px] uppercase tracking-wider text-slate-500 mb-2">Note del candidato</h3>
          <p class="bg-slate-50 border border-slate-200 rounded-lg p-3 text-xs whitespace-pre-wrap">${escapeHtml(isc.note_libere)}</p>
        </section>
        ` : ''}

        <!-- Consensi -->
        <section class="bg-slate-50 border border-slate-200 rounded-xl p-3">
          <h3 class="font-mono text-[10px] uppercase tracking-wider text-slate-500 mb-2">Consensi</h3>
          <div class="text-xs space-y-1">
            <p>${isc.consenso_privacy ? '✅' : '❌'} Privacy (GDPR)</p>
            <p>${isc.consenso_immagini ? '✅' : '⚪'} Uso immagini</p>
            <p>${isc.consenso_regolamento ? '✅' : '❌'} Regolamento</p>
          </div>
        </section>

        ${isc.note_admin ? `<section><h3 class="font-mono text-[10px] uppercase tracking-wider text-slate-500 mb-2">Note admin</h3><p class="bg-amber-50 border border-amber-200 rounded-lg p-3 text-xs whitespace-pre-wrap">${escapeHtml(isc.note_admin)}</p></section>` : ''}
        ${isc.rejected_reason ? `<section><h3 class="font-mono text-[10px] uppercase tracking-wider text-rose-700 mb-2">Motivo del rifiuto</h3><p class="bg-rose-50 border border-rose-200 rounded-lg p-3 text-xs whitespace-pre-wrap">${escapeHtml(isc.rejected_reason)}</p></section>` : ''}
      </div>
    `,
    primaryLabel: isc.stato === 'approved' || isc.stato === 'rejected' ? null : '✓ Approva',
    secondaryLabel: 'Chiudi',
    onPrimary: async (body) => {
      try {
        await db.approveIscrizione(isc.id);
        toast(`Iscrizione di ${isc.nome} ${isc.cognome} approvata`, 'success');
        if (onChanged) onChanged();
      } catch (e) {
        toast(`Errore: ${e?.message || e}`, 'error');
        return false;
      }
    },
  });

  // Aggiungo a runtime un pulsante "Rifiuta" accanto al primary (solo se stato attivo).
  if (isc.stato !== 'approved' && isc.stato !== 'rejected') {
    setTimeout(() => {
      const modalEl = document.querySelector('#modal-root .c-btn--primary');
      if (modalEl && !modalEl.parentElement.querySelector('[data-isc-reject]')) {
        const btn = document.createElement('button');
        btn.className = 'c-btn c-btn--outline text-rose-700 border-rose-300 hover:bg-rose-50';
        btn.setAttribute('data-isc-reject', '1');
        btn.textContent = '✕ Rifiuta';
        btn.addEventListener('click', async () => {
          const reason = prompt('Motivo del rifiuto (verrà comunicato al candidato):');
          if (reason === null) return;
          try {
            await db.rejectIscrizione(isc.id, reason);
            toast('Iscrizione rifiutata', 'info');
            document.querySelector('#modal-root [data-action="close"]')?.click();
            if (onChanged) onChanged();
          } catch (e) { toast(`Errore: ${e?.message || e}`, 'error'); }
        });
        modalEl.parentElement.insertBefore(btn, modalEl);
      }
    }, 50);
  }
}

// Export CSV — file RFC 4180 con BOM UTF-8 per Excel.
// Anti formula-injection: i valori che iniziano con =, +, -, @, TAB, CR vengono
// prefissati con apostrofo perché Excel/LibreOffice li interpreterebbe come formule.
function exportIscrizioniCsv(items, concorso) {
  const csvField = (v) => {
    let s = String(v ?? '');
    if (s.length && /^[=+\-@\t\r]/.test(s)) s = "'" + s;
    return `"${s.replaceAll('"', '""')}"`;
  };
  const header = ['Data', 'Stato', 'Nome', 'Cognome', 'Email', 'Telefono', 'Data nascita', 'Luogo nascita', 'Nazionalità', 'Sesso', 'Strumento', 'Tipo', 'Gruppo', 'Anni studio', 'Scuola', 'Brani', 'Durata tot', 'Indirizzo', 'Città', 'CAP', 'Provincia'];
  const lines = [header.map(csvField).join(',')];
  for (const i of items) {
    const programma = Array.isArray(i.programma) ? i.programma : [];
    const briefBrani = programma.map(p => `${p.titolo || ''} — ${p.autore || ''}`).join(' | ');
    lines.push([
      new Date(i.created).toLocaleString('it-IT'),
      i.stato,
      i.nome, i.cognome, i.email, i.telefono, i.data_nascita, i.luogo_nascita, i.nazionalita, i.sesso,
      i.strumento, i.tipo, i.gruppo_nome, i.anni_studio, i.scuola_provenienza,
      briefBrani, i.durata_totale_min,
      i.indirizzo, i.citta, i.cap, i.provincia,
    ].map(csvField).join(','));
  }
  const blob = new Blob(['﻿' + lines.join('\n')], { type: 'text/csv;charset=utf-8' });
  const safeName = (concorso.nome || 'iscrizioni').replace(/[\\/\x00-\x1f]+/g, '_').replaceAll(' ', '_');
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = `${safeName}_iscrizioni.csv`; a.click();
  URL.revokeObjectURL(url);
  toast(`${items.length} iscrizioni esportate`, 'success');
}

