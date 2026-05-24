// Modale di import CSV (commissari/candidati) + helpers CSV.
// Estratto da js/views/admin.js (refactoring).

import { db } from '../../db.js';
import { escapeHtml, modal, toast, fmtBytes } from '../../utils.js';
import { t } from '../../i18n.js';

// ---------- Mapping intestazioni CSV → campi DB ----------

const IMPORT_FIELD_ALIASES = {
  candidati: {
    nome:         ['nome', 'firstname', 'name'],
    cognome:      ['cognome', 'lastname', 'surname'],
    strumento:    ['strumento', 'instrument', 'specialita', 'disciplina'],
    data_nascita: ['datanascita', 'data', 'datadinascita', 'birth', 'birthdate', 'nascita'],
    nazionalita:  ['nazionalita', 'nationality', 'paese'],
    docenti:      ['docenti', 'docentipreparatori', 'docente', 'maestri', 'maestro', 'preparatore', 'preparatori'],
    // Modello N:1: il candidato appartiene a una sola sezione + una sola
    // categoria. Manteniamo gli alias plurali per retro-compatibilità con
    // template csv vecchi, ma usiamo solo il primo valore.
    sezione:      ['sezione', 'sezioni', 'section', 'sections'],
    categoria:    ['categoria', 'categorie', 'category', 'categories'],
    tipo:         ['tipo', 'type', 'gruppo', 'isgruppo', 'kind'],
    gruppo_nome:  ['gruppo', 'gruppo_nome', 'grupponame', 'ensemble', 'nomegruppo'],
  },
  commissari: {
    nome:         ['nome', 'firstname', 'name'],
    cognome:      ['cognome', 'lastname', 'surname'],
    specialita:   ['specialita', 'strumento', 'discipline', 'disciplina'],
    email:        ['email', 'mail', 'email'],
    telefono:     ['telefono', 'tel', 'phone', 'cell', 'cellulare'],
    data_nascita: ['datanascita', 'data', 'datadinascita', 'birth', 'birthdate', 'nascita'],
    nazionalita:  ['nazionalita', 'nationality', 'paese'],
    bio:          ['bio', 'biografia', 'note', 'notes'],
  },
  // Import gerarchico: ogni riga è una categoria appartenente a una sezione.
  // La sezione si ripete su più righe; una riga con sola `sezione` (categoria
  // vuota) crea la sezione senza categorie.
  sezioni: {
    sezione:     ['sezione', 'sezioni', 'section', 'sez'],
    categoria:   ['categoria', 'categorie', 'category', 'cat'],
    descrizione: ['descrizione', 'description', 'desc', 'note', 'notes'],
    eta_min:     ['etamin', 'agemin', 'minage', 'etaminima', 'da', 'dafrom', 'from'],
    eta_max:     ['etamax', 'agemax', 'maxage', 'etamassima', 'a', 'ato', 'to'],
  },
};

const IMPORT_REQUIRED = {
  candidati:  ['nome', 'cognome', 'strumento', 'data_nascita', 'nazionalita'],
  commissari: ['nome', 'cognome', 'specialita'],
  sezioni:    ['sezione'],
};

function normKey(s) {
  return String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]/g, '');
}

function detectCsvSeparator(text) {
  const firstLine = text.split(/\r?\n/).find(l => l.trim()) || '';
  const counts = { ',': 0, ';': 0, '\t': 0 };
  let inQ = false;
  for (const ch of firstLine) {
    if (ch === '"') { inQ = !inQ; continue; }
    if (!inQ && ch in counts) counts[ch]++;
  }
  // pick most frequent non-zero, prefer ; over , over \t on tie
  const order = [';', ',', '\t'];
  return order.reduce((best, c) => counts[c] > counts[best] ? c : best, order[0]);
}

function parseCSV(text, sep) {
  // L229: rimuovi un eventuale BOM UTF-8 iniziale, altrimenti finisce nella
  // prima intestazione e il mapping delle colonne fallisce.
  if (text && text.charCodeAt(0) === 0xFEFF) text = text.slice(1);
  // L230: i byte NUL non sono mai dati CSV legittimi (file binario o payload
  // ostile); `trim()` non li rimuove → resterebbero dentro le celle. Eliminali.
  if (text) text = text.replace(/\u0000/g, '');
  const rows = [];
  let row = [], cur = '', inQ = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQ) {
      if (ch === '"') {
        if (text[i + 1] === '"') { cur += '"'; i++; }
        else inQ = false;
      } else cur += ch;
    } else {
      if (ch === '"') inQ = true;
      else if (ch === sep) { row.push(cur); cur = ''; }
      else if (ch === '\n') { row.push(cur); rows.push(row); row = []; cur = ''; }
      else if (ch === '\r') { /* skip */ }
      else cur += ch;
    }
  }
  if (cur !== '' || row.length) { row.push(cur); rows.push(row); }
  return rows.filter(r => r.some(c => String(c).trim() !== ''));
}

function parseImportDate(s) {
  const v = String(s || '').trim();
  if (!v) return '';
  // ISO YYYY-MM-DD
  let m = v.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (m) return `${m[1]}-${String(m[2]).padStart(2,'0')}-${String(m[3]).padStart(2,'0')}`;
  // DD/MM/YYYY  DD-MM-YYYY  DD.MM.YYYY
  m = v.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})$/);
  if (m) {
    const yy = m[3].length === 2 ? (Number(m[3]) > 30 ? '19' + m[3] : '20' + m[3]) : m[3];
    const day = String(m[1]).padStart(2,'0');
    const mon = String(m[2]).padStart(2,'0');
    if (Number(day) > 31 || Number(mon) > 12) return null;
    return `${yy}-${mon}-${day}`;
  }
  return null; // invalid
}

function splitMulti(s) {
  return String(s || '').split('|').map(x => x.trim()).filter(Boolean);
}

function buildImportRow(kind, headerMap, rawRow, concorso) {
  const get = (logical) => {
    const idx = headerMap[logical];
    return idx == null ? '' : String(rawRow[idx] ?? '').trim();
  };
  const errors = [];
  const out = {
    nome: get('nome'),
    cognome: get('cognome'),
  };
  if (kind === 'sezioni') {
    // Una riga = una categoria sotto una sezione (la categoria può mancare:
    // in quel caso la riga crea solo la sezione).
    out.sezione = get('sezione');
    out.categoria = get('categoria');
    out.descrizione = get('descrizione');
    const parseEta = (raw, field) => {
      const v = String(raw || '').trim();
      if (!v) return null;
      const n = Number(v.replace(',', '.'));
      if (!Number.isFinite(n) || n < 0 || n > 120) {
        errors.push(t('admin.import.err.bad_eta', { value: v }));
        return null;
      }
      return Math.trunc(n);
    };
    out.eta_min = parseEta(get('eta_min'), 'eta_min');
    out.eta_max = parseEta(get('eta_max'), 'eta_max');
    if (out.eta_min != null && out.eta_max != null && out.eta_min > out.eta_max) {
      errors.push(t('admin.import.err.eta_range', { min: out.eta_min, max: out.eta_max }));
    }
    if (!out.sezione) errors.push(t('admin.import.err.required_missing', { field: 'sezione' }));
    return { data: out, errors };
  }
  if (kind === 'candidati') {
    out.strumento = get('strumento');
    out.nazionalita = get('nazionalita');
    const dn = parseImportDate(get('data_nascita'));
    if (dn === null) errors.push(t('admin.import.err.bad_date', { value: get('data_nascita') }));
    out.data_nascita = dn || '';
    out.docenti_preparatori = splitMulti(get('docenti'));

    // Tipo: 'gruppo' se il CSV ha `tipo=gruppo` o `is_gruppo=true/1/si` o
    // se la colonna gruppo_nome è valorizzata. Per i gruppi il cognome non è
    // obbligatorio (il "candidato" è l'ensemble nel suo complesso).
    const rawTipo = get('tipo').toLowerCase();
    const rawGruppoNome = get('gruppo_nome');
    const isGruppo = ['gruppo', 'group', 'ensemble', 'true', '1', 'si', 'yes'].includes(rawTipo) || rawGruppoNome.length > 0;
    out.tipo = isGruppo ? 'gruppo' : 'individuale';
    if (isGruppo && rawGruppoNome) out.gruppo_nome = rawGruppoNome;

    // Sezione N:1: prendiamo il primo nome valido. Manteniamo splitMulti per
    // tolleranza al template legacy (separatore "|") ma usiamo solo il primo.
    const sezAll = db.sezioniByConcorso(concorso.id);
    const sezNames = splitMulti(get('sezione'));
    let sezione_id = null;
    if (sezNames.length > 0) {
      const s = sezAll.find(x => normKey(x.nome) === normKey(sezNames[0]));
      if (s) sezione_id = s.id;
      else errors.push(t('admin.import.err.sez_not_found', { name: sezNames[0] }));
    }
    out.sezione_id = sezione_id;

    // Categoria N:1: scoped alla sezione scelta. Se la sezione manca ma la
    // categoria è specificata, deriviamo la sezione dal record categoria
    // (gerarchia categoria→sezione, identica al form e al backend).
    const catAll = db.categorieByConcorso(concorso.id);
    const catNames = splitMulti(get('categoria'));
    let categoria_id = null;
    if (catNames.length > 0) {
      const candidates = catAll.filter(c =>
        normKey(c.nome) === normKey(catNames[0]) &&
        (sezione_id == null || c.sezione_id === sezione_id),
      );
      if (candidates.length === 1) {
        categoria_id = candidates[0].id;
        if (!sezione_id) sezione_id = candidates[0].sezione_id;
      } else if (candidates.length === 0) {
        errors.push(t('admin.import.err.cat_not_found', { name: catNames[0] }));
      } else {
        errors.push(t('admin.import.err.cat_ambiguous', { name: catNames[0] }));
      }
    }
    out.categoria_id = categoria_id;
    if (sezione_id && !out.sezione_id) out.sezione_id = sezione_id; // (no-op safeguard)
  } else {
    out.specialita = get('specialita');
    out.email = get('email');
    out.telefono = get('telefono');
    out.nazionalita = get('nazionalita');
    out.bio = get('bio');
    if (get('data_nascita')) {
      const dn = parseImportDate(get('data_nascita'));
      if (dn === null) errors.push(t('admin.import.err.bad_date', { value: get('data_nascita') }));
      out.data_nascita = dn || null;
    } else {
      out.data_nascita = null;
    }
  }

  // Per i gruppi/orchestre (kind=candidati, tipo=gruppo|orchestra) il cognome
  // e la data di nascita non sono richiesti — il "candidato" è l'ensemble nel
  // suo complesso.
  const requiredForRow = kind === 'candidati' && (out.tipo === 'gruppo' || out.tipo === 'orchestra')
    ? ['nome', 'strumento']
    : IMPORT_REQUIRED[kind];
  requiredForRow.forEach(f => {
    if (!out[f]) errors.push(t('admin.import.err.required_missing', { field: f }));
  });
  return { data: out, errors };
}

function buildHeaderMap(kind, headerCells) {
  const aliases = IMPORT_FIELD_ALIASES[kind];
  const normHeader = headerCells.map(h => normKey(h));
  const map = {};
  Object.entries(aliases).forEach(([logical, alts]) => {
    const idx = normHeader.findIndex(h => alts.includes(h));
    if (idx >= 0) map[logical] = idx;
  });
  return map;
}

function importTemplateText(kind) {
  if (kind === 'sezioni') {
    // Header: sezione obbligatoria; categoria/descrizione/eta_min/eta_max
    // opzionali. La sezione si ripete su più righe per raggrupparne le categorie.
    return [
      'sezione,categoria,descrizione,eta_min,eta_max',
      'Archi,Junior,Fino a 14 anni,0,14',
      'Archi,Senior,Dai 15 anni in su,15,',
      'Fiati,Junior,,0,14',
      'Pianoforte,,Sezione senza categorie,,',
    ].join('\n');
  }
  if (kind === 'candidati') {
    return [
      // Header: nome,cognome obbligatori; strumento/data/nazionalita per individuale;
      // tipo + gruppo_nome per gruppi (in quel caso cognome e data_nascita possono
      // restare vuoti). sezione/categoria opzionali (per nome, case-insensitive).
      'nome,cognome,strumento,data_nascita,nazionalita,docenti,sezione,categoria,tipo,gruppo_nome',
      'Anna,Rossi,Pianoforte,2002-04-15,Italiana,Mario Bianchi|Lucia Verdi,Pianoforte,Junior,individuale,',
      'Marco,Bianchi,Violino,15/06/2003,Italiana,Anna Neri,Archi,Senior,individuale,',
      'Quartetto Brillante,,Quartetto d\'archi,,,,Archi,Cameristica,gruppo,Quartetto Brillante',
    ].join('\n');
  }
  return [
    'nome,cognome,specialita,email,telefono,data_nascita,nazionalita,bio',
    'Giovanni,Verdi,Pianoforte,g.verdi@esempio.it,+39 333 1234567,1968-09-20,Italiana,Docente al conservatorio',
    'Sara,Conti,Composizione,,,,Italiana,',
  ].join('\n');
}

export function openImportModal(concorso, kind, onSaved) {
  const isCand = kind === 'candidati';
  const isSez = kind === 'sezioni';
  const titleKind = t(`admin.import.kind.${kind}`);
  const fieldsHelp = t(`admin.import.cols.${kind}`);

  // Mutable parsed state (filled by parseAndPreview)
  let parsed = []; // [{ data, errors, raw }]
  let csvHeaders = []; // header row letta dal CSV, condivisa tra onMount e onPrimary

  modal({
    title: t('admin.import.title', { kind: titleKind }),
    width: 'max-w-4xl',
    contentHtml: `
      <div class="space-y-4 text-sm">
        <div class="bg-brand-50 border border-brand-100 rounded-xl p-3 text-brand-900 text-xs leading-relaxed">
          <p>${fieldsHelp}</p>
          <p class="mt-1">${t('admin.import.help1')}</p>
          <p class="mt-1">${escapeHtml(t('admin.import.help2'))}</p>
        </div>

        <div class="flex flex-wrap items-center gap-2">
          <label class="inline-flex items-center px-3 py-2 text-sm font-medium text-brand-700 bg-brand-50 hover:bg-brand-100 rounded-lg cursor-pointer">
            ${escapeHtml(t('admin.import.upload_btn'))}
            <input data-import-file type="file" accept=".csv,.tsv,.txt,text/csv" class="hidden" />
          </label>
          <button type="button" data-import-template class="text-xs text-slate-600 hover:text-slate-900 underline">${escapeHtml(t('admin.import.template_btn'))}</button>
          <span data-import-status class="text-xs text-slate-500"></span>
        </div>

        <label class="block">
          <span class="text-xs font-medium text-slate-700">${escapeHtml(t('admin.import.paste_label'))}</span>
          <textarea data-import-text rows="6" spellcheck="false" class="mt-1 w-full border border-slate-300 rounded-lg px-3 py-2 text-xs font-mono focus:ring-2 focus:ring-brand-500 focus:border-brand-500" placeholder="${escapeHtml(importTemplateText(kind))}"></textarea>
        </label>

        <div class="flex items-center gap-2">
          <button type="button" data-import-parse class="text-sm font-semibold text-white bg-slate-700 hover:bg-slate-900 px-3 py-2 rounded-lg">${escapeHtml(t('admin.import.parse_btn'))}</button>
          <span data-import-summary class="text-xs text-slate-600"></span>
        </div>

        <div data-import-preview class="hidden border border-slate-200 rounded-xl overflow-hidden">
          <div class="max-h-[360px] overflow-auto">
            <table class="w-full text-xs">
              <thead class="bg-slate-50 sticky top-0">
                <tr data-preview-head></tr>
              </thead>
              <tbody data-preview-body></tbody>
            </table>
          </div>
        </div>

        <div data-import-progress class="hidden">
          <div class="w-full h-2 bg-slate-200 rounded-full overflow-hidden">
            <div data-progress-bar class="h-full bg-brand-500 transition-all" style="width:0%"></div>
          </div>
          <p data-progress-text class="text-xs text-slate-500 mt-1"></p>
        </div>

        <div data-mapping class="hidden mt-3 bg-brand-50 border border-brand-100 rounded-xl p-4">
          <p class="text-xs font-semibold text-brand-700 mb-2">${escapeHtml(t('admin.import.mapping_title'))}</p>
          <div data-mapping-fields class="grid grid-cols-2 sm:grid-cols-3 gap-2"></div>
        </div>

        ${kind === 'commissari' ? `
          <label class="flex items-start gap-2 text-xs text-slate-700 mt-1">
            <input data-com-assign type="checkbox" checked class="mt-0.5 w-3.5 h-3.5 rounded border-slate-300 text-brand-600">
            <span>${escapeHtml(t('admin.import.com_assign', { concorso: concorso?.nome || '' }))}</span>
          </label>
        ` : ''}
      </div>
    `,
    primaryLabel: t('admin.import.btn_label', { kind: titleKind }),
    onMount: (body) => {
      const fileInput   = /** @type {HTMLInputElement} */ (body.querySelector('[data-import-file]'));
      const textArea    = /** @type {HTMLTextAreaElement} */ (body.querySelector('[data-import-text]'));
      const statusEl    = body.querySelector('[data-import-status]');
      const summaryEl   = body.querySelector('[data-import-summary]');
      const previewWrap = body.querySelector('[data-import-preview]');
      const headRow     = body.querySelector('[data-preview-head]');
      const bodyRows    = body.querySelector('[data-preview-body]');
      const tplBtn      = /** @type {HTMLElement} */ (body.querySelector('[data-import-template]'));
      const parseBtn    = /** @type {HTMLButtonElement} */ (body.querySelector('[data-import-parse]'));
      const mappingWrap = body.querySelector('[data-mapping]');
      const mappingFields = body.querySelector('[data-mapping-fields]');

      tplBtn.addEventListener('click', () => {
        const blob = new Blob([importTemplateText(kind)], { type: 'text/csv;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `template_${kind}.csv`;
        a.click();
        URL.revokeObjectURL(url);
      });

      fileInput.addEventListener('change', async (e) => {
        const file = /** @type {HTMLInputElement} */ (e.target).files[0];
        if (!file) return;
        try {
          const txt = await file.text();
          textArea.value = txt;
          statusEl.textContent = t('admin.import.loaded', { name: file.name, size: fmtBytes(file.size) });
          parseBtn.click();
        } catch (err) {
          toast(t('admin.import.read_error', { msg: err.message }), 'error');
        } finally {
          fileInput.value = '';
        }
      });

      parseBtn.addEventListener('click', () => {
        const text = (textArea.value || '').trim();
        if (!text) {
          summaryEl.textContent = t('admin.import.empty_hint');
          previewWrap.classList.add('hidden');
          parsed = [];
          return;
        }
        const sep = detectCsvSeparator(text);
        const rows = parseCSV(text, sep);
        if (rows.length < 2) {
          summaryEl.innerHTML = `<span class="text-rose-600 font-semibold">${escapeHtml(t('admin.import.need_header_data'))}</span>`;
          previewWrap.classList.add('hidden');
          parsed = [];
          return;
        }
        const header = rows[0];
        const headerMap = buildHeaderMap(kind, header);
        const missingReq = IMPORT_REQUIRED[kind].filter(f => !(f in headerMap));
        if (missingReq.length > 0) {
          summaryEl.innerHTML = `<span class="text-rose-600 font-semibold">${escapeHtml(t('admin.import.missing_cols', { cols: missingReq.join(', ') }))}</span>`;
          previewWrap.classList.add('hidden');
          parsed = [];
          return;
        }
        // N47: cap sul numero di righe importabili. Senza limite un CSV da
        // decine di migliaia di righe freeza il browser nel parsing/preview e
        // poi genera altrettante chiamate API sequenziali.
        const MAX_IMPORT_ROWS = 500;
        const dataRows = rows.slice(1);
        if (dataRows.length > MAX_IMPORT_ROWS) {
          summaryEl.innerHTML = `<span class="text-rose-600 font-semibold">${escapeHtml(t('admin.import.err.too_many_rows', { count: dataRows.length, max: MAX_IMPORT_ROWS }))}</span>`;
          previewWrap.classList.add('hidden');
          parsed = [];
          return;
        }
        parsed = dataRows.map((r, i) => ({
          ...buildImportRow(kind, headerMap, r, concorso),
          rawIndex: i + 2,
        }));
        const ok = parsed.filter(p => p.errors.length === 0).length;
        const ko = parsed.length - ok;
        const sepLabel = sep === '\t' ? 'tab' : sep;
        summaryEl.innerHTML = t('admin.import.summary', { sep: sepLabel, n: parsed.length, ok }) + (ko ? t('admin.import.summary_errors', { ko }) : '');

        // Build preview
        const cols = isSez
          ? ['sezione', 'categoria', 'descrizione', 'eta']
          : isCand
            ? ['nome', 'cognome', 'strumento', 'data_nascita', 'nazionalita', 'sezione_id', 'categoria_id']
            : ['nome', 'cognome', 'specialita', 'email', 'telefono', 'data_nascita'];
        const colLabels = isSez
          ? [t('admin.import.col.sezioni'), t('admin.import.col.categorie'), t('admin.import.col.descrizione'), t('admin.import.col.eta')]
          : isCand
            ? [t('admin.import.col.nome'), t('admin.import.col.cognome'), t('admin.import.col.strumento'), t('admin.import.col.nascita'), t('admin.import.col.naz'), t('admin.import.col.sezioni'), t('admin.import.col.categorie')]
            : [t('admin.import.col.nome'), t('admin.import.col.cognome'), t('admin.import.col.specialita'), t('admin.import.col.email'), t('admin.import.col.telefono'), t('admin.import.col.nascita')];
        headRow.innerHTML = ['#', ...colLabels, t('admin.import.col_status')].map(h => `<th class="text-left font-semibold text-slate-600 px-2 py-1.5 border-b border-slate-200">${escapeHtml(h)}</th>`).join('');

        const sezById = Object.fromEntries(db.sezioniByConcorso(concorso.id).map(s => [s.id, s.nome]));
        const catById = Object.fromEntries(db.categorieByConcorso(concorso.id).map(c => [c.id, c.nome]));

        bodyRows.innerHTML = parsed.map(p => {
          const cells = cols.map(c => {
            let v = p.data[c];
            // R15: buildImportRow scrive id SINGOLI (sezione_id/categoria_id), non
            // array plurali → la preview leggeva chiavi inesistenti e restava vuota.
            if (c === 'sezione_id') v = v ? (sezById[v] || v) : '';
            else if (c === 'categoria_id') v = v ? (catById[v] || v) : '';
            // Import sezioni: colonna sintetica "Età" (min–max derivata).
            else if (c === 'eta') {
              const lo = p.data.eta_min, hi = p.data.eta_max;
              v = (lo == null && hi == null) ? '' : `${lo ?? ''}–${hi ?? ''}`;
            }
            else if (Array.isArray(v)) v = v.join(', ');
            return `<td class="px-2 py-1 border-b border-slate-100 text-slate-700">${escapeHtml(v ?? '')}</td>`;
          }).join('');
          const statusCell = p.errors.length === 0
            ? `<td class="px-2 py-1 border-b border-slate-100 text-emerald-700 font-semibold">✓</td>`
            : `<td class="px-2 py-1 border-b border-slate-100 text-rose-700 font-medium" title="${escapeHtml(p.errors.join(' · '))}">✗ ${escapeHtml(p.errors.join(' · '))}</td>`;
          return `<tr class="${p.errors.length ? 'bg-rose-50/40' : ''}"><td class="px-2 py-1 border-b border-slate-100 font-mono text-slate-400">${p.rawIndex}</td>${cells}${statusCell}</tr>`;
        }).join('');

        // Popola mappatura colonne per override manuale
        csvHeaders = header;
        const fieldNames = isSez
          ? ['sezione','categoria','descrizione','eta_min','eta_max']
          : isCand
            ? ['nome','cognome','strumento','data_nascita','nazionalita','docenti_preparatori','sezioni_ids','categorie_ids']
            : ['nome','cognome','specialita','email','telefono','data_nascita'];
        const fieldLabels = isSez
          ? [t('admin.import.col.sezioni'), t('admin.import.col.categorie'), t('admin.import.col.descrizione'), t('admin.import.col.eta_min'), t('admin.import.col.eta_max')]
          : isCand
            ? [t('admin.candidato.field_nome'), t('admin.candidato.field_cognome'), t('admin.candidato.field_strumento'), t('admin.candidato.field_data_nascita'), t('admin.candidato.field_nazionalita'), t('admin.candidato.field_docenti'), t('admin.candidato.section_iscrizione'), 'Categorie']
            : [t('admin.candidato.field_nome'), t('admin.candidato.field_cognome'), t('admin.commissari.field_specialita'), t('admin.commissari.field_email'), t('admin.commissari.field_telefono'), t('admin.commissari.field_data_nascita')];
        const requiredFields = isSez ? ['sezione'] : isCand ? ['nome','cognome','strumento','data_nascita','nazionalita'] : ['nome','cognome'];

        mappingFields.innerHTML = fieldNames.map((f, i) => {
          const detected = headerMap[f] !== undefined ? csvHeaders[headerMap[f]] : '';
          const req = requiredFields.includes(f);
          return `<label class="text-[10px]">
            <span class="text-slate-600">${req ? '• ' : ''}${escapeHtml(fieldLabels[i] || f)}${req ? ' *' : ''}</span>
            <select data-map="${f}" class="mt-0.5 w-full border border-slate-200 rounded-md px-1.5 py-1 text-[10px] bg-white">
              <option value="">${escapeHtml(t('admin.import.skip_col'))}</option>
              ${csvHeaders.map((h, hi) => `<option value="${hi}" ${String(hi) === String(headerMap[f]) ? 'selected' : ''}>${escapeHtml(h)}</option>`).join('')}
            </select>
          </label>`;
        }).join('');
        mappingWrap.classList.remove('hidden');
        previewWrap.classList.remove('hidden');
      });
    },
    onPrimary: async (body) => {
      // Ricostruisci mapping dal form (override manuale)
      const userMap = {};
      body.querySelectorAll('[data-map]').forEach(sel => {
        const s = /** @type {HTMLSelectElement} */ (sel);
        if (s.value !== '') userMap[s.dataset.map] = Number(s.value);
      });
      if (Object.keys(userMap).length > 0 && csvHeaders.length > 0) {
        const sep = detectCsvSeparator((/** @type {HTMLTextAreaElement} */ (body.querySelector('[data-import-text]')).value || '').trim());
        const allRows = parseCSV((/** @type {HTMLTextAreaElement} */ (body.querySelector('[data-import-text]')).value || '').trim(), sep);
        if (allRows.length > 1) {
          parsed = allRows.slice(1).map((r, i) => ({
            ...buildImportRow(kind, userMap, r, concorso),
            rawIndex: i + 2,
          }));
        }
      }

      const valid = parsed.filter(p => p.errors.length === 0);
      if (valid.length === 0) {
        toast(t('admin.import.no_valid_rows'), 'error');
        return false;
      }
      const progress = body.querySelector('[data-import-progress]');
      const bar      = /** @type {HTMLElement} */ (body.querySelector('[data-progress-bar]'));
      const ptext    = body.querySelector('[data-progress-text]');
      progress.classList.remove('hidden');

      // Sezioni & categorie: import gerarchico. Prima risolve/crea le sezioni
      // (match per nome, case-insensitive → niente duplicati), poi crea le
      // categorie sotto la sezione giusta saltando i duplicati per nome.
      // Riusa db.createSezione / db.createCategoria.
      if (isSez) {
        const norm = (s) => String(s || '').trim().toLowerCase();
        const sezByName = new Map(db.sezioniByConcorso(concorso.id).map(s => [norm(s.nome), s]));
        const catNamesBySez = new Map(
          db.sezioniByConcorso(concorso.id).map(s => [s.id, new Set(db.categorieBySezione(s.id).map(c => norm(c.nome)))]),
        );
        let okSez = 0, okCat = 0, ko = 0;
        for (let i = 0; i < valid.length; i++) {
          const { sezione, categoria, descrizione, eta_min, eta_max } = valid[i].data;
          try {
            let sez = sezByName.get(norm(sezione));
            if (!sez) {
              // Una riga sezione-only porta la descrizione sulla sezione; se la
              // riga ha anche una categoria la descrizione spetta alla categoria.
              sez = await db.createSezione({ concorso_id: concorso.id, nome: sezione.trim(), descrizione: categoria ? '' : (descrizione || '') });
              sezByName.set(norm(sezione), sez);
              catNamesBySez.set(sez.id, new Set());
              okSez++;
            }
            if (categoria) {
              const seen = catNamesBySez.get(sez.id);
              if (!seen.has(norm(categoria))) {
                await db.createCategoria({ sezione_id: sez.id, nome: categoria.trim(), descrizione: descrizione || '', eta_min, eta_max });
                seen.add(norm(categoria));
                okCat++;
              }
            }
          } catch (e) {
            console.error('import sezioni row failed', valid[i], e);
            ko++;
          }
          bar.style.width = Math.round(((i + 1) / valid.length) * 100) + '%';
          ptext.textContent = t('admin.import.sez_progress', { current: i + 1, total: valid.length, sez: okSez, cat: okCat });
        }
        if (ko === 0) toast(t('admin.import.sez_done_ok', { sez: okSez, cat: okCat }), 'success');
        else toast(t('admin.import.done_partial', { ok: okSez + okCat, ko }), 'warn');
        if (onSaved) onSaved();
        return;
      }

      // Commissari: importa SEMPRE in archivio (concorsi_ids=[]) e poi, se
      // l'admin lo richiede col checkbox, assegna ciascun nuovo record al
      // concorso corrente. Default checkbox = checked.
      const assignToConcorso = kind === 'commissari'
        ? !!(/** @type {HTMLInputElement|null} */ (body.querySelector('[data-com-assign]'))?.checked)
        : false;

      let ok = 0, ko = 0;
      for (let i = 0; i < valid.length; i++) {
        const p = valid[i];
        try {
          if (isCand) {
            await db.createCandidato({ concorso_id: concorso.id, ...p.data });
          } else {
            // Nuovo modello: l'import popola l'anagrafica per-tenant. Se richiesto,
            // la stessa transazione lo assegna al concorso corrente.
            // N139: db.createCommissario destruttura `concorso_id` (singolare),
            // non `concorsi_ids` → prima il campo era ignorato e la create
            // falliva ("concorso_id richiesto"). L'API richiede un concorsoId,
            // quindi assegniamo al concorso corrente quando il checkbox è attivo.
            const created = await db.createCommissario({
              concorso_id: assignToConcorso ? concorso.id : null,
              ...p.data,
            });
            void created;
          }
          ok++;
        } catch (e) {
          console.error('import row failed', p, e);
          ko++;
        }
        const pct = Math.round(((i + 1) / valid.length) * 100);
        bar.style.width = pct + '%';
        ptext.textContent = ko
          ? t('admin.import.progress_with_errors', { current: i + 1, total: valid.length, ok, ko })
          : t('admin.import.progress', { current: i + 1, total: valid.length, ok });
      }
      if (ko === 0) toast(t('admin.import.done_ok', { n: ok, kind: titleKind }), 'success');
      else toast(t('admin.import.done_partial', { ok, ko }), 'warn');
      if (onSaved) onSaved();
    },
  });
}
