-- AlterTable
ALTER TABLE "products" ADD COLUMN     "search_text" TEXT NOT NULL DEFAULT '';

-- CreateIndex
CREATE INDEX "products_search_text_trgm_idx" ON "products" USING GIN ("search_text" gin_trgm_ops);

-- El índice por expresión de la Fase 1 queda reemplazado por search_text (normalizado sin acentos)
DROP INDEX IF EXISTS "products_search_trgm_idx";

-- Folio interno automático de productos (SKU): MED-000001, MED-000002, ...
CREATE SEQUENCE IF NOT EXISTS "product_sku_seq" START 1;
