-- STEP 4 Shipment/Voyage Sealing.
-- Columns are nullable at database level so reports created before this
-- migration remain readable. The canonical shipment/voyage API requires all
-- new business fields.

CREATE TABLE "plant_jetty_assignment" (
    "id" UUID NOT NULL,
    "plantId" UUID NOT NULL,
    "jettyId" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "plant_jetty_assignment_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "plant_jetty_assignment_plantId_jettyId_key"
    ON "plant_jetty_assignment"("plantId", "jettyId");
CREATE INDEX "plant_jetty_assignment_plantId_idx"
    ON "plant_jetty_assignment"("plantId");
CREATE INDEX "plant_jetty_assignment_jettyId_idx"
    ON "plant_jetty_assignment"("jettyId");

ALTER TABLE "plant_jetty_assignment"
    ADD CONSTRAINT "plant_jetty_assignment_plantId_fkey"
    FOREIGN KEY ("plantId") REFERENCES "m_plant"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "plant_jetty_assignment"
    ADD CONSTRAINT "plant_jetty_assignment_jettyId_fkey"
    FOREIGN KEY ("jettyId") REFERENCES "m_jetty"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

-- Legacy report fields remain available, but are no longer mandatory for a
-- canonical shipment. No old value is deleted or remapped.
ALTER TABLE "sealing_report"
    ALTER COLUMN "terminalId" DROP NOT NULL,
    ALTER COLUMN "operationType" DROP NOT NULL,
    ADD COLUMN "activityId" UUID,
    ADD COLUMN "voyageNumber" VARCHAR(50),
    ADD COLUMN "shipmentNumber" VARCHAR(50),
    ADD COLUMN "productId" UUID,
    ADD COLUMN "loadingPlantId" UUID,
    ADD COLUMN "loadingJettyId" UUID,
    ADD COLUMN "dischargePlantId" UUID,
    ADD COLUMN "dischargeJettyId" UUID,
    ADD COLUMN "sealingStatus" VARCHAR(50);

CREATE UNIQUE INDEX "sealing_report_shipmentNumber_key"
    ON "sealing_report"("shipmentNumber");
CREATE INDEX "sealing_report_activityId_idx" ON "sealing_report"("activityId");
CREATE INDEX "sealing_report_voyageNumber_idx" ON "sealing_report"("voyageNumber");
CREATE INDEX "sealing_report_productId_idx" ON "sealing_report"("productId");
CREATE INDEX "sealing_report_loadingPlantId_idx" ON "sealing_report"("loadingPlantId");
CREATE INDEX "sealing_report_loadingJettyId_idx" ON "sealing_report"("loadingJettyId");
CREATE INDEX "sealing_report_dischargePlantId_idx" ON "sealing_report"("dischargePlantId");
CREATE INDEX "sealing_report_dischargeJettyId_idx" ON "sealing_report"("dischargeJettyId");
CREATE INDEX "sealing_report_sealingStatus_idx" ON "sealing_report"("sealingStatus");

ALTER TABLE "sealing_report"
    ADD CONSTRAINT "sealing_report_activityId_fkey"
    FOREIGN KEY ("activityId") REFERENCES "m_activity"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "sealing_report"
    ADD CONSTRAINT "sealing_report_productId_fkey"
    FOREIGN KEY ("productId") REFERENCES "m_product"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "sealing_report"
    ADD CONSTRAINT "sealing_report_loadingPlantId_fkey"
    FOREIGN KEY ("loadingPlantId") REFERENCES "m_plant"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "sealing_report"
    ADD CONSTRAINT "sealing_report_loadingJettyId_fkey"
    FOREIGN KEY ("loadingJettyId") REFERENCES "m_jetty"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "sealing_report"
    ADD CONSTRAINT "sealing_report_dischargePlantId_fkey"
    FOREIGN KEY ("dischargePlantId") REFERENCES "m_plant"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "sealing_report"
    ADD CONSTRAINT "sealing_report_dischargeJettyId_fkey"
    FOREIGN KEY ("dischargeJettyId") REFERENCES "m_jetty"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

-- No assignment is backfilled: the source workbook contains no Plant-Jetty
-- pairing, so creating one automatically would fabricate master data.
