use chrono::Utc;
use serde::Serialize;
use uuid::Uuid;

use crate::db::Db;
use crate::geocoding;
use crate::isochrones;
use crate::models::{RouteResult, ROUTE_COLUMNS};
use crate::routes;
use crate::settings_store::{read_setting, write_setting};
use crate::traveltime;

/// The two fixed family destinations. Tuple: (destination_key, label, address setting key).
const DESTINATIONS: &[(&str, &str, &str)] = &[
    ("parents", "Parents", "family_parents_address"),
    ("inlaws", "In-laws", "family_inlaws_address"),
];

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RouteError {
    pub destination_key: String,
    pub destination_label: String,
    pub message: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ComputeRoutesResult {
    pub routes: Vec<RouteResult>,
    pub errors: Vec<RouteError>,
}

/// Read all cached routes for a property (no API calls).
pub fn get_routes(db: &Db, property_id: String) -> Result<Vec<RouteResult>, String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    let sql = format!(
        "SELECT {ROUTE_COLUMNS} FROM route_results WHERE property_id = ?1 ORDER BY destination_key"
    );
    let mut stmt = conn.prepare(&sql).map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([&property_id], RouteResult::from_row)
        .map_err(|e| e.to_string())?;
    let mut out = Vec::new();
    for r in rows {
        out.push(r.map_err(|e| e.to_string())?);
    }
    Ok(out)
}

/// Read all cached routes across every property (no API calls). Used by the
/// comparison dashboard to score all homes in one round-trip.
pub fn list_all_routes(db: &Db) -> Result<Vec<RouteResult>, String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    let sql = format!(
        "SELECT {ROUTE_COLUMNS} FROM route_results ORDER BY property_id, destination_key"
    );
    let mut stmt = conn.prepare(&sql).map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([], RouteResult::from_row)
        .map_err(|e| e.to_string())?;
    let mut out = Vec::new();
    for r in rows {
        out.push(r.map_err(|e| e.to_string())?);
    }
    Ok(out)
}

/// Recompute and cache drive time/distance from a property to both family
/// destinations. Best-effort: per-destination failures are returned in `errors`
/// while successful legs are still stored (brief §16).
pub async fn compute_routes(
    db: &Db,
    property_id: String,
) -> Result<ComputeRoutesResult, String> {
    // Read property coords + settings, then drop the lock before any await.
    let (lat, lng, api_key, mode, dests) = {
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
        let mode = read_setting(&conn, "commute_mode")?.unwrap_or_else(|| "driving".into());

        let mut dests = Vec::new();
        for (key, label, setting_key) in DESTINATIONS {
            let addr = read_setting(&conn, setting_key)?.unwrap_or_default();
            dests.push((*key, *label, addr));
        }
        (coords.0, coords.1, api_key, mode, dests)
    };

    let (lat, lng) = match (lat, lng) {
        (Some(la), Some(lo)) => (la, lo),
        _ => return Err("property has no coordinates yet (geocode it first)".into()),
    };

    let mut computed: Vec<(String, String, String, routes::RouteLeg)> = Vec::new();
    let mut errors: Vec<RouteError> = Vec::new();

    for (key, label, addr) in &dests {
        if addr.trim().is_empty() {
            errors.push(RouteError {
                destination_key: key.to_string(),
                destination_label: label.to_string(),
                message: "no address set (add it in Settings)".into(),
            });
            continue;
        }
        match routes::compute_route(lat, lng, addr, &mode, &api_key).await {
            Ok(leg) => computed.push((key.to_string(), label.to_string(), addr.clone(), leg)),
            Err(e) => errors.push(RouteError {
                destination_key: key.to_string(),
                destination_label: label.to_string(),
                message: e,
            }),
        }
    }

    // Persist successes: replace any prior leg for the same property+destination.
    {
        let conn = db.0.lock().map_err(|e| e.to_string())?;
        let now = Utc::now().to_rfc3339();
        for (key, label, addr, leg) in &computed {
            conn.execute(
                "DELETE FROM route_results WHERE property_id = ?1 AND destination_key = ?2",
                rusqlite::params![property_id, key],
            )
            .map_err(|e| e.to_string())?;
            conn.execute(
                "INSERT INTO route_results (
                    id, property_id, destination_key, destination_label, destination_address,
                    mode, distance_meters, duration_seconds, provider, fetched_at
                ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, 'google', ?9)",
                rusqlite::params![
                    Uuid::new_v4().to_string(),
                    property_id,
                    key,
                    label,
                    addr,
                    mode,
                    leg.distance_meters,
                    leg.duration_seconds,
                    now,
                ],
            )
            .map_err(|e| e.to_string())?;
        }
    }

    let routes = get_routes(db, property_id)?;
    Ok(ComputeRoutesResult { routes, errors })
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FamilyLocation {
    pub key: String,
    pub label: String,
    pub address: String,
    pub latitude: Option<f64>,
    pub longitude: Option<f64>,
}

/// Return cached family destinations with coordinates (no API calls). Coordinates
/// are present only if `geocode_family` has been run for the current addresses.
pub fn get_family_locations(db: &Db) -> Result<Vec<FamilyLocation>, String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    let mut out = Vec::new();
    for (key, label, setting_key) in DESTINATIONS {
        let address = read_setting(&conn, setting_key)?.unwrap_or_default();
        let lat = read_setting(&conn, &format!("{key}_lat"))?
            .and_then(|s| s.parse::<f64>().ok());
        let lng = read_setting(&conn, &format!("{key}_lng"))?
            .and_then(|s| s.parse::<f64>().ok());
        out.push(FamilyLocation {
            key: key.to_string(),
            label: label.to_string(),
            address,
            latitude: lat,
            longitude: lng,
        });
    }
    Ok(out)
}

/// Geocode both family addresses and cache their coordinates in settings so the
/// map can plot them without repeated billed calls. Best-effort per destination.
pub async fn geocode_family(db: &Db) -> Result<Vec<FamilyLocation>, String> {
    let (api_key, dests) = {
        let conn = db.0.lock().map_err(|e| e.to_string())?;
        let api_key = read_setting(&conn, "google_webservice_key")?.unwrap_or_default();
        let mut dests = Vec::new();
        for (key, label, setting_key) in DESTINATIONS {
            let addr = read_setting(&conn, setting_key)?.unwrap_or_default();
            dests.push((*key, *label, addr));
        }
        (api_key, dests)
    };

    let mut results: Vec<(String, Option<(f64, f64)>)> = Vec::new();
    for (key, _label, addr) in &dests {
        if addr.trim().is_empty() {
            results.push((key.to_string(), None));
            continue;
        }
        match geocoding::geocode(addr, &api_key).await {
            Ok(g) => results.push((key.to_string(), Some((g.latitude, g.longitude)))),
            Err(_) => results.push((key.to_string(), None)),
        }
    }

    {
        let conn = db.0.lock().map_err(|e| e.to_string())?;
        let now = Utc::now().to_rfc3339();
        for (key, coords) in &results {
            if let Some((lat, lng)) = coords {
                write_setting(&conn, &format!("{key}_lat"), &lat.to_string(), &now)?;
                write_setting(&conn, &format!("{key}_lng"), &lng.to_string(), &now)?;
            }
        }
    }

    get_family_locations(db)
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FamilyError {
    pub key: String,
    pub label: String,
    pub message: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FamilyIsochrone {
    pub key: String,
    pub label: String,
    pub address: String,
    pub latitude: Option<f64>,
    pub longitude: Option<f64>,
    /// Raw GeoJSON FeatureCollection from the isochrone provider, or null if not computed.
    pub geojson: Option<serde_json::Value>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FamilyIsochrones {
    pub range_seconds: Option<i64>,
    /// Active isochrone provider: "traveltime", "ors", or "none".
    pub provider: String,
    /// Maximum range (seconds) the active provider allows.
    pub max_range_seconds: i64,
    /// All ranges (seconds) that have a cached isochrone for both destinations.
    pub available_ranges: Vec<i64>,
    pub locations: Vec<FamilyIsochrone>,
    pub errors: Vec<FamilyError>,
}

/// Decide which isochrone provider to use based on configured credentials.
/// TravelTime (up to 4 h) is preferred when its credentials are set; otherwise
/// openrouteservice (capped at 1 h on the public API). Returns the provider name
/// and its maximum allowed range in seconds.
fn isochrone_provider(conn: &rusqlite::Connection) -> Result<(String, i64), String> {
    let tt_id = read_setting(conn, "traveltime_app_id")?.unwrap_or_default();
    let tt_key = read_setting(conn, "traveltime_api_key")?.unwrap_or_default();
    if !tt_id.trim().is_empty() && !tt_key.trim().is_empty() {
        return Ok(("traveltime".into(), traveltime::MAX_RANGE_SECONDS));
    }
    let ors = read_setting(conn, "ors_api_key")?.unwrap_or_default();
    if !ors.trim().is_empty() {
        return Ok(("ors".into(), 3600));
    }
    Ok(("none".into(), 3600))
}

/// Ranges (seconds) that have a cached isochrone for BOTH destinations, ascending.
fn available_ranges(conn: &rusqlite::Connection) -> Result<Vec<i64>, String> {
    let dest_count = DESTINATIONS.len() as i64;
    let mut stmt = conn
        .prepare(
            "SELECT range_seconds FROM isochrone_cache \
             GROUP BY range_seconds HAVING COUNT(DISTINCT destination_key) >= ?1 \
             ORDER BY range_seconds",
        )
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([dest_count], |row| row.get::<_, i64>(0))
        .map_err(|e| e.to_string())?;
    let mut out = Vec::new();
    for r in rows {
        out.push(r.map_err(|e| e.to_string())?);
    }
    Ok(out)
}

/// Read cached family isochrones for a specific range. When `range` is None, the
/// active range (`isochrone_range_seconds` setting) is used. Returns the GeoJSON
/// per destination from the `isochrone_cache` table (no API calls).
fn read_cached_isochrones(
    conn: &rusqlite::Connection,
    range: Option<i64>,
) -> Result<FamilyIsochrones, String> {
    let active_range = read_setting(conn, "isochrone_range_seconds")?
        .and_then(|s| s.parse::<i64>().ok());
    let range_seconds = range.or(active_range);
    let (provider, max_range_seconds) = isochrone_provider(conn)?;

    let mut locations = Vec::new();
    for (key, label, setting_key) in DESTINATIONS {
        let address = read_setting(conn, setting_key)?.unwrap_or_default();
        let lat = read_setting(conn, &format!("{key}_lat"))?.and_then(|s| s.parse::<f64>().ok());
        let lng = read_setting(conn, &format!("{key}_lng"))?.and_then(|s| s.parse::<f64>().ok());
        let geojson = match range_seconds {
            Some(r) => conn
                .query_row(
                    "SELECT geojson FROM isochrone_cache \
                     WHERE destination_key = ?1 AND range_seconds = ?2",
                    rusqlite::params![key, r],
                    |row| row.get::<_, String>(0),
                )
                .ok()
                .and_then(|s| serde_json::from_str::<serde_json::Value>(&s).ok()),
            None => None,
        };
        locations.push(FamilyIsochrone {
            key: key.to_string(),
            label: label.to_string(),
            address,
            latitude: lat,
            longitude: lng,
            geojson,
        });
    }

    Ok(FamilyIsochrones {
        range_seconds,
        provider,
        max_range_seconds,
        available_ranges: available_ranges(conn)?,
        locations,
        errors: Vec::new(),
    })
}

/// Return cached family drive-time isochrones (no API calls). Pass `rangeSeconds`
/// to load a specific previously-computed range; omit to load the active range.
pub fn get_family_isochrones(
    db: &Db,
    range_seconds: Option<i64>,
) -> Result<FamilyIsochrones, String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    read_cached_isochrones(&conn, range_seconds)
}

/// Compute and cache drive-time isochrones for both family destinations at the
/// given range (seconds). Geocodes any family address missing coordinates first.
/// Best-effort per destination (failures collected in `errors`).
pub async fn compute_family_isochrones(
    db: &Db,
    range_seconds: i64,
) -> Result<FamilyIsochrones, String> {
    // Gather keys, addresses, and any cached coordinates.
    let (provider, max_range, ors_key, tt_id, tt_key, web_key, mut dests) = {
        let conn = db.0.lock().map_err(|e| e.to_string())?;
        let (provider, max_range) = isochrone_provider(&conn)?;
        let ors_key = read_setting(&conn, "ors_api_key")?.unwrap_or_default();
        let tt_id = read_setting(&conn, "traveltime_app_id")?.unwrap_or_default();
        let tt_key = read_setting(&conn, "traveltime_api_key")?.unwrap_or_default();
        let web_key = read_setting(&conn, "google_webservice_key")?.unwrap_or_default();
        let mut dests = Vec::new();
        for (key, label, setting_key) in DESTINATIONS {
            let addr = read_setting(&conn, setting_key)?.unwrap_or_default();
            let lat = read_setting(&conn, &format!("{key}_lat"))?
                .and_then(|s| s.parse::<f64>().ok());
            let lng = read_setting(&conn, &format!("{key}_lng"))?
                .and_then(|s| s.parse::<f64>().ok());
            dests.push((*key, *label, addr, lat, lng));
        }
        (provider, max_range, ors_key, tt_id, tt_key, web_key, dests)
    };

    // Clamp to the active provider's maximum supported range.
    let range_seconds = range_seconds.min(max_range);

    let mut errors: Vec<FamilyError> = Vec::new();

    // Geocode any destination missing coordinates (best-effort).
    for d in dests.iter_mut() {
        if (d.3.is_none() || d.4.is_none()) && !d.2.trim().is_empty() {
            match geocoding::geocode(&d.2, &web_key).await {
                Ok(g) => {
                    d.3 = Some(g.latitude);
                    d.4 = Some(g.longitude);
                }
                Err(e) => errors.push(FamilyError {
                    key: d.0.to_string(),
                    label: d.1.to_string(),
                    message: format!("could not geocode address: {e}"),
                }),
            }
        }
    }

    // Persist any newly-geocoded coordinates.
    {
        let conn = db.0.lock().map_err(|e| e.to_string())?;
        let now = Utc::now().to_rfc3339();
        for d in &dests {
            if let (Some(lat), Some(lng)) = (d.3, d.4) {
                write_setting(&conn, &format!("{}_lat", d.0), &lat.to_string(), &now)?;
                write_setting(&conn, &format!("{}_lng", d.0), &lng.to_string(), &now)?;
            }
        }
    }

    // Fetch isochrones for destinations with coordinates.
    let mut computed: Vec<(String, serde_json::Value)> = Vec::new();
    for d in &dests {
        if d.2.trim().is_empty() {
            errors.push(FamilyError {
                key: d.0.to_string(),
                label: d.1.to_string(),
                message: "no address set (add it in Settings)".into(),
            });
            continue;
        }
        let (lat, lng) = match (d.3, d.4) {
            (Some(la), Some(lo)) => (la, lo),
            _ => continue, // geocode error already recorded
        };
        let fetched = match provider.as_str() {
            "traveltime" => {
                traveltime::fetch_isochrone(lat, lng, range_seconds, &tt_id, &tt_key).await
            }
            _ => isochrones::fetch_isochrone(lat, lng, range_seconds, &ors_key).await,
        };
        match fetched {
            Ok(geo) => computed.push((d.0.to_string(), geo)),
            Err(e) => errors.push(FamilyError {
                key: d.0.to_string(),
                label: d.1.to_string(),
                message: e,
            }),
        }
    }

    // Cache the results per-range so previously computed ranges are preserved.
    {
        let conn = db.0.lock().map_err(|e| e.to_string())?;
        let now = Utc::now().to_rfc3339();
        write_setting(&conn, "isochrone_range_seconds", &range_seconds.to_string(), &now)?;
        for (key, geo) in &computed {
            let serialized = serde_json::to_string(geo).map_err(|e| e.to_string())?;
            conn.execute(
                "INSERT INTO isochrone_cache (destination_key, range_seconds, provider, geojson, fetched_at) \
                 VALUES (?1, ?2, ?3, ?4, ?5) \
                 ON CONFLICT(destination_key, range_seconds) \
                 DO UPDATE SET provider = excluded.provider, geojson = excluded.geojson, \
                 fetched_at = excluded.fetched_at",
                rusqlite::params![key, range_seconds, provider, serialized, now],
            )
            .map_err(|e| e.to_string())?;
            // Drop the obsolete single-valued blob from the pre-cache-table schema.
            conn.execute(
                "DELETE FROM settings WHERE key = ?1",
                rusqlite::params![format!("{key}_isochrone")],
            )
            .map_err(|e| e.to_string())?;
        }
    }

    let mut result = {
        let conn = db.0.lock().map_err(|e| e.to_string())?;
        read_cached_isochrones(&conn, Some(range_seconds))?
    };
    result.errors = errors;
    Ok(result)
}
