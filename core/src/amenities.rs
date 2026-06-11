use chrono::Utc;
use serde::Serialize;
use uuid::Uuid;

use crate::db::Db;
use crate::models::{AmenityResult, AMENITY_COLUMNS};
use crate::places;
use crate::settings_store::read_setting;

/// The amenity categories we search for. Tuple: (category_key, label, Google place type).
const CATEGORIES: &[(&str, &str, &str)] = &[
    ("grocery", "Grocery", "supermarket"),
    ("pharmacy", "Pharmacy", "pharmacy"),
    ("post_office", "Post office", "post_office"),
    ("park", "Park", "park"),
    ("school", "School", "school"),
    ("daycare", "Daycare", "child_care_agency"),
    ("train_station", "Train station", "train_station"),
];

/// How many nearest places to keep per category.
const KEEP_PER_CATEGORY: i64 = 3;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AmenityCategoryInfo {
    pub key: String,
    pub label: String,
}

/// List the supported amenity categories (for the UI to render options).
pub fn get_amenity_categories() -> Vec<AmenityCategoryInfo> {
    CATEGORIES
        .iter()
        .map(|(key, label, _)| AmenityCategoryInfo {
            key: key.to_string(),
            label: label.to_string(),
        })
        .collect()
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AmenityError {
    pub category: String,
    pub label: String,
    pub message: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ComputeAmenitiesResult {
    pub amenities: Vec<AmenityResult>,
    pub errors: Vec<AmenityError>,
}

/// Read all cached amenities for a property (no API calls).
pub fn get_amenities(db: &Db, property_id: String) -> Result<Vec<AmenityResult>, String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    let sql = format!(
        "SELECT {AMENITY_COLUMNS} FROM amenity_results WHERE property_id = ?1 \
         ORDER BY category, distance_meters"
    );
    let mut stmt = conn.prepare(&sql).map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([&property_id], AmenityResult::from_row)
        .map_err(|e| e.to_string())?;
    let mut out = Vec::new();
    for r in rows {
        out.push(r.map_err(|e| e.to_string())?);
    }
    Ok(out)
}

/// Read all cached amenities across every property (no API calls). Used by the
/// comparison dashboard to score all homes in one round-trip.
pub fn list_all_amenities(db: &Db) -> Result<Vec<AmenityResult>, String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    let sql = format!(
        "SELECT {AMENITY_COLUMNS} FROM amenity_results ORDER BY property_id, category, distance_meters"
    );
    let mut stmt = conn.prepare(&sql).map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([], AmenityResult::from_row)
        .map_err(|e| e.to_string())?;
    let mut out = Vec::new();
    for r in rows {
        out.push(r.map_err(|e| e.to_string())?);
    }
    Ok(out)
}

/// Recompute and cache nearby amenities for a property. When `categories` is
/// provided, only those category keys are fetched; otherwise all categories are
/// fetched (an explicit user-confirmed fan-out, brief §17.1). Best-effort:
/// per-category failures are returned in `errors` while successes are stored.
pub async fn compute_amenities(
    db: &Db,
    property_id: String,
    categories: Option<Vec<String>>,
) -> Result<ComputeAmenitiesResult, String> {
    // Read property coords + settings, then drop the lock before any await.
    let (lat, lng, api_key, radius) = {
        let conn = db.0.lock().map_err(|e| e.to_string())?;
        let coords: (Option<f64>, Option<f64>) = conn
            .query_row(
                "SELECT latitude, longitude FROM properties WHERE id = ?1",
                [&property_id],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .map_err(|e| match e {
                rusqlite::Error::QueryReturnedNoRows => "property not found".to_string(),
                other => other.to_string(),
            })?;
        let api_key = read_setting(&conn, "google_webservice_key")?.unwrap_or_default();
        let radius = read_setting(&conn, "default_search_radius_meters")?
            .and_then(|s| s.parse::<f64>().ok())
            .unwrap_or(8000.0);
        (coords.0, coords.1, api_key, radius)
    };

    let (lat, lng) = match (lat, lng) {
        (Some(la), Some(lo)) => (la, lo),
        _ => return Err("property has no coordinates yet (geocode it first)".into()),
    };

    // Determine which categories to fetch.
    let wanted: Vec<&(&str, &str, &str)> = match &categories {
        Some(keys) => CATEGORIES
            .iter()
            .filter(|(key, _, _)| keys.iter().any(|k| k == key))
            .collect(),
        None => CATEGORIES.iter().collect(),
    };

    let mut computed: Vec<(String, Vec<places::PlaceHit>)> = Vec::new();
    let mut errors: Vec<AmenityError> = Vec::new();

    for (key, label, place_type) in wanted {
        match places::search_nearby(lat, lng, place_type, radius, KEEP_PER_CATEGORY, &api_key).await
        {
            Ok(hits) if hits.is_empty() => errors.push(AmenityError {
                category: key.to_string(),
                label: label.to_string(),
                message: "no nearby results found".into(),
            }),
            Ok(hits) => computed.push((key.to_string(), hits)),
            Err(e) => errors.push(AmenityError {
                category: key.to_string(),
                label: label.to_string(),
                message: e,
            }),
        }
    }

    // Persist successes: replace any prior rows for the same property+category.
    {
        let conn = db.0.lock().map_err(|e| e.to_string())?;
        let now = Utc::now().to_rfc3339();
        for (key, hits) in &computed {
            conn.execute(
                "DELETE FROM amenity_results WHERE property_id = ?1 AND category = ?2",
                rusqlite::params![property_id, key],
            )
            .map_err(|e| e.to_string())?;
            for hit in hits {
                conn.execute(
                    "INSERT INTO amenity_results (
                        id, property_id, category, name, address, latitude, longitude,
                        distance_meters, duration_seconds, rating, user_ratings_total,
                        provider, place_id, fetched_at
                    ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, NULL, ?9, ?10, 'google', ?11, ?12)",
                    rusqlite::params![
                        Uuid::new_v4().to_string(),
                        property_id,
                        key,
                        hit.name,
                        hit.address,
                        hit.latitude,
                        hit.longitude,
                        hit.distance_meters,
                        hit.rating,
                        hit.user_ratings_total,
                        hit.place_id,
                        now,
                    ],
                )
                .map_err(|e| e.to_string())?;
            }
        }
    }

    let amenities = get_amenities(db, property_id)?;
    Ok(ComputeAmenitiesResult { amenities, errors })
}
