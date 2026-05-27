// =============================================================================
// DocumentiTab — Documenti dell'ente (regolamenti/moduli/template) (admin)
//
// Livello ENTE (tenant), non per-concorso. Lista + upload + modifica metadati +
// elimina. I documenti `pubblicato` sono scaricabili pubblicamente (link
// pubblico /api/public/documenti). Stile coerente con gli altri Tab admin.
// =============================================================================

import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { toast } from 'sonner';
import { useTranslation } from 'react-i18next';
import { FileText, Download, Trash2, Pencil, Upload, Eye, EyeOff } from 'lucide-react';

import { HttpError, httpErrorMessage, fileUrl } from '@/lib/api';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import {
  useDocumenti,
  useUploadDocumento,
  useUpdateDocumento,
  useDeleteDocumento,
  type DocumentoRecord,
} from '@/api/documenti';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function resolveError(e: unknown): string {
  if (e instanceof HttpError && (e.status === 409 || e.status === 415 || e.status === 413) && e.payload.error) {
    return e.payload.error;
  }
  return httpErrorMessage(e);
}

/** Formatta i byte in KB/MB leggibili. */
function formatBytes(bytes: number | null): string {
  if (bytes == null) return '—';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// ---------------------------------------------------------------------------
// UploadDialog — upload di un nuovo documento (file + metadati)
// ---------------------------------------------------------------------------
const uploadSchema = z.object({
  titolo: z.string().min(1, 'Titolo obbligatorio').max(255),
  descrizione: z.string().max(2000).optional(),
  pubblicato: z.boolean(),
});
type UploadFormValues = z.infer<typeof uploadSchema>;

interface UploadDialogProps {
  open: boolean;
  onOpenChange: (v: boolean) => void;
}

function UploadDialog({ open, onOpenChange }: UploadDialogProps) {
  const { t } = useTranslation();
  const uploadDoc = useUploadDocumento();
  const [file, setFile] = useState<File | null>(null);
  // Counter usato come `key` dell'input file: incrementandolo l'input viene
  // rimontato → si svuota senza dover toccare la ref durante il render.
  const [fileInputKey, setFileInputKey] = useState(0);

  const form = useForm<UploadFormValues>({
    resolver: zodResolver(uploadSchema),
    values: { titolo: '', descrizione: '', pubblicato: true },
  });

  const reset = () => {
    form.reset({ titolo: '', descrizione: '', pubblicato: true });
    setFile(null);
    setFileInputKey((k) => k + 1);
  };

  const onSubmit = async (values: UploadFormValues) => {
    if (!file) {
      toast.error(t('admin.documenti.upload.no_file'));
      return;
    }
    try {
      await uploadDoc.mutateAsync({
        file,
        titolo: values.titolo.trim(),
        descrizione: (values.descrizione ?? '').trim() || undefined,
        pubblicato: values.pubblicato,
      });
      toast.success(t('admin.documenti.toast.uploaded'));
      reset();
      onOpenChange(false);
    } catch (e) {
      toast.error(resolveError(e));
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        if (!v) reset();
        onOpenChange(v);
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('admin.documenti.upload.title')}</DialogTitle>
        </DialogHeader>
        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-3">
          {/* File */}
          <label className="block">
            <span className="c-field__label">
              {t('admin.documenti.field.file')} <span className="text-rose-500">*</span>
            </span>
            <input
              key={fileInputKey}
              type="file"
              className="c-input mt-1"
              accept=".pdf,.doc,.docx,image/*"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            />
          </label>
          {/* Titolo */}
          <label className="block">
            <span className="c-field__label">
              {t('admin.documenti.field.titolo')} <span className="text-rose-500">*</span>
            </span>
            <input
              {...form.register('titolo')}
              className="c-input mt-1"
              placeholder={t('admin.documenti.field.titolo_ph')}
            />
            {form.formState.errors.titolo && (
              <p className="mt-1 text-xs text-rose-600">{form.formState.errors.titolo.message}</p>
            )}
          </label>
          {/* Descrizione */}
          <label className="block">
            <span className="c-field__label">{t('admin.documenti.field.descrizione')}</span>
            <textarea
              {...form.register('descrizione')}
              rows={2}
              className="c-textarea mt-1"
              placeholder={t('admin.documenti.field.descrizione_ph')}
            />
          </label>
          {/* Pubblicato */}
          <label className="flex items-center gap-2 text-sm text-slate-700">
            <input type="checkbox" {...form.register('pubblicato')} />
            <span>{t('admin.documenti.field.pubblicato')}</span>
          </label>
          <DialogFooter>
            <button type="button" className="c-btn c-btn--outline" onClick={() => onOpenChange(false)}>
              {t('common.cancel')}
            </button>
            <button type="submit" className="c-btn c-btn--primary" disabled={uploadDoc.isPending}>
              {uploadDoc.isPending ? t('admin.documenti.upload.uploading') : t('admin.documenti.upload.submit')}
            </button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// EditDialog — modifica metadati (titolo/descrizione/pubblicato)
// ---------------------------------------------------------------------------
interface EditDialogProps {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  doc: DocumentoRecord;
}

function EditDialog({ open, onOpenChange, doc }: EditDialogProps) {
  const { t } = useTranslation();
  const updateDoc = useUpdateDocumento();

  const form = useForm<UploadFormValues>({
    resolver: zodResolver(uploadSchema),
    values: {
      titolo: doc.titolo,
      descrizione: doc.descrizione ?? '',
      pubblicato: doc.pubblicato,
    },
  });

  const onSubmit = async (values: UploadFormValues) => {
    try {
      await updateDoc.mutateAsync({
        id: doc.id,
        body: {
          titolo: values.titolo.trim(),
          descrizione: (values.descrizione ?? '').trim() || null,
          pubblicato: values.pubblicato,
        },
      });
      toast.success(t('admin.documenti.toast.updated'));
      onOpenChange(false);
    } catch (e) {
      toast.error(resolveError(e));
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('admin.documenti.edit.title')}</DialogTitle>
        </DialogHeader>
        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-3">
          <label className="block">
            <span className="c-field__label">
              {t('admin.documenti.field.titolo')} <span className="text-rose-500">*</span>
            </span>
            <input {...form.register('titolo')} className="c-input mt-1" />
            {form.formState.errors.titolo && (
              <p className="mt-1 text-xs text-rose-600">{form.formState.errors.titolo.message}</p>
            )}
          </label>
          <label className="block">
            <span className="c-field__label">{t('admin.documenti.field.descrizione')}</span>
            <textarea {...form.register('descrizione')} rows={2} className="c-textarea mt-1" />
          </label>
          <label className="flex items-center gap-2 text-sm text-slate-700">
            <input type="checkbox" {...form.register('pubblicato')} />
            <span>{t('admin.documenti.field.pubblicato')}</span>
          </label>
          <DialogFooter>
            <button type="button" className="c-btn c-btn--outline" onClick={() => onOpenChange(false)}>
              {t('common.cancel')}
            </button>
            <button type="submit" className="c-btn c-btn--primary" disabled={updateDoc.isPending}>
              {updateDoc.isPending ? t('admin.documenti.edit.saving') : t('common.save')}
            </button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// ConfirmDeleteDialog
// ---------------------------------------------------------------------------
interface ConfirmDeleteProps {
  open: boolean;
  doc: DocumentoRecord;
  onClose: () => void;
}

function ConfirmDeleteDialog({ open, doc, onClose }: ConfirmDeleteProps) {
  const { t } = useTranslation();
  const deleteDoc = useDeleteDocumento();

  const handleConfirm = async () => {
    onClose();
    try {
      await deleteDoc.mutateAsync(doc.id);
      toast.success(t('admin.documenti.toast.deleted'));
    } catch (e) {
      toast.error(resolveError(e));
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('admin.documenti.delete.title', { titolo: doc.titolo })}</DialogTitle>
        </DialogHeader>
        <p className="text-sm text-slate-600">{t('admin.documenti.delete.message')}</p>
        <DialogFooter>
          <button type="button" className="c-btn c-btn--outline" onClick={onClose}>
            {t('common.cancel')}
          </button>
          <button type="button" className="c-btn c-btn--danger" onClick={handleConfirm}>
            {t('common.delete')}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// DocumentiTab (exported)
// ---------------------------------------------------------------------------
export default function DocumentiTab() {
  const { t } = useTranslation();
  const { data: documenti, isLoading, isError } = useDocumenti();

  const [uploadOpen, setUploadOpen] = useState(false);
  const [editDoc, setEditDoc] = useState<DocumentoRecord | null>(null);
  const [delDoc, setDelDoc] = useState<DocumentoRecord | null>(null);

  if (isLoading) {
    return (
      <div className="space-y-3">
        <div className="bg-white border border-slate-200 rounded-2xl p-4 animate-pulse h-20" />
        <div className="bg-white border border-slate-200 rounded-2xl p-4 animate-pulse h-20" />
      </div>
    );
  }

  if (isError) {
    return <p className="text-sm text-rose-600">{t('admin.documenti.load_error')}</p>;
  }

  const list = documenti ?? [];

  return (
    <div>
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
        <h3 className="text-sm font-bold text-slate-800 uppercase tracking-wider">
          {t('admin.documenti.title')}
        </h3>
        <button
          onClick={() => setUploadOpen(true)}
          className="text-sm font-semibold text-white bg-brand-600 hover:bg-brand-700 px-3.5 py-2 rounded-lg shadow-sm inline-flex items-center gap-1.5"
        >
          <Upload size={16} />
          <span>{t('admin.documenti.upload.button')}</span>
        </button>
      </div>
      <p className="text-sm text-slate-600 mb-4">{t('admin.documenti.subtitle')}</p>

      {/* Empty state */}
      {list.length === 0 ? (
        <div className="bg-white border-2 border-dashed border-slate-200 rounded-2xl py-12 text-center">
          <div className="text-4xl mb-2">📄</div>
          <p className="text-sm text-slate-500 italic">{t('admin.documenti.empty')}</p>
        </div>
      ) : (
        <ul className="space-y-3">
          {list.map((doc) => (
            <li
              key={doc.id}
              className="bg-white border border-slate-200 rounded-2xl p-4 flex items-start justify-between gap-3"
            >
              <div className="flex items-start gap-3 min-w-0">
                <div className="w-10 h-10 rounded-xl bg-brand-50 text-brand-700 flex items-center justify-center shrink-0">
                  <FileText size={20} />
                </div>
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <h4 className="font-bold text-slate-900 truncate">{doc.titolo}</h4>
                    {doc.pubblicato ? (
                      <span className="c-tag c-tag--green c-tag--no-dot inline-flex items-center gap-1">
                        <Eye size={11} />
                        {t('admin.documenti.tag.published')}
                      </span>
                    ) : (
                      <span className="c-tag c-tag--gray c-tag--no-dot inline-flex items-center gap-1">
                        <EyeOff size={11} />
                        {t('admin.documenti.tag.draft')}
                      </span>
                    )}
                  </div>
                  {doc.descrizione && (
                    <p className="text-xs text-slate-500 mt-0.5">{doc.descrizione}</p>
                  )}
                  <p className="text-[11px] text-slate-500 mt-1">
                    {doc.nomeFile} · {formatBytes(doc.sizeBytes)}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                {/* Download (apre il file servito staticamente) */}
                <a
                  href={fileUrl(doc.publicUrl)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="w-9 h-9 inline-flex items-center justify-center rounded-lg text-slate-700 bg-slate-50 hover:bg-slate-100 border border-slate-200 transition-colors"
                  title={t('admin.documenti.action.download')}
                >
                  <Download size={18} />
                </a>
                <button
                  onClick={() => setEditDoc(doc)}
                  className="w-9 h-9 inline-flex items-center justify-center rounded-lg text-brand-700 bg-brand-50 hover:bg-brand-100 border border-brand-100 transition-colors"
                  title={t('admin.documenti.action.edit')}
                >
                  <Pencil size={18} />
                </button>
                <button
                  onClick={() => setDelDoc(doc)}
                  className="w-9 h-9 inline-flex items-center justify-center rounded-lg text-rose-600 bg-rose-50 hover:bg-rose-100 border border-rose-100 transition-colors"
                  title={t('admin.documenti.action.delete')}
                >
                  <Trash2 size={18} />
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      <UploadDialog open={uploadOpen} onOpenChange={setUploadOpen} />
      {editDoc && (
        <EditDialog open={!!editDoc} onOpenChange={(v) => { if (!v) setEditDoc(null); }} doc={editDoc} />
      )}
      {delDoc && (
        <ConfirmDeleteDialog open={!!delDoc} doc={delDoc} onClose={() => setDelDoc(null)} />
      )}
    </div>
  );
}
