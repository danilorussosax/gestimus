// =============================================================================
// CandidatiTab — gestione candidati di un concorso (admin)
//
// Features:
//  - Griglia candidati con filtri sezione/tipo/ricerca testo
//  - Create/Edit dialog completo (anagrafica, contatti, artistici, sezione/categoria, foto)
//  - Delete con confirm
//  - Photo upload via http.upload
//
// Presentation: legacy.css design system (c-btn, c-field, c-input, c-select,
//   c-textarea, c-tag, c-tile — matching candidati.js vanilla source exactly).
// =============================================================================

import { useState, useRef, useCallback, useMemo } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { toast } from 'sonner';
import {
  Plus, Pencil, Trash2, Search, GraduationCap, Users, Music,
  X, Filter,
} from 'lucide-react';

import { fileUrl, httpErrorMessage } from '@/lib/api';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from '@/components/ui/dialog';

import { useCandidati, candidatiApi, type CandidatoFull } from '@/api/candidati';
import type { Sezione, Categoria } from '@/types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function displayName(c: Pick<CandidatoFull, 'nome' | 'cognome'>): string {
  return [c.nome, c.cognome].filter(Boolean).join(' ');
}

function ageFromDate(dateStr: string | null | undefined): number | null {
  if (!dateStr) return null;
  const dob = new Date(dateStr);
  if (isNaN(dob.getTime())) return null;
  const today = new Date();
  let age = today.getFullYear() - dob.getFullYear();
  const m = today.getMonth() - dob.getMonth();
  if (m < 0 || (m === 0 && today.getDate() < dob.getDate())) age--;
  return age >= 0 ? age : null;
}

function fmtDate(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('it-IT');
}

// ---------------------------------------------------------------------------
// Zod schema
// ---------------------------------------------------------------------------

const candidatoSchema = z.object({
  nome: z.string().min(1, 'Nome obbligatorio').max(255),
  cognome: z.string().max(255).optional(),
  strumento: z.string().min(1, 'Strumento obbligatorio').max(255),
  dataNascita: z.string().optional(),
  nazionalita: z.string().max(100).optional(),
  email: z.union([z.string().email('Email non valida'), z.literal('')]).optional(),
  telefono: z.string().max(50).optional(),
  sesso: z.string().optional(),
  luogoNascita: z.string().max(255).optional(),
  codiceFiscale: z.string().max(16).optional(),
  indirizzo: z.string().max(500).optional(),
  citta: z.string().max(255).optional(),
  cap: z.string().max(10).optional(),
  provincia: z.string().max(3).optional(),
  paese: z.string().max(100).optional(),
  anniStudio: z.string().optional(),
  scuolaProvenienza: z.string().max(500).optional(),
  docentiPreparatori: z.string().optional(),
  noteLibere: z.string().max(5000).optional(),
  sezioneId: z.string().optional(),
  categoriaId: z.string().optional(),
  tipo: z.enum(['individuale', 'gruppo', 'orchestra'] as const),
  gruppoNome: z.string().max(255).optional(),
});

type CandidatoFormValues = z.infer<typeof candidatoSchema>;

// ---------------------------------------------------------------------------
// CandidatoFormDialog
// ---------------------------------------------------------------------------

interface FormDialogProps {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  concorsoId: string;
  sezioni: Sezione[];
  categorie: Categoria[];
  existing?: CandidatoFull;
  onSaved?: () => void;
}

function CandidatoFormDialog({
  open,
  onOpenChange,
  concorsoId,
  sezioni,
  categorie,
  existing,
  onSaved,
}: FormDialogProps) {
  const isEdit = !!existing;
  const { createMutation, updateMutation } = useCandidati(concorsoId);

  const [fotoFile, setFotoFile] = useState<File | null>(null);
  const [fotoPreview, setFotoPreview] = useState<string | null>(null);
  const [isUploadingFoto, setIsUploadingFoto] = useState(false);
  const fotoInputRef = useRef<HTMLInputElement>(null);

  const form = useForm<CandidatoFormValues>({
    resolver: zodResolver(candidatoSchema),
    values: {
      nome: existing?.nome ?? '',
      cognome: existing?.cognome ?? '',
      strumento: existing?.strumento ?? '',
      dataNascita: existing?.dataNascita ?? '',
      nazionalita: existing?.nazionalita ?? '',
      email: existing?.email ?? '',
      telefono: existing?.telefono ?? '',
      sesso: existing?.sesso ?? '',
      luogoNascita: existing?.luogoNascita ?? '',
      codiceFiscale: existing?.codiceFiscale ?? '',
      indirizzo: existing?.indirizzo ?? '',
      citta: existing?.citta ?? '',
      cap: existing?.cap ?? '',
      provincia: existing?.provincia ?? '',
      paese: existing?.paese ?? 'Italia',
      anniStudio: existing?.anniStudio != null ? String(existing.anniStudio) : '',
      scuolaProvenienza: existing?.scuolaProvenienza ?? '',
      docentiPreparatori: (existing?.docentiPreparatori ?? []).join('\n'),
      noteLibere: existing?.noteLibere ?? '',
      sezioneId: existing?.sezioneId ?? '',
      categoriaId: existing?.categoriaId ?? '',
      tipo: (existing?.tipo!) ?? 'individuale',
      gruppoNome: existing?.gruppoNome ?? '',
    },
  });

  const tipo = form.watch('tipo');
  const sezioneId = form.watch('sezioneId');
  const isGroupLike = tipo === 'gruppo' || tipo === 'orchestra';

  const filteredCategorie = useMemo(
    () => (sezioneId ? categorie.filter((c) => c.sezioneId === sezioneId) : []),
    [categorie, sezioneId],
  );

  const currentFotoUrl = fotoPreview ?? (existing?.fotoUrl ? fileUrl(existing.fotoUrl) : null);

  const handleFotoChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setFotoFile(file);
    const reader = new FileReader();
    reader.onload = () => setFotoPreview(reader.result as string);
    reader.readAsDataURL(file);
    e.target.value = '';
  }, []);

  const onSubmit = async (values: CandidatoFormValues) => {
    const docentiLines = (values.docentiPreparatori ?? '')
      .split('\n')
      .map((s) => s.trim())
      .filter(Boolean);
    const anniStudio =
      values.anniStudio && values.anniStudio.trim() !== ''
        ? Number(values.anniStudio)
        : null;

    const body = {
      nome: values.nome.trim(),
      cognome: values.cognome?.trim() || null,
      strumento: values.strumento.trim(),
      dataNascita: values.dataNascita || null,
      nazionalita: values.nazionalita?.trim() || null,
      email: values.email?.trim() || null,
      telefono: values.telefono?.trim() || null,
      sesso: values.sesso?.trim() || null,
      luogoNascita: values.luogoNascita?.trim() || null,
      codiceFiscale: values.codiceFiscale?.trim().toUpperCase() || null,
      indirizzo: values.indirizzo?.trim() || null,
      citta: values.citta?.trim() || null,
      cap: values.cap?.trim() || null,
      provincia: values.provincia?.trim().toUpperCase() || null,
      paese: values.paese?.trim() || null,
      anniStudio: Number.isFinite(anniStudio) ? anniStudio : null,
      scuolaProvenienza: values.scuolaProvenienza?.trim() || null,
      docentiPreparatori: docentiLines,
      noteLibere: values.noteLibere?.trim() || null,
      sezioneId: values.sezioneId || null,
      categoriaId: values.categoriaId || null,
      tipo: values.tipo,
      gruppoNome: isGroupLike ? values.gruppoNome?.trim() || null : null,
      tipoGruppo: (
        values.tipo === 'orchestra'
          ? 'orchestra'
          : values.tipo === 'gruppo'
            ? 'ensemble'
            : null
      ) as 'orchestra' | 'ensemble' | null | undefined,
    };

    try {
      let savedId = existing?.id;
      if (isEdit && existing) {
        await updateMutation.mutateAsync({ id: existing.id, data: body });
        savedId = existing.id;
        toast.success('Candidato aggiornato');
      } else {
        const created = await createMutation.mutateAsync({ concorsoId, ...body });
        savedId = created.id;
        toast.success('Candidato aggiunto');
      }

      if (fotoFile && savedId) {
        setIsUploadingFoto(true);
        try {
          await candidatiApi.uploadFoto(savedId, fotoFile);
        } catch {
          toast.warning('Candidato salvato, ma errore nel caricamento della foto');
        } finally {
          setIsUploadingFoto(false);
        }
      }

      onSaved?.();
      onOpenChange(false);
    } catch (e) {
      toast.error(httpErrorMessage(e));
    }
  };

  const isPending =
    createMutation.isPending || updateMutation.isPending || isUploadingFoto;

  const inputCls = 'c-input';
  const selectCls = 'c-select';
  const textareaCls = 'c-textarea';

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-3xl max-h-[90dvh] flex flex-col">
        <DialogHeader>
          <DialogTitle>
            {isEdit ? 'Modifica candidato' : 'Nuovo candidato'}
          </DialogTitle>
          {isEdit && existing && (
            <DialogDescription>{displayName(existing)}</DialogDescription>
          )}
        </DialogHeader>

        <form
          onSubmit={form.handleSubmit(onSubmit)}
          className="space-y-5 overflow-y-auto flex-1 pr-1"
          autoComplete="off"
        >
          {/* ---- Foto + anagrafica base ---- */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {/* foto: span completo + centrato */}
            <div className="sm:col-span-2 flex items-center gap-4">
              <div className="w-20 h-20 rounded-full bg-slate-100 border-2 border-slate-200 overflow-hidden flex items-center justify-center shrink-0">
                {currentFotoUrl
                  ? <img src={currentFotoUrl} alt="" className="w-full h-full object-cover" />
                  : <span className="text-3xl text-slate-400">👤</span>}
              </div>
              <div className="flex-1 min-w-0">
                <button
                  type="button"
                  className="c-btn c-btn--sm c-btn--outline"
                  onClick={() => fotoInputRef.current?.click()}
                >
                  {currentFotoUrl ? 'Cambia foto' : 'Aggiungi foto'}
                </button>
                {(fotoFile || fotoPreview) && (
                  <button
                    type="button"
                    className="c-btn c-btn--sm c-btn--ghost ml-1 text-rose-600"
                    onClick={() => { setFotoFile(null); setFotoPreview(null); }}
                  >
                    Rimuovi
                  </button>
                )}
                <input
                  ref={fotoInputRef}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={handleFotoChange}
                />
                <p className="text-[10px] text-slate-500 mt-1.5">
                  JPG, PNG, WebP — max 2 MB. Verrà ridimensionata automaticamente.
                </p>
              </div>
            </div>

            {/* Nome */}
            <label className="c-field">
              <span className="c-field__label">
                Nome <span className="text-rose-500">*</span>
              </span>
              <input
                {...form.register('nome')}
                className={inputCls}
                placeholder="Mario"
              />
              {form.formState.errors.nome && (
                <span className="c-field__hint text-rose-500">{form.formState.errors.nome.message}</span>
              )}
            </label>

            {/* Cognome */}
            <label className="c-field">
              <span className="c-field__label">
                Cognome {!isGroupLike && <span className="text-rose-500">*</span>}
              </span>
              <input
                {...form.register('cognome')}
                className={inputCls}
                placeholder="Rossi"
              />
            </label>

            {/* Strumento */}
            <label className="c-field">
              <span className="c-field__label">
                Strumento <span className="text-rose-500">*</span>
              </span>
              <input
                {...form.register('strumento')}
                className={inputCls}
                placeholder="es. Pianoforte"
              />
              {form.formState.errors.strumento && (
                <span className="c-field__hint text-rose-500">{form.formState.errors.strumento.message}</span>
              )}
            </label>

            {/* Tipo */}
            <label className="c-field">
              <span className="c-field__label">Tipo</span>
              <select
                {...form.register('tipo')}
                className={selectCls}
                onChange={(e) => {
                  form.setValue('tipo', e.target.value as 'individuale' | 'gruppo' | 'orchestra');
                  if (e.target.value === 'individuale') form.setValue('gruppoNome', '');
                }}
              >
                <option value="individuale">Individuale</option>
                <option value="gruppo">Gruppo / Ensemble</option>
                <option value="orchestra">Orchestra</option>
              </select>
            </label>

            {/* Data di nascita (solo individuale) */}
            {!isGroupLike && (
              <label className="c-field">
                <span className="c-field__label">
                  Data di nascita <span className="text-rose-500">*</span>
                </span>
                <input
                  type="date"
                  {...form.register('dataNascita')}
                  className={inputCls}
                  max={new Date().toISOString().slice(0, 10)}
                />
              </label>
            )}

            {/* Nazionalità (solo individuale) */}
            {!isGroupLike && (
              <label className="c-field">
                <span className="c-field__label">
                  Nazionalità <span className="text-rose-500">*</span>
                </span>
                <input
                  {...form.register('nazionalita')}
                  className={inputCls}
                  list="naz-list"
                  placeholder="es. Italiana"
                />
                <datalist id="naz-list">
                  {['Italiana', 'Tedesca', 'Francese', 'Spagnola', 'Inglese', 'Statunitense', 'Cinese', 'Giapponese', 'Russa', 'Brasiliana'].map((n) => (
                    <option key={n} value={n} />
                  ))}
                </datalist>
              </label>
            )}

            {/* Sesso (solo individuale) */}
            {!isGroupLike && (
              <label className="c-field">
                <span className="c-field__label">Sesso</span>
                <select {...form.register('sesso')} className={selectCls}>
                  <option value="">— Seleziona —</option>
                  <option value="M">Maschio</option>
                  <option value="F">Femmina</option>
                  <option value="altro">Altro / preferisco non specificare</option>
                </select>
              </label>
            )}

            {/* Luogo di nascita (solo individuale) */}
            {!isGroupLike && (
              <label className="c-field">
                <span className="c-field__label">Luogo di nascita</span>
                <input
                  {...form.register('luogoNascita')}
                  className={inputCls}
                  placeholder="Città (Provincia)"
                />
              </label>
            )}

            {/* Codice fiscale (solo individuale, col-span-2) */}
            {!isGroupLike && (
              <label className="c-field sm:col-span-2">
                <span className="c-field__label">Codice fiscale</span>
                <input
                  {...form.register('codiceFiscale')}
                  className={`${inputCls} font-mono uppercase`}
                  maxLength={16}
                  placeholder="RSSMRA80A01H501U"
                  onChange={(e) => {
                    e.target.value = e.target.value.toUpperCase();
                    form.setValue('codiceFiscale', e.target.value);
                  }}
                />
              </label>
            )}
          </div>

          {/* ---- Gruppo/Orchestra: nome ensemble (condizionale) ---- */}
          {isGroupLike && (
            <div
              className="pt-4 border-t border-slate-200 space-y-4"
            >
              <label className="c-field">
                <span className="c-field__label">
                  {tipo === 'orchestra' ? "Nome dell'orchestra" : 'Nome del gruppo / ensemble'}
                </span>
                <input
                  {...form.register('gruppoNome')}
                  className={inputCls}
                  placeholder={tipo === 'orchestra' ? 'es. Orchestra Giovanile di Milano' : 'es. Quartetto Brillante'}
                />
              </label>
            </div>
          )}

          {/* ---- Contatti ---- */}
          <div className="pt-4 border-t border-slate-200">
            <header className="mb-3">
              <h4 className="text-sm font-semibold text-slate-700">Contatti</h4>
              <p className="text-[11px] text-slate-500">Email e recapiti per comunicazioni dell'organizzazione.</p>
            </header>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <label className="c-field">
                <span className="c-field__label">Email</span>
                <input
                  type="email"
                  {...form.register('email')}
                  className={inputCls}
                  placeholder="nome@esempio.it"
                />
                {form.formState.errors.email && (
                  <span className="c-field__hint text-rose-500">{form.formState.errors.email.message}</span>
                )}
              </label>
              <label className="c-field">
                <span className="c-field__label">Telefono</span>
                <input
                  type="tel"
                  {...form.register('telefono')}
                  className={inputCls}
                  placeholder="+39 ..."
                />
              </label>
              <label className="c-field sm:col-span-2">
                <span className="c-field__label">Indirizzo</span>
                <input
                  {...form.register('indirizzo')}
                  className={inputCls}
                  placeholder="Via, civico"
                />
              </label>
              <label className="c-field">
                <span className="c-field__label">Città</span>
                <input {...form.register('citta')} className={inputCls} />
              </label>
              <label className="c-field">
                <span className="c-field__label">CAP</span>
                <input {...form.register('cap')} className={inputCls} maxLength={10} />
              </label>
              <label className="c-field">
                <span className="c-field__label">Provincia</span>
                <input {...form.register('provincia')} className={inputCls} maxLength={3} placeholder="MI" />
              </label>
              <label className="c-field">
                <span className="c-field__label">Paese</span>
                <input {...form.register('paese')} className={inputCls} />
              </label>
            </div>
          </div>

          {/* ---- Studi musicali ---- */}
          <div className="pt-4 border-t border-slate-200">
            <header className="mb-3">
              <h4 className="text-sm font-semibold text-slate-700">Studi musicali</h4>
              <p className="text-[11px] text-slate-500">Esperienza e provenienza.</p>
            </header>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <label className="c-field">
                <span className="c-field__label">Anni di studio</span>
                <input
                  type="number"
                  min={0}
                  max={80}
                  {...form.register('anniStudio')}
                  className={inputCls}
                />
              </label>
              <label className="c-field sm:col-span-2">
                <span className="c-field__label">Scuola / Conservatorio di provenienza</span>
                <input {...form.register('scuolaProvenienza')} className={inputCls} />
              </label>
            </div>
          </div>

          {/* ---- Docenti preparatori ---- */}
          <div className="pt-4 border-t border-slate-200">
            <label className="c-field">
              <span className="c-field__label">
                Docenti preparatori{' '}
                <span className="text-[11px] text-slate-500 font-normal">(uno per riga)</span>
              </span>
              <textarea
                {...form.register('docentiPreparatori')}
                rows={3}
                className={textareaCls}
                placeholder="Prof. Mario Rossi&#10;Prof.ssa Anna Bianchi"
              />
            </label>
          </div>

          {/* ---- Sezione e categoria ---- */}
          {sezioni.length > 0 && (
            <div className="pt-4 border-t border-slate-200">
              <header className="mb-3">
                <h4 className="text-sm font-semibold text-slate-700">Sezione e categoria</h4>
                <p className="text-[11px] text-slate-500">
                  Un candidato appartiene a una sola sezione e a una sola categoria all'interno di essa.
                </p>
              </header>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <label className="c-field">
                  <span className="c-field__label">Sezione</span>
                  <select
                    {...form.register('sezioneId')}
                    className={selectCls}
                    onChange={(e) => {
                      form.setValue('sezioneId', e.target.value);
                      form.setValue('categoriaId', '');
                    }}
                  >
                    <option value="">— Nessuna sezione —</option>
                    {sezioni.map((s) => (
                      <option key={s.id} value={s.id}>{s.nome}</option>
                    ))}
                  </select>
                </label>
                {filteredCategorie.length > 0 && (
                  <label className="c-field">
                    <span className="c-field__label">Categoria</span>
                    <select {...form.register('categoriaId')} className={selectCls}>
                      <option value="">— Nessuna categoria —</option>
                      {filteredCategorie.map((c) => (
                        <option key={c.id} value={c.id}>{c.nome}</option>
                      ))}
                    </select>
                  </label>
                )}
              </div>
            </div>
          )}

          {/* ---- Note libere ---- */}
          <div className="pt-4 border-t border-slate-200">
            <label className="c-field">
              <span className="c-field__label">
                Note libere{' '}
                <span className="text-[11px] text-slate-500 font-normal">(opzionale)</span>
              </span>
              <textarea
                {...form.register('noteLibere')}
                rows={2}
                className={textareaCls}
                placeholder="Qualsiasi informazione utile all'organizzazione"
              />
            </label>
          </div>

          <DialogFooter className="pt-2">
            <button
              type="button"
              className="c-btn c-btn--outline"
              onClick={() => onOpenChange(false)}
            >
              Annulla
            </button>
            <button
              type="submit"
              className="c-btn c-btn--primary"
              disabled={isPending}
            >
              {isPending
                ? 'Salvataggio…'
                : isEdit
                  ? 'Salva modifiche'
                  : 'Aggiungi candidato'}
            </button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// DeleteConfirmDialog
// ---------------------------------------------------------------------------

interface DeleteConfirmProps {
  open: boolean;
  candidato: CandidatoFull | null;
  onCancel: () => void;
  onConfirm: () => void;
  isPending: boolean;
}

function DeleteConfirmDialog({ open, candidato, onCancel, onConfirm, isPending }: DeleteConfirmProps) {
  return (
    <Dialog open={open} onOpenChange={(v) => !v && onCancel()}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Elimina candidato</DialogTitle>
          <DialogDescription>
            Eliminare definitivamente{' '}
            <strong>{candidato ? displayName(candidato) : ''}</strong>? L&apos;operazione non è reversibile.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <button className="c-btn c-btn--outline" onClick={onCancel}>
            Annulla
          </button>
          <button
            className="c-btn c-btn--danger"
            onClick={onConfirm}
            disabled={isPending}
          >
            {isPending ? 'Eliminazione…' : 'Elimina'}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// CandidatoCard  (matches candidatoCardHtml from candidati.js)
// ---------------------------------------------------------------------------

interface CandidatoCardProps {
  candidato: CandidatoFull;
  sezione?: Sezione;
  categoria?: Categoria;
  onEdit: () => void;
  onDelete: () => void;
}

function CandidatoCard({ candidato: c, sezione, categoria, onEdit, onDelete }: CandidatoCardProps) {
  const isOrchestra = c.tipo === 'orchestra';
  const isGroupLike = c.tipo === 'gruppo' || isOrchestra;
  const age = ageFromDate(c.dataNascita);
  const fotoSrc = c.fotoUrl ? fileUrl(c.fotoUrl) : null;
  const docenti = c.docentiPreparatori ?? [];

  return (
    <div
      className={[
        'bg-white border rounded-2xl p-4 flex items-start gap-3 hover:border-slate-300 transition',
        isGroupLike ? 'border-purple-200 bg-purple-50/30' : 'border-slate-200',
      ].join(' ')}
    >
      {/* Avatar */}
      <div
        className={[
          'w-14 h-14 rounded-full overflow-hidden flex items-center justify-center text-2xl text-slate-400 shrink-0 ring-2 ring-white shadow-soft',
          isGroupLike ? 'bg-purple-100' : 'bg-slate-100',
        ].join(' ')}
      >
        {fotoSrc ? (
          <img src={fotoSrc} alt="" className="w-full h-full object-cover" />
        ) : isGroupLike ? (
          isOrchestra
            ? <Music className="h-6 w-6 text-purple-500" />
            : <Users className="h-6 w-6 text-purple-500" />
        ) : (
          <span>👤</span>
        )}
      </div>

      {/* Info */}
      <div className="flex-1 min-w-0">
        {/* numero + badge tipo */}
        <div className="flex items-center gap-2">
          {c.numeroCandidato != null && (
            <span className="font-mono text-[11px] text-slate-500">
              #{String(c.numeroCandidato).padStart(3, '0')}
            </span>
          )}
          {isGroupLike && (
            <span className="text-[10px] px-1.5 py-0.5 bg-purple-100 text-purple-700 rounded-full font-bold uppercase tracking-wider">
              {isOrchestra ? 'Orchestra' : 'Gruppo'}
            </span>
          )}
          {!isGroupLike && c.nazionalita && (
            <span className="text-[10px] px-1.5 py-0.5 bg-slate-100 text-slate-700 rounded-full font-medium">
              {c.nazionalita}
            </span>
          )}
        </div>

        <h4 className="font-semibold text-slate-900 truncate mt-0.5">{displayName(c)}</h4>

        {c.gruppoNome && (
          <p className="text-[11px] text-purple-700 truncate">{c.gruppoNome}</p>
        )}

        <p className="text-xs text-slate-600 truncate">
          {c.strumento ?? '—'}
          {!isGroupLike && age != null && ` · ${age} anni`}
        </p>

        {/* Data di nascita */}
        {!isGroupLike && c.dataNascita && (
          <p className="text-[11px] text-slate-500 mt-0.5">
            Nato/a il {fmtDate(c.dataNascita)}
          </p>
        )}

        {/* Sezione / categoria badges */}
        {(sezione || categoria) && (
          <div className="mt-1.5 flex items-center gap-1 flex-wrap">
            {sezione && (
              <span className="text-[10px] px-1.5 py-0.5 bg-brand-50 text-brand-700 rounded-full font-medium">
                {sezione.nome}
              </span>
            )}
            {categoria && (
              <span className="text-[10px] px-1.5 py-0.5 bg-cyan-50 text-cyan-700 rounded-full font-medium">
                📑 {categoria.nome}
              </span>
            )}
          </div>
        )}

        {/* Docenti */}
        {docenti.length > 0 && (
          <div className="mt-1.5 flex items-center gap-1 flex-wrap">
            <span
              className="text-[10px] px-1.5 py-0.5 bg-violet-50 text-violet-700 rounded-full font-medium"
              title={docenti.join(' · ')}
            >
              {docenti.length === 1
                ? '1 docente preparatore'
                : `${docenti.length} docenti preparatori`}
            </span>
          </div>
        )}
      </div>

      {/* Actions — matches vanilla (data-edit, data-del buttons) */}
      <div className="flex flex-col gap-1 shrink-0">
        <button
          className="text-xs text-brand-600 hover:bg-brand-50 px-2 py-1 rounded-lg font-medium"
          onClick={onEdit}
        >
          <Pencil className="inline h-3 w-3 mr-0.5" />
          Modifica
        </button>
        <button
          className="text-xs text-rose-600 hover:bg-rose-50 px-2 py-1 rounded-lg font-medium"
          onClick={onDelete}
        >
          <Trash2 className="inline h-3 w-3 mr-0.5" />
          Elimina
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// CandidatiTab (exported)
// ---------------------------------------------------------------------------

export function CandidatiTab({ concorsoId }: { concorsoId: string }) {
  const {
    candidati,
    sezioni,
    categorie,
    isLoading,
    isError,
    deleteMutation,
  } = useCandidati(concorsoId);

  const [search, setSearch] = useState('');
  const [filterSezioneId, setFilterSezioneId] = useState('');
  const [filterTipo, setFilterTipo] = useState('');

  const [dialog, setDialog] = useState<{ open: boolean; existing?: CandidatoFull }>({
    open: false,
  });
  const [deleteDialog, setDeleteDialog] = useState<{ open: boolean; candidato?: CandidatoFull }>({
    open: false,
  });

  const filtered = useMemo(() => {
    const q = search.toLowerCase().trim();
    return candidati.filter((c) => {
      if (filterSezioneId && c.sezioneId !== filterSezioneId) return false;
      if (filterTipo && c.tipo !== filterTipo) return false;
      if (q) {
        const text = [c.nome, c.cognome, c.strumento, c.email, c.nazionalita, c.gruppoNome]
          .filter(Boolean)
          .join(' ')
          .toLowerCase();
        if (!text.includes(q)) return false;
      }
      return true;
    });
  }, [candidati, search, filterSezioneId, filterTipo]);

  const sezioneMap = useMemo(
    () => new Map(sezioni.map((s) => [s.id, s])),
    [sezioni],
  );
  const categoriaMap = useMemo(
    () => new Map(categorie.map((c) => [c.id, c])),
    [categorie],
  );

  const handleDelete = async () => {
    if (!deleteDialog.candidato) return;
    try {
      await deleteMutation.mutateAsync(deleteDialog.candidato.id);
      toast.success('Candidato eliminato');
      setDeleteDialog({ open: false });
    } catch (e) {
      toast.error(httpErrorMessage(e));
    }
  };

  // ---------------------------------------------------------------------------
  // Loading / error states
  // ---------------------------------------------------------------------------
  if (isLoading) {
    return (
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3">
        {[1, 2, 3].map((i) => (
          <div key={i} className="bg-white border border-slate-200 rounded-2xl p-4 h-24 animate-pulse" />
        ))}
      </div>
    );
  }

  if (isError) {
    return (
      <p className="text-sm text-rose-600">Errore nel caricamento dei candidati.</p>
    );
  }

  return (
    <div className="space-y-4 view-fade">
      {/* ---- Header: count + add button (matches renderCandidati toolbar) ---- */}
      <div className="flex flex-wrap items-center justify-between gap-2 mb-4">
        <p className="text-sm text-slate-600">
          {candidati.length} candidat{candidati.length === 1 ? 'o' : 'i'}
          {filtered.length !== candidati.length && ` · ${filtered.length} mostrat${filtered.length === 1 ? 'o' : 'i'}`}
        </p>
        <div className="flex items-center gap-2">
          <button
            className="c-btn c-btn--sm c-btn--primary"
            onClick={() => setDialog({ open: true })}
          >
            <Plus className="h-4 w-4" />
            Aggiungi candidato
          </button>
        </div>
      </div>

      {/* ---- Filters ---- */}
      <div className="flex flex-wrap gap-2 mb-2">
        {/* Ricerca testo */}
        <div className="relative flex-1 min-w-48">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400 pointer-events-none" />
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Cerca per nome, strumento…"
            className="c-input pl-8 h-9 text-sm"
          />
          {search && (
            <button
              type="button"
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
              onClick={() => setSearch('')}
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>

        {/* Filtro sezione */}
        {sezioni.length > 0 && (
          <div className="relative">
            <Filter className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-400 pointer-events-none" />
            <select
              value={filterSezioneId}
              onChange={(e) => setFilterSezioneId(e.target.value)}
              className="c-select pl-7 h-9 text-sm w-44"
            >
              <option value="">Tutte le sezioni</option>
              {sezioni.map((s) => (
                <option key={s.id} value={s.id}>{s.nome}</option>
              ))}
            </select>
          </div>
        )}

        {/* Filtro tipo */}
        <select
          value={filterTipo}
          onChange={(e) => setFilterTipo(e.target.value)}
          className="c-select h-9 text-sm w-40"
        >
          <option value="">Tutti i tipi</option>
          <option value="individuale">Individuale</option>
          <option value="gruppo">Gruppo</option>
          <option value="orchestra">Orchestra</option>
        </select>

        {/* Reset filtri */}
        {(search || filterSezioneId || filterTipo) && (
          <button
            type="button"
            className="c-btn c-btn--sm c-btn--ghost text-slate-500"
            onClick={() => { setSearch(''); setFilterSezioneId(''); setFilterTipo(''); }}
          >
            <X className="h-3.5 w-3.5" />
            Reset
          </button>
        )}
      </div>

      {/* ---- Empty state (no candidati) ---- */}
      {candidati.length === 0 ? (
        <div className="bg-white border-2 border-dashed border-slate-200 rounded-2xl py-12 text-center">
          <GraduationCap className="mx-auto h-10 w-10 text-slate-300 mb-2" />
          <p className="text-sm text-slate-500 italic">Nessun candidato — aggiungine uno.</p>
          <button
            className="c-btn c-btn--sm c-btn--outline mt-4"
            onClick={() => setDialog({ open: true })}
          >
            <Plus className="h-4 w-4" />
            Aggiungi il primo candidato
          </button>
        </div>
      ) : filtered.length === 0 ? (
        /* ---- Empty state (filtri) ---- */
        <div className="bg-white border-2 border-dashed border-slate-200 rounded-2xl py-10 text-center">
          <Search className="mx-auto h-8 w-8 text-slate-300 mb-2" />
          <p className="text-sm text-slate-500 italic">
            Nessun candidato corrisponde ai filtri selezionati.
          </p>
        </div>
      ) : (
        /* ---- Grid (matches .grid.grid-cols-1.sm:grid-cols-2.xl:grid-cols-3) ---- */
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3">
          {filtered.map((c) => (
            <CandidatoCard
              key={c.id}
              candidato={c}
              sezione={c.sezioneId ? sezioneMap.get(c.sezioneId) : undefined}
              categoria={c.categoriaId ? categoriaMap.get(c.categoriaId) : undefined}
              onEdit={() => setDialog({ open: true, existing: c })}
              onDelete={() => setDeleteDialog({ open: true, candidato: c })}
            />
          ))}
        </div>
      )}

      {/* ---- Form dialog ---- */}
      <CandidatoFormDialog
        open={dialog.open}
        onOpenChange={(v) => setDialog((p) => ({ ...p, open: v }))}
        concorsoId={concorsoId}
        sezioni={sezioni}
        categorie={categorie}
        existing={dialog.existing}
        onSaved={() => setDialog({ open: false })}
      />

      {/* ---- Delete confirm ---- */}
      <DeleteConfirmDialog
        open={deleteDialog.open}
        candidato={deleteDialog.candidato ?? null}
        onCancel={() => setDeleteDialog({ open: false })}
        onConfirm={handleDelete}
        isPending={deleteMutation.isPending}
      />
    </div>
  );
}

export default CandidatiTab;
