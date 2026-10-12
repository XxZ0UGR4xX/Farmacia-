import { clsx } from 'clsx';
import { useState, type ReactNode } from 'react';
import { axisNumber, columnPath, niceScale, useElementWidth } from './chart-utils';

export interface ColumnDatum {
  key: string;
  /** Etiqueta del eje horizontal */
  label: string;
  value: number;
  /** Título del tooltip (si no, la etiqueta) */
  title?: string;
  /** Renglones adicionales del tooltip */
  details?: { label: string; value: string }[];
}

const MARGIN = { top: 12, right: 8, bottom: 26, left: 52 };

/**
 * Gráfica de columnas de una sola serie (un color, sin leyenda: el título la nombra).
 * Columnas de máximo 24 px con el extremo redondeado, cuadrícula tenue y tooltip al pasar
 * el cursor (o tocar) sobre toda la franja de cada columna.
 */
export function ColumnChart({
  data,
  format,
  money = false,
  height = 220,
  label,
  highlightKey,
}: {
  data: ColumnDatum[];
  format: (value: number) => string;
  money?: boolean;
  height?: number;
  /** Descripción para lectores de pantalla */
  label: string;
  /** Columna a resaltar en la etiqueta del eje (p. ej. hoy) */
  highlightKey?: string;
}) {
  const [ref, width] = useElementWidth<HTMLDivElement>();
  const [active, setActive] = useState<number | null>(null);
  const plotW = Math.max(40, width - MARGIN.left - MARGIN.right);
  const plotH = height - MARGIN.top - MARGIN.bottom;
  const scale = niceScale(Math.max(0, ...data.map((d) => d.value)));
  const slot = plotW / Math.max(1, data.length);
  // Columnas delgadas: ≤ 24 px y al menos 2 px de separación
  const barW = Math.max(1, Math.min(24, slot * 0.72, slot - 2));
  const y = (v: number) => MARGIN.top + plotH - (v / scale.max) * plotH;
  // Etiquetas del eje sin encimarse
  const longest = Math.max(...data.map((d) => d.label.length), 1);
  const every = Math.max(1, Math.ceil((longest * 6.5 + 10) / slot));
  const current = active === null ? null : data[active];

  let tooltip: ReactNode = null;
  if (current && active !== null) {
    // Al lado de la columna (no encima) para no taparla
    const cx = MARGIN.left + slot * active + slot / 2;
    const onRight = cx < width / 2;
    tooltip = (
      <div
        role="status"
        className={clsx(
          'pointer-events-none absolute top-1 z-10 w-max max-w-[220px] rounded-lg bg-slate-900 px-3 py-2 text-xs text-white shadow-lg print:hidden',
          !onRight && '-translate-x-full',
        )}
        style={{ left: onRight ? cx + slot / 2 + 6 : cx - slot / 2 - 6 }}
      >
        <p className="font-medium">{current.title ?? current.label}</p>
        <p className="mt-0.5 flex items-center gap-1.5 tabular-nums">
          <span className="inline-block size-2 rounded-sm bg-chart-1" aria-hidden />
          {format(current.value)}
        </p>
        {current.details?.map((d) => (
          <p key={d.label} className="flex justify-between gap-3 tabular-nums text-slate-300">
            <span>{d.label}</span>
            <span>{d.value}</span>
          </p>
        ))}
      </div>
    );
  }

  return (
    <div ref={ref} className="relative w-full select-none" onPointerLeave={() => setActive(null)}>
      <svg width={width} height={height} role="img" aria-label={label} className="block overflow-visible">
        {/* Cuadrícula y eje vertical */}
        {scale.values.map((v) => (
          <g key={v}>
            <line
              x1={MARGIN.left}
              x2={MARGIN.left + plotW}
              y1={Math.round(y(v)) + 0.5}
              y2={Math.round(y(v)) + 0.5}
              className={v === 0 ? 'stroke-chart-axis' : 'stroke-chart-grid'}
              strokeWidth={1}
            />
            <text x={MARGIN.left - 8} y={y(v)} dy="0.32em" textAnchor="end" className="fill-slate-500 text-[11px] tabular-nums">
              {axisNumber(v, money)}
            </text>
          </g>
        ))}
        {data.map((d, i) => {
          const x = MARGIN.left + slot * i + (slot - barW) / 2;
          const h = Math.max(0, MARGIN.top + plotH - y(d.value));
          // Se cuenta desde el final: la última columna (el periodo más reciente) siempre lleva etiqueta
          const showLabel = (data.length - 1 - i) % every === 0;
          return (
            <g key={d.key}>
              {active === i && <rect x={MARGIN.left + slot * i} y={MARGIN.top} width={slot} height={plotH} className="fill-slate-100 print:hidden" />}
              {h > 0 && <path d={columnPath(x, y(d.value), barW, h)} className="fill-chart-1" />}
              {showLabel && (
                <text
                  x={MARGIN.left + slot * i + slot / 2}
                  y={height - 8}
                  textAnchor="middle"
                  className={d.key === highlightKey ? 'fill-slate-900 text-[11px] font-semibold' : 'fill-slate-500 text-[11px]'}
                >
                  {d.label}
                </text>
              )}
              {/* Zona de interacción: toda la franja, más grande que la columna */}
              <rect
                x={MARGIN.left + slot * i}
                y={MARGIN.top}
                width={slot}
                height={plotH}
                fill="transparent"
                data-testid="column-hit"
                onPointerEnter={() => setActive(i)}
                onPointerDown={() => setActive(i)}
              />
            </g>
          );
        })}
      </svg>
      {tooltip}
    </div>
  );
}
