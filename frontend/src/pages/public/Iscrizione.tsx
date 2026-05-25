/**
 * Iscrizione.tsx — Form pubblico iscrizione auto-service.
 *
 * Port di js/views/iscrizione.js. Pagina pubblica — NON usa AppLayout.
 * Sezioni: anagrafica, tutore (se minorenne), contatti, dati artistici,
 *          composizione gruppo (se ensemble/orchestra), programma,
 *          allegati, privacy + consensi.
 *
 * Anti-spam: honeypot (campo "website" invisibile) + startedAt (min-time-on-page).
 * Draft persistito in localStorage.
 *
 * Presentation: c-page / c-field / c-input / c-select / c-textarea / c-btn
 * (sistema legacy.css), palette brand/ink/amber/emerald/rose.
 */

import { useEffect, useRef, useState } from 'react';
import { useForm, useFieldArray, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { publicApi, type ConcorsoDetailPublic } from '@/api/public';
import { httpErrorMessage } from '@/lib/api';
import { resizeImageToFile } from '@/lib/image';
import { NATIONALITIES } from '@/lib/nationalities';
import { GdprBadge } from './Privacy';

// Limite dimensione allegato lato client (il server applica comunque il proprio).
const MAX_ALLEGATO_BYTES = 2 * 1024 * 1024;

// ─── Calcolo età ──────────────────────────────────────────────────────────────

function calcEta(iso: string | undefined | null): number | null {
  if (!iso) return null;
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

// ─── Draft localStorage ───────────────────────────────────────────────────────

const DRAFT_KEY = 'iscrizione_draft_v3';
function loadDraft(): Partial<FormValues> {
  try { return JSON.parse(localStorage.getItem(DRAFT_KEY) ?? '{}') as Partial<FormValues>; } catch { return {}; }
}
function saveDraft(d: Partial<FormValues>) {
  try { localStorage.setItem(DRAFT_KEY, JSON.stringify(d)); } catch { /* noop */ }
}
function clearDraft() {
  try { localStorage.removeItem(DRAFT_KEY); } catch { /* noop */ }
}

// ─── Zod schema ───────────────────────────────────────────────────────────────

const programmaRow = z.object({
  titolo: z.string().min(1, 'Titolo obbligatorio'),
  autore: z.string().optional(),
  durata_min: z.coerce.number().min(0).max(120).optional(),
});

const membroRow = z.object({
  nome: z.string().min(1),
  cognome: z.string().optional(),
  strumento: z.string().optional(),
  data_nascita: z.string().optional(),
});

const schema = z.object({
  tipo: z.enum(['individuale', 'gruppo', 'orchestra']),
  // Anagrafica
  nome: z.string().min(1, 'Nome obbligatorio'),
  cognome: z.string().min(1, 'Cognome obbligatorio'),
  sesso: z.string().optional(),
  data_nascita: z.string().min(1, 'Data di nascita obbligatoria'),
  luogo_nascita: z.string().optional(),
  nazionalita: z.string().min(1, 'Nazionalità obbligatoria'),
  codice_fiscale: z.string().optional(),
  // Tutore (opzionale a livello schema — validato runtime)
  tutore_nome: z.string().optional(),
  tutore_cognome: z.string().optional(),
  tutore_email: z.string().optional(),
  tutore_telefono: z.string().optional(),
  // Contatti
  email: z.string().email('Email non valida'),
  telefono: z.string().optional(),
  indirizzo: z.string().optional(),
  citta: z.string().optional(),
  cap: z.string().optional(),
  provincia: z.string().optional(),
  paese: z.string().optional(),
  // Artistici
  strumento: z.string().min(1, 'Strumento obbligatorio'),
  anni_studio: z.coerce.number().min(0).max(99).optional(),
  sezione: z.string().optional(),
  categoria: z.string().optional(),
  scuola_provenienza: z.string().optional(),
  docenti_preparatori_text: z.string().optional(),
  // Gruppo
  gruppo_nome: z.string().optional(),
  membri: z.array(membroRow).optional(),
  // Programma
  programma: z.array(programmaRow).min(1, 'Almeno un brano obbligatorio'),
  note_libere: z.string().optional(),
  // Privacy
  consenso_privacy: z.literal(true, { error: 'Consenso privacy obbligatorio' }),
  consenso_immagini: z.boolean().optional(),
  consenso_regolamento: z.literal(true, { error: 'Consenso regolamento obbligatorio' }),
  // Anti-spam (non visibili/validati dall'utente)
  website: z.string().optional(),   // honeypot
  startedAt: z.number().optional(), // timestamp apertura form
});

type FormValues = z.infer<typeof schema>;

// ─── Section header (stile vanilla) ──────────────────────────────────────────

function SectionHeader({ num, title, subtitle }: { num: string; title: string; subtitle: string }) {
  return (
    <header className="flex items-center gap-3 mb-1">
      <span className="w-7 h-7 rounded-full bg-brand-100 text-brand-700 text-sm font-bold inline-flex items-center justify-center shrink-0">{num}</span>
      <div>
        <h2 className="font-semibold text-ink-900">{title}</h2>
        <p className="text-xs text-slate-600">{subtitle}</p>
      </div>
    </header>
  );
}

// ─── c-field wrapper ──────────────────────────────────────────────────────────

function CField({
  label,
  hint,
  error,
  className,
  children,
}: {
  label?: string;
  hint?: string;
  error?: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={`c-field${className ? ` ${className}` : ''}`}>
      {label && <span className="c-field__label">{label}</span>}
      {children}
      {hint && <p className="c-field__hint">{hint}</p>}
      {error && <p className="text-xs text-rose-600 mt-0.5">{error}</p>}
    </div>
  );
}

// ─── Upload allegato helper ───────────────────────────────────────────────────

const ALLEGATO_TIPI: Record<string, 'foto' | 'documento' | 'ricevuta' | 'altro'> = {
  foto: 'foto',
  documento_identita: 'documento',
  ricevuta_pagamento: 'ricevuta',
  autorizzazione_minore: 'altro',
};

// ─── Main page ────────────────────────────────────────────────────────────────

export default function Iscrizione() {
  const { t } = useTranslation();
  const startedAtRef = useRef<number>(Date.now());

  // Carica draft
  const savedDraft = loadDraft();

  const form = useForm<FormValues, unknown, FormValues>({
    resolver: zodResolver(schema) as any,
    defaultValues: {
      tipo: (savedDraft.tipo!) ?? 'individuale',
      nome: savedDraft.nome ?? '',
      cognome: savedDraft.cognome ?? '',
      sesso: savedDraft.sesso ?? '',
      data_nascita: savedDraft.data_nascita ?? '',
      luogo_nascita: savedDraft.luogo_nascita ?? '',
      nazionalita: savedDraft.nazionalita ?? '',
      codice_fiscale: savedDraft.codice_fiscale ?? '',
      tutore_nome: savedDraft.tutore_nome ?? '',
      tutore_cognome: savedDraft.tutore_cognome ?? '',
      tutore_email: savedDraft.tutore_email ?? '',
      tutore_telefono: savedDraft.tutore_telefono ?? '',
      email: savedDraft.email ?? '',
      telefono: savedDraft.telefono ?? '',
      indirizzo: savedDraft.indirizzo ?? '',
      citta: savedDraft.citta ?? '',
      cap: savedDraft.cap ?? '',
      provincia: savedDraft.provincia ?? '',
      paese: savedDraft.paese ?? 'Italia',
      strumento: savedDraft.strumento ?? '',
      anni_studio: savedDraft.anni_studio ?? undefined,
      sezione: savedDraft.sezione ?? '',
      categoria: savedDraft.categoria ?? '',
      scuola_provenienza: savedDraft.scuola_provenienza ?? '',
      docenti_preparatori_text: savedDraft.docenti_preparatori_text ?? '',
      gruppo_nome: savedDraft.gruppo_nome ?? '',
      membri: (savedDraft.membri) ?? [],
      programma: (savedDraft.programma) ?? [{ titolo: '', autore: '', durata_min: undefined }],
      note_libere: savedDraft.note_libere ?? '',
      consenso_privacy: undefined as unknown as true,
      consenso_immagini: savedDraft.consenso_immagini ?? false,
      consenso_regolamento: undefined as unknown as true,
      website: '',
      startedAt: startedAtRef.current,
    },
  });

  const { register, control, handleSubmit, watch, setValue, formState: { errors } } = form;

  // watch per dipendenze visive
  const tipo = watch('tipo');
  const dataNascita = watch('data_nascita');
  const sezioneVal = watch('sezione');
  const eta = calcEta(dataNascita);
  const isMinore = eta !== null && eta < 18;
  const isGruppo = tipo === 'gruppo' || tipo === 'orchestra';

  // Persisti draft ad ogni change
  useEffect(() => {
    const sub = form.watch((vals) => saveDraft(vals as Partial<FormValues>));
    return () => sub.unsubscribe();
  }, [form]);

  // Field arrays
  const programmaArray = useFieldArray({ control, name: 'programma' });
  const membriArray = useFieldArray({ control, name: 'membri' });

  // File refs (file input non è controllato da RHF)
  const fileRefs: Record<string, React.RefObject<HTMLInputElement | null>> = {
    foto: useRef<HTMLInputElement | null>(null),
    documento_identita: useRef<HTMLInputElement | null>(null),
    ricevuta_pagamento: useRef<HTMLInputElement | null>(null),
    autorizzazione_minore: useRef<HTMLInputElement | null>(null),
  };

  // Concorso aperto
  const concorsiQ = useQuery({
    queryKey: ['pub-concorsi'],
    queryFn: () => publicApi.listConcorsiAperti(),
    staleTime: 60_000,
  });
  const firstConcorso = concorsiQ.data?.[0];

  const concorsoQ = useQuery({
    queryKey: ['pub-concorso', firstConcorso?.id],
    queryFn: () => publicApi.getConcorso(firstConcorso!.id),
    enabled: !!firstConcorso?.id,
    staleTime: 120_000,
  });
  const concorso: ConcorsoDetailPublic | undefined = concorsoQ.data;
  const sezioni = concorso?.sezioni ?? [];
  const categorie = concorso?.categorie ?? [];
  const categorieDellaSezione = sezioneVal ? categorie.filter((c) => c.sezioneId === sezioneVal) : [];

  // Submit
  const [success, setSuccess] = useState<{ id: string; email: string; nome: string } | null>(null);

  const submitMut = useMutation({
    mutationFn: async (vals: FormValues) => {
      if (!concorso) throw new Error('Nessun concorso disponibile');
      const docentiArr = (vals.docenti_preparatori_text ?? '').split('\n').map((s) => s.trim()).filter(Boolean);
      const validBrani = (vals.programma ?? []).filter((p) => p.titolo);
      const payload = {
        concorsoId: concorso.id,
        website: vals.website ?? '',
        startedAt: vals.startedAt ?? startedAtRef.current,
        nome: vals.nome,
        cognome: vals.cognome,
        email: vals.email,
        telefono: vals.telefono,
        dataNascita: vals.data_nascita,
        nazionalita: vals.nazionalita,
        luogoNascita: vals.luogo_nascita,
        sesso: vals.sesso,
        codiceFiscale: vals.codice_fiscale,
        indirizzo: vals.indirizzo,
        citta: vals.citta,
        cap: vals.cap,
        provincia: vals.provincia,
        paese: vals.paese,
        strumento: vals.strumento,
        anniStudio: vals.anni_studio,
        scuolaProvenienza: vals.scuola_provenienza,
        programma: validBrani,
        docentiPreparatori: docentiArr,
        sezioneId: vals.sezione || undefined,
        categoriaId: vals.categoria || undefined,
        isGruppo: isGruppo,
        gruppoNome: isGruppo ? vals.gruppo_nome : undefined,
        tipoGruppo: isGruppo ? (tipo === 'orchestra' ? 'orchestra' as const : 'ensemble' as const) : undefined,
        membri: isGruppo ? (vals.membri ?? []).filter((m) => m.nome) : undefined,
        tutore: isMinore ? {
          nome: vals.tutore_nome,
          cognome: vals.tutore_cognome,
          email: vals.tutore_email,
          telefono: vals.tutore_telefono,
        } : undefined,
        consensiGdpr: {
          privacy: true as const,
          regolamento: true as const,
          immagini: vals.consenso_immagini ?? false,
        },
        noteLibere: vals.note_libere,
      };
      const res = await publicApi.createIscrizione(payload);

      // Upload allegati (best-effort). La foto viene ridimensionata (max 800px)
      // prima dell'invio; i file oltre 2 MB vengono scartati con avviso.
      const failedUploads: string[] = [];
      if (res.uploadToken) {
        for (const [field, tipoAllegato] of Object.entries(ALLEGATO_TIPI)) {
          const inp = fileRefs[field]?.current;
          let file = inp?.files?.[0];
          if (!file) continue;
          if (tipoAllegato === 'foto') file = await resizeImageToFile(file, 800, 0.85);
          if (file.size > MAX_ALLEGATO_BYTES) {
            failedUploads.push(field);
            continue;
          }
          try {
            await publicApi.uploadAllegato(res.uploadToken, tipoAllegato, file);
          } catch (err) {
            console.warn('Upload allegato fallito:', field, err);
            failedUploads.push(field);
          }
        }
      }
      return { ...res, failedUploads };
    },
    onSuccess: (res) => {
      clearDraft();
      const vals = form.getValues();
      if (res.failedUploads.length > 0) {
        toast.warning(
          t('iscr.upload.partial_fail', {
            defaultValue:
              'Iscrizione inviata, ma alcuni allegati non sono stati caricati (formato o dimensione, max 2 MB). Potrai ricaricarli contattando la segreteria.',
          }),
        );
      }
      setSuccess({ id: res.iscrizioneId, email: vals.email, nome: vals.nome });
    },
    onError: (err) => {
      const msg = httpErrorMessage(err);
      toast.error(msg);
    },
  });

  // ── Success ─────────────────────────────────────────────────────────────────
  if (success) {
    return (
      <section className="view-fade c-page max-w-2xl mx-auto py-10 text-center">
        <div className="bg-white border border-emerald-200 rounded-3xl shadow-soft p-10">
          <div className="text-6xl mb-4">🎉</div>
          <h1 className="text-2xl font-black text-ink-900 mb-2">Iscrizione inviata</h1>
          <p className="text-slate-700 leading-relaxed mb-3">
            La tua iscrizione a <strong>{concorso?.nome}</strong> è stata ricevuta correttamente.
          </p>
          <p className="text-sm text-slate-600 mb-1">Riceverai una mail di conferma a:</p>
          <p className="font-mono text-brand-700 font-semibold mb-4">{success.email}</p>
          <p className="text-xs text-slate-500">
            Numero pratica:{' '}
            <code className="bg-slate-100 px-2 py-0.5 rounded font-mono text-[11px]">{success.id}</code>
          </p>
          <p className="text-sm text-slate-600 mt-6 leading-relaxed">
            L'organizzazione esaminerà la tua candidatura e ti contatterà con l'esito.
          </p>
          <a href="/" className="c-btn c-btn--outline c-btn--sm mt-6">Chiudi</a>
        </div>
      </section>
    );
  }

  // ── Caricamento ──────────────────────────────────────────────────────────────
  if (concorsiQ.isLoading || concorsoQ.isLoading) {
    return (
      <section className="view-fade min-h-[60vh] flex items-center justify-center c-page">
        <div className="text-center">
          <svg
            className="w-8 h-8 text-brand-500 mx-auto mb-3"
            style={{ animation: 'spin 1.4s linear infinite' }}
            viewBox="0 0 24 24" fill="none"
          >
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
          </svg>
          <p className="text-ink-900 font-medium">{t('iscr.loading')}</p>
        </div>
      </section>
    );
  }

  // ── Nessun concorso aperto ───────────────────────────────────────────────────
  if (!concorso) {
    return (
      <section className="view-fade min-h-[60vh] flex items-center justify-center c-page">
        <div className="bg-white rounded-3xl shadow-soft border border-slate-200 max-w-xl w-full p-10 text-center">
          <div className="text-5xl mb-4">📭</div>
          <h1 className="text-2xl font-bold text-ink-900 mb-2">{t('iscr.closed.title')}</h1>
          <p className="text-slate-600 leading-relaxed">{t('iscr.closed.subtitle')}</p>
          <a href="/" className="c-btn c-btn--outline c-btn--sm mt-6">{t('iscr.closed.cta')}</a>
        </div>
      </section>
    );
  }

  // ── Form ─────────────────────────────────────────────────────────────────────
  return (
    <section className="view-fade c-page max-w-3xl mx-auto pb-10">

      {/* Header concorso */}
      <header className="bg-white border border-slate-200 rounded-3xl shadow-soft p-5 mb-6 flex items-start gap-4">
        {concorso.logo
          ? <img src={concorso.logo} alt="" className="w-16 h-16 rounded-2xl object-contain border border-slate-100 shrink-0" />
          : <div className="w-16 h-16 rounded-2xl bg-brand-50 text-brand-700 flex items-center justify-center text-2xl shrink-0">🎼</div>
        }
        <div className="min-w-0 flex-1">
          <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-brand-700 font-bold">
            {t('iscr.header.eyebrow')}
          </p>
          <h1 className="text-2xl font-black text-ink-900 leading-tight truncate">{concorso.nome}</h1>
          <p className="text-sm text-slate-600 mt-1">
            {t('iscr.header.edition', { anno: concorso.anno })}
            {concorso.dataInizio && ` · ${concorso.dataInizio}`}
          </p>
          {concorso.iscrizioniScadenza && (
            <p className="text-xs text-amber-700 mt-1">
              {t('iscr.header.deadline', { date: new Date(concorso.iscrizioniScadenza).toLocaleString() })}
            </p>
          )}
        </div>
        <a href="/privacy" target="_blank" rel="noreferrer" className="hidden sm:block shrink-0" title="Informativa privacy (Regolamento UE 2016/679)">
          <GdprBadge />
        </a>
      </header>

      {/* Notice GDPR mobile */}
      <div className="sm:hidden bg-emerald-50 border border-emerald-200 rounded-2xl p-3 mb-4 flex items-center gap-3">
        <GdprBadge />
        <p className="text-xs text-emerald-900 leading-snug flex-1">{t('iscr.gdpr.note')}</p>
      </div>

      <form
        onSubmit={handleSubmit(
          (vals) => {
            // Tutore obbligatorio per i minorenni (lo schema lo tiene opzionale
            // perché dipende dall'età, calcolata a runtime).
            if (
              isMinore &&
              (!vals.tutore_nome?.trim() || !vals.tutore_cognome?.trim() || !vals.tutore_email?.trim())
            ) {
              toast.error(
                t('iscr.tutore.required', {
                  defaultValue:
                    'Per un candidato minorenne nome, cognome ed email del tutore sono obbligatori.',
                }),
              );
              return;
            }
            submitMut.mutate(vals);
          },
          (errs) => {
            // Scroll al primo campo invalido + avviso cumulativo.
            const first = Object.keys(errs)[0];
            if (first) {
              const el = document.querySelector(`[name="${first}"]`);
              if (el) (el as HTMLElement).scrollIntoView({ behavior: 'smooth', block: 'center' });
            }
            toast.error(
              t('iscr.errors.check_fields', { defaultValue: 'Controlla i campi evidenziati.' }),
            );
          },
        )}
        className="space-y-6"
        autoComplete="off"
        noValidate
      >
        {/* Honeypot anti-spam (invisibile per utenti) */}
        <div aria-hidden="true" style={{ position: 'absolute', left: '-10000px', top: 'auto', width: '1px', height: '1px', overflow: 'hidden' }}>
          <label>Lascia vuoto questo campo<input type="text" tabIndex={-1} autoComplete="off" {...register('website')} /></label>
        </div>
        <input type="hidden" {...register('startedAt', { value: startedAtRef.current })} />

        {/* ── Sezione 1: Anagrafica ── */}
        <SectionHeader num="1" title={t('iscr.section.1.title')} subtitle={t('iscr.section.1.subtitle')} />
        <div className="bg-white border border-slate-200 rounded-3xl shadow-soft p-6">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">

            <label className="c-field">
              <span className="c-field__label">Tipo iscrizione *</span>
              <select className="c-input" {...register('tipo')}>
                <option value="individuale">Individuale</option>
                <option value="gruppo">Gruppo / Ensemble</option>
                <option value="orchestra">Orchestra</option>
              </select>
            </label>

            <label className="c-field">
              <span className="c-field__label">Sesso</span>
              <select className="c-input" {...register('sesso')}>
                <option value="">— Seleziona —</option>
                <option value="M">Maschio</option>
                <option value="F">Femmina</option>
                <option value="altro">Altro / preferisco non specificare</option>
              </select>
            </label>

            <label className="c-field">
              <span className="c-field__label">Nome *</span>
              <input className="c-input" {...register('nome')} />
              {errors.nome && <p className="text-xs text-rose-600 mt-0.5">{errors.nome.message}</p>}
            </label>

            <label className="c-field">
              <span className="c-field__label">Cognome *</span>
              <input className="c-input" {...register('cognome')} />
              {errors.cognome && <p className="text-xs text-rose-600 mt-0.5">{errors.cognome.message}</p>}
            </label>

            <label className="c-field">
              <span className="c-field__label">Data di nascita *</span>
              <input type="date" className="c-input" {...register('data_nascita')} />
              {errors.data_nascita && <p className="text-xs text-rose-600 mt-0.5">{errors.data_nascita.message}</p>}
            </label>

            <label className="c-field">
              <span className="c-field__label">Luogo di nascita</span>
              <input className="c-input" placeholder="Città (Provincia)" {...register('luogo_nascita')} />
            </label>

            <label className="c-field">
              <span className="c-field__label">Nazionalità *</span>
              <input className="c-input" list="naz-list" placeholder="es. Italiana" {...register('nazionalita')} />
              <datalist id="naz-list">{NATIONALITIES.map((n) => <option key={n} value={n} />)}</datalist>
              {errors.nazionalita && <p className="text-xs text-rose-600 mt-0.5">{errors.nazionalita.message}</p>}
            </label>

            <label className="c-field">
              <span className="c-field__label">Codice fiscale</span>
              <input className="c-input font-mono uppercase" maxLength={16} placeholder="RSSMRA80A01H501U" {...register('codice_fiscale')} />
            </label>

          </div>

          {/* Tutore (se minorenne) */}
          {isMinore && (
            <div className="mt-5 bg-amber-50 border border-amber-200 rounded-2xl p-4">
              <p className="font-bold text-amber-900 flex items-center gap-1.5">⚠ Candidato minorenne</p>
              <p className="text-xs text-amber-800 mt-1 mb-3">Inserisci i dati di un genitore/tutore (obbligatori).</p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <label className="c-field">
                  <span className="c-field__label">Nome tutore *</span>
                  <input className="c-input" {...register('tutore_nome')} />
                </label>
                <label className="c-field">
                  <span className="c-field__label">Cognome tutore *</span>
                  <input className="c-input" {...register('tutore_cognome')} />
                </label>
                <label className="c-field">
                  <span className="c-field__label">Email tutore *</span>
                  <input type="email" className="c-input" {...register('tutore_email')} />
                </label>
                <label className="c-field">
                  <span className="c-field__label">Telefono tutore</span>
                  <input type="tel" className="c-input" {...register('tutore_telefono')} />
                </label>
              </div>
            </div>
          )}
        </div>

        {/* ── Sezione 2: Contatti ── */}
        <SectionHeader num="2" title={t('iscr.section.2.title')} subtitle={t('iscr.section.2.subtitle')} />
        <div className="bg-white border border-slate-200 rounded-3xl shadow-soft p-6">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">

            <label className="c-field sm:col-span-2">
              <span className="c-field__label">Email *</span>
              <input type="email" className="c-input" placeholder="nome@esempio.it" {...register('email')} />
              {errors.email && <p className="text-xs text-rose-600 mt-0.5">{errors.email.message}</p>}
            </label>

            <label className="c-field">
              <span className="c-field__label">Telefono</span>
              <input type="tel" className="c-input" placeholder="+39 ..." {...register('telefono')} />
            </label>

            <label className="c-field">
              <span className="c-field__label">CAP</span>
              <input className="c-input" maxLength={10} {...register('cap')} />
            </label>

            <label className="c-field sm:col-span-2">
              <span className="c-field__label">Indirizzo</span>
              <input className="c-input" placeholder="Via, civico" {...register('indirizzo')} />
            </label>

            <label className="c-field">
              <span className="c-field__label">Città</span>
              <input className="c-input" {...register('citta')} />
            </label>

            <label className="c-field">
              <span className="c-field__label">Provincia</span>
              <input className="c-input" maxLength={3} placeholder="MI" {...register('provincia')} />
            </label>

            <label className="c-field">
              <span className="c-field__label">Paese</span>
              <input className="c-input" {...register('paese')} />
            </label>

          </div>
        </div>

        {/* ── Sezione 3: Dati artistici ── */}
        <SectionHeader num="3" title={t('iscr.section.3.title')} subtitle={t('iscr.section.3.subtitle')} />
        <div className="bg-white border border-slate-200 rounded-3xl shadow-soft p-6">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">

            <label className="c-field">
              <span className="c-field__label">Strumento *</span>
              <input className="c-input" placeholder="es. Pianoforte" {...register('strumento')} />
              {errors.strumento && <p className="text-xs text-rose-600 mt-0.5">{errors.strumento.message}</p>}
            </label>

            <label className="c-field">
              <span className="c-field__label">Anni di studio</span>
              <input type="number" min={0} max={80} className="c-input" {...register('anni_studio')} />
            </label>

            {sezioni.length > 0 && (
              <>
                <label className="c-field">
                  <span className="c-field__label">Sezione</span>
                  <select
                    className="c-input"
                    {...register('sezione')}
                    onChange={(e) => { setValue('sezione', e.target.value); setValue('categoria', ''); }}
                  >
                    <option value="">— Nessuna —</option>
                    {sezioni.map((s) => <option key={s.id} value={s.id}>{s.nome}</option>)}
                  </select>
                </label>

                <label className="c-field">
                  <span className="c-field__label">Categoria{categorieDellaSezione.length > 0 ? ' *' : ''}</span>
                  <select
                    className="c-input"
                    disabled={categorieDellaSezione.length === 0}
                    {...register('categoria')}
                  >
                    <option value="">{categorieDellaSezione.length === 0 ? '— Seleziona prima una sezione —' : '— Scegli categoria —'}</option>
                    {categorieDellaSezione.map((c) => <option key={c.id} value={c.id}>{c.nome}</option>)}
                  </select>
                </label>
              </>
            )}

            <label className="c-field sm:col-span-2">
              <span className="c-field__label">Scuola/Conservatorio di provenienza</span>
              <input className="c-input" {...register('scuola_provenienza')} />
            </label>

            <label className="c-field sm:col-span-2">
              <span className="c-field__label">Docenti preparatori</span>
              <textarea
                className="c-textarea"
                rows={3}
                placeholder="Un docente per riga (es. Mario Bianchi — Conservatorio di Milano)"
                {...register('docenti_preparatori_text')}
              />
            </label>

          </div>
        </div>

        {/* ── Sezione 3b: Composizione gruppo (condizionale) ── */}
        {isGruppo && (
          <>
            <SectionHeader
              num="3b"
              title={tipo === 'orchestra' ? "Composizione dell'orchestra" : 'Composizione del gruppo'}
              subtitle={tipo === 'orchestra' ? "Nome dell'orchestra e membri." : "Nome dell'ensemble e membri."}
            />
            <div className="bg-white border border-brand-200 rounded-3xl shadow-soft p-6">
              <label className="c-field">
                <span className="c-field__label">
                  {tipo === 'orchestra' ? "Nome dell'orchestra" : 'Nome del gruppo / ensemble'}
                </span>
                <input
                  className="c-input"
                  placeholder={tipo === 'orchestra' ? 'es. Orchestra Giovanile di Milano' : 'es. Quartetto Brillante'}
                  {...register('gruppo_nome')}
                />
              </label>

              <p className="text-xs text-slate-600 mt-3 mb-2">Membri (oltre al referente compilato sopra):</p>
              <div className="space-y-2">
                {membriArray.fields.map((field, idx) => (
                  <div key={field.id} className="grid grid-cols-12 gap-2">
                    <input placeholder="Nome" className="c-input col-span-3" {...register(`membri.${idx}.nome`)} />
                    <input placeholder="Cognome" className="c-input col-span-3" {...register(`membri.${idx}.cognome`)} />
                    <input placeholder="Strumento" className="c-input col-span-4" {...register(`membri.${idx}.strumento`)} />
                    <input type="date" className="c-input col-span-2 text-xs" {...register(`membri.${idx}.data_nascita`)} />
                    <button
                      type="button"
                      className="col-span-12 text-xs text-rose-600 hover:text-rose-800 self-start text-left"
                      onClick={() => membriArray.remove(idx)}
                    >
                      − rimuovi
                    </button>
                  </div>
                ))}
              </div>
              <button
                type="button"
                className="mt-2 text-xs font-medium text-brand-700 hover:text-brand-900"
                onClick={() => membriArray.append({ nome: '', cognome: '', strumento: '', data_nascita: '' })}
              >
                + Aggiungi membro
              </button>
            </div>
          </>
        )}

        {/* ── Sezione 4: Programma ── */}
        <SectionHeader num="4" title={t('iscr.section.4.title')} subtitle={t('iscr.section.4.subtitle')} />
        <div className="bg-white border border-slate-200 rounded-3xl shadow-soft p-6">
          {errors.programma?.root?.message && (
            <p className="text-xs text-rose-600 mb-2">{errors.programma.root.message}</p>
          )}
          <div className="space-y-2">
            {programmaArray.fields.map((field, idx) => (
              <div key={field.id} className="grid grid-cols-12 gap-2">
                <div className="col-span-5">
                  <input placeholder="Titolo brano" className="c-input" {...register(`programma.${idx}.titolo`)} />
                  {errors.programma?.[idx]?.titolo && (
                    <p className="text-xs text-rose-600 mt-0.5">{errors.programma[idx]?.titolo?.message}</p>
                  )}
                </div>
                <input placeholder="Autore/Compositore" className="c-input col-span-5" {...register(`programma.${idx}.autore`)} />
                <input
                  type="number" min={0} max={120} step={0.5} placeholder="min"
                  className="c-input col-span-2"
                  {...register(`programma.${idx}.durata_min`)}
                />
                <button
                  type="button"
                  className="col-span-12 text-xs text-rose-600 hover:text-rose-800 self-start text-left"
                  onClick={() => programmaArray.remove(idx)}
                >
                  − rimuovi
                </button>
              </div>
            ))}
          </div>
          <button
            type="button"
            className="mt-2 text-xs font-medium text-brand-700 hover:text-brand-900"
            onClick={() => programmaArray.append({ titolo: '', autore: '', durata_min: undefined })}
          >
            + Aggiungi brano
          </button>
          <label className="c-field mt-4">
            <span className="c-field__label">Note libere (opzionale)</span>
            <textarea
              className="c-textarea"
              rows={2}
              placeholder="Qualsiasi informazione utile all'organizzazione"
              {...register('note_libere')}
            />
          </label>
        </div>

        {/* ── Sezione 5: Allegati ── */}
        <SectionHeader num="5" title={t('iscr.section.5.title')} subtitle={t('iscr.section.5.subtitle')} />
        <div className="bg-white border border-slate-200 rounded-3xl shadow-soft p-6">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">

            <div className="c-field">
              <span className="c-field__label">📷 Foto candidato</span>
              <input ref={fileRefs.foto} type="file" accept="image/*" className="c-input" />
              <p className="text-[11px] text-slate-500 mt-1">JPG/PNG/WebP, max 2 MB. Ridimensionata automaticamente.</p>
            </div>

            <div className="c-field">
              <span className="c-field__label">📄 Documento d'identità</span>
              <input ref={fileRefs.documento_identita} type="file" accept=".pdf,image/*" className="c-input" />
              <p className="text-[11px] text-slate-500 mt-1">PDF/JPG/PNG, max 2 MB.</p>
            </div>

            <div className="c-field">
              <span className="c-field__label">💳 Ricevuta pagamento quota</span>
              <input ref={fileRefs.ricevuta_pagamento} type="file" accept=".pdf,image/*" className="c-input" />
              <p className="text-[11px] text-slate-500 mt-1">PDF/JPG/PNG, max 2 MB.</p>
            </div>

            {isMinore && (
              <div className="c-field">
                <span className="c-field__label">✍ Autorizzazione minore</span>
                <input ref={fileRefs.autorizzazione_minore} type="file" accept=".pdf,image/*" className="c-input" />
                <p className="text-[11px] text-slate-500 mt-1">Modulo firmato dal tutore. PDF/JPG/PNG, max 2 MB.</p>
              </div>
            )}

          </div>
        </div>

        {/* ── Sezione 6: Privacy ── */}
        <SectionHeader num="6" title={t('iscr.section.6.title')} subtitle={t('iscr.section.6.subtitle')} />
        <div className="bg-white border border-slate-200 rounded-3xl shadow-soft p-6">
          <div className="space-y-3">

            <label className="flex items-start gap-3 text-sm text-ink-800">
              <Controller
                control={control}
                name="consenso_privacy"
                render={({ field }) => (
                  <input
                    type="checkbox"
                    className="mt-1 rounded border-slate-300"
                    checked={!!field.value}
                    onChange={(e) => field.onChange(e.target.checked ? true : (undefined))}
                  />
                )}
              />
              <span>
                <strong>Privacy *</strong> — Acconsento al trattamento dei dati personali secondo l'
                <a href="/privacy" target="_blank" rel="noreferrer" className="text-brand-700 underline">informativa GDPR</a>
                {' '}per le finalità di gestione del concorso.
              </span>
            </label>
            {errors.consenso_privacy && <p className="text-xs text-rose-600">{errors.consenso_privacy.message}</p>}

            <label className="flex items-start gap-3 text-sm text-ink-800">
              <input type="checkbox" className="mt-1 rounded border-slate-300" {...register('consenso_immagini')} />
              <span>Autorizzo l'uso delle immagini (foto/video) realizzate durante il concorso per i materiali promozionali dell'ente.</span>
            </label>

            <label className="flex items-start gap-3 text-sm text-ink-800">
              <Controller
                control={control}
                name="consenso_regolamento"
                render={({ field }) => (
                  <input
                    type="checkbox"
                    className="mt-1 rounded border-slate-300"
                    checked={!!field.value}
                    onChange={(e) => field.onChange(e.target.checked ? true : (undefined))}
                  />
                )}
              />
              <span><strong>Regolamento *</strong> — Dichiaro di aver letto e accettato il regolamento del concorso.</span>
            </label>
            {errors.consenso_regolamento && <p className="text-xs text-rose-600">{errors.consenso_regolamento.message}</p>}

          </div>
        </div>

        {/* Submit sticky */}
        <div className="sticky bottom-0 bg-gradient-to-t from-white via-white to-transparent pt-4 pb-2 -mx-2 px-2">
          <button
            type="submit"
            disabled={submitMut.isPending}
            className="c-btn c-btn--primary c-btn--xl w-full justify-center"
          >
            {submitMut.isPending ? (
              <>
                <svg className="w-5 h-5 animate-spin" viewBox="0 0 24 24" fill="none">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
                </svg>
                <span>{t('iscr.submit.loading')}</span>
              </>
            ) : (
              <>
                <span>{t('iscr.submit')}</span>
                <span className="c-btn__icon" aria-hidden="true">
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                  </svg>
                </span>
              </>
            )}
          </button>
          <p className="text-[11px] text-center text-slate-500 mt-2">{t('iscr.submit.tip')}</p>
        </div>

      </form>
    </section>
  );
}
