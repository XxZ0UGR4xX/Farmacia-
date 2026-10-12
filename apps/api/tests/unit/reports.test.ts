import { bucketsInRange, bucketStart, daysInRange, defaultGroupBy } from '@farmacia/shared';
import { inflateRawSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { todayISO } from '../../src/lib/dates';
import { buildXlsx } from '../../src/lib/xlsx';
import { rangeSchema } from '../../src/modules/reports/reports.schemas';

/** Lee las entradas de un ZIP (sólo lo necesario para revisar lo que generamos). */
function unzip(buf: Buffer): Map<string, string> {
  const out = new Map<string, string>();
  let offset = 0;
  while (buf.readUInt32LE(offset) === 0x04034b50) {
    const method = buf.readUInt16LE(offset + 8);
    const size = buf.readUInt32LE(offset + 18);
    const nameLength = buf.readUInt16LE(offset + 26);
    const extra = buf.readUInt16LE(offset + 28);
    const name = buf.subarray(offset + 30, offset + 30 + nameLength).toString('utf8');
    const start = offset + 30 + nameLength + extra;
    const data = buf.subarray(start, start + size);
    out.set(name, (method === 8 ? inflateRawSync(data) : data).toString('utf8'));
    offset = start + size;
  }
  return out;
}

describe('buildXlsx', () => {
  const book = unzip(
    buildXlsx([
      {
        name: 'Ventas: por día',
        columns: [{ header: 'Fecha', format: 'date' }, { header: 'Total', format: 'money' }, { header: 'Nota' }],
        rows: [
          ['2026-10-01', 1234.5, '=HYPERLINK("http://x")'],
          ['2026-10-02', null, 'Ñandú <&> "x"\u0001'],
        ],
      },
      { name: 'Ventas: por día', columns: [{ header: 'Vacía' }], rows: [] },
    ]),
  );

  it('incluye las partes de un libro de Excel', () => {
    expect([...book.keys()]).toEqual([
      '[Content_Types].xml',
      '_rels/.rels',
      'xl/workbook.xml',
      'xl/_rels/workbook.xml.rels',
      'xl/styles.xml',
      'xl/worksheets/sheet1.xml',
      'xl/worksheets/sheet2.xml',
    ]);
    // Nombres de hoja válidos y sin repetir
    expect(book.get('xl/workbook.xml')).toContain('name="Ventas  por día"');
    expect(book.get('xl/workbook.xml')).toContain('name="Ventas  por día 2"');
  });

  it('el texto nunca es fórmula y se escapa; las fechas son fechas', () => {
    const sheet = book.get('xl/worksheets/sheet1.xml')!;
    expect(sheet).not.toContain('<f>');
    expect(sheet).toContain('<t xml:space="preserve">=HYPERLINK(&quot;http://x&quot;)</t>');
    expect(sheet).toContain('Ñandú &lt;&amp;&gt; &quot;x&quot;</t>');
    expect(sheet).not.toContain('\u0001');
    // 2026-10-01 = serie 46296 de Excel
    expect(sheet).toContain('<c r="A2" s="6"><v>46296</v></c>');
    expect(sheet).toContain('<c r="B2" s="3"><v>1234.5</v></c>');
    // Celda vacía: no se escribe
    expect(sheet).not.toContain('r="B3"');
  });
});

describe('Periodos de los reportes', () => {
  it('agrupa por día, semana (lunes) y mes', () => {
    expect(bucketStart('2026-10-11', 'week')).toBe('2026-10-05'); // domingo → lunes anterior
    expect(bucketStart('2026-10-12', 'week')).toBe('2026-10-12');
    expect(bucketStart('2026-10-31', 'month')).toBe('2026-10-01');
    expect(bucketsInRange('2026-09-29', '2026-10-02', 'day')).toEqual(['2026-09-29', '2026-09-30', '2026-10-01', '2026-10-02']);
    expect(bucketsInRange('2026-10-01', '2026-10-20', 'week')).toEqual(['2026-09-28', '2026-10-05', '2026-10-12', '2026-10-19']);
    expect(bucketsInRange('2026-01-31', '2026-04-01', 'month')).toEqual(['2026-01-01', '2026-02-01', '2026-03-01', '2026-04-01']);
    expect(daysInRange('2026-10-01', '2026-10-01')).toBe(1);
    expect([defaultGroupBy(30), defaultGroupBy(90), defaultGroupBy(365)]).toEqual(['day', 'week', 'month']);
  });

  it('sin fechas: los últimos 30 días hasta hoy', () => {
    const r = rangeSchema.parse({});
    expect(r).toMatchObject({ to: todayISO(), days: 30, groupBy: 'day' });
    expect(rangeSchema.parse({ from: '2026-01-01', to: '2026-12-31' }).groupBy).toBe('month');
    expect(rangeSchema.safeParse({ from: '2026-10-02', to: '2026-10-01' }).success).toBe(false);
  });
});
