-- Una alerta activa por condición: dos revisiones simultáneas no pueden duplicarla
CREATE UNIQUE INDEX "notifications_active_dedupe_key" ON "notifications" ("branch_id", "dedupe_key")
  WHERE "resolved_at" IS NULL AND "dedupe_key" IS NOT NULL;
