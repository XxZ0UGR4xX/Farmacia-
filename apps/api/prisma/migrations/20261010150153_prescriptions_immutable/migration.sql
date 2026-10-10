-- AlterTable
ALTER TABLE "prescriptions" ADD COLUMN     "void_reason" VARCHAR(255),
ADD COLUMN     "voided_by_id" UUID;

-- AddForeignKey
ALTER TABLE "prescriptions" ADD CONSTRAINT "prescriptions_voided_by_id_fkey" FOREIGN KEY ("voided_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Las recetas son un registro inmutable: sólo se pueden anular (deleted_at, voided_by_id, void_reason)
CREATE OR REPLACE FUNCTION prescriptions_guard() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Las recetas no se pueden borrar; anúlala con un motivo' USING ERRCODE = 'check_violation';
  END IF;
  IF (NEW.number, NEW.patient_id, NEW.doctor_name, NEW.doctor_license, NEW.issued_at, NEW.notes, NEW.created_by_id, NEW.created_at)
     IS DISTINCT FROM
     (OLD.number, OLD.patient_id, OLD.doctor_name, OLD.doctor_license, OLD.issued_at, OLD.notes, OLD.created_by_id, OLD.created_at) THEN
    RAISE EXCEPTION 'Una receta registrada no se puede modificar; anúlala y registra una nueva' USING ERRCODE = 'check_violation';
  END IF;
  IF OLD.deleted_at IS NOT NULL THEN
    RAISE EXCEPTION 'La receta ya está anulada' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER prescriptions_immutable
  BEFORE UPDATE OR DELETE ON "prescriptions"
  FOR EACH ROW EXECUTE FUNCTION prescriptions_guard();

-- Los medicamentos de una receta tampoco cambian ni se borran
CREATE TRIGGER prescription_items_immutable
  BEFORE UPDATE OR DELETE ON "prescription_items"
  FOR EACH ROW EXECUTE FUNCTION prevent_mutation();

ALTER TABLE "prescriptions"
  ADD CONSTRAINT "prescriptions_void_consistent" CHECK (("deleted_at" IS NULL) = ("void_reason" IS NULL));
