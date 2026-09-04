/*
  Warnings:

  - You are about to drop the `User` table. If the table is not empty, all the data it contains will be lost.

*/
-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('ADMIN', 'SUPERVISOR', 'OPERATOR', 'VIEWER');

-- CreateEnum
CREATE TYPE "VesselType" AS ENUM ('TANKER', 'BARGE', 'SPOB', 'OTHER');

-- CreateEnum
CREATE TYPE "Side" AS ENUM ('PORT', 'STBD', 'CENTER');

-- CreateEnum
CREATE TYPE "AvailabilityStatus" AS ENUM ('AVAILABLE', 'NOT_AVAILABLE', 'INACTIVE');

-- CreateEnum
CREATE TYPE "OperationType" AS ENUM ('LOADING', 'DISCHARGING');

-- CreateEnum
CREATE TYPE "ReportStatus" AS ENUM ('DRAFT', 'SUBMITTED', 'VERIFIED', 'APPROVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "SealingRecordStatus" AS ENUM ('SEALED', 'NOT_SEALED', 'NOT_APPLICABLE');

-- CreateEnum
CREATE TYPE "SealStatus" AS ENUM ('INSTALLED', 'VERIFIED', 'BROKEN', 'REMOVED', 'REPLACED');

-- CreateEnum
CREATE TYPE "SealCondition" AS ENUM ('GOOD', 'DAMAGED', 'BROKEN', 'MISSING', 'OTHER');

-- CreateEnum
CREATE TYPE "AttachmentType" AS ENUM ('PHOTO', 'DOCUMENT', 'OTHER');

-- CreateEnum
CREATE TYPE "SignatureRole" AS ENUM ('CHIEF_OFFICER', 'TERMINAL_REPRESENTATIVE', 'SURVEYOR');

-- CreateEnum
CREATE TYPE "AuditAction" AS ENUM ('CREATE', 'UPDATE', 'DELETE', 'SUBMIT', 'VERIFY', 'APPROVE', 'REJECT', 'INSTALL_SEAL', 'REMOVE_SEAL', 'REPLACE_SEAL');

-- DropTable
DROP TABLE "User";

-- CreateTable
CREATE TABLE "m_user" (
    "id" UUID NOT NULL,
    "username" VARCHAR(50) NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "fullName" VARCHAR(100) NOT NULL,
    "email" VARCHAR(100),
    "role" "UserRole" NOT NULL DEFAULT 'OPERATOR',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "m_user_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "m_terminal" (
    "id" UUID NOT NULL,
    "code" VARCHAR(20) NOT NULL,
    "name" VARCHAR(150) NOT NULL,
    "address" TEXT,
    "city" VARCHAR(100),
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "m_terminal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "m_vessel" (
    "id" UUID NOT NULL,
    "name" VARCHAR(150) NOT NULL,
    "imoNumber" VARCHAR(20),
    "vesselType" "VesselType",
    "owner" VARCHAR(150),
    "flag" VARCHAR(100),
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "m_vessel_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "m_compartment" (
    "id" UUID NOT NULL,
    "vesselId" UUID NOT NULL,
    "code" VARCHAR(50) NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "side" "Side",
    "sequence" INTEGER,
    "description" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "m_compartment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sealing_category" (
    "id" UUID NOT NULL,
    "code" VARCHAR(5) NOT NULL,
    "name" VARCHAR(255) NOT NULL,
    "description" TEXT,
    "sequence" INTEGER NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "sealing_category_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sealing_point_template" (
    "id" UUID NOT NULL,
    "categoryId" UUID NOT NULL,
    "code" VARCHAR(20) NOT NULL,
    "name" VARCHAR(255) NOT NULL,
    "description" TEXT,
    "requiresCompartment" BOOLEAN NOT NULL DEFAULT false,
    "supportsSide" BOOLEAN NOT NULL DEFAULT false,
    "sequence" INTEGER NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "sealing_point_template_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vessel_sealing_point" (
    "id" UUID NOT NULL,
    "vesselId" UUID NOT NULL,
    "sealingPointTemplateId" UUID NOT NULL,
    "compartmentId" UUID,
    "code" VARCHAR(50) NOT NULL,
    "side" "Side",
    "locationName" VARCHAR(150),
    "instanceNo" INTEGER NOT NULL DEFAULT 1,
    "sequence" INTEGER,
    "availability" "AvailabilityStatus" NOT NULL DEFAULT 'AVAILABLE',
    "description" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "vessel_sealing_point_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sealing_report" (
    "id" UUID NOT NULL,
    "reportNo" VARCHAR(50) NOT NULL,
    "vesselId" UUID NOT NULL,
    "terminalId" UUID NOT NULL,
    "createdById" UUID NOT NULL,
    "cargo" VARCHAR(150),
    "operationType" "OperationType" NOT NULL,
    "reportDateTime" TIMESTAMPTZ(3) NOT NULL,
    "loadingMasterSurveyorName" VARCHAR(150),
    "portName" VARCHAR(150),
    "status" "ReportStatus" NOT NULL DEFAULT 'DRAFT',
    "remarks" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "sealing_report_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sealing_record" (
    "id" UUID NOT NULL,
    "sealingReportId" UUID NOT NULL,
    "vesselSealingPointId" UUID NOT NULL,
    "createdById" UUID NOT NULL,
    "status" "SealingRecordStatus" NOT NULL DEFAULT 'SEALED',
    "notes" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "sealing_record_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "seal" (
    "id" UUID NOT NULL,
    "sealingRecordId" UUID NOT NULL,
    "sealNumber" VARCHAR(100) NOT NULL,
    "status" "SealStatus" NOT NULL DEFAULT 'INSTALLED',
    "installedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "removedAt" TIMESTAMPTZ(3),
    "notes" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "seal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "seal_verification" (
    "id" UUID NOT NULL,
    "sealId" UUID NOT NULL,
    "verifiedById" UUID NOT NULL,
    "condition" "SealCondition" NOT NULL,
    "verifiedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "remarks" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "seal_verification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "attachment" (
    "id" UUID NOT NULL,
    "sealingReportId" UUID,
    "sealingRecordId" UUID,
    "verificationId" UUID,
    "uploadedById" UUID NOT NULL,
    "type" "AttachmentType" NOT NULL DEFAULT 'PHOTO',
    "fileName" VARCHAR(255) NOT NULL,
    "fileUrl" TEXT NOT NULL,
    "mimeType" VARCHAR(100) NOT NULL,
    "fileSize" BIGINT,
    "description" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "attachment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "report_signature" (
    "id" UUID NOT NULL,
    "sealingReportId" UUID NOT NULL,
    "userId" UUID,
    "role" "SignatureRole" NOT NULL,
    "name" VARCHAR(150) NOT NULL,
    "signatureUrl" TEXT,
    "signedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "report_signature_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_log" (
    "id" UUID NOT NULL,
    "userId" UUID,
    "action" "AuditAction" NOT NULL,
    "entityType" VARCHAR(50) NOT NULL,
    "entityId" UUID NOT NULL,
    "oldData" JSONB,
    "newData" JSONB,
    "ipAddress" VARCHAR(50),
    "userAgent" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_log_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "m_user_username_key" ON "m_user"("username");

-- CreateIndex
CREATE UNIQUE INDEX "m_user_email_key" ON "m_user"("email");

-- CreateIndex
CREATE INDEX "m_user_role_idx" ON "m_user"("role");

-- CreateIndex
CREATE INDEX "m_user_isActive_idx" ON "m_user"("isActive");

-- CreateIndex
CREATE UNIQUE INDEX "m_terminal_code_key" ON "m_terminal"("code");

-- CreateIndex
CREATE INDEX "m_terminal_name_idx" ON "m_terminal"("name");

-- CreateIndex
CREATE INDEX "m_terminal_isActive_idx" ON "m_terminal"("isActive");

-- CreateIndex
CREATE UNIQUE INDEX "m_vessel_imoNumber_key" ON "m_vessel"("imoNumber");

-- CreateIndex
CREATE INDEX "m_vessel_name_idx" ON "m_vessel"("name");

-- CreateIndex
CREATE INDEX "m_vessel_isActive_idx" ON "m_vessel"("isActive");

-- CreateIndex
CREATE INDEX "m_compartment_vesselId_idx" ON "m_compartment"("vesselId");

-- CreateIndex
CREATE INDEX "m_compartment_vesselId_sequence_idx" ON "m_compartment"("vesselId", "sequence");

-- CreateIndex
CREATE INDEX "m_compartment_side_idx" ON "m_compartment"("side");

-- CreateIndex
CREATE UNIQUE INDEX "m_compartment_vesselId_code_key" ON "m_compartment"("vesselId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "sealing_category_code_key" ON "sealing_category"("code");

-- CreateIndex
CREATE INDEX "sealing_category_sequence_idx" ON "sealing_category"("sequence");

-- CreateIndex
CREATE INDEX "sealing_category_isActive_idx" ON "sealing_category"("isActive");

-- CreateIndex
CREATE UNIQUE INDEX "sealing_point_template_code_key" ON "sealing_point_template"("code");

-- CreateIndex
CREATE INDEX "sealing_point_template_categoryId_idx" ON "sealing_point_template"("categoryId");

-- CreateIndex
CREATE INDEX "sealing_point_template_categoryId_sequence_idx" ON "sealing_point_template"("categoryId", "sequence");

-- CreateIndex
CREATE INDEX "sealing_point_template_isActive_idx" ON "sealing_point_template"("isActive");

-- CreateIndex
CREATE INDEX "vessel_sealing_point_vesselId_idx" ON "vessel_sealing_point"("vesselId");

-- CreateIndex
CREATE INDEX "vessel_sealing_point_sealingPointTemplateId_idx" ON "vessel_sealing_point"("sealingPointTemplateId");

-- CreateIndex
CREATE INDEX "vessel_sealing_point_compartmentId_idx" ON "vessel_sealing_point"("compartmentId");

-- CreateIndex
CREATE INDEX "vessel_sealing_point_side_idx" ON "vessel_sealing_point"("side");

-- CreateIndex
CREATE INDEX "vessel_sealing_point_vesselId_availability_idx" ON "vessel_sealing_point"("vesselId", "availability");

-- CreateIndex
CREATE INDEX "vessel_sealing_point_vesselId_sealingPointTemplateId_idx" ON "vessel_sealing_point"("vesselId", "sealingPointTemplateId");

-- CreateIndex
CREATE UNIQUE INDEX "vessel_sealing_point_vesselId_code_key" ON "vessel_sealing_point"("vesselId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "sealing_report_reportNo_key" ON "sealing_report"("reportNo");

-- CreateIndex
CREATE INDEX "sealing_report_vesselId_idx" ON "sealing_report"("vesselId");

-- CreateIndex
CREATE INDEX "sealing_report_terminalId_idx" ON "sealing_report"("terminalId");

-- CreateIndex
CREATE INDEX "sealing_report_createdById_idx" ON "sealing_report"("createdById");

-- CreateIndex
CREATE INDEX "sealing_report_reportDateTime_idx" ON "sealing_report"("reportDateTime");

-- CreateIndex
CREATE INDEX "sealing_report_status_idx" ON "sealing_report"("status");

-- CreateIndex
CREATE INDEX "sealing_report_vesselId_reportDateTime_idx" ON "sealing_report"("vesselId", "reportDateTime");

-- CreateIndex
CREATE INDEX "sealing_record_sealingReportId_idx" ON "sealing_record"("sealingReportId");

-- CreateIndex
CREATE INDEX "sealing_record_vesselSealingPointId_idx" ON "sealing_record"("vesselSealingPointId");

-- CreateIndex
CREATE INDEX "sealing_record_createdById_idx" ON "sealing_record"("createdById");

-- CreateIndex
CREATE INDEX "sealing_record_status_idx" ON "sealing_record"("status");

-- CreateIndex
CREATE UNIQUE INDEX "sealing_record_sealingReportId_vesselSealingPointId_key" ON "sealing_record"("sealingReportId", "vesselSealingPointId");

-- CreateIndex
CREATE UNIQUE INDEX "seal_sealNumber_key" ON "seal"("sealNumber");

-- CreateIndex
CREATE INDEX "seal_sealingRecordId_idx" ON "seal"("sealingRecordId");

-- CreateIndex
CREATE INDEX "seal_status_idx" ON "seal"("status");

-- CreateIndex
CREATE INDEX "seal_installedAt_idx" ON "seal"("installedAt");

-- CreateIndex
CREATE INDEX "seal_verification_sealId_idx" ON "seal_verification"("sealId");

-- CreateIndex
CREATE INDEX "seal_verification_verifiedById_idx" ON "seal_verification"("verifiedById");

-- CreateIndex
CREATE INDEX "seal_verification_verifiedAt_idx" ON "seal_verification"("verifiedAt");

-- CreateIndex
CREATE INDEX "seal_verification_condition_idx" ON "seal_verification"("condition");

-- CreateIndex
CREATE INDEX "attachment_sealingReportId_idx" ON "attachment"("sealingReportId");

-- CreateIndex
CREATE INDEX "attachment_sealingRecordId_idx" ON "attachment"("sealingRecordId");

-- CreateIndex
CREATE INDEX "attachment_verificationId_idx" ON "attachment"("verificationId");

-- CreateIndex
CREATE INDEX "attachment_uploadedById_idx" ON "attachment"("uploadedById");

-- CreateIndex
CREATE INDEX "attachment_type_idx" ON "attachment"("type");

-- CreateIndex
CREATE INDEX "report_signature_userId_idx" ON "report_signature"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "report_signature_sealingReportId_role_key" ON "report_signature"("sealingReportId", "role");

-- CreateIndex
CREATE INDEX "audit_log_userId_idx" ON "audit_log"("userId");

-- CreateIndex
CREATE INDEX "audit_log_entityType_entityId_idx" ON "audit_log"("entityType", "entityId");

-- CreateIndex
CREATE INDEX "audit_log_action_idx" ON "audit_log"("action");

-- CreateIndex
CREATE INDEX "audit_log_createdAt_idx" ON "audit_log"("createdAt");

-- AddForeignKey
ALTER TABLE "m_compartment" ADD CONSTRAINT "m_compartment_vesselId_fkey" FOREIGN KEY ("vesselId") REFERENCES "m_vessel"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sealing_point_template" ADD CONSTRAINT "sealing_point_template_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "sealing_category"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vessel_sealing_point" ADD CONSTRAINT "vessel_sealing_point_vesselId_fkey" FOREIGN KEY ("vesselId") REFERENCES "m_vessel"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vessel_sealing_point" ADD CONSTRAINT "vessel_sealing_point_sealingPointTemplateId_fkey" FOREIGN KEY ("sealingPointTemplateId") REFERENCES "sealing_point_template"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vessel_sealing_point" ADD CONSTRAINT "vessel_sealing_point_compartmentId_fkey" FOREIGN KEY ("compartmentId") REFERENCES "m_compartment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sealing_report" ADD CONSTRAINT "sealing_report_vesselId_fkey" FOREIGN KEY ("vesselId") REFERENCES "m_vessel"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sealing_report" ADD CONSTRAINT "sealing_report_terminalId_fkey" FOREIGN KEY ("terminalId") REFERENCES "m_terminal"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sealing_report" ADD CONSTRAINT "sealing_report_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "m_user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sealing_record" ADD CONSTRAINT "sealing_record_sealingReportId_fkey" FOREIGN KEY ("sealingReportId") REFERENCES "sealing_report"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sealing_record" ADD CONSTRAINT "sealing_record_vesselSealingPointId_fkey" FOREIGN KEY ("vesselSealingPointId") REFERENCES "vessel_sealing_point"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sealing_record" ADD CONSTRAINT "sealing_record_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "m_user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "seal" ADD CONSTRAINT "seal_sealingRecordId_fkey" FOREIGN KEY ("sealingRecordId") REFERENCES "sealing_record"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "seal_verification" ADD CONSTRAINT "seal_verification_sealId_fkey" FOREIGN KEY ("sealId") REFERENCES "seal"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "seal_verification" ADD CONSTRAINT "seal_verification_verifiedById_fkey" FOREIGN KEY ("verifiedById") REFERENCES "m_user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attachment" ADD CONSTRAINT "attachment_sealingReportId_fkey" FOREIGN KEY ("sealingReportId") REFERENCES "sealing_report"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attachment" ADD CONSTRAINT "attachment_sealingRecordId_fkey" FOREIGN KEY ("sealingRecordId") REFERENCES "sealing_record"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attachment" ADD CONSTRAINT "attachment_verificationId_fkey" FOREIGN KEY ("verificationId") REFERENCES "seal_verification"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attachment" ADD CONSTRAINT "attachment_uploadedById_fkey" FOREIGN KEY ("uploadedById") REFERENCES "m_user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "report_signature" ADD CONSTRAINT "report_signature_sealingReportId_fkey" FOREIGN KEY ("sealingReportId") REFERENCES "sealing_report"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "report_signature" ADD CONSTRAINT "report_signature_userId_fkey" FOREIGN KEY ("userId") REFERENCES "m_user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_userId_fkey" FOREIGN KEY ("userId") REFERENCES "m_user"("id") ON DELETE SET NULL ON UPDATE CASCADE;
