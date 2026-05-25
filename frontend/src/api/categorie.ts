// =============================================================================
// api/categorie.ts — Categorie CRUD (belongs to sezione)
//
// Server routes: server/src/routes/categorie.ts
// GET /api/categorie?sezioneId=... → CategoriaRecord[]
// =============================================================================

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { http } from '@/lib/api';

export interface CategoriaRecord {
  id: string;
  sezioneId: string;
  tenantId: string;
  nome: string;
  descrizione: string | null;
  etaMin: number | null;
  etaMax: number | null;
  ordine: number | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreateCategoriaBody {
  sezioneId: string;
  nome: string;
  descrizione?: string;
  etaMin?: number;
  etaMax?: number;
  ordine?: number;
}

export type UpdateCategoriaBody = Partial<Omit<CreateCategoriaBody, 'sezioneId'>>;

// ---------------------------------------------------------------------------
// Pure API
// ---------------------------------------------------------------------------
export const categorieApi = {
  /** List by sezioneId */
  listBySezione: (sezioneId: string) =>
    http.get<CategoriaRecord[]>('categorie', { sezioneId, limit: 500 }),

  get: (id: string) => http.get<CategoriaRecord>(`categorie/${id}`),

  create: (body: CreateCategoriaBody) => http.post<CategoriaRecord>('categorie', body),

  update: (id: string, body: UpdateCategoriaBody) =>
    http.patch<CategoriaRecord>(`categorie/${id}`, body),

  delete: (id: string) => http.del<void>(`categorie/${id}`),
};

// ---------------------------------------------------------------------------
// React Query hooks
// ---------------------------------------------------------------------------
export const categorieKeys = {
  bySezione: (sezioneId: string) => ['categorie', 'sezione', sezioneId] as const,
  detail: (id: string) => ['categorie', 'detail', id] as const,
};

export function useCategorie(sezioneId: string) {
  return useQuery({
    queryKey: categorieKeys.bySezione(sezioneId),
    queryFn: () => categorieApi.listBySezione(sezioneId),
    enabled: !!sezioneId,
  });
}

export function useCreateCategoria(sezioneId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateCategoriaBody) => categorieApi.create(body),
    onSuccess: () => qc.invalidateQueries({ queryKey: categorieKeys.bySezione(sezioneId) }),
  });
}

export function useUpdateCategoria(sezioneId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: UpdateCategoriaBody }) =>
      categorieApi.update(id, body),
    onSuccess: () => qc.invalidateQueries({ queryKey: categorieKeys.bySezione(sezioneId) }),
  });
}

export function useDeleteCategoria(sezioneId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => categorieApi.delete(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: categorieKeys.bySezione(sezioneId) }),
  });
}
