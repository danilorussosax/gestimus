// =============================================================================
// api/sezioni.ts — Sezioni CRUD
//
// Server routes: server/src/routes/sezioni.ts
// GET /api/sezioni?concorsoId=... → SezioneRecord[]
// =============================================================================

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { http } from '@/lib/api';

export interface SezioneRecord {
  id: string;
  concorsoId: string;
  tenantId: string;
  nome: string;
  descrizione: string | null;
  ordine: number | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreateSezioneBody {
  concorsoId: string;
  nome: string;
  descrizione?: string;
  ordine?: number;
}

export type UpdateSezioneBody = Partial<Omit<CreateSezioneBody, 'concorsoId'>>;

// ---------------------------------------------------------------------------
// Pure API
// ---------------------------------------------------------------------------
export const sezioniApi = {
  list: (concorsoId: string) =>
    http.get<SezioneRecord[]>('sezioni', { concorsoId, limit: 500 }),

  get: (id: string) => http.get<SezioneRecord>(`sezioni/${id}`),

  create: (body: CreateSezioneBody) => http.post<SezioneRecord>('sezioni', body),

  update: (id: string, body: UpdateSezioneBody) =>
    http.patch<SezioneRecord>(`sezioni/${id}`, body),

  delete: (id: string) => http.del<void>(`sezioni/${id}`),
};

// ---------------------------------------------------------------------------
// React Query hooks
// ---------------------------------------------------------------------------
export const sezioniKeys = {
  all: (concorsoId: string) => ['sezioni', concorsoId] as const,
  detail: (id: string) => ['sezioni', 'detail', id] as const,
};

export function useSezioni(concorsoId: string) {
  return useQuery({
    queryKey: sezioniKeys.all(concorsoId),
    queryFn: () => sezioniApi.list(concorsoId),
    enabled: !!concorsoId,
  });
}

export function useCreateSezione(concorsoId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateSezioneBody) => sezioniApi.create(body),
    onSuccess: () => qc.invalidateQueries({ queryKey: sezioniKeys.all(concorsoId) }),
  });
}

export function useUpdateSezione(concorsoId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: UpdateSezioneBody }) =>
      sezioniApi.update(id, body),
    onSuccess: () => qc.invalidateQueries({ queryKey: sezioniKeys.all(concorsoId) }),
  });
}

export function useDeleteSezione(concorsoId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => sezioniApi.delete(id),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: sezioniKeys.all(concorsoId) });
      // categorie belonging to this sezione are also gone
      void qc.invalidateQueries({ queryKey: ['categorie', concorsoId] });
    },
  });
}
