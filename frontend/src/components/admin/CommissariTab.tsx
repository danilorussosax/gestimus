// =============================================================================
// CommissariTab — gestione commissari (admin)
//
// Features:
//  - Griglia ATTIVI + sezione ARCHIVIO (INATTIVI)
//  - Create / Edit dialog con foto upload e CV testo
//  - Archivia (passa a INATTIVO) / Riattiva / Elimina
// =============================================================================

import { useState, useRef, useCallback } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { toast } from 'sonner';
import {
  Plus, Pencil, Trash2, Archive, ArchiveRestore, UserCircle2, Mail, Phone, FileText,
} from 'lucide-react';

import { cn } from '@/lib/utils';
import { fileUrl, httpErrorMessage } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
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
// CvPreviewDialog
// ---------------------------------------------------------------------------
function CvPreviewDialog({
  cv,
  open,
  onClose,
}: {
  cv: string;
  open: boolean;
  onClose: () => void;
}) {
  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Curriculum vitae</DialogTitle>
        </DialogHeader>
        <div className="max-h-[60vh] overflow-y-auto whitespace-pre-wrap break-words text-sm font-mono leading-relaxed text-foreground/90 rounded-lg bg-muted/40 p-4">
          {cv || <span className="italic text-muted-foreground">Vuoto</span>}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Chiudi
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// CommissarioFormDialog
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
        const created = await createCommissario.mutateAsync({
          concorsoId,
          ...body,
        });
        savedId = created.id;
        toast.success('Commissario aggiunto');
      }

      // Upload foto if selected
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

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>
              {isEdit ? `Modifica commissario` : 'Nuovo commissario'}
            </DialogTitle>
            {isEdit && existing && (
              <DialogDescription>{displayName(existing)}</DialogDescription>
            )}
          </DialogHeader>

          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4 overflow-y-auto max-h-[70dvh] pr-1">
            {/* Foto + dati principali */}
            <div className="flex items-start gap-4">
              {/* Foto avatar */}
              <div className="shrink-0">
                <div
                  className={cn(
                    'h-20 w-20 rounded-full overflow-hidden bg-muted border-2 border-border flex items-center justify-center',
                    currentFotoUrl && 'border-primary/40',
                  )}
                >
                  {currentFotoUrl ? (
                    <img src={currentFotoUrl} alt="" className="h-full w-full object-cover" />
                  ) : (
                    <UserCircle2 className="h-10 w-10 text-muted-foreground/40" />
                  )}
                </div>
                <div className="mt-2 flex flex-col gap-1">
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="text-xs h-7 px-2"
                    onClick={() => fotoInputRef.current?.click()}
                  >
                    {currentFotoUrl ? 'Cambia' : 'Foto'}
                  </Button>
                  {currentFotoUrl && (
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      className="text-xs h-7 px-2 text-destructive hover:text-destructive"
                      onClick={handleClearFoto}
                    >
                      Rimuovi
                    </Button>
                  )}
                </div>
                <input
                  ref={fotoInputRef}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={handleFotoChange}
                />
              </div>

              {/* Nome + cognome */}
              <div className="flex-1 grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium mb-1">
                    Nome <span className="text-destructive">*</span>
                  </label>
                  <Input {...form.register('nome')} placeholder="Mario" />
                  {form.formState.errors.nome && (
                    <p className="mt-1 text-xs text-destructive">{form.formState.errors.nome.message}</p>
                  )}
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">Cognome</label>
                  <Input {...form.register('cognome')} placeholder="Rossi" />
                </div>
              </div>
            </div>

            {/* Grid campi */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-sm font-medium mb-1">Specialità</label>
                <Input
                  {...form.register('specialita')}
                  placeholder="Es. Pianoforte classico"
                />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">Data di nascita</label>
                <Input
                  type="date"
                  {...form.register('dataNascita')}
                  max={new Date().toISOString().slice(0, 10)}
                />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">Nazionalità</label>
                <Input {...form.register('nazionalita')} placeholder="Es. Italiana" />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">Email</label>
                <Input
                  type="email"
                  {...form.register('email')}
                  placeholder="mario@esempio.it"
                />
                {form.formState.errors.email && (
                  <p className="mt-1 text-xs text-destructive">{form.formState.errors.email.message}</p>
                )}
              </div>
              <div className="sm:col-span-2">
                <label className="block text-sm font-medium mb-1">Telefono</label>
                <Input
                  type="tel"
                  {...form.register('telefono')}
                  placeholder="+39 333 000 0000"
                />
              </div>
            </div>

            {/* Bio */}
            <div>
              <label className="block text-sm font-medium mb-1">Biografia</label>
              <Textarea
                {...form.register('bio')}
                rows={3}
                placeholder="Breve presentazione del commissario…"
              />
            </div>

            {/* CV */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <label className="text-sm font-medium">Curriculum vitae (testo)</label>
                <div className="flex items-center gap-2">
                  {cvValue.trim().length > 0 && (
                    <>
                      <button
                        type="button"
                        className="text-xs text-emerald-700 hover:text-emerald-900 font-medium"
                        onClick={() => setCvPreviewOpen(true)}
                      >
                        Visualizza
                      </button>
                      <span className="text-xs text-muted-foreground">
                        {cvValue.length} car.
                      </span>
                    </>
                  )}
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="text-xs h-7 px-2"
                    onClick={() => setCvEditing((v) => !v)}
                  >
                    {cvEditing
                      ? 'Comprimi'
                      : cvValue.trim().length > 0
                        ? 'Modifica'
                        : 'Aggiungi'}
                  </Button>
                </div>
              </div>
              {cvEditing && (
                <Textarea
                  {...form.register('cv')}
                  rows={8}
                  placeholder="Incolla il testo del CV o scrivi una nota biografica estesa…"
                  className="font-mono text-xs"
                />
              )}
            </div>

            <p className="text-xs text-muted-foreground bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
              Per nominare un commissario <strong>presidente</strong>, vai al tab{' '}
              <em>Commissioni</em> e selezionalo come presidente di una commissione.
            </p>

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                Annulla
              </Button>
              <Button type="submit" disabled={isPending}>
                {isPending
                  ? 'Salvataggio…'
                  : isEdit
                    ? 'Salva modifiche'
                    : 'Aggiungi commissario'}
              </Button>
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
// CommissarioCard
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

  return (
    <>
      <div
        className={cn(
          'rounded-2xl border bg-card p-4 flex items-start gap-3 transition-colors',
          isPresidente
            ? 'border-amber-300 bg-amber-50/40 ring-1 ring-amber-200'
            : 'border-border hover:border-border/80',
        )}
      >
        {/* Avatar */}
        <div
          className={cn(
            'h-14 w-14 rounded-full overflow-hidden shrink-0 flex items-center justify-center bg-gradient-to-br from-amber-100 to-orange-100',
            isPresidente ? 'ring-2 ring-amber-400' : 'ring-2 ring-white',
          )}
        >
          {fotoSrc ? (
            <img src={fotoSrc} alt="" className="h-full w-full object-cover" />
          ) : (
            <UserCircle2 className="h-8 w-8 text-amber-600" />
          )}
        </div>

        {/* Info */}
        <div className="flex-1 min-w-0">
          <div className="flex flex-wrap items-center gap-1.5">
            <h4 className="font-semibold text-foreground truncate">{displayName(c)}</h4>
            {isPresidente && (
              <Badge variant="warning" className="text-[10px] px-1.5 py-0.5">
                Presidente
              </Badge>
            )}
            {c.nazionalita && (
              <Badge variant="muted" className="text-[10px] px-1.5 py-0.5">
                {c.nazionalita}
              </Badge>
            )}
          </div>
          <p className="text-xs text-muted-foreground truncate mt-0.5">
            {c.specialita ?? '—'}
            {age != null && ` · ${age} anni`}
          </p>
          {c.email && (
            <p className="text-[11px] text-muted-foreground truncate mt-0.5 flex items-center gap-1">
              <Mail className="h-3 w-3 shrink-0" />
              {c.email}
            </p>
          )}
          {c.telefono && (
            <p className="text-[11px] text-muted-foreground truncate flex items-center gap-1">
              <Phone className="h-3 w-3 shrink-0" />
              {c.telefono}
            </p>
          )}
          <div className="mt-2 flex flex-wrap gap-1.5">
            {c.cv && (
              <button
                onClick={() => setCvOpen(true)}
                className="inline-flex items-center gap-1 text-[11px] px-2 py-0.5 bg-emerald-50 text-emerald-700 hover:bg-emerald-100 rounded-full font-medium transition-colors"
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

        {/* Actions */}
        <div className="flex flex-col gap-1 shrink-0">
          <Button
            size="sm"
            variant="ghost"
            className="h-7 px-2 text-xs text-primary hover:bg-primary/10"
            onClick={onEdit}
          >
            <Pencil className="h-3 w-3" />
            Modifica
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="h-7 px-2 text-xs text-amber-700 hover:bg-amber-50"
            onClick={onArchive}
            title="Archivia commissario"
          >
            <Archive className="h-3 w-3" />
            Archivia
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="h-7 px-2 text-xs text-destructive hover:bg-destructive/10"
            onClick={onDelete}
          >
            <Trash2 className="h-3 w-3" />
            Elimina
          </Button>
        </div>
      </div>

      {c.cv && (
        <CvPreviewDialog cv={c.cv} open={cvOpen} onClose={() => setCvOpen(false)} />
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// ArchivioCard (INATTIVO)
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
    <div className="rounded-xl border border-border bg-muted/30 p-3 flex items-center gap-3">
      <div className="h-10 w-10 rounded-full overflow-hidden shrink-0 flex items-center justify-center bg-muted">
        {fotoSrc ? (
          <img src={fotoSrc} alt="" className="h-full w-full object-cover" />
        ) : (
          <UserCircle2 className="h-6 w-6 text-muted-foreground" />
        )}
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-muted-foreground truncate">{displayName(c)}</p>
        {c.specialita && (
          <p className="text-xs text-muted-foreground/60 truncate">{c.specialita}</p>
        )}
      </div>
      <div className="flex items-center gap-1 shrink-0">
        <Button
          size="sm"
          variant="ghost"
          className="h-7 px-2 text-xs text-emerald-700 hover:bg-emerald-50"
          onClick={onReactivate}
          title="Riattiva commissario"
        >
          <ArchiveRestore className="h-3 w-3" />
          Riattiva
        </Button>
        <Button
          size="sm"
          variant="ghost"
          className="h-7 px-2 text-xs text-destructive hover:bg-destructive/10"
          onClick={onDelete}
        >
          <Trash2 className="h-3 w-3" />
        </Button>
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
    if (
      !confirm(
        `Eliminare definitivamente "${displayName(c)}"? L'operazione non è reversibile.`,
      )
    )
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
      <div className="space-y-3">
        <Skeleton className="h-24 w-full rounded-2xl" />
        <Skeleton className="h-24 w-full rounded-2xl" />
        <Skeleton className="h-24 w-2/3 rounded-2xl" />
      </div>
    );
  }

  if (isError) {
    return (
      <p className="text-sm text-destructive">Errore nel caricamento dei commissari.</p>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="text-sm font-bold uppercase tracking-wider text-muted-foreground">
            Commissari
          </h3>
          <p className="text-sm text-muted-foreground mt-0.5">
            {attivi.length} attivi · {inattivi.length} in archivio
          </p>
        </div>
        <Button size="sm" onClick={() => setDialog({ open: true })}>
          <Plus className="h-4 w-4" />
          Aggiungi commissario
        </Button>
      </div>

      {/* Active list */}
      {attivi.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-2xl border-2 border-dashed border-border py-14 text-center">
          <UserCircle2 className="mx-auto h-10 w-10 text-muted-foreground/40 mb-3" />
          <p className="text-sm text-muted-foreground italic">
            Nessun commissario attivo — aggiungine uno.
          </p>
          <Button
            size="sm"
            variant="outline"
            className="mt-4"
            onClick={() => setDialog({ open: true })}
          >
            <Plus className="h-4 w-4" />
            Aggiungi il primo commissario
          </Button>
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

      {/* Archivio */}
      {inattivi.length > 0 && (
        <div className="pt-6 border-t-2 border-dashed border-primary/10">
          <h4 className="text-xs font-bold uppercase tracking-wider text-muted-foreground mb-3">
            Archivio ({inattivi.length})
          </h4>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {inattivi.map((c) => (
              <ArchivioCard
                key={c.id}
                commissario={c}
                onReactivate={() => handleReactivate(c)}
                onDelete={() => handleDelete(c)}
              />
            ))}
          </div>
        </div>
      )}

      {/* Form dialog */}
      <CommissarioFormDialog
        open={dialog.open}
        onOpenChange={(v) => setDialog((p) => ({ ...p, open: v }))}
        concorsoId={concorsoId}
        existing={dialog.existing}
      />
    </div>
  );
}
