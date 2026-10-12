BEGIN;

-- Produk shipment sekarang merupakan relasi many-to-many. productId lama
-- tetap tersedia sebagai alias produk pertama agar data historis dan client
-- lama tetap dapat dibaca selama masa transisi.
CREATE TABLE "sealing_report_product" (
  "id" UUID NOT NULL,
  "sealingReportId" UUID NOT NULL,
  "productId" UUID NOT NULL,
  "sequence" INTEGER NOT NULL,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "sealing_report_product_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "sealing_report_product_sealingReportId_productId_key"
  ON "sealing_report_product"("sealingReportId", "productId");
CREATE UNIQUE INDEX "sealing_report_product_sealingReportId_sequence_key"
  ON "sealing_report_product"("sealingReportId", "sequence");
CREATE INDEX "sealing_report_product_productId_idx"
  ON "sealing_report_product"("productId");

ALTER TABLE "sealing_report_product"
  ADD CONSTRAINT "sealing_report_product_sealingReportId_fkey"
    FOREIGN KEY ("sealingReportId") REFERENCES "sealing_report"("id")
    ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "sealing_report_product_productId_fkey"
    FOREIGN KEY ("productId") REFERENCES "m_product"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

-- Setiap nilai produk tunggal yang dapat dibuktikan dari data lama menjadi
-- elemen pertama daftar produk canonical. Tidak ada produk historis yang
-- ditebak atau dibuang.
INSERT INTO "sealing_report_product" (
  "id", "sealingReportId", "productId", "sequence", "createdAt"
)
SELECT gen_random_uuid(), "id", "productId", 1, "createdAt"
FROM "sealing_report"
WHERE "productId" IS NOT NULL
ON CONFLICT ("sealingReportId", "productId") DO NOTHING;

COMMIT;
