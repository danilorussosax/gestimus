import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { LoaderCircle } from 'lucide-react';
import type { ReactNode } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import type { Role } from '@/types';

const RANK: Record<Role, number> = { commissario: 1, admin: 2, superadmin: 3 };

function Spinner() {
  return (
    <div className="flex min-h-dvh items-center justify-center text-muted-foreground">
      <LoaderCircle className="h-6 w-6 animate-spin" />
    </div>
  );
}

interface Props {
  /** Ruolo minimo richiesto. Il guard usa il rank: superadmin ≥ admin ≥ commissario. */
  minRole?: Role;
}

/** Wrapper per le rotte autenticate. Reindirizza a /login se non loggato e a
 *  / (home) se il rank del ruolo è insufficiente — fonte di verità è /auth/me. */
export function ProtectedRoute({ minRole }: Props) {
  const { user, loading, isAuthenticated } = useAuth();
  const location = useLocation();

  if (loading) return <Spinner />;
  if (!isAuthenticated) return <Navigate to="/login" state={{ from: location }} replace />;
  if (minRole && user && RANK[user.role] < RANK[minRole]) {
    return <Navigate to="/" replace />;
  }
  return <Outlet context={{ user }} />;
}

/** Guard inline per sotto-alberi admin (≥ admin). */
export function RequireAdmin({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth();
  if (loading) return null;
  if (!user || RANK[user.role] < RANK.admin) return <Navigate to="/" replace />;
  return <>{children}</>;
}

/** Rotte pubbliche-solo (login): se già autenticato, redirige alla home giusta. */
export function PublicOnlyRoute() {
  const { loading, isAuthenticated, user } = useAuth();
  if (loading) return <Spinner />;
  if (isAuthenticated) {
    return <Navigate to={user?.role === 'superadmin' ? '/superadmin' : '/'} replace />;
  }
  return <Outlet />;
}
