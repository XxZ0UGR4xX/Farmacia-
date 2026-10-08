import { clsx } from 'clsx';
import type { LucideIcon } from 'lucide-react';
import { NavLink } from 'react-router';

export interface TabItem {
  to: string;
  label: string;
  icon: LucideIcon;
  /** true: sólo activa en la ruta exacta (para la pestaña "raíz") */
  end?: boolean;
}

/** Pestañas de navegación dentro de un módulo (subrutas). */
export function TabNav({ tabs, label }: { tabs: TabItem[]; label: string }) {
  return (
    <nav aria-label={label} className="-mx-4 mb-6 flex gap-1 overflow-x-auto border-b border-slate-200 px-4 sm:mx-0 sm:px-0">
      {tabs.map(({ to, label: text, icon: Icon, end }) => (
        <NavLink
          key={to}
          to={to}
          end={end}
          className={({ isActive }) =>
            clsx(
              '-mb-px flex shrink-0 items-center gap-2 border-b-2 px-3 py-2.5 text-sm font-medium transition-colors',
              isActive
                ? 'border-brand-600 text-brand-700'
                : 'border-transparent text-slate-500 hover:border-slate-300 hover:text-slate-700',
            )
          }
        >
          <Icon className="size-4" />
          {text}
        </NavLink>
      ))}
    </nav>
  );
}
