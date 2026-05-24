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
 */

import { useEffect, useRef, useState } from 'react';
import { useForm, useFieldArray, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { publicApi, type ConcorsoDetailPublic, type ProgrammaBrano, type MembroGruppo } from '@/api/public';
import { httpErrorMessage } from '@/lib/api';
import { GdprBadge } from './Privacy';

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

// ─── Nazionalità datalist ─────────────────────────────────────────────────────

const NATIONALITIES = [
  'Italiana', 'Americana', 'Britannica', 'Francese', 'Tedesca', 'Spagnola',
  'Portoghese', 'Olandese', 'Belga', 'Svizzera', 'Austriaca', 'Polacca',
  'Russa', 'Cinese', 'Giapponese', 'Coreana', 'Indiana', 'Brasiliana',
  'Argentina', 'Australiana', 'Canadese',
];

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

// ─── Section header ───────────────────────────────────────────────────────────

function SectionHeader({ num, title, subtitle }: { num: string; title: string; subtitle: string }) {
  return (
    <header className="flex items-center gap-3 mb-1">
      <span className="w-7 h-7 rounded-full bg-primary/10 text-primary text-sm font-bold inline-flex items-center justify-center shrink-0">{num}</span>
      <div>
        <h2 className="font-semibold text-slate-900">{title}</h2>
        <p className="text-xs text-slate-600">{subtitle}</p>
      </div>
    </header>
  );
}

// ─── Field wrapper ────────────────────────────────────────────────────────────

function Field({ label, required, error, children }: { label: string; required?: boolean; error?: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-sm font-medium text-slate-800 mb-1">
        {label}{required && <span className="text-rose-600 ml-0.5">*</span>}
      </label>
      {children}
      {error && <p className="text-xs text-rose-600 mt-0.5">{error}</p>}
    </div>
  );
}

const inputCls = 'w-full border border-slate-300 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40 bg-white';
const selectCls = inputCls;

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
  // Prendi il primo concorso aperto (o nessuno)
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

      // Upload allegati (best-effort)
      if (res.uploadToken) {
        for (const [field, tipo] of Object.entries(ALLEGATO_TIPI)) {
          const inp = fileRefs[field]?.current;
          const file = inp?.files?.[0];
          if (!file) continue;
          try {
            await publicApi.uploadAllegato(res.uploadToken, tipo, file);
          } catch (err) {
            console.warn('Upload allegato fallito:', field, err);
          }
        }
      }
      return res;
    },
    onSuccess: (res) => {
      clearDraft();
      const vals = form.getValues();
      setSuccess({ id: res.iscrizioneId, email: vals.email, nome: vals.nome });
    },
    onError: (err) => {
      const msg = httpErrorMessage(err);
      toast.error(msg);
    },
  });

  // ── Success ─────────────────────────────────────────────────────────────
  if (success) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100 flex items-center justify-center p-4">
        <div className="bg-white border border-emerald-200 rounded-3xl shadow-lg p-10 text-center max-w-2xl w-full">
          <div className="text-6xl mb-4">🎉</div>
          <h1 className="text-2xl font-black text-slate-900 mb-2">Iscrizione inviata</h1>
          <p className="text-slate-700 leading-relaxed mb-3">
            La tua iscrizione a <strong>{concorso?.nome}</strong> è stata ricevuta correttamente.
          </p>
          <p className="text-sm text-slate-600 mb-1">Riceverai una mail di conferma a:</p>
          <p className="font-mono text-primary font-semibold mb-4">{success.email}</p>
          <p className="text-xs text-slate-500">Numero pratica: <code className="bg-slate-100 px-2 py-0.5 rounded font-mono text-[11px]">{success.id}</code></p>
          <p className="text-sm text-slate-600 mt-6 leading-relaxed">L'organizzazione esaminerà la tua candidatura e ti contatterà con l'esito.</p>
          <a href="/" className="inline-block mt-6 px-4 py-2 border border-slate-300 rounded-lg text-sm font-medium text-slate-700 hover:bg-slate-50 transition-colors">Chiudi</a>
        </div>
      </div>
    );
  }

  // ── Caricamento ──────────────────────────────────────────────────────────
  if (concorsiQ.isLoading || concorsoQ.isLoading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100 flex items-center justify-center">
        <div className="text-center">
          <svg className="w-8 h-8 text-primary animate-spin mx-auto mb-3" viewBox="0 0 24 24" fill="none">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
          </svg>
          <p className="text-slate-700 font-medium">{t('iscr.loading')}</p>
        </div>
      </div>
    );
  }

  // ── Nessun concorso aperto ───────────────────────────────────────────────
  if (!concorso) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100 flex items-center justify-center p-4">
        <div className="bg-white rounded-3xl shadow-lg border border-slate-200 max-w-xl w-full p-10 text-center">
          <div className="text-5xl mb-4">📭</div>
          <h1 className="text-2xl font-bold text-slate-900 mb-2">{t('iscr.closed.title')}</h1>
          <p className="text-slate-600 leading-relaxed">{t('iscr.closed.subtitle')}</p>
          <a href="/" className="inline-block mt-6 px-4 py-2 border border-slate-300 rounded-lg text-sm font-medium text-slate-700 hover:bg-slate-50 transition-colors">{t('iscr.closed.cta')}</a>
        </div>
      </div>
    );
  }

  // ── Form ────────────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100 py-8 px-4">
      <div className="max-w-3xl mx-auto pb-10">

        {/* Header concorso */}
        <header className="bg-white border border-slate-200 rounded-3xl shadow-sm p-5 mb-6 flex items-start gap-4">
          {concorso.logo
            ? <img src={concorso.logo} alt="" className="w-16 h-16 rounded-2xl object-contain border border-slate-100 shrink-0" />
            : <div className="w-16 h-16 rounded-2xl bg-primary/10 text-primary flex items-center justify-center text-2xl shrink-0">🎼</div>
          }
          <div className="min-w-0 flex-1">
            <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-primary font-bold">{t('iscr.header.eyebrow')}</p>
            <h1 className="text-2xl font-black text-slate-900 leading-tight truncate">{concorso.nome}</h1>
            <p className="text-sm text-slate-600 mt-1">
              {t('iscr.header.edition', { anno: concorso.anno })}
              {concorso.dataInizio && ` · ${concorso.dataInizio}`}
            </p>
            {concorso.iscrizioniScadenza && (
              <p className="text-xs text-amber-700 mt-1">{t('iscr.header.deadline', { date: new Date(concorso.iscrizioniScadenza).toLocaleDateString('it-IT') })}</p>
            )}
          </div>
          <a href="/privacy" target="_blank" rel="noreferrer" className="hidden sm:block shrink-0" title="Informativa privacy GDPR">
            <GdprBadge />
          </a>
        </header>

        <form
          onSubmit={handleSubmit((vals) => submitMut.mutate(vals))}
          className="space-y-6"
          autoComplete="off"
          noValidate
        >
          {/* Honeypot anti-spam (invisibile per utenti) */}
          <div aria-hidden="true" style={{ position: 'absolute', left: '-10000px', top: 'auto', width: '1px', height: '1px', overflow: 'hidden' }}>
            <label>Lascia vuoto<input type="text" tabIndex={-1} autoComplete="off" {...register('website')} /></label>
          </div>
          <input type="hidden" {...register('startedAt', { value: startedAtRef.current })} />

          {/* ── Sezione 1: Anagrafica ── */}
          <SectionHeader num="1" title={t('iscr.section.1.title')} subtitle={t('iscr.section.1.subtitle')} />
          <div className="bg-white border border-slate-200 rounded-3xl shadow-sm p-6">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Field label="Tipo iscrizione" required>
                <select className={selectCls} {...register('tipo')}>
                  <option value="individuale">Individuale</option>
                  <option value="gruppo">Gruppo / Ensemble</option>
                  <option value="orchestra">Orchestra</option>
                </select>
              </Field>
              <Field label="Sesso">
                <select className={selectCls} {...register('sesso')}>
                  <option value="">— Seleziona —</option>
                  <option value="M">Maschio</option>
                  <option value="F">Femmina</option>
                  <option value="altro">Altro / preferisco non specificare</option>
                </select>
              </Field>
              <Field label="Nome" required error={errors.nome?.message}>
                <input className={inputCls} {...register('nome')} />
              </Field>
              <Field label="Cognome" required error={errors.cognome?.message}>
                <input className={inputCls} {...register('cognome')} />
              </Field>
              <Field label="Data di nascita" required error={errors.data_nascita?.message}>
                <input type="date" className={inputCls} {...register('data_nascita')} />
              </Field>
              <Field label="Luogo di nascita">
                <input className={inputCls} placeholder="Città (Provincia)" {...register('luogo_nascita')} />
              </Field>
              <Field label="Nazionalità" required error={errors.nazionalita?.message}>
                <input className={inputCls} list="naz-list" placeholder="es. Italiana" {...register('nazionalita')} />
                <datalist id="naz-list">{NATIONALITIES.map((n) => <option key={n} value={n} />)}</datalist>
              </Field>
              <Field label="Codice fiscale">
                <input className={`${inputCls} font-mono uppercase`} maxLength={16} placeholder="RSSMRA80A01H501U" {...register('codice_fiscale')} />
              </Field>
            </div>

            {/* Tutore (se minorenne) */}
            {isMinore && (
              <div className="mt-5 bg-amber-50 border border-amber-200 rounded-2xl p-4">
                <p className="font-bold text-amber-900 flex items-center gap-1.5">⚠ Candidato minorenne</p>
                <p className="text-xs text-amber-800 mt-1 mb-3">Inserisci i dati di un genitore/tutore (obbligatori per i minorenni).</p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <Field label="Nome tutore" required>
                    <input className={inputCls} {...register('tutore_nome')} />
                  </Field>
                  <Field label="Cognome tutore">
                    <input className={inputCls} {...register('tutore_cognome')} />
                  </Field>
                  <Field label="Email tutore" required>
                    <input type="email" className={inputCls} {...register('tutore_email')} />
                  </Field>
                  <Field label="Telefono tutore">
                    <input type="tel" className={inputCls} {...register('tutore_telefono')} />
                  </Field>
                </div>
              </div>
            )}
          </div>

          {/* ── Sezione 2: Contatti ── */}
          <SectionHeader num="2" title={t('iscr.section.2.title')} subtitle={t('iscr.section.2.subtitle')} />
          <div className="bg-white border border-slate-200 rounded-3xl shadow-sm p-6">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Field label="Email" required error={errors.email?.message} >
                <div className="sm:col-span-2">
                  <input type="email" className={inputCls} placeholder="nome@esempio.it" {...register('email')} />
                </div>
              </Field>
              <Field label="Telefono">
                <input type="tel" className={inputCls} placeholder="+39 ..." {...register('telefono')} />
              </Field>
              <Field label="CAP">
                <input className={inputCls} maxLength={10} {...register('cap')} />
              </Field>
              <div className="sm:col-span-2">
                <Field label="Indirizzo">
                  <input className={inputCls} placeholder="Via, civico" {...register('indirizzo')} />
                </Field>
              </div>
              <Field label="Città">
                <input className={inputCls} {...register('citta')} />
              </Field>
              <Field label="Provincia">
                <input className={inputCls} maxLength={3} placeholder="MI" {...register('provincia')} />
              </Field>
              <Field label="Paese">
                <input className={inputCls} {...register('paese')} />
              </Field>
            </div>
          </div>

          {/* ── Sezione 3: Dati artistici ── */}
          <SectionHeader num="3" title={t('iscr.section.3.title')} subtitle={t('iscr.section.3.subtitle')} />
          <div className="bg-white border border-slate-200 rounded-3xl shadow-sm p-6">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Field label="Strumento" required error={errors.strumento?.message}>
                <input className={inputCls} placeholder="es. Pianoforte" {...register('strumento')} />
              </Field>
              <Field label="Anni di studio">
                <input type="number" min={0} max={80} className={inputCls} {...register('anni_studio')} />
              </Field>
              {sezioni.length > 0 && (
                <>
                  <Field label="Sezione">
                    <select className={selectCls} {...register('sezione')} onChange={(e) => { setValue('sezione', e.target.value); setValue('categoria', ''); }}>
                      <option value="">— Nessuna —</option>
                      {sezioni.map((s) => <option key={s.id} value={s.id}>{s.nome}</option>)}
                    </select>
                  </Field>
                  <Field label={`Categoria${categorieDellaSezione.length > 0 ? ' *' : ''}`}>
                    <select className={selectCls} disabled={categorieDellaSezione.length === 0} {...register('categoria')}>
                      <option value="">{categorieDellaSezione.length === 0 ? '— Seleziona prima una sezione —' : '— Scegli categoria —'}</option>
                      {categorieDellaSezione.map((c) => <option key={c.id} value={c.id}>{c.nome}</option>)}
                    </select>
                  </Field>
                </>
              )}
              <div className="sm:col-span-2">
                <Field label="Scuola/Conservatorio di provenienza">
                  <input className={inputCls} {...register('scuola_provenienza')} />
                </Field>
              </div>
              <div className="sm:col-span-2">
                <Field label="Docenti preparatori">
                  <textarea
                    className={`${inputCls} resize-none`}
                    rows={3}
                    placeholder="Un docente per riga (es. Mario Bianchi — Conservatorio di Milano)"
                    {...register('docenti_preparatori_text')}
                  />
                </Field>
              </div>
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
              <div className="bg-white border border-primary/20 rounded-3xl shadow-sm p-6">
                <Field label={tipo === 'orchestra' ? "Nome dell'orchestra" : 'Nome del gruppo / ensemble'}>
                  <input
                    className={inputCls}
                    placeholder={tipo === 'orchestra' ? 'es. Orchestra Giovanile di Milano' : 'es. Quartetto Brillante'}
                    {...register('gruppo_nome')}
                  />
                </Field>
                <p className="text-xs text-slate-600 mt-4 mb-2">Membri (oltre al referente compilato sopra):</p>
                <div className="space-y-2">
                  {membriArray.fields.map((field, idx) => (
                    <div key={field.id} className="grid grid-cols-12 gap-2">
                      <input placeholder="Nome" className={`${inputCls} col-span-3`} {...register(`membri.${idx}.nome`)} />
                      <input placeholder="Cognome" className={`${inputCls} col-span-3`} {...register(`membri.${idx}.cognome`)} />
                      <input placeholder="Strumento" className={`${inputCls} col-span-4`} {...register(`membri.${idx}.strumento`)} />
                      <input type="date" className={`${inputCls} col-span-2 text-xs`} {...register(`membri.${idx}.data_nascita`)} />
                      <button type="button" className="col-span-12 text-xs text-rose-600 hover:text-rose-800 text-left" onClick={() => membriArray.remove(idx)}>− rimuovi</button>
                    </div>
                  ))}
                </div>
                <button
                  type="button"
                  className="mt-2 text-xs font-medium text-primary hover:text-primary/80"
                  onClick={() => membriArray.append({ nome: '', cognome: '', strumento: '', data_nascita: '' })}
                >
                  + Aggiungi membro
                </button>
              </div>
            </>
          )}

          {/* ── Sezione 4: Programma ── */}
          <SectionHeader num="4" title={t('iscr.section.4.title')} subtitle={t('iscr.section.4.subtitle')} />
          <div className="bg-white border border-slate-200 rounded-3xl shadow-sm p-6">
            {errors.programma?.root?.message && <p className="text-xs text-rose-600 mb-2">{errors.programma.root.message}</p>}
            <div className="space-y-2">
              {programmaArray.fields.map((field, idx) => (
                <div key={field.id} className="grid grid-cols-12 gap-2">
                  <div className="col-span-5">
                    <input placeholder="Titolo brano" className={inputCls} {...register(`programma.${idx}.titolo`)} />
                    {errors.programma?.[idx]?.titolo && <p className="text-xs text-rose-600 mt-0.5">{errors.programma[idx]?.titolo?.message}</p>}
                  </div>
                  <input placeholder="Autore/Compositore" className={`${inputCls} col-span-5`} {...register(`programma.${idx}.autore`)} />
                  <input type="number" min={0} max={120} step={0.5} placeholder="min" className={`${inputCls} col-span-2`} {...register(`programma.${idx}.durata_min`)} />
                  <button type="button" className="col-span-12 text-xs text-rose-600 hover:text-rose-800 text-left" onClick={() => programmaArray.remove(idx)}>− rimuovi</button>
                </div>
              ))}
            </div>
            <button
              type="button"
              className="mt-2 text-xs font-medium text-primary hover:text-primary/80"
              onClick={() => programmaArray.append({ titolo: '', autore: '', durata_min: undefined })}
            >
              + Aggiungi brano
            </button>
            <div className="mt-4">
              <Field label="Note libere (opzionale)">
                <textarea className={`${inputCls} resize-none`} rows={2} placeholder="Qualsiasi informazione utile all'organizzazione" {...register('note_libere')} />
              </Field>
            </div>
          </div>

          {/* ── Sezione 5: Allegati ── */}
          <SectionHeader num="5" title={t('iscr.section.5.title')} subtitle={t('iscr.section.5.subtitle')} />
          <div className="bg-white border border-slate-200 rounded-3xl shadow-sm p-6">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {(['foto', 'documento_identita', 'ricevuta_pagamento'] as const).map((field) => {
                const labels: Record<string, string> = {
                  foto: '📷 Foto candidato',
                  documento_identita: '📄 Documento d\'identità',
                  ricevuta_pagamento: '💳 Ricevuta pagamento quota',
                };
                const hints: Record<string, string> = {
                  foto: 'JPG/PNG/WebP, max 2 MB.',
                  documento_identita: 'PDF/JPG/PNG, max 2 MB.',
                  ricevuta_pagamento: 'PDF/JPG/PNG, max 2 MB.',
                };
                return (
                  <div key={field}>
                    <label className="block text-sm font-medium text-slate-800 mb-1">{labels[field]}</label>
                    <input
                      ref={fileRefs[field]}
                      type="file"
                      accept={field === 'foto' ? 'image/*' : '.pdf,image/*'}
                      className={inputCls}
                    />
                    <p className="text-[11px] text-slate-500 mt-1">{hints[field]}</p>
                  </div>
                );
              })}
              {isMinore && (
                <div>
                  <label className="block text-sm font-medium text-slate-800 mb-1">✍ Autorizzazione minore</label>
                  <input ref={fileRefs.autorizzazione_minore} type="file" accept=".pdf,image/*" className={inputCls} />
                  <p className="text-[11px] text-slate-500 mt-1">Modulo firmato dal tutore. PDF/JPG/PNG, max 2 MB.</p>
                </div>
              )}
            </div>
          </div>

          {/* ── Sezione 6: Privacy ── */}
          <SectionHeader num="6" title={t('iscr.section.6.title')} subtitle={t('iscr.section.6.subtitle')} />
          <div className="bg-white border border-slate-200 rounded-3xl shadow-sm p-6">
            <div className="space-y-3">
              <label className="flex items-start gap-3 text-sm text-slate-800">
                <Controller
                  control={control}
                  name="consenso_privacy"
                  render={({ field }) => (
                    <input
                      type="checkbox"
                      className="mt-1 rounded border-slate-300"
                      checked={field.value}
                      onChange={(e) => field.onChange(e.target.checked ? true : (undefined))}
                    />
                  )}
                />
                <span>
                  <strong>Privacy *</strong> — Acconsento al trattamento dei dati personali secondo l'
                  <a href="/privacy" target="_blank" rel="noreferrer" className="text-primary underline">informativa GDPR</a>
                  {' '}per le finalità di gestione del concorso.
                </span>
              </label>
              {errors.consenso_privacy && <p className="text-xs text-rose-600">{errors.consenso_privacy.message}</p>}

              <label className="flex items-start gap-3 text-sm text-slate-800">
                <input type="checkbox" className="mt-1 rounded border-slate-300" {...register('consenso_immagini')} />
                <span>Autorizzo l'uso delle immagini (foto/video) realizzate durante il concorso per i materiali promozionali dell'ente.</span>
              </label>

              <label className="flex items-start gap-3 text-sm text-slate-800">
                <Controller
                  control={control}
                  name="consenso_regolamento"
                  render={({ field }) => (
                    <input
                      type="checkbox"
                      className="mt-1 rounded border-slate-300"
                      checked={field.value}
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
          <div className="sticky bottom-0 bg-gradient-to-t from-slate-50 via-slate-50 to-transparent pt-4 pb-2">
            <button
              type="submit"
              disabled={submitMut.isPending}
              className="w-full bg-primary text-primary-foreground rounded-2xl py-3.5 text-base font-bold flex items-center justify-center gap-2 disabled:opacity-70 hover:bg-primary/90 transition-colors"
            >
              {submitMut.isPending ? (
                <>
                  <svg className="w-5 h-5 animate-spin" viewBox="0 0 24 24" fill="none"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" /><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" /></svg>
                  {t('iscr.submit.loading')}
                </>
              ) : (
                <>
                  {t('iscr.submit')}
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}><path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" /></svg>
                </>
              )}
            </button>
            <p className="text-[11px] text-center text-slate-500 mt-2">{t('iscr.submit.tip')}</p>
          </div>
        </form>
      </div>
    </div>
  );
}
