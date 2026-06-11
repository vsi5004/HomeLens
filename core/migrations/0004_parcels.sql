-- HomeLens NJ — Phase 8: locally-installed NJ parcel / MOD-IV dataset (brief §5.4, §11 Phase 8).
-- The per-property `parcel_results` table (the matched parcel for a saved home) already
-- exists from 0001. This adds the searchable parcel dataset a property is matched against
-- via point-in-polygon lookup. Each row keeps a bounding box (for a fast pre-filter) plus
-- the full geometry as GeoJSON and the mapped MOD-IV attributes. Geometry is expected in
-- WGS84 lon/lat (EPSG:4326) — the default for ArcGIS/NJGIN GeoJSON exports.

CREATE TABLE IF NOT EXISTS parcels (
  id TEXT PRIMARY KEY,
  source TEXT,
  municipality TEXT,
  county TEXT,
  block TEXT,
  lot TEXT,
  qualifier TEXT,
  property_class TEXT,
  address TEXT,
  land_assessment INTEGER,
  improvement_assessment INTEGER,
  total_assessment INTEGER,
  annual_taxes INTEGER,
  owner_name TEXT,
  min_lon REAL NOT NULL,
  min_lat REAL NOT NULL,
  max_lon REAL NOT NULL,
  max_lat REAL NOT NULL,
  geometry_json TEXT NOT NULL,
  imported_at TEXT NOT NULL
);

-- Bounding-box pre-filter index for point lookups, plus a block/lot lookup index.
CREATE INDEX IF NOT EXISTS idx_parcels_bbox ON parcels(min_lon, max_lon);
CREATE INDEX IF NOT EXISTS idx_parcels_blocklot ON parcels(block, lot);
