import {
  AlertTriangle,
  CalendarX2,
  CircleDollarSign,
  Clock,
  type LucideIcon,
  PackageX,
  ShoppingBag,
  TrendingUp,
  Warehouse,
} from 'lucide-react';
import { Link } from 'react-router';
import { useAuth } from '../../auth/useAuth';
import { Alert } from '../../components/ui/Alert';
import { Card, CardHeader } from '../../components/ui/Card';
import { filterNavigation, isSection } from '../../components/layout/navigation';

interface Kpi {
  label: string;
  icon: LucideIcon;
  tone: string;
}

/** Indicadores planeados para el dashboard del propietario (se alimentan en la Fase 9). */
const KPIS: Kpi[] = [
  { label: 'Ventas de hoy', icon: CircleDollarSign, tone: 'bg-brand-50 text-brand-700' },
  { label: 'Productos vendidos', icon: ShoppingBag, tone: 'bg-accent-50 text-accent-700' },
  { label: 'Valor del inventario', icon: Warehouse, tone: 'bg-brand-50 text-brand-700' },
  { label: 'Utilidad estimada', icon: TrendingUp, tone: 'bg-accent-50 text-accent-700' },
  { label: 'Stock bajo', icon: AlertTriangle, tone: 'bg-amber-50 text-amber-700' },
  { label: 'Próximos a caducar', icon: Clock, tone: 'bg-yellow-50 text-yellow-700' },
  { label: 'Caducados', icon: CalendarX2, tone: 'bg-red-50 text-red-700' },
  { label: 'Agotados', icon: PackageX, tone: 'bg-red-50 text-red-700' },
];

const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

function greeting(date: Date): string {
  const h = date.getHours();
  if (h < 12) return 'Buenos días';
  if (h < 19) return 'Buenas tardes';
  return 'Buenas noches';
}

export function DashboardPage() {
  const { user, can } = useAuth();
  const now = new Date();
  const today = capitalize(
    now.toLocaleDateString('es-MX', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }),
  );
  // Se antepone la sección para distinguir accesos homónimos (Historial de ventas / de compras)
  const shortcuts = filterNavigation(can).flatMap((entry) =>
    isSection(entry)
      ? entry.items.map((item) => ({ ...item, label: `${entry.label} · ${item.label}` }))
      : entry.to === '/'
        ? []
        : [entry],
  );

  return (
    <div className="space-y-6">
      <div>
        <p className="text-sm text-slate-500">{today}</p>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight text-slate-900">
          {greeting(now)}, {user?.firstName}
        </h1>
        <p className="mt-1 text-slate-500">¿Cómo está tu farmacia hoy?</p>
      </div>

      <Alert tone="info" title="Sistema en construcción por fases">
        La base de datos, la autenticación y la seguridad ya están activas. Los indicadores se llenarán
        automáticamente conforme se habiliten los módulos de inventario, compras y ventas.
      </Alert>

      <div className="grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4">
        {KPIS.map(({ label, icon: Icon, tone }) => (
          <Card key={label} className="p-4 sm:p-5">
            <div className="flex items-start justify-between gap-2">
              <p className="text-xs font-medium text-slate-500 sm:text-sm">{label}</p>
              <span className={`flex size-8 shrink-0 items-center justify-center rounded-lg sm:size-9 ${tone}`}>
                <Icon className="size-4 sm:size-5" />
              </span>
            </div>
            <p className="mt-2 text-xl font-semibold text-slate-300 sm:mt-3 sm:text-2xl">—</p>
          </Card>
        ))}
      </div>

      <Card>
        <CardHeader title="Accesos rápidos" description="Módulos disponibles para tu rol." />
        <div className="grid gap-3 p-5 sm:grid-cols-2 lg:grid-cols-3">
          {shortcuts.map(({ to, label, icon: Icon, description }) => (
            <Link
              key={to}
              to={to}
              className="group flex gap-3 rounded-lg border border-slate-200 p-4 transition hover:border-brand-300 hover:bg-brand-50/40"
            >
              <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-slate-600 group-hover:bg-brand-100 group-hover:text-brand-700">
                <Icon className="size-5" />
              </span>
              <span>
                <span className="block text-sm font-medium text-slate-900">{label}</span>
                <span className="mt-0.5 line-clamp-2 block text-xs text-slate-500">{description}</span>
              </span>
            </Link>
          ))}
        </div>
      </Card>
    </div>
  );
}
