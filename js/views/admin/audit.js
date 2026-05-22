// Tab "Audit log" del pannello Admin: query e display.
// Estratto da js/views/admin.js (refactoring).

import { db } from '../../db.js';
import { escapeHtml } from '../../utils.js';
import { icon } from '../../icons.js';
import { t } from '../../i18n.js';

// Mapping action → [emoji, i18n key]. Usato in renderAudit per arricchire la
// timeline con icone + label localizzate.
const AUDIT_LABEL_KEYS = {
  'concorso.create':  ['🆕', 'admin.audit.label.concorso_create'],
  'concorso.delete':  ['🗑', 'admin.audit.label.concorso_delete'],
  'fase.start':       ['▶',  'admin.audit.label.fase_start'],
  'fase.complete':    ['🏁', 'admin.audit.label.fase_complete'],
  'fase.sorteggio':   ['🎲', 'admin.audit.label.fase_sorteggio'],
  'account.create':   ['🔑', 'admin.audit.label.account_create'],
  'account.delete':   ['🗑', 'admin.audit.label.account_delete'],
  'auth.login':       ['🔓', 'admin.audit.label.auth_login'],
  'auth.logout':      ['🔒', 'admin.audit.label.auth_logout'],
};

export async function renderAudit(root, concorso) {
  let scope = 'concorso'; // 'concorso' | 'all'
  let q = '';

  const renderShell = () => {
    root.innerHTML = `
      <div class="flex flex-wrap items-center justify-between gap-2 mb-4">
        <div>
          <h3 class="text-sm font-bold text-ink-900 uppercase tracking-wider">${escapeHtml(t('admin.audit.title'))}</h3>
          <p class="text-xs text-ink-500 mt-0.5">${escapeHtml(t('admin.audit.subtitle'))}</p>
        </div>
        <div class="flex items-center gap-2">
          <div class="inline-flex bg-canvas border border-slate-200 rounded-lg p-0.5">
            <button data-scope="concorso" class="text-xs font-medium px-3 py-1.5 rounded-md ${scope === 'concorso' ? 'bg-white text-ink-900 shadow-soft' : 'text-ink-700'}">${escapeHtml(t('admin.audit.scope_only'))}</button>
            <button data-scope="all" class="text-xs font-medium px-3 py-1.5 rounded-md ${scope === 'all' ? 'bg-white text-ink-900 shadow-soft' : 'text-ink-700'}">${escapeHtml(t('admin.audit.scope_all'))}</button>
          </div>
          <input data-q value="${escapeHtml(q)}" placeholder="${escapeHtml(t('admin.audit.search_ph'))}" class="text-xs border border-slate-200 rounded-lg px-3 py-1.5 w-56 focus:ring-2 focus:ring-brand-500 focus:border-brand-500" />
        </div>
      </div>
      <div data-list class="bg-white ring-1 ring-slate-900/5 rounded-xl overflow-hidden shadow-soft">
        <div class="px-4 py-12 text-center text-sm text-ink-500">${escapeHtml(t('admin.audit.loading'))}</div>
      </div>
    `;
    root.querySelectorAll('[data-scope]').forEach(b => b.addEventListener('click', () => {
      scope = b.dataset.scope;
      load();
    }));
    const qEl = root.querySelector('[data-q]');
    qEl.addEventListener('input', () => { q = qEl.value; renderList(); });
  };

  let items = [];
  const load = async () => {
    const list = root.querySelector('[data-list]');
    list.innerHTML = `<div class="px-4 py-12 text-center text-sm text-ink-500">${escapeHtml(t('admin.audit.loading'))}</div>`;
    try {
      items = await db.fetchAuditLog({ concorsoId: scope === 'concorso' ? concorso.id : null });
    } catch (e) {
      list.innerHTML = `<div class="px-4 py-12 text-center text-sm text-rose-600">${escapeHtml(t('admin.audit.error', { msg: e.message }))}</div>`;
      return;
    }
    renderList();
  };

  const renderList = () => {
    const list = root.querySelector('[data-list]');
    const filtered = q.trim()
      ? items.filter(i => {
          const hay = `${i.action} ${i.actor_email} ${i.target_label}`.toLowerCase();
          return hay.includes(q.toLowerCase());
        })
      : items;
    if (filtered.length === 0) {
      list.innerHTML = `<div class="px-4 py-12 text-center text-sm text-ink-500">${escapeHtml(t('admin.audit.empty'))}</div>`;
      return;
    }
    list.innerHTML = filtered.map(it => {
      const mapping = AUDIT_LABEL_KEYS[it.action];
      const icon = mapping ? mapping[0] : '•';
      const label = mapping ? t(mapping[1]) : it.action;
      const ts = new Date(it.created).toLocaleString('it-IT', { dateStyle: 'short', timeStyle: 'short' });
      const target = it.target_label ? ` · ${escapeHtml(it.target_label)}` : '';
      const actor = it.actor_email ? `<span class="text-ink-700">${escapeHtml(it.actor_email)}</span>` : `<span class="text-ink-500 italic">${escapeHtml(t('admin.audit.system'))}</span>`;
      return `
        <div class="flex items-start gap-3 px-4 py-3 border-b border-slate-100 last:border-b-0 hover:bg-canvas">
          <span class="text-base shrink-0 w-7 h-7 rounded-md bg-brand-50 text-brand-600 flex items-center justify-center" aria-hidden="true">${icon}</span>
          <div class="flex-1 min-w-0">
            <div class="text-sm font-medium text-ink-900 truncate">${escapeHtml(label)}${target}</div>
            <div class="text-xs text-ink-500 mt-0.5">${actor}${it.actor_role ? ' <span class="text-[10px] font-bold uppercase tracking-wider text-ink-500">·</span> ' + escapeHtml(it.actor_role) : ''}</div>
          </div>
          <div class="text-[11px] text-ink-500 font-mono shrink-0">${escapeHtml(ts)}</div>
        </div>
      `;
    }).join('');
  };

  renderShell();
  load();
}
