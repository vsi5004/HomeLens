use rusqlite::Row;
use serde::{Deserialize, Serialize};

/// A saved property. Field names map 1:1 to the `properties` table columns;
/// serde renames them to camelCase for the TypeScript frontend.
#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Property {
    pub id: String,
    pub created_at: String,
    pub updated_at: String,
    pub status: String,

    pub address_input: String,
    pub address_normalized: Option<String>,
    pub street: Option<String>,
    pub city: Option<String>,
    pub state: Option<String>,
    pub zip: Option<String>,
    pub county: Option<String>,
    pub latitude: Option<f64>,
    pub longitude: Option<f64>,

    pub listing_url: Option<String>,
    pub listing_source: Option<String>,
    pub list_price: Option<i64>,
    pub manual_estimated_value: Option<i64>,
    pub annual_taxes: Option<i64>,
    pub hoa_monthly: Option<i64>,
    pub beds: Option<f64>,
    pub baths: Option<f64>,
    pub sqft: Option<i64>,
    pub lot_size: Option<String>,
    pub year_built: Option<i64>,
    pub property_type: Option<String>,

    pub assigned_elementary_school: Option<String>,
    pub assigned_middle_school: Option<String>,
    pub assigned_high_school: Option<String>,

    pub subjective_score: Option<i64>,
    pub manual_school_score: Option<i64>,
    pub manual_property_value_score: Option<i64>,
    pub notes: Option<String>,
    pub photo_url: Option<String>,
}

/// All `properties` columns in a fixed order, reused by SELECT statements so the
/// column indices in `Property::from_row` stay correct.
pub const PROPERTY_COLUMNS: &str = "id, created_at, updated_at, status, \
    address_input, address_normalized, street, city, state, zip, county, latitude, longitude, \
    listing_url, listing_source, list_price, manual_estimated_value, annual_taxes, hoa_monthly, \
    beds, baths, sqft, lot_size, year_built, property_type, \
    assigned_elementary_school, assigned_middle_school, assigned_high_school, \
    subjective_score, manual_school_score, manual_property_value_score, notes, photo_url";

impl Property {
    /// Build a `Property` from a row selected with `PROPERTY_COLUMNS`.
    pub fn from_row(row: &Row<'_>) -> rusqlite::Result<Self> {
        Ok(Property {
            id: row.get(0)?,
            created_at: row.get(1)?,
            updated_at: row.get(2)?,
            status: row.get(3)?,
            address_input: row.get(4)?,
            address_normalized: row.get(5)?,
            street: row.get(6)?,
            city: row.get(7)?,
            state: row.get(8)?,
            zip: row.get(9)?,
            county: row.get(10)?,
            latitude: row.get(11)?,
            longitude: row.get(12)?,
            listing_url: row.get(13)?,
            listing_source: row.get(14)?,
            list_price: row.get(15)?,
            manual_estimated_value: row.get(16)?,
            annual_taxes: row.get(17)?,
            hoa_monthly: row.get(18)?,
            beds: row.get(19)?,
            baths: row.get(20)?,
            sqft: row.get(21)?,
            lot_size: row.get(22)?,
            year_built: row.get(23)?,
            property_type: row.get(24)?,
            assigned_elementary_school: row.get(25)?,
            assigned_middle_school: row.get(26)?,
            assigned_high_school: row.get(27)?,
            subjective_score: row.get(28)?,
            manual_school_score: row.get(29)?,
            manual_property_value_score: row.get(30)?,
            notes: row.get(31)?,
            photo_url: row.get(32)?,
        })
    }
}

/// Geocoding result returned by a `GeocodingProvider`.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GeocodeResult {
    pub normalized_address: String,
    pub street: Option<String>,
    pub city: Option<String>,
    pub state: Option<String>,
    pub zip: Option<String>,
    pub county: Option<String>,
    pub latitude: f64,
    pub longitude: f64,
    pub provider: String,
}

/// A cached drive-time/distance result from a property to a family destination.
/// Mirrors the `route_results` table (brief §7).
#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RouteResult {
    pub id: String,
    pub property_id: String,
    pub destination_key: String,
    pub destination_label: String,
    pub destination_address: String,
    pub mode: String,
    pub distance_meters: Option<i64>,
    pub duration_seconds: Option<i64>,
    pub provider: String,
    pub fetched_at: String,
}

pub const ROUTE_COLUMNS: &str = "id, property_id, destination_key, destination_label, \
    destination_address, mode, distance_meters, duration_seconds, provider, fetched_at";

impl RouteResult {
    /// Build a `RouteResult` from a row selected with `ROUTE_COLUMNS`.
    pub fn from_row(row: &Row<'_>) -> rusqlite::Result<Self> {
        Ok(RouteResult {
            id: row.get(0)?,
            property_id: row.get(1)?,
            destination_key: row.get(2)?,
            destination_label: row.get(3)?,
            destination_address: row.get(4)?,
            mode: row.get(5)?,
            distance_meters: row.get(6)?,
            duration_seconds: row.get(7)?,
            provider: row.get(8)?,
            fetched_at: row.get(9)?,
        })
    }
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AmenityResult {
    pub id: String,
    pub property_id: String,
    pub category: String,
    pub name: String,
    pub address: Option<String>,
    pub latitude: Option<f64>,
    pub longitude: Option<f64>,
    pub distance_meters: Option<i64>,
    pub duration_seconds: Option<i64>,
    pub rating: Option<f64>,
    pub user_ratings_total: Option<i64>,
    pub provider: String,
    pub place_id: Option<String>,
    pub fetched_at: String,
}

pub const AMENITY_COLUMNS: &str = "id, property_id, category, name, address, latitude, \
    longitude, distance_meters, duration_seconds, rating, user_ratings_total, provider, \
    place_id, fetched_at";

impl AmenityResult {
    /// Build an `AmenityResult` from a row selected with `AMENITY_COLUMNS`.
    pub fn from_row(row: &Row<'_>) -> rusqlite::Result<Self> {
        Ok(AmenityResult {
            id: row.get(0)?,
            property_id: row.get(1)?,
            category: row.get(2)?,
            name: row.get(3)?,
            address: row.get(4)?,
            latitude: row.get(5)?,
            longitude: row.get(6)?,
            distance_meters: row.get(7)?,
            duration_seconds: row.get(8)?,
            rating: row.get(9)?,
            user_ratings_total: row.get(10)?,
            provider: row.get(11)?,
            place_id: row.get(12)?,
            fetched_at: row.get(13)?,
        })
    }
}

/// A user-saved external link for a property (e.g. a Zillow/Redfin listing URL).
/// Mirrors the `external_links` table (brief §7).
#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExternalLink {
    pub id: String,
    pub property_id: String,
    pub label: String,
    pub url: String,
    pub created_at: String,
}

pub const EXTERNAL_LINK_COLUMNS: &str = "id, property_id, label, url, created_at";

impl ExternalLink {
    /// Build an `ExternalLink` from a row selected with `EXTERNAL_LINK_COLUMNS`.
    pub fn from_row(row: &Row<'_>) -> rusqlite::Result<Self> {
        Ok(ExternalLink {
            id: row.get(0)?,
            property_id: row.get(1)?,
            label: row.get(2)?,
            url: row.get(3)?,
            created_at: row.get(4)?,
        })
    }
}

/// A nearby school for a property (from Google Places), optionally matched to an
/// imported NJDOE record. Mirrors the `school_results` table (brief §7, §10.4).
/// `metrics_json` is a JSON object (label → value) copied from the matched NJDOE row.
#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SchoolResult {
    pub id: String,
    pub property_id: String,
    pub name: String,
    pub district: Option<String>,
    pub grade_span: Option<String>,
    pub school_type: Option<String>,
    pub address: Option<String>,
    pub latitude: Option<f64>,
    pub longitude: Option<f64>,
    pub distance_meters: Option<i64>,
    pub source: Option<String>,
    pub matched_njdoe_id: Option<String>,
    pub metrics_json: Option<String>,
    pub fetched_at: String,
}

pub const SCHOOL_COLUMNS: &str = "id, property_id, name, district, grade_span, school_type, \
    address, latitude, longitude, distance_meters, source, matched_njdoe_id, metrics_json, \
    fetched_at";

impl SchoolResult {
    /// Build a `SchoolResult` from a row selected with `SCHOOL_COLUMNS`.
    pub fn from_row(row: &Row<'_>) -> rusqlite::Result<Self> {
        Ok(SchoolResult {
            id: row.get(0)?,
            property_id: row.get(1)?,
            name: row.get(2)?,
            district: row.get(3)?,
            grade_span: row.get(4)?,
            school_type: row.get(5)?,
            address: row.get(6)?,
            latitude: row.get(7)?,
            longitude: row.get(8)?,
            distance_meters: row.get(9)?,
            source: row.get(10)?,
            matched_njdoe_id: row.get(11)?,
            metrics_json: row.get(12)?,
            fetched_at: row.get(13)?,
        })
    }
}

/// An imported NJDOE school performance row. Mirrors the `njdoe_schools` table
/// (migration 0003). `metrics_json` holds the parsed metrics as a JSON object.
#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NjdoeSchool {
    pub id: String,
    pub county_name: Option<String>,
    pub district_name: Option<String>,
    pub school_name: String,
    pub grade_span: Option<String>,
    pub enrollment: Option<i64>,
    pub metrics_json: String,
    pub source: Option<String>,
    pub imported_at: String,
}

pub const NJDOE_SCHOOL_COLUMNS: &str = "id, county_name, district_name, school_name, \
    grade_span, enrollment, metrics_json, source, imported_at";

impl NjdoeSchool {
    /// Build an `NjdoeSchool` from a row selected with `NJDOE_SCHOOL_COLUMNS`.
    pub fn from_row(row: &Row<'_>) -> rusqlite::Result<Self> {
        Ok(NjdoeSchool {
            id: row.get(0)?,
            county_name: row.get(1)?,
            district_name: row.get(2)?,
            school_name: row.get(3)?,
            grade_span: row.get(4)?,
            enrollment: row.get(5)?,
            metrics_json: row.get(6)?,
            source: row.get(7)?,
            imported_at: row.get(8)?,
        })
    }
}

/// The matched parcel / MOD-IV tax record for a saved property. Mirrors the
/// `parcel_results` table (brief §7, §10.5). `source` is the dataset name for an
/// automatic point-in-polygon match, or `manual` when the user edits fields.
#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ParcelResult {
    pub id: String,
    pub property_id: String,
    pub source: String,
    pub municipality: Option<String>,
    pub county: Option<String>,
    pub block: Option<String>,
    pub lot: Option<String>,
    pub qualifier: Option<String>,
    pub property_class: Option<String>,
    pub land_assessment: Option<i64>,
    pub improvement_assessment: Option<i64>,
    pub total_assessment: Option<i64>,
    pub annual_taxes: Option<i64>,
    pub owner_name: Option<String>,
    pub fetched_at: String,
}

pub const PARCEL_COLUMNS: &str = "id, property_id, source, municipality, county, block, lot, \
    qualifier, property_class, land_assessment, improvement_assessment, total_assessment, \
    annual_taxes, owner_name, fetched_at";

impl ParcelResult {
    /// Build a `ParcelResult` from a row selected with `PARCEL_COLUMNS`.
    pub fn from_row(row: &Row<'_>) -> rusqlite::Result<Self> {
        Ok(ParcelResult {
            id: row.get(0)?,
            property_id: row.get(1)?,
            source: row.get(2)?,
            municipality: row.get(3)?,
            county: row.get(4)?,
            block: row.get(5)?,
            lot: row.get(6)?,
            qualifier: row.get(7)?,
            property_class: row.get(8)?,
            land_assessment: row.get(9)?,
            improvement_assessment: row.get(10)?,
            total_assessment: row.get(11)?,
            annual_taxes: row.get(12)?,
            owner_name: row.get(13)?,
            fetched_at: row.get(14)?,
        })
    }
}
