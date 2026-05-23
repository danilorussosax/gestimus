// UI helpers, toast, modal, escapeHtml.
import { t } from './i18n.js';
import { icon } from './icons.js';

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

export function escapeHtml(s) {
  if (s == null) return '';
  return String(s)
    .replaceAll('&','&amp;')
    .replaceAll('<','&lt;')
    .replaceAll('>','&gt;')
    .replaceAll('"','&quot;')
    .replaceAll("'",'&#39;');
}

export function fmtDate(iso) {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleDateString('it-IT', { day: '2-digit', month: 'short', year: 'numeric' });
  } catch { return iso; }
}

export function avg(arr) {
  if (!arr.length) return 0;
  return arr.reduce((s,x) => s + x, 0) / arr.length;
}

let toastSeq = 0;
export function toast(message, kind = 'info', timeoutMs = 3200) {
  const root = $('#toast-root');
  if (!root) return;
  const id = `t${++toastSeq}`;
  // Soft pastel toast: white card + tinted left rule + colored icon
  const palette = {
    info:    { rule: '#7C6DFA', tint: '#F4F2FF', text: '#4F40C7' },
    success: { rule: '#22C55E', tint: '#ECFDF3', text: '#15803D' },
    warn:    { rule: '#FFB066', tint: '#FFF6EA', text: '#B45309' },
    error:   { rule: '#F472B6', tint: '#FFF1F5', text: '#B91C5C' },
  }[kind] || { rule: '#7C6DFA', tint: '#F4F2FF', text: '#4F40C7' };
  const iconName = { info: 'info', success: 'checkCircle', warn: 'warning', error: 'error' }[kind] || 'info';
  const el = document.createElement('div');
  el.id = id;
  el.setAttribute('role', kind === 'error' || kind === 'warn' ? 'alert' : 'status');
  el.setAttribute('aria-live', kind === 'error' ? 'assertive' : 'polite');
  el.className = `bg-white px-4 py-3 text-sm font-medium flex items-start gap-3 min-w-[18rem] max-w-sm opacity-0 translate-y-2 transition-all duration-200 ease-expressive rounded-2xl shadow-pop ring-1 ring-brand-100`;
  el.style.borderLeft = `4px solid ${palette.rule}`;
  el.style.color = palette.text;
  el.innerHTML = `<span aria-hidden="true" style="color:${palette.rule}" class="leading-none mt-0.5 shrink-0">${icon(iconName, { size: 18 })}</span><span class="flex-1 leading-relaxed text-ink-900"></span>`;
  el.lastElementChild.textContent = message;
  root.appendChild(el);
  requestAnimationFrame(() => {
    el.classList.remove('opacity-0','translate-y-2');
  });
  setTimeout(() => {
    el.classList.add('opacity-0','translate-y-2');
    setTimeout(() => el.remove(), 220);
  }, timeoutMs);
}

const FOCUSABLE_SEL = 'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function modal({ title, contentHtml, onMount, primaryLabel, onPrimary, secondaryLabel, wide = false, width = null }) {
  primaryLabel = primaryLabel ?? t('modal.save');
  secondaryLabel = secondaryLabel ?? t('modal.cancel');
  const root = $('#modal-root');
  const id = `m${Date.now()}`;
  const titleId = `${id}-title`;
  const widthCls = width || (wide ? 'max-w-2xl' : 'max-w-md');
  const previousActive = document.activeElement;

  // Soft pastel modal: white rounded sheet, lavender header eyebrow, pill footer buttons
  root.innerHTML = `
    <div id="${id}" class="fixed inset-0 z-40 flex items-center justify-center p-4 bg-[rgba(31,29,61,0.45)] backdrop-blur-md view-fade" role="dialog" aria-modal="true" aria-labelledby="${titleId}">
      <div class="bg-white shadow-pop w-full ${widthCls} max-h-[90vh] flex flex-col overflow-hidden modal-pop rounded-3xl ring-1 ring-brand-100">
        <div class="px-6 py-5 border-b border-brand-100 flex items-center justify-between gap-4">
          <div class="min-w-0">
            <p class="font-mono text-[11px] uppercase tracking-[0.16em] text-brand-600 font-semibold">${escapeHtml(t('modal.eyebrow'))}</p>
            <h3 id="${titleId}" class="text-lg font-bold text-ink-900 truncate mt-0.5">${escapeHtml(title)}</h3>
          </div>
          <button data-action="close" aria-label="${escapeHtml(t('common.close'))}" class="text-ink-700 hover:text-brand-700 hover:bg-brand-50 w-9 h-9 inline-flex items-center justify-center transition shrink-0 rounded-full">${icon('close', { size: 18 })}</button>
        </div>
        <div class="px-6 py-5 overflow-y-auto" data-region="body">${contentHtml}</div>
        <div class="border-t border-brand-100 bg-canvas/50 flex items-center justify-end gap-2 px-6 py-4">
          <button data-action="close" class="c-btn c-btn--ghost">${escapeHtml(secondaryLabel)}</button>
          ${onPrimary ? `<button data-action="primary" class="c-btn c-btn--primary"><span>${escapeHtml(primaryLabel)}</span><span aria-hidden="true" class="c-btn__icon">${icon('arrowRight', { size: 16 })}</span></button>` : ''}
        </div>
      </div>
    </div>
  `;
  const el = document.getElementById(id);

  const close = () => {
    document.removeEventListener('keydown', onKeyDown);
    el.remove();
    // Restore focus to the element that opened the modal
    if (previousActive && typeof previousActive.focus === 'function') {
      try { previousActive.focus({ preventScroll: true }); } catch { /* ignore */ }
    }
  };

  // Esc to close + simple focus trap
  function onKeyDown(ev) {
    if (ev.key === 'Escape') {
      ev.preventDefault();
      close();
      return;
    }
    if (ev.key === 'Tab') {
      const focusables = el.querySelectorAll(FOCUSABLE_SEL);
      if (focusables.length === 0) return;
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      if (ev.shiftKey && document.activeElement === first) {
        ev.preventDefault();
        last.focus();
      } else if (!ev.shiftKey && document.activeElement === last) {
        ev.preventDefault();
        first.focus();
      }
    }
  }
  document.addEventListener('keydown', onKeyDown);

  el.addEventListener('click', async (e) => {
    if (e.target === el) close();
    const a = e.target.closest('[data-action]');
    if (!a) return;
    if (a.dataset.action === 'close') close();
    if (a.dataset.action === 'primary' && onPrimary) {
      const body = el.querySelector('[data-region="body"]');
      const btn = a;
      const labelEl = btn.firstElementChild?.tagName === 'SPAN' ? btn.firstElementChild : btn;
      const oldText = labelEl.textContent;
      btn.disabled = true;
      labelEl.textContent = 'Salvataggio…';
      try {
        const result = await onPrimary(body);
        if (result !== false) close();
        else { btn.disabled = false; labelEl.textContent = oldText; }
      } catch (err) {
        console.error(err);
        toast(err?.message || 'Errore', 'error');
        btn.disabled = false;
        labelEl.textContent = oldText;
      }
    }
  });

  const body = el.querySelector('[data-region="body"]');
  if (onMount) onMount(body);

  // Initial focus: first focusable inside body, else primary button, else close.
  requestAnimationFrame(() => {
    const firstField = body.querySelector(FOCUSABLE_SEL);
    const primary    = el.querySelector('[data-action="primary"]');
    (firstField || primary || el.querySelector('[data-action="close"]'))?.focus();
  });

  return { close };
}

export function confirmDialog({ title, message, danger = false, onConfirm }) {
  return modal({
    title,
    contentHtml: `<p class="text-sm text-slate-600">${escapeHtml(message)}</p>`,
    primaryLabel: danger ? t('modal.delete') : t('modal.confirm'),
    secondaryLabel: t('modal.cancel'),
    onPrimary: () => onConfirm(),
  });
}

// File handling --------------------------------------------------------------
export function readFileAsDataURL(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = reject;
    r.readAsDataURL(file);
  });
}

export async function readImageResized(file, maxDim = 400, quality = 0.85) {
  const dataURL = await readFileAsDataURL(file);
  // Preserva il formato sorgente per non rompere la trasparenza:
  // PNG/WebP/SVG → output con alpha; JPEG → JPEG (ricompresso, più leggero).
  const inputMime = (file?.type || '').toLowerCase();
  const outputMime = inputMime === 'image/jpeg' || inputMime === 'image/jpg'
    ? 'image/jpeg'
    : inputMime === 'image/webp'
    ? 'image/webp'
    : 'image/png'; // png è il safe default — supporta alpha ed è lossless
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const ratio = Math.min(1, maxDim / Math.max(img.width, img.height));
      const w = Math.round(img.width * ratio);
      const h = Math.round(img.height * ratio);
      const canvas = document.createElement('canvas');
      canvas.width = w; canvas.height = h;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0, w, h);
      // toDataURL ignora il parametro quality per image/png — innocuo passarlo.
      resolve(canvas.toDataURL(outputMime, quality));
    };
    img.onerror = reject;
    img.src = dataURL;
  });
}

export function ageFromDate(iso) {
  if (!iso) return null;
  const d = new Date(iso);
  if (isNaN(d.getTime())) return null;
  const today = new Date();
  let age = today.getFullYear() - d.getFullYear();
  const m = today.getMonth() - d.getMonth();
  if (m < 0 || (m === 0 && today.getDate() < d.getDate())) age--;
  return age >= 0 ? age : null;
}

export function displayName(cand) {
  if (!cand) return '—';
  if (cand.tipo === 'gruppo' || cand.tipo === 'orchestra') return cand.nome || '—';
  return `${cand.nome || ''} ${cand.cognome || ''}`.trim() || '—';
}

export function fmtBytes(n) {
  if (!n) return '0 B';
  const u = ['B','KB','MB','GB'];
  let i = 0;
  while (n >= 1024 && i < u.length - 1) { n /= 1024; i++; }
  return `${n.toFixed(n < 10 && i ? 1 : 0)} ${u[i]}`;
}

export const NATIONALITIES = [
  'Italiana','Albanese','Argentina','Australiana','Austriaca','Belga','Brasiliana',
  'Britannica','Bulgara','Canadese','Cinese','Coreana','Croata','Danese','Estone',
  'Finlandese','Francese','Giapponese','Greca','Indiana','Iraniana','Irlandese',
  'Israeliana','Lettone','Lituana','Maltese','Messicana','Moldava','Norvegese',
  'Olandese','Polacca','Portoghese','Rumena','Russa','Serba','Slovacca','Slovena',
  'Spagnola','Statunitense','Svedese','Svizzera','Tedesca','Turca','Ucraina','Ungherese',
];
