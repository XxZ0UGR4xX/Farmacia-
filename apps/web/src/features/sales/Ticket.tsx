import { createPortal } from 'react-dom';
import type { Sale } from '../../api/sales';
import { formatDateTime, formatMoney } from '../../lib/format';
import { methodLabel } from './sales-display';

/** Ticket de venta para impresora térmica de 80 mm. */
export function Ticket({ sale }: { sale: Sale }) {
  const header = sale.header;
  const change = sale.payments.reduce((s, p) => s + (p.change ?? 0), 0);
  const gross = sale.items.reduce((s, i) => s + i.quantity * i.unitPrice, 0);
  return (
    <div className="font-mono text-[11px] leading-tight text-black" data-testid="ticket">
      <div className="text-center">
        <p className="text-sm font-bold">{header?.name ?? 'Farmacia'}</p>
        {header?.legalName && <p>{header.legalName}</p>}
        {header?.rfc && <p>RFC {header.rfc}</p>}
        <p>{sale.branch.name}</p>
        {(sale.branch.address ?? header?.address) && <p>{sale.branch.address ?? header?.address}</p>}
        {(sale.branch.phone ?? header?.phone) && <p>Tel. {sale.branch.phone ?? header?.phone}</p>}
      </div>
      <div className="my-2 border-t border-dashed border-black" />
      <p>Folio: {sale.folio}</p>
      <p>Fecha: {formatDateTime(sale.createdAt)}</p>
      <p>Atendió: {sale.createdBy.fullName}</p>
      {sale.status === 'CANCELLED' && <p className="font-bold">*** VENTA CANCELADA ***</p>}
      <div className="my-2 border-t border-dashed border-black" />
      {sale.items.map((i) => (
        <div key={i.id} className="mb-1">
          <p>{i.product.commercialName}</p>
          <div className="flex justify-between">
            <span>
              {i.quantity} x {formatMoney(i.unitPrice)}
            </span>
            <span>{formatMoney(i.quantity * i.unitPrice)}</span>
          </div>
          {i.discount > 0 && (
            <div className="flex justify-between">
              <span>  Descuento</span>
              <span>-{formatMoney(i.discount)}</span>
            </div>
          )}
        </div>
      ))}
      <div className="my-2 border-t border-dashed border-black" />
      {sale.discountTotal > 0 && (
        <>
          <Row label="Importe" value={formatMoney(gross)} />
          <Row label="Descuento" value={`-${formatMoney(sale.discountTotal)}`} />
        </>
      )}
      <Row label="Subtotal" value={formatMoney(sale.subtotal)} />
      <Row label="IVA" value={formatMoney(sale.taxTotal)} />
      <div className="flex justify-between text-sm font-bold">
        <span>TOTAL</span>
        <span>{formatMoney(sale.total)}</span>
      </div>
      <div className="my-2 border-t border-dashed border-black" />
      {sale.payments.map((p) => (
        <div key={p.id}>
          <Row label={methodLabel(p.method)} value={formatMoney(p.method === 'CASH' && p.received !== null ? p.received : p.amount)} />
        </div>
      ))}
      {change > 0 && <Row label="Cambio" value={formatMoney(change)} />}
      <div className="my-2 border-t border-dashed border-black" />
      <p className="text-center">Gracias por su compra</p>
      <p className="text-center">Conserve su ticket para cualquier aclaración</p>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between">
      <span>{label}</span>
      <span>{value}</span>
    </div>
  );
}

/** Imprime el ticket: lo monta fuera de la app y abre el diálogo de impresión del navegador. */
export function PrintableTicket({ sale }: { sale: Sale | null }) {
  if (!sale) return null;
  return createPortal(
    <div className="print-area pointer-events-none fixed -left-[9999px] top-0 w-[72mm] bg-white" aria-hidden>
      {/* Hoja de la impresora térmica, sólo mientras el ticket está montado */}
      <style>{'@media print { @page { size: 80mm auto; margin: 4mm; } }'}</style>
      <Ticket sale={sale} />
    </div>,
    document.body,
  );
}
