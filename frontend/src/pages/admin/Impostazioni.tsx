/**
 * Impostazioni — branding ente (logo upload, nome pubblico, sottotitolo)
 * + dati anagrafici (denominazione, sede, contatti).
 *
 * Due sezioni distinte → due PATCH distinte:
 *   PATCH /api/ente         → enteSettings (denominazione, contatti…)
 *   PATCH /api/ente/branding → brandingPublic (nomePubblico, sottotitolo, logoUrl…)
 */

import { useEffect, useRef, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { Building2, Save, Upload } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Skeleton } from '@/components/ui/skeleton';
import { Separator } from '@/components/ui/separator';
import { fileUrl, httpErrorMessage } from '@/lib/api';
import { enteApi } from '@/api/ente';
import type { EnteSettings, BrandingPublic } from '@/api/ente';

// ─── Zod schemas ──────────────────────────────────────────────────────────────

const enteSchema = z.object({
  denominazione: z.string().max(255).optional(),
  sede: z.string().max(255).optional(),
  codiceFiscale: z.string().max(50).optional(),
  partitaIva: z.string().max(50).optional(),
  telefono: z.string().max(50).optional(),
  email: z.string().max(255).optional(),
  pec: z.string().max(255).optional(),
  sitoWeb: z.string().max(255).optional(),
  note: z.string().optional(),
});
type EnteFormValues = z.infer<typeof enteSchema>;

const brandingSchema = z.object({
  nomePubblico: z.string().max(255).optional(),
  sottotitolo: z.string().max(255).optional(),
  coloreAccent: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/, 'Formato colore non valido')
    .optional(),
  coloreSfondo: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/, 'Formato colore non valido')
    .optional(),
});
type BrandingFormValues = z.infer<typeof brandingSchema>;

const MAX_LOGO_SIZE = 5 * 1024 * 1024; // 5 MB
const MAX_LOGO_CHARS = 1_000_000;       // backend cap per logoUrl

// ─── Logo resize ──────────────────────────────────────────────────────────────

async function resizeImage(file: File, maxSide: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(url);
      const w = img.naturalWidth;
      const h = img.naturalHeight;
      const scale = Math.min(1, maxSide / Math.max(w, h));
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(w * scale);
      canvas.height = Math.round(h * scale);
      const ctx = canvas.getContext('2d');
      if (!ctx) { reject(new Error('canvas')); return; }
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      const dataUrl = canvas.toDataURL(file.type === 'image/png' ? 'image/png' : 'image/jpeg', 0.85);
      if (dataUrl.length > MAX_LOGO_CHARS) {
        reject(new Error('Il logo è troppo grande anche dopo la compressione (max ~750 KB).'));
      } else {
        resolve(dataUrl);
      }
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Errore caricamento immagine')); };
    img.src = url;
  });
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function AdminImpostazioni() {
  const { t } = useTranslation();
  const qc = useQueryClient();

  const { data: ente, isLoading } = useQuery({
    queryKey: ['ente'],
    queryFn: () => enteApi.getEnte(),
  });

  // ── Ente form ────────────────────────────────────────────────────────────
  const enteForm = useForm<EnteFormValues>({
    resolver: zodResolver(enteSchema),
  });

  useEffect(() => {
    if (!ente) return;
    const s = ente.enteSettings ?? {};
    enteForm.reset({
      denominazione: s.denominazione ?? '',
      sede: s.sede ?? '',
      codiceFiscale: s.codiceFiscale ?? '',
      partitaIva: s.partitaIva ?? '',
      telefono: s.telefono ?? '',
      email: s.email ?? '',
      pec: s.pec ?? '',
      sitoWeb: s.sitoWeb ?? '',
      note: s.note ?? '',
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ente]);

  const savEnteMut = useMutation({
    mutationFn: (body: EnteSettings) => enteApi.updateEnte(body),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['ente'] });
      toast.success(t('admin.settings.saved'));
    },
    onError: (e) => toast.error(httpErrorMessage(e)),
  });

  // ── Branding form ────────────────────────────────────────────────────────
  const brandingForm = useForm<BrandingFormValues>({
    resolver: zodResolver(brandingSchema),
  });

  const [logoPreview, setLogoPreview] = useState<string | null>(null);
  const [logoDataUrl, setLogoDataUrl] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!ente) return;
    const b = ente.brandingPublic ?? {};
    brandingForm.reset({
      nomePubblico: b.nomePubblico ?? ente.nome ?? '',
      sottotitolo: b.sottotitolo ?? '',
      coloreAccent: b.coloreAccent ?? '#4169E1',
      coloreSfondo: b.coloreSfondo ?? '#FFFFFF',
    });
    if (b.logoUrl) setLogoPreview(b.logoUrl);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ente]);

  const saveBrandingMut = useMutation({
    mutationFn: (body: BrandingPublic) => enteApi.updateBranding(body),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['ente'] });
      setLogoDataUrl(null);
      toast.success(t('admin.settings.saved'));
    },
    onError: (e) => toast.error(httpErrorMessage(e)),
  });

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > MAX_LOGO_SIZE) {
      toast.error(t('admin.settings.logo_error'));
      e.target.value = '';
      return;
    }
    try {
      const dataUrl = await resizeImage(file, 800);
      setLogoPreview(dataUrl);
      setLogoDataUrl(dataUrl);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('admin.settings.logo_error'));
    } finally {
      e.target.value = '';
    }
  }

  function onSubmitEnte(d: EnteFormValues) {
    // Strip empty strings → undefined so backend MERGE omits them
    const clean: EnteSettings = Object.fromEntries(
      Object.entries(d).filter(([, v]) => v !== ''),
    );
    savEnteMut.mutate(clean);
  }

  function onSubmitBranding(d: BrandingFormValues) {
    const body: BrandingPublic = { ...d };
    if (logoDataUrl) body.logoUrl = logoDataUrl;
    saveBrandingMut.mutate(body);
  }

  // ─────────────────────────────────────────────────────────────────────────

  return (
    <section className="mx-auto max-w-3xl space-y-10">
      {/* Header */}
      <header>
        <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
          {t('admin.settings.eyebrow')}
        </p>
        <h1 className="mt-1 text-2xl font-bold text-foreground">{t('admin.settings.title')}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{t('admin.settings.subtitle')}</p>
      </header>

      {isLoading ? (
        <div className="space-y-4">
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-3/4" />
        </div>
      ) : (
        <>
          {/* ─── Branding / logo ──────────────────────────────────────── */}
          <form onSubmit={brandingForm.handleSubmit(onSubmitBranding)} className="space-y-6">
            <h2 className="font-mono text-[10px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
              {t('admin.settings.logo')}
            </h2>

            {/* Logo preview + upload */}
            <div className="rounded-2xl border border-border bg-card p-5">
              <div className="flex items-start gap-4">
                <div className="flex h-20 w-20 shrink-0 items-center justify-center overflow-hidden rounded-xl border border-border bg-muted">
                  {logoPreview ? (
                    <img
                      src={fileUrl(logoPreview)}
                      alt="Logo ente"
                      className="h-full w-full object-contain"
                    />
                  ) : (
                    <Building2 className="h-8 w-8 text-muted-foreground" />
                  )}
                </div>
                <div className="flex-1 space-y-1">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => fileInputRef.current?.click()}
                  >
                    <Upload className="mr-1.5 h-3.5 w-3.5" />
                    {t('admin.settings.choose_logo')}
                  </Button>
                  <p className="text-xs text-muted-foreground">{t('admin.settings.logo_hint')}</p>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/png,image/jpeg,image/webp,image/svg+xml"
                    className="hidden"
                    onChange={handleFileChange}
                  />
                </div>
              </div>
            </div>

            {/* Nome pubblico + sottotitolo */}
            <div className="rounded-2xl border border-border bg-card p-5 space-y-4">
              <h2 className="font-mono text-[10px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
                Identità pubblica
              </h2>
              <div className="space-y-1.5">
                <Label htmlFor="nomePubblico">{t('admin.settings.name')}</Label>
                <Input
                  id="nomePubblico"
                  {...brandingForm.register('nomePubblico')}
                  placeholder={t('admin.settings.name_placeholder')}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="sottotitolo">{t('admin.settings.description')}</Label>
                <Input
                  id="sottotitolo"
                  {...brandingForm.register('sottotitolo')}
                  placeholder={t('admin.settings.description_placeholder')}
                />
              </div>
            </div>

            {/* Colori */}
            <div className="rounded-2xl border border-border bg-card p-5 space-y-4">
              <h2 className="font-mono text-[10px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
                {t('admin.settings.branding')}
              </h2>
              <div className="grid grid-cols-2 gap-4">
                <ColorField
                  label={t('admin.settings.primary_color')}
                  id="coloreAccent"
                  {...brandingForm.register('coloreAccent')}
                  value={brandingForm.watch('coloreAccent') ?? '#4169E1'}
                  onChange={(v) => brandingForm.setValue('coloreAccent', v)}
                  error={brandingForm.formState.errors.coloreAccent?.message}
                />
                <ColorField
                  label={t('admin.settings.secondary_color')}
                  id="coloreSfondo"
                  {...brandingForm.register('coloreSfondo')}
                  value={brandingForm.watch('coloreSfondo') ?? '#FFFFFF'}
                  onChange={(v) => brandingForm.setValue('coloreSfondo', v)}
                  error={brandingForm.formState.errors.coloreSfondo?.message}
                />
              </div>
            </div>

            <div className="flex justify-end">
              <Button type="submit" disabled={saveBrandingMut.isPending}>
                <Save className="mr-1.5 h-4 w-4" />
                {t('common.save')} branding
              </Button>
            </div>
          </form>

          <Separator />

          {/* ─── Dati anagrafici ente ──────────────────────────────── */}
          <form onSubmit={enteForm.handleSubmit(onSubmitEnte)} className="space-y-6">
            <div className="rounded-2xl border border-border bg-card p-5 space-y-4">
              <h2 className="font-mono text-[10px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
                Dati legali / anagrafici
              </h2>

              <div className="space-y-1.5">
                <Label htmlFor="denominazione">Denominazione legale</Label>
                <Input
                  id="denominazione"
                  {...enteForm.register('denominazione')}
                  placeholder="Ragione sociale / nome legale"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="sede">Sede</Label>
                <Input
                  id="sede"
                  {...enteForm.register('sede')}
                  placeholder="Via, Città"
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <Label htmlFor="codiceFiscale">Codice fiscale</Label>
                  <Input id="codiceFiscale" {...enteForm.register('codiceFiscale')} />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="partitaIva">Partita IVA</Label>
                  <Input id="partitaIva" {...enteForm.register('partitaIva')} />
                </div>
              </div>
            </div>

            {/* Contatti */}
            <div className="rounded-2xl border border-border bg-card p-5 space-y-4">
              <h2 className="font-mono text-[10px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
                {t('admin.settings.contacts')}
              </h2>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="email">{t('admin.settings.email')}</Label>
                  <Input id="email" type="email" {...enteForm.register('email')} />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="pec">PEC</Label>
                  <Input id="pec" type="email" {...enteForm.register('pec')} />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="telefono">{t('admin.settings.phone')}</Label>
                  <Input id="telefono" {...enteForm.register('telefono')} />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="sitoWeb">{t('admin.settings.website')}</Label>
                  <Input id="sitoWeb" type="url" placeholder="https://…" {...enteForm.register('sitoWeb')} />
                </div>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="note">Note</Label>
                <Textarea id="note" rows={3} {...enteForm.register('note')} />
              </div>
            </div>

            <div className="flex justify-end">
              <Button type="submit" disabled={savEnteMut.isPending}>
                <Save className="mr-1.5 h-4 w-4" />
                {t('common.save')} dati ente
              </Button>
            </div>
          </form>
        </>
      )}
    </section>
  );
}

// ─── ColorField ──────────────────────────────────────────────────────────────

interface ColorFieldProps {
  label: string;
  id: string;
  value: string;
  onChange: (v: string) => void;
  error?: string;
  [k: string]: unknown;
}

function ColorField({ label, id, value, onChange, error }: ColorFieldProps) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      <div className="flex items-center gap-2">
        <input
          type="color"
          className="h-9 w-10 cursor-pointer rounded-lg border border-border"
          value={value}
          onChange={(e) => onChange(e.target.value)}
        />
        <Input
          id={id}
          value={value}
          onChange={(e) => {
            const v = e.target.value;
            onChange(v);
          }}
          maxLength={7}
          className="flex-1"
          placeholder="#RRGGBB"
        />
      </div>
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}
