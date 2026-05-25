import { Link, Outlet, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Monitor, Moon, Shield, Sun } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { useTheme } from '@/contexts/ThemeContext';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  SUPPORTED_LANGUAGES,
  LANGUAGE_FLAGS,
  LANGUAGE_NAMES,
  type SupportedLanguage,
} from '@/i18n/index';

// ---------------------------------------------------------------------------
// Language switcher — replicates the vanilla #lang-switcher control
// ---------------------------------------------------------------------------
function LanguageSwitcher() {
  const { i18n } = useTranslation();
  const current = (i18n.resolvedLanguage ?? 'it').split('-')[0] as SupportedLanguage;
  return (
    <Select
      value={current}
      onValueChange={(v) => {
        void i18n.changeLanguage(v);
      }}
    >
      {/* Matches vanilla: outline button, flag + uppercase code */}
      <SelectTrigger
        className="h-9 w-[88px] border-input bg-background text-sm font-medium"
        aria-label="Lingua"
      >
        <SelectValue>
          <span className="flex items-center gap-1.5">
            <span aria-hidden="true">{LANGUAGE_FLAGS[current]}</span>
            <span className="text-xs uppercase tracking-wider">{current}</span>
          </span>
        </SelectValue>
      </SelectTrigger>
      <SelectContent>
        {SUPPORTED_LANGUAGES.map((l) => (
          <SelectItem key={l} value={l}>
            {LANGUAGE_FLAGS[l]}&nbsp;{LANGUAGE_NAMES[l]}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

// ---------------------------------------------------------------------------
// Theme toggle — cycle light → dark → system
// ---------------------------------------------------------------------------
function ThemeToggle() {
  const { theme, setTheme } = useTheme();
  const next = theme === 'light' ? 'dark' : theme === 'dark' ? 'system' : 'light';
  const Icon = theme === 'light' ? Sun : theme === 'dark' ? Moon : Monitor;
  return (
    <Button
      variant="ghost"
      size="icon"
      aria-label="Tema"
      onClick={() => {
        setTheme(next);
      }}
    >
      <Icon className="h-4 w-4" />
    </Button>
  );
}

// ---------------------------------------------------------------------------
// AppLayout — authenticated shell matching the vanilla index.html structure
// ---------------------------------------------------------------------------
/** Shell autenticata: header (brand + ruolo + lingua + tema + 2FA + logout) + Outlet. */
export function AppLayout() {
  const { user, logout } = useAuth();
  const { t } = useTranslation();
  const navigate = useNavigate();

  const handleLogout = () => {
    void logout().then(() => {
      navigate('/login', { replace: true });
    });
  };

  return (
    <div className="flex min-h-dvh flex-col bg-background text-foreground">

      {/* ------------------------------------------------------------------ */}
      {/* HEADER — mirrors <header id="app-header"> in index.html            */}
      {/* ------------------------------------------------------------------ */}
      <header
        className="sticky top-0 z-30 border-b border-border bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80"
      >
        <div className="w-full pl-4 pr-2 sm:pl-6 sm:pr-4 h-16 flex items-center justify-between gap-4">

          {/* Left: logo + title + subtitle eyebrow */}
          <div className="flex items-center gap-3 min-w-0">
            <Link
              to="/"
              className="flex items-center gap-3 min-w-0 group hover:opacity-80 transition-opacity rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              aria-label={t('app.go_dashboard', 'Dashboard')}
            >
              <img
                src="/logo.png"
                alt=""
                className="w-10 h-10 sm:w-11 sm:h-11 object-contain rounded-md ring-1 ring-border bg-card"
              />
              <div className="flex flex-col min-w-0 leading-tight">
                <h1 className="text-[15px] font-bold tracking-tight text-foreground truncate">
                  {t('app.title')}
                </h1>
                <span className="text-[12px] text-muted-foreground truncate hidden sm:inline">
                  {t('app.subtitle', 'Gestionale Concorso Musicale')}
                </span>
              </div>
            </Link>

            {/* Eyebrow mono label — role visible in medium+ breakpoints */}
            {user && (
              <p className="text-[11px] font-mono uppercase tracking-wider text-muted-foreground ml-3 pl-3 border-l border-border hidden md:block">
                {t(`app.role.${user.role}`, user.role)}
              </p>
            )}
          </div>

          {/* Right: role badge (sm) + language + theme + 2FA + logout */}
          <div className="flex items-center gap-2">

            {/* Role badge — visible on sm, hidden on md (eyebrow takes over) */}
            {user && (
              <span className="sm:inline-flex hidden items-center gap-1.5 text-[11px] font-semibold px-2.5 h-7 bg-secondary text-secondary-foreground rounded-md border border-border md:hidden">
                {t(`app.role.${user.role}`, user.role)}
              </span>
            )}

            {/* Language switcher */}
            <LanguageSwitcher />

            {/* Theme toggle */}
            <ThemeToggle />

            {/* 2FA / security link — mirrors #security-btn */}
            <Link
              to="/account/security"
              aria-label={t('app.security', 'Sicurezza account (2FA)')}
              title={t('app.security', 'Sicurezza account (2FA)')}
              className="text-sm font-medium hover:bg-accent hover:text-accent-foreground px-3 h-9 rounded-md transition-colors inline-flex items-center gap-1.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            >
              <Shield className="h-4 w-4" aria-hidden="true" />
              <span className="hidden sm:inline text-xs">2FA</span>
            </Link>

            {/* Logout button — mirrors #logout-btn */}
            <button
              type="button"
              aria-label={t('app.logout')}
              onClick={handleLogout}
              className="text-sm font-medium hover:bg-accent hover:text-accent-foreground px-3 h-9 rounded-md transition-colors inline-flex items-center gap-1.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            >
              {/* Power / logout icon (vanilla used a power-circle SVG) */}
              <svg
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                aria-hidden="true"
              >
                <path d="M18.36 6.64a9 9 0 1 1-12.73 0" />
                <line x1="12" y1="2" x2="12" y2="12" />
              </svg>
              <span>{t('app.logout')}</span>
            </button>
          </div>
        </div>
      </header>

      {/* ------------------------------------------------------------------ */}
      {/* MAIN — full-width container, canvas background, mirrors #app-root  */}
      {/* ------------------------------------------------------------------ */}
      <main
        id="main"
        tabIndex={-1}
        className="flex-1 w-full focus:outline-none bg-background"
      >
        <Outlet />
      </main>

      {/* ------------------------------------------------------------------ */}
      {/* FOOTER — mirrors <footer id="app-footer"> in index.html            */}
      {/* ------------------------------------------------------------------ */}
      <footer className="border-t border-border bg-background/50">
        <div className="w-full px-4 sm:px-6 h-11 text-[11px] font-mono uppercase tracking-wider text-muted-foreground flex items-center justify-between gap-4">
          <span>{t('app.footer.runtime', 'Gestimus · piattaforma concorsi musicali')}</span>
          <div className="flex items-center gap-4">
            <Link
              to="/privacy"
              className="hover:underline text-primary normal-case tracking-normal text-xs flex items-center gap-1.5"
            >
              {/* Shield-check icon — mirrors the vanilla footer privacy SVG */}
              <svg
                width="12"
                height="12"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
                aria-hidden="true"
              >
                <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
                <polyline points="9 12 11 14 15 10" />
              </svg>
              <span>Privacy / GDPR</span>
            </Link>
          </div>
        </div>
      </footer>

    </div>
  );
}
