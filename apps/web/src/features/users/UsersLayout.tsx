import { KeyRound, Users } from 'lucide-react';
import { Suspense } from 'react';
import { Outlet } from 'react-router';
import { PageLoader } from '../../components/ui/PageLoader';
import { PageHeader } from '../../components/ui/Card';
import { TabNav } from '../../components/ui/TabNav';

const tabs = [
  { to: '/usuarios', label: 'Usuarios', icon: Users, end: true },
  { to: '/usuarios/roles', label: 'Roles y permisos', icon: KeyRound },
];

export function UsersLayout() {
  return (
    <div>
      <PageHeader title="Usuarios y roles" description="Quién puede entrar al sistema y qué puede hacer cada quien." />
      <TabNav tabs={tabs} label="Secciones de usuarios" />
      {/* Las pestañas siguen visibles mientras llega el código de la subpágina */}
      <Suspense fallback={<PageLoader />}>
        <Outlet />
      </Suspense>
    </div>
  );
}
