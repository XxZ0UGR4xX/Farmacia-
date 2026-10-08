import type { Response } from 'express';

type Cell = string | number | null | undefined;

/**
 * CSV compatible con Excel (UTF-8 con BOM). Protege contra "inyección de fórmulas":
 * un texto que empieza con = + - @ se antepone con ' para que Excel no lo ejecute.
 * Los números se escriben tal cual.
 */
export function toCsv(headers: string[], rows: Cell[][]): string {
  const escape = (value: Cell): string => {
    if (value === null || value === undefined) return '';
    if (typeof value === 'number') return String(value);
    let s = value;
    if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return `﻿${[headers, ...rows].map((r) => r.map(escape).join(',')).join('\r\n')}\r\n`;
}

export function sendCsv(res: Response, filename: string, csv: string): void {
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${filename.replace(/[^\w.-]/g, '_')}"`);
  res.setHeader('Cache-Control', 'no-store');
  res.send(csv);
}
