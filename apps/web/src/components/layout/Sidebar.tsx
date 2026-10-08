import { clsx } from 'clsx';
import { ChevronDown, X } from 'lucide-react';
import { useState } from 'react';
import { NavLink, useLocation } from 'react-router';
import { useAuth } from '../../auth/useAuth';
import { BrandName, Logo } from '../ui/Logo';
import { filterNavigation, isSection, type NavItem, type NavSection } from './navigation';

function ItemLink({ item, nested, onNavigate }: { item: NavItem; nested?: boolean; onNavigate?: () => void }) {
  const Icon = item.icon;
  return (
    <NavLink
      to={item.to}
      end={item.to === '/'}
      onClick={onNavigate}
      className={({ isActive }) =>
        clsx(
          'group flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors',
          nested && 'pl-10',
          isActive
            ? 'bg-brand-50 text-brand-700'
            : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900',
        )
      }
    >
      {!nested && <Icon className="size-[18px] shrink-0" aria-hidden />}
      <span className="truncate">{item.label}</span>
    </NavLink>
  );
}

function Section({ section, onNavigate }: { section: NavSection; onNavigate?: () => void }) {
  const location = useLocation();
  const containsActive = section.items.some((i) => location.pathname.startsWith(i.to));
  const [open, setOpen] = useState(containsActive);
  const Icon = section.icon;
  const expanded = open || containsActive;

  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={expanded}
        className={clsx(
          'flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors',
          containsActive ? 'text-slate-900' : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900',
        )}
      >
        <Icon className="size-[18px] shrink-0" aria-hidden />
        <span className="flex-1 text-left">{section.label}</span>
        <ChevronDown className={clsx('size-4 text-slate-400 transition-transform', expanded && 'rotate-180')} />
      </button>
      {expanded && (
        <div className="mt-0.5 space-y-0.5">
          {section.items.map((item) => (
            <ItemLink key={item.to} item={item} nested onNavigate={onNavigate} />
          ))}
        </div>
      )}
    </div>
  );
}

export function SidebarContent({ onNavigate }: { onNavigate?: () => void }) {
  const { can } = useAuth();
  const entries = filterNavigation(can);
  return (
    <nav aria-label="Navegación principal" className="flex-1 space-y-1 overflow-y-auto px-3 py-4">
      {entries.map((entry) =>
        isSection(entry) ? (
          <Section key={entry.label} section={entry} onNavigate={onNavigate} />
        ) : (
          <ItemLink key={entry.to} item={entry} onNavigate={onNavigate} />
        ),
      )}
    </nav>
  );
}

/** Sidebar fijo en escritorio y cajón deslizable en tablet/celular. */
export function Sidebar({ mobileOpen, onClose }: { mobileOpen: boolean; onClose: () => void }) {
  return (
    <>
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-64 flex-col border-r border-slate-200 bg-white lg:flex">
        <div className="flex h-16 items-center gap-3 border-b border-slate-100 px-5">
          <Logo />
          <BrandName />
        </div>
        <SidebarContent />
      </aside>

      {mobileOpen && (
        <div className="fixed inset-0 z-40 lg:hidden" role="dialog" aria-modal="true" aria-label="Menú">
          <div className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm" onClick={onClose} />
          <aside className="absolute inset-y-0 left-0 flex w-72 max-w-[85vw] flex-col bg-white shadow-xl">
            <div className="flex h-16 items-center justify-between border-b border-slate-100 px-5">
              <div className="flex items-center gap-3">
                <Logo />
                <BrandName />
              </div>
              <button
                type="button"
                onClick={onClose}
                className="rounded-lg p-2 text-slate-500 hover:bg-slate-100"
                aria-label="Cerrar menú"
              >
                <X className="size-5" />
              </button>
            </div>
            <SidebarContent onNavigate={onClose} />
          </aside>
        </div>
      )}
    </>
  );
}
