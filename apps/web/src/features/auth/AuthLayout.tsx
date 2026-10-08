import { CalendarClock, PackageCheck, ShieldCheck } from 'lucide-react';
import type { ReactNode } from 'react';
import { BrandName, Logo } from '../../components/ui/Logo';

const highlights = [
  { icon: PackageCheck, text: 'Inventario por lotes con salida FEFO' },
  { icon: CalendarClock, text: 'Alertas de caducidad y stock bajo' },
  { icon: ShieldCheck, text: 'Trazabilidad completa y acceso por roles' },
];

/** Plantilla de las pantallas públicas: panel de marca + formulario. */
export function AuthLayout({ title, subtitle, children }: { title: string; subtitle?: string; children: ReactNode }) {
  return (
    <div className="flex min-h-dvh bg-white">
      <section className="relative hidden w-[44%] overflow-hidden bg-gradient-to-br from-brand-700 via-brand-600 to-accent-700 lg:flex lg:flex-col lg:justify-between lg:p-12">
        <div className="pointer-events-none absolute -right-24 -top-24 size-96 rounded-full bg-white/10" />
        <div className="pointer-events-none absolute -bottom-32 -left-16 size-[28rem] rounded-full bg-white/5" />

        <div className="relative flex items-center gap-3">
          <Logo className="size-11 drop-shadow" />
          <BrandName light />
        </div>

        <div className="relative max-w-md">
          <h2 className="text-3xl font-semibold leading-tight text-white">
            Tu farmacia, bajo control en todo momento.
          </h2>
          <p className="mt-3 text-white/80">
            Existencias, caducidades, compras y ventas en un solo lugar, con información clara para decidir rápido.
          </p>
          <ul className="mt-8 space-y-3">
            {highlights.map(({ icon: Icon, text }) => (
              <li key={text} className="flex items-center gap-3 text-sm text-white/90">
                <span className="flex size-8 items-center justify-center rounded-lg bg-white/15">
                  <Icon className="size-4" />
                </span>
                {text}
              </li>
            ))}
          </ul>
        </div>

        <p className="relative text-xs text-white/60">
          Herramienta administrativa. No sustituye el criterio médico profesional.
        </p>
      </section>

      <main className="flex flex-1 items-center justify-center px-4 py-10 sm:px-8">
        <div className="w-full max-w-sm">
          <div className="mb-8 flex items-center gap-3 lg:hidden">
            <Logo />
            <BrandName />
          </div>
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900">{title}</h1>
          {subtitle && <p className="mt-1.5 text-sm text-slate-500">{subtitle}</p>}
          <div className="mt-8">{children}</div>
        </div>
      </main>
    </div>
  );
}
