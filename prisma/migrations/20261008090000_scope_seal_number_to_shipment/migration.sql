BEGIN;

-- Seal membutuhkan shipment scope langsung agar database dapat menegakkan
-- keunikan nomor tanpa melakukan join ke sealing_record.
ALTER TABLE "seal" ADD COLUMN "sealingReportId" UUID;

UPDATE "seal" AS s
SET "sealingReportId" = sr."sealingReportId"
FROM "sealing_record" AS sr
WHERE sr."id" = s."sealingRecordId";

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "seal" WHERE "sealingReportId" IS NULL) THEN
    RAISE EXCEPTION 'Seal legacy tanpa sealing report tidak dapat dimigrasikan';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM "seal"
    GROUP BY "sealingReportId", UPPER(BTRIM("sealNumber"))
    HAVING COUNT(*) > 1
  ) THEN
    RAISE EXCEPTION 'Nomor segel legacy duplikat dalam shipment yang sama setelah normalisasi';
  END IF;
END $$;

-- Constraint global harus dilepas sebelum normalisasi karena nomor yang sama
-- pada shipment berbeda sekarang merupakan data yang valid.
DROP INDEX "seal_sealNumber_key";

UPDATE "seal"
SET "sealNumber" = UPPER(BTRIM("sealNumber"));

ALTER TABLE "seal" ALTER COLUMN "sealingReportId" SET NOT NULL;

-- Target composite FK Prisma harus merupakan candidate key di parent.
CREATE UNIQUE INDEX "sealing_record_id_sealingReportId_key"
ON "sealing_record"("id", "sealingReportId");

ALTER TABLE "seal" DROP CONSTRAINT "seal_sealingRecordId_fkey";

ALTER TABLE "seal"
ADD CONSTRAINT "seal_sealingRecordId_sealingReportId_fkey"
FOREIGN KEY ("sealingRecordId", "sealingReportId")
REFERENCES "sealing_record"("id", "sealingReportId")
ON DELETE CASCADE ON UPDATE CASCADE;

CREATE UNIQUE INDEX "seal_sealingReportId_sealNumber_key"
ON "seal"("sealingReportId", "sealNumber");

CREATE INDEX "seal_sealingReportId_idx" ON "seal"("sealingReportId");

-- Menutup jalur tulis di luar API: nilai tersimpan harus sudah canonical.
ALTER TABLE "seal"
ADD CONSTRAINT "seal_sealNumber_normalized_check"
CHECK (
  LENGTH("sealNumber") > 0
  AND "sealNumber" = UPPER(BTRIM("sealNumber"))
);

COMMIT;
