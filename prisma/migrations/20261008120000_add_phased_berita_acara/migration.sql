BEGIN;

CREATE TYPE "BeritaAcaraPhase" AS ENUM ('LOADING', 'UNLOADING');
CREATE TYPE "BeritaAcaraStatus" AS ENUM ('DRAFT', 'FINALIZED');

-- Data historis sengaja dibiarkan phase/baDocumentId NULL. Phase tidak dapat
-- disimpulkan secara aman hanya dari role atau status perjalanan.
ALTER TABLE "report_signature"
  ADD COLUMN "phase" "BeritaAcaraPhase",
  ADD COLUMN "baDocumentId" UUID;

CREATE TABLE "berita_acara_document" (
  "id" UUID NOT NULL,
  "sealingReportId" UUID NOT NULL,
  "phase" "BeritaAcaraPhase" NOT NULL,
  "status" "BeritaAcaraStatus" NOT NULL DEFAULT 'DRAFT',
  "snapshot" JSONB,
  "snapshotVersion" INTEGER NOT NULL DEFAULT 1,
  "finalizedById" UUID,
  "finalizedAt" TIMESTAMPTZ(3),
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "berita_acara_document_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "berita_acara_document_final_state_check" CHECK (
    ("status" = 'DRAFT' AND "snapshot" IS NULL AND "finalizedById" IS NULL AND "finalizedAt" IS NULL)
    OR
    ("status" = 'FINALIZED' AND "snapshot" IS NOT NULL AND "finalizedById" IS NOT NULL AND "finalizedAt" IS NOT NULL)
  )
);

CREATE TABLE "berita_acara_pdf_artifact" (
  "id" UUID NOT NULL,
  "baDocumentId" UUID NOT NULL,
  "generatedById" UUID NOT NULL,
  "fileName" VARCHAR(255) NOT NULL,
  "storageKey" TEXT NOT NULL,
  "mimeType" VARCHAR(100) NOT NULL DEFAULT 'application/pdf',
  "fileSize" BIGINT NOT NULL,
  "checksumSha256" VARCHAR(64) NOT NULL,
  "snapshotChecksumSha256" VARCHAR(64) NOT NULL,
  "rendererVersion" VARCHAR(50) NOT NULL,
  "metadata" JSONB,
  "generatedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "berita_acara_pdf_artifact_pkey" PRIMARY KEY ("id")
);

DROP INDEX "report_signature_sealingReportId_role_key";

-- Slot legacy tetap maksimal tiga dan tetap dipakai endpoint lama.
CREATE UNIQUE INDEX "report_signature_legacy_sealingReportId_role_key"
  ON "report_signature"("sealingReportId", "role")
  WHERE "phase" IS NULL;

-- Slot phase-aware maksimal tiga per phase (enam per shipment).
CREATE UNIQUE INDEX "report_signature_sealingReportId_phase_role_key"
  ON "report_signature"("sealingReportId", "phase", "role");
CREATE INDEX "report_signature_baDocumentId_idx" ON "report_signature"("baDocumentId");
CREATE INDEX "report_signature_sealingReportId_phase_idx" ON "report_signature"("sealingReportId", "phase");

ALTER TABLE "report_signature"
  ADD CONSTRAINT "report_signature_phase_document_check" CHECK (
    ("phase" IS NULL AND "baDocumentId" IS NULL)
    OR
    ("phase" IS NOT NULL AND "baDocumentId" IS NOT NULL)
  );

CREATE UNIQUE INDEX "berita_acara_document_sealingReportId_phase_key"
  ON "berita_acara_document"("sealingReportId", "phase");
CREATE UNIQUE INDEX "berita_acara_document_id_sealingReportId_phase_key"
  ON "berita_acara_document"("id", "sealingReportId", "phase");
CREATE INDEX "berita_acara_document_finalizedById_idx" ON "berita_acara_document"("finalizedById");
CREATE INDEX "berita_acara_document_status_idx" ON "berita_acara_document"("status");

CREATE UNIQUE INDEX "berita_acara_pdf_artifact_baDocumentId_key" ON "berita_acara_pdf_artifact"("baDocumentId");
CREATE UNIQUE INDEX "berita_acara_pdf_artifact_storageKey_key" ON "berita_acara_pdf_artifact"("storageKey");
CREATE INDEX "berita_acara_pdf_artifact_generatedById_idx" ON "berita_acara_pdf_artifact"("generatedById");
CREATE INDEX "berita_acara_pdf_artifact_checksumSha256_idx" ON "berita_acara_pdf_artifact"("checksumSha256");
CREATE INDEX "berita_acara_pdf_artifact_generatedAt_idx" ON "berita_acara_pdf_artifact"("generatedAt");

ALTER TABLE "berita_acara_document"
  ADD CONSTRAINT "berita_acara_document_sealingReportId_fkey"
    FOREIGN KEY ("sealingReportId") REFERENCES "sealing_report"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "berita_acara_document_finalizedById_fkey"
    FOREIGN KEY ("finalizedById") REFERENCES "m_user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Composite FK memastikan phase dan shipment signature selalu sama dengan
-- dokumen BA yang menjadi pemiliknya.
ALTER TABLE "report_signature"
  ADD CONSTRAINT "report_signature_baDocumentId_sealingReportId_phase_fkey"
    FOREIGN KEY ("baDocumentId", "sealingReportId", "phase")
    REFERENCES "berita_acara_document"("id", "sealingReportId", "phase")
    ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "berita_acara_pdf_artifact"
  ADD CONSTRAINT "berita_acara_pdf_artifact_baDocumentId_fkey"
    FOREIGN KEY ("baDocumentId") REFERENCES "berita_acara_document"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "berita_acara_pdf_artifact_generatedById_fkey"
    FOREIGN KEY ("generatedById") REFERENCES "m_user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

COMMIT;
