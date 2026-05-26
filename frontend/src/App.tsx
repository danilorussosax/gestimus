import { lazy, Suspense } from 'react';
import { Route, Routes } from 'react-router-dom';
import { LoaderCircle } from 'lucide-react';
import { ProtectedRoute, PublicOnlyRoute, RequireAdmin } from '@/components/ProtectedRoute';
import { AppLayout } from '@/components/layout/AppLayout';
import type { ReactNode } from 'react';

// Eager: Home (landing autenticata) + NotFound (catch-all). Tutto il resto lazy.
import Home from '@/pages/Home';
import NotFound from '@/pages/NotFound';

const Login = lazy(() => import('@/pages/auth/Login'));
const AccountSecurity = lazy(() => import('@/pages/AccountSecurity'));
const Commissario = lazy(() => import('@/pages/Commissario'));
const Superadmin = lazy(() => import('@/pages/Superadmin'));

const AdminWorkspace = lazy(() => import('@/pages/admin/AdminWorkspace'));
const AdminDashboard = lazy(() => import('@/pages/admin/Dashboard'));
const AdminStatistiche = lazy(() => import('@/pages/admin/Statistiche'));
const AdminImpostazioni = lazy(() => import('@/pages/admin/Impostazioni'));
const AdminUtenti = lazy(() => import('@/pages/admin/Utenti'));
const AdminManuale = lazy(() => import('@/pages/admin/Manuale'));

const Iscrizione = lazy(() => import('@/pages/public/Iscrizione'));
const IscrizioneConferma = lazy(() => import('@/pages/public/IscrizioneConferma'));
const Privacy = lazy(() => import('@/pages/public/Privacy'));
const CalendarioPubblico = lazy(() => import('@/pages/public/CalendarioPubblico'));

function PageFallback() {
  return (
    <div className="flex min-h-[40vh] items-center justify-center text-muted-foreground">
      <LoaderCircle className="h-6 w-6 animate-spin" />
    </div>
  );
}

const adminPage = (node: ReactNode) => <RequireAdmin>{node}</RequireAdmin>;

export default function App() {
  return (
    <Suspense fallback={<PageFallback />}>
      <Routes>
        {/* Pagine pubbliche (no login) */}
        <Route path="/iscrizione" element={<Iscrizione />} />
        <Route path="/iscrizione/conferma" element={<IscrizioneConferma />} />
        <Route path="/privacy" element={<Privacy />} />
        <Route path="/calendario" element={<CalendarioPubblico />} />

        {/* Login pubblico-solo */}
        <Route element={<PublicOnlyRoute />}>
          <Route path="/login" element={<Login />} />
        </Route>

        {/* Rotte autenticate sotto la shell condivisa */}
        <Route element={<ProtectedRoute />}>
          <Route element={<AppLayout />}>
            <Route path="/" element={<Home />} />
            <Route path="/account/security" element={<AccountSecurity />} />
            <Route path="/commissario" element={<Commissario />} />

            {/* Admin (≥ admin) */}
            <Route path="/admin">
              <Route index element={adminPage(<AdminWorkspace />)} />
              <Route path="dashboard" element={adminPage(<AdminDashboard />)} />
              <Route path="statistiche" element={adminPage(<AdminStatistiche />)} />
              <Route path="impostazioni" element={adminPage(<AdminImpostazioni />)} />
              <Route path="utenti" element={adminPage(<AdminUtenti />)} />
              <Route path="manuale" element={adminPage(<AdminManuale />)} />
            </Route>

            {/* Super-admin */}
            <Route element={<ProtectedRoute minRole="superadmin" />}>
              <Route path="/superadmin" element={<Superadmin />} />
            </Route>
          </Route>
        </Route>

        <Route path="*" element={<NotFound />} />
      </Routes>
    </Suspense>
  );
}
