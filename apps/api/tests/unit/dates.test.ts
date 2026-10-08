import { adjustmentMovementType, classifyExpiry, daysBetween, REASONS_BY_DIRECTION } from '@farmacia/shared';
import { describe, expect, it } from 'vitest';
import { endOfDayExclusive, startOfDay, todayISO } from '../../src/lib/dates';
import { toCsv } from '../../src/shared/csv';

describe('fechas en la zona horaria de la farmacia', () => {
  it('"hoy" es la fecha local, no la de UTC', () => {
    // 3:00 UTC del día 9 = 21:00 del día 8 en Ciudad de México
    expect(todayISO(new Date('2026-10-09T03:00:00Z'), 'America/Mexico_City')).toBe('2026-10-08');
    expect(todayISO(new Date('2026-10-09T03:00:00Z'), 'UTC')).toBe('2026-10-09');
  });

  it('el día local empieza y termina en el instante correcto', () => {
    expect(startOfDay('2026-10-08', 'America/Mexico_City').toISOString()).toBe('2026-10-08T06:00:00.000Z');
    expect(endOfDayExclusive('2026-10-08', 'America/Mexico_City').toISOString()).toBe('2026-10-09T06:00:00.000Z');
  });

  it('cuenta días entre fechas', () => {
    expect(daysBetween('2026-10-08', '2026-11-07')).toBe(30);
    expect(daysBetween('2026-10-08', '2026-10-01')).toBe(-7);
  });
});

describe('clasificación de caducidad', () => {
  it('caducado, crítico (< 30), próximo (30–90) y normal (> 90)', () => {
    expect(classifyExpiry(-1)).toBe('EXPIRED');
    expect(classifyExpiry(0)).toBe('CRITICAL'); // caduca hoy: todavía se puede usar hoy
    expect(classifyExpiry(29)).toBe('CRITICAL');
    expect(classifyExpiry(30)).toBe('WARNING');
    expect(classifyExpiry(90)).toBe('WARNING');
    expect(classifyExpiry(91)).toBe('OK');
  });
});

describe('ajustes', () => {
  it('cada motivo genera el tipo de movimiento correcto', () => {
    expect(adjustmentMovementType('OUT', 'EXPIRED')).toBe('EXPIRED');
    expect(adjustmentMovementType('OUT', 'DAMAGED')).toBe('DAMAGED');
    expect(adjustmentMovementType('OUT', 'THEFT_LOSS')).toBe('SHRINKAGE');
    expect(adjustmentMovementType('OUT', 'INVENTORY_CORRECTION')).toBe('ADJUSTMENT_OUT');
    expect(adjustmentMovementType('IN', 'INVENTORY_CORRECTION')).toBe('ADJUSTMENT_IN');
  });

  it('una entrada no puede justificarse con "producto dañado"', () => {
    expect(REASONS_BY_DIRECTION.IN).not.toContain('DAMAGED');
    expect(REASONS_BY_DIRECTION.OUT).toContain('DAMAGED');
  });
});

describe('CSV', () => {
  it('escapa comillas y saltos de línea e incluye BOM para Excel', () => {
    const csv = toCsv(['A', 'B'], [['con "comillas"', 'línea\nnueva']]);
    expect(csv.startsWith('﻿A,B\r\n')).toBe(true);
    expect(csv).toContain('"con ""comillas""","línea\nnueva"');
  });

  it('neutraliza fórmulas (inyección CSV) pero no los números negativos', () => {
    const csv = toCsv(['Producto', 'Cambio'], [['=HYPERLINK("http://malo")', -5]]);
    expect(csv).toContain(`"'=HYPERLINK(""http://malo"")",-5`);
  });
});
