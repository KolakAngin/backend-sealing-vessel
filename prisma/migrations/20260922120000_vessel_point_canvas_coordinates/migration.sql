ALTER TABLE "vessel_sealing_point"
    ADD COLUMN "canvasX" DECIMAL(7,6),
    ADD COLUMN "canvasY" DECIMAL(7,6);

ALTER TABLE "vessel_sealing_point"
    ADD CONSTRAINT "vessel_sealing_point_canvas_pair_check"
    CHECK (
        ("canvasX" IS NULL AND "canvasY" IS NULL)
        OR (
            "canvasX" IS NOT NULL AND "canvasY" IS NOT NULL
            AND "canvasX" BETWEEN 0 AND 1
            AND "canvasY" BETWEEN 0 AND 1
        )
    );
