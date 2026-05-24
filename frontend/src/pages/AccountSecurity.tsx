import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { zodResolver } from '@hookform/resolvers/zod';
import { toast } from 'sonner';
import { ShieldCheck, ShieldOff, KeyRound, Copy } from 'lucide-react';

import { useAuth } from '@/contexts/AuthContext';
import { authApi } from '@/api/auth';
import { httpErrorMessage } from '@/lib/api';
import type { TotpSetupResponse } from '@/api/auth';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { FieldError } from '@/components/ui/field-error';

// ─── Schema attiva 2FA ────────────────────────────────────────────────────────

const enableSchema = z.object({
  code: z.string().min(1, 'Codice obbligatorio'),
});
type EnableFields = z.infer<typeof enableSchema>;

// ─── Schema disattiva 2FA ─────────────────────────────────────────────────────

const disableSchema = z.object({
  password: z.string().min(1, 'Password obbligatoria'),
});
type DisableFields = z.infer<typeof disableSchema>;

// ─── Flusso di attivazione ────────────────────────────────────────────────────

type EnableStep = 'idle' | 'setup' | 'done';

function EnableFlow({ onDone }: { onDone: () => void }) {
  const [step, setStep] = useState<EnableStep>('idle');
  const [loading, setLoading] = useState(false);
  const [setup, setSetup] = useState<TotpSetupResponse | null>(null);
  const [recoveryCodes, setRecoveryCodes] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
    reset,
  } = useForm<EnableFields>({ resolver: zodResolver(enableSchema) });

  const startSetup = async () => {
    setError(null);
    setLoading(true);
    try {
      const res = await authApi.totpSetup();
      setSetup(res);
      setStep('setup');
    } catch (err) {
      setError(httpErrorMessage(err) || 'Impossibile avviare il setup 2FA.');
    } finally {
      setLoading(false);
    }
  };

  const onSubmitCode = async (data: EnableFields) => {
    setError(null);
    try {
      const res = await authApi.totpEnable(data.code.trim());
      setRecoveryCodes(res.recoveryCodes ?? []);
      reset();
      setStep('done');
    } catch (err) {
      setError(httpErrorMessage(err) || 'Codice non valido, riprova.');
    }
  };

  const copyRecoveryCodes = () => {
    void navigator.clipboard.writeText(recoveryCodes.join('\n'));
    toast.success('Codici copiati negli appunti');
  };

  if (step === 'done') {
    return (
      <div className="space-y-4">
        <div className="flex items-center gap-2 text-sm font-semibold text-green-700">
          <ShieldCheck size={18} />
          <span>Verifica in due passaggi attivata.</span>
        </div>
        <div className="space-y-2">
          <p className="text-sm text-muted-foreground">
            Conserva questi codici in un luogo sicuro. Ognuno funziona{' '}
            <strong>una sola volta</strong> se perdi l&rsquo;accesso all&rsquo;app. Non verranno
            mostrati di nuovo.
          </p>
          <pre className="select-all whitespace-pre-wrap bg-muted border border-border rounded-lg px-3 py-2 font-mono text-[13px] text-foreground">
            {recoveryCodes.join('\n')}
          </pre>
          <Button variant="outline" size="sm" onClick={copyRecoveryCodes} type="button">
            <Copy size={14} />
            Copia codici
          </Button>
        </div>
        <Button
          onClick={() => {
            toast.success('Verifica in due passaggi attivata.');
            onDone();
          }}
          type="button"
        >
          Ho salvato i codici
        </Button>
      </div>
    );
  }

  if (step === 'setup' && setup) {
    return (
      <form onSubmit={handleSubmit(onSubmitCode)} className="space-y-4" noValidate>
        <p className="text-sm text-muted-foreground">
          Aggiungi questo account a un&rsquo;app di autenticazione (Google Authenticator, Authy,
          1Password…), poi inserisci il codice a 6 cifre per confermare.
        </p>

        {/* QR code se disponibile */}
        {setup.qrCode && (
          <div className="flex justify-center">
            <img
              src={setup.qrCode}
              alt="QR code per configurare l'autenticatore"
              className="w-44 h-44 rounded-lg border border-border"
            />
          </div>
        )}

        <div className="space-y-1">
          <p className="text-sm font-medium text-foreground">Chiave (inserimento manuale)</p>
          <code className="block select-all break-all bg-muted border border-border rounded-lg px-3 py-2 font-mono text-[13px] text-foreground">
            {setup.secret}
          </code>
        </div>

        <details className="text-xs text-muted-foreground">
          <summary className="cursor-pointer">Mostra URI otpauth (per QR/import)</summary>
          <p className="mt-1 break-all select-all">{setup.uri}</p>
        </details>

        <div className="space-y-1.5">
          <Label htmlFor="totp-enable-code">Codice a 6 cifre</Label>
          <Input
            id="totp-enable-code"
            inputMode="numeric"
            autoComplete="one-time-code"
            autoFocus
            placeholder="123456"
            className="tracking-widest"
            aria-describedby={errors.code ? 'enable-code-error' : undefined}
            {...register('code')}
          />
          <FieldError id="enable-code-error">{errors.code?.message}</FieldError>
        </div>

        {error && (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        <div className="flex gap-2">
          <Button type="submit" disabled={isSubmitting}>
            {isSubmitting ? 'Attivazione…' : 'Attiva 2FA'}
          </Button>
          <Button
            type="button"
            variant="outline"
            onClick={() => {
              setStep('idle');
              setSetup(null);
              setError(null);
            }}
          >
            Annulla
          </Button>
        </div>
      </form>
    );
  }

  // step === 'idle'
  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Proteggi il tuo account con un secondo fattore di autenticazione. Ti servirà un&rsquo;app
        come Google Authenticator, Authy o 1Password.
      </p>
      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      <Button onClick={startSetup} disabled={loading} type="button">
        <KeyRound size={16} />
        {loading ? 'Caricamento…' : 'Attiva la verifica in due passaggi'}
      </Button>
    </div>
  );
}

// ─── Flusso di disattivazione ─────────────────────────────────────────────────

function DisableFlow({ onDone }: { onDone: () => void }) {
  const [error, setError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<DisableFields>({ resolver: zodResolver(disableSchema) });

  const onSubmit = async (data: DisableFields) => {
    setError(null);
    try {
      await authApi.totpDisable(data.password);
      toast.success('Verifica in due passaggi disattivata.');
      onDone();
    } catch (err) {
      setError(httpErrorMessage(err) || 'Password non valida.');
    }
  };

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-4" noValidate>
      <p className="text-sm text-muted-foreground">
        Conferma la password per disattivare il 2FA su questo account.
      </p>

      <div className="space-y-1.5">
        <Label htmlFor="disable-password">Password</Label>
        <Input
          id="disable-password"
          type="password"
          autoComplete="current-password"
          placeholder="••••••••"
          aria-describedby={errors.password ? 'disable-pwd-error' : undefined}
          {...register('password')}
        />
        <FieldError id="disable-pwd-error">{errors.password?.message}</FieldError>
      </div>

      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      <Button type="submit" variant="destructive" disabled={isSubmitting}>
        <ShieldOff size={16} />
        {isSubmitting ? 'Disattivazione…' : 'Disattiva 2FA'}
      </Button>
    </form>
  );
}

// ─── Pagina principale ────────────────────────────────────────────────────────

export default function AccountSecurity() {
  const { user, refreshUser } = useAuth();
  const totpEnabled = user?.totpEnabled ?? false;

  const handleDone = () => {
    void refreshUser();
  };

  return (
    <section className="mx-auto max-w-2xl space-y-8 py-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Sicurezza account</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Gestisci le impostazioni di sicurezza del tuo account.
        </p>
      </div>

      <div className="rounded-xl border border-border bg-card p-6 space-y-4">
        {/* Stato 2FA */}
        <div className="flex items-center gap-3">
          {totpEnabled ? (
            <ShieldCheck size={22} className="text-green-600 shrink-0" />
          ) : (
            <ShieldOff size={22} className="text-muted-foreground shrink-0" />
          )}
          <div>
            <p className="font-semibold text-foreground">Verifica in due passaggi (2FA)</p>
            <p className="text-sm text-muted-foreground">
              {totpEnabled
                ? 'Attiva — il tuo account è protetto con TOTP.'
                : 'Non attiva — il tuo account è protetto solo dalla password.'}
            </p>
          </div>
          <span
            className={[
              'ml-auto text-xs font-semibold px-2.5 py-1 rounded-full',
              totpEnabled
                ? 'bg-green-100 text-green-800'
                : 'bg-muted text-muted-foreground',
            ].join(' ')}
          >
            {totpEnabled ? 'Attiva' : 'Non attiva'}
          </span>
        </div>

        <div className="border-t border-border pt-4">
          {totpEnabled ? (
            <DisableFlow onDone={handleDone} />
          ) : (
            <EnableFlow onDone={handleDone} />
          )}
        </div>
      </div>
    </section>
  );
}
