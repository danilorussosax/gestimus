import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { BarChart3, BookOpen, LayoutDashboard, Settings, Users } from 'lucide-react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { useActiveConcorso } from '@/api/concorsi';
import { ConcorsoSelector } from '@/components/admin/ConcorsoSelector';
import { FasiTab } from '@/components/admin/FasiTab';
import { CandidatiTab } from '@/components/admin/CandidatiTab';
import { IscrizioniTab } from '@/components/admin/IscrizioniTab';
import { RisultatiTab } from '@/components/admin/RisultatiTab';
import { CalendarioTab } from '@/components/admin/CalendarioTab';
import { AuditTab } from '@/components/admin/AuditTab';
import CommissariTab from '@/components/admin/CommissariTab';
import CommissioniTab from '@/components/admin/CommissioniTab';
import SezioniTab from '@/components/admin/SezioniTab';

const SECONDARY_NAV = [
  { to: '/admin/dashboard', icon: LayoutDashboard, label: 'admin.nav.dashboard', fallback: 'Dashboard' },
  { to: '/admin/statistiche', icon: BarChart3, label: 'admin.nav.statistiche', fallback: 'Statistiche' },
  { to: '/admin/impostazioni', icon: Settings, label: 'admin.nav.impostazioni', fallback: 'Impostazioni' },
  { to: '/admin/utenti', icon: Users, label: 'admin.nav.utenti', fallback: 'Utenti' },
  { to: '/admin/manuale', icon: BookOpen, label: 'admin.nav.manuale', fallback: 'Manuale' },
];

/** Workspace admin: selettore concorso + tab di gestione (fasi, sezioni,
 *  candidati, iscrizioni, commissari, commissioni, risultati, calendario,
 *  audit) + scorciatoie alle pagine dedicate (dashboard/stats/impostazioni…). */
export default function AdminWorkspace() {
  const { t } = useTranslation();
  const { activeId } = useActiveConcorso();

  const label = (key: string, fallback: string) => {
    const v = t(key);
    return v === key ? fallback : v;
  };

  return (
    <section className="space-y-5">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold text-foreground">
          {label('admin.title', 'Amministrazione')}
        </h1>
        <div className="flex flex-wrap items-center gap-2">
          {SECONDARY_NAV.map((n) => (
            <Button key={n.to} asChild variant="outline" size="sm">
              <Link to={n.to}>
                <n.icon className="mr-1.5 h-4 w-4" />
                {label(n.label, n.fallback)}
              </Link>
            </Button>
          ))}
        </div>
      </header>

      <ConcorsoSelector />

      {!activeId ? (
        <div className="rounded-xl border border-dashed border-border bg-muted/30 p-10 text-center text-muted-foreground">
          {label('admin.no_concorso', 'Seleziona un concorso per iniziare.')}
        </div>
      ) : (
        <Tabs defaultValue="fasi" className="w-full">
          <TabsList className="flex h-auto flex-wrap justify-start gap-1">
            <TabsTrigger value="fasi">{label('admin.tab.fasi', 'Fasi')}</TabsTrigger>
            <TabsTrigger value="sezioni">{label('admin.tab.sezioni', 'Sezioni')}</TabsTrigger>
            <TabsTrigger value="candidati">{label('admin.tab.candidati', 'Candidati')}</TabsTrigger>
            <TabsTrigger value="iscrizioni">{label('admin.tab.iscrizioni', 'Iscrizioni')}</TabsTrigger>
            <TabsTrigger value="commissari">{label('admin.tab.commissari', 'Commissari')}</TabsTrigger>
            <TabsTrigger value="commissioni">{label('admin.tab.commissioni', 'Commissioni')}</TabsTrigger>
            <TabsTrigger value="risultati">{label('admin.tab.risultati', 'Risultati')}</TabsTrigger>
            <TabsTrigger value="calendario">{label('admin.tab.calendario', 'Calendario')}</TabsTrigger>
            <TabsTrigger value="audit">{label('admin.tab.audit', 'Audit')}</TabsTrigger>
          </TabsList>

          <div className="mt-4">
            <TabsContent value="fasi"><FasiTab concorsoId={activeId} /></TabsContent>
            <TabsContent value="sezioni"><SezioniTab concorsoId={activeId} /></TabsContent>
            <TabsContent value="candidati"><CandidatiTab concorsoId={activeId} /></TabsContent>
            <TabsContent value="iscrizioni"><IscrizioniTab concorsoId={activeId} /></TabsContent>
            <TabsContent value="commissari"><CommissariTab concorsoId={activeId} /></TabsContent>
            <TabsContent value="commissioni"><CommissioniTab concorsoId={activeId} /></TabsContent>
            <TabsContent value="risultati"><RisultatiTab concorsoId={activeId} /></TabsContent>
            <TabsContent value="calendario"><CalendarioTab concorsoId={activeId} /></TabsContent>
            <TabsContent value="audit"><AuditTab concorsoId={activeId} /></TabsContent>
          </div>
        </Tabs>
      )}
    </section>
  );
}
