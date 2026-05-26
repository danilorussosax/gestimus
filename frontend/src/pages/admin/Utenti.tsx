/**
 * Utenti — tabella account tenant con CRUD + reset password.
 *
 * Operazioni:
 *   - Visualizza lista account (email, ruolo, stato attivo, ultimo login)
 *   - Crea account (email, password, ruolo)
 *   - Toggle attivo/disabilitato
 *   - Reset password via dialog
 *   - Elimina account (con guard "non puoi eliminare te stesso")
 *
 * POST /api/accounts, PATCH /api/accounts/:id, POST /api/accounts/:id/reset-password,
 * DELETE /api/accounts/:id
 */

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { Plus, Key, Trash2, UserCheck, UserX } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogClose,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { httpErrorMessage } from '@/lib/api';
import { accountsApi } from '@/api/accounts';
import { useAuth } from '@/contexts/AuthContext';
import type { Account, Role } from '@/types';

// ─── Types ─────────────────────────────────────────────────────────────────────

type ModalMode = 'create' | 'resetPwd' | null;

// ─── Schemas ─────────────────────────────────────────────────────────────────

const createSchema = z.object({
  email: z.email('Email non valida'),
  password: z.string().min(8, 'Minimo 8 caratteri').max(200),
  role: z.enum(['admin', 'commissario']),
  attivo: z.boolean().optional(),
});
type CreateForm = z.infer<typeof createSchema>;

const resetPwdSchema = z.object({
  password: z.string().min(8, 'Minimo 8 caratteri').max(200),
  confirm: z.string(),
}).refine((d) => d.password === d.confirm, {
  message: 'Le password non coincidono',
  path: ['confirm'],
});
type ResetPwdForm = z.infer<typeof resetPwdSchema>;

// ─── Role badge ───────────────────────────────────────────────────────────────

function RoleBadge({ role }: { role: Role }) {
  const { t } = useTranslation();
  if (role === 'admin') {
    return (
      <Badge variant="secondary" className="text-[10px] font-bold uppercase tracking-wider">
        {t('admin.users.role_admin')}
      </Badge>
    );
  }
  if (role === 'superadmin') {
    return (
      <Badge className="text-[10px] font-bold uppercase tracking-wider bg-destructive">
        Superadmin
      </Badge>
    );
  }
  return (
    <Badge variant="outline" className="text-[10px] font-bold uppercase tracking-wider">
      {t('admin.users.role_commissario')}
    </Badge>
  );
}

// ─── Create dialog ────────────────────────────────────────────────────────────

interface CreateDialogProps {
  open: boolean;
  onClose: () => void;
  onCreated: () => void;
}

function CreateDialog({ open, onClose, onCreated }: CreateDialogProps) {
  const { t } = useTranslation();
  const {
    register,
    handleSubmit,
    setValue,
    watch,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<CreateForm>({
    resolver: zodResolver(createSchema),
    defaultValues: { role: 'admin', attivo: true },
  });

  const createMut = useMutation({
    mutationFn: (d: CreateForm) =>
      accountsApi.create({
        email: d.email,
        password: d.password,
        role: d.role,
        attivo: d.attivo ?? true,
      }),
    onSuccess: () => {
      toast.success('Account creato');
      onCreated();
      onClose();
      reset();
    },
    onError: (e) => toast.error(httpErrorMessage(e)),
  });

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) { onClose(); reset(); } }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t('admin.users.add')}</DialogTitle>
        </DialogHeader>

        <form id="create-account-form" onSubmit={handleSubmit((d) => createMut.mutate(d))} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="acc-email">{t('admin.users.col_email')}</Label>
            <Input id="acc-email" type="email" autoComplete="off" {...register('email')} />
            {errors.email && <p className="text-xs text-destructive">{errors.email.message}</p>}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="acc-pwd">Password</Label>
            <Input id="acc-pwd" type="password" autoComplete="new-password" {...register('password')} />
            {errors.password && <p className="text-xs text-destructive">{errors.password.message}</p>}
          </div>

          <div className="space-y-1.5">
            <Label>{t('admin.users.col_role')}</Label>
            <Select value={watch('role')} onValueChange={(v) => setValue('role', v as 'admin' | 'commissario')}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="admin">{t('admin.users.role_admin')}</SelectItem>
                <SelectItem value="commissario">{t('admin.users.role_commissario')}</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </form>

        <DialogFooter>
          <DialogClose asChild>
            <Button variant="outline">{t('common.cancel')}</Button>
          </DialogClose>
          <Button type="submit" form="create-account-form" disabled={isSubmitting}>
            {t('common.create')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Reset password dialog ────────────────────────────────────────────────────

interface ResetPwdDialogProps {
  open: boolean;
  account: Account | null;
  onClose: () => void;
}

function ResetPwdDialog({ open, account, onClose }: ResetPwdDialogProps) {
  const { t } = useTranslation();
  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<ResetPwdForm>({ resolver: zodResolver(resetPwdSchema) });

  const resetMut = useMutation({
    mutationFn: ({ id, pwd }: { id: string; pwd: string }) =>
      accountsApi.resetPassword(id, pwd),
    onSuccess: () => {
      toast.success(t('admin.users.password_reset_ok'));
      onClose();
      reset();
    },
    onError: (e) => toast.error(httpErrorMessage(e)),
  });

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) { onClose(); reset(); } }}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>{t('admin.users.reset_password')}</DialogTitle>
        </DialogHeader>
        {account && (
          <p className="text-sm text-muted-foreground">
            Account: <span className="font-medium text-foreground">{account.email}</span>
          </p>
        )}

        <form
          id="reset-pwd-form"
          onSubmit={handleSubmit((d) => {
            if (!account) return;
            resetMut.mutate({ id: account.id, pwd: d.password });
          })}
          className="space-y-4"
        >
          <div className="space-y-1.5">
            <Label htmlFor="new-pwd">Nuova password</Label>
            <Input id="new-pwd" type="password" autoComplete="new-password" {...register('password')} />
            {errors.password && <p className="text-xs text-destructive">{errors.password.message}</p>}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="confirm-pwd">Conferma</Label>
            <Input id="confirm-pwd" type="password" autoComplete="new-password" {...register('confirm')} />
            {errors.confirm && <p className="text-xs text-destructive">{errors.confirm.message}</p>}
          </div>
        </form>

        <DialogFooter>
          <DialogClose asChild>
            <Button variant="outline">{t('common.cancel')}</Button>
          </DialogClose>
          <Button type="submit" form="reset-pwd-form" disabled={isSubmitting}>
            <Key className="mr-1.5 h-3.5 w-3.5" />
            Reimposta
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function AdminUtenti() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const qc = useQueryClient();

  const [modal, setModal] = useState<ModalMode>(null);
  const [selectedAccount, setSelectedAccount] = useState<Account | null>(null);

  const { data: accounts = [], isLoading, isError } = useQuery({
    queryKey: ['accounts'],
    queryFn: () => accountsApi.list({ limit: 1000 }),
  });

  // Sort: admin first, then by email
  const sorted = [...accounts].sort((a, b) => {
    if (a.role === 'admin' && b.role !== 'admin') return -1;
    if (a.role !== 'admin' && b.role === 'admin') return 1;
    return a.email.localeCompare(b.email);
  });

  const toggleActiveMut = useMutation({
    mutationFn: ({ id, attivo }: { id: string; attivo: boolean }) =>
      accountsApi.update(id, { attivo }),
    onSuccess: (_, vars) => {
      void qc.invalidateQueries({ queryKey: ['accounts'] });
      toast.success(vars.attivo ? t('admin.users.enabled_ok') : t('admin.users.disabled_ok'));
    },
    onError: (e) => toast.error(httpErrorMessage(e)),
  });

  const deleteMut = useMutation({
    mutationFn: (id: string) => accountsApi.remove(id),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['accounts'] });
      toast.success(t('admin.users.deleted'));
    },
    onError: (e) => toast.error(httpErrorMessage(e)),
  });

  function handleDelete(acc: Account) {
    if (acc.id === user?.id) {
      toast.error('Non puoi eliminare il tuo account');
      return;
    }
    if (!confirm(t('admin.users.delete_msg', { email: acc.email }))) return;
    deleteMut.mutate(acc.id);
  }

  return (
    <section className="mx-auto max-w-5xl space-y-8">
      {/* Header */}
      <header>
        <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
          {t('admin.users.eyebrow')}
        </p>
        <h1 className="mt-1 text-2xl font-bold text-foreground">{t('admin.users.title')}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{t('admin.users.subtitle')}</p>
      </header>

      {/* Toolbar */}
      <div className="flex items-center justify-between gap-4">
        <p className="text-sm text-muted-foreground">
          {t('admin.users.count', { n: accounts.length })}
        </p>
        <Button onClick={() => setModal('create')} size="sm">
          <Plus className="mr-1.5 h-4 w-4" />
          {t('admin.users.add')}
        </Button>
      </div>

      {/* Table */}
      {isLoading ? (
        <div className="space-y-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-14 w-full rounded-xl" />
          ))}
        </div>
      ) : isError ? (
        <p className="text-sm text-destructive">Errore nel caricamento degli account.</p>
      ) : sorted.length === 0 ? (
        <div className="rounded-2xl border-2 border-dashed border-border p-10 text-center">
          <h3 className="text-lg font-bold text-foreground">{t('admin.users.empty_title')}</h3>
          <p className="mt-1 text-sm text-muted-foreground">{t('admin.users.empty_desc')}</p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-2xl border border-border bg-card">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/40">
                {[
                  t('admin.users.col_email'),
                  t('admin.users.col_role'),
                  t('admin.users.col_status'),
                  'Ultimo login',
                  t('admin.users.col_actions'),
                ].map((col, i) => (
                  <th
                    key={i}
                    className={`px-4 py-2.5 font-mono text-[10px] font-medium uppercase tracking-wider text-muted-foreground ${i === 4 ? 'text-right' : 'text-left'}`}
                  >
                    {col}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {sorted.map((acc) => (
                <tr
                  key={acc.id}
                  className="border-b border-border/50 transition-colors hover:bg-muted/20 last:border-b-0"
                >
                  <td className="px-4 py-2.5">
                    <div className="font-medium text-foreground">{acc.email}</div>
                    {acc.id === user?.id && (
                      <span className="text-[10px] text-muted-foreground">(tu)</span>
                    )}
                  </td>
                  <td className="px-4 py-2.5">
                    <RoleBadge role={acc.role} />
                  </td>
                  <td className="px-4 py-2.5">
                    {acc.attivo ? (
                      <Badge variant="secondary" className="border border-emerald-200 bg-emerald-50 text-[10px] font-bold uppercase tracking-wider text-emerald-700">
                        {t('admin.users.active')}
                      </Badge>
                    ) : (
                      <Badge variant="secondary" className="border border-rose-200 bg-rose-50 text-[10px] font-bold uppercase tracking-wider text-rose-700">
                        {t('admin.users.disabled')}
                      </Badge>
                    )}
                  </td>
                  <td className="px-4 py-2.5 text-xs text-muted-foreground">
                    {acc.lastLoginAt
                      ? new Date(acc.lastLoginAt).toLocaleString('it-IT', {
                          dateStyle: 'short',
                          timeStyle: 'short',
                        })
                      : '—'}
                  </td>
                  <td className="px-4 py-2.5 text-right">
                    <div className="flex items-center justify-end gap-1">
                      {/* Toggle active */}
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7"
                        title={acc.attivo ? t('admin.users.disable') : t('admin.users.enable')}
                        disabled={acc.id === user?.id}
                        onClick={() =>
                          toggleActiveMut.mutate({ id: acc.id, attivo: !acc.attivo })
                        }
                      >
                        {acc.attivo ? (
                          <UserX className="h-3.5 w-3.5 text-rose-500" />
                        ) : (
                          <UserCheck className="h-3.5 w-3.5 text-emerald-600" />
                        )}
                      </Button>

                      {/* Reset password */}
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7"
                        title={t('admin.users.reset_password')}
                        onClick={() => {
                          setSelectedAccount(acc);
                          setModal('resetPwd');
                        }}
                      >
                        <Key className="h-3.5 w-3.5 text-primary" />
                      </Button>

                      {/* Delete */}
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7"
                        title={t('common.delete')}
                        disabled={acc.id === user?.id}
                        onClick={() => handleDelete(acc)}
                      >
                        <Trash2 className="h-3.5 w-3.5 text-destructive" />
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Dialogs */}
      <CreateDialog
        open={modal === 'create'}
        onClose={() => setModal(null)}
        onCreated={() => void qc.invalidateQueries({ queryKey: ['accounts'] })}
      />
      <ResetPwdDialog
        open={modal === 'resetPwd'}
        account={selectedAccount}
        onClose={() => { setModal(null); setSelectedAccount(null); }}
      />
    </section>
  );
}
