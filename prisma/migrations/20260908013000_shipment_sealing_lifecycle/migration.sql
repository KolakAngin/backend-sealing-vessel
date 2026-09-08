-- STEP 7: additive lifecycle state, explicit assignments, required points,
-- and immutable final snapshot. Existing source sealingStatus values and all
-- historical report/record rows are preserved.

CREATE TYPE "SealingProcessStatus" AS ENUM (
    'NOT_STARTED',
    'IN_PROGRESS',
    'READY',
    'IN_TRANSIT',
    'VERIFICATION',
    'FINALIZED'
);

ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'FINALIZE';

ALTER TABLE "vessel_sealing_point"
    ADD COLUMN "isRequired" BOOLEAN NOT NULL DEFAULT true;

ALTER TABLE "sealing_report"
    ADD COLUMN "loadingMasterId" UUID,
    ADD COLUMN "finalizedById" UUID,
    ADD COLUMN "sealingProcessStatus" "SealingProcessStatus" NOT NULL DEFAULT 'NOT_STARTED',
    ADD COLUMN "finalSnapshot" JSONB;

-- Preserve legacy ownership semantics only when the creator has a role that
-- is allowed to execute loading work. Admin-created drafts remain explicitly
-- unassigned until a Loading Master is selected.
UPDATE "sealing_report" report
SET "loadingMasterId" = report."createdById"
FROM "m_user" creator
WHERE creator."id" = report."createdById"
  AND creator."role"::text IN ('LOADING_MASTER', 'SUPERVISOR');

UPDATE "sealing_report"
SET "sealingProcessStatus" = CASE
    WHEN "status" = 'FINISH' THEN 'FINALIZED'::"SealingProcessStatus"
    WHEN "status" = 'SANDAR' THEN 'VERIFICATION'::"SealingProcessStatus"
    WHEN "status" = 'BERLAYAR' THEN 'IN_TRANSIT'::"SealingProcessStatus"
    WHEN "formConfigurationSnapshot" IS NOT NULL THEN 'IN_PROGRESS'::"SealingProcessStatus"
    ELSE 'NOT_STARTED'::"SealingProcessStatus"
END;

CREATE INDEX "vessel_sealing_point_vesselId_isRequired_idx"
    ON "vessel_sealing_point"("vesselId", "isRequired");
CREATE INDEX "sealing_report_loadingMasterId_idx" ON "sealing_report"("loadingMasterId");
CREATE INDEX "sealing_report_finalizedById_idx" ON "sealing_report"("finalizedById");
CREATE INDEX "sealing_report_sealingProcessStatus_idx" ON "sealing_report"("sealingProcessStatus");

ALTER TABLE "sealing_report"
    ADD CONSTRAINT "sealing_report_loadingMasterId_fkey"
    FOREIGN KEY ("loadingMasterId") REFERENCES "m_user"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "sealing_report"
    ADD CONSTRAINT "sealing_report_finalizedById_fkey"
    FOREIGN KEY ("finalizedById") REFERENCES "m_user"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;
