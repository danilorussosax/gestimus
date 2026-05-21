import { db } from '../db.js';
import { t } from '../i18n.js';
import { icon } from '../icons.js';
import { escapeHtml, toast, readFileAsDataURL } from '../utils.js';

export function renderImpostazioni(root) {
  const ente = db.getEnte();

  root.innerHTML = `
    <section class="view-fade c-page max-w-3xl mx-auto">
      <header class="c-page-header">
        <p class="c-page-header__eyebrow">${escapeHtml(t('admin.settings.eyebrow'))}</p>
        <h1 class="c-page-header__title">${escapeHtml(t('admin.settings.title'))}</h1>
        <p class="c-page-header__sub">${escapeHtml(t('admin.settings.subtitle'))}</p>
      </header>

      <div class="c-page">
        <form id="ente-form" class="space-y-6">
          <!-- Logo -->
          <div class="bg-white border border-brand-100 rounded-2xl p-5">
            <p class="font-mono text-[10px] uppercase tracking-[0.14em] text-ink-700 font-medium mb-3">${escapeHtml(t('admin.settings.logo'))}</p>
            <div class="flex items-start gap-4">
              <div class="w-20 h-20 rounded-xl bg-slate-50 border border-brand-100 flex items-center justify-center overflow-hidden shrink-0">
                ${ente?.logo_url
                  ? `<img id="ente-logo-preview" src="${ente.logo_url}" alt="" class="w-full h-full object-contain" />`
                  : `<div id="ente-logo-preview" class="text-3xl text-slate-400">${icon('building', { size: 32 })}</div>`}
              </div>
              <div class="flex-1">
                <label class="c-btn c-btn--outline c-btn--sm cursor-pointer">
                  <span>${escapeHtml(t('admin.settings.choose_logo'))}</span>
                  <input type="file" name="logo" accept="image/png,image/jpeg,image/webp,image/svg+xml" class="hidden" />
                </label>
                <p class="text-xs text-ink-700 mt-1">${escapeHtml(t('admin.settings.logo_hint'))}</p>
              </div>
            </div>
          </div>

          <!-- Nome e descrizione -->
          <div class="bg-white border border-brand-100 rounded-2xl p-5 space-y-4">
            <label class="c-field">
              <span class="c-field__label">${escapeHtml(t('admin.settings.name'))} *</span>
              <input name="nome" type="text" required class="c-input" value="${escapeHtml(ente?.nome || '')}" placeholder="${escapeHtml(t('admin.settings.name_placeholder'))}" />
            </label>
            <label class="c-field">
              <span class="c-field__label">${escapeHtml(t('admin.settings.description'))}</span>
              <textarea name="descrizione" rows="3" class="c-input" placeholder="${escapeHtml(t('admin.settings.description_placeholder'))}">${escapeHtml(ente?.descrizione || '')}</textarea>
            </label>
          </div>

          <!-- Contatti -->
          <div class="bg-white border border-brand-100 rounded-2xl p-5 space-y-4">
            <p class="font-mono text-[10px] uppercase tracking-[0.14em] text-ink-700 font-medium">${escapeHtml(t('admin.settings.contacts'))}</p>
            <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <label class="c-field">
                <span class="c-field__label">${escapeHtml(t('admin.settings.email'))}</span>
                <input name="email_contatto" type="email" class="c-input" value="${escapeHtml(ente?.email_contatto || '')}" />
              </label>
              <label class="c-field">
                <span class="c-field__label">${escapeHtml(t('admin.settings.phone'))}</span>
                <input name="telefono" type="text" class="c-input" value="${escapeHtml(ente?.telefono || '')}" />
              </label>
            </div>
            <label class="c-field">
              <span class="c-field__label">${escapeHtml(t('admin.settings.website'))}</span>
              <input name="sito_web" type="url" class="c-input" value="${escapeHtml(ente?.sito_web || '')}" placeholder="https://..." />
            </label>
            <label class="c-field">
              <span class="c-field__label">${escapeHtml(t('admin.settings.address'))}</span>
              <input name="indirizzo" type="text" class="c-input" value="${escapeHtml(ente?.indirizzo || '')}" />
            </label>
          </div>

          <!-- Colori -->
          <div class="bg-white border border-brand-100 rounded-2xl p-5 space-y-4">
            <p class="font-mono text-[10px] uppercase tracking-[0.14em] text-ink-700 font-medium">${escapeHtml(t('admin.settings.branding'))}</p>
            <div class="grid grid-cols-2 gap-4">
              <label class="c-field">
                <span class="c-field__label">${escapeHtml(t('admin.settings.primary_color'))}</span>
                <div class="flex items-center gap-2">
                  <input name="colore_primario" type="color" class="w-10 h-10 rounded-lg border border-brand-200 cursor-pointer" value="${ente?.colore_primario || '#4169E1'}" />
                  <input name="colore_primario_text" type="text" class="c-input flex-1" value="${ente?.colore_primario || '#4169E1'}" maxlength="7" />
                </div>
              </label>
              <label class="c-field">
                <span class="c-field__label">${escapeHtml(t('admin.settings.secondary_color'))}</span>
                <div class="flex items-center gap-2">
                  <input name="colore_secondario" type="color" class="w-10 h-10 rounded-lg border border-brand-200 cursor-pointer" value="${ente?.colore_secondario || '#F5A623'}" />
                  <input name="colore_secondario_text" type="text" class="c-input flex-1" value="${ente?.colore_secondario || '#F5A623'}" maxlength="7" />
                </div>
              </label>
            </div>
          </div>

          <!-- Save -->
          <div class="flex justify-end gap-3">
            <button type="submit" class="c-btn c-btn--primary">
              <span>${escapeHtml(t('common.save'))}</span>
              <span class="c-btn__icon" aria-hidden="true">${icon('check', { size: 16 })}</span>
            </button>
          </div>
        </form>
      </div>
    </section>
  `;

  const form = root.querySelector('#ente-form');
  let logoFile = null;

  // Sync color picker <-> text input
  const cp1 = form.querySelector('[name="colore_primario"]');
  const ct1 = form.querySelector('[name="colore_primario_text"]');
  const cp2 = form.querySelector('[name="colore_secondario"]');
  const ct2 = form.querySelector('[name="colore_secondario_text"]');
  cp1.addEventListener('input', () => { ct1.value = cp1.value; });
  ct1.addEventListener('input', () => { if (/^#[0-9a-f]{6}$/i.test(ct1.value)) cp1.value = ct1.value; });
  cp2.addEventListener('input', () => { ct2.value = cp2.value; });
  ct2.addEventListener('input', () => { if (/^#[0-9a-f]{6}$/i.test(ct2.value)) cp2.value = ct2.value; });

  // Logo preview
  form.querySelector('[name="logo"]').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    try {
      const url = await readFileAsDataURL(file);
      const preview = root.querySelector('#ente-logo-preview');
      if (preview.tagName === 'IMG') {
        preview.src = url;
      } else {
        const img = document.createElement('img');
        img.id = 'ente-logo-preview';
        img.src = url;
        img.alt = '';
        img.className = 'w-full h-full object-contain';
        preview.replaceWith(img);
      }
      logoFile = file;
    } catch (err) {
      toast(t('admin.settings.logo_error'), 'error');
    }
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const formData = new FormData(e.target);
    const patch = {
      nome: formData.get('nome').trim(),
      descrizione: formData.get('descrizione').trim(),
      email_contatto: formData.get('email_contatto').trim(),
      telefono: formData.get('telefono').trim(),
      sito_web: formData.get('sito_web').trim(),
      indirizzo: formData.get('indirizzo').trim(),
      colore_primario: formData.get('colore_primario'),
      colore_secondario: formData.get('colore_secondario'),
    };
    if (logoFile) {
      patch.logo = logoFile;
    }
    try {
      await db.saveEnte(patch);
      toast(t('admin.settings.saved'), 'success');
    } catch (err) {
      toast(err.message, 'error');
    }
  });
}