// Tab "Calendario" del pannello Admin.
// Board drag-and-drop a due livelli:
//   - card-blocco (eventi_calendario) trascinabile tra lane giorno × sala
//   - card-candidato (slot) trascinabile per riordinare dentro il blocco
// In entrambi i casi gli orari individuali si ricalcolano lato server.

import { db } from '../../db.js';
import { escapeHtml, modal, confirmDialog, toast, displayName } from '../../utils.js';
import { icon } from '../../icons.js';
import { t } from '../../i18n.js';
import { exportCalendarioPdf } from '../../calendario-pdf.js';

// Stato del drag corrente (HTML5 DnD nativo, nessuna libreria).
let dragBlockId = null;
let dragSlot = null; // { cfId, eventoId }

const hhmm = (s) => (s ? String(s).slice(0, 5) : '');
function fmtDay(iso) {
  if (!iso) return '';
  try { return new Date(iso + 'T00:00:00').toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' }); }
  catch { return iso; }
}
const SALA_NONE = '__none__';

function candLabel(cf) {
  const cand = db.state.candidati.find((c) => c.id === cf.candidato_id);
  if (!cand) return '—';
  const num = String(cand.numero_candidato || '').padStart(3, '0');
  return `${num} · ${displayName(cand)}`;
}

// ---------------------------------------------------------------------------
// Render principale
// ---------------------------------------------------------------------------
export function renderCalendario(root, concorso) {
  const sale = db.saleByConcorso(concorso.id);
  const eventi = db.eventiByConcorso(concorso.id);

  root.innerHTML = `
    <div class="space-y-6">
      <div class="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 class="text-sm font-bold text-slate-800 uppercase tracking-wider">${escapeHtml(t('cal.title'))}</h3>
          <p class="text-sm text-slate-600">${escapeHtml(t('cal.subtitle'))}</p>
        </div>
        <div class="flex items-center gap-2">
          <button data-action="pdf" class="c-btn c-btn--outline c-btn--sm">${icon('download', { size: 15 })}<span>${escapeHtml(t('cal.pdf.export'))}</span></button>
          <button data-action="add-block" class="text-sm font-semibold text-white bg-brand-600 hover:bg-brand-700 px-3.5 py-2 rounded-lg shadow-sm">${escapeHtml(t('cal.block.add'))}</button>
        </div>
      </div>

      ${saleSection(sale)}
      ${boardSection(eventi, sale)}
      ${linksSection(concorso)}
    </div>`;

  // --- header actions ---
  root.querySelector('[data-action="add-block"]').addEventListener('click', () => openBlockForm(concorso, null, null, () => renderCalendario(root, concorso)));
  root.querySelector('[data-action="pdf"]').addEventListener('click', () => exportConcorsoPdf(concorso));

  // --- sale ---
  root.querySelector('[data-action="add-sala"]')?.addEventListener('click', () => openSalaForm(concorso, null, () => renderCalendario(root, concorso)));
  root.querySelectorAll('[data-edit-sala]').forEach((b) => b.addEventListener('click', () => {
    const s = db.state.sale.find((x) => x.id === b.dataset.editSala);
    if (s) openSalaForm(concorso, s, () => renderCalendario(root, concorso));
  }));
  root.querySelectorAll('[data-del-sala]').forEach((b) => b.addEventListener('click', () => {
    const s = db.state.sale.find((x) => x.id === b.dataset.delSala);
    confirmDialog({
      title: `${t('modal.delete')} — ${s?.nome || ''}`, message: t('cal.block.delete_confirm'), danger: true,
      onConfirm: async () => { try { await db.deleteSala(b.dataset.delSala); renderCalendario(root, concorso); } catch (e) { toast(e.message, 'error'); } },
    });
  }));

  // --- block cards ---
  root.querySelectorAll('[data-block]').forEach((card) => {
    card.addEventListener('dragstart', (e) => { dragBlockId = card.dataset.block; e.dataTransfer.effectAllowed = 'move'; try { e.dataTransfer.setData('text/plain', dragBlockId); } catch { /* noop */ } });
    card.addEventListener('dragend', () => { dragBlockId = null; });
  });
  root.querySelectorAll('[data-edit-block]').forEach((b) => b.addEventListener('click', (e) => {
    e.stopPropagation();
    const ev = db.state.eventi.find((x) => x.id === b.dataset.editBlock);
    if (ev) openBlockForm(concorso, ev, null, () => renderCalendario(root, concorso));
  }));
  root.querySelectorAll('[data-del-block]').forEach((b) => b.addEventListener('click', (e) => {
    e.stopPropagation();
    confirmDialog({
      title: t('cal.block.edit'), message: t('cal.block.delete_confirm'), danger: true,
      onConfirm: async () => { try { await db.deleteEvento(b.dataset.delBlock); renderCalendario(root, concorso); } catch (err) { toast(err.message, 'error'); } },
    });
  }));
  root.querySelectorAll('[data-gen-block]').forEach((b) => b.addEventListener('click', async (e) => {
    e.stopPropagation();
    try { await db.generaSlotEvento(b.dataset.genBlock); toast(t('cal.block.genera_done'), 'success'); renderCalendario(root, concorso); }
    catch (err) { toast(err.message, 'error'); }
  }));

  // --- lane drop targets (block move) ---
  root.querySelectorAll('[data-lane]').forEach((lane) => {
    lane.addEventListener('dragover', (e) => { if (dragBlockId) { e.preventDefault(); lane.classList.add('ring-2', 'ring-brand-400'); } });
    lane.addEventListener('dragleave', () => lane.classList.remove('ring-2', 'ring-brand-400'));
    lane.addEventListener('drop', async (e) => {
      lane.classList.remove('ring-2', 'ring-brand-400');
      if (!dragBlockId) return;
      e.preventDefault();
      const id = dragBlockId; dragBlockId = null;
      const day = lane.dataset.day;
      const salaId = lane.dataset.sala === SALA_NONE ? null : lane.dataset.sala;
      const ev = db.state.eventi.find((x) => x.id === id);
      if (!ev || (ev.data === day && (ev.sala_id || '') === (salaId || ''))) return;
      try { await db.updateEvento(id, { data: day, sala_id: salaId }); renderCalendario(root, concorso); }
      catch (err) { toast(err.message, 'error'); renderCalendario(root, concorso); }
    });
  });

  // --- slot drag (reorder within block) ---
  root.querySelectorAll('[data-slotlist]').forEach((ul) => {
    const eventoId = ul.dataset.slotlist;
    ul.querySelectorAll('[data-slot]').forEach((li) => {
      li.addEventListener('dragstart', (e) => { e.stopPropagation(); dragSlot = { cfId: li.dataset.slot, eventoId }; e.dataTransfer.effectAllowed = 'move'; try { e.dataTransfer.setData('text/plain', li.dataset.slot); } catch { /* noop */ } });
      li.addEventListener('dragend', () => { dragSlot = null; });
    });
    ul.addEventListener('dragover', (e) => { if (dragSlot && dragSlot.eventoId === eventoId) { e.preventDefault(); } });
    ul.addEventListener('drop', async (e) => {
      if (!dragSlot || dragSlot.eventoId !== eventoId) return;
      e.preventDefault();
      const targetLi = e.target.closest('[data-slot]');
      const beforeCfId = targetLi ? targetLi.dataset.slot : null;
      const moving = dragSlot.cfId; dragSlot = null;
      if (beforeCfId === moving) return;
      const ids = db.slotByEvento(eventoId).map((s) => s.id);
      const from = ids.indexOf(moving);
      if (from < 0) return;
      ids.splice(from, 1);
      const to = beforeCfId ? ids.indexOf(beforeCfId) : ids.length;
      ids.splice(to < 0 ? ids.length : to, 0, moving);
      try { await db.riordinaSlotEvento(eventoId, ids); renderCalendario(root, concorso); }
      catch (err) { toast(err.message, 'error'); renderCalendario(root, concorso); }
    });
  });

  // --- links panel ---
  bindLinks(root, concorso);
}

// ---------------------------------------------------------------------------
// Sezione sale
// ---------------------------------------------------------------------------
function saleSection(sale) {
  return `
    <div class="bg-white rounded-2xl ring-1 ring-brand-100 p-4">
      <div class="flex items-center justify-between mb-3">
        <h4 class="text-sm font-bold text-ink-900">${escapeHtml(t('cal.sale.title'))}</h4>
        <button data-action="add-sala" class="c-btn c-btn--outline c-btn--sm">${icon('plus', { size: 14 })}<span>${escapeHtml(t('cal.sale.add'))}</span></button>
      </div>
      ${sale.length === 0
        ? `<p class="text-sm text-ink-500 italic">${escapeHtml(t('cal.sale.empty'))}</p>`
        : `<ul class="flex flex-wrap gap-2">${sale.map((s) => `
            <li class="inline-flex items-center gap-2 bg-brand-50 rounded-full pl-3 pr-1.5 py-1">
              <span class="text-sm text-ink-900">${escapeHtml(s.nome)}</span>
              <button data-edit-sala="${s.id}" class="text-ink-600 hover:text-brand-700 p-1" aria-label="edit">${icon('edit', { size: 13 })}</button>
              <button data-del-sala="${s.id}" class="text-ink-600 hover:text-rose-600 p-1" aria-label="delete">${icon('trash', { size: 13 })}</button>
            </li>`).join('')}</ul>`}
    </div>`;
}

// ---------------------------------------------------------------------------
// Board (giorni × sale) con card-blocco e card-candidato
// ---------------------------------------------------------------------------
function boardSection(eventi, sale) {
  if (eventi.length === 0) {
    return `<div class="bg-white border-2 border-dashed border-brand-100 rounded-2xl py-12 text-center"><p class="text-sm text-ink-500 italic">${escapeHtml(t('cal.board.empty'))}</p></div>`;
  }
  const days = [...new Set(eventi.map((e) => e.data).filter(Boolean))].sort();
  // lane = ogni sala definita + "senza sala"
  const lanes = [...sale.map((s) => ({ id: s.id, nome: s.nome })), { id: SALA_NONE, nome: t('cal.sala.senza') }];
  return days.map((day) => `
    <section class="space-y-2">
      <h4 class="text-sm font-bold text-ink-900 capitalize">${escapeHtml(fmtDay(day))}</h4>
      <div class="grid gap-3" style="grid-template-columns:repeat(${lanes.length}, minmax(240px, 1fr));overflow-x:auto">
        ${lanes.map((lane) => {
          const blocks = eventi.filter((e) => e.data === day && (e.sala_id || SALA_NONE) === lane.id);
          return `
            <div data-lane data-day="${day}" data-sala="${lane.id}" class="rounded-2xl bg-canvas/60 ring-1 ring-brand-100 p-2 min-h-[80px] transition">
              <p class="text-[11px] font-semibold uppercase tracking-wide text-ink-600 px-1 mb-2">${escapeHtml(lane.nome)}</p>
              <div class="space-y-2">${blocks.map(blockCard).join('')}</div>
            </div>`;
        }).join('')}
      </div>
    </section>`).join('');
}

function blockCard(ev) {
  const sez = ev.sezione_id ? db.state.sezioni.find((s) => s.id === ev.sezione_id) : null;
  const cat = ev.categoria_id ? db.state.categorie.find((c) => c.id === ev.categoria_id) : null;
  const fase = ev.fase_id ? db.state.fasi.find((f) => f.id === ev.fase_id) : null;
  const head = [sez?.nome, cat?.nome, fase?.nome].filter(Boolean).join(' · ')
    || ev.titolo || (ev.tipo === 'EVENTO' ? t('cal.block.tipo.evento') : t('cal.block.tipo.esibizione'));
  const slots = db.slotByEvento(ev.id);
  const orario = [hhmm(ev.ora_inizio), hhmm(ev.ora_fine)].filter(Boolean).join('–');
  return `
    <article data-block="${ev.id}" draggable="true" class="group bg-white rounded-xl ring-1 ring-brand-100 shadow-soft cursor-move">
      <header class="px-3 py-2 border-b border-brand-50 flex items-start justify-between gap-2">
        <div class="min-w-0">
          <p class="text-sm font-semibold text-ink-900 truncate">${escapeHtml(head)}</p>
          ${orario ? `<p class="font-mono text-[11px] text-brand-700">${escapeHtml(orario)}</p>` : ''}
        </div>
        <div class="flex items-center gap-0.5 opacity-60 group-hover:opacity-100 transition">
          <button data-gen-block="${ev.id}" title="${escapeHtml(t('cal.block.genera'))}" class="text-ink-600 hover:text-brand-700 p-1">${icon('clock', { size: 13 })}</button>
          <button data-edit-block="${ev.id}" class="text-ink-600 hover:text-brand-700 p-1">${icon('edit', { size: 13 })}</button>
          <button data-del-block="${ev.id}" class="text-ink-600 hover:text-rose-600 p-1">${icon('trash', { size: 13 })}</button>
        </div>
      </header>
      ${ev.tipo === 'EVENTO'
        ? `<p class="px-3 py-2 text-xs text-ink-500 italic">${escapeHtml(ev.titolo || t('cal.block.tipo.evento'))}</p>`
        : `<ul data-slotlist="${ev.id}" class="p-1.5 space-y-1 min-h-[28px]">
            ${slots.length
              ? slots.map((cf) => `
                <li data-slot="${cf.id}" draggable="true" class="flex items-center gap-2 px-2 py-1 rounded-lg bg-canvas hover:bg-brand-50 cursor-grab text-xs">
                  <span class="text-ink-400">${icon('drag', { size: 12 })}</span>
                  <span class="font-mono tabular-nums text-ink-700 w-10">${escapeHtml(hhmm(cf.ora_prevista) || '—')}</span>
                  <span class="flex-1 text-ink-900 truncate">${escapeHtml(candLabel(cf))}</span>
                </li>`).join('')
              : `<li class="px-2 py-1 text-[11px] text-ink-400 italic">${escapeHtml(t('cal.block.nessuno_slot'))}</li>`}
          </ul>`}
    </article>`;
}

// ---------------------------------------------------------------------------
// Form blocco
// ---------------------------------------------------------------------------
function openBlockForm(concorso, ev, prefillDay, onDone) {
  const sezioni = db.sezioniByConcorso(concorso.id);
  const fasi = db.fasiByConcorso(concorso.id);
  const sale = db.saleByConcorso(concorso.id);
  const cur = ev || {};
  const curSez = cur.sezione_id || '';
  const opt = (val, label, sel) => `<option value="${escapeHtml(val)}" ${sel ? 'selected' : ''}>${escapeHtml(label)}</option>`;
  const catOptions = (sezId) => db.state.categorie.filter((c) => c.sezione_id === sezId);

  const content = `
    <div class="space-y-3">
      <label class="block"><span class="c-label">${escapeHtml(t('cal.block.tipo'))}</span>
        <select data-f="tipo" class="c-input">
          ${opt('ESIBIZIONE', t('cal.block.tipo.esibizione'), (cur.tipo || 'ESIBIZIONE') === 'ESIBIZIONE')}
          ${opt('EVENTO', t('cal.block.tipo.evento'), cur.tipo === 'EVENTO')}
        </select>
      </label>
      <div data-only="EVENTO" class="${cur.tipo === 'EVENTO' ? '' : 'hidden'}">
        <label class="block"><span class="c-label">${escapeHtml(t('cal.block.titolo'))}</span>
          <input data-f="titolo" class="c-input" value="${escapeHtml(cur.titolo || '')}"></label>
      </div>
      <div data-only="ESIBIZIONE" class="${cur.tipo === 'EVENTO' ? 'hidden' : ''} space-y-3">
        <label class="block"><span class="c-label">${escapeHtml(t('cal.block.fase'))}</span>
          <select data-f="fase_id" class="c-input">${opt('', t('cal.block.nessuna_fase'), !cur.fase_id)}${fasi.map((f) => opt(f.id, `${f.ordine}. ${f.nome}`, cur.fase_id === f.id)).join('')}</select></label>
        <div class="grid grid-cols-2 gap-3">
          <label class="block"><span class="c-label">${escapeHtml(t('cal.block.sezione'))}</span>
            <select data-f="sezione_id" class="c-input">${opt('', t('cal.block.tutte_sezioni'), !curSez)}${sezioni.map((s) => opt(s.id, s.nome, curSez === s.id)).join('')}</select></label>
          <label class="block"><span class="c-label">${escapeHtml(t('cal.block.categoria'))}</span>
            <select data-f="categoria_id" class="c-input"><option value="">${escapeHtml(t('cal.block.tutte_categorie'))}</option>${catOptions(curSez).map((c) => opt(c.id, c.nome, cur.categoria_id === c.id)).join('')}</select></label>
        </div>
        <label class="block"><span class="c-label">${escapeHtml(t('cal.block.durata'))}</span>
          <input data-f="durata" type="number" min="0" class="c-input" value="${cur.durata_candidato_minuti ?? ''}"></label>
      </div>
      <div class="grid grid-cols-3 gap-3">
        <label class="block"><span class="c-label">${escapeHtml(t('cal.block.data'))}</span>
          <input data-f="data" type="date" class="c-input" value="${escapeHtml(cur.data || prefillDay || '')}"></label>
        <label class="block"><span class="c-label">${escapeHtml(t('cal.block.ora_inizio'))}</span>
          <input data-f="ora_inizio" type="time" class="c-input" value="${escapeHtml(hhmm(cur.ora_inizio))}"></label>
        <label class="block"><span class="c-label">${escapeHtml(t('cal.block.ora_fine'))}</span>
          <input data-f="ora_fine" type="time" class="c-input" value="${escapeHtml(hhmm(cur.ora_fine))}"></label>
      </div>
      <label class="block"><span class="c-label">${escapeHtml(t('cal.block.sala'))}</span>
        <select data-f="sala_id" class="c-input"><option value="">${escapeHtml(t('cal.sala.senza'))}</option>${sale.map((s) => opt(s.id, s.nome, cur.sala_id === s.id)).join('')}</select></label>
      <label class="block"><span class="c-label">${escapeHtml(t('cal.block.note'))}</span>
        <input data-f="note" class="c-input" value="${escapeHtml(cur.note || '')}"></label>
    </div>`;

  modal({
    title: ev ? t('cal.block.edit') : t('cal.block.add'),
    contentHtml: content,
    wide: true,
    onMount: (body) => {
      const tipoSel = body.querySelector('[data-f="tipo"]');
      const toggle = () => {
        const isEvent = tipoSel.value === 'EVENTO';
        body.querySelector('[data-only="EVENTO"]').classList.toggle('hidden', !isEvent);
        body.querySelector('[data-only="ESIBIZIONE"]').classList.toggle('hidden', isEvent);
      };
      tipoSel.addEventListener('change', toggle);
      // categorie dipendono dalla sezione scelta
      const sezSel = body.querySelector('[data-f="sezione_id"]');
      const catSel = body.querySelector('[data-f="categoria_id"]');
      sezSel.addEventListener('change', () => {
        const cats = catOptions(sezSel.value);
        catSel.innerHTML = `<option value="">${escapeHtml(t('cal.block.tutte_categorie'))}</option>` + cats.map((c) => `<option value="${c.id}">${escapeHtml(c.nome)}</option>`).join('');
      });
    },
    onPrimary: async (body) => {
      const val = (f) => body.querySelector(`[data-f="${f}"]`).value || '';
      const tipo = val('tipo');
      const payload = {
        concorso_id: concorso.id,
        tipo,
        data: val('data'),
        ora_inizio: val('ora_inizio') || null,
        ora_fine: val('ora_fine') || null,
        sala_id: val('sala_id') || null,
        note: val('note') || null,
      };
      if (!payload.data) { toast(t('cal.block.data'), 'warn'); return false; }
      if (tipo === 'EVENTO') {
        payload.titolo = val('titolo') || null;
        payload.fase_id = null; payload.sezione_id = null; payload.categoria_id = null; payload.durata_candidato_minuti = null;
      } else {
        payload.fase_id = val('fase_id') || null;
        payload.sezione_id = val('sezione_id') || null;
        payload.categoria_id = val('categoria_id') || null;
        const dur = val('durata');
        payload.durata_candidato_minuti = dur === '' ? null : Number(dur);
      }
      try {
        if (ev) await db.updateEvento(ev.id, payload);
        else { const created = await db.createEvento(payload); if (tipo === 'ESIBIZIONE') await db.generaSlotEvento(created.id); }
        onDone();
      } catch (e) { toast(e.message, 'error'); return false; }
    },
  });
}

// ---------------------------------------------------------------------------
// Form sala
// ---------------------------------------------------------------------------
function openSalaForm(concorso, sala, onDone) {
  const cur = sala || {};
  modal({
    title: sala ? t('cal.sale.title') : t('cal.sale.add'),
    contentHtml: `
      <div class="space-y-3">
        <label class="block"><span class="c-label">${escapeHtml(t('cal.sale.nome'))}</span><input data-f="nome" class="c-input" value="${escapeHtml(cur.nome || '')}"></label>
        <label class="block"><span class="c-label">${escapeHtml(t('cal.sale.indirizzo'))}</span><input data-f="indirizzo" class="c-input" value="${escapeHtml(cur.indirizzo || '')}"></label>
      </div>`,
    onPrimary: async (body) => {
      const nome = body.querySelector('[data-f="nome"]').value.trim();
      const indirizzo = body.querySelector('[data-f="indirizzo"]').value.trim();
      if (!nome) { toast(t('cal.sale.nome'), 'warn'); return false; }
      try {
        if (sala) await db.updateSala(sala.id, { nome, indirizzo });
        else await db.createSala({ concorso_id: concorso.id, nome, indirizzo });
        onDone();
      } catch (e) { toast(e.message, 'error'); return false; }
    },
  });
}

// ---------------------------------------------------------------------------
// Link pubblici
// ---------------------------------------------------------------------------
function publicUrl(token, display = false) {
  return `${location.origin}${location.pathname}#/calendario?token=${encodeURIComponent(token)}${display ? '&display=1' : ''}`;
}

function linksSection(concorso) {
  return `
    <div class="bg-white rounded-2xl ring-1 ring-brand-100 p-4" data-links="${concorso.id}">
      <div class="flex items-center justify-between mb-3">
        <h4 class="text-sm font-bold text-ink-900">${escapeHtml(t('cal.links.title'))}</h4>
        <button data-action="add-link" class="c-btn c-btn--outline c-btn--sm">${icon('plus', { size: 14 })}<span>${escapeHtml(t('cal.links.add'))}</span></button>
      </div>
      <div data-links-list><p class="text-sm text-ink-500 italic">${escapeHtml(t('cal.pub.loading'))}</p></div>
    </div>`;
}

async function bindLinks(root, concorso) {
  const panel = root.querySelector('[data-links]');
  if (!panel) return;
  panel.querySelector('[data-action="add-link"]').addEventListener('click', () => openLinkForm(concorso, () => bindLinks(root, concorso)));
  const listEl = panel.querySelector('[data-links-list]');
  let links = [];
  try { links = await db.calendarioLinks(concorso.id); }
  catch { listEl.innerHTML = `<p class="text-sm text-rose-600">${escapeHtml(t('cal.pub.not_found'))}</p>`; return; }

  if (links.length === 0) { listEl.innerHTML = `<p class="text-sm text-ink-500 italic">${escapeHtml(t('cal.links.empty'))}</p>`; return; }
  const sezName = (id) => db.state.sezioni.find((s) => s.id === id)?.nome || '';
  const scopoLabel = (l) => l.scopo === 'CONCORSO' ? t('cal.links.scopo.concorso')
    : l.scopo === 'SEZIONE' ? `${t('cal.links.scopo.sezione')}: ${sezName(l.sezione_id)}`
    : `${t('cal.links.scopo.giorno')}: ${l.giorno || ''}`;
  listEl.innerHTML = `<ul class="space-y-2">${links.map((l) => `
    <li class="flex items-center gap-2 flex-wrap border border-brand-50 rounded-xl px-3 py-2">
      <div class="min-w-0 flex-1">
        <p class="text-sm font-medium text-ink-900 truncate">${escapeHtml(l.etichetta || scopoLabel(l))}</p>
        <p class="text-[11px] text-ink-600">${escapeHtml(scopoLabel(l))} · ${l.mostra_nomi ? '👤' : '🔒'} ${l.mostra_commissione ? '⚖️' : ''} ${l.attivo ? '' : '· (off)'}</p>
      </div>
      <button data-copy="${escapeHtml(l.token)}" class="c-btn c-btn--ghost c-btn--sm">${icon('copy', { size: 13 })}<span>${escapeHtml(t('cal.links.copy'))}</span></button>
      <a href="${escapeHtml(publicUrl(l.token, true))}" target="_blank" rel="noopener" class="c-btn c-btn--ghost c-btn--sm">${icon('externalLink', { size: 13 })}<span>${escapeHtml(t('cal.links.display'))}</span></a>
      <button data-toggle="${l.id}" data-attivo="${l.attivo ? '1' : '0'}" class="c-btn c-btn--ghost c-btn--sm">${l.attivo ? icon('eye', { size: 13 }) : icon('eyeOff', { size: 13 })}</button>
      <button data-revoke="${l.id}" class="c-btn c-btn--ghost c-btn--sm text-rose-600">${icon('trash', { size: 13 })}</button>
    </li>`).join('')}</ul>`;

  listEl.querySelectorAll('[data-copy]').forEach((b) => b.addEventListener('click', async () => {
    try { await navigator.clipboard.writeText(publicUrl(b.dataset.copy, false)); toast(t('cal.links.copied'), 'success'); }
    catch { toast(publicUrl(b.dataset.copy, false), 'info', 6000); }
  }));
  listEl.querySelectorAll('[data-toggle]').forEach((b) => b.addEventListener('click', async () => {
    try { await db.updateCalendarioLink(b.dataset.toggle, { attivo: b.dataset.attivo !== '1' }); bindLinks(root, concorso); }
    catch (e) { toast(e.message, 'error'); }
  }));
  listEl.querySelectorAll('[data-revoke]').forEach((b) => b.addEventListener('click', () => {
    confirmDialog({
      title: t('cal.links.revoke'), message: t('cal.links.revoke_confirm'), danger: true,
      onConfirm: async () => { try { await db.deleteCalendarioLink(b.dataset.revoke); bindLinks(root, concorso); } catch (e) { toast(e.message, 'error'); } },
    });
  }));
}

function openLinkForm(concorso, onDone) {
  const sezioni = db.sezioniByConcorso(concorso.id);
  const content = `
    <div class="space-y-3">
      <label class="block"><span class="c-label">${escapeHtml(t('cal.links.scopo'))}</span>
        <select data-f="scopo" class="c-input">
          <option value="CONCORSO">${escapeHtml(t('cal.links.scopo.concorso'))}</option>
          <option value="SEZIONE">${escapeHtml(t('cal.links.scopo.sezione'))}</option>
          <option value="GIORNO">${escapeHtml(t('cal.links.scopo.giorno'))}</option>
        </select></label>
      <label class="block hidden" data-when="SEZIONE"><span class="c-label">${escapeHtml(t('cal.block.sezione'))}</span>
        <select data-f="sezione_id" class="c-input">${sezioni.map((s) => `<option value="${s.id}">${escapeHtml(s.nome)}</option>`).join('')}</select></label>
      <label class="block hidden" data-when="GIORNO"><span class="c-label">${escapeHtml(t('cal.block.data'))}</span>
        <input data-f="giorno" type="date" class="c-input"></label>
      <label class="block"><span class="c-label">${escapeHtml(t('cal.links.etichetta'))}</span><input data-f="etichetta" class="c-input"></label>
      <label class="flex items-center gap-2 text-sm text-ink-800"><input data-f="mostra_nomi" type="checkbox" checked> ${escapeHtml(t('cal.links.mostra_nomi'))}</label>
      <label class="flex items-center gap-2 text-sm text-ink-800"><input data-f="mostra_commissione" type="checkbox"> ${escapeHtml(t('cal.links.mostra_commissione'))}</label>
    </div>`;
  modal({
    title: t('cal.links.add'),
    contentHtml: content,
    onMount: (body) => {
      const scopo = body.querySelector('[data-f="scopo"]');
      const sync = () => {
        body.querySelector('[data-when="SEZIONE"]').classList.toggle('hidden', scopo.value !== 'SEZIONE');
        body.querySelector('[data-when="GIORNO"]').classList.toggle('hidden', scopo.value !== 'GIORNO');
      };
      scopo.addEventListener('change', sync); sync();
    },
    onPrimary: async (body) => {
      const v = (f) => body.querySelector(`[data-f="${f}"]`);
      const scopo = v('scopo').value;
      const payload = {
        concorso_id: concorso.id,
        scopo,
        etichetta: v('etichetta').value || null,
        mostra_nomi: v('mostra_nomi').checked,
        mostra_commissione: v('mostra_commissione').checked,
        sezione_id: scopo === 'SEZIONE' ? (v('sezione_id').value || null) : null,
        giorno: scopo === 'GIORNO' ? (v('giorno').value || null) : null,
      };
      if (scopo === 'SEZIONE' && !payload.sezione_id) { toast(t('cal.block.sezione'), 'warn'); return false; }
      if (scopo === 'GIORNO' && !payload.giorno) { toast(t('cal.block.data'), 'warn'); return false; }
      try { await db.createCalendarioLink(payload); onDone(); }
      catch (e) { toast(e.message, 'error'); return false; }
    },
  });
}

// ---------------------------------------------------------------------------
// PDF (intero concorso) — costruisce la stessa forma della route pubblica.
// ---------------------------------------------------------------------------
function exportConcorsoPdf(concorso) {
  const eventi = db.eventiByConcorso(concorso.id);
  const days = [...new Set(eventi.map((e) => e.data).filter(Boolean))].sort();
  const giorni = days.map((data) => ({
    data,
    blocchi: eventi.filter((e) => e.data === data).map((ev) => {
      const sez = ev.sezione_id ? db.state.sezioni.find((s) => s.id === ev.sezione_id) : null;
      const cat = ev.categoria_id ? db.state.categorie.find((c) => c.id === ev.categoria_id) : null;
      const fase = ev.fase_id ? db.state.fasi.find((f) => f.id === ev.fase_id) : null;
      const comm = fase?.commissione_id ? db.state.commissioni.find((c) => c.id === fase.commissione_id) : null;
      const commissione = comm ? (comm.commissari_ids || []).map((id) => {
        const m = db.state.commissari.find((x) => x.id === id);
        return m ? { nome: m.nome, cognome: m.cognome, specialita: m.specialita } : null;
      }).filter(Boolean) : [];
      return {
        oraInizio: ev.ora_inizio, oraFine: ev.ora_fine, tipo: ev.tipo, titolo: ev.titolo,
        sala: ev.sala_id ? { nome: db.state.sale.find((s) => s.id === ev.sala_id)?.nome } : null,
        sezione: sez ? { nome: sez.nome } : null,
        categoria: cat ? { nome: cat.nome } : null,
        fase: fase ? { nome: fase.nome } : null,
        commissione,
        slot: db.slotByEvento(ev.id).map((cf) => ({ oraPrevista: cf.ora_prevista, etichetta: candLabel(cf) })),
      };
    }),
  }));
  exportCalendarioPdf({
    titolo: concorso.nome,
    sottotitolo: `${t('cal.pdf.title')} · ${concorso.anno || ''}`,
    logoUrl: concorso.logo_url || './logo.png',
    mostraCommissione: true,
    giorni,
  });
}
