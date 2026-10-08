import { clsx } from 'clsx';
import { KeyRound, Users } from 'lucide-react';
import { NavLink, Outlet } from 'react-router';
import { PageHeader } from '../../components/ui/Card';

const tabs = [
  { to: '/usuarios', label: 'Usuarios', icon: Users, end: true },
  { to: '/usuarios/roles', label: 'Roles y permisos', icon: KeyRound, end: false },
];

export function UsersLayout() {
  return (
    <div>
      <PageHeader title="Usuarios y roles" description="Quién puede entrar al sistema y qué puede hacer cada quien." />
      <nav aria-label="Secciones de usuarios" className="mb-6 flex gap-1 border-b border-slate-200">
        {tabs.map(({ to, label, icon: Icon, end }) => (
          <NavLink
            key={to}
            to={to}
            end={end}
            className={({ isActive }) =>
              clsx(
                '-mb-px flex items-center gap-2 border-b-2 px-3 py-2.5 text-sm font-medium transition-colors',
                isActive
                  ? 'border-brand-600 text-brand-700'
                  : 'border-transparent text-slate-500 hover:border-slate-300 hover:text-slate-700',
              )
            }
          >
            <Icon className="size-4" />
            {label}
          </NavLink>
        ))}
      </nav>
      <Outlet />
    </div>
  );
}
