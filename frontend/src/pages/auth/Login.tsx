import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { zodResolver } from '@hookform/resolvers/zod';
import { useTranslation } from 'react-i18next';
import { Flag, Scale, Trophy, ArrowRight } from 'lucide-react';

import { useAuth } from '@/contexts/AuthContext';
import { httpErrorMessage } from '@/lib/api';

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
      <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-brand-700 font-bold">
        {t('login.2fa.eyebrow')}
      </p>
      <h2 className="mt-1.5 text-2xl font-black tracking-tight text-ink-900">
        {t('login.2fa.title')}
      </h2>
      <p className="text-[15px] text-ink-700 mt-1 font-medium">
        {t('login.2fa.help')}
      </p>

      <label className="c-field">
        <span className="c-field__label">{t('login.2fa.code')}</span>
        <input
          id="totp-code"
          type="text"
          inputMode="text"
          autoComplete="one-time-code"
          autoFocus
          placeholder="123456"
          className="c-input tracking-widest"
          aria-describedby={errors.code ? 'totp-code-error' : undefined}
          {...register('code')}
        />
        {errors.code && (
          <span id="totp-code-error" className="text-xs font-semibold text-red-700">
            {errors.code.message}
          </span>
        )}
      </label>

      {error && (
        <div
          role="alert"
          aria-live="assertive"
          className="text-sm font-semibold text-red-800 bg-red-50 border border-red-200 rounded-xl px-3 py-2.5"
        >
          {error}
        </div>
      )}

      <button
        type="submit"
        className="c-btn c-btn--primary c-btn--xl w-full justify-center"
        disabled={isSubmitting}
      >
        <span>{isSubmitting ? 'Verifica in corso…' : t('login.2fa.submit')}</span>
      </button>
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
    <section className="view-fade min-h-screen grid lg:grid-cols-2 gap-6 lg:gap-10 c-page">
      {/* ── Left: royal-blue brand panel with blurred musical backdrop ── */}
      <aside className="login-hero hidden lg:flex flex-col justify-between text-white p-10 overflow-hidden rounded-3xl shadow-pop">
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
            <h2
              style={{ color: '#fff' }}
              className="text-[2.4rem] sm:text-5xl font-black tracking-tight leading-[1.0] drop-shadow-md"
            >
              {t('login.title.line1')}
              <br />
              {t('login.title.line2')}
              <br />
              {t('login.title.line3')}
            </h2>
          </div>
        </div>

        <div className="space-y-3">
          <div className="flex items-start gap-3 bg-white/15 backdrop-blur-md rounded-2xl px-4 py-3.5 ring-1 ring-white/25 shadow-lg">
            <span className="text-white mt-0.5">
              <Flag size={20} />
            </span>
            <p className="text-[15px] text-white font-medium leading-relaxed">{t('login.feat.1')}</p>
          </div>
          <div className="flex items-start gap-3 bg-white/15 backdrop-blur-md rounded-2xl px-4 py-3.5 ring-1 ring-white/25 shadow-lg">
            <span className="text-white mt-0.5">
              <Scale size={20} />
            </span>
            <p className="text-[15px] text-white font-medium leading-relaxed">{t('login.feat.2')}</p>
          </div>
          <div className="flex items-start gap-3 bg-white/15 backdrop-blur-md rounded-2xl px-4 py-3.5 ring-1 ring-white/25 shadow-lg">
            <span className="text-white mt-0.5">
              <Trophy size={20} />
            </span>
            <p className="text-[15px] text-white font-medium leading-relaxed">{t('login.feat.3')}</p>
          </div>
        </div>

        <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-white/85 font-bold">
          {t('login.copyright')}
        </p>
      </aside>

      {/* ── Right: login card ── */}
      <div className="flex items-center justify-center p-2 sm:p-6">
        <div className="w-full max-w-md bg-white rounded-3xl shadow-soft p-7 sm:p-10 ring-1 ring-brand-200">
          {/* Mobile branding — visible only below lg */}
          <div className="flex items-center gap-3 lg:hidden mb-5">
            <img
              src="./logo.png"
              alt=""
              className="w-14 h-14 rounded-2xl shadow-soft ring-2 ring-brand-100 object-contain"
            />
            <div>
              <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-brand-700 font-bold">
                {t('app.title')} · {t('app.subtitle')}
              </p>
              <h3 className="text-lg font-black text-ink-900">{t('login.title.line1')}</h3>
            </div>
          </div>

          {mfaChallenge ? (
            <TotpStep challenge={mfaChallenge} onSuccess={handleMfaSuccess} />
          ) : (
            <>
              <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-brand-700 font-bold">
                {t('login.form.eyebrow')}
              </p>
              <h2 className="mt-1.5 text-3xl sm:text-4xl font-black tracking-tight text-ink-900">
                {t('login.form.title')}
              </h2>
              <p className="text-[15px] text-ink-700 mt-2 font-medium">
                {t('login.form.subtitle')}
              </p>

              <form
                onSubmit={handleSubmit(onSubmit)}
                className="mt-7 space-y-5"
                autoComplete="on"
                noValidate
              >
                <label className="c-field">
                  <span className="c-field__label">{t('login.form.email')}</span>
                  <input
                    id="email"
                    type="email"
                    autoComplete="email"
                    autoFocus
                    inputMode="email"
                    placeholder="nome@esempio.it"
                    className="c-input"
                    aria-describedby={errors.email ? 'email-error' : undefined}
                    {...register('email')}
                  />
                  {errors.email && (
                    <span id="email-error" className="text-xs font-semibold text-red-700">
                      {errors.email.message}
                    </span>
                  )}
                </label>

                <label className="c-field">
                  <span className="c-field__label">{t('login.form.password')}</span>
                  <input
                    id="password"
                    type="password"
                    autoComplete="current-password"
                    placeholder="••••••••"
                    className="c-input"
                    aria-describedby={errors.password ? 'password-error' : undefined}
                    {...register('password')}
                  />
                  {errors.password && (
                    <span id="password-error" className="text-xs font-semibold text-red-700">
                      {errors.password.message}
                    </span>
                  )}
                </label>

                {error && (
                  <div
                    role="alert"
                    aria-live="assertive"
                    className="text-sm font-semibold text-red-800 bg-red-50 border border-red-200 rounded-xl px-3 py-2.5"
                  >
                    {error}
                  </div>
                )}

                <button
                  type="submit"
                  className="c-btn c-btn--primary c-btn--xl w-full justify-center"
                  disabled={isSubmitting}
                >
                  <span>
                    {isSubmitting ? t('login.form.submitting') : t('login.form.submit')}
                  </span>
                  {!isSubmitting && (
                    <span className="c-btn__icon" aria-hidden="true">
                      <ArrowRight size={16} />
                    </span>
                  )}
                </button>
              </form>

              <div className="mt-6 pt-5 border-t border-slate-200 text-center">
                <p className="text-xs text-slate-600 mb-2">
                  Sei un candidato e vuoi iscriverti al concorso?
                </p>
                <Link
                  to="/iscrizione"
                  className="c-btn c-btn--outline c-btn--sm inline-flex items-center gap-1.5"
                >
                  <span>📝</span>
                  <span>Vai al form di iscrizione</span>
                </Link>
              </div>
            </>
          )}
        </div>
      </div>
    </section>
  );
}
