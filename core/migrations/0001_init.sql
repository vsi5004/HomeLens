-- HomeLens NJ — initial schema (brief §7).
-- Applied by the Rust migration runner (db.rs). One file per schema version.

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS properties (
  id TEXT PRIMARY KEY,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'new',

  address_input TEXT NOT NULL,
  address_normalized TEXT,
  street TEXT,
  city TEXT,
  state TEXT,
  zip TEXT,
  county TEXT,
  latitude REAL,
  longitude REAL,

  listing_url TEXT,
  listing_source TEXT,
  list_price INTEGER,
  manual_estimated_value INTEGER,
  annual_taxes INTEGER,
  hoa_monthly INTEGER,
  beds REAL,
  baths REAL,
  sqft INTEGER,
  lot_size TEXT,
  year_built INTEGER,
  property_type TEXT,

  assigned_elementary_school TEXT,
  assigned_middle_school TEXT,
  assigned_high_school TEXT,

  subjective_score INTEGER,
  manual_school_score INTEGER,
  manual_property_value_score INTEGER,
  notes TEXT
);

CREATE TABLE IF NOT EXISTS route_results (
  id TEXT PRIMARY KEY,
  property_id TEXT NOT NULL,
  destination_key TEXT NOT NULL,
  destination_label TEXT NOT NULL,
  destination_address TEXT NOT NULL,
  mode TEXT NOT NULL DEFAULT 'driving',
  distance_meters INTEGER,
  duration_seconds INTEGER,
  provider TEXT NOT NULL,
  fetched_at TEXT NOT NULL,
  raw_json TEXT,
  FOREIGN KEY(property_id) REFERENCES properties(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS amenity_results (
  id TEXT PRIMARY KEY,
  property_id TEXT NOT NULL,
  category TEXT NOT NULL,
  name TEXT NOT NULL,
  address TEXT,
  latitude REAL,
  longitude REAL,
  distance_meters INTEGER,
  duration_seconds INTEGER,
  rating REAL,
  user_ratings_total INTEGER,
  provider TEXT NOT NULL,
  place_id TEXT,
  fetched_at TEXT NOT NULL,
  raw_json TEXT,
  FOREIGN KEY(property_id) REFERENCES properties(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS school_results (
  id TEXT PRIMARY KEY,
  property_id TEXT NOT NULL,
  name TEXT NOT NULL,
  district TEXT,
  grade_span TEXT,
  school_type TEXT,
  address TEXT,
  latitude REAL,
  longitude REAL,
  distance_meters INTEGER,
  source TEXT,
  matched_njdoe_id TEXT,
  metrics_json TEXT,
  fetched_at TEXT NOT NULL,
  FOREIGN KEY(property_id) REFERENCES properties(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS parcel_results (
  id TEXT PRIMARY KEY,
  property_id TEXT NOT NULL,
  source TEXT NOT NULL,
  municipality TEXT,
  county TEXT,
  block TEXT,
  lot TEXT,
  qualifier TEXT,
  property_class TEXT,
  land_assessment INTEGER,
  improvement_assessment INTEGER,
  total_assessment INTEGER,
  annual_taxes INTEGER,
  owner_name TEXT,
  raw_json TEXT,
  fetched_at TEXT NOT NULL,
  FOREIGN KEY(property_id) REFERENCES properties(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS external_links (
  id TEXT PRIMARY KEY,
  property_id TEXT NOT NULL,
  label TEXT NOT NULL,
  url TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY(property_id) REFERENCES properties(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_route_results_property ON route_results(property_id);
CREATE INDEX IF NOT EXISTS idx_amenity_results_property ON amenity_results(property_id);
CREATE INDEX IF NOT EXISTS idx_school_results_property ON school_results(property_id);
CREATE INDEX IF NOT EXISTS idx_parcel_results_property ON parcel_results(property_id);
CREATE INDEX IF NOT EXISTS idx_external_links_property ON external_links(property_id);
