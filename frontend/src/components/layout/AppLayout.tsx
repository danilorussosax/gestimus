import { Link, Outlet, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { LogOut, Monitor, Moon, Sun } from 'lucide-react';
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
} from '@/i18n';

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
      <SelectTrigger className="h-9 w-[88px]" aria-label="Lingua">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {SUPPORTED_LANGUAGES.map((l) => (
          <SelectItem key={l} value={l}>
            {LANGUAGE_FLAGS[l]} {LANGUAGE_NAMES[l]}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

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

/** Shell autenticata: header (brand + ruolo + lingua + tema + logout) + Outlet. */
export function AppLayout() {
  const { user, logout } = useAuth();
  const { t } = useTranslation();
  const navigate = useNavigate();

  return (
    <div className="flex min-h-dvh flex-col bg-background text-foreground">
      <header className="sticky top-0 z-40 border-b border-border bg-background/80 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-7xl items-center gap-3 px-4">
          <Link to="/" className="flex items-center gap-2 font-semibold">
            <img src="/logo.png" alt="" className="h-7 w-7 rounded object-contain" />
            <span>{t('app.title')}</span>
          </Link>
          <div className="ml-auto flex items-center gap-2">
            {user && (
              <span className="hidden rounded-full bg-muted px-2.5 py-1 text-xs font-medium text-muted-foreground sm:inline">
                {t(`app.role.${user.role}`)}
              </span>
            )}
            <LanguageSwitcher />
            <ThemeToggle />
            <Button
              variant="ghost"
              size="icon"
              aria-label={t('app.logout')}
              onClick={() => {
                void logout().then(() => {
                  navigate('/login', { replace: true });
                });
              }}
            >
              <LogOut className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </header>

      <main id="main" className="mx-auto w-full max-w-7xl flex-1 px-4 py-6">
        <Outlet />
      </main>

      <footer className="border-t border-border py-4 text-center text-xs text-muted-foreground">
        {t('app.footer.runtime')}
      </footer>
    </div>
  );
}
