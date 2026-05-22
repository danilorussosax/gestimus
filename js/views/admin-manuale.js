// Admin → Manuale
// Renderizza ./docs/manuale-admin.md dentro l'app con TOC sticky, layout A4 e
// stampa nativa via window.print(). Il markdown viene parsato con `marked`
// (caricato in index.html via CDN). Se il file non esiste mostra un placeholder
// gentile; se `marked` non è caricato (offline / CSP) fa fallback a <pre>.

import { t } from '../i18n.js';
import { icon } from '../icons.js';
import { escapeHtml } from '../utils.js';

const MANUALE_URL = './docs/manuale-admin.md';
const SCREENSHOTS_PREFIX_FROM = './screenshots/';
const SCREENSHOTS_PREFIX_TO   = './docs/screenshots/';

// CSS scoped al wrapper .manuale-print: layout A4 a 96dpi (~794px) + comportamento stampa.
// Inietto inline così il file non aggiunge dipendenze su css/styles.css ed è autocontenuto.
const MANUALE_STYLES = `
  .manuale-wrap { display: grid; grid-template-columns: 240px 1fr; gap: 2rem; align-items: start; }
  @media (max-width: 900px) { .manuale-wrap { grid-template-columns: 1fr; } }

  .manuale-toc {
    position: sticky; top: 6rem; max-height: calc(100vh - 8rem); overflow-y: auto;
    border: 1px solid hsl(var(--border)); background: #fff; padding: 1rem;
    border-radius: 0.5rem; font-size: 13px;
  }
  .manuale-toc h4 {
    font-family: 'Roboto Mono', ui-monospace, monospace;
    font-size: 10px; text-transform: uppercase; letter-spacing: 0.14em;
    color: hsl(var(--muted-foreground)); margin: 0 0 0.75rem;
  }
  .manuale-toc ul { list-style: none; padding: 0; margin: 0; }
  .manuale-toc li { margin: 0; }
  .manuale-toc a {
    display: block; padding: 0.3rem 0.5rem; color: #2E3554; text-decoration: none;
    border-left: 2px solid transparent; border-radius: 0 0.25rem 0.25rem 0;
    line-height: 1.35; transition: background 120ms, color 120ms, border-color 120ms;
  }
  .manuale-toc a:hover { background: #EFF3FF; color: #2843A0; border-left-color: #4169E1; }
  .manuale-toc a.is-active { background: #EFF3FF; color: #2843A0; border-left-color: #4169E1; font-weight: 600; }
  .manuale-toc a.level-3 { padding-left: 1.25rem; font-size: 12px; color: hsl(var(--muted-foreground)); }

  .manuale-toc-mobile { display: none; }
  @media (max-width: 900px) {
    .manuale-toc { position: static; max-height: none; }
    .manuale-toc-mobile {
      display: block; width: 100%; padding: 0.6rem 0.75rem; border: 1px solid hsl(var(--border));
      border-radius: 0.5rem; background: #fff; font-size: 14px; margin-bottom: 1rem;
    }
    .manuale-toc-desktop { display: none; }
  }

  .manuale-print {
    background: #fff; border: 1px solid hsl(var(--border)); border-radius: 0.5rem;
    padding: 2.5rem 2.75rem; max-width: 880px;
    font-family: 'Source Serif Pro', Georgia, 'Times New Roman', serif;
    font-size: 15.5px; line-height: 1.7; color: #1A2342;
    box-shadow: 0 1px 2px 0 rgb(0 0 0 / 0.04);
  }
  .manuale-print h1, .manuale-print h2, .manuale-print h3, .manuale-print h4 {
    font-family: 'Roboto', ui-sans-serif, system-ui, sans-serif;
    color: #152560; line-height: 1.25; font-weight: 700; letter-spacing: -0.01em;
  }
  .manuale-print h1 { font-size: 2.1rem; margin: 0 0 1.5rem; padding-bottom: 0.75rem; border-bottom: 2px solid #4169E1; }
  .manuale-print h2 { font-size: 1.6rem; margin: 2.5rem 0 1rem; padding-bottom: 0.4rem; border-bottom: 1px solid #DAE2FF; }
  .manuale-print h3 { font-size: 1.25rem; margin: 2rem 0 0.8rem; color: #2843A0; }
  .manuale-print h4 { font-size: 1.05rem; margin: 1.5rem 0 0.6rem; color: #2E3554; }
  .manuale-print p { margin: 0 0 1rem; }
  .manuale-print ul, .manuale-print ol { margin: 0 0 1rem 1.5rem; padding: 0; }
  .manuale-print li { margin: 0.25rem 0; }
  .manuale-print a { color: #1268A6; text-decoration: underline; text-underline-offset: 2px; }
  .manuale-print a:hover { color: #2843A0; }
  .manuale-print img { max-width: 100%; height: auto; border: 1px solid hsl(var(--border)); border-radius: 0.4rem; margin: 1rem 0; display: block; }
  .manuale-print blockquote {
    margin: 1.25rem 0; padding: 0.75rem 1.25rem; border-left: 4px solid #F5A623;
    background: #FFF7E0; color: #1A2342; border-radius: 0 0.4rem 0.4rem 0; font-style: italic;
  }
  .manuale-print blockquote p:last-child { margin-bottom: 0; }
  .manuale-print code {
    font-family: 'Roboto Mono', ui-monospace, monospace; font-size: 0.88em;
    background: #F2F4F8; color: #2843A0; padding: 0.12em 0.4em; border-radius: 0.25rem;
    border: 1px solid #DAE2FF;
  }
  .manuale-print pre {
    margin: 1rem 0; padding: 1rem 1.25rem; background: #0F172A; color: #E2E8F0;
    border-radius: 0.5rem; overflow-x: auto; font-size: 13.5px; line-height: 1.55;
  }
  .manuale-print pre code { background: transparent; color: inherit; border: 0; padding: 0; font-size: inherit; }
  .manuale-print table {
    border-collapse: collapse; width: 100%; margin: 1.25rem 0; font-size: 14.5px;
    font-family: 'Roboto', ui-sans-serif, system-ui, sans-serif;
  }
  .manuale-print th, .manuale-print td {
    border: 1px solid #DAE2FF; padding: 0.55rem 0.8rem; text-align: left; vertical-align: top;
  }
  .manuale-print th { background: #EFF3FF; color: #152560; font-weight: 700; }
  .manuale-print tr:nth-child(even) td { background: #FAFBFF; }
  .manuale-print hr { border: 0; border-top: 1px dashed #B5C5FF; margin: 2rem 0; }

  .manuale-toolbar {
    display: flex; flex-wrap: wrap; gap: 0.5rem; align-items: center;
    background: #fff; border: 1px solid hsl(var(--border)); border-radius: 0.5rem;
    padding: 0.75rem 1rem; margin-bottom: 1rem;
  }
  .manuale-toolbar .grow { flex: 1; }

  @media print {
    @page { size: A4; margin: 2cm; }
    body * { visibility: hidden; }
    .manuale-print, .manuale-print * { visibility: visible; }
    .manuale-print { position: absolute; left: 0; top: 0; width: 100%;
      border: 0; box-shadow: none; padding: 0; max-width: none; background: #fff;
      font-size: 11pt; line-height: 1.5; color: #000;
    }
    .manuale-no-print { display: none !important; }
    .manuale-print h1 { font-size: 22pt; border-bottom-color: #000; }
    .manuale-print h2 { font-size: 16pt; page-break-before: always; border-bottom-color: #888; }
    .manuale-print h2:first-of-type { page-break-before: avoid; }
    .manuale-print h3 { font-size: 13pt; color: #000; }
    .manuale-print h4 { font-size: 11.5pt; color: #000; }
    .manuale-print a { color: #000; text-decoration: underline; }
    .manuale-print img { max-width: 100%; page-break-inside: avoid; border: 1px solid #ccc; }
    .manuale-print pre, .manuale-print blockquote, .manuale-print table { page-break-inside: avoid; }
    .manuale-print pre { background: #f5f5f5; color: #000; border: 1px solid #ccc; }
    .manuale-print code { background: #f0f0f0; color: #000; border: 1px solid #ddd; }
    .manuale-print blockquote { background: #fafafa; border-left: 4px solid #666; color: #000; }
    .manuale-print th { background: #eee; color: #000; }
  }
`;

// Slugify per id stabili degli heading (per ancore TOC).
function slugify(s) {
  return String(s || '')
    .toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '')
    .slice(0, 80) || 'sec';
}

// Garantisce id unici se due heading hanno lo stesso testo.
function uniqueId(base, used) {
  let id = base, i = 2;
  while (used.has(id)) { id = `${base}-${i++}`; }
  used.add(id);
  return id;
}

// Fallback minimo se `marked` non è caricato (CSP / offline).
function rawFallback(md) {
  return `<pre class="text-xs whitespace-pre-wrap">${escapeHtml(md)}</pre>`;
}

export async function renderManuale(root) {
  root.innerHTML = `
    <section class="view-fade c-page">
      <style>${MANUALE_STYLES}</style>
      <header class="c-page-header manuale-no-print">
        <p class="c-page-header__eyebrow">${escapeHtml(t('admin.manuale.eyebrow'))}</p>
        <h1 class="c-page-header__title">${escapeHtml(t('admin.manuale.title'))}</h1>
        <p class="c-page-header__sub">${escapeHtml(t('admin.manuale.subtitle'))}</p>
      </header>

      <div class="manuale-wrap">
        <aside class="manuale-toc-desktop">
          <div class="manuale-toc manuale-no-print" id="manuale-toc">
            <h4>${escapeHtml(t('admin.manuale.toc'))}</h4>
            <ul><li><span class="text-ink-500">${escapeHtml(t('admin.manuale.loading'))}</span></li></ul>
          </div>
        </aside>

        <div>
          <select class="manuale-toc-mobile manuale-no-print" id="manuale-toc-mobile" aria-label="${escapeHtml(t('admin.manuale.toc'))}">
            <option value="">${escapeHtml(t('admin.manuale.toc.mobile'))}</option>
          </select>

          <div class="manuale-toolbar manuale-no-print" role="toolbar">
            <button type="button" id="btn-print" class="c-btn c-btn--primary c-btn--sm inline-flex items-center gap-2">
              ${icon('printer', { size: 14 })} <span>${escapeHtml(t('admin.manuale.print'))}</span>
            </button>
            <button type="button" id="btn-reload" class="c-btn c-btn--outline c-btn--sm inline-flex items-center gap-2">
              ${icon('refresh', { size: 14 })} <span>${escapeHtml(t('admin.manuale.reload'))}</span>
            </button>
            <span class="grow"></span>
            <a id="btn-raw" href="${MANUALE_URL}" target="_blank" rel="noopener" class="c-btn c-btn--ghost c-btn--sm inline-flex items-center gap-2">
              ${icon('externalLink', { size: 14 })} <span>${escapeHtml(t('admin.manuale.open_raw'))}</span>
            </a>
          </div>

          <article class="manuale-print" id="manuale-content" lang="${escapeHtml(document.documentElement.lang || 'it')}">
            <p class="text-ink-500 text-sm">${escapeHtml(t('admin.manuale.loading'))}</p>
          </article>
        </div>
      </div>
    </section>
  `;

  root.querySelector('#btn-print')?.addEventListener('click', () => window.print());
  root.querySelector('#btn-reload')?.addEventListener('click', () => renderManuale(root));

  await loadAndRender(root);
}

async function loadAndRender(root) {
  const article = root.querySelector('#manuale-content');
  const tocEl = root.querySelector('#manuale-toc');
  const tocMobile = root.querySelector('#manuale-toc-mobile');
  if (!article) return;

  let md;
  try {
    const res = await fetch(MANUALE_URL, { cache: 'no-cache' });
    if (res.status === 404) {
      renderEmpty(article, tocEl, tocMobile);
      return;
    }
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    md = await res.text();
    if (!md.trim()) {
      renderEmpty(article, tocEl, tocMobile);
      return;
    }
  } catch (err) {
    renderError(article, tocEl, tocMobile, err);
    return;
  }

  // Renderizza il markdown. Se `marked` non è disponibile facciamo fallback <pre>.
  let html;
  const marked = window.marked;
  if (marked && typeof marked.parse === 'function') {
    try {
      // Configurazione: breaks=true per soft line-breaks, gfm=true per table/strikethrough/etc.
      if (typeof marked.setOptions === 'function') {
        marked.setOptions({ breaks: true, gfm: true, headerIds: false, mangle: false });
      }
      html = marked.parse(md);
    } catch (e) {
      console.warn('[manuale] marked.parse failed, falling back to raw:', e);
      html = rawFallback(md);
    }
  } else {
    console.warn('[manuale] marked non caricato — fallback raw');
    html = rawFallback(md);
  }

  article.innerHTML = html;

  // Riscrittura src delle immagini relative agli screenshots: nel MD sono `./screenshots/x.png`
  // ma rispetto alla root dell'app vivono in `./docs/screenshots/x.png`.
  article.querySelectorAll(`img[src^="${SCREENSHOTS_PREFIX_FROM}"]`).forEach(img => {
    const src = img.getAttribute('src');
    img.setAttribute('src', src.replace(SCREENSHOTS_PREFIX_FROM, SCREENSHOTS_PREFIX_TO));
    img.setAttribute('loading', 'lazy');
  });

  // Anche gli href relativi a `./screenshots/` (eventuali) vanno corretti.
  article.querySelectorAll(`a[href^="${SCREENSHOTS_PREFIX_FROM}"]`).forEach(a => {
    const href = a.getAttribute('href');
    a.setAttribute('href', href.replace(SCREENSHOTS_PREFIX_FROM, SCREENSHOTS_PREFIX_TO));
    a.setAttribute('target', '_blank');
    a.setAttribute('rel', 'noopener');
  });

  // Costruisci TOC da h2/h3.
  buildToc(article, tocEl, tocMobile);
}

function buildToc(article, tocEl, tocMobile) {
  const headings = article.querySelectorAll('h2, h3');
  if (!headings.length) {
    if (tocEl) tocEl.innerHTML = `<h4>${escapeHtml(t('admin.manuale.toc'))}</h4><p class="text-ink-500 text-xs">${escapeHtml(t('admin.manuale.toc.empty'))}</p>`;
    if (tocMobile) tocMobile.innerHTML = `<option value="">${escapeHtml(t('admin.manuale.toc.mobile'))}</option>`;
    return;
  }

  const used = new Set();
  const items = [];
  headings.forEach(h => {
    const base = slugify(h.textContent);
    const id = uniqueId(base, used);
    h.id = id;
    items.push({ id, text: h.textContent.trim(), level: h.tagName === 'H2' ? 2 : 3 });
  });

  if (tocEl) {
    tocEl.innerHTML = `
      <h4>${escapeHtml(t('admin.manuale.toc'))}</h4>
      <ul>
        ${items.map(it => `
          <li>
            <a href="#${escapeHtml(it.id)}" data-toc-link="${escapeHtml(it.id)}" class="${it.level === 3 ? 'level-3' : ''}">${escapeHtml(it.text)}</a>
          </li>
        `).join('')}
      </ul>
    `;
    // Intercettiamo i click per evitare che il browser provi a navigare via hashchange
    // (la nostra app interpreta gli hash come rotte). Usiamo scrollIntoView nativo.
    tocEl.querySelectorAll('[data-toc-link]').forEach(a => {
      a.addEventListener('click', (e) => {
        e.preventDefault();
        const target = document.getElementById(a.dataset.tocLink);
        if (target) target.scrollIntoView({ behavior: 'smooth', block: 'start' });
      });
    });
  }

  if (tocMobile) {
    tocMobile.innerHTML = [
      `<option value="">${escapeHtml(t('admin.manuale.toc.mobile'))}</option>`,
      ...items.map(it => `<option value="${escapeHtml(it.id)}">${it.level === 3 ? '  ' : ''}${escapeHtml(it.text)}</option>`),
    ].join('');
    tocMobile.addEventListener('change', () => {
      const id = tocMobile.value;
      if (!id) return;
      const target = document.getElementById(id);
      if (target) target.scrollIntoView({ behavior: 'smooth', block: 'start' });
      tocMobile.value = '';
    });
  }

  // Active-link highlight tramite IntersectionObserver (solo TOC desktop).
  if (tocEl && 'IntersectionObserver' in window) {
    const linksById = new Map();
    tocEl.querySelectorAll('[data-toc-link]').forEach(a => linksById.set(a.dataset.tocLink, a));
    const io = new IntersectionObserver((entries) => {
      entries.forEach(en => {
        const link = linksById.get(en.target.id);
        if (!link) return;
        if (en.isIntersecting) {
          linksById.forEach(l => l.classList.remove('is-active'));
          link.classList.add('is-active');
        }
      });
    }, { rootMargin: '-20% 0px -70% 0px', threshold: 0 });
    headings.forEach(h => io.observe(h));
  }
}

function renderEmpty(article, tocEl, tocMobile) {
  article.innerHTML = `
    <div class="text-center py-10">
      <div class="inline-flex items-center justify-center w-14 h-14 mb-3 rounded-full bg-brand-50 text-brand-600">
        ${icon('book', { size: 28 })}
      </div>
      <h2 class="text-xl font-bold text-ink-900">${escapeHtml(t('admin.manuale.empty.title'))}</h2>
      <p class="text-sm text-ink-700 mt-2 max-w-md mx-auto">${t('admin.manuale.empty.desc')}</p>
    </div>
  `;
  if (tocEl) tocEl.innerHTML = `<h4>${escapeHtml(t('admin.manuale.toc'))}</h4><p class="text-ink-500 text-xs">${escapeHtml(t('admin.manuale.toc.empty'))}</p>`;
  if (tocMobile) tocMobile.innerHTML = `<option value="">${escapeHtml(t('admin.manuale.toc.mobile'))}</option>`;
}

function renderError(article, tocEl, tocMobile, err) {
  article.innerHTML = `
    <div class="bg-rose-50 border border-rose-200 rounded-xl p-5">
      <p class="font-mono text-[11px] uppercase tracking-[0.12em] text-rose-700 font-bold">${escapeHtml(t('admin.manuale.error.title'))}</p>
      <p class="text-sm text-rose-900 mt-2">${escapeHtml(err?.message || String(err))}</p>
      <p class="text-xs text-rose-700 mt-3">${escapeHtml(t('admin.manuale.error.path'))}: <code>${escapeHtml(MANUALE_URL)}</code></p>
    </div>
  `;
  if (tocEl) tocEl.innerHTML = `<h4>${escapeHtml(t('admin.manuale.toc'))}</h4><p class="text-ink-500 text-xs">${escapeHtml(t('admin.manuale.toc.empty'))}</p>`;
  if (tocMobile) tocMobile.innerHTML = `<option value="">${escapeHtml(t('admin.manuale.toc.mobile'))}</option>`;
}
