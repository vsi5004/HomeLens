-- HomeLens NJ — Phase 7: imported NJDOE school performance rows (brief §5.3, §11 Phase 7).
-- The `school_results` table (per-property nearby schools) already exists from 0001.
-- This adds a local store of imported NJDOE metric rows that a nearby school can be
-- manually matched to. Parsing/column-mapping lives in the TS frontend; this is a thin
-- local cache keyed by the NJDOE County-District-School (CDS) code when available.

CREATE TABLE IF NOT EXISTS njdoe_schools (
  id TEXT PRIMARY KEY,
  county_name TEXT,
  district_name TEXT,
  school_name TEXT NOT NULL,
  grade_span TEXT,
  enrollment INTEGER,
  metrics_json TEXT NOT NULL DEFAULT '{}',
  source TEXT,
  imported_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_njdoe_schools_name ON njdoe_schools(school_name);
