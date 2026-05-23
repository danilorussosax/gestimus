// Pagina pubblica /#/privacy — informativa privacy generata dinamicamente dai
// dati GDPR dell'ente (visibili senza autenticazione tramite enti_public + endpoint
// pubblici di lettura).
//
// Funzionalità:
//   - Informativa completa GDPR per il candidato (titolare, dati, finalità, base
//     giuridica, retention, diritti).
//   - Tool "Accedi ai miei dati" (export JSON) con token di verifica.
//   - Tool "Richiedi cancellazione" (oblio) con doppia conferma.
//
// Per il token: l'utente lo riceve via email al momento dell'iscrizione (link
// di conferma). Se l'ha smarrito può richiedere un nuovo invio.

import { db } from '../db.js';
import { escapeHtml, toast } from '../utils.js';
import { icon } from '../icons.js';

export async function renderPrivacy(root) {
  // Sub-route /#/privacy/diritti per gli strumenti export/erase
  if (location.hash.startsWith('#/privacy/diritti')) {
    return renderDiritti(root);
  }

  // Carica branding pubblico (per logo+nome)
  const brand = db.getEntePublic();
  // I campi privacy estesi (titolare, DPO, retention, ecc.) non sono ancora
  // esposti da endpoint pubblici: usiamo i fallback applicativi qui sotto.
  const ente = null;

  // Calcolo "ultimo aggiornamento"
  const aggIso = ente?.privacy_aggiornata_il || null;
  const aggLabel = aggIso ? new Date(aggIso).toLocaleDateString('it-IT', { day: '2-digit', month: 'long', year: 'numeric' }) : null;

  // Se l'admin ha caricato un'informativa esterna, prefersci quella (apertura in nuovo tab).
  const customUrl = ente?.privacy_informativa_url || '';

  root.innerHTML = `
    <section class="view-fade c-page max-w-3xl mx-auto pb-10">
      <header class="bg-white border border-slate-200 rounded-3xl shadow-soft p-5 mb-6 flex items-start gap-4">
        ${brand?.logo_url ? `<img src="${escapeHtml(brand.logo_url)}" alt="" class="w-16 h-16 rounded-2xl object-contain border border-slate-100 shrink-0" />` : ''}
        <div class="min-w-0 flex-1">
          <p class="font-mono text-[11px] uppercase tracking-[0.16em] text-brand-700 font-bold">${gdprBadgeInline()} Informativa privacy</p>
          <h1 class="text-2xl font-black text-ink-900 leading-tight">${escapeHtml(brand?.nome || 'Informativa GDPR')}</h1>
          <p class="text-sm text-slate-600 mt-1">Trattamento dei dati personali ai sensi del Regolamento (UE) 2016/679 (GDPR)${aggLabel ? ` · ultimo aggiornamento ${escapeHtml(aggLabel)}` : ''}</p>
        </div>
      </header>

      ${customUrl ? `
        <div class="bg-amber-50 border border-amber-200 rounded-2xl p-4 mb-6 text-sm">
          Il Titolare ha pubblicato un'informativa estesa al link:
          <a href="${escapeHtml(customUrl)}" target="_blank" class="font-bold text-brand-700 underline">${escapeHtml(customUrl)}</a>
          <p class="text-xs mt-1 text-amber-900">Quanto qui sotto è un riepilogo applicativo coerente con il documento ufficiale.</p>
        </div>
      ` : ''}

      ${section('1. Titolare del trattamento', `
        <p>Il Titolare del trattamento dei dati personali è:</p>
        <ul class="mt-2 ml-5 list-disc space-y-1">
          <li><strong>${escapeHtml(ente?.privacy_titolare || brand?.nome || '— (non specificato)')}</strong></li>
          ${ente?.privacy_sede_legale ? `<li>Sede legale: ${escapeHtml(ente.privacy_sede_legale)}</li>` : ''}
          ${ente?.privacy_partita_iva ? `<li>P. IVA / C.F.: <code>${escapeHtml(ente.privacy_partita_iva)}</code></li>` : ''}
          ${ente?.privacy_pec ? `<li>PEC: <a href="mailto:${escapeHtml(ente.privacy_pec)}" class="text-brand-700">${escapeHtml(ente.privacy_pec)}</a></li>` : ''}
          ${ente?.privacy_email_contatto ? `<li>Email di contatto privacy: <a href="mailto:${escapeHtml(ente.privacy_email_contatto)}" class="text-brand-700">${escapeHtml(ente.privacy_email_contatto)}</a></li>` : ''}
        </ul>
        ${ente?.privacy_dpo_email ? `
          <p class="mt-3"><strong>Responsabile della Protezione dei Dati (DPO):</strong> ${escapeHtml(ente.privacy_dpo_nome || '')} — <a href="mailto:${escapeHtml(ente.privacy_dpo_email)}" class="text-brand-700">${escapeHtml(ente.privacy_dpo_email)}</a></p>
        ` : ''}
      `)}

      ${section('2. Categorie di dati trattati', `
        <ul class="ml-5 list-disc space-y-1">
          <li><strong>Dati anagrafici</strong>: nome, cognome, data di nascita, luogo di nascita, sesso (facoltativo), nazionalità, codice fiscale.</li>
          <li><strong>Dati di contatto</strong>: email, telefono, indirizzo postale.</li>
          <li><strong>Dati del tutore</strong> (solo per candidati minorenni): nome, cognome, email, telefono.</li>
          <li><strong>Dati artistici</strong>: strumento, anni di studio, scuola di provenienza, docenti preparatori, programma musicale.</li>
          <li><strong>Documenti</strong>: foto identificativa, documento d'identità, ricevuta pagamento quota, autorizzazione genitoriale.</li>
          <li><strong>Dati di valutazione</strong>: voti assegnati dai commissari, classifiche, esiti.</li>
          <li><strong>Metadati tecnici</strong>: timestamp di iscrizione, indirizzo IP anonimizzato (ultimo ottetto azzerato), user-agent del browser.</li>
        </ul>
      `)}

      ${section('3. Finalità e base giuridica', `
        <p>I dati sono trattati per le seguenti finalità:</p>
        <table class="w-full text-sm mt-3 border border-slate-200 rounded-lg overflow-hidden">
          <thead class="bg-slate-50">
            <tr><th class="text-left p-2">Finalità</th><th class="text-left p-2">Base giuridica</th></tr>
          </thead>
          <tbody class="divide-y divide-slate-100">
            <tr><td class="p-2">Iscrizione al concorso e gestione amministrativa</td><td class="p-2">Art. 6(1)(b) — esecuzione del contratto</td></tr>
            <tr><td class="p-2">Valutazione delle prove + protocolli pubblici (classifiche)</td><td class="p-2">Art. 6(1)(b) — esecuzione del contratto</td></tr>
            <tr><td class="p-2">Comunicazioni email organizzative</td><td class="p-2">Art. 6(1)(b) — esecuzione del contratto</td></tr>
            <tr><td class="p-2">Uso delle immagini/video del concorso</td><td class="p-2">Art. 6(1)(a) — consenso esplicito (revocabile)</td></tr>
            <tr><td class="p-2">Adempimenti fiscali e di legge</td><td class="p-2">Art. 6(1)(c) — obbligo legale</td></tr>
          </tbody>
        </table>
      `)}

      ${section('4. Conservazione (retention)', `
        <p>${ente?.privacy_retention_mesi
          ? `I dati personali sono conservati per <strong>${escapeHtml(String(ente.privacy_retention_mesi))} mesi</strong> dalla conclusione del concorso, salvo obblighi di legge superiori (es. documentazione fiscale: 10 anni).`
          : 'I dati personali sono conservati per il tempo necessario alla gestione del concorso e degli adempimenti correlati, e non oltre 24 mesi dalla conclusione, salvo obblighi di legge superiori (es. documentazione fiscale: 10 anni).'}
        </p>
        <p class="mt-2">I dati di valutazione (classifiche, verbali) sono pubblicati per la durata richiesta dal regolamento del concorso e successivamente archiviati o anonimizzati.</p>
      `)}

      ${section('5. Destinatari', `
        <ul class="ml-5 list-disc space-y-1">
          <li>Commissari di gara designati dal Titolare</li>
          <li>Personale amministrativo del Titolare</li>
          <li>Responsabili esterni: fornitore di hosting VPS, servizio email transazionale (SMTP del Titolare)</li>
          <li>Autorità (su richiesta motivata)</li>
        </ul>
        <p class="mt-2 text-xs text-slate-600">Nessuna profilazione automatizzata, nessun trasferimento extra-UE.</p>
      `)}

      ${section('6. Diritti dell\'interessato', `
        <p>Hai diritto di esercitare i seguenti diritti (artt. 15-22 GDPR):</p>
        <ul class="ml-5 list-disc space-y-1 mt-2">
          <li><strong>Accesso</strong> ai tuoi dati personali</li>
          <li><strong>Rettifica</strong> dei dati inesatti</li>
          <li><strong>Cancellazione</strong> ("diritto all'oblio")</li>
          <li><strong>Limitazione</strong> del trattamento</li>
          <li><strong>Portabilità</strong> dei dati in formato strutturato (JSON)</li>
          <li><strong>Opposizione</strong> al trattamento</li>
          <li><strong>Revoca</strong> del consenso (uso immagini)</li>
          <li><strong>Reclamo</strong> all'<a href="https://www.garanteprivacy.it" target="_blank" class="text-brand-700">Autorità Garante</a></li>
        </ul>
        <div class="mt-4 bg-emerald-50 border border-emerald-200 rounded-xl p-4">
          <p class="text-sm font-semibold text-emerald-900 mb-2">🛠 Strumenti automatici per esercitare i diritti</p>
          <p class="text-xs text-emerald-800 mb-3">Hai bisogno del <strong>token di verifica</strong> che ti è stato inviato all'email al momento dell'iscrizione (link di conferma).</p>
          <a href="#/privacy/diritti" class="c-btn c-btn--outline c-btn--sm inline-flex items-center gap-1.5">
            ${icon('shieldCheck', { size: 14 })}
            <span>Accedi / esporta / cancella i miei dati</span>
          </a>
        </div>
      `)}

      ${section('7. Modalità di trattamento', `
        <p>I dati sono trattati con strumenti elettronici, presso server localizzati nell'Unione Europea, con misure tecniche e organizzative atte a garantire la sicurezza e la riservatezza:</p>
        <ul class="ml-5 list-disc space-y-1 mt-2">
          <li>Connessione cifrata HTTPS (TLS 1.2+) per tutti gli accessi</li>
          <li>Autenticazione con password personali</li>
          <li>Audit log delle operazioni amministrative (IP anonimizzato)</li>
          <li>Backup cifrati e con accesso limitato</li>
          <li>Separazione logica dei dati per ente (multitenant isolato)</li>
        </ul>
      `)}

      <div class="text-center mt-8">
        <a href="#/" class="c-btn c-btn--outline c-btn--sm">Torna alla home</a>
      </div>
    </section>
  `;
}

function section(title, html) {
  return `
    <section class="bg-white border border-slate-200 rounded-3xl shadow-soft p-6 mb-4">
      <h2 class="font-bold text-lg text-ink-900 mb-3">${escapeHtml(title)}</h2>
      <div class="text-sm text-slate-700 leading-relaxed">${html}</div>
    </section>
  `;
}

// Badge GDPR riutilizzabile — esportato per il form iscrizione
export function gdprBadgeInline(size = 14) {
  // SVG scudo con check verde "GDPR Compliant" — coerente con icone Carbon stroke
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="#15803d" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-2px;display:inline-block"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><polyline points="9 12 11 14 15 10"/></svg>`;
}

export function gdprBadgeFull() {
  // Versione "logo" più visibile — scudo verde + scritta GDPR
  return `
    <div class="inline-flex items-center gap-2 bg-emerald-50 border border-emerald-200 rounded-xl px-3 py-1.5 text-emerald-900" title="Trattamento conforme al Regolamento (UE) 2016/679">
      <svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#15803d" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><polyline points="9 12 11 14 15 10"/></svg>
      <div class="leading-tight">
        <div class="font-bold text-[11px] uppercase tracking-wider">GDPR</div>
        <div class="text-[9px] -mt-0.5 text-emerald-700">UE 2016/679</div>
      </div>
    </div>
  `;
}

// ============================================================================
// /#/privacy/diritti — strumento per esportare o cancellare i propri dati
// ============================================================================
function renderDiritti(root) {
  const q = new URLSearchParams(location.hash.split('?')[1] || '');
  const initialToken = q.get('t') || '';

  root.innerHTML = `
    <section class="view-fade c-page max-w-2xl mx-auto pb-10">
      <header class="bg-white border border-slate-200 rounded-3xl shadow-soft p-5 mb-6 flex items-start gap-4">
        ${gdprBadgeFull()}
        <div class="min-w-0 flex-1">
          <h1 class="text-xl font-black text-ink-900 leading-tight">Esercita i tuoi diritti</h1>
          <p class="text-sm text-slate-600 mt-1">Diritto di accesso (Art. 15), portabilità (Art. 20), oblio (Art. 17).</p>
        </div>
      </header>

      <div class="bg-white border border-slate-200 rounded-3xl shadow-soft p-6 mb-4">
        <label class="c-field">
          <span class="c-field__label">Token di verifica *</span>
          <input id="diritti-token" type="text" class="c-input font-mono" value="${escapeHtml(initialToken)}" placeholder="Es. tk_abc123xyz…" />
          <p class="text-[11px] text-slate-500 mt-1">Lo trovi nell'email di conferma ricevuta al momento dell'iscrizione (parametro <code>?t=</code> del link). Se l'hai smarrito, contatta il Titolare via email.</p>
        </label>

        <div class="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-5">
          <button id="btn-export" class="c-btn c-btn--primary justify-center inline-flex items-center gap-1.5">
            ${icon('download', { size: 14 })}
            <span>Esporta i miei dati (JSON)</span>
          </button>
          <button id="btn-erase" class="c-btn c-btn--outline justify-center inline-flex items-center gap-1.5 text-rose-700 border-rose-300 hover:bg-rose-50">
            ${icon('trash', { size: 14 })}
            <span>Cancella tutti i miei dati</span>
          </button>
        </div>
        <p class="text-[11px] text-slate-500 mt-3"><strong>Cancellazione</strong>: rimuove definitivamente la tua iscrizione, il record candidato collegato (se approvato) e i dati associati. Operazione irreversibile.</p>
      </div>

      <div id="diritti-result" class="hidden"></div>

      <div class="text-center">
        <a href="#/privacy" class="c-btn c-btn--outline c-btn--sm">← Torna all'informativa</a>
      </div>
    </section>
  `;

  const tokenIn = root.querySelector('#diritti-token');
  const resultEl = root.querySelector('#diritti-result');

  root.querySelector('#btn-export').addEventListener('click', async () => {
    const token = tokenIn.value.trim();
    if (!token || token.length < 8) { toast('Inserisci un token valido', 'error'); return; }
    try {
      const res = await fetch(`/api/privacy/export?t=${encodeURIComponent(token)}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      // Download JSON + visualizzazione
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `miei-dati-iscrizione-${data.iscrizione?.id || 'export'}.json`;
      a.click();
      URL.revokeObjectURL(a.href);
      resultEl.classList.remove('hidden');
      resultEl.innerHTML = `
        <div class="bg-emerald-50 border border-emerald-200 rounded-2xl p-4 text-sm">
          <p class="font-bold text-emerald-900">✓ Dati esportati</p>
          <p class="mt-1 text-emerald-800">Il file JSON è stato scaricato. Contiene tutti i dati personali che il Titolare detiene su di te.</p>
          <details class="mt-3">
            <summary class="cursor-pointer text-xs font-mono uppercase tracking-wider text-emerald-700">Mostra anteprima</summary>
            <pre class="mt-2 bg-white border border-emerald-200 rounded p-2 text-[11px] overflow-x-auto max-h-80">${escapeHtml(JSON.stringify(data, null, 2))}</pre>
          </details>
        </div>
      `;
    } catch (e) {
      resultEl.classList.remove('hidden');
      resultEl.innerHTML = `<div class="bg-rose-50 border border-rose-200 rounded-2xl p-4 text-sm text-rose-900">✗ ${escapeHtml(e.message || 'Errore')}</div>`;
    }
  });

  root.querySelector('#btn-erase').addEventListener('click', async () => {
    const token = tokenIn.value.trim();
    if (!token || token.length < 8) { toast('Inserisci un token valido', 'error'); return; }
    const phrase = 'CANCELLA I MIEI DATI';
    const typed = prompt(`Per confermare la cancellazione PERMANENTE digita esattamente:\n\n${phrase}`);
    if (typed !== phrase) { toast('Cancellazione annullata', 'info'); return; }
    try {
      const res = await fetch(`/api/privacy/erase?t=${encodeURIComponent(token)}`, { method: 'DELETE' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      resultEl.classList.remove('hidden');
      resultEl.innerHTML = `
        <div class="bg-emerald-50 border border-emerald-200 rounded-2xl p-4 text-sm">
          <p class="font-bold text-emerald-900">✓ Dati cancellati</p>
          <p class="mt-1 text-emerald-800">Tutte le informazioni personali sono state rimosse definitivamente. Riceverai una conferma all'email registrata.</p>
          <pre class="mt-3 bg-white border border-emerald-200 rounded p-2 text-[11px] overflow-x-auto">${escapeHtml(JSON.stringify(data, null, 2))}</pre>
        </div>
      `;
    } catch (e) {
      resultEl.classList.remove('hidden');
      resultEl.innerHTML = `<div class="bg-rose-50 border border-rose-200 rounded-2xl p-4 text-sm text-rose-900">✗ ${escapeHtml(e.message || 'Errore')}</div>`;
    }
  });
}
