-- STEP 8: additive attachment context/metadata and managed signature files.
-- Existing attachment rows and legacy signatureUrl values are preserved.

CREATE TYPE "AttachmentOwnerType" AS ENUM (
    'REPORT',
    'SECTION',
    'SEALING_RECORD',
    'VERIFICATION'
);

ALTER TABLE "attachment"
    ADD COLUMN "ownerType" "AttachmentOwnerType",
    ADD COLUMN "sectionCode" VARCHAR(1),
    ADD COLUMN "compartmentId" UUID,
    ADD COLUMN "vesselSealingPointId" UUID,
    ADD COLUMN "caption" TEXT,
    ADD COLUMN "checksumSha256" VARCHAR(64),
    ADD COLUMN "updatedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

UPDATE "attachment"
SET "ownerType" = CASE
        WHEN "verificationId" IS NOT NULL THEN 'VERIFICATION'::"AttachmentOwnerType"
        WHEN "sealingRecordId" IS NOT NULL THEN 'SEALING_RECORD'::"AttachmentOwnerType"
        ELSE 'REPORT'::"AttachmentOwnerType"
    END,
    "caption" = "description";

ALTER TABLE "attachment"
    ALTER COLUMN "ownerType" SET NOT NULL,
    ALTER COLUMN "ownerType" SET DEFAULT 'REPORT';

ALTER TABLE "attachment"
    ADD CONSTRAINT "attachment_exactly_one_owner_check" CHECK (
        ("ownerType" IN ('REPORT', 'SECTION') AND "sealingReportId" IS NOT NULL AND "sealingRecordId" IS NULL AND "verificationId" IS NULL)
        OR
        ("ownerType" = 'SEALING_RECORD' AND "sealingReportId" IS NULL AND "sealingRecordId" IS NOT NULL AND "verificationId" IS NULL)
        OR
        ("ownerType" = 'VERIFICATION' AND "sealingReportId" IS NULL AND "sealingRecordId" IS NULL AND "verificationId" IS NOT NULL)
    ),
    ADD CONSTRAINT "attachment_section_code_check" CHECK (
        "sectionCode" IS NULL OR "sectionCode" IN ('A', 'B', 'C', 'D', 'E', 'F', 'G', 'H')
    ),
    ADD CONSTRAINT "attachment_section_owner_code_check" CHECK (
        "ownerType" <> 'SECTION' OR "sectionCode" IS NOT NULL
    );

CREATE INDEX "attachment_compartmentId_idx" ON "attachment"("compartmentId");
CREATE INDEX "attachment_vesselSealingPointId_idx" ON "attachment"("vesselSealingPointId");
CREATE INDEX "attachment_ownerType_idx" ON "attachment"("ownerType");
CREATE INDEX "attachment_sectionCode_idx" ON "attachment"("sectionCode");
CREATE INDEX "attachment_verificationId_sequence_idx" ON "attachment"("verificationId", "sequence");
CREATE INDEX "attachment_sealingReportId_sectionCode_sequence_idx" ON "attachment"("sealingReportId", "sectionCode", "sequence");

ALTER TABLE "attachment"
    ADD CONSTRAINT "attachment_compartmentId_fkey"
    FOREIGN KEY ("compartmentId") REFERENCES "m_compartment"("id")
    ON DELETE SET NULL ON UPDATE CASCADE,
    ADD CONSTRAINT "attachment_vesselSealingPointId_fkey"
    FOREIGN KEY ("vesselSealingPointId") REFERENCES "vessel_sealing_point"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "report_signature"
    ADD COLUMN "signatureFileName" VARCHAR(255),
    ADD COLUMN "signatureMimeType" VARCHAR(100),
    ADD COLUMN "signatureFileSize" BIGINT,
    ADD COLUMN "signatureChecksumSha256" VARCHAR(64);

CREATE INDEX "report_signature_sealingReportId_signedAt_idx"
    ON "report_signature"("sealingReportId", "signedAt");
