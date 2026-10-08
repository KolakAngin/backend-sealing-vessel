-- Extend the existing vessel type enum without remapping legacy values.
ALTER TYPE "VesselType" ADD VALUE IF NOT EXISTS 'MT';
ALTER TYPE "VesselType" ADD VALUE IF NOT EXISTS 'OB';

CREATE TYPE "DrawingStatus" AS ENUM ('YES', 'NO');

-- New reference masters from sheet "acuan seed". Plant and Jetty intentionally
-- have no foreign key because the source workbook does not define a relation.
CREATE TABLE "m_plant" (
    "id" UUID NOT NULL,
    "code" VARCHAR(20) NOT NULL,
    "name" VARCHAR(150) NOT NULL,
    "sequence" INTEGER,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "m_plant_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "m_jetty" (
    "id" UUID NOT NULL,
    "name" VARCHAR(150) NOT NULL,
    "sequence" INTEGER,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "m_jetty_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "m_activity" (
    "id" UUID NOT NULL,
    "code" VARCHAR(50) NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "sequence" INTEGER,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "m_activity_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "m_product" (
    "id" UUID NOT NULL,
    "name" VARCHAR(150) NOT NULL,
    "sequence" INTEGER,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "m_product_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "m_unit_of_measure" (
    "id" UUID NOT NULL,
    "code" VARCHAR(20) NOT NULL,
    "sequence" INTEGER,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "m_unit_of_measure_pkey" PRIMARY KEY ("id")
);

-- All new vessel columns are nullable so existing vessel rows remain valid.
ALTER TABLE "m_vessel"
    ADD COLUMN "productGroup" VARCHAR(100),
    ADD COLUMN "deadweightTonnage" DECIMAL(18,3),
    ADD COLUMN "capacity" DECIMAL(18,3),
    ADD COLUMN "tankCount" INTEGER,
    ADD COLUMN "drawingStatus" "DrawingStatus",
    ADD COLUMN "drawingFileUrl" TEXT,
    ADD COLUMN "drawingLink" TEXT;

CREATE UNIQUE INDEX "m_plant_code_key" ON "m_plant"("code");
CREATE INDEX "m_plant_name_idx" ON "m_plant"("name");
CREATE INDEX "m_plant_sequence_idx" ON "m_plant"("sequence");
CREATE INDEX "m_plant_isActive_idx" ON "m_plant"("isActive");

CREATE UNIQUE INDEX "m_jetty_name_key" ON "m_jetty"("name");
CREATE INDEX "m_jetty_sequence_idx" ON "m_jetty"("sequence");
CREATE INDEX "m_jetty_isActive_idx" ON "m_jetty"("isActive");

CREATE UNIQUE INDEX "m_activity_code_key" ON "m_activity"("code");
CREATE INDEX "m_activity_name_idx" ON "m_activity"("name");
CREATE INDEX "m_activity_sequence_idx" ON "m_activity"("sequence");
CREATE INDEX "m_activity_isActive_idx" ON "m_activity"("isActive");

CREATE UNIQUE INDEX "m_product_name_key" ON "m_product"("name");
CREATE INDEX "m_product_sequence_idx" ON "m_product"("sequence");
CREATE INDEX "m_product_isActive_idx" ON "m_product"("isActive");

CREATE UNIQUE INDEX "m_unit_of_measure_code_key" ON "m_unit_of_measure"("code");
CREATE INDEX "m_unit_of_measure_sequence_idx" ON "m_unit_of_measure"("sequence");
CREATE INDEX "m_unit_of_measure_isActive_idx" ON "m_unit_of_measure"("isActive");

CREATE INDEX "m_vessel_vesselType_idx" ON "m_vessel"("vesselType");
CREATE INDEX "m_vessel_productGroup_idx" ON "m_vessel"("productGroup");
