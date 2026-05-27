// =============================================================================
// api/documenti.ts — Documenti dell'ente (regolamenti/moduli/template)
//
// Server routes: server/src/routes/documenti.ts
//   GET    /api/documenti             → DocumentoRecord[] (admin, tutti)
//   POST   /api/documenti             → upload multipart (admin)
//   PATCH  /api/documenti/:id         → update metadati (admin)
//   DELETE /api/documenti/:id         → elimina (admin)
//   GET    /api/public/documenti      → DocumentoRecord[] (pubblici, no-auth)
// =============================================================================

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api, http } from '@/lib/api';

export interface DocumentoRecord {
  id: string;
  titolo: string;
  descrizione: string | null;
  nomeFile: string;
  publicUrl: string;
  mimeType: string | null;
  sizeBytes: number | null;
  versione: number;
  pubblicato: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface UploadDocumentoInput {
  file: Blob;
  titolo: string;
  descrizione?: string;
  pubblicato?: boolean;
}

export interface UpdateDocumentoBody {
  titolo?: string;
  descrizione?: string | null;
  pubblicato?: boolean;
}

// ---------------------------------------------------------------------------
// Pure API
// ---------------------------------------------------------------------------
export const documentiApi = {
  list: () => http.get<DocumentoRecord[]>('/api/documenti'),

  // Upload multipart: il file nel body (field "file"), i metadati in query string
  // (il server li valida prima di consumare lo stream → ordine-indipendente).
  upload: ({ file, titolo, descrizione, pubblicato }: UploadDocumentoInput) => {
    const fd = new FormData();
    fd.append('file', file);
    return api<DocumentoRecord>('/api/documenti', {
      method: 'POST',
      body: fd,
      query: {
        titolo,
        descrizione: descrizione ?? undefined,
        pubblicato: String(pubblicato ?? true),
      },
    });
  },

  update: (id: string, body: UpdateDocumentoBody) =>
    http.patch<DocumentoRecord>(`/api/documenti/${id}`, body),

  delete: (id: string) => http.del<undefined>(`/api/documenti/${id}`),
};

// ---------------------------------------------------------------------------
// React Query hooks
// ---------------------------------------------------------------------------
export const documentiKeys = {
  all: ['documenti'] as const,
};

export function useDocumenti() {
  return useQuery({
    queryKey: documentiKeys.all,
    queryFn: () => documentiApi.list(),
  });
}

export function useUploadDocumento() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: UploadDocumentoInput) => documentiApi.upload(input),
    onSuccess: () => qc.invalidateQueries({ queryKey: documentiKeys.all }),
  });
}

export function useUpdateDocumento() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: UpdateDocumentoBody }) =>
      documentiApi.update(id, body),
    onSuccess: () => qc.invalidateQueries({ queryKey: documentiKeys.all }),
  });
}

export function useDeleteDocumento() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => documentiApi.delete(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: documentiKeys.all }),
  });
}
