// Form pubblico di iscrizione auto-service — pagina UNICA, no wizard.
// Tutte le sezioni (anagrafica, contatti, dati artistici, programma, allegati,
// privacy) sono visibili contemporaneamente. Validazione e submit alla fine.
// Draft persistito in localStorage finché non si invia (save & resume).

import { db } from '../db.js';
import { pb } from '../pb.js';
import { escapeHtml, toast, readImageResized, readFileAsDataURL, NATIONALITIES } from '../utils.js';
import { icon } from '../icons.js';
import { t } from '../i18n.js';
import { gdprBadgeFull } from './privacy.js';

const DRAFT_KEY = 'iscrizione_draft_v2';

function loadDraft() {
  try { return JSON.parse(localStorage.getItem(DRAFT_KEY) || '{}'); } catch { return {}; }
}
function saveDraft(d) {
  try { localStorage.setItem(DRAFT_KEY, JSON.stringify(d)); } catch {}
}
function clearDraft() {
  try { localStorage.removeItem(DRAFT_KEY); } catch {}
}

function calcEta(iso) {
  if (!iso) return null;
  // R15: età in anni compiuti per componenti di calendario, non con la divisione
  // naive per 365.25 giorni (che sbaglia di un giorno a cavallo del compleanno).
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso));
  if (!m) return null;
  const by = +m[1], bm = +m[2], bd = +m[3];
  const now = new Date();
  let age = now.getFullYear() - by;
  const mo = now.getMonth() + 1;
  const day = now.getDate();
  if (mo < bm || (mo === bm && day < bd)) age -= 1;
  return age;
}

export async function renderIscrizione(root) {
  // Sub-route: conferma email tramite token (link dalla mail di verifica).
  if (location.hash.startsWith('#/iscrizione/conferma')) {
    return renderConferma(root);
  }

  const state = {
    concorso: null,
    sezioni: [],
    categorie: [],
    draft: loadDraft(),
    submitting: false,
  };

  root.innerHTML = `
    <section class="view-fade min-h-[60vh] flex items-center justify-center c-page">
      <div class="text-center">
        <div class="inline-flex items-center justify-center w-12 h-12 mb-4 text-brand-500" style="animation:spin 1.4s linear infinite">${icon('refresh', { size: 32 })}</div>
        <p class="text-ink-900 font-medium">${escapeHtml(t('iscr.loading'))}</p>
      </div>
    </section>`;

  try { state.concorso = await db.fetchConcorsoIscrizioniAperto(); }
  catch (e) { console.error('fetchConcorsoIscrizioniAperto:', e); }

  if (!state.concorso) return renderClosed(root);

  // Sezioni e categorie sono incluse nel payload pubblico del concorso aperto.
  state.sezioni = state.concorso.sezioni || [];
  state.categorie = state.concorso.categorie || [];

  renderForm(root, state);
}

async function renderConferma(root) {
  const q = new URLSearchParams(location.hash.split('?')[1] || '');
  const token = q.get('t') || '';
  root.innerHTML = `<section class="view-fade min-h-[40vh] flex items-center justify-center c-page"><p class="text-slate-600">Verifica in corso…</p></section>`;
  let data = null, error = null;
  try {
    const res = await db.verifyIscrizioneEmail(token);
    data = res?.iscrizione || res;
  } catch (e) {
    error = e?.message || 'rete';
  }
  root.innerHTML = `
    <section class="view-fade c-page max-w-xl mx-auto py-10">
      <div class="bg-white border ${error ? 'border-rose-200' : 'border-emerald-200'} rounded-3xl shadow-soft p-8 text-center">
        ${error ? `
          <div class="text-5xl mb-3">⚠</div>
          <h1 class="text-xl font-bold text-rose-900 mb-2">Impossibile verificare l'email</h1>
          <p class="text-sm text-slate-700">${error === 'not_found' ? 'Link non valido o già usato.' : escapeHtml(error)}</p>
        ` : `
          <div class="text-5xl mb-3">✅</div>
          <h1 class="text-xl font-bold text-emerald-900 mb-2">Email verificata</h1>
          <p class="text-sm text-slate-700">Grazie ${escapeHtml(data?.nome || '')} ${escapeHtml(data?.cognome || '')}! L'iscrizione è in attesa di revisione.</p>
        `}
        <a href="#/" class="c-btn c-btn--outline c-btn--sm mt-6">Chiudi</a>
      </div>
    </section>`;
}

function renderClosed(root) {
  root.innerHTML = `
    <section class="view-fade min-h-[60vh] flex items-center justify-center c-page">
      <div class="bg-white rounded-3xl shadow-soft border border-slate-200 max-w-xl w-full p-10 text-center">
        <div class="text-5xl mb-4">📭</div>
        <h1 class="text-2xl font-bold text-ink-900 mb-2">${escapeHtml(t('iscr.closed.title'))}</h1>
        <p class="text-slate-600 leading-relaxed">${escapeHtml(t('iscr.closed.subtitle'))}</p>
        <a href="#/" class="c-btn c-btn--outline c-btn--sm mt-6">${escapeHtml(t('iscr.closed.cta'))}</a>
      </div>
    </section>`;
}

// ============================================================================
// Render UNICA pagina con tutte le sezioni
// ============================================================================
function renderForm(root, state) {
  const { concorso, draft: d } = state;

  root.innerHTML = `
    <section class="view-fade c-page max-w-3xl mx-auto pb-10">
      <!-- Header concorso -->
      <header class="bg-white border border-slate-200 rounded-3xl shadow-soft p-5 mb-6 flex items-start gap-4">
        ${concorso.logo_url ? `<img src="${escapeHtml(concorso.logo_url)}" alt="" class="w-16 h-16 rounded-2xl object-contain border border-slate-100 shrink-0" />` : `<div class="w-16 h-16 rounded-2xl bg-brand-50 text-brand-700 flex items-center justify-center text-2xl shrink-0">🎼</div>`}
        <div class="min-w-0 flex-1">
          <p class="font-mono text-[11px] uppercase tracking-[0.16em] text-brand-700 font-bold">${escapeHtml(t('iscr.header.eyebrow'))}</p>
          <h1 class="text-2xl font-black text-ink-900 leading-tight truncate">${escapeHtml(concorso.nome)}</h1>
          <p class="text-sm text-slate-600 mt-1">${escapeHtml(t('iscr.header.edition', { anno: concorso.anno }))}${concorso.data_inizio ? ` · ${escapeHtml(concorso.data_inizio)}` : ''}</p>
          ${concorso.iscrizioni_chiusura ? `<p class="text-xs text-amber-700 mt-1">${escapeHtml(t('iscr.header.deadline', { date: new Date(concorso.iscrizioni_chiusura).toLocaleString() }))}</p>` : ''}
        </div>
        <a href="#/privacy" target="_blank" class="hidden sm:block shrink-0" title="Informativa privacy (Regolamento UE 2016/679)">
          ${gdprBadgeFull()}
        </a>
      </header>

      <!-- Notice GDPR + link informativa (visibile anche su mobile) -->
      <div class="sm:hidden bg-emerald-50 border border-emerald-200 rounded-2xl p-3 mb-4 flex items-center gap-3">
        ${gdprBadgeFull()}
        <p class="text-xs text-emerald-900 leading-snug flex-1">${t('iscr.gdpr.note')}</p>
      </div>

      <form id="frm-iscrizione" class="space-y-6" autocomplete="off">

        <!-- Anti-bot: honeypot invisibile per utenti reali (non per bot che riempiono tutti i campi).
             aria-hidden + tabindex=-1 + posizionamento off-screen via inline style. -->
        <div aria-hidden="true" style="position:absolute;left:-10000px;top:auto;width:1px;height:1px;overflow:hidden;">
          <label>Lascia vuoto questo campo
            <input type="text" name="website" tabindex="-1" autocomplete="off" />
          </label>
        </div>
        <input type="hidden" name="startedAt" value="${Date.now()}" />

        ${sectionHeader('1', t('iscr.section.1.title'), t('iscr.section.1.subtitle'))}
        <div class="bg-white border border-slate-200 rounded-3xl shadow-soft p-6" data-sec="anagrafica">
          ${anagraficaFields(d)}
          <div data-tutore-host class="${calcEta(d.data_nascita) !== null && calcEta(d.data_nascita) < 18 ? '' : 'hidden'} mt-5">
            ${tutoreFields(d)}
          </div>
        </div>

        ${sectionHeader('2', t('iscr.section.2.title'), t('iscr.section.2.subtitle'))}
        <div class="bg-white border border-slate-200 rounded-3xl shadow-soft p-6">
          ${contattiFields(d)}
        </div>

        ${sectionHeader('3', t('iscr.section.3.title'), t('iscr.section.3.subtitle'))}
        <div class="bg-white border border-slate-200 rounded-3xl shadow-soft p-6">
          ${artisticiFields(d, state)}
        </div>

        ${(d.tipo === 'gruppo' || d.tipo === 'orchestra') ? `
          <div data-gruppo-host>
            ${sectionHeader('3b', gruppoSectionTitle(d.tipo), gruppoSectionSubtitle(d.tipo))}
            <div class="bg-white border border-brand-200 rounded-3xl shadow-soft p-6">
              ${gruppoFields(d)}
            </div>
          </div>
        ` : ''}

        ${sectionHeader('4', t('iscr.section.4.title'), t('iscr.section.4.subtitle'))}
        <div class="bg-white border border-slate-200 rounded-3xl shadow-soft p-6">
          ${programmaFields(d)}
        </div>

        ${sectionHeader('5', t('iscr.section.5.title'), t('iscr.section.5.subtitle'))}
        <div class="bg-white border border-slate-200 rounded-3xl shadow-soft p-6">
          ${allegatiFields(d)}
        </div>

        ${sectionHeader('6', t('iscr.section.6.title'), t('iscr.section.6.subtitle'))}
        <div class="bg-white border border-slate-200 rounded-3xl shadow-soft p-6">
          ${consensiFields(d)}
        </div>

        <!-- Submit + status -->
        <div class="sticky bottom-0 bg-gradient-to-t from-white via-white to-transparent pt-4 pb-2 -mx-2 px-2">
          <button type="submit" class="c-btn c-btn--primary c-btn--xl w-full justify-center" data-submit ${state.submitting ? 'disabled' : ''}>
            <span>${state.submitting ? escapeHtml(t('iscr.submit.loading')) : escapeHtml(t('iscr.submit'))}</span>
            <span class="c-btn__icon" aria-hidden="true">${icon('arrowRight', { size: 16 })}</span>
          </button>
          <p class="text-[11px] text-center text-slate-500 mt-2">${escapeHtml(t('iscr.submit.tip'))}</p>
        </div>
      </form>
    </section>
  `;

  const form = root.querySelector('#frm-iscrizione');
  bindAll(root, form, state);
}

function sectionHeader(num, title, subtitle) {
  return `
    <header class="flex items-center gap-3 mb-1">
      <span class="w-7 h-7 rounded-full bg-brand-100 text-brand-700 text-sm font-bold inline-flex items-center justify-center shrink-0">${num}</span>
      <div>
        <h2 class="font-semibold text-ink-900">${escapeHtml(title)}</h2>
        <p class="text-xs text-slate-600">${escapeHtml(subtitle)}</p>
      </div>
    </header>
  `;
}

// ---------- Sezione 1: Anagrafica ----------
function anagraficaFields(d) {
  return `
    <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
      <label class="c-field"><span class="c-field__label">Tipo iscrizione *</span>
        <select name="tipo" class="c-input">
          <option value="individuale" ${(d.tipo !== 'gruppo' && d.tipo !== 'orchestra') ? 'selected' : ''}>Individuale</option>
          <option value="gruppo" ${d.tipo === 'gruppo' ? 'selected' : ''}>Gruppo / Ensemble</option>
          <option value="orchestra" ${d.tipo === 'orchestra' ? 'selected' : ''}>Orchestra</option>
        </select>
      </label>
      <label class="c-field"><span class="c-field__label">Sesso</span>
        <select name="sesso" class="c-input">
          <option value="">— Seleziona —</option>
          <option value="M" ${d.sesso === 'M' ? 'selected' : ''}>Maschio</option>
          <option value="F" ${d.sesso === 'F' ? 'selected' : ''}>Femmina</option>
          <option value="altro" ${d.sesso === 'altro' ? 'selected' : ''}>Altro / preferisco non specificare</option>
        </select>
      </label>
      <label class="c-field"><span class="c-field__label">Nome *</span><input name="nome" required class="c-input" value="${escapeHtml(d.nome || '')}" /></label>
      <label class="c-field"><span class="c-field__label">Cognome *</span><input name="cognome" required class="c-input" value="${escapeHtml(d.cognome || '')}" /></label>
      <label class="c-field"><span class="c-field__label">Data di nascita *</span><input name="data_nascita" type="date" required class="c-input" value="${escapeHtml(d.data_nascita || '')}" /></label>
      <label class="c-field"><span class="c-field__label">Luogo di nascita</span><input name="luogo_nascita" class="c-input" value="${escapeHtml(d.luogo_nascita || '')}" placeholder="Città (Provincia)" /></label>
      <label class="c-field"><span class="c-field__label">Nazionalità *</span>
        <input name="nazionalita" list="naz-list" required class="c-input" value="${escapeHtml(d.nazionalita || '')}" placeholder="es. Italiana" />
        <datalist id="naz-list">${NATIONALITIES.map(n => `<option value="${escapeHtml(n)}">`).join('')}</datalist>
      </label>
      <label class="c-field"><span class="c-field__label">Codice fiscale</span><input name="codice_fiscale" class="c-input font-mono uppercase" maxlength="16" value="${escapeHtml(d.codice_fiscale || '')}" placeholder="RSSMRA80A01H501U" /></label>
    </div>
  `;
}

function tutoreFields(d) {
  return `
    <div class="bg-amber-50 border border-amber-200 rounded-2xl p-4">
      <p class="font-bold text-amber-900 flex items-center gap-1.5">⚠ Candidato minorenne</p>
      <p class="text-xs text-amber-800 mt-1 mb-3">Inserisci i dati di un genitore/tutore (obbligatori).</p>
      <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <label class="c-field"><span class="c-field__label">Nome tutore *</span><input name="tutore_nome" class="c-input" value="${escapeHtml(d.tutore_nome || '')}" /></label>
        <label class="c-field"><span class="c-field__label">Cognome tutore *</span><input name="tutore_cognome" class="c-input" value="${escapeHtml(d.tutore_cognome || '')}" /></label>
        <label class="c-field"><span class="c-field__label">Email tutore *</span><input name="tutore_email" type="email" class="c-input" value="${escapeHtml(d.tutore_email || '')}" /></label>
        <label class="c-field"><span class="c-field__label">Telefono tutore</span><input name="tutore_telefono" type="tel" class="c-input" value="${escapeHtml(d.tutore_telefono || '')}" /></label>
      </div>
    </div>
  `;
}

// ---------- Sezione 2: Contatti ----------
function contattiFields(d) {
  return `
    <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
      <label class="c-field sm:col-span-2"><span class="c-field__label">Email *</span><input name="email" type="email" required class="c-input" value="${escapeHtml(d.email || '')}" placeholder="nome@esempio.it" /></label>
      <label class="c-field"><span class="c-field__label">Telefono</span><input name="telefono" type="tel" class="c-input" value="${escapeHtml(d.telefono || '')}" placeholder="+39 ..." /></label>
      <label class="c-field"><span class="c-field__label">CAP</span><input name="cap" class="c-input" value="${escapeHtml(d.cap || '')}" maxlength="10" /></label>
      <label class="c-field sm:col-span-2"><span class="c-field__label">Indirizzo</span><input name="indirizzo" class="c-input" value="${escapeHtml(d.indirizzo || '')}" placeholder="Via, civico" /></label>
      <label class="c-field"><span class="c-field__label">Città</span><input name="citta" class="c-input" value="${escapeHtml(d.citta || '')}" /></label>
      <label class="c-field"><span class="c-field__label">Provincia</span><input name="provincia" class="c-input" maxlength="3" value="${escapeHtml(d.provincia || '')}" placeholder="MI" /></label>
      <label class="c-field"><span class="c-field__label">Paese</span><input name="paese" class="c-input" value="${escapeHtml(d.paese || 'Italia')}" /></label>
    </div>
  `;
}

// ---------- Sezione 3: Dati artistici ----------
function artisticiFields(d, state) {
  const sezioneSel = d.sezione || '';
  // Il payload pubblico mappa le categorie con `sezione_id` (vedi db.js
  // fetchConcorsoIscrizioniAperto). Filtriamo su quel campo, non `c.sezione`.
  const categorieDellaSezione = state.categorie.filter(c => c.sezione_id === sezioneSel);
  const sezioneHaCategorie = sezioneSel && categorieDellaSezione.length > 0;
  return `
    <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
      <label class="c-field"><span class="c-field__label">Strumento *</span><input name="strumento" required class="c-input" value="${escapeHtml(d.strumento || '')}" placeholder="es. Pianoforte" /></label>
      <label class="c-field"><span class="c-field__label">Anni di studio</span><input name="anni_studio" type="number" min="0" max="80" class="c-input" value="${escapeHtml(d.anni_studio || '')}" /></label>
      ${state.sezioni.length > 0 ? `
        <label class="c-field"><span class="c-field__label">Sezione</span>
          <select name="sezione" class="c-input">
            <option value="">— Nessuna —</option>
            ${state.sezioni.map(s => `<option value="${escapeHtml(s.id)}" ${sezioneSel === s.id ? 'selected' : ''}>${escapeHtml(s.nome)}</option>`).join('')}
          </select>
        </label>
        <label class="c-field"><span class="c-field__label">Categoria${sezioneHaCategorie ? ' *' : ''}</span>
          <select name="categoria" class="c-input" ${categorieDellaSezione.length === 0 ? 'disabled' : ''} ${sezioneHaCategorie ? 'required' : ''}>
            <option value="">${categorieDellaSezione.length === 0 ? '— Seleziona prima una sezione —' : '— Scegli categoria —'}</option>
            ${categorieDellaSezione.map(c => `<option value="${escapeHtml(c.id)}" ${d.categoria === c.id ? 'selected' : ''}>${escapeHtml(c.nome)}</option>`).join('')}
          </select>
        </label>
      ` : ''}
      <label class="c-field sm:col-span-2"><span class="c-field__label">Scuola/Conservatorio di provenienza</span><input name="scuola_provenienza" class="c-input" value="${escapeHtml(d.scuola_provenienza || '')}" /></label>
      <label class="c-field sm:col-span-2"><span class="c-field__label">Docenti preparatori</span>
        <textarea name="docenti_preparatori_text" rows="3" class="c-input" placeholder="Un docente per riga (es. Mario Bianchi — Conservatorio di Milano)">${escapeHtml((d.docenti_preparatori || []).join('\n'))}</textarea>
      </label>
    </div>
  `;
}

// ---------- Sezione 3b: Gruppo / Orchestra ----------
function gruppoSectionTitle(tipo) {
  return tipo === 'orchestra' ? 'Composizione dell\'orchestra' : 'Composizione del gruppo';
}
function gruppoSectionSubtitle(tipo) {
  return tipo === 'orchestra' ? 'Nome dell\'orchestra e membri.' : 'Nome dell\'ensemble e membri.';
}

function gruppoFields(d) {
  const isOrch = d.tipo === 'orchestra';
  const labelNome = isOrch ? 'Nome dell\'orchestra' : 'Nome del gruppo / ensemble';
  const placeholderNome = isOrch ? 'es. Orchestra Giovanile di Milano' : 'es. Quartetto Brillante';
  return `
    <label class="c-field"><span class="c-field__label">${labelNome}</span><input name="gruppo_nome" class="c-input" value="${escapeHtml(d.gruppo_nome || '')}" placeholder="${placeholderNome}" /></label>
    <p class="text-xs text-slate-600 mt-3 mb-2">Membri (oltre al referente compilato sopra):</p>
    <div data-membri-list class="space-y-2">
      ${(d.gruppo_membri || []).map((m, i) => membroRowHtml(m, i)).join('')}
    </div>
    <button type="button" data-add-membro class="mt-2 text-xs font-medium text-brand-700 hover:text-brand-900">+ Aggiungi membro</button>
  `;
}

function membroRowHtml(m, i) {
  return `
    <div data-membro-row class="grid grid-cols-12 gap-2">
      <input name="m_nome" class="c-input col-span-3" placeholder="Nome" value="${escapeHtml(m?.nome || '')}" />
      <input name="m_cognome" class="c-input col-span-3" placeholder="Cognome" value="${escapeHtml(m?.cognome || '')}" />
      <input name="m_strumento" class="c-input col-span-4" placeholder="Strumento" value="${escapeHtml(m?.strumento || '')}" />
      <input name="m_data" type="date" class="c-input col-span-2 text-xs" value="${escapeHtml(m?.data_nascita || '')}" />
      <button type="button" data-remove-membro class="col-span-12 text-xs text-rose-600 hover:text-rose-800 self-start">− rimuovi</button>
    </div>
  `;
}

// ---------- Sezione 4: Programma ----------
function programmaFields(d) {
  const prog = Array.isArray(d.programma) && d.programma.length ? d.programma : [{ titolo: '', autore: '', durata_min: '' }];
  return `
    <div data-programma-list class="space-y-2">
      ${prog.map((p, i) => programmaRowHtml(p, i)).join('')}
    </div>
    <button type="button" data-add-brano class="mt-2 text-xs font-medium text-brand-700 hover:text-brand-900">+ Aggiungi brano</button>
    <label class="c-field mt-4"><span class="c-field__label">Note libere (opzionale)</span>
      <textarea name="note_libere" rows="2" class="c-input" placeholder="Qualsiasi informazione utile all'organizzazione">${escapeHtml(d.note_libere || '')}</textarea>
    </label>
  `;
}

function programmaRowHtml(p, i) {
  return `
    <div data-programma-row class="grid grid-cols-12 gap-2">
      <input name="p_titolo" class="c-input col-span-5" placeholder="Titolo brano" value="${escapeHtml(p?.titolo || '')}" />
      <input name="p_autore" class="c-input col-span-5" placeholder="Autore/Compositore" value="${escapeHtml(p?.autore || '')}" />
      <input name="p_durata" type="number" min="0" max="120" step="0.5" class="c-input col-span-2" placeholder="min" value="${escapeHtml(p?.durata_min || '')}" />
      <button type="button" data-remove-brano class="col-span-12 text-xs text-rose-600 hover:text-rose-800 self-start">− rimuovi</button>
    </div>
  `;
}

// ---------- Sezione 5: Allegati ----------
function allegatiFields(d) {
  const isMinor = calcEta(d.data_nascita) !== null && calcEta(d.data_nascita) < 18;
  return `
    <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
      ${fileFieldHtml('foto', '📷 Foto candidato', 'JPG/PNG/WebP, max 2 MB. Ridimensionata automaticamente.', d.foto)}
      ${fileFieldHtml('documento_identita', '📄 Documento d\'identità', 'PDF/JPG/PNG, max 2 MB.', d.documento_identita)}
      ${fileFieldHtml('ricevuta_pagamento', '💳 Ricevuta pagamento quota', 'PDF/JPG/PNG, max 2 MB.', d.ricevuta_pagamento)}
      <div data-auth-minor-host class="${isMinor ? '' : 'hidden'}">
        ${fileFieldHtml('autorizzazione_minore', '✍ Autorizzazione minore', 'Modulo firmato dal tutore. PDF/JPG/PNG, max 2 MB.', d.autorizzazione_minore)}
      </div>
    </div>
  `;
}

function fileFieldHtml(name, label, hint, current) {
  return `
    <div class="c-field">
      <span class="c-field__label">${escapeHtml(label)}</span>
      <input name="${escapeHtml(name)}" type="file" accept="${name === 'foto' ? 'image/*' : '.pdf,image/*'}" class="c-input" />
      <p class="text-[11px] text-slate-500 mt-1">${escapeHtml(hint)}</p>
      ${current?.name ? `<p class="text-[11px] text-emerald-700 mt-1">✓ ${escapeHtml(current.name)} selezionato</p>` : ''}
    </div>
  `;
}

// ---------- Sezione 6: Privacy ----------
function consensiFields(d) {
  return `
    <div class="space-y-3">
      <label class="flex items-start gap-3 text-sm text-ink-800">
        <input name="consenso_privacy" type="checkbox" class="mt-1 rounded border-slate-300" ${d.consenso_privacy ? 'checked' : ''} required />
        <span><strong>Privacy *</strong> — Acconsento al trattamento dei dati personali secondo l'<a href="#/privacy" target="_blank" class="text-brand-700 underline">informativa GDPR</a> per le finalità di gestione del concorso.</span>
      </label>
      <label class="flex items-start gap-3 text-sm text-ink-800">
        <input name="consenso_immagini" type="checkbox" class="mt-1 rounded border-slate-300" ${d.consenso_immagini ? 'checked' : ''} />
        <span>Autorizzo l'uso delle immagini (foto/video) realizzate durante il concorso per i materiali promozionali dell'ente.</span>
      </label>
      <label class="flex items-start gap-3 text-sm text-ink-800">
        <input name="consenso_regolamento" type="checkbox" class="mt-1 rounded border-slate-300" ${d.consenso_regolamento ? 'checked' : ''} required />
        <span><strong>Regolamento *</strong> — Dichiaro di aver letto e accettato il regolamento del concorso.</span>
      </label>
    </div>
  `;
}

// ============================================================================
// Binding handlers (live save draft + sub-controls)
// ============================================================================
function bindAll(root, form, state) {
  // Save draft a ogni input/change tranne file (gestiti a parte)
  form.addEventListener('input', (ev) => onFieldChange(ev, state, root));
  form.addEventListener('change', (ev) => onFieldChange(ev, state, root));

  // Aggiungi/rimuovi membri
  form.addEventListener('click', (ev) => {
    if (ev.target.closest('[data-add-membro]')) {
      state.draft.gruppo_membri = state.draft.gruppo_membri || [];
      state.draft.gruppo_membri.push({ nome: '', cognome: '', strumento: '', data_nascita: '' });
      renderForm(root, state);
      return;
    }
    const rmMembro = ev.target.closest('[data-remove-membro]');
    if (rmMembro) {
      const rows = Array.from(form.querySelectorAll('[data-membro-row]'));
      const idx = rows.indexOf(rmMembro.closest('[data-membro-row]'));
      if (idx >= 0) {
        state.draft.gruppo_membri = state.draft.gruppo_membri || [];
        state.draft.gruppo_membri.splice(idx, 1);
        renderForm(root, state);
      }
      return;
    }
    // Aggiungi/rimuovi brani
    if (ev.target.closest('[data-add-brano]')) {
      state.draft.programma = state.draft.programma || [];
      state.draft.programma.push({ titolo: '', autore: '', durata_min: '' });
      renderForm(root, state);
      return;
    }
    const rmBrano = ev.target.closest('[data-remove-brano]');
    if (rmBrano) {
      const rows = Array.from(form.querySelectorAll('[data-programma-row]'));
      const idx = rows.indexOf(rmBrano.closest('[data-programma-row]'));
      if (idx >= 0) {
        state.draft.programma = state.draft.programma || [];
        state.draft.programma.splice(idx, 1);
        renderForm(root, state);
      }
      return;
    }
  });

  // File inputs: leggi e mantieni in memoria
  form.querySelectorAll('input[type="file"]').forEach(inp => {
    inp.addEventListener('change', async () => {
      const file = inp.files[0];
      if (!file) return;
      if (file.size > 2 * 1024 * 1024) {
        toast(`Il file ${inp.name} supera i 2 MB`, 'error');
        inp.value = '';
        return;
      }
      try {
        let blob;
        if (inp.name === 'foto') {
          const dataURL = await readImageResized(file, 800, 0.85);
          blob = { name: file.name, type: file.type, dataURL };
        } else {
          const dataURL = await readFileAsDataURL(file);
          blob = { name: file.name, type: file.type, dataURL };
        }
        state.draft[inp.name] = blob;
        saveDraft(state.draft);
        toast(`${inp.name} caricato`, 'success');
      } catch (e) {
        toast(`Errore lettura ${inp.name}: ${e?.message || e}`, 'error');
      }
    });
  });

  // Submit
  form.addEventListener('submit', (ev) => {
    ev.preventDefault();
    submit(root, state);
  });
}

function onFieldChange(ev, state, root) {
  const el = ev.target;
  if (!el.name || el.type === 'file') return;
  const d = state.draft;

  if (el.type === 'checkbox') {
    d[el.name] = el.checked;
  } else if (el.name === 'docenti_preparatori_text') {
    d.docenti_preparatori = String(el.value || '').split('\n').map(s => s.trim()).filter(Boolean);
  } else {
    d[el.name] = el.value;
  }

  // Dipendenze visive: data_nascita → mostra/nascondi tutore + autorizzazione minore
  if (el.name === 'data_nascita') {
    const eta = calcEta(d.data_nascita);
    const isMinor = eta !== null && eta < 18;
    root.querySelector('[data-tutore-host]')?.classList.toggle('hidden', !isMinor);
    root.querySelector('[data-auth-minor-host]')?.classList.toggle('hidden', !isMinor);
  }
  // Dipendenza: tipo=gruppo → blocco "Composizione del gruppo" appare solo per
  // tipo=gruppo. Re-render dell'intero form (più affidabile del toggle CSS:
  // garantisce che il blocco esista nel DOM solo quando serve, immune da cache).
  if (el.name === 'tipo') {
    saveDraft(d); // persisti prima del re-render così il nuovo tipo è già nel draft
    renderForm(root, state);
    return;
  }
  // Dipendenza: sezione → ricarica le categorie disponibili (re-render parziale)
  if (el.name === 'sezione') {
    const catSel = root.querySelector('select[name="categoria"]');
    if (catSel) {
      // Le categorie del payload pubblico usano `sezione_id` (vedi db.js
      // fetchConcorsoIscrizioniAperto): filtriamo su quello.
      const cats = state.categorie.filter(c => c.sezione_id === el.value);
      const placeholder = cats.length === 0 ? '— Seleziona prima una sezione —' : '— Scegli categoria —';
      catSel.innerHTML = `<option value="">${placeholder}</option>` + cats.map(c => `<option value="${escapeHtml(c.id)}">${escapeHtml(c.nome)}</option>`).join('');
      catSel.disabled = cats.length === 0;
      // Se la sezione ha categorie la categoria diventa obbligatoria.
      catSel.required = cats.length > 0;
      d.categoria = '';
    }
  }

  // Collect dinamici (membri gruppo, brani programma)
  const rowsMembri = root.querySelectorAll('[data-membro-row]');
  if (rowsMembri.length) {
    d.gruppo_membri = Array.from(rowsMembri).map(r => ({
      nome: r.querySelector('[name="m_nome"]').value.trim(),
      cognome: r.querySelector('[name="m_cognome"]').value.trim(),
      strumento: r.querySelector('[name="m_strumento"]').value.trim(),
      data_nascita: r.querySelector('[name="m_data"]').value.trim(),
    }));
  }
  const rowsBrani = root.querySelectorAll('[data-programma-row]');
  if (rowsBrani.length) {
    d.programma = Array.from(rowsBrani).map(r => ({
      titolo: r.querySelector('[name="p_titolo"]').value.trim(),
      autore: r.querySelector('[name="p_autore"]').value.trim(),
      durata_min: Number(r.querySelector('[name="p_durata"]').value) || 0,
    }));
  }

  saveDraft(d);
}

// ============================================================================
// Validazione + Submit
// ============================================================================
function validate(d) {
  const errs = [];
  if (!d.nome) errs.push('Nome');
  if (!d.cognome) errs.push('Cognome');
  if (!d.data_nascita) errs.push('Data di nascita');
  if (!d.nazionalita) errs.push('Nazionalità');
  if (!d.email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(d.email)) errs.push('Email valida');
  if (!d.strumento) errs.push('Strumento');
  const eta = calcEta(d.data_nascita);
  if (eta !== null && eta < 18) {
    if (!d.tutore_nome || !d.tutore_cognome || !d.tutore_email) errs.push('Dati tutore (obbligatori per minorenni)');
  }
  const validBrani = (d.programma || []).filter(p => p.titolo);
  if (validBrani.length === 0) errs.push('Almeno un brano nel programma');
  if (!d.consenso_privacy) errs.push('Consenso privacy');
  if (!d.consenso_regolamento) errs.push('Consenso regolamento');
  return errs;
}

async function submit(root, state) {
  // N75: guard anti doppio-submit all'ENTRY. Prima il flag submitting veniva
  // settato dopo la validazione → due click rapidi passavano entrambi e
  // sparavano createIscrizione due volte.
  if (state.submitting) return;
  const d = state.draft;
  const errs = validate(d);
  if (errs.length > 0) {
    toast(`Mancano: ${errs.join(', ')}`, 'error');
    // Scrolla al primo campo invalido (best-effort)
    const firstInvalid = root.querySelector('input:invalid, select:invalid, textarea:invalid');
    if (firstInvalid) firstInvalid.scrollIntoView({ behavior: 'smooth', block: 'center' });
    return;
  }
  state.submitting = true;
  const btn = root.querySelector('[data-submit]');
  if (btn) { btn.disabled = true; btn.querySelector('span').textContent = 'Invio in corso…'; }

  try {
    const form = root.querySelector('#frm-iscrizione');
    // Anti-spam: stessi nomi end-to-end (form → API → server). `website` è
    // l'honeypot (nome innocuo per ingannare i bot); `startedAt` è il timestamp
    // di apertura form. Nessuna rinomina lungo la catena.
    const website = form?.querySelector('[name="website"]')?.value || '';
    const startedAt = Number(form?.querySelector('[name="startedAt"]')?.value) || 0;
    const payload = {
      concorso: state.concorso.id,
      ...d,
      programma: (d.programma || []).filter(p => p.titolo),
      durata_totale_min: (d.programma || []).reduce((s, p) => s + (Number(p.durata_min) || 0), 0),
      gruppo_membri: (d.tipo === 'gruppo' || d.tipo === 'orchestra')
        ? (d.gruppo_membri || []).filter(m => m.nome)
        : null,
      website,
      startedAt,
    };
    const { id } = await db.createIscrizione(payload);
    clearDraft();
    renderSuccess(root, state.concorso, id, d.email);
  } catch (e) {
    console.error('createIscrizione:', e);
    let msg = e?.message || 'Errore di rete';
    if (e?.data?.email?.code === 'validation_not_unique') msg = 'Hai già inviato un\'iscrizione con questa email per questo concorso.';
    toast(msg, 'error');
    state.submitting = false;
    if (btn) { btn.disabled = false; btn.querySelector('span').textContent = 'Invia iscrizione'; }
  }
}

function renderSuccess(root, concorso, id, email) {
  root.innerHTML = `
    <section class="view-fade c-page max-w-2xl mx-auto py-10 text-center">
      <div class="bg-white border border-emerald-200 rounded-3xl shadow-soft p-10">
        <div class="text-6xl mb-4">🎉</div>
        <h1 class="text-2xl font-black text-ink-900 mb-2">Iscrizione inviata</h1>
        <p class="text-slate-700 leading-relaxed mb-3">La tua iscrizione a <strong>${escapeHtml(concorso.nome)}</strong> è stata ricevuta correttamente.</p>
        <p class="text-sm text-slate-600 mb-1">Riceverai una mail di conferma a:</p>
        <p class="font-mono text-brand-700 font-semibold mb-4">${escapeHtml(email || '')}</p>
        <p class="text-xs text-slate-500">Numero pratica: <code class="bg-slate-100 px-2 py-0.5 rounded font-mono text-[11px]">${escapeHtml(id)}</code></p>
        <p class="text-sm text-slate-600 mt-6 leading-relaxed">L'organizzazione esaminerà la tua candidatura e ti contatterà con l'esito.</p>
        <a href="#/" class="c-btn c-btn--outline c-btn--sm mt-6">Chiudi</a>
      </div>
    </section>`;
}
