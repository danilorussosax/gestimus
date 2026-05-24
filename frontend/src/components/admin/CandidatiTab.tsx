// =============================================================================
// CandidatiTab — gestione candidati di un concorso (admin)
//
// Features:
//  - Griglia candidati con filtri stato/sezione/ricerca testo
//  - Create/Edit dialog completo (anagrafica, contatti, artistici, sezione/categoria, foto)
//  - Delete con confirm
//  - Photo upload via http.upload
// =============================================================================

import { useState, useRef, useCallback, useMemo } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { toast } from 'sonner';
import {
  Plus, Pencil, Trash2, Search, UserCircle2, Music, Users,
  X, RefreshCw,
} from 'lucide-react';

import { cn } from '@/lib/utils';
import { fileUrl, httpErrorMessage } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Avatar, AvatarImage, AvatarFallback } from '@/components/ui/avatar';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from '@/components/ui/dialog';
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from '@/components/ui/select';
import { Label } from '@/components/ui/label';

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

function initials(c: Pick<CandidatoFull, 'nome' | 'cognome'>): string {
  return [(c.nome ?? '')[0], (c.cognome ?? '')[0]].filter(Boolean).join('').toUpperCase() || '?';
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
          className="space-y-6 overflow-y-auto flex-1 pr-1"
        >
          {/* ---- Foto + nome/tipo ---- */}
          <div className="flex items-start gap-4">
            {/* Foto avatar */}
            <div className="shrink-0 flex flex-col items-center gap-2">
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
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="text-xs h-7 px-2 w-full"
                onClick={() => fotoInputRef.current?.click()}
              >
                {currentFotoUrl ? 'Cambia foto' : 'Aggiungi foto'}
              </Button>
              {(fotoFile || fotoPreview) && (
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  className="text-xs h-7 px-2 text-destructive hover:text-destructive w-full"
                  onClick={() => { setFotoFile(null); setFotoPreview(null); }}
                >
                  Rimuovi
                </Button>
              )}
              <input
                ref={fotoInputRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={handleFotoChange}
              />
            </div>

            {/* Nome + cognome + tipo */}
            <div className="flex-1 grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <Label className="mb-1 block">Nome <span className="text-destructive">*</span></Label>
                <Input {...form.register('nome')} placeholder="Mario" />
                {form.formState.errors.nome && (
                  <p className="mt-1 text-xs text-destructive">{form.formState.errors.nome.message}</p>
                )}
              </div>
              <div>
                <Label className="mb-1 block">Cognome {!isGroupLike && <span className="text-destructive">*</span>}</Label>
                <Input {...form.register('cognome')} placeholder="Rossi" />
              </div>
              <div>
                <Label className="mb-1 block">Strumento <span className="text-destructive">*</span></Label>
                <Input {...form.register('strumento')} placeholder="es. Pianoforte" />
                {form.formState.errors.strumento && (
                  <p className="mt-1 text-xs text-destructive">{form.formState.errors.strumento.message}</p>
                )}
              </div>
              <div>
                <Label className="mb-1 block">Tipo</Label>
                <Select
                  value={tipo}
                  onValueChange={(v) => {
                    form.setValue('tipo', v as 'individuale' | 'gruppo' | 'orchestra');
                    if (v === 'individuale') form.setValue('gruppoNome', '');
                  }}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="individuale">Individuale</SelectItem>
                    <SelectItem value="gruppo">Gruppo / Ensemble</SelectItem>
                    <SelectItem value="orchestra">Orchestra</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          </div>

          {/* ---- Gruppo nome (condizionale) ---- */}
          {isGroupLike && (
            <div className="border border-purple-200 bg-purple-50/40 rounded-xl p-4 space-y-3">
              <div className="flex items-center gap-2">
                <Users className="h-4 w-4 text-purple-600" />
                <span className="text-sm font-semibold text-purple-800">
                  {tipo === 'orchestra' ? "Orchestra" : "Gruppo / Ensemble"}
                </span>
              </div>
              <div>
                <Label className="mb-1 block">
                  {tipo === 'orchestra' ? "Nome dell'orchestra" : "Nome del gruppo / ensemble"}
                </Label>
                <Input
                  {...form.register('gruppoNome')}
                  placeholder={tipo === 'orchestra' ? 'es. Orchestra Giovanile di Milano' : 'es. Quartetto Brillante'}
                />
              </div>
            </div>
          )}

          {/* ---- Anagrafica ---- */}
          <fieldset className="space-y-3">
            <legend className="text-xs font-bold uppercase tracking-wider text-muted-foreground mb-2 border-b border-border pb-1 w-full">
              Anagrafica
            </legend>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {!isGroupLike && (
                <>
                  <div>
                    <Label className="mb-1 block">Data di nascita {!isGroupLike && <span className="text-destructive">*</span>}</Label>
                    <Input
                      type="date"
                      {...form.register('dataNascita')}
                      max={new Date().toISOString().slice(0, 10)}
                    />
                  </div>
                  <div>
                    <Label className="mb-1 block">Nazionalità</Label>
                    <Input {...form.register('nazionalita')} placeholder="es. Italiana" />
                  </div>
                  <div>
                    <Label className="mb-1 block">Sesso</Label>
                    <Select
                      value={form.watch('sesso') ?? ''}
                      onValueChange={(v) => form.setValue('sesso', v)}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="— Seleziona —" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="">— Non specificato —</SelectItem>
                        <SelectItem value="M">Maschio</SelectItem>
                        <SelectItem value="F">Femmina</SelectItem>
                        <SelectItem value="altro">Altro / preferisco non specificare</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label className="mb-1 block">Luogo di nascita</Label>
                    <Input {...form.register('luogoNascita')} placeholder="Città (Provincia)" />
                  </div>
                  <div className="sm:col-span-2">
                    <Label className="mb-1 block">Codice fiscale</Label>
                    <Input
                      {...form.register('codiceFiscale')}
                      maxLength={16}
                      className="font-mono uppercase"
                      placeholder="RSSMRA80A01H501U"
                      onChange={(e) => {
                        e.target.value = e.target.value.toUpperCase();
                        form.setValue('codiceFiscale', e.target.value);
                      }}
                    />
                  </div>
                </>
              )}
            </div>
          </fieldset>

          {/* ---- Contatti ---- */}
          <fieldset className="space-y-3">
            <legend className="text-xs font-bold uppercase tracking-wider text-muted-foreground mb-2 border-b border-border pb-1 w-full">
              Contatti
            </legend>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <Label className="mb-1 block">Email</Label>
                <Input type="email" {...form.register('email')} placeholder="nome@esempio.it" />
                {form.formState.errors.email && (
                  <p className="mt-1 text-xs text-destructive">{form.formState.errors.email.message}</p>
                )}
              </div>
              <div>
                <Label className="mb-1 block">Telefono</Label>
                <Input type="tel" {...form.register('telefono')} placeholder="+39 333 000 0000" />
              </div>
              <div className="sm:col-span-2">
                <Label className="mb-1 block">Indirizzo</Label>
                <Input {...form.register('indirizzo')} placeholder="Via, civico" />
              </div>
              <div>
                <Label className="mb-1 block">Città</Label>
                <Input {...form.register('citta')} />
              </div>
              <div>
                <Label className="mb-1 block">CAP</Label>
                <Input {...form.register('cap')} maxLength={10} />
              </div>
              <div>
                <Label className="mb-1 block">Provincia</Label>
                <Input {...form.register('provincia')} maxLength={3} placeholder="MI" />
              </div>
              <div>
                <Label className="mb-1 block">Paese</Label>
                <Input {...form.register('paese')} />
              </div>
            </div>
          </fieldset>

          {/* ---- Studi musicali ---- */}
          <fieldset className="space-y-3">
            <legend className="text-xs font-bold uppercase tracking-wider text-muted-foreground mb-2 border-b border-border pb-1 w-full">
              Studi musicali
            </legend>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <Label className="mb-1 block">Anni di studio</Label>
                <Input
                  type="number"
                  min={0}
                  max={80}
                  {...form.register('anniStudio')}
                />
              </div>
              <div className="sm:col-span-2">
                <Label className="mb-1 block">Scuola / Conservatorio di provenienza</Label>
                <Input {...form.register('scuolaProvenienza')} />
              </div>
            </div>
          </fieldset>

          {/* ---- Docenti preparatori ---- */}
          <div>
            <Label className="mb-1 block">
              Docenti preparatori{' '}
              <span className="text-xs text-muted-foreground">(uno per riga)</span>
            </Label>
            <Textarea
              {...form.register('docentiPreparatori')}
              rows={3}
              placeholder="Prof. Mario Rossi&#10;Prof.ssa Anna Bianchi"
            />
          </div>

          {/* ---- Sezione / Categoria ---- */}
          {sezioni.length > 0 && (
            <fieldset className="space-y-3">
              <legend className="text-xs font-bold uppercase tracking-wider text-muted-foreground mb-2 border-b border-border pb-1 w-full">
                Sezione e categoria
              </legend>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <Label className="mb-1 block">Sezione</Label>
                  <Select
                    value={sezioneId ?? ''}
                    onValueChange={(v) => {
                      form.setValue('sezioneId', v);
                      form.setValue('categoriaId', '');
                    }}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="— Nessuna sezione —" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="">— Nessuna sezione —</SelectItem>
                      {sezioni.map((s) => (
                        <SelectItem key={s.id} value={s.id}>
                          {s.nome}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                {filteredCategorie.length > 0 && (
                  <div>
                    <Label className="mb-1 block">Categoria</Label>
                    <Select
                      value={form.watch('categoriaId') ?? ''}
                      onValueChange={(v) => form.setValue('categoriaId', v)}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="— Nessuna categoria —" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="">— Nessuna categoria —</SelectItem>
                        {filteredCategorie.map((c) => (
                          <SelectItem key={c.id} value={c.id}>
                            {c.nome}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                )}
              </div>
            </fieldset>
          )}

          {/* ---- Note libere ---- */}
          <div>
            <Label className="mb-1 block">
              Note libere{' '}
              <span className="text-xs text-muted-foreground">(opzionale)</span>
            </Label>
            <Textarea
              {...form.register('noteLibere')}
              rows={2}
              placeholder="Qualsiasi informazione utile all'organizzazione"
            />
          </div>

          <DialogFooter className="pt-2">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Annulla
            </Button>
            <Button type="submit" disabled={isPending}>
              {isPending
                ? 'Salvataggio…'
                : isEdit
                  ? 'Salva modifiche'
                  : 'Aggiungi candidato'}
            </Button>
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
          <Button variant="outline" onClick={onCancel}>
            Annulla
          </Button>
          <Button variant="destructive" onClick={onConfirm} disabled={isPending}>
            {isPending ? 'Eliminazione…' : 'Elimina'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// CandidatoCard
// ---------------------------------------------------------------------------

interface CandidatoCardProps {
  candidato: CandidatoFull;
  sezione?: Sezione;
  categoria?: Categoria;
  onEdit: () => void;
  onDelete: () => void;
}

function CandidatoCard({ candidato: c, sezione, categoria, onEdit, onDelete }: CandidatoCardProps) {
  const isGroupLike = c.tipo === 'gruppo' || c.tipo === 'orchestra';
  const age = ageFromDate(c.dataNascita);
  const fotoSrc = c.fotoUrl ? fileUrl(c.fotoUrl) : null;
  const docenti = (c.docentiPreparatori ?? []);

  return (
    <div
      className={cn(
        'rounded-2xl border bg-card p-4 flex items-start gap-3 transition-colors',
        isGroupLike
          ? 'border-purple-200 bg-purple-50/30 hover:border-purple-300'
          : 'border-border hover:border-border/80',
      )}
    >
      {/* Avatar */}
      <Avatar
        className={cn(
          'h-14 w-14 shrink-0 ring-2 ring-white shadow-sm',
          isGroupLike ? 'bg-purple-100' : 'bg-muted',
        )}
      >
        {fotoSrc && <AvatarImage src={fotoSrc} alt={displayName(c)} className="object-cover" />}
        <AvatarFallback className={cn(isGroupLike ? 'bg-purple-100 text-purple-700' : 'bg-muted')}>
          {isGroupLike ? (
            c.tipo === 'orchestra' ? <Music className="h-6 w-6" /> : <Users className="h-6 w-6" />
          ) : (
            <span className="text-sm font-semibold">{initials(c)}</span>
          )}
        </AvatarFallback>
      </Avatar>

      {/* Info */}
      <div className="flex-1 min-w-0">
        <div className="flex flex-wrap items-center gap-1.5 mb-0.5">
          {c.numeroCandidato != null && (
            <span className="font-mono text-[11px] text-muted-foreground">
              #{String(c.numeroCandidato).padStart(3, '0')}
            </span>
          )}
          {isGroupLike && (
            <Badge
              variant="outline"
              className="text-[10px] px-1.5 py-0.5 bg-purple-100 text-purple-700 border-purple-200 font-bold uppercase tracking-wider"
            >
              {c.tipo === 'orchestra' ? 'Orchestra' : 'Gruppo'}
            </Badge>
          )}
          {!isGroupLike && c.nazionalita && (
            <Badge variant="muted" className="text-[10px] px-1.5 py-0.5">
              {c.nazionalita}
            </Badge>
          )}
        </div>

        <h4 className="font-semibold text-foreground truncate">{displayName(c)}</h4>

        {c.gruppoNome && (
          <p className="text-[11px] text-purple-700 truncate">{c.gruppoNome}</p>
        )}

        <p className="text-xs text-muted-foreground truncate mt-0.5">
          {c.strumento ?? '—'}
          {!isGroupLike && age != null && ` · ${age} anni`}
        </p>

        {/* Sezione / categoria badges */}
        {(sezione || categoria) && (
          <div className="mt-1.5 flex flex-wrap gap-1">
            {sezione && (
              <span className="text-[10px] px-1.5 py-0.5 bg-primary/10 text-primary rounded-full font-medium">
                {sezione.nome}
              </span>
            )}
            {categoria && (
              <span className="text-[10px] px-1.5 py-0.5 bg-cyan-50 text-cyan-700 rounded-full font-medium">
                {categoria.nome}
              </span>
            )}
          </div>
        )}

        {/* Docenti */}
        {docenti.length > 0 && (
          <div className="mt-1.5">
            <span
              className="text-[10px] px-1.5 py-0.5 bg-violet-50 text-violet-700 rounded-full font-medium"
              title={docenti.join(' · ')}
            >
              {docenti.length === 1
                ? `1 docente`
                : `${docenti.length} docenti`}
            </span>
          </div>
        )}
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
          className="h-7 px-2 text-xs text-destructive hover:bg-destructive/10"
          onClick={onDelete}
        >
          <Trash2 className="h-3 w-3" />
          Elimina
        </Button>
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
  // Skeleton
  // ---------------------------------------------------------------------------
  if (isLoading) {
    return (
      <div className="space-y-3">
        {[1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-24 w-full rounded-2xl" />
        ))}
      </div>
    );
  }

  if (isError) {
    return (
      <p className="text-sm text-destructive">Errore nel caricamento dei candidati.</p>
    );
  }

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">
          {candidati.length} candidat{candidati.length === 1 ? 'o' : 'i'}
          {filtered.length !== candidati.length && ` · ${filtered.length} mostrati`}
        </p>
        <Button size="sm" onClick={() => setDialog({ open: true })}>
          <Plus className="h-4 w-4" />
          Aggiungi candidato
        </Button>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-2">
        {/* Text search */}
        <div className="relative flex-1 min-w-48">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Cerca per nome, strumento, email…"
            className="pl-8 h-9"
          />
          {search && (
            <button
              type="button"
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              onClick={() => setSearch('')}
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>

        {/* Sezione filter */}
        {sezioni.length > 0 && (
          <Select
            value={filterSezioneId}
            onValueChange={setFilterSezioneId}
          >
            <SelectTrigger className="h-9 w-44">
              <SelectValue placeholder="Tutte le sezioni" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="">Tutte le sezioni</SelectItem>
              {sezioni.map((s) => (
                <SelectItem key={s.id} value={s.id}>{s.nome}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}

        {/* Tipo filter */}
        <Select value={filterTipo} onValueChange={setFilterTipo}>
          <SelectTrigger className="h-9 w-40">
            <SelectValue placeholder="Tutti i tipi" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="">Tutti i tipi</SelectItem>
            <SelectItem value="individuale">Individuale</SelectItem>
            <SelectItem value="gruppo">Gruppo</SelectItem>
            <SelectItem value="orchestra">Orchestra</SelectItem>
          </SelectContent>
        </Select>

        {/* Clear filters */}
        {(search || filterSezioneId || filterTipo) && (
          <Button
            size="sm"
            variant="ghost"
            className="h-9 text-xs text-muted-foreground"
            onClick={() => { setSearch(''); setFilterSezioneId(''); setFilterTipo(''); }}
          >
            <RefreshCw className="h-3.5 w-3.5 mr-1" />
            Reset filtri
          </Button>
        )}
      </div>

      {/* Empty state */}
      {candidati.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-2xl border-2 border-dashed border-border py-14 text-center">
          <UserCircle2 className="mx-auto h-10 w-10 text-muted-foreground/40 mb-3" />
          <p className="text-sm text-muted-foreground italic">
            Nessun candidato — aggiungine uno.
          </p>
          <Button
            size="sm"
            variant="outline"
            className="mt-4"
            onClick={() => setDialog({ open: true })}
          >
            <Plus className="h-4 w-4" />
            Aggiungi il primo candidato
          </Button>
        </div>
      ) : filtered.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-2xl border-2 border-dashed border-border py-10 text-center">
          <Search className="mx-auto h-8 w-8 text-muted-foreground/40 mb-2" />
          <p className="text-sm text-muted-foreground italic">
            Nessun candidato corrisponde ai filtri selezionati.
          </p>
        </div>
      ) : (
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

      {/* Form dialog */}
      <CandidatoFormDialog
        open={dialog.open}
        onOpenChange={(v) => setDialog((p) => ({ ...p, open: v }))}
        concorsoId={concorsoId}
        sezioni={sezioni}
        categorie={categorie}
        existing={dialog.existing}
        onSaved={() => setDialog({ open: false })}
      />

      {/* Delete confirm */}
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
