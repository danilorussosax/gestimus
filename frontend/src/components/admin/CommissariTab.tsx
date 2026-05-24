// =============================================================================
// CommissariTab — gestione commissari (admin)
//
// Layout/structure matches the vanilla commissari.js source exactly:
//  - Header + "Aggiungi" button
//  - ATTIVI grid (1/2/3 col) with commissario cards
//  - Empty state (dashed border)
//  - Archivio INATTIVI section below dashed border-t
//  - Create/Edit Dialog with foto preview, CV textarea, bio
// Presentation uses Tailwind classes mirroring vanilla (bg-white, border-slate-*,
// rounded-2xl, ring-amber-400, etc) because legacy.css maps them to CSS vars.
// Data wiring from '@/api/commissari' hooks is fully preserved.
// =============================================================================

import { useState, useRef, useCallback } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { toast } from 'sonner';
import { Plus, Pencil, Trash2, Archive, ArchiveRestore, FileText, Mail, Phone } from 'lucide-react';

import { fileUrl, httpErrorMessage } from '@/lib/api';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from '@/components/ui/dialog';
import {
  useCommissari,
  useCreateCommissario,
  useUpdateCommissario,
  useDeleteCommissario,
  useUploadCommissarioFoto,
  type CommissarioRecord,
} from '@/api/commissari';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function displayName(c: Pick<CommissarioRecord, 'nome' | 'cognome'>) {
  return [c.nome, c.cognome].filter(Boolean).join(' ');
}

function ageFromDate(dateStr: string | null): number | null {
  if (!dateStr) return null;
  const dob = new Date(dateStr);
  const today = new Date();
  let age = today.getFullYear() - dob.getFullYear();
  const m = today.getMonth() - dob.getMonth();
  if (m < 0 || (m === 0 && today.getDate() < dob.getDate())) age--;
  return age >= 0 ? age : null;
}

// ---------------------------------------------------------------------------
// Zod schema
// ---------------------------------------------------------------------------
const commissarioSchema = z.object({
  nome: z.string().min(1, 'Nome obbligatorio').max(255),
  cognome: z.string().max(255).optional(),
  specialita: z.string().max(255).optional(),
  email: z.union([z.string().email('Email non valida'), z.literal('')]).optional(),
  telefono: z.string().max(50).optional(),
  dataNascita: z.string().optional(),
  nazionalita: z.string().max(100).optional(),
  bio: z.string().max(5000).optional(),
  cv: z.string().max(20000).optional(),
});
type CommissarioFormValues = z.infer<typeof commissarioSchema>;

// ---------------------------------------------------------------------------
// CvPreviewDialog — readonly view of the CV text (mirrors vanilla openCvText)
// ---------------------------------------------------------------------------
function CvPreviewDialog({ cv, open, onClose }: { cv: string; open: boolean; onClose: () => void }) {
  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Curriculum vitae</DialogTitle>
        </DialogHeader>
        <div className="whitespace-pre-wrap break-words text-sm text-slate-800 leading-relaxed max-h-[60vh] overflow-y-auto font-mono">
          {cv || <span className="italic text-slate-400">Vuoto</span>}
        </div>
        <DialogFooter>
          <button type="button" className="c-btn c-btn--outline" onClick={onClose}>
            Chiudi
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// CommissarioFormDialog — create / edit dialog mirroring vanilla openCommissarioForm
// ---------------------------------------------------------------------------
interface FormDialogProps {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  concorsoId: string;
  existing?: CommissarioRecord;
}

function CommissarioFormDialog({ open, onOpenChange, concorsoId, existing }: FormDialogProps) {
  const isEdit = !!existing;
  const createCommissario = useCreateCommissario(concorsoId);
  const updateCommissario = useUpdateCommissario(concorsoId);
  const uploadFoto = useUploadCommissarioFoto(concorsoId);

  const [fotoPreview, setFotoPreview] = useState<string | null>(null);
  const [fotoFile, setFotoFile] = useState<File | null>(null);
  const fotoInputRef = useRef<HTMLInputElement>(null);
  const [cvPreviewOpen, setCvPreviewOpen] = useState(false);
  const [cvEditing, setCvEditing] = useState(false);

  const todayISO = new Date().toISOString().slice(0, 10);

  const form = useForm<CommissarioFormValues>({
    resolver: zodResolver(commissarioSchema),
    values: {
      nome: existing?.nome ?? '',
      cognome: existing?.cognome ?? '',
      specialita: existing?.specialita ?? '',
      email: existing?.email ?? '',
      telefono: existing?.telefono ?? '',
      dataNascita: existing?.dataNascita ?? '',
      nazionalita: existing?.nazionalita ?? '',
      bio: existing?.bio ?? '',
      cv: existing?.cv ?? '',
    },
  });

  const currentFotoUrl = fotoPreview ?? (existing?.foto ? fileUrl(existing.foto) : null);
  const cvValue = form.watch('cv') ?? '';

  const handleFotoChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setFotoFile(file);
    const reader = new FileReader();
    reader.onload = () => setFotoPreview(reader.result as string);
    reader.readAsDataURL(file);
    e.target.value = '';
  }, []);

  const handleClearFoto = () => {
    setFotoPreview(null);
    setFotoFile(null);
  };

  const onSubmit = async (values: CommissarioFormValues) => {
    const body = {
      nome: values.nome.trim(),
      cognome: values.cognome?.trim() || undefined,
      specialita: values.specialita?.trim() || undefined,
      email: values.email?.trim() || undefined,
      telefono: values.telefono?.trim() || undefined,
      dataNascita: values.dataNascita || null,
      nazionalita: values.nazionalita?.trim() || undefined,
      bio: values.bio?.trim() || undefined,
      cv: values.cv?.trim() || undefined,
    };

    try {
      let savedId = existing?.id;
      if (isEdit && existing) {
        await updateCommissario.mutateAsync({ id: existing.id, body });
        toast.success('Commissario aggiornato');
      } else {
        const created = await createCommissario.mutateAsync({ concorsoId, ...body });
        savedId = created.id;
        toast.success('Commissario aggiunto');
      }

      if (fotoFile && savedId) {
        await uploadFoto.mutateAsync({ id: savedId, file: fotoFile });
      }

      onOpenChange(false);
    } catch (e) {
      toast.error(httpErrorMessage(e));
    }
  };

  const isPending =
    createCommissario.isPending || updateCommissario.isPending || uploadFoto.isPending;

  const inputCls =
    'c-input mt-1';

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle>
              {isEdit ? 'Modifica commissario' : 'Nuovo commissario'}
            </DialogTitle>
            {isEdit && existing && (
              <DialogDescription>{displayName(existing)}</DialogDescription>
            )}
          </DialogHeader>

          <form
            onSubmit={form.handleSubmit(onSubmit)}
            id="commissario-frm"
            className="space-y-5 overflow-y-auto max-h-[70dvh] pr-1"
            autoComplete="off"
          >
            {/* ---- Dati anagrafici ---- */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <label className="block">
                <span className="text-sm font-medium text-slate-700">
                  Nome <span className="text-rose-500">*</span>
                </span>
                <input {...form.register('nome')} required className={inputCls} />
                {form.formState.errors.nome && (
                  <p className="mt-1 text-xs text-rose-600">{form.formState.errors.nome.message}</p>
                )}
              </label>
              <label className="block">
                <span className="text-sm font-medium text-slate-700">
                  Cognome <span className="text-rose-500">*</span>
                </span>
                <input {...form.register('cognome')} className={inputCls} />
              </label>
              <label className="block">
                <span className="text-sm font-medium text-slate-700">
                  Specialità <span className="text-rose-500">*</span>
                </span>
                <input
                  {...form.register('specialita')}
                  className={inputCls}
                  placeholder="Es. Pianoforte classico"
                />
              </label>
              <label className="block">
                <span className="text-sm font-medium text-slate-700">Data di nascita</span>
                <input
                  type="date"
                  {...form.register('dataNascita')}
                  max={todayISO}
                  className={inputCls}
                />
              </label>
              <label className="block">
                <span className="text-sm font-medium text-slate-700">Nazionalità</span>
                <input
                  {...form.register('nazionalita')}
                  className={inputCls}
                  placeholder="Es. Italiana"
                />
              </label>
              <label className="block">
                <span className="text-sm font-medium text-slate-700">Email</span>
                <input
                  type="email"
                  {...form.register('email')}
                  className={inputCls}
                  placeholder="mario@esempio.it"
                />
                {form.formState.errors.email && (
                  <p className="mt-1 text-xs text-rose-600">{form.formState.errors.email.message}</p>
                )}
              </label>
              <label className="block sm:col-span-2">
                <span className="text-sm font-medium text-slate-700">Telefono</span>
                <input
                  type="tel"
                  {...form.register('telefono')}
                  className={inputCls}
                  placeholder="+39 333 000 0000"
                />
              </label>
            </div>

            {/* ---- Foto + CV ---- */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-4 border-t border-slate-200">
              {/* Foto */}
              <div>
                <span className="text-sm font-medium text-slate-700 block mb-2">Foto</span>
                <div className="flex items-center gap-3">
                  <div className="w-20 h-20 rounded-full bg-slate-100 border-2 border-slate-200 overflow-hidden flex items-center justify-center shrink-0">
                    {currentFotoUrl ? (
                      <img src={currentFotoUrl} alt="" className="w-full h-full object-cover" />
                    ) : (
                      <span className="text-3xl text-slate-400">🧑‍⚖️</span>
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <button
                      type="button"
                      className="inline-flex items-center px-3 py-1.5 text-sm font-medium text-brand-700 bg-brand-50 hover:bg-brand-100 rounded-lg transition"
                      onClick={() => fotoInputRef.current?.click()}
                    >
                      {currentFotoUrl ? 'Cambia foto' : 'Carica foto'}
                    </button>
                    {currentFotoUrl && (
                      <button
                        type="button"
                        className="ml-1 text-xs font-medium text-rose-600 hover:text-rose-800"
                        onClick={handleClearFoto}
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
                      JPG o PNG, max 2 MB. Verrà ridimensionata.
                    </p>
                  </div>
                </div>
              </div>

              {/* CV */}
              <div>
                <span className="text-sm font-medium text-slate-700 block mb-2">
                  Curriculum vitae (testo)
                </span>
                <div className="flex items-center gap-2 flex-wrap">
                  <button
                    type="button"
                    className="inline-flex items-center gap-1.5 px-3 py-2 text-sm font-medium text-slate-700 bg-slate-50 hover:bg-slate-100 border border-slate-200 rounded-lg transition"
                    onClick={() => setCvEditing((v) => !v)}
                  >
                    {cvEditing
                      ? 'Chiudi'
                      : cvValue.trim().length > 0
                        ? 'Modifica CV'
                        : 'Aggiungi CV'}
                  </button>
                  {cvValue.trim().length > 0 && (
                    <>
                      <button
                        type="button"
                        className="text-xs font-medium text-emerald-700 hover:text-emerald-900 px-2 py-1 rounded-lg"
                        onClick={() => setCvPreviewOpen(true)}
                      >
                        Visualizza
                      </button>
                      <button
                        type="button"
                        className="text-xs font-medium text-rose-600 hover:text-rose-800 px-2 py-1 rounded-lg"
                        onClick={() => {
                          form.setValue('cv', '');
                          setCvEditing(false);
                        }}
                      >
                        Rimuovi
                      </button>
                      <span className="text-[11px] text-slate-500">{cvValue.length} car.</span>
                    </>
                  )}
                </div>
                {cvEditing && (
                  <textarea
                    {...form.register('cv')}
                    rows={6}
                    className="c-textarea mt-2 font-mono text-[13px]"
                    placeholder="Incolla il testo del CV o scrivi una nota biografica estesa…"
                  />
                )}
                <p className="text-[10px] text-slate-500 mt-1.5">
                  Testo libero (plain text o Markdown).
                </p>
              </div>
            </div>

            {/* ---- Bio ---- */}
            <div className="pt-4 border-t border-slate-200">
              <label className="block">
                <span className="text-sm font-medium text-slate-700">Biografia</span>
                <textarea
                  {...form.register('bio')}
                  rows={3}
                  className="c-textarea mt-1"
                  placeholder="Breve presentazione del commissario…"
                />
              </label>
            </div>

            {/* ---- Nota presidente ---- */}
            <div className="pt-4 border-t border-slate-200">
              <div className="bg-amber-50 border border-amber-200 rounded-xl px-3 py-2.5 text-xs text-amber-900 flex items-start gap-2">
                <span className="text-base shrink-0">🎯</span>
                <p>
                  Per nominare un commissario <strong>presidente</strong>, vai al tab{' '}
                  <em>Commissioni</em>, apri (o crea) la commissione e seleziona il presidente dal
                  menù "Presidente della commissione".
                </p>
              </div>
            </div>

            <DialogFooter>
              <button
                type="button"
                className="c-btn c-btn--outline"
                onClick={() => onOpenChange(false)}
              >
                Annulla
              </button>
              <button type="submit" className="c-btn c-btn--primary" disabled={isPending}>
                {isPending
                  ? 'Salvataggio…'
                  : isEdit
                    ? 'Salva modifiche'
                    : 'Aggiungi commissario'}
              </button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {cvPreviewOpen && (
        <CvPreviewDialog
          cv={cvValue}
          open={cvPreviewOpen}
          onClose={() => setCvPreviewOpen(false)}
        />
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// CommissarioCard — active commissario tile (mirrors commissarioCardHtml)
// ---------------------------------------------------------------------------
interface CardProps {
  commissario: CommissarioRecord;
  onEdit: () => void;
  onArchive: () => void;
  onDelete: () => void;
  isPresidente: boolean;
}

function CommissarioCard({ commissario: c, onEdit, onArchive, onDelete, isPresidente }: CardProps) {
  const age = ageFromDate(c.dataNascita);
  const [cvOpen, setCvOpen] = useState(false);
  const fotoSrc = c.foto ? fileUrl(c.foto) : null;

  const ringCls = isPresidente ? 'ring-2 ring-amber-400' : 'ring-2 ring-white';
  const cardCls = isPresidente ? 'border-amber-300 bg-amber-50/40' : 'border-slate-200';

  return (
    <>
      <div
        className={`bg-white border ${cardCls} rounded-2xl p-4 flex items-start gap-3 hover:border-slate-300 transition`}
      >
        {/* Avatar */}
        <div
          className={`w-14 h-14 rounded-full bg-gradient-to-br from-amber-100 to-orange-100 overflow-hidden flex items-center justify-center text-2xl text-amber-700 shrink-0 ${ringCls} shadow-soft`}
        >
          {fotoSrc ? (
            <img src={fotoSrc} alt="" className="w-full h-full object-cover" />
          ) : (
            <span>🧑‍⚖️</span>
          )}
        </div>

        {/* Info */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h4 className="font-semibold text-slate-900 truncate">{displayName(c)}</h4>
            {isPresidente && (
              <span className="text-[10px] font-bold px-1.5 py-0.5 bg-amber-500 text-white rounded-full">
                Presidente
              </span>
            )}
            {c.nazionalita && (
              <span className="text-[10px] px-1.5 py-0.5 bg-slate-100 text-slate-700 rounded-full font-medium">
                {c.nazionalita}
              </span>
            )}
          </div>
          <p className="text-xs text-slate-600 truncate mt-0.5">
            {c.specialita ?? '—'}
            {age != null && ` · ${age} anni`}
          </p>
          {c.email && (
            <p className="text-[11px] text-slate-500 truncate mt-0.5 flex items-center gap-1">
              <Mail className="h-3 w-3 shrink-0" />
              {c.email}
            </p>
          )}
          {c.telefono && (
            <p className="text-[11px] text-slate-500 truncate flex items-center gap-1">
              <Phone className="h-3 w-3 shrink-0" />
              {c.telefono}
            </p>
          )}
          <div className="mt-2 flex items-center gap-1.5 flex-wrap">
            {c.cv && (
              <button
                onClick={() => setCvOpen(true)}
                className="inline-flex items-center gap-1 text-[11px] px-2 py-0.5 bg-emerald-50 text-emerald-700 hover:bg-emerald-100 rounded-full font-medium"
                title="Visualizza CV"
              >
                <FileText className="h-3 w-3" />
                CV
              </button>
            )}
            {c.bio && (
              <span
                className="text-[10px] px-1.5 py-0.5 bg-violet-50 text-violet-700 rounded-full font-medium"
                title={c.bio}
              >
                bio
              </span>
            )}
          </div>
        </div>

        {/* Actions — edit / archive / delete */}
        <div className="flex flex-col gap-1 shrink-0">
          <button
            onClick={onEdit}
            className="text-xs text-brand-600 hover:bg-brand-50 px-2 py-1 rounded-lg font-medium flex items-center gap-1"
          >
            <Pencil className="h-3 w-3" />
            Modifica
          </button>
          <button
            onClick={onArchive}
            className="text-xs text-amber-700 hover:bg-amber-50 px-2 py-1 rounded-lg font-medium flex items-center gap-1"
            title="Archivia commissario"
          >
            <Archive className="h-3 w-3" />
            Archivia
          </button>
          <button
            onClick={onDelete}
            className="text-xs text-rose-600 hover:bg-rose-50 px-2 py-1 rounded-lg font-medium flex items-center gap-1"
            title="Elimina commissario"
          >
            <Trash2 className="h-3 w-3" />
            Elimina
          </button>
        </div>
      </div>

      {c.cv && (
        <CvPreviewDialog cv={c.cv} open={cvOpen} onClose={() => setCvOpen(false)} />
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// ArchivioCard — INATTIVO row (compact, mirrors archivioCardHtml style)
// ---------------------------------------------------------------------------
function ArchivioCard({
  commissario: c,
  onReactivate,
  onDelete,
}: {
  commissario: CommissarioRecord;
  onReactivate: () => void;
  onDelete: () => void;
}) {
  const fotoSrc = c.foto ? fileUrl(c.foto) : null;
  return (
    <div className="bg-white border border-slate-200 rounded-2xl p-4 flex items-center gap-3 hover:border-slate-300 transition opacity-70">
      <div className="w-10 h-10 rounded-full bg-gradient-to-br from-amber-100 to-orange-100 overflow-hidden flex items-center justify-center text-lg text-amber-700 shrink-0 ring-2 ring-white shadow-soft">
        {fotoSrc ? (
          <img src={fotoSrc} alt="" className="w-full h-full object-cover" />
        ) : (
          <span>🧑‍⚖️</span>
        )}
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold text-slate-700 truncate">{displayName(c)}</p>
        {c.specialita && (
          <p className="text-xs text-slate-500 truncate">{c.specialita}</p>
        )}
      </div>
      <div className="flex items-center gap-1 shrink-0">
        <button
          onClick={onReactivate}
          className="text-xs text-emerald-700 hover:bg-emerald-50 px-2 py-1 rounded-lg font-medium flex items-center gap-1"
          title="Riattiva commissario"
        >
          <ArchiveRestore className="h-3 w-3" />
          Riattiva
        </button>
        <button
          onClick={onDelete}
          className="text-xs text-rose-600 hover:bg-rose-50 px-2 py-1 rounded-lg font-medium flex items-center gap-1"
          title="Elimina commissario"
        >
          <Trash2 className="h-3 w-3" />
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// CommissariTab (exported)
// ---------------------------------------------------------------------------
export default function CommissariTab({ concorsoId }: { concorsoId: string }) {
  const { data: all, isLoading, isError } = useCommissari(concorsoId);
  const updateCommissario = useUpdateCommissario(concorsoId);
  const deleteCommissario = useDeleteCommissario(concorsoId);

  const [dialog, setDialog] = useState<{ open: boolean; existing?: CommissarioRecord }>({
    open: false,
  });

  const attivi = all?.filter((c) => c.stato === 'ATTIVO') ?? [];
  const inattivi = all?.filter((c) => c.stato === 'INATTIVO') ?? [];

  // ---------------------------------------------------------------------------
  // Action handlers
  // ---------------------------------------------------------------------------
  const handleArchive = async (c: CommissarioRecord) => {
    if (!confirm(`Archiviare "${displayName(c)}"? Il commissario non potrà più accedere.`)) return;
    try {
      await updateCommissario.mutateAsync({ id: c.id, body: { stato: 'INATTIVO' } });
      toast.success(`${displayName(c)} archiviato`);
    } catch (e) {
      toast.error(httpErrorMessage(e));
    }
  };

  const handleReactivate = async (c: CommissarioRecord) => {
    try {
      await updateCommissario.mutateAsync({ id: c.id, body: { stato: 'ATTIVO' } });
      toast.success(`${displayName(c)} riattivato`);
    } catch (e) {
      toast.error(httpErrorMessage(e));
    }
  };

  const handleDelete = async (c: CommissarioRecord) => {
    if (!confirm(`Eliminare definitivamente "${displayName(c)}"? L'operazione non è reversibile.`))
      return;
    try {
      await deleteCommissario.mutateAsync(c.id);
      toast.success('Commissario eliminato');
    } catch (e) {
      toast.error(httpErrorMessage(e));
    }
  };

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------
  if (isLoading) {
    return (
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3">
        {[1, 2, 3].map((i) => (
          <div
            key={i}
            className="bg-white border border-slate-200 rounded-2xl p-4 h-24 animate-pulse"
          />
        ))}
      </div>
    );
  }

  if (isError) {
    return (
      <p className="text-sm text-rose-600">Errore nel caricamento dei commissari.</p>
    );
  }

  return (
    <div className="view-fade">
      {/* ---- Header ---- */}
      <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
        <h3 className="text-sm font-bold text-slate-800 uppercase tracking-wider">Commissari</h3>
        <div className="flex items-center gap-2">
          <button
            className="c-btn c-btn--primary c-btn--sm flex items-center gap-1.5"
            onClick={() => setDialog({ open: true })}
          >
            <Plus className="h-4 w-4" />
            Aggiungi commissario
          </button>
        </div>
      </div>

      <p className="text-sm text-slate-600 mb-4">
        {attivi.length} attivi
        {inattivi.length > 0 && ` · ${inattivi.length} in archivio`}
      </p>

      {/* ---- ATTIVI grid ---- */}
      {attivi.length === 0 ? (
        <div className="bg-white border-2 border-dashed border-slate-200 rounded-2xl py-12 text-center">
          <div className="text-4xl mb-2">🧑‍⚖️</div>
          <p className="text-sm text-slate-500 italic">
            Nessun commissario — aggiungine uno con il pulsante in alto.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3">
          {attivi.map((c) => (
            <CommissarioCard
              key={c.id}
              commissario={c}
              isPresidente={false} // presidente resolved in CommissioniTab
              onEdit={() => setDialog({ open: true, existing: c })}
              onArchive={() => handleArchive(c)}
              onDelete={() => handleDelete(c)}
            />
          ))}
        </div>
      )}

      {/* ---- Archivio INATTIVI ---- */}
      <div className="mt-8 pt-6 border-t-2 border-dashed border-brand-100">
        {inattivi.length > 0 && (
          <>
            <div className="flex flex-wrap items-center gap-3 mb-3">
              <div>
                <h3 className="text-sm font-bold text-slate-800 uppercase tracking-wider">
                  Archivio commissari
                </h3>
                <p className="text-xs text-slate-500">{inattivi.length} commissari archiviati</p>
              </div>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3">
              {inattivi.map((c) => (
                <ArchivioCard
                  key={c.id}
                  commissario={c}
                  onReactivate={() => handleReactivate(c)}
                  onDelete={() => handleDelete(c)}
                />
              ))}
            </div>
          </>
        )}
      </div>

      {/* ---- Form dialog ---- */}
      <CommissarioFormDialog
        open={dialog.open}
        onOpenChange={(v) => setDialog((p) => ({ ...p, open: v }))}
        concorsoId={concorsoId}
        existing={dialog.existing}
      />
    </div>
  );
}
