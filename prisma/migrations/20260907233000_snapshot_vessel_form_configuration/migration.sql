-- STEP 5: versioned vessel form profiles and immutable report snapshots.
-- All report/record columns are nullable to preserve legacy data, including
-- SYS-COMPARTMENT records.

CREATE TABLE "form_tko_version" (
    "id" UUID NOT NULL,
    "code" VARCHAR(50) NOT NULL,
    "name" VARCHAR(255) NOT NULL,
    "revision" VARCHAR(50),
    "description" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "form_tko_version_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "vessel_form_profile" (
    "id" UUID NOT NULL,
    "vesselId" UUID NOT NULL,
    "formVersionId" UUID NOT NULL,
    "name" VARCHAR(150),
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "activatedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "vessel_form_profile_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "vessel_form_section" (
    "id" UUID NOT NULL,
    "vesselFormProfileId" UUID NOT NULL,
    "categoryId" UUID NOT NULL,
    "isAvailable" BOOLEAN NOT NULL DEFAULT true,
    "sequence" INTEGER NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "vessel_form_section_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "form_tko_version_code_key" ON "form_tko_version"("code");
CREATE INDEX "form_tko_version_isActive_idx" ON "form_tko_version"("isActive");
CREATE UNIQUE INDEX "vessel_form_profile_vesselId_formVersionId_key"
    ON "vessel_form_profile"("vesselId", "formVersionId");
CREATE INDEX "vessel_form_profile_vesselId_isActive_idx"
    ON "vessel_form_profile"("vesselId", "isActive");
CREATE INDEX "vessel_form_profile_formVersionId_idx"
    ON "vessel_form_profile"("formVersionId");
CREATE UNIQUE INDEX "vessel_form_section_vesselFormProfileId_categoryId_key"
    ON "vessel_form_section"("vesselFormProfileId", "categoryId");
CREATE INDEX "vessel_form_section_vesselFormProfileId_isAvailable_idx"
    ON "vessel_form_section"("vesselFormProfileId", "isAvailable");
CREATE INDEX "vessel_form_section_categoryId_idx"
    ON "vessel_form_section"("categoryId");

ALTER TABLE "vessel_form_profile"
    ADD CONSTRAINT "vessel_form_profile_vesselId_fkey"
    FOREIGN KEY ("vesselId") REFERENCES "m_vessel"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "vessel_form_profile"
    ADD CONSTRAINT "vessel_form_profile_formVersionId_fkey"
    FOREIGN KEY ("formVersionId") REFERENCES "form_tko_version"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "vessel_form_section"
    ADD CONSTRAINT "vessel_form_section_vesselFormProfileId_fkey"
    FOREIGN KEY ("vesselFormProfileId") REFERENCES "vessel_form_profile"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "vessel_form_section"
    ADD CONSTRAINT "vessel_form_section_categoryId_fkey"
    FOREIGN KEY ("categoryId") REFERENCES "sealing_category"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "sealing_report"
    ADD COLUMN "formVersionId" UUID,
    ADD COLUMN "vesselFormProfileId" UUID,
    ADD COLUMN "formConfigurationSnapshot" JSONB,
    ADD COLUMN "formInitializedAt" TIMESTAMPTZ(3);

ALTER TABLE "sealing_record"
    ADD COLUMN "pointSnapshot" JSONB;

CREATE INDEX "sealing_report_formVersionId_idx" ON "sealing_report"("formVersionId");
CREATE INDEX "sealing_report_vesselFormProfileId_idx" ON "sealing_report"("vesselFormProfileId");
CREATE INDEX "sealing_report_formInitializedAt_idx" ON "sealing_report"("formInitializedAt");

ALTER TABLE "sealing_report"
    ADD CONSTRAINT "sealing_report_formVersionId_fkey"
    FOREIGN KEY ("formVersionId") REFERENCES "form_tko_version"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "sealing_report"
    ADD CONSTRAINT "sealing_report_vesselFormProfileId_fkey"
    FOREIGN KEY ("vesselFormProfileId") REFERENCES "vessel_form_profile"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

-- Version code comes directly from the primary source filename; the secondary
-- PDF revision is not promoted over the primary workbook.
INSERT INTO "form_tko_version" (
    "id", "code", "name", "revision", "description", "isActive", "createdAt", "updatedAt"
) VALUES (
    'f0000000-0000-4000-8000-000000000001',
    'FORM-SEGEL-TKO-EDIT1',
    'Form Segel Baru sesuai TKO (edit1)',
    'edit1',
    'Versi awal untuk snapshot konfigurasi berdasarkan sumber utama Form Segel Baru sesuai TKO (edit1).xlsx.',
    true,
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
) ON CONFLICT ("code") DO UPDATE SET
    "name" = EXCLUDED."name",
    "revision" = EXCLUDED."revision",
    "description" = EXCLUDED."description",
    "isActive" = true,
    "updatedAt" = CURRENT_TIMESTAMP;

-- Every existing vessel receives one profile for the active form version.
INSERT INTO "vessel_form_profile" (
    "id", "vesselId", "formVersionId", "name", "isActive", "activatedAt", "createdAt", "updatedAt"
)
SELECT
    md5('vessel-form-profile:' || v."id"::text || ':FORM-SEGEL-TKO-EDIT1')::uuid,
    v."id",
    fv."id",
    'Profil aktual ' || v."name",
    true,
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
FROM "m_vessel" v
JOIN "form_tko_version" fv ON fv."code" = 'FORM-SEGEL-TKO-EDIT1'
ON CONFLICT ("vesselId", "formVersionId") DO NOTHING;

-- Availability is derived only from actual active/AVAILABLE vessel points.
-- Sections without an available point remain unavailable; no point is created.
INSERT INTO "vessel_form_section" (
    "id", "vesselFormProfileId", "categoryId", "isAvailable", "sequence", "createdAt", "updatedAt"
)
SELECT
    md5('vessel-form-section:' || p."id"::text || ':' || c."id"::text)::uuid,
    p."id",
    c."id",
    EXISTS (
        SELECT 1
        FROM "vessel_sealing_point" vp
        JOIN "sealing_point_template" t ON t."id" = vp."sealingPointTemplateId"
        WHERE vp."vesselId" = p."vesselId"
          AND t."categoryId" = c."id"
          AND vp."isActive" = true
          AND vp."availability" = 'AVAILABLE'
          AND t."isActive" = true
          AND c."isActive" = true
    ),
    c."sequence",
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
FROM "vessel_form_profile" p
JOIN "form_tko_version" fv ON fv."id" = p."formVersionId"
JOIN "sealing_category" c ON c."code" IN ('A', 'B', 'C', 'D', 'E', 'F', 'G', 'H')
WHERE fv."code" = 'FORM-SEGEL-TKO-EDIT1'
ON CONFLICT ("vesselFormProfileId", "categoryId") DO UPDATE SET
    "isAvailable" = EXCLUDED."isAvailable",
    "sequence" = EXCLUDED."sequence",
    "updatedAt" = CURRENT_TIMESTAMP;
