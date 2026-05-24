// Comando-paletta globale (Cmd/Ctrl+K).
// Cerca su concorsi, candidati, commissari, fasi. Click → navigazione contestuale.

import { db } from './db.js';
import { pb } from './pb.js';
import { displayName, escapeHtml } from './utils.js';
import { icon } from './icons.js';
import { t } from './i18n.js';

const KIND_ICON = {
  concorso:    'trophy',
  fase:        'flag',
  candidato:   'graduation',
  commissario: 'judge',
};

let openEl = null;

function normalize(s) {
  return String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
}

function buildIndex() {
  const out = [];
  const s = db.state;
  const concorsoNome = (id) => s.concorsi.find(c => c.id === id)?.nome || '';

  s.concorsi.forEach(c => {
    out.push({
      kind: 'concorso', id: c.id,
      label: c.nome, sub: t('palette.sub.concorso', { anno: c.anno, stato: c.stato }),
      hay: normalize(`${c.nome} ${c.anno} concorso`),
    });
  });
  s.fasi.forEach(f => {
    out.push({
      kind: 'fase', id: f.id, concorso_id: f.concorso_id,
      label: f.nome, sub: t('palette.sub.fase', { concorso: concorsoNome(f.concorso_id), stato: f.stato }),
      hay: normalize(`${f.nome} fase ${concorsoNome(f.concorso_id)}`),
    });
  });
  s.candidati.forEach(c => {
    const num = String(c.numero_candidato || '').padStart(3, '0');
    out.push({
      kind: 'candidato', id: c.id, concorso_id: c.concorso_id,
      label: `#${num} ${displayName(c)}`,
      sub: t('palette.sub.candidato', { strumento: c.strumento || '—', concorso: concorsoNome(c.concorso_id) }),
      hay: normalize(`${num} ${displayName(c)} ${c.strumento} candidato ${concorsoNome(c.concorso_id)}`),
    });
  });
  s.commissari.forEach(c => {
    // I commissari sono anagrafica per-tenant: possono essere assegnati a più
    // concorsi. Per la palette mostriamo l'elenco dei concorsi (o "Archivio" se
    // non assegnati). Il `concorso_id` per la navigazione è il primo della lista
    // (se esiste) — apre quel concorso nel pannello admin.
    const concorsiNomi = (c.concorsi_ids || [])
      .map(id => concorsoNome(id))
      .filter(Boolean);
    const concorsiLabel = concorsiNomi.length === 0
      ? t('palette.archive') || 'archivio'
      : concorsiNomi.join(', ');
    out.push({
      kind: 'commissario', id: c.id, concorso_id: (c.concorsi_ids || [])[0] || null,
      label: displayName(c),
      isPresidente: db.isPresidenteDiQualcheCommissione(c.id),
      sub: t('palette.sub.commissario', { specialita: c.specialita || '—', concorso: concorsiLabel }),
      hay: normalize(`${displayName(c)} ${c.specialita} commissario ${concorsiLabel}`),
    });
  });
  return out;
}

function search(index, q) {
  const nq = normalize(q.trim());
  if (!nq) return index.slice(0, 20);
  const tokens = nq.split(/\s+/).filter(Boolean);
  return index
    .map(item => {
      const hits = tokens.filter(t => item.hay.includes(t)).length;
      const score = hits === tokens.length ? hits + (item.hay.startsWith(tokens[0]) ? 0.5 : 0) : 0;
      return { item, score };
    })
    .filter(x => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 30)
    .map(x => x.item);
}

function navigateTo(item) {
  // R15: gate sul ruolo dell'account autenticato (fonte di verità), non su
  // db.state.meta.role (mutabile client-side) — coerente con app.js. Ammette
  // admin E superadmin (prima un superadmin veniva rimbalzato a home).
  const authRole = pb.authStore.model?.role;
  if (authRole !== 'admin' && authRole !== 'superadmin') {
    location.hash = '#/';
    return;
  }
  if (item.concorso_id) db.setActiveConcorso(item.concorso_id);
  const tabMap = { fase: 'fasi', candidato: 'candidati', commissario: 'commissari', concorso: 'fasi' };
  const tab = tabMap[item.kind] || 'fasi';
  location.hash = `#/admin?tab=${tab}`;
  // Forziamo re-render via hashchange
  window.dispatchEvent(new HashChangeEvent('hashchange'));
}

export function openPalette() {
  if (openEl) return;
  if (!db.initialized) return;

  const index = buildIndex();
  const previousActive = document.activeElement;

  const root = document.getElementById('modal-root');
  const id = `palette-${Date.now()}`;
  const wrap = document.createElement('div');
  wrap.id = id;
  wrap.className = 'fixed inset-0 z-50 flex items-start justify-center pt-[10vh] p-4 bg-[rgba(22,22,22,0.50)] backdrop-blur-sm view-fade';
  wrap.setAttribute('role', 'dialog');
  wrap.setAttribute('aria-modal', 'true');
  wrap.setAttribute('aria-label', t('palette.aria_label'));
  wrap.innerHTML = `
    <div class="bg-white shadow-pop w-full max-w-xl border border-brand-100 modal-pop overflow-hidden">
      <div class="flex items-center gap-3 px-4 h-12 border-b border-brand-100">
        <span aria-hidden="true" class="text-ink-700 shrink-0">${icon('search', { size: 16 })}</span>
        <input data-q autocomplete="off" placeholder="${escapeHtml(t('palette.placeholder'))}" class="flex-1 bg-transparent outline-none text-sm placeholder:text-ink-500 text-ink-900" />
        <kbd class="text-[10px] font-mono px-1.5 py-0.5 bg-brand-50 border border-brand-100 text-ink-700">${escapeHtml(t('palette.kbd_esc'))}</kbd>
      </div>
      <ul data-list role="listbox" class="max-h-[50vh] overflow-y-auto"></ul>
      <div class="px-4 h-9 border-t border-brand-100 bg-brand-50 text-[11px] font-mono uppercase tracking-[0.08em] text-ink-700 flex items-center justify-between">
        <span><kbd class="font-mono">↑↓</kbd> ${escapeHtml(t('palette.hint_navigate'))} · <kbd class="font-mono">↵</kbd> ${escapeHtml(t('palette.hint_open'))} · <kbd class="font-mono">${escapeHtml(t('palette.kbd_esc'))}</kbd> ${escapeHtml(t('palette.hint_close'))}</span>
        <span>${escapeHtml(t('palette.elements', { n: index.length }))}</span>
      </div>
    </div>
  `;
  root.appendChild(wrap);
  openEl = wrap;

  const input = wrap.querySelector('[data-q]');
  const listEl = wrap.querySelector('[data-list]');
  let active = 0;
  let results = [];

  const renderList = (q) => {
    results = search(index, q);
    active = 0;
    if (results.length === 0) {
      listEl.innerHTML = `<li class="px-4 py-8 text-center text-sm text-ink-700">${escapeHtml(t('palette.no_results'))}</li>`;
      return;
    }
    listEl.innerHTML = results.map((r, i) => `
      <li role="option" data-i="${i}" class="px-4 h-12 flex items-center gap-3 cursor-pointer border-l-2 ${i === active ? 'bg-[#edf5ff] border-l-brand-500' : 'border-l-transparent hover:bg-brand-50'}">
        <span aria-hidden="true" class="shrink-0 w-7 h-7 bg-brand-50 text-ink-700 flex items-center justify-center">${icon(KIND_ICON[r.kind] || 'document', { size: 14 })}</span>
        <div class="flex-1 min-w-0">
          <div class="text-sm font-medium text-ink-900 truncate flex items-center gap-1.5">
            ${escapeHtml(r.label)}
            ${r.isPresidente ? `<span class="text-[#b28600]">${icon('star', { size: 12 })}</span>` : ''}
          </div>
          <div class="text-[11px] text-ink-700 truncate">${escapeHtml(r.sub)}</div>
        </div>
        <span class="c-tag c-tag--gray c-tag--no-dot">${escapeHtml(t('palette.kind.' + r.kind))}</span>
      </li>
    `).join('');
  };

  const setActive = (i) => {
    active = (i + results.length) % Math.max(results.length, 1);
    listEl.querySelectorAll('li[data-i]').forEach((el, idx) => {
      el.classList.toggle('bg-[#edf5ff]', idx === active);
      el.classList.toggle('border-l-brand-500', idx === active);
      el.classList.toggle('border-l-transparent', idx !== active);
      el.classList.toggle('hover:bg-brand-50', idx !== active);
    });
    listEl.querySelector(`li[data-i="${active}"]`)?.scrollIntoView({ block: 'nearest' });
  };

  const close = () => {
    document.removeEventListener('keydown', onKey);
    wrap.remove();
    openEl = null;
    if (previousActive && typeof previousActive.focus === 'function') {
      try { previousActive.focus({ preventScroll: true }); } catch { /* ignore */ }
    }
  };

  const submit = () => {
    const item = results[active];
    if (!item) return;
    close();
    navigateTo(item);
  };

  function onKey(ev) {
    if (ev.key === 'Escape') { ev.preventDefault(); close(); }
    else if (ev.key === 'ArrowDown') { ev.preventDefault(); setActive(active + 1); }
    else if (ev.key === 'ArrowUp')   { ev.preventDefault(); setActive(active - 1); }
    else if (ev.key === 'Enter')     { ev.preventDefault(); submit(); }
  }
  document.addEventListener('keydown', onKey);

  input.addEventListener('input', () => renderList(input.value));
  wrap.addEventListener('click', (e) => {
    if (e.target === wrap) close();
    const li = e.target.closest('li[data-i]');
    if (li) {
      active = Number(li.dataset.i);
      submit();
    }
  });

  renderList('');
  requestAnimationFrame(() => input.focus());
}

export function registerPaletteShortcut() {
  document.addEventListener('keydown', (ev) => {
    const isMod = ev.metaKey || ev.ctrlKey;
    if (isMod && ev.key.toLowerCase() === 'k') {
      ev.preventDefault();
      openPalette();
    }
  });
}
