import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { zodResolver } from '@hookform/resolvers/zod';
import { useTranslation } from 'react-i18next';
import { Flag, Scale, Trophy, ArrowRight } from 'lucide-react';

import { useAuth } from '@/contexts/AuthContext';
import { httpErrorMessage } from '@/lib/api';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { FieldError } from '@/components/ui/field-error';

// ─── Schema login ─────────────────────────────────────────────────────────────

const loginSchema = z.object({
  email: z.string().min(1, 'Email obbligatoria').email('Email non valida'),
  password: z.string().min(1, 'Password obbligatoria'),
});
type LoginFields = z.infer<typeof loginSchema>;

// ─── Schema TOTP ──────────────────────────────────────────────────────────────

const totpSchema = z.object({
  code: z.string().min(1, 'Codice obbligatorio'),
});
type TotpFields = z.infer<typeof totpSchema>;

// ─── Sottostep TOTP ───────────────────────────────────────────────────────────

interface TotpStepProps {
  challenge: string;
  onSuccess: () => void;
}

function TotpStep({ challenge, onSuccess }: TotpStepProps) {
  const { t } = useTranslation();
  const { completeMfaLogin } = useAuth();
  const [error, setError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<TotpFields>({ resolver: zodResolver(totpSchema) });

  const onSubmit = async (data: TotpFields) => {
    setError(null);
    try {
      await completeMfaLogin(challenge, data.code.trim());
      onSuccess();
    } catch (err) {
      const msg = httpErrorMessage(err);
      setError(msg || t('login.2fa.error'));
    }
  };

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="mt-7 space-y-5" noValidate>
      <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-primary font-bold">
        {t('login.2fa.eyebrow')}
      </p>
      <h2 className="mt-1.5 text-2xl font-black tracking-tight text-foreground">
        {t('login.2fa.title')}
      </h2>
      <p className="text-[15px] text-muted-foreground mt-1 font-medium">
        {t('login.2fa.help')}
      </p>

      <div className="space-y-1.5">
        <Label htmlFor="totp-code">{t('login.2fa.code')}</Label>
        <Input
          id="totp-code"
          inputMode="text"
          autoComplete="one-time-code"
          autoFocus
          placeholder="123456"
          className="tracking-widest"
          aria-describedby={errors.code ? 'totp-code-error' : undefined}
          {...register('code')}
        />
        <FieldError id="totp-code-error">{errors.code?.message}</FieldError>
      </div>

      {error && (
        <Alert variant="destructive" role="alert" aria-live="assertive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      <Button type="submit" size="xl" className="w-full" disabled={isSubmitting}>
        {isSubmitting ? 'Verifica in corso…' : t('login.2fa.submit')}
      </Button>
    </form>
  );
}

// ─── Pagina Login principale ──────────────────────────────────────────────────

export default function Login() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { loginWithCredentials } = useAuth();

  const [error, setError] = useState<string | null>(null);
  const [mfaChallenge, setMfaChallenge] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<LoginFields>({ resolver: zodResolver(loginSchema) });

  const onSubmit = async (data: LoginFields) => {
    setError(null);
    try {
      const res = await loginWithCredentials(data.email.trim(), data.password);
      if (res.kind === 'mfa') {
        setMfaChallenge(res.challenge);
        return;
      }
      navigate('/', { replace: true });
    } catch (err) {
      const raw = httpErrorMessage(err);
      const invalid = /failed to authenticate|invalid credentials/i.test(raw);
      setError(invalid ? t('login.error.invalid') : raw || t('login.error.generic'));
    }
  };

  const handleMfaSuccess = () => {
    navigate('/', { replace: true });
  };

  return (
    <div className="min-h-screen grid lg:grid-cols-2 gap-6 lg:gap-10 p-4 sm:p-6 bg-background">
      {/* ── Left: hero panel ── */}
      <aside
        className="login-hero hidden lg:flex flex-col justify-between text-white p-10 overflow-hidden rounded-3xl shadow-lg"
        style={{ background: 'linear-gradient(135deg, #1e40af 0%, #1d4ed8 50%, #2563eb 100%)' }}
      >
        <div>
          <p className="font-mono text-[12px] uppercase tracking-[0.18em] text-white font-bold drop-shadow">
            {t('login.eyebrow')}
          </p>
          <div className="mt-5 flex items-center gap-4">
            <img
              src="./logo.png"
              alt=""
              className="w-20 h-20 rounded-3xl shadow-2xl ring-4 ring-white/40 object-contain bg-white/10"
            />
            <h2 className="text-[2.4rem] sm:text-5xl font-black tracking-tight leading-[1.0] drop-shadow-md text-white">
              {t('login.title.line1')}
              <br />
              {t('login.title.line2')}
              <br />
              {t('login.title.line3')}
            </h2>
          </div>
        </div>

        <div className="space-y-3">
          {(
            [
              { icon: <Flag size={20} />, key: 'login.feat.1' },
              { icon: <Scale size={20} />, key: 'login.feat.2' },
              { icon: <Trophy size={20} />, key: 'login.feat.3' },
            ] as const
          ).map(({ icon, key }) => (
            <div
              key={key}
              className="flex items-start gap-3 bg-white/15 backdrop-blur-md rounded-2xl px-4 py-3.5 ring-1 ring-white/25 shadow-lg"
            >
              <span className="text-white mt-0.5">{icon}</span>
              <p className="text-[15px] text-white font-medium leading-relaxed">{t(key)}</p>
            </div>
          ))}
        </div>

        <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-white/85 font-bold">
          {t('login.copyright')}
        </p>
      </aside>

      {/* ── Right: form card ── */}
      <div className="flex items-center justify-center p-2 sm:p-6">
        <div className="w-full max-w-md bg-card rounded-3xl shadow-md p-7 sm:p-10 ring-1 ring-border">
          {/* Mobile branding */}
          <div className="flex items-center gap-3 lg:hidden mb-5">
            <img
              src="./logo.png"
              alt=""
              className="w-14 h-14 rounded-2xl shadow-sm ring-2 ring-border object-contain"
            />
            <div>
              <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-primary font-bold">
                {t('app.title')} · {t('app.subtitle')}
              </p>
              <h3 className="text-lg font-black text-foreground">{t('login.title.line1')}</h3>
            </div>
          </div>

          {mfaChallenge ? (
            <TotpStep challenge={mfaChallenge} onSuccess={handleMfaSuccess} />
          ) : (
            <>
              <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-primary font-bold">
                {t('login.form.eyebrow')}
              </p>
              <h2 className="mt-1.5 text-3xl sm:text-4xl font-black tracking-tight text-foreground">
                {t('login.form.title')}
              </h2>
              <p className="text-[15px] text-muted-foreground mt-2 font-medium">
                {t('login.form.subtitle')}
              </p>

              <form
                onSubmit={handleSubmit(onSubmit)}
                className="mt-7 space-y-5"
                autoComplete="on"
                noValidate
              >
                <div className="space-y-1.5">
                  <Label htmlFor="email">{t('login.form.email')}</Label>
                  <Input
                    id="email"
                    type="email"
                    autoComplete="email"
                    autoFocus
                    inputMode="email"
                    placeholder="nome@esempio.it"
                    aria-describedby={errors.email ? 'email-error' : undefined}
                    {...register('email')}
                  />
                  <FieldError id="email-error">{errors.email?.message}</FieldError>
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="password">{t('login.form.password')}</Label>
                  <Input
                    id="password"
                    type="password"
                    autoComplete="current-password"
                    placeholder="••••••••"
                    aria-describedby={errors.password ? 'password-error' : undefined}
                    {...register('password')}
                  />
                  <FieldError id="password-error">{errors.password?.message}</FieldError>
                </div>

                {error && (
                  <Alert variant="destructive" role="alert" aria-live="assertive">
                    <AlertDescription>{error}</AlertDescription>
                  </Alert>
                )}

                <Button type="submit" size="xl" className="w-full" disabled={isSubmitting}>
                  {isSubmitting ? t('login.form.submitting') : t('login.form.submit')}
                  {!isSubmitting && <ArrowRight size={16} aria-hidden="true" />}
                </Button>
              </form>

              <div className="mt-6 pt-5 border-t border-border text-center">
                <p className="text-xs text-muted-foreground mb-2">
                  Sei un candidato e vuoi iscriverti al concorso?
                </p>
                <a
                  href="/iscrizione"
                  className="inline-flex items-center gap-1.5 text-sm font-medium text-primary underline-offset-4 hover:underline"
                >
                  <span>📝</span>
                  <span>Vai al form di iscrizione</span>
                </a>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
