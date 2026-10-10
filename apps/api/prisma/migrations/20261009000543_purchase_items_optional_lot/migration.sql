-- AlterTable
ALTER TABLE "purchase_items" ALTER COLUMN "lot_number" DROP NOT NULL,
ALTER COLUMN "expires_at" DROP NOT NULL;

-- Una partida recibida (con lote asignado) siempre tiene número de lote y caducidad
ALTER TABLE "purchase_items"
  ADD CONSTRAINT "purchase_items_received_has_lot" CHECK ("batch_id" IS NULL OR ("lot_number" IS NOT NULL AND "expires_at" IS NOT NULL));

-- Nunca se paga más que el total de la compra
ALTER TABLE "purchases"
  ADD CONSTRAINT "purchases_paid_not_over_total" CHECK ("amount_paid" <= "total");
