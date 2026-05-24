/**
 * Privacy.tsx — Informativa GDPR pubblica.
 *
 * Port di js/views/privacy.js. Pagina pubblica — NON usa AppLayout.
 * Contiene:
 *   - Informativa completa (titolare, dati, finalità, retention, diritti)
 *   - Sezione "/privacy/diritti" per export/erase dati via token
 *
 * Il branding (logo/nome) viene caricato da GET /api/ente/public (no auth).
 * Presentazione replica 1:1 la vanilla JS (c-tile, c-btn, c-field, ink/brand).
 */

import { useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { publicApi } from '@/api/public';
import { ShieldCheck, Download, Trash2 } from 'lucide-react';

// ─── Badge GDPR full (scudo verde + scritta) ──────────────────────────────────

export function GdprBadge() {
  return (
    <div
      className="inline-flex items-center gap-2 bg-emerald-50 border border-emerald-200 rounded-xl px-3 py-1.5 text-emerald-900"
      title="Trattamento conforme al Regolamento (UE) 2016/679"
    >
      <svg
        xmlns="http://www.w3.org/2000/svg"
        width="28"
        height="28"
        viewBox="0 0 24 24"
        fill="none"
        stroke="#15803d"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
        <polyline points="9 12 11 14 15 10" />
      </svg>
      <div className="leading-tight">
        <div className="font-bold text-[11px] uppercase tracking-wider">GDPR</div>
        <div className="text-[9px] -mt-0.5 text-emerald-700">UE 2016/679</div>
      </div>
    </div>
  );
}

// ─── Badge GDPR inline (solo scudo, piccolo) ─────────────────────────────────

function GdprBadgeInline() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="#15803d"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      style={{ verticalAlign: '-2px', display: 'inline-block' }}
    >
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
      <polyline points="9 12 11 14 15 10" />
    </svg>
  );
}

// ─── Section tile (replica vanilla `section()` helper) ───────────────────────

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="bg-white border border-slate-200 rounded-3xl shadow-soft p-6 mb-4">
      <h2 className="font-bold text-lg text-ink-900 mb-3">{title}</h2>
      <div className="text-sm text-slate-700 leading-relaxed">{children}</div>
    </section>
  );
}

// ─── Strumenti diritti GDPR ───────────────────────────────────────────────────

function DirittiPanel() {
  const [searchParams] = useSearchParams();
  const [token, setToken] = useState(searchParams.get('t') ?? '');
  const [result, setResult] = useState<{
    kind: 'export-ok' | 'erase-ok' | 'err';
    content: string;
  } | null>(null);
  const [loading, setLoading] = useState(false);
  const resultRef = useRef<HTMLDivElement>(null);

  async function handleExport() {
    const t = token.trim();
    if (!t || t.length < 8) { alert('Inserisci un token valido'); return; }
    setLoading(true);
    try {
      const res = await fetch(`/api/privacy/export?t=${encodeURIComponent(t)}`);
      const data: unknown = await res.json();
      if (!res.ok) throw new Error((data as { error?: string })?.error ?? `HTTP ${res.status}`);
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `miei-dati-iscrizione-${(data as { iscrizione?: { id?: string } })?.iscrizione?.id ?? 'export'}.json`;
      a.click();
      URL.revokeObjectURL(a.href);
      setResult({ kind: 'export-ok', content: JSON.stringify(data, null, 2) });
    } catch (e) {
      setResult({ kind: 'err', content: (e as Error).message ?? 'Errore' });
    } finally {
      setLoading(false);
      setTimeout(() => resultRef.current?.scrollIntoView({ behavior: 'smooth' }), 100);
    }
  }

  async function handleErase() {
    const t = token.trim();
    if (!t || t.length < 8) { alert('Inserisci un token valido'); return; }
    const phrase = 'CANCELLA I MIEI DATI';
    const typed = window.prompt(
      `Per confermare la cancellazione PERMANENTE digita esattamente:\n\n${phrase}`,
    );
    if (typed !== phrase) { return; }
    setLoading(true);
    try {
      const res = await fetch(`/api/privacy/erase?t=${encodeURIComponent(t)}`, { method: 'DELETE' });
      const data: unknown = await res.json();
      if (!res.ok) throw new Error((data as { error?: string })?.error ?? `HTTP ${res.status}`);
      setResult({ kind: 'erase-ok', content: JSON.stringify(data, null, 2) });
    } catch (e) {
      setResult({ kind: 'err', content: (e as Error).message ?? 'Errore' });
    } finally {
      setLoading(false);
      setTimeout(() => resultRef.current?.scrollIntoView({ behavior: 'smooth' }), 100);
    }
  }

  return (
    <section className="view-fade c-page max-w-2xl mx-auto pb-10">
      {/* Header */}
      <header className="bg-white border border-slate-200 rounded-3xl shadow-soft p-5 mb-6 flex items-start gap-4">
        <GdprBadge />
        <div className="min-w-0 flex-1">
          <h1 className="text-xl font-black text-ink-900 leading-tight">Esercita i tuoi diritti</h1>
          <p className="text-sm text-slate-600 mt-1">
            Diritto di accesso (Art.&nbsp;15), portabilità (Art.&nbsp;20), oblio (Art.&nbsp;17).
          </p>
        </div>
      </header>

      {/* Token + azioni */}
      <div className="bg-white border border-slate-200 rounded-3xl shadow-soft p-6 mb-4">
        <label className="c-field">
          <span className="c-field__label">Token di verifica *</span>
          <input
            type="text"
            className="c-input font-mono"
            value={token}
            onChange={(e) => setToken(e.target.value)}
            placeholder="Es. tk_abc123xyz…"
          />
          <p className="text-[11px] text-slate-500 mt-1">
            Lo trovi nell'email di conferma ricevuta al momento dell'iscrizione (parametro{' '}
            <code>?t=</code> del link). Se l'hai smarrito, contatta il Titolare via email.
          </p>
        </label>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-5">
          <button
            className="c-btn c-btn--primary justify-center"
            onClick={handleExport}
            disabled={loading}
          >
            <Download size={14} />
            <span>Esporta i miei dati (JSON)</span>
          </button>
          <button
            className="c-btn c-btn--outline justify-center text-rose-700 border-rose-300 hover:bg-rose-50"
            onClick={handleErase}
            disabled={loading}
          >
            <Trash2 size={14} />
            <span>Cancella tutti i miei dati</span>
          </button>
        </div>

        <p className="text-[11px] text-slate-500 mt-3">
          <strong>Cancellazione</strong>: rimuove definitivamente la tua iscrizione, il record
          candidato collegato (se approvato) e i dati associati. Operazione irreversibile.
        </p>
      </div>

      {/* Risultato */}
      <div ref={resultRef}>
        {result && (
          <>
            {result.kind === 'export-ok' && (
              <div className="bg-emerald-50 border border-emerald-200 rounded-2xl p-4 text-sm mb-4">
                <p className="font-bold text-emerald-900">✓ Dati esportati</p>
                <p className="mt-1 text-emerald-800">
                  Il file JSON è stato scaricato. Contiene tutti i dati personali che il Titolare
                  detiene su di te.
                </p>
                <details className="mt-3">
                  <summary className="cursor-pointer text-xs font-mono uppercase tracking-wider text-emerald-700">
                    Mostra anteprima
                  </summary>
                  <pre className="mt-2 bg-white border border-emerald-200 rounded p-2 text-[11px] overflow-x-auto max-h-80">
                    {result.content}
                  </pre>
                </details>
              </div>
            )}
            {result.kind === 'erase-ok' && (
              <div className="bg-emerald-50 border border-emerald-200 rounded-2xl p-4 text-sm mb-4">
                <p className="font-bold text-emerald-900">✓ Dati cancellati</p>
                <p className="mt-1 text-emerald-800">
                  Tutte le informazioni personali sono state rimosse definitivamente. Riceverai una
                  conferma all'email registrata.
                </p>
                <pre className="mt-3 bg-white border border-emerald-200 rounded p-2 text-[11px] overflow-x-auto">
                  {result.content}
                </pre>
              </div>
            )}
            {result.kind === 'err' && (
              <div className="bg-rose-50 border border-rose-200 rounded-2xl p-4 text-sm mb-4 text-rose-900">
                ✗ {result.content}
              </div>
            )}
          </>
        )}
      </div>

      <div className="text-center">
        <a href="/privacy" className="c-btn c-btn--outline c-btn--sm">
          ← Torna all'informativa
        </a>
      </div>
    </section>
  );
}

// ─── Main ─────────────────────────────────────────────────────────────────────

export default function Privacy() {
  const isDiritti =
    window.location.pathname.endsWith('/diritti') ||
    window.location.hash.includes('/privacy/diritti');

  const brandQ = useQuery({
    queryKey: ['ente-public'],
    queryFn: () => publicApi.getEnteBranding(),
    staleTime: 300_000,
  });
  const brand = brandQ.data;
  const nomePubblico =
    brand?.brandingPublic?.nomePubblico ?? brand?.nome ?? 'Informativa GDPR';
  const logoUrl = brand?.brandingPublic?.logoUrl;

  if (isDiritti) {
    return (
      <div className="min-h-screen bg-canvas py-8 px-4">
        <DirittiPanel />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-canvas py-8 px-4">
      <section className="view-fade c-page max-w-3xl mx-auto pb-10">

        {/* Header — replica vanilla: logo + eyebrow GDPR badge + titolo + sub */}
        <header className="bg-white border border-slate-200 rounded-3xl shadow-soft p-5 mb-6 flex items-start gap-4">
          {logoUrl && (
            <img
              src={logoUrl}
              alt=""
              className="w-16 h-16 rounded-2xl object-contain border border-slate-100 shrink-0"
            />
          )}
          <div className="min-w-0 flex-1">
            <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-brand-700 font-bold flex items-center gap-1.5">
              <GdprBadgeInline />
              Informativa privacy
            </p>
            <h1 className="text-2xl font-black text-ink-900 leading-tight">{nomePubblico}</h1>
            <p className="text-sm text-slate-600 mt-1">
              Trattamento dei dati personali ai sensi del Regolamento (UE)&nbsp;2016/679 (GDPR)
            </p>
          </div>
        </header>

        {/* 1. Titolare */}
        <Section title="1. Titolare del trattamento">
          <p>Il Titolare del trattamento dei dati personali è:</p>
          <ul className="mt-2 ml-5 list-disc space-y-1">
            <li>
              <strong>{nomePubblico}</strong>
            </li>
          </ul>
          <p className="mt-2 text-xs text-slate-500">
            Per esercitare i tuoi diritti o richiedere informazioni, contatta direttamente l'ente
            organizzatore.
          </p>
        </Section>

        {/* 2. Categorie dati */}
        <Section title="2. Categorie di dati trattati">
          <ul className="ml-5 list-disc space-y-1">
            <li>
              <strong>Dati anagrafici</strong>: nome, cognome, data di nascita, luogo di nascita,
              sesso (facoltativo), nazionalità, codice fiscale.
            </li>
            <li>
              <strong>Dati di contatto</strong>: email, telefono, indirizzo postale.
            </li>
            <li>
              <strong>Dati del tutore</strong> (solo per candidati minorenni): nome, cognome,
              email, telefono.
            </li>
            <li>
              <strong>Dati artistici</strong>: strumento, anni di studio, scuola di provenienza,
              docenti preparatori, programma musicale.
            </li>
            <li>
              <strong>Documenti</strong>: foto identificativa, documento d'identità, ricevuta
              pagamento quota, autorizzazione genitoriale.
            </li>
            <li>
              <strong>Dati di valutazione</strong>: voti assegnati dai commissari, classifiche,
              esiti.
            </li>
            <li>
              <strong>Metadati tecnici</strong>: timestamp di iscrizione, indirizzo IP
              anonimizzato (ultimo ottetto azzerato), user-agent del browser.
            </li>
          </ul>
        </Section>

        {/* 3. Finalità e base giuridica */}
        <Section title="3. Finalità e base giuridica">
          <p>I dati sono trattati per le seguenti finalità:</p>
          <table className="w-full text-sm mt-3 border border-slate-200 rounded-lg overflow-hidden">
            <thead className="bg-slate-50">
              <tr>
                <th className="text-left p-2">Finalità</th>
                <th className="text-left p-2">Base giuridica</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              <tr>
                <td className="p-2">Iscrizione al concorso e gestione amministrativa</td>
                <td className="p-2">Art.&nbsp;6(1)(b) — esecuzione del contratto</td>
              </tr>
              <tr>
                <td className="p-2">Valutazione delle prove + protocolli pubblici (classifiche)</td>
                <td className="p-2">Art.&nbsp;6(1)(b) — esecuzione del contratto</td>
              </tr>
              <tr>
                <td className="p-2">Comunicazioni email organizzative</td>
                <td className="p-2">Art.&nbsp;6(1)(b) — esecuzione del contratto</td>
              </tr>
              <tr>
                <td className="p-2">Uso delle immagini/video del concorso</td>
                <td className="p-2">Art.&nbsp;6(1)(a) — consenso esplicito (revocabile)</td>
              </tr>
              <tr>
                <td className="p-2">Adempimenti fiscali e di legge</td>
                <td className="p-2">Art.&nbsp;6(1)(c) — obbligo legale</td>
              </tr>
            </tbody>
          </table>
        </Section>

        {/* 4. Retention */}
        <Section title="4. Conservazione (retention)">
          <p>
            I dati personali sono conservati per il tempo necessario alla gestione del concorso e
            degli adempimenti correlati, e non oltre 24&nbsp;mesi dalla conclusione, salvo obblighi
            di legge superiori (es. documentazione fiscale: 10&nbsp;anni).
          </p>
          <p className="mt-2">
            I dati di valutazione (classifiche, verbali) sono pubblicati per la durata richiesta dal
            regolamento del concorso e successivamente archiviati o anonimizzati.
          </p>
        </Section>

        {/* 5. Destinatari */}
        <Section title="5. Destinatari">
          <ul className="ml-5 list-disc space-y-1">
            <li>Commissari di gara designati dal Titolare</li>
            <li>Personale amministrativo del Titolare</li>
            <li>
              Responsabili esterni: fornitore di hosting VPS, servizio email transazionale (SMTP
              del Titolare)
            </li>
            <li>Autorità (su richiesta motivata)</li>
          </ul>
          <p className="mt-2 text-xs text-slate-600">
            Nessuna profilazione automatizzata, nessun trasferimento extra-UE.
          </p>
        </Section>

        {/* 6. Diritti — include CTA "Strumenti automatici" */}
        <Section title="6. Diritti dell'interessato">
          <p>Hai diritto di esercitare i seguenti diritti (artt.&nbsp;15-22 GDPR):</p>
          <ul className="ml-5 list-disc space-y-1 mt-2">
            <li><strong>Accesso</strong> ai tuoi dati personali</li>
            <li><strong>Rettifica</strong> dei dati inesatti</li>
            <li><strong>Cancellazione</strong> ("diritto all'oblio")</li>
            <li><strong>Limitazione</strong> del trattamento</li>
            <li><strong>Portabilità</strong> dei dati in formato strutturato (JSON)</li>
            <li><strong>Opposizione</strong> al trattamento</li>
            <li><strong>Revoca</strong> del consenso (uso immagini)</li>
            <li>
              <strong>Reclamo</strong> all'
              <a
                href="https://www.garanteprivacy.it"
                target="_blank"
                rel="noreferrer"
                className="text-brand-700"
              >
                Autorità Garante
              </a>
            </li>
          </ul>
          <div className="mt-4 bg-emerald-50 border border-emerald-200 rounded-xl p-4">
            <p className="text-sm font-semibold text-emerald-900 mb-2">
              Strumenti automatici per esercitare i diritti
            </p>
            <p className="text-xs text-emerald-800 mb-3">
              Hai bisogno del <strong>token di verifica</strong> che ti è stato inviato all'email
              al momento dell'iscrizione (link di conferma).
            </p>
            <a
              href="/privacy/diritti"
              className="c-btn c-btn--outline c-btn--sm inline-flex items-center gap-1.5"
            >
              <ShieldCheck size={14} />
              <span>Accedi / esporta / cancella i miei dati</span>
            </a>
          </div>
        </Section>

        {/* 7. Modalità */}
        <Section title="7. Modalità di trattamento">
          <p>
            I dati sono trattati con strumenti elettronici, presso server localizzati
            nell'Unione Europea, con misure tecniche e organizzative atte a garantire la sicurezza
            e la riservatezza:
          </p>
          <ul className="ml-5 list-disc space-y-1 mt-2">
            <li>Connessione cifrata HTTPS (TLS&nbsp;1.2+) per tutti gli accessi</li>
            <li>Autenticazione con password personali</li>
            <li>Audit log delle operazioni amministrative (IP anonimizzato)</li>
            <li>Backup cifrati e con accesso limitato</li>
            <li>Separazione logica dei dati per ente (multitenant isolato)</li>
          </ul>
        </Section>

        <div className="text-center mt-8">
          <a href="/" className="c-btn c-btn--outline c-btn--sm">
            Torna alla home
          </a>
        </div>
      </section>
    </div>
  );
}
