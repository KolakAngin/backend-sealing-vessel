-- STEP 6: form A-H input must never become SEALED merely because a record is
-- created without an explicit status. Existing rows are preserved unchanged.
ALTER TABLE "sealing_record"
    ALTER COLUMN "status" SET DEFAULT 'NOT_SEALED';
