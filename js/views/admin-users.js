import { db } from '../db.js';
import { t } from '../i18n.js';
import { icon } from '../icons.js';
import { escapeHtml, toast, confirmDialog } from '../utils.js';

export function renderUsers(root) {
  const accounts = db.state.accounts.slice().sort((a, b) => {
    if (a.role === 'admin' && b.role !== 'admin') return -1;
    if (a.role !== 'admin' && b.role === 'admin') return 1;
    return (a.nome || '').localeCompare(b.nome || '');
  });

  const roleBadge = (role) => {
    if (role === 'admin') return `<span class="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full bg-brand-50 text-brand-700 border border-brand-100">${icon('tools', { size: 10 })} ${escapeHtml(t('admin.users.role_admin'))}</span>`;
    return `<span class="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full bg-accent-50 text-accent-600 border border-accent-100">${icon('music', { size: 10 })} ${escapeHtml(t('admin.users.role_commissario'))}</span>`;
  };

  root.innerHTML = `
    <section class="view-fade c-page">
      <header class="c-page-header">
        <p class="c-page-header__eyebrow">${escapeHtml(t('admin.users.eyebrow'))}</p>
        <h1 class="c-page-header__title">${escapeHtml(t('admin.users.title'))}</h1>
        <p class="c-page-header__sub">${escapeHtml(t('admin.users.subtitle'))}</p>
      </header>

      <div class="c-page">
        <div class="flex items-center justify-between gap-4 mb-4">
          <p class="text-sm text-ink-700">${escapeHtml(t('admin.users.count', { n: accounts.length }))}</p>
          <button data-action="add-user" class="c-btn c-btn--primary c-btn--sm">
            <span>${escapeHtml(t('admin.users.add'))}</span>
            <span class="c-btn__icon" aria-hidden="true">${icon('plus', { size: 14 })}</span>
          </button>
        </div>

        ${accounts.length === 0 ? `
          <div class="bg-white border border-dashed border-brand-200 rounded-2xl p-10 text-center">
            <h3 class="text-lg font-bold text-ink-900">${escapeHtml(t('admin.users.empty_title'))}</h3>
            <p class="text-sm text-ink-700 mt-1">${escapeHtml(t('admin.users.empty_desc'))}</p>
          </div>
        ` : `
          <div class="bg-white border border-brand-100 rounded-2xl overflow-hidden">
            <table class="w-full text-sm">
              <thead>
                <tr class="border-b border-brand-100 bg-brand-50/50">
                  <th class="text-left px-4 py-2.5 font-mono text-[10px] uppercase tracking-wider text-ink-700">${escapeHtml(t('admin.users.col_name'))}</th>
                  <th class="text-left px-4 py-2.5 font-mono text-[10px] uppercase tracking-wider text-ink-700">${escapeHtml(t('admin.users.col_email'))}</th>
                  <th class="text-left px-4 py-2.5 font-mono text-[10px] uppercase tracking-wider text-ink-700">${escapeHtml(t('admin.users.col_role'))}</th>
                  <th class="text-left px-4 py-2.5 font-mono text-[10px] uppercase tracking-wider text-ink-700">${escapeHtml(t('admin.users.col_status'))}</th>
                  <th class="text-right px-4 py-2.5 font-mono text-[10px] uppercase tracking-wider text-ink-700">${escapeHtml(t('admin.users.col_actions'))}</th>
                </tr>
              </thead>
              <tbody>
                ${accounts.map(a => {
                  const com = a.commissario_id ? db.state.commissari.find(c => c.id === a.commissario_id) : null;
                  return `
                    <tr class="border-b border-brand-50 hover:bg-brand-50/30 transition-colors">
                      <td class="px-4 py-2.5">
                        <div class="font-medium text-ink-900">${escapeHtml(a.nome || a.email)}</div>
                        ${com ? `<div class="text-xs text-ink-700">${escapeHtml(com.nome)} ${escapeHtml(com.cognome)}</div>` : ''}
                      </td>
                      <td class="px-4 py-2.5 text-ink-700">${escapeHtml(a.email)}</td>
                      <td class="px-4 py-2.5">${roleBadge(a.role)}</td>
                      <td class="px-4 py-2.5">
                        ${a.attivo
                          ? `<span class="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200">${escapeHtml(t('admin.users.active'))}</span>`
                          : `<span class="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full bg-rose-50 text-rose-700 border border-rose-200">${escapeHtml(t('admin.users.disabled'))}</span>`
                        }
                      </td>
                      <td class="px-4 py-2.5 text-right">
                        <div class="flex items-center justify-end gap-1">
                          <button data-action="toggle-active" data-id="${a.id}" class="text-xs px-2 py-1 rounded-lg ${a.attivo ? 'text-rose-600 hover:bg-rose-50' : 'text-emerald-600 hover:bg-emerald-50'}" title="${a.attivo ? escapeHtml(t('admin.users.disable')) : escapeHtml(t('admin.users.enable'))}">
                            ${a.attivo ? icon('xCircle', { size: 14 }) : icon('checkCircle', { size: 14 })}
                          </button>
                          <button data-action="reset-pwd" data-id="${a.id}" class="text-xs px-2 py-1 rounded-lg text-brand-600 hover:bg-brand-50" title="${escapeHtml(t('admin.users.reset_password'))}">
                            ${icon('key', { size: 14 })}
                          </button>
                          <button data-action="delete-user" data-id="${a.id}" class="text-xs px-2 py-1 rounded-lg text-rose-600 hover:bg-rose-50" title="${escapeHtml(t('common.delete'))}">
                            ${icon('trash', { size: 14 })}
                          </button>
                        </div>
                      </td>
                    </tr>`;
                }).join('')}
              </tbody>
            </table>
          </div>
        `}
      </div>
    </section>
  `;

  // Toggle active/disabled
  root.querySelectorAll('[data-action="toggle-active"]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const account = accounts.find(a => a.id === btn.dataset.id);
      if (!account) return;
      try {
        await db.updateAccount(account.id, { attivo: !account.attivo });
        toast(account.attivo ? t('admin.users.disabled_ok') : t('admin.users.enabled_ok'), 'success');
        renderUsers(root);
      } catch (e) { toast(e.message, 'error'); }
    });
  });

  // Reset password — simple prompt
  root.querySelectorAll('[data-action="reset-pwd"]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const account = accounts.find(a => a.id === btn.dataset.id);
      if (!account) return;
      const newPassword = prompt(t('admin.users.new_password_prompt', { email: account.email }));
      if (!newPassword || newPassword.length < 6) {
        if (newPassword !== null) toast(t('admin.users.password_too_short'), 'error');
        return;
      }
      try {
        await db.resetAccountPassword(account.id, newPassword);
        toast(t('admin.users.password_reset_ok'), 'success');
      } catch (e) { toast(e.message, 'error'); }
    });
  });

  // Delete user
  root.querySelectorAll('[data-action="delete-user"]').forEach(btn => {
    btn.addEventListener('click', () => {
      const account = accounts.find(a => a.id === btn.dataset.id);
      if (!account) return;
      confirmDialog({
        title: t('admin.users.delete_title'),
        message: t('admin.users.delete_msg', { email: account.email }),
        danger: true,
        onConfirm: async () => {
          try {
            await db.deleteAccount(account.id);
            toast(t('admin.users.deleted'), 'success');
            renderUsers(root);
          } catch (e) { toast(e.message, 'error'); }
        },
      });
    });
  });
}