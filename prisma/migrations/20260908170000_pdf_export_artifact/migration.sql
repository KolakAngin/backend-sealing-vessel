CREATE TABLE "pdf_artifact" (
    "id" UUID NOT NULL,
    "sealingReportId" UUID NOT NULL,
    "generatedById" UUID NOT NULL,
    "fileName" VARCHAR(255) NOT NULL,
    "storageKey" TEXT NOT NULL,
    "mimeType" VARCHAR(100) NOT NULL DEFAULT 'application/pdf',
    "fileSize" BIGINT NOT NULL,
    "checksumSha256" VARCHAR(64) NOT NULL,
    "templateChecksumSha256" VARCHAR(64) NOT NULL,
    "snapshotChecksumSha256" VARCHAR(64) NOT NULL,
    "rendererVersion" VARCHAR(50) NOT NULL,
    "formPageCount" INTEGER NOT NULL,
    "appendixPageCount" INTEGER NOT NULL,
    "pageCount" INTEGER NOT NULL,
    "generatedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pdf_artifact_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "pdf_artifact_sealingReportId_key" ON "pdf_artifact"("sealingReportId");
CREATE UNIQUE INDEX "pdf_artifact_storageKey_key" ON "pdf_artifact"("storageKey");
CREATE INDEX "pdf_artifact_generatedById_idx" ON "pdf_artifact"("generatedById");
CREATE INDEX "pdf_artifact_checksumSha256_idx" ON "pdf_artifact"("checksumSha256");
CREATE INDEX "pdf_artifact_generatedAt_idx" ON "pdf_artifact"("generatedAt");

ALTER TABLE "pdf_artifact" ADD CONSTRAINT "pdf_artifact_sealingReportId_fkey"
FOREIGN KEY ("sealingReportId") REFERENCES "sealing_report"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "pdf_artifact" ADD CONSTRAINT "pdf_artifact_generatedById_fkey"
FOREIGN KEY ("generatedById") REFERENCES "m_user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
