-- Per-range cache for family drive-time isochrones so previously computed
-- ranges persist instead of being overwritten on each recompute.
CREATE TABLE IF NOT EXISTS isochrone_cache (
  destination_key TEXT NOT NULL,
  range_seconds INTEGER NOT NULL,
  provider TEXT NOT NULL,
  geojson TEXT NOT NULL,
  fetched_at TEXT NOT NULL,
  PRIMARY KEY (destination_key, range_seconds)
);
