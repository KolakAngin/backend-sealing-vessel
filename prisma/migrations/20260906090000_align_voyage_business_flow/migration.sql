-- Migrate roles without losing existing users.
ALTER TABLE "m_user" ALTER COLUMN "role" DROP DEFAULT;
ALTER TYPE "UserRole" RENAME TO "UserRole_old";
CREATE TYPE "UserRole" AS ENUM ('ADMIN', 'SUPERVISOR', 'LOADING_MASTER', 'UNLOADING_MASTER', 'VIEWER');
ALTER TABLE "m_user" ALTER COLUMN "role" TYPE "UserRole"
USING (
  CASE "role"::text
    WHEN 'OPERATOR' THEN 'LOADING_MASTER'
    ELSE "role"::text
  END
)::"UserRole";
DROP TYPE "UserRole_old";
ALTER TABLE "m_user" ALTER COLUMN "role" SET DEFAULT 'LOADING_MASTER';

-- Migrate the old approval workflow to the vessel journey workflow.
ALTER TABLE "sealing_report" ALTER COLUMN "status" DROP DEFAULT;
ALTER TYPE "ReportStatus" RENAME TO "ReportStatus_old";
CREATE TYPE "ReportStatus" AS ENUM ('DRAFT', 'BERLAYAR', 'SANDAR', 'FINISH');
ALTER TABLE "sealing_report" ALTER COLUMN "status" TYPE "ReportStatus"
USING (
  CASE "status"::text
    WHEN 'SUBMITTED' THEN 'BERLAYAR'
    WHEN 'VERIFIED' THEN 'SANDAR'
    WHEN 'APPROVED' THEN 'FINISH'
    WHEN 'REJECTED' THEN 'FINISH'
    ELSE 'DRAFT'
  END
)::"ReportStatus";
DROP TYPE "ReportStatus_old";
ALTER TABLE "sealing_report" ALTER COLUMN "status" SET DEFAULT 'DRAFT';

-- Preserve old audit values and add journey-specific actions.
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'DEPART';
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'ARRIVE';
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'FINISH';

-- Add journey destination, responsibility, and lifecycle timestamps.
ALTER TABLE "sealing_report"
  ADD COLUMN "destinationTerminalId" UUID,
  ADD COLUMN "unloadingMasterId" UUID,
  ADD COLUMN "departedAt" TIMESTAMPTZ(3),
  ADD COLUMN "arrivedAt" TIMESTAMPTZ(3),
  ADD COLUMN "finishedAt" TIMESTAMPTZ(3);

-- Backfill lifecycle timestamps for migrated historical reports.
UPDATE "sealing_report" SET "departedAt" = "updatedAt" WHERE "status" IN ('BERLAYAR', 'SANDAR', 'FINISH');
UPDATE "sealing_report" SET "arrivedAt" = "updatedAt" WHERE "status" IN ('SANDAR', 'FINISH');
UPDATE "sealing_report" SET "finishedAt" = "updatedAt" WHERE "status" = 'FINISH';

CREATE INDEX "sealing_report_destinationTerminalId_idx" ON "sealing_report"("destinationTerminalId");
CREATE INDEX "sealing_report_unloadingMasterId_idx" ON "sealing_report"("unloadingMasterId");

ALTER TABLE "sealing_report"
  ADD CONSTRAINT "sealing_report_destinationTerminalId_fkey"
  FOREIGN KEY ("destinationTerminalId") REFERENCES "m_terminal"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "sealing_report"
  ADD CONSTRAINT "sealing_report_unloadingMasterId_fkey"
  FOREIGN KEY ("unloadingMasterId") REFERENCES "m_user"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
