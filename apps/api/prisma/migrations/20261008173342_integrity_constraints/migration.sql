-- =============================================================================
-- Reglas de integridad que Prisma no puede expresar en el esquema.
-- Son la última línea de defensa: aunque el código tuviera un error,
-- la base de datos rechaza estados inválidos.
-- =============================================================================

-- Regla 2: no permitir cantidades negativas -----------------------------------
ALTER TABLE "product_batches"
  ADD CONSTRAINT "product_batches_quantity_non_negative" CHECK ("quantity" >= 0),
  ADD CONSTRAINT "product_batches_initial_quantity_non_negative" CHECK ("initial_quantity" >= 0),
  ADD CONSTRAINT "product_batches_unit_cost_non_negative" CHECK ("unit_cost" >= 0),
  ADD CONSTRAINT "product_batches_dates_valid" CHECK ("manufactured_at" IS NULL OR "manufactured_at" <= "expires_at");

ALTER TABLE "inventory"
  ADD CONSTRAINT "inventory_min_stock_non_negative" CHECK ("min_stock" >= 0),
  ADD CONSTRAINT "inventory_max_stock_valid" CHECK ("max_stock" IS NULL OR "max_stock" >= "min_stock");

ALTER TABLE "products"
  ADD CONSTRAINT "products_prices_non_negative" CHECK ("purchase_price" >= 0 AND "sale_price" >= 0),
  ADD CONSTRAINT "products_tax_rate_valid" CHECK ("tax_rate" >= 0 AND "tax_rate" <= 1);

-- Movimientos: la aritmética siempre cuadra y nunca deja stock negativo -------
ALTER TABLE "inventory_movements"
  ADD CONSTRAINT "inventory_movements_quantity_math" CHECK ("quantity_after" = "quantity_before" + "quantity_change"),
  ADD CONSTRAINT "inventory_movements_after_non_negative" CHECK ("quantity_after" >= 0),
  ADD CONSTRAINT "inventory_movements_change_non_zero" CHECK ("quantity_change" <> 0);

-- Partidas con cantidades positivas -------------------------------------------
ALTER TABLE "purchase_items"
  ADD CONSTRAINT "purchase_items_quantity_positive" CHECK ("quantity" > 0),
  ADD CONSTRAINT "purchase_items_amounts_non_negative" CHECK ("unit_cost" >= 0 AND "discount" >= 0 AND "tax_amount" >= 0);

ALTER TABLE "sale_items"
  ADD CONSTRAINT "sale_items_quantity_positive" CHECK ("quantity" > 0),
  ADD CONSTRAINT "sale_items_returned_qty_valid" CHECK ("returned_qty" >= 0 AND "returned_qty" <= "quantity"),
  ADD CONSTRAINT "sale_items_amounts_non_negative" CHECK ("unit_price" >= 0 AND "discount" >= 0);

ALTER TABLE "sale_item_batches"
  ADD CONSTRAINT "sale_item_batches_quantity_positive" CHECK ("quantity" > 0);

ALTER TABLE "return_items"
  ADD CONSTRAINT "return_items_quantity_positive" CHECK ("quantity" > 0);

ALTER TABLE "sale_payments"
  ADD CONSTRAINT "sale_payments_amount_positive" CHECK ("amount" > 0);

ALTER TABLE "purchase_payments"
  ADD CONSTRAINT "purchase_payments_amount_positive" CHECK ("amount" > 0);

ALTER TABLE "sales"
  ADD CONSTRAINT "sales_totals_non_negative" CHECK ("subtotal" >= 0 AND "total" >= 0 AND "discount_total" >= 0);

ALTER TABLE "purchases"
  ADD CONSTRAINT "purchases_totals_non_negative" CHECK ("subtotal" >= 0 AND "total" >= 0 AND "amount_paid" >= 0);

ALTER TABLE "suppliers"
  ADD CONSTRAINT "suppliers_credit_days_non_negative" CHECK ("credit_days" >= 0);

-- Usuarios: correo siempre en minúsculas ---------------------------------------
ALTER TABLE "users"
  ADD CONSTRAINT "users_email_lowercase" CHECK ("email" = lower("email"));

-- Reglas 6 y 12: historial inmutable ------------------------------------------
CREATE OR REPLACE FUNCTION prevent_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'La tabla % es inmutable: no se permiten % ', TG_TABLE_NAME, TG_OP
    USING ERRCODE = 'insufficient_privilege';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER inventory_movements_immutable
  BEFORE UPDATE OR DELETE ON "inventory_movements"
  FOR EACH ROW EXECUTE FUNCTION prevent_mutation();

CREATE TRIGGER audit_logs_immutable
  BEFORE UPDATE OR DELETE ON "audit_logs"
  FOR EACH ROW EXECUTE FUNCTION prevent_mutation();

-- TRUNCATE también se bloquea (es una sentencia, no por fila)
CREATE TRIGGER inventory_movements_no_truncate
  BEFORE TRUNCATE ON "inventory_movements"
  FOR EACH STATEMENT EXECUTE FUNCTION prevent_mutation();

CREATE TRIGGER audit_logs_no_truncate
  BEFORE TRUNCATE ON "audit_logs"
  FOR EACH STATEMENT EXECUTE FUNCTION prevent_mutation();

-- Búsqueda rápida de productos sin distinguir mayúsculas/acentos --------------
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE INDEX IF NOT EXISTS "products_search_trgm_idx" ON "products"
  USING gin ((lower("commercial_name" || ' ' || coalesce("generic_name", '') || ' ' || coalesce("active_ingredient", ''))) gin_trgm_ops);
