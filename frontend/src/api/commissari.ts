// =============================================================================
// api/commissari.ts — Commissari CRUD + photo upload
//
// Server routes: server/src/routes/commissari.ts
// The server stores `foto` (plain text path) on the commissari table.
// Drizzle returns camelCase field names: foto, dataNascita, nazionalita, etc.
// =============================================================================

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { http } from '@/lib/api';

// ---------------------------------------------------------------------------
// Local types (server shape — note: field is `foto`, not `fotoUrl`)
// ---------------------------------------------------------------------------
export interface CommissarioRecord {
  id: string;
  concorsoId: string;
  tenantId: string;
  nome: string;
  cognome: string | null;
  specialita: string | null;
  email: string | null;
  telefono: string | null;
  dataNascita: string | null;
  nazionalita: string | null;
  /** Stored path / public URL — the DB column is `foto`, not `fotoUrl`. */
  foto: string | null;
  bio: string | null;
  cv: string | null;
  stato: 'ATTIVO' | 'INATTIVO';
  createdAt: string;
  updatedAt: string;
}

export interface CreateCommissarioBody {
  concorsoId: string;
  nome: string;
  cognome?: string;
  specialita?: string;
  email?: string;
  telefono?: string;
  dataNascita?: string | null;
  nazionalita?: string;
  bio?: string;
  cv?: string;
  stato?: 'ATTIVO' | 'INATTIVO';
}

export type UpdateCommissarioBody = Partial<Omit<CreateCommissarioBody, 'concorsoId'>>;

// ---------------------------------------------------------------------------
// Pure API functions
// ---------------------------------------------------------------------------
export const commissariApi = {
  list: (concorsoId: string) =>
    http.get<CommissarioRecord[]>('commissari', { concorsoId, limit: 500 }),

  get: (id: string) => http.get<CommissarioRecord>(`commissari/${id}`),

  create: (body: CreateCommissarioBody) =>
    http.post<CommissarioRecord>('commissari', body),

  update: (id: string, body: UpdateCommissarioBody) =>
    http.patch<CommissarioRecord>(`commissari/${id}`, body),

  delete: (id: string) => http.del<undefined>(`commissari/${id}`),

  /** Upload/replace photo. Uses /api/upload/commissario/:id */
  uploadFoto: (id: string, file: Blob) =>
    http.upload<CommissarioRecord>('commissario', id, file, 'file'),

  /** DELETE /api/upload/commissario/:id — remove photo */
  deleteFoto: (id: string) => http.del<undefined>(`/api/upload/commissario/${id}`),
};

// ---------------------------------------------------------------------------
// React Query hooks
// ---------------------------------------------------------------------------
export const commissariKeys = {
  all: (concorsoId: string) => ['commissari', concorsoId] as const,
  detail: (id: string) => ['commissari', 'detail', id] as const,
};

export function useCommissari(concorsoId: string) {
  return useQuery({
    queryKey: commissariKeys.all(concorsoId),
    queryFn: () => commissariApi.list(concorsoId),
    enabled: !!concorsoId,
  });
}

export function useCreateCommissario(concorsoId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateCommissarioBody) => commissariApi.create(body),
    onSuccess: () => qc.invalidateQueries({ queryKey: commissariKeys.all(concorsoId) }),
  });
}

export function useUpdateCommissario(concorsoId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: UpdateCommissarioBody }) =>
      commissariApi.update(id, body),
    onSuccess: () => qc.invalidateQueries({ queryKey: commissariKeys.all(concorsoId) }),
  });
}

export function useDeleteCommissario(concorsoId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => commissariApi.delete(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: commissariKeys.all(concorsoId) }),
  });
}

export function useUploadCommissarioFoto(concorsoId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, file }: { id: string; file: Blob }) =>
      commissariApi.uploadFoto(id, file),
    onSuccess: () => qc.invalidateQueries({ queryKey: commissariKeys.all(concorsoId) }),
  });
}
