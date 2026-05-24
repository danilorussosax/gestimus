// =============================================================================
// api/commissioni.ts — Commissioni CRUD + N-N sync
//
// Server routes: server/src/routes/commissioni.ts
//
// The GET list endpoint augments each row with:
//   commissari: string[]  (array of commissarioId)
//   sezioni:    string[]
//   categorie:  string[]
//
// The field for the president is `presidenteCommissarioId` on the server
// (DB column: presidente_commissario_id). The vanilla JS used `presidente_id`
// which referred to the old PocketBase schema — we use the new server shape.
// =============================================================================

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { http } from '@/lib/api';

export interface CommissioneRecord {
  id: string;
  concorsoId: string;
  tenantId: string;
  nome: string;
  /** Not in DB schema — included for compatibility with the form UI */
  descrizione?: string | null;
  presidenteCommissarioId: string | null;
  /** Injected by the list/get endpoints */
  commissari: string[];
  sezioni: string[];
  categorie: string[];
  createdAt: string;
  updatedAt: string;
}

export interface CreateCommissioneBody {
  concorsoId: string;
  nome: string;
  presidenteCommissarioId?: string;
}

export type UpdateCommissioneBody = Partial<Omit<CreateCommissioneBody, 'concorsoId'>>;

// ---------------------------------------------------------------------------
// Pure API
// ---------------------------------------------------------------------------
export const commissioniApi = {
  list: (concorsoId: string) =>
    http.get<CommissioneRecord[]>('commissioni', { concorsoId, limit: 500 }),

  get: (id: string) => http.get<CommissioneRecord>(`commissioni/${id}`),

  create: (body: CreateCommissioneBody) =>
    http.post<CommissioneRecord>('commissioni', body),

  update: (id: string, body: UpdateCommissioneBody) =>
    http.patch<CommissioneRecord>(`commissioni/${id}`, body),

  delete: (id: string) => http.del<void>(`commissioni/${id}`),

  // ---- N-N: commissari ----
  addCommissario: (commissioneId: string, commissarioId: string) =>
    http.post<void>(`commissioni/${commissioneId}/commissari/${commissarioId}`),

  removeCommissario: (commissioneId: string, commissarioId: string) =>
    http.del<void>(`commissioni/${commissioneId}/commissari/${commissarioId}`),

  // ---- N-N: sezioni ----
  addSezione: (commissioneId: string, sezioneId: string) =>
    http.post<void>(`commissioni/${commissioneId}/sezioni/${sezioneId}`),

  removeSezione: (commissioneId: string, sezioneId: string) =>
    http.del<void>(`commissioni/${commissioneId}/sezioni/${sezioneId}`),

  // ---- N-N: categorie ----
  addCategoria: (commissioneId: string, categoriaId: string) =>
    http.post<void>(`commissioni/${commissioneId}/categorie/${categoriaId}`),

  removeCategoria: (commissioneId: string, categoriaId: string) =>
    http.del<void>(`commissioni/${commissioneId}/categorie/${categoriaId}`),

  /**
   * Full sync helper: given the desired arrays, compute the delta and apply
   * all add/remove calls in parallel.
   */
  syncRelations: async (
    commissioneId: string,
    current: CommissioneRecord,
    desired: {
      commissariIds: string[];
      sezioniIds: string[];
      categorieIds: string[];
    },
  ) => {
    const diff = <T>(cur: T[], next: T[]) => {
      const curSet = new Set(cur);
      const nextSet = new Set(next);
      return {
        add: next.filter((x) => !curSet.has(x)),
        remove: cur.filter((x) => !nextSet.has(x)),
      };
    };

    const dc = diff(current.commissari, desired.commissariIds);
    const ds = diff(current.sezioni, desired.sezioniIds);
    const dcat = diff(current.categorie, desired.categorieIds);

    await Promise.all([
      ...dc.add.map((id) => commissioniApi.addCommissario(commissioneId, id)),
      ...dc.remove.map((id) => commissioniApi.removeCommissario(commissioneId, id)),
      ...ds.add.map((id) => commissioniApi.addSezione(commissioneId, id)),
      ...ds.remove.map((id) => commissioniApi.removeSezione(commissioneId, id)),
      ...dcat.add.map((id) => commissioniApi.addCategoria(commissioneId, id)),
      ...dcat.remove.map((id) => commissioniApi.removeCategoria(commissioneId, id)),
    ]);
  },
};

// ---------------------------------------------------------------------------
// React Query hooks
// ---------------------------------------------------------------------------
export const commissioniKeys = {
  all: (concorsoId: string) => ['commissioni', concorsoId] as const,
  detail: (id: string) => ['commissioni', 'detail', id] as const,
};

export function useCommissioni(concorsoId: string) {
  return useQuery({
    queryKey: commissioniKeys.all(concorsoId),
    queryFn: () => commissioniApi.list(concorsoId),
    enabled: !!concorsoId,
  });
}

export function useCreateCommissione(concorsoId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateCommissioneBody) => commissioniApi.create(body),
    onSuccess: () => qc.invalidateQueries({ queryKey: commissioniKeys.all(concorsoId) }),
  });
}

export function useUpdateCommissione(concorsoId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: UpdateCommissioneBody }) =>
      commissioniApi.update(id, body),
    onSuccess: () => qc.invalidateQueries({ queryKey: commissioniKeys.all(concorsoId) }),
  });
}

export function useDeleteCommissione(concorsoId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => commissioniApi.delete(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: commissioniKeys.all(concorsoId) }),
  });
}
