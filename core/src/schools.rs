use chrono::Utc;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::db::Db;
use crate::models::{NjdoeSchool, SchoolResult, NJDOE_SCHOOL_COLUMNS, SCHOOL_COLUMNS};
use crate::places;
use crate::settings_store::read_setting;

/// How many nearest schools to keep when fetching from Google Places.
const KEEP_SCHOOLS: i64 = 8;

/// Read all cached nearby schools for a property (no API calls).
pub fn get_schools(db: &Db, property_id: String) -> Result<Vec<SchoolResult>, String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    let sql = format!(
        "SELECT {SCHOOL_COLUMNS} FROM school_results WHERE property_id = ?1 \
         ORDER BY distance_meters"
    );
    let mut stmt = conn.prepare(&sql).map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([&property_id], SchoolResult::from_row)
        .map_err(|e| e.to_string())?;
    let mut out = Vec::new();
    for r in rows {
        out.push(r.map_err(|e| e.to_string())?);
    }
    Ok(out)
}

/// Read all cached school results across every property (for dashboard scoring,
/// mirroring `list_all_routes` / `list_all_amenities`). No API calls.
pub fn list_all_school_results(db: &Db) -> Result<Vec<SchoolResult>, String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    let sql = format!(
        "SELECT {SCHOOL_COLUMNS} FROM school_results \
         ORDER BY property_id, distance_meters"
    );
    let mut stmt = conn.prepare(&sql).map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([], SchoolResult::from_row)
        .map_err(|e| e.to_string())?;
    let mut out = Vec::new();
    for r in rows {
        out.push(r.map_err(|e| e.to_string())?);
    }
    Ok(out)
}

/// Recompute and cache nearby schools for a property via Google Places (one
/// billed call). Best-effort. Re-fetching preserves any existing NJDOE matches by
/// school name so a user's manual binding survives a refresh.
pub async fn compute_schools(
    db: &Db,
    property_id: String,
) -> Result<Vec<SchoolResult>, String> {
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

    let hits = places::search_nearby(lat, lng, "school", radius, KEEP_SCHOOLS, &api_key).await?;
    if hits.is_empty() {
        return Err("no nearby schools found".into());
    }

    {
        let conn = db.0.lock().map_err(|e| e.to_string())?;
        // Preserve prior matches keyed by school name so a refresh doesn't drop them.
        let mut prior: std::collections::HashMap<String, (Option<String>, Option<String>, Option<String>, Option<String>)> =
            std::collections::HashMap::new();
        {
            let mut stmt = conn
                .prepare(
                    "SELECT name, matched_njdoe_id, metrics_json, district, grade_span \
                     FROM school_results WHERE property_id = ?1 AND matched_njdoe_id IS NOT NULL",
                )
                .map_err(|e| e.to_string())?;
            let rows = stmt
                .query_map([&property_id], |row| {
                    Ok((
                        row.get::<_, String>(0)?,
                        (
                            row.get::<_, Option<String>>(1)?,
                            row.get::<_, Option<String>>(2)?,
                            row.get::<_, Option<String>>(3)?,
                            row.get::<_, Option<String>>(4)?,
                        ),
                    ))
                })
                .map_err(|e| e.to_string())?;
            for r in rows {
                let (name, data) = r.map_err(|e| e.to_string())?;
                prior.insert(name, data);
            }
        }

        conn.execute(
            "DELETE FROM school_results WHERE property_id = ?1",
            [&property_id],
        )
        .map_err(|e| e.to_string())?;

        let now = Utc::now().to_rfc3339();
        for hit in &hits {
            let preserved = prior.get(&hit.name);
            let (matched, metrics, district, grade_span) = match preserved {
                Some((m, j, d, g)) => (m.clone(), j.clone(), d.clone(), g.clone()),
                None => (None, None, None, None),
            };
            conn.execute(
                "INSERT INTO school_results (
                    id, property_id, name, district, grade_span, school_type, address,
                    latitude, longitude, distance_meters, source, matched_njdoe_id,
                    metrics_json, fetched_at
                 ) VALUES (?1, ?2, ?3, ?4, ?5, NULL, ?6, ?7, ?8, ?9, 'google_places', ?10, ?11, ?12)",
                rusqlite::params![
                    Uuid::new_v4().to_string(),
                    property_id,
                    hit.name,
                    district,
                    grade_span,
                    hit.address,
                    hit.latitude,
                    hit.longitude,
                    hit.distance_meters,
                    matched,
                    metrics,
                    now,
                ],
            )
            .map_err(|e| e.to_string())?;
        }
    }

    get_schools(db, property_id)
}

/// One NJDOE school row to import. Parsing/column-mapping happens in the frontend;
/// the backend just stores. `metrics` is an arbitrary JSON object of label→value.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NjdoeSchoolInput {
    pub id: Option<String>,
    pub county_name: Option<String>,
    pub district_name: Option<String>,
    pub school_name: String,
    pub grade_span: Option<String>,
    pub enrollment: Option<i64>,
    #[serde(default)]
    pub metrics: serde_json::Value,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportResult {
    pub imported: usize,
    pub skipped: usize,
    pub total: i64,
}

/// Bulk-import (upsert) NJDOE school rows. Rows missing a school name are skipped.
/// `id` defaults to a generated UUID when no stable CDS code is provided.
pub fn import_njdoe_schools(
    db: &Db,
    records: Vec<NjdoeSchoolInput>,
    source: Option<String>,
) -> Result<ImportResult, String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    let now = Utc::now().to_rfc3339();
    let source = source.unwrap_or_else(|| "njdoe import".to_string());
    let mut imported = 0usize;
    let mut skipped = 0usize;

    for rec in records {
        let name = rec.school_name.trim().to_string();
        if name.is_empty() {
            skipped += 1;
            continue;
        }
        let id = rec
            .id
            .filter(|s| !s.trim().is_empty())
            .unwrap_or_else(|| Uuid::new_v4().to_string());
        let metrics_json = if rec.metrics.is_null() {
            "{}".to_string()
        } else {
            rec.metrics.to_string()
        };
        conn.execute(
            "INSERT INTO njdoe_schools (
                id, county_name, district_name, school_name, grade_span, enrollment,
                metrics_json, source, imported_at
             ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)
             ON CONFLICT(id) DO UPDATE SET
                county_name = excluded.county_name,
                district_name = excluded.district_name,
                school_name = excluded.school_name,
                grade_span = excluded.grade_span,
                enrollment = excluded.enrollment,
                -- Merge metrics so narrow per-domain imports accumulate instead
                -- of overwriting (NJDOE ships each metric in a separate file).
                metrics_json = json_patch(njdoe_schools.metrics_json, excluded.metrics_json),
                source = excluded.source,
                imported_at = excluded.imported_at",
            rusqlite::params![
                id,
                rec.county_name,
                rec.district_name,
                name,
                rec.grade_span,
                rec.enrollment,
                metrics_json,
                source,
                now,
            ],
        )
        .map_err(|e| e.to_string())?;
        imported += 1;
    }

    let total: i64 = conn
        .query_row("SELECT COUNT(*) FROM njdoe_schools", [], |row| row.get(0))
        .map_err(|e| e.to_string())?;

    Ok(ImportResult {
        imported,
        skipped,
        total,
    })
}

/// How many NJDOE rows are currently imported (for the UI status line).
pub fn njdoe_count(db: &Db) -> Result<i64, String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    conn.query_row("SELECT COUNT(*) FROM njdoe_schools", [], |row| row.get(0))
        .map_err(|e| e.to_string())
}

/// Delete all imported NJDOE rows (e.g. before a fresh re-import). Existing school
/// matches keep their copied metrics but their `matched_njdoe_id` will no longer
/// resolve to a stored row.
pub fn clear_njdoe_schools(db: &Db) -> Result<i64, String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    let deleted = conn
        .execute("DELETE FROM njdoe_schools", [])
        .map_err(|e| e.to_string())?;
    Ok(deleted as i64)
}

/// Search imported NJDOE rows by school/district name (for the manual match
/// picker). Empty search returns the first `limit` rows alphabetically.
pub fn list_njdoe_schools(
    db: &Db,
    search: Option<String>,
    limit: Option<i64>,
) -> Result<Vec<NjdoeSchool>, String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    let limit = limit.unwrap_or(50).clamp(1, 500);
    let term = search.unwrap_or_default();
    let term = term.trim();

    let mut out = Vec::new();
    if term.is_empty() {
        let sql = format!(
            "SELECT {NJDOE_SCHOOL_COLUMNS} FROM njdoe_schools \
             ORDER BY school_name LIMIT ?1"
        );
        let mut stmt = conn.prepare(&sql).map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map([limit], NjdoeSchool::from_row)
            .map_err(|e| e.to_string())?;
        for r in rows {
            out.push(r.map_err(|e| e.to_string())?);
        }
    } else {
        let like = format!("%{term}%");
        let sql = format!(
            "SELECT {NJDOE_SCHOOL_COLUMNS} FROM njdoe_schools \
             WHERE school_name LIKE ?1 OR district_name LIKE ?1 \
             ORDER BY school_name LIMIT ?2"
        );
        let mut stmt = conn.prepare(&sql).map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map(rusqlite::params![like, limit], NjdoeSchool::from_row)
            .map_err(|e| e.to_string())?;
        for r in rows {
            out.push(r.map_err(|e| e.to_string())?);
        }
    }
    Ok(out)
}

/// Bind a nearby school to an imported NJDOE record (copying its metrics, district
/// and grade span into the school row), or pass `njdoe_id = null` to unmatch.
pub fn match_school_to_njdoe(
    db: &Db,
    school_result_id: String,
    njdoe_id: Option<String>,
) -> Result<SchoolResult, String> {
    {
        let conn = db.0.lock().map_err(|e| e.to_string())?;
        match njdoe_id.filter(|s| !s.trim().is_empty()) {
            Some(nid) => {
                let sql =
                    format!("SELECT {NJDOE_SCHOOL_COLUMNS} FROM njdoe_schools WHERE id = ?1");
                let njdoe = conn
                    .query_row(&sql, [&nid], NjdoeSchool::from_row)
                    .map_err(|e| match e {
                        rusqlite::Error::QueryReturnedNoRows => "NJDOE record not found".to_string(),
                        other => other.to_string(),
                    })?;
                let affected = conn
                    .execute(
                        "UPDATE school_results SET matched_njdoe_id = ?2, metrics_json = ?3, \
                         district = COALESCE(?4, district), grade_span = COALESCE(?5, grade_span) \
                         WHERE id = ?1",
                        rusqlite::params![
                            school_result_id,
                            njdoe.id,
                            njdoe.metrics_json,
                            njdoe.district_name,
                            njdoe.grade_span,
                        ],
                    )
                    .map_err(|e| e.to_string())?;
                if affected == 0 {
                    return Err("school not found".into());
                }
            }
            None => {
                let affected = conn
                    .execute(
                        "UPDATE school_results SET matched_njdoe_id = NULL, metrics_json = NULL \
                         WHERE id = ?1",
                        [&school_result_id],
                    )
                    .map_err(|e| e.to_string())?;
                if affected == 0 {
                    return Err("school not found".into());
                }
            }
        }
    }

    let conn = db.0.lock().map_err(|e| e.to_string())?;
    let sql = format!("SELECT {SCHOOL_COLUMNS} FROM school_results WHERE id = ?1");
    conn.query_row(&sql, [&school_result_id], SchoolResult::from_row)
        .map_err(|e| e.to_string())
}

/// Set the manually-assigned elementary/middle/high schools for a property
/// (brief §5.3 caveat — "nearby" ≠ "assigned"; these are manual fields).
pub fn set_assigned_schools(
    db: &Db,
    property_id: String,
    elementary: Option<String>,
    middle: Option<String>,
    high: Option<String>,
) -> Result<(), String> {
    let clean = |s: Option<String>| s.map(|v| v.trim().to_string()).filter(|v| !v.is_empty());
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    let now = Utc::now().to_rfc3339();
    let affected = conn
        .execute(
            "UPDATE properties SET assigned_elementary_school = ?2, \
             assigned_middle_school = ?3, assigned_high_school = ?4, updated_at = ?5 \
             WHERE id = ?1",
            rusqlite::params![
                property_id,
                clean(elementary),
                clean(middle),
                clean(high),
                now,
            ],
        )
        .map_err(|e| e.to_string())?;
    if affected == 0 {
        return Err("property not found".into());
    }
    Ok(())
}
