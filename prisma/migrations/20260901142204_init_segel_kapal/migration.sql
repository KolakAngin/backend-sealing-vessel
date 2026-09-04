-- AlterTable
ALTER TABLE "attachment" ADD COLUMN     "sequence" INTEGER;

-- AlterTable
ALTER TABLE "vessel_sealing_point" ADD COLUMN     "displayName" VARCHAR(255);

-- CreateIndex
CREATE INDEX "attachment_sealingReportId_sequence_idx" ON "attachment"("sealingReportId", "sequence");

-- CreateIndex
CREATE INDEX "attachment_sealingRecordId_sequence_idx" ON "attachment"("sealingRecordId", "sequence");
