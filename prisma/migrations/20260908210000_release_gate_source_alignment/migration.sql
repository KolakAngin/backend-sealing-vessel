-- STEP 11 release gate: align the active A-H master taxonomy with the primary
-- XLSX source. Legacy grouped templates remain active so existing vessel
-- configurations keep resolving; report snapshots are never rewritten.

UPDATE "sealing_point_template"
SET "name" = 'Tank Cleaning Access DOT/Deck Seal',
    "sequence" = 2,
    "updatedAt" = CURRENT_TIMESTAMP
WHERE "code" = 'A-02';

UPDATE "sealing_point_template"
SET "description" = 'Template legacy sebelum kolom gabungan A-02 diselaraskan dengan XLSX utama.',
    "sequence" = 99,
    "updatedAt" = CURRENT_TIMESTAMP
WHERE "code" = 'A-03';

UPDATE "sealing_point_template"
SET "sequence" = CASE "code"
    WHEN 'A-04' THEN 3
    WHEN 'A-05' THEN 4
    WHEN 'A-06' THEN 5
    ELSE "sequence"
END,
"updatedAt" = CURRENT_TIMESTAMP
WHERE "code" IN ('A-04', 'A-05', 'A-06');

UPDATE "sealing_point_template"
SET "description" = 'Template legacy generik; dipertahankan untuk konfigurasi dan laporan lama.',
    "sequence" = 99,
    "updatedAt" = CURRENT_TIMESTAMP
WHERE "code" = 'C-01';

INSERT INTO "sealing_point_template"
    ("id", "categoryId", "code", "name", "description", "requiresCompartment", "supportsSide", "sequence", "isActive", "createdAt", "updatedAt")
SELECT gen_random_uuid(), c."id", source."code", source."name", NULL, false, source."supportsSide", source."sequence", true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "sealing_category" c
CROSS JOIN (VALUES
    ('C-02', 'Fore Peak Tank', false, 1),
    ('C-03', 'After Peak Tank', false, 2),
    ('C-04', 'Water Ballast Tank (P)', true, 3),
    ('C-05', 'Water Ballast Tank (S)', true, 4)
) AS source("code", "name", "supportsSide", "sequence")
WHERE c."code" = 'C'
ON CONFLICT ("code") DO UPDATE SET
    "categoryId" = EXCLUDED."categoryId",
    "name" = EXCLUDED."name",
    "supportsSide" = EXCLUDED."supportsSide",
    "sequence" = EXCLUDED."sequence",
    "isActive" = true,
    "updatedAt" = CURRENT_TIMESTAMP;

UPDATE "sealing_point_template"
SET "description" = 'Template legacy berkelompok; dipertahankan untuk konfigurasi dan laporan lama.',
    "sequence" = 99,
    "updatedAt" = CURRENT_TIMESTAMP
WHERE "code" = 'D-01';

UPDATE "sealing_point_template"
SET "sequence" = 4,
    "updatedAt" = CURRENT_TIMESTAMP
WHERE "code" = 'D-02';

INSERT INTO "sealing_point_template"
    ("id", "categoryId", "code", "name", "description", "requiresCompartment", "supportsSide", "sequence", "isActive", "createdAt", "updatedAt")
SELECT gen_random_uuid(), c."id", source."code", source."name", NULL, false, false, source."sequence", true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "sealing_category" c
CROSS JOIN (VALUES
    ('D-03', 'Suction', 1),
    ('D-04', 'Stripping', 2),
    ('D-05', 'Dropline', 3),
    ('D-06', 'Gate & Drain Manifold', 5)
) AS source("code", "name", "sequence")
WHERE c."code" = 'D'
ON CONFLICT ("code") DO UPDATE SET
    "categoryId" = EXCLUDED."categoryId",
    "name" = EXCLUDED."name",
    "sequence" = EXCLUDED."sequence",
    "isActive" = true,
    "updatedAt" = CURRENT_TIMESTAMP;

UPDATE "sealing_point_template"
SET "name" = 'Pintu Pumproom',
    "updatedAt" = CURRENT_TIMESTAMP
WHERE "code" = 'H-03';
