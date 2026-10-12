import { useLayoutEffect, useRef, useState } from 'react';

/** Paso "redondo" (1, 2, 2.5, 5 × 10^n) para que el eje tenga ~`ticks` divisiones legibles. */
export function niceScale(max: number, ticks = 4): { max: number; step: number; values: number[] } {
  if (!(max > 0)) return { max: 1, step: 1, values: [0, 1] };
  const raw = max / ticks;
  const magnitude = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * magnitude).find((s) => s >= raw) ?? 10 * magnitude;
  const top = Math.ceil(max / step) * step;
  const values: number[] = [];
  for (let v = 0; v <= top + step / 2; v += step) values.push(Math.round(v * 1e6) / 1e6);
  return { max: top, step, values };
}

const compact = new Intl.NumberFormat('es-MX', { notation: 'compact', maximumFractionDigits: 1 });

/** Etiquetas cortas para ejes: 1250 → "1.3 k", con "$" si es dinero. */
export function axisNumber(value: number, money = false): string {
  const text = Math.abs(value) < 1000 ? value.toLocaleString('es-MX', { maximumFractionDigits: 1 }) : compact.format(value);
  return money ? `$${text}` : text;
}

/** Ancho disponible del contenedor (se actualiza al cambiar el tamaño de la ventana). */
export function useElementWidth<T extends HTMLElement>(fallback = 640) {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(fallback);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => el.clientWidth > 0 && setWidth(el.clientWidth);
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  return [ref, width] as const;
}

/** Barra con el extremo de datos redondeado (4 px) y la base recta sobre el eje. */
export function columnPath(x: number, y: number, width: number, height: number, radius = 4): string {
  const r = Math.max(0, Math.min(radius, width / 2, height));
  const bottom = y + height;
  return `M${x},${bottom}V${y + r}Q${x},${y} ${x + r},${y}H${x + width - r}Q${x + width},${y} ${x + width},${y + r}V${bottom}Z`;
}
