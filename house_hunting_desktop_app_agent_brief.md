# House-Hunting Desktop App: Local Agent Development Brief

**Project name:** HomeLens NJ  
**Target user:** Personal-use house hunting around Hamilton, NJ and surrounding towns.  
**Primary goal:** Given a property address, produce a local, repeatable scorecard showing map/street context, travel times to family, nearby amenities, school data, property/tax context, and manually-entered listing notes.

This document is intended to be handed to a local coding agent such as Codex, Claude Code, Aider, or another repo-building agent. The agent should create a working desktop application, starting with a focused MVP and leaving clear extension points for richer datasets.

> **Revision note (2026-06-10):** Refined from the original AI-generated draft. Key
> changes: (1) locked the three open architecture decisions in new Section 2.1 — a
> two-key Google API boundary, a single `rusqlite` DB strategy, and on-demand (not
> auto) enrichment; (2) replaced the unstable percentile-based tax score with a fixed
> NJ effective-rate band (§6.5); (3) added a required cost-controls section (§17.1);
> (4) flagged that early "overall score" is mostly manual; (5) made manual NJDOE school
> matching the default; (6) corrected the Redfin link and split the env keys (§8, §13);
> (7) scoped statewide parcel import as a real project, not a casual upgrade (§5.4).

---

## 1. Product Summary

Build a desktop app where the user can enter a home address and receive a structured property report.

The app should:

1. Geocode the address.
2. Show a map and Street View / street-level preview when available.
3. Calculate driving time and distance to saved family addresses:
   - User's parents' house.
   - User's wife's parents' house.
4. Find nearby amenities:
   - Grocery stores.
   - Post offices.
   - Pharmacies.
   - Parks/playgrounds.
   - Train stations or major transit stops.
   - Libraries.
   - Daycare / preschool candidates, if API support is available.
5. Show local schools and eventually school-assignment data.
6. Show school metrics from NJ Department of Education datasets where feasible.
7. Pull or import NJ parcel / MOD-IV property tax assessment information where feasible.
8. Let the user store listing information manually:
   - Listing URL.
   - List price.
   - Estimated value fields, if manually entered.
   - Taxes.
   - HOA.
   - Bedrooms/bathrooms/square footage.
   - Notes.
   - Tour status.
   - Favorite / rejected / maybe state.
9. Provide a comparison dashboard across saved properties.
10. Export a property report as Markdown and/or CSV.

The app is for local personal use. Do not design it as a public real-estate data service.

---

## 2. Recommended Tech Stack

Use this stack unless there is a strong reason not to:

```text
Desktop shell: Tauri 2.x
Frontend: React + TypeScript + Vite
Local persistence: SQLite
DB access: thin Rust command layer over rusqlite (see 2.1)
Mapping UI: Google Maps JavaScript API in the webview (referrer-restricted key)
Billed API calls: Rust-side commands only, never from the frontend (see 2.1)
Config/secrets: local .env for development; app settings for runtime keys
Testing: Vitest for frontend logic, Playwright for UI smoke tests if useful
Formatting/linting: ESLint, Prettier, TypeScript strict mode
```

Rationale:

- Tauri is much lighter than Electron.
- The user is comfortable with Node/React-style projects.
- SQLite is ideal for a personal comparison database.
- Rust/Tauri gives good access to local file system and native desktop packaging.

### 2.1 Locked Architecture Decisions

These three decisions were intentionally left open in the original draft. Lock them
in before writing code, because they leak into nearly every module.

**Decision 1 — Two-key API boundary (most important).**

Split Google credentials into two distinct keys with different exposure models:

- **Maps JS key (browser-visible):** Used only by the Maps JavaScript API and Street
  View embeds rendered inside the Tauri webview. This key is necessarily present in
  frontend code; restrict it in Google Cloud Console to the appropriate APIs and
  application/referrer restrictions. Exposure here is normal and acceptable.
- **Web-service key (never exposed to JS):** Used for all *billed* server-style calls
  — Geocoding, Routes/Distance Matrix, and Places. These calls run exclusively in
  Rust via Tauri commands. The key is read from app config/`.env` on the Rust side
  and is never bundled into the frontend, never logged, and never returned to JS.

Rationale: web-service keys cannot be meaningfully referrer-restricted from a desktop
webview, so exposing them in frontend JS would leave billing wide open. Routing them
through Rust keeps them private and gives one place to enforce caching and budgets.

> **Why Rust/Tauri at all (vs. Python/Electron)?** Rust is not chosen for its own sake —
> it comes bundled with Tauri, which is chosen because it (a) gives the smallest path to a
> *private* web-service API key the user never sees, (b) produces a lightweight native
> installer (~10–20MB vs. Electron's 100MB+), and (c) packages cleanly across OSes. The
> actual backend workload is light (SQLite CRUD, a migration runner, and ~4 REST proxies),
> so keep the Rust layer deliberately thin: `rusqlite` for DB and blocking `reqwest` for
> HTTP, no async runtime, no business logic in Rust beyond what must touch the private key
> or the file system. All scoring, formatting, and view logic lives in the TypeScript
> frontend. If at any point the Rust layer starts accreting real domain logic, that is a
> signal to reconsider, not to push on.

**Decision 2 — One SQLite access strategy.**

Use a thin Rust command layer over `rusqlite` (bundled SQLite). Do **not** mix
`sqlx` and `tauri-plugin-sql`. Migrations are plain ordered `.sql` files applied by a
small Rust migration runner that tracks a `schema_version`. Rationale: at this scale
`rusqlite` is fully typed, synchronous (no async runtime overhead), needs no extra
plugin, and keeps all DB access on the same side as the private API key.

**Decision 3 — On-demand enrichment, not auto-fetch.**

Saving a property must **not** automatically fire geocode + routes + 7 Places
categories. Geocode on save (cheap, one call). All other billed enrichment
(routes, amenities) is triggered explicitly by the user per-card with a visible
"Fetch / Refresh" button, and is served from cache thereafter. See Section 17.1 for
the cost-control requirements this enables.

---

## 3. Non-Goals for MVP

Do **not** attempt all real-estate data automation in the first pass.

MVP should not require:

- A Zillow scraper.
- Login automation.
- CAPTCHA handling.
- Proxy rotation.
- Circumventing anti-bot systems.
- Perfect school attendance-zone resolution.
- Full county parcel import on day one.
- Perfect scoring methodology.

The first useful version should answer:

> “For this address, what does it look like, how far is it from family, what useful things are nearby, what schools are nearby, what are the basic listing notes, and how does it compare to other houses I saved?”

---

## 4. Important Terms-of-Service Guardrail

Zillow may be used as a manually opened external reference, but do not make Zillow scraping the core app behavior.

Implement the MVP with this safer workflow:

1. The user enters an address.
2. The app generates external search links for Zillow, Redfin, Realtor.com, Google, county records, and NJ parcel records.
3. The user opens those links manually.
4. The user manually pastes or types listing details into the app.
5. The app stores those manually-entered values locally.

Optional future module:

- A browser-assist module may open a Zillow search URL in the user's normal browser.
- Do not implement CAPTCHA bypassing, proxy rotation, login scraping, or anti-bot evasion.
- Do not store or redistribute Zillow photos, descriptions, or listing content.
- Keep the data model flexible enough to accept manually-entered listing history.

Relevant source:

- Zillow Terms of Use: https://www.zillow.com/corporate/terms-of-use/

---

## 5. External Data Sources

### 5.1 Maps, Geocoding, Street View, Routing, Places

Preferred MVP source: Google Maps Platform.

Useful APIs:

- Geocoding API or Places Autocomplete for address resolution.
- Maps JavaScript API for map display.
- Street View Static API or Street View panorama integration.
- Routes API or Distance Matrix equivalent for travel time to saved addresses.
- Places API for nearby amenities.

Important implementation notes:

- Cache geocode results locally by normalized address.
- Cache route calculations by origin/destination/mode/date bucket where reasonable.
- Cache place searches by property coordinate and place category.
- Use field masks for Places requests where supported to limit cost.
- Make API keys user-configurable.
- Do not hard-code assumptions about free tier; include a settings page with usage warnings.

Sources:

- Google Maps Platform pricing: https://developers.google.com/maps/billing-and-pricing/pricing
- Google Maps JavaScript API billing: https://developers.google.com/maps/documentation/javascript/usage-and-billing
- Google Places API billing: https://developers.google.com/maps/documentation/places/web-service/usage-and-billing

### 5.2 OpenStreetMap Alternative / Fallback

Potential later fallback:

- MapLibre for map rendering.
- OpenStreetMap-derived tiles.
- Nominatim for geocoding.
- Overpass API for amenities.
- OpenRouteService, GraphHopper, OSRM, or Valhalla for routing.

Guardrails:

- Respect public OSM/Nominatim usage limits.
- Cache aggressively.
- For repeated use, prefer a paid or self-hosted endpoint.

Source:

- Nominatim usage policy: https://operations.osmfoundation.org/policies/nominatim/

### 5.3 New Jersey School Data

Authoritative public source:

- NJ Department of Education School Performance Reports.

Use cases:

- Import downloadable school performance data.
- Match nearby schools by school name, district, municipality, or coordinates when available.
- Show metrics rather than a single opaque rating.

Suggested metrics:

- ELA proficiency.
- Math proficiency.
- Chronic absenteeism.
- Graduation rate for high schools.
- Student/teacher ratio, if available.
- Enrollment.
- District name.
- School grade span.

Sources:

- NJ School Performance Reports: https://www.nj.gov/education/spr/
- Downloadable data: https://www.nj.gov/education/spr/download/

School assignment caveat:

- “Nearby school” is not the same as “assigned school.”
- For Hamilton Township, check the district's official school finder / boundary resources.
- Store assigned schools as manually editable fields in MVP.

Example Hamilton Township school finder source:

- https://app.guidek12.com/hamiltontwpnj/school_search/current/

### 5.4 New Jersey Parcel / Property Tax / MOD-IV Data

Useful for:

- Block/lot.
- Municipality.
- Parcel geometry.
- Assessed land value.
- Assessed improvement value.
- Total assessed value.
- Property class.
- Owner/address fields where public.
- Tax data where present.

Sources:

- NJGIN parcels: https://nj.gov/njgin/edata/parcels/
- NJGIN ArcGIS open data item for Parcels and MOD-IV: https://njogis-newjersey.opendata.arcgis.com/documents/406cf6860390467d9f328ed19daa359d

Implementation phases:

1. MVP: store parcel/tax fields manually.
2. Phase 2: download Mercer County parcels/MOD-IV and perform spatial lookup locally.
3. Phase 3: import statewide parcel/MOD-IV data if performance/storage are acceptable.

> **Scope caveat:** Treat statewide import as a genuine project, not a casual upgrade.
> Mercer County is a few hundred thousand polygons and is comfortable in SQLite with an
> R-tree spatial index. Statewide NJ is millions of polygons (multi-GB) and needs a
> deliberate storage/index strategy and a preprocessing pipeline. Ship and validate the
> Mercer-only path (Phase 2) before considering statewide.

Spatial lookup approach:

- Geocode property to lat/lon.
- Transform to NJ State Plane or use a compatible spatial representation.
- Check which parcel polygon contains the point.
- Store matched parcel ID/block/lot and assessment fields.

Recommended libraries:

- Rust: geo, geojson, shapefile, proj if needed.
- Node-side preprocessing: ogr2ogr/GDAL, DuckDB spatial, or Python geopandas script.

---

## 6. App Features

### 6.1 Settings

Create a Settings page for:

- Google Maps API key.
- Optional Mapbox/OpenRouteService keys for future use.
- User's parents' address.
- User's wife's parents' address.
- Default search radius for amenities.
- Preferred commute mode: driving by default.
- Scoring weights.
- Data source status.

Store settings locally.

Sensitive settings:

- API keys and family addresses should not be committed to source control.
- Use `.env.example` but never commit `.env`.
- Consider simple local encryption later, but MVP can store in app config with a privacy warning.

### 6.2 Property Entry

Fields:

```text
id
created_at
updated_at
status: new | interested | touring | offer_candidate | rejected | archived
address_input
address_normalized
street
city
state
zip
county
latitude
longitude
listing_url
listing_source
list_price
manual_estimated_value
annual_taxes
hoa_monthly
beds
baths
sqft
lot_size
year_built
property_type
notes
favorite_score_manual
```

### 6.3 Property Report View

For a selected property, show:

1. Header:
   - Address.
   - Status.
   - Price.
   - Thumbnail/street preview.
2. Location panel:
   - Map.
   - Street View.
   - Coordinates.
3. Family travel panel:
   - Drive time to user's parents.
   - Drive time to wife's parents.
   - Distance to each.
   - Combined family-access score.
4. Amenity panel:
   - Nearest grocery.
   - Nearest post office.
   - Nearest pharmacy.
   - Nearest park/playground.
   - Nearest library.
   - Nearest train/transit stop.
5. School panel:
   - Nearby elementary/middle/high schools.
   - Manually assigned elementary/middle/high fields.
   - NJDOE metrics when matched.
6. Property/tax panel:
   - Assessment fields.
   - Taxes.
   - Parcel/block/lot.
   - Links to official records.
7. Links panel:
   - Zillow search.
   - Redfin search.
   - Realtor.com search.
   - Google search.
   - NJ parcel/tax links.
8. Notes panel.
9. Score panel.

### 6.4 Comparison Dashboard

Table columns:

```text
Address
Town
Status
List price
Taxes
Beds
Baths
Sqft
$/sqft
Drive to parents
Drive to wife's parents
Nearest grocery
Nearest post office
School score
Tax burden score
Overall score
Last updated
```

Features:

- Sort by any column.
- Filter by status.
- Filter by town.
- Hide rejected.
- Export CSV.
- Open full report.

### 6.5 Scoring

Make scoring transparent and editable.

> **Honesty caveat (read first):** In the MVP, `school_score` and `property_value_score`
> are *manually entered* 0–100 fields, and `subjective_score` is also manual. That means
> the Phase 6 "overall score" is mostly a weighted blend of hand-entered numbers, not
> computed analysis. This is fine and useful — but the UI must label it as such and not
> imply the early overall score is data-derived. Computed sub-scores arrive in later phases.

Default scoring model:

```text
overall_score =
  family_access_score * 0.20 +
  school_score * 0.25 +
  amenity_score * 0.15 +
  property_value_score * 0.15 +
  tax_score * 0.15 +
  subjective_score * 0.10
```

Each score should be 0-100.

Family access score:

```text
For each family destination:
- <= 15 min: 100
- 20 min: 85
- 30 min: 65
- 45 min: 35
- >= 60 min: 0
Interpolate linearly between breakpoints.
Average both destinations unless user changes weights.
```

Amenity score:

```text
For each category, score nearest travel time:
- <= 5 min: 100
- 10 min: 80
- 15 min: 60
- 25 min: 30
- > 25 min: 0
Average categories with user-configurable weights.
```

School score:

```text
MVP:
- Manual 0-100 field.

Phase 2:
- Composite of NJDOE metrics.
- Avoid pretending it is an official rating.
- Show underlying metrics next to the score.
```

Property value score:

```text
MVP:
- Manual 0-100 field.

Phase 2:
- Compare $/sqft against saved properties and town-level comps if available.
```

Tax score:

```text
Lower tax burden is better.

Use a FIXED reference band based on NJ effective tax rates so the score is
stable and meaningful from the very first property (do NOT percentile-rank a
tiny set of saved homes — with only a handful of high-tax NJ houses, percentile
ranking produces noisy scores that swing wildly as homes are added).

effective_rate = annual_taxes / list_price   (or / manual_estimated_value)

Score against a fixed band (tune to local reality):
- <= 1.5% : 100
- 2.0%    : 80
- 2.5%    : 55
- 3.0%    : 30
- >= 3.5% : 0
Interpolate linearly between breakpoints.

Optionally also SHOW (not score) the rank of this home's effective rate among
saved properties, as a secondary context number.
```

Subjective score:

```text
Manual user field for gut feel, layout, street feel, renovation burden, etc.
```

---

## 7. Data Model

Use SQLite migrations.

### 7.1 Tables

#### `settings`

```sql
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
```

#### `properties`

```sql
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
```

#### `route_results`

```sql
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
```

#### `amenity_results`

```sql
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
```

#### `school_results`

```sql
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
```

#### `parcel_results`

```sql
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
```

#### `external_links`

```sql
CREATE TABLE IF NOT EXISTS external_links (
  id TEXT PRIMARY KEY,
  property_id TEXT NOT NULL,
  label TEXT NOT NULL,
  url TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY(property_id) REFERENCES properties(id) ON DELETE CASCADE
);
```

---

## 8. External Link Generation

For each property, generate useful links but do not scrape them.

Examples:

```text
Google Maps search:
https://www.google.com/maps/search/?api=1&query=<encoded address>

Google search:
https://www.google.com/search?q=<encoded address>

Zillow search:
https://www.zillow.com/homes/<encoded address>_rb/

Redfin search:
https://www.redfin.com/stingray/do/location-autocomplete?location=<encoded address>
```

> **Note:** The Redfin `location-autocomplete` endpoint above is an internal JSON API,
> not a user-facing page — opening it in a browser yields raw JSON, not a search result.
> Prefer a human-usable search URL such as `https://www.redfin.com/city/<id>/<STATE>/<city>`
> or simply fall back to a Google query scoped to redfin.com. Verify all of these URL
> formats at implementation time; treat them as best-effort convenience links.

```text
Realtor search:
https://www.realtor.com/realestateandhomes-search/<encoded town state>
```

The agent should verify URL formats during implementation and treat these as best-effort convenience links.

---

## 9. UI Layout

### 9.1 Main Navigation

Left sidebar:

- Dashboard
- Add Property
- Map View
- Reports
- Settings
- Data Sources

### 9.2 Dashboard

Top:

- Add property button.
- Search/filter bar.
- Status filters.

Main:

- Saved properties table.
- Sortable score columns.

### 9.3 Add Property Flow

1. Address input.
2. Optional listing URL.
3. Optional list price.
4. Save.
5. App geocodes address.
6. App fetches map/street/route/amenity data.
7. Navigate to property report.

### 9.4 Property Report

Use a card layout:

- Hero card: address, price, status, overall score.
- Map/street card.
- Family drive card.
- Amenities card.
- Schools card.
- Tax/parcel card.
- Listing/manual notes card.
- External links card.

---

## 10. API Service Interfaces

Create service modules with interfaces so providers can be swapped later.

### 10.1 Geocoding

```ts
export interface GeocodeResult {
  normalizedAddress: string;
  street?: string;
  city?: string;
  state?: string;
  zip?: string;
  county?: string;
  latitude: number;
  longitude: number;
  provider: string;
  raw: unknown;
}

export interface GeocodingProvider {
  geocode(address: string): Promise<GeocodeResult>;
}
```

### 10.2 Routing

```ts
export interface RouteResult {
  distanceMeters: number;
  durationSeconds: number;
  provider: string;
  raw: unknown;
}

export interface RoutingProvider {
  route(origin: { lat: number; lon: number }, destinationAddress: string): Promise<RouteResult>;
}
```

### 10.3 Places

```ts
export type AmenityCategory =
  | 'grocery'
  | 'post_office'
  | 'pharmacy'
  | 'park'
  | 'library'
  | 'train_station'
  | 'daycare'
  | 'school';

export interface AmenityResult {
  category: AmenityCategory;
  name: string;
  address?: string;
  latitude?: number;
  longitude?: number;
  distanceMeters?: number;
  durationSeconds?: number;
  rating?: number;
  userRatingsTotal?: number;
  provider: string;
  placeId?: string;
  raw: unknown;
}

export interface PlacesProvider {
  findNearest(origin: { lat: number; lon: number }, category: AmenityCategory): Promise<AmenityResult[]>;
}
```

### 10.4 Schools

```ts
export interface SchoolResult {
  name: string;
  district?: string;
  gradeSpan?: string;
  schoolType?: string;
  address?: string;
  latitude?: number;
  longitude?: number;
  distanceMeters?: number;
  source: string;
  matchedNjdoeId?: string;
  metrics?: Record<string, unknown>;
}

export interface SchoolProvider {
  findNearbySchools(origin: { lat: number; lon: number }): Promise<SchoolResult[]>;
}
```

### 10.5 Parcel

```ts
export interface ParcelResult {
  source: string;
  municipality?: string;
  county?: string;
  block?: string;
  lot?: string;
  qualifier?: string;
  propertyClass?: string;
  landAssessment?: number;
  improvementAssessment?: number;
  totalAssessment?: number;
  annualTaxes?: number;
  ownerName?: string;
  raw?: unknown;
}

export interface ParcelProvider {
  lookupByPoint(point: { lat: number; lon: number }): Promise<ParcelResult | null>;
}
```

---

## 11. Implementation Phases

### Phase 0: Repo Setup

Deliverables:

- Tauri + React + TypeScript project.
- SQLite setup.
- Migration runner.
- Basic routing between pages.
- Basic settings page.
- `.env.example`.
- README with setup instructions.

Acceptance criteria:

- `npm install` works.
- `npm run dev` launches desktop app.
- App can create/open local SQLite DB.
- Settings can be saved and loaded.

### Phase 1: Property CRUD + Geocoding

Deliverables:

- Add property form.
- Property list dashboard.
- Property detail page.
- Google geocoding provider.
- Store normalized address and coordinates.

Acceptance criteria:

- User can add a property by address.
- App geocodes and stores coordinates.
- App displays saved properties after restart.

### Phase 2: Map + Street View

Deliverables:

- Map card on property page.
- Street View card or link.
- External map links.

Acceptance criteria:

- Property page shows a map centered on property.
- Street-level preview or external Street View link is available.

### Phase 3: Family Driving Distances

Deliverables:

- Settings for two family addresses.
- Routing provider.
- Route results table.
- Family drive card.

Acceptance criteria:

- App calculates and stores drive time/distance to both family destinations.
- Cached results load on subsequent app open.
- User can refresh route results manually.

### Phase 4: Nearby Amenities

Deliverables:

- Places provider.
- Amenity categories.
- Nearest amenity card.
- Store amenity results.

Acceptance criteria:

- App finds nearest grocery store and post office at minimum.
- App stores results locally.
- User can refresh amenity results manually.

### Phase 5: Manual Listing Data + External Links

Deliverables:

- Listing fields on property detail page.
- External link generator.
- Notes editor.

Acceptance criteria:

- User can paste Zillow/Redfin/Realtor URL.
- User can manually enter price/taxes/HOA/beds/baths/sqft/year built.
- External links open in default browser.

### Phase 6: Scoring + Comparison

Deliverables:

- Score calculation module.
- Editable scoring weights.
- Comparison dashboard.
- CSV export.

Acceptance criteria:

- Every property has an overall score.
- Dashboard can sort by score, price, taxes, and drive time.
- CSV export works.

### Phase 7: NJDOE School Data Import

Deliverables:

- Import downloaded NJDOE school performance spreadsheet or CSV.
- Store school metric rows locally.
- Nearby school matching by Places/Google plus manual matching to NJDOE records.
- School metrics display.

> **Matching reality:** Treat *manual* match-to-NJDOE as the default path, not the
> fallback. Auto-matching Google Places school names to NJDOE rows is fuzzy and
> error-prone (charter schools, "No. 5" vs "Number 5" vs "School 5", district name
> variants). Provide a simple manual picker to bind a nearby school to an NJDOE record,
> and only use auto-match as a best-effort pre-fill that the user confirms.

Acceptance criteria:

- User can import NJDOE data file.
- Property page shows nearby schools.
- User can manually mark assigned elementary/middle/high school.
- Matched school metrics appear where available.

### Phase 8: NJ Parcel / MOD-IV Import

Deliverables:

- Documented process for downloading Mercer County or statewide parcel/MOD-IV data.
- Preprocessing script if needed.
- Local parcel lookup by point.
- Parcel/tax assessment display.

Acceptance criteria:

- Given a geocoded property, app can match a parcel when local parcel data is installed.
- Assessment fields display in property report.
- User can manually override parcel fields.

---

## 12. Suggested File Structure

```text
home-lens-nj/
  README.md
  package.json
  .env.example
  src/
    app/
      App.tsx
      routes.tsx
    components/
      PropertyTable.tsx
      PropertyReport.tsx
      MapCard.tsx
      StreetViewCard.tsx
      AmenityCard.tsx
      FamilyDriveCard.tsx
      SchoolCard.tsx
      ParcelCard.tsx
      ScoreCard.tsx
    pages/
      DashboardPage.tsx
      AddPropertyPage.tsx
      PropertyPage.tsx
      SettingsPage.tsx
      DataSourcesPage.tsx
    services/
      geocoding/
        types.ts
        googleGeocodingProvider.ts
      routing/
        types.ts
        googleRoutingProvider.ts
      places/
        types.ts
        googlePlacesProvider.ts
      schools/
        types.ts
        njdoeImport.ts
        schoolMatching.ts
      parcels/
        types.ts
        parcelLookup.ts
      scoring/
        scoring.ts
      links/
        externalLinks.ts
    db/
      schema.sql
      migrations/
      db.ts
    types/
      property.ts
  src-tauri/
    src/
      main.rs
      commands.rs
      db.rs
    tauri.conf.json
  scripts/
    import-njdoe.ts
    preprocess-parcels/README.md
```

---

## 13. Environment Variables

Create `.env.example`:

```env
# Browser-visible key: Maps JavaScript API + Street View embeds ONLY.
# Restrict in Google Cloud Console to these APIs + application restrictions.
VITE_GOOGLE_MAPS_JS_KEY=

# Private web-service key: Geocoding, Routes, Places. Read on the RUST side only.
# Must NOT be prefixed with VITE_ and must NOT be exposed to frontend JS.
GOOGLE_WEBSERVICE_KEY=

VITE_DEFAULT_SEARCH_RADIUS_METERS=8000
```

Per Decision 1 (Section 2.1), keys are intentionally split. Only the Maps JS key may be
`VITE_`-prefixed (and thus bundled into frontend code); it is restricted in Google Cloud
Console. The billed web-service key is read by Rust commands from app config/`.env`,
never exposed through a `VITE_` variable, never logged, and never returned to the
frontend.

---

## 14. README Requirements

The generated repo README should include:

1. Project description.
2. Screenshot placeholder.
3. Prerequisites:
   - Node LTS.
   - Rust stable.
   - Tauri prerequisites for Windows/macOS/Linux.
4. Setup:
   - `npm install`
   - copy `.env.example` to `.env`
   - add Google API key
   - `npm run tauri dev`
5. Google API setup notes.
6. Data-source notes.
7. Zillow/third-party listing guardrail.
8. Roadmap.

---

## 15. UX Details

Use practical, dense UI. This is a utility app, not a marketing site.

Visual style:

- Clean desktop dashboard.
- Compact cards.
- Large comparison table.
- Minimal animation.
- Use neutral colors.
- Show data freshness timestamps.
- Use warning badges for missing API keys, stale cached data, or manually-entered fields.

Data trust labels:

Every displayed value should have a source indicator:

```text
Google Maps
Google Places
NJDOE import
NJGIN import
Manual
Cached
```

Examples:

- “Drive to parents: 42 min · Google Routes · fetched 2026-06-10”
- “Annual taxes: $9,800 · Manual”
- “Math proficiency: 48% · NJDOE 2024-2025 import”

---

## 16. Error Handling

Handle:

- Missing API key.
- Geocoding failure.
- Ambiguous address.
- No Street View available.
- Places API quota/cost error.
- No nearby amenity found.
- Route failure.
- Offline mode.
- Missing NJDOE import.
- Missing parcel data.

Do not crash if any provider fails. The property report should show partial data.

---

## 17. Caching Policy

Default caching:

```text
Geocode result: effectively permanent unless user refreshes.
Routes: cache, user-refreshable.
Amenities: cache, user-refreshable.
Schools: cache, user-refreshable/import-refreshable.
Parcel data: local import, refresh only when dataset is replaced.
```

Store raw JSON responses where useful for debugging.

### 17.1 Cost Controls (required, not optional)

Because Places/Routes/Geocoding are billed per call and a single property can fan out
into many requests (7 amenity categories + 2 routes + geocode), the app must actively
constrain spend:

- **On-demand enrichment only** (Decision 3, Section 2.1): geocode on save; everything
  else is fetched by an explicit per-card user action.
- **Cache-first:** always read from the local cache before calling any provider; only
  call out on a cache miss or an explicit user "Refresh".
- **Field masks:** use Places field masks to request only needed fields.
- **Visible call counter:** show a running count of billed API calls this session and a
  cumulative monthly counter in Settings / Data Sources, so cost is never invisible.
- **Confirm large fan-outs:** "Fetch all amenities" (7 categories) should ask for
  confirmation and report how many calls it will make.
- **No background polling:** the app never refreshes cached data on its own.

---

## 18. Privacy / Local-Only Design

- The app should be local-first.
- Do not send saved property list to any custom server.
- Only call third-party APIs needed for user-requested enrichment.
- Make all external calls explicit and refreshable.
- Store family addresses locally.
- Add a note in Settings explaining that Google/other APIs receive queried addresses.

---

## 19. Initial Agent Task List

Start by implementing these tasks in order:

1. Create Tauri + React + TypeScript project.
2. Add SQLite persistence.
3. Create DB schema and migration system.
4. Build Settings page.
5. Build Dashboard page.
6. Build Add Property form.
7. Implement property CRUD.
8. Implement Google geocoding provider.
9. Implement property report page with address/coordinates.
10. Add external links generator.
11. Add map and Street View card.
12. Add family route calculations.
13. Add nearest grocery and post office lookup.
14. Add simple scoring.
15. Add CSV export.
16. Write README.

Stop after Phase 6 if time is limited. Phases 7 and 8 are data-import enhancements.

---

## 20. Acceptance Test Scenario

Use this sample flow:

1. Launch app.
2. Open Settings.
3. Enter Google Maps API key.
4. Enter two family destination addresses.
5. Add a test property in or near Hamilton, NJ.
6. Confirm property appears in dashboard.
7. Open property report.
8. Confirm geocoded address and coordinates exist.
9. Confirm map appears.
10. Confirm Street View or Street View link appears.
11. Confirm driving distances to both family addresses appear.
12. Confirm nearest grocery and post office appear.
13. Enter manual listing price, taxes, beds, baths, and notes.
14. Confirm overall score appears.
15. Export CSV.
16. Quit and reopen app.
17. Confirm all saved data remains.

---

## 21. Future Ideas

Potential future features:

- Mortgage estimate calculator.
- Monthly carrying cost calculator.
- Property tax sensitivity analysis.
- Flood zone lookup via FEMA.
- Noise/road proximity score.
- Nearby Superfund/brownfield/environmental sites.
- Daycare/preschool list.
- Commute to work.
- Drive-time isochrone map.
- Walkability approximation.
- Manual photo attachments from house tours.
- Tour checklist.
- Offer-comparison worksheet.
- Renovation cost notes.
- Calendar integration for showings.
- Import/export full database backup.

---

## 22. Quality Bar

The first version should prioritize:

1. Reliability.
2. Local persistence.
3. Clear source labels.
4. Partial results instead of hard failures.
5. Manual override fields.
6. Low API usage through caching.
7. A clean comparison table.

Avoid overbuilding scraping. The durable value of this app is not automated listing extraction; it is having one consistent, local decision-support dashboard for every house being considered.
