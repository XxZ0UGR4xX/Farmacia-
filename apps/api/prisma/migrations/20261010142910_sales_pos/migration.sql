-- AlterTable
ALTER TABLE "sales" ADD COLUMN     "client_request_id" VARCHAR(64),
ADD COLUMN     "prescription_checked" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "return_items" ADD COLUMN     "review_notes" VARCHAR(255),
ADD COLUMN     "reviewed_at" TIMESTAMPTZ(3),
ADD COLUMN     "reviewed_by_id" UUID;

-- CreateIndex
CREATE UNIQUE INDEX "sales_client_request_id_key" ON "sales"("client_request_id");

-- CreateIndex
CREATE INDEX "return_items_disposition_reviewed_at_idx" ON "return_items"("disposition", "reviewed_at");

-- AddForeignKey
ALTER TABLE "return_items" ADD CONSTRAINT "return_items_reviewed_by_id_fkey" FOREIGN KEY ("reviewed_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Integridad de ventas y devoluciones
ALTER TABLE "sales"
  ADD CONSTRAINT "sales_cost_non_negative" CHECK ("cost_total" >= 0),
  ADD CONSTRAINT "sales_total_math" CHECK ("total" = "subtotal" + "tax_total");

ALTER TABLE "sale_items"
  ADD CONSTRAINT "sale_items_total_math" CHECK ("total" = "subtotal" + "tax_amount");

ALTER TABLE "return_items"
  ADD CONSTRAINT "return_items_refund_non_negative" CHECK ("refund_amount" >= 0),
  -- Una partida revisada ya no puede quedar en cuarentena
  ADD CONSTRAINT "return_items_review_consistent" CHECK ("reviewed_at" IS NULL OR "disposition" <> 'QUARANTINE');

ALTER TABLE "returns"
  ADD CONSTRAINT "returns_refund_non_negative" CHECK ("refund_total" >= 0);
