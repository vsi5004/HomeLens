use chrono::Utc;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use uuid::Uuid;

use crate::db::Db;
use crate::models::{ParcelResult, PARCEL_COLUMNS};

/// Normalize a GeoJSON property key for fuzzy matching (uppercase, alnum only).
fn norm_key(s: &str) -> String {
    s.chars()
        .filter(|c| c.is_alphanumeric())
        .collect::<String>()
        .to_uppercase()
}

/// Find the first property value whose normalized key matches any alias.
fn pick<'a>(props: &'a serde_json::Map<String, Value>, aliases: &[&str]) -> Option<&'a Value> {
    for alias in aliases {
        let want = norm_key(alias);
        for (k, v) in props.iter() {
            if norm_key(k) == want && !v.is_null() {
                return Some(v);
            }
        }
    }
    None
}

fn as_text(v: Option<&Value>) -> Option<String> {
    match v {
        Some(Value::String(s)) if !s.trim().is_empty() => Some(s.trim().to_string()),
        Some(Value::Number(n)) => Some(n.to_string()),
        _ => None,
    }
}

/// Parse a possibly-formatted currency/number value into an integer.
fn as_int(v: Option<&Value>) -> Option<i64> {
    match v {
        Some(Value::Number(n)) => n.as_f64().map(|f| f.round() as i64),
        Some(Value::String(s)) => {
            let cleaned: String = s
                .chars()
                .filter(|c| c.is_ascii_digit() || *c == '.' || *c == '-')
                .collect();
            cleaned.parse::<f64>().ok().map(|f| f.round() as i64)
        }
        _ => None,
    }
}

struct ParcelAttrs {
    municipality: Option<String>,
    county: Option<String>,
    block: Option<String>,
    lot: Option<String>,
    qualifier: Option<String>,
    property_class: Option<String>,
    address: Option<String>,
    land: Option<i64>,
    improvement: Option<i64>,
    total: Option<i64>,
    taxes: Option<i64>,
    owner: Option<String>,
    id: Option<String>,
}

/// Map NJGIN/MOD-IV GeoJSON feature properties onto our parcel columns using a
/// generous set of field-name aliases (NJ parcel schemas vary by export).
fn map_attrs(props: &serde_json::Map<String, Value>) -> ParcelAttrs {
    ParcelAttrs {
        id: as_text(pick(props, &["PAMS_PIN", "GIS_PIN", "PCL_PIN", "PIN", "PARCEL_ID"])),
        municipality: as_text(pick(props, &["MUN_NAME", "PCL_MUN", "MUNICIPALITY", "MUN"])),
        county: as_text(pick(props, &["COUNTY", "CO_NAME", "COUNTY_NAME"])),
        block: as_text(pick(props, &["BLOCK", "PCLBLOCK"])),
        lot: as_text(pick(props, &["LOT", "PCLLOT"])),
        qualifier: as_text(pick(props, &["QUAL", "QUALIFIER", "PCLQCODE"])),
        property_class: as_text(pick(props, &["PROP_CLASS", "PCLCLASS", "PROPERTY_CLASS", "CLASS"])),
        address: as_text(pick(
            props,
            &["PROP_LOC", "PROPLOC", "ST_ADDRESS", "ADDRESS", "SITUS", "PROP_ADDRESS"],
        )),
        land: as_int(pick(props, &["LAND_VAL", "LANDVALUE", "LAND_ASSESSMENT"])),
        improvement: as_int(pick(
            props,
            &["IMPRVT_VAL", "IMPROVEMENT", "IMPRVALUE", "BLDG_VAL", "IMPROVEMENT_ASSESSMENT"],
        )),
        total: as_int(pick(
            props,
            &["NET_VALUE", "NETVALUE", "TOT_VAL", "TOTALVALUE", "TOTAL_ASSESSMENT"],
        )),
        taxes: as_int(pick(props, &["LAST_YR_TX", "TAX_AMT", "TAXES", "ANNUAL_TAXES"])),
        owner: as_text(pick(props, &["OWNER_NAME", "OWNERSNAME", "OWNER"])),
    }
}

/// Walk a GeoJSON coordinate `Value` tree, calling `f` for each [lon, lat] pair.
fn for_each_position(v: &Value, f: &mut impl FnMut(f64, f64)) {
    if let Value::Array(arr) = v {
        if arr.len() >= 2 && arr[0].is_number() && arr[1].is_number() {
            if let (Some(lon), Some(lat)) = (arr[0].as_f64(), arr[1].as_f64()) {
                f(lon, lat);
            }
        } else {
            for item in arr {
                for_each_position(item, f);
            }
        }
    }
}

/// Compute (min_lon, min_lat, max_lon, max_lat) for a geometry's coordinates.
fn bbox(coords: &Value) -> Option<(f64, f64, f64, f64)> {
    let mut min_lon = f64::INFINITY;
    let mut min_lat = f64::INFINITY;
    let mut max_lon = f64::NEG_INFINITY;
    let mut max_lat = f64::NEG_INFINITY;
    let mut seen = false;
    for_each_position(coords, &mut |lon, lat| {
        seen = true;
        min_lon = min_lon.min(lon);
        min_lat = min_lat.min(lat);
        max_lon = max_lon.max(lon);
        max_lat = max_lat.max(lat);
    });
    if seen {
        Some((min_lon, min_lat, max_lon, max_lat))
    } else {
        None
    }
}

/// Ray-casting test: is (lon, lat) inside the linear `ring` ([[lon,lat], ...])?
fn point_in_ring(lon: f64, lat: f64, ring: &[Vec<f64>]) -> bool {
    let n = ring.len();
    if n < 3 {
        return false;
    }
    let mut inside = false;
    let mut j = n - 1;
    for i in 0..n {
        let (xi, yi) = (ring[i][0], ring[i][1]);
        let (xj, yj) = (ring[j][0], ring[j][1]);
        if ((yi > lat) != (yj > lat)) && (lon < (xj - xi) * (lat - yi) / (yj - yi) + xi) {
            inside = !inside;
        }
        j = i;
    }
    inside
}

/// A polygon is a list of rings: outer ring first, then holes.
fn point_in_polygon(lon: f64, lat: f64, rings: &[Vec<Vec<f64>>]) -> bool {
    if rings.is_empty() || !point_in_ring(lon, lat, &rings[0]) {
        return false;
    }
    // Inside the outer ring but not inside any hole.
    !rings[1..].iter().any(|hole| point_in_ring(lon, lat, hole))
}

/// Parse a ring `Value` ([[lon,lat], ...]) into Vec<[lon, lat]>.
fn parse_ring(v: &Value) -> Vec<Vec<f64>> {
    let mut ring = Vec::new();
    if let Value::Array(points) = v {
        for p in points {
            if let Value::Array(pair) = p {
                if pair.len() >= 2 {
                    if let (Some(lon), Some(lat)) = (pair[0].as_f64(), pair[1].as_f64()) {
                        ring.push(vec![lon, lat]);
                    }
                }
            }
        }
    }
    ring
}

/// Does the geometry (Polygon or MultiPolygon) contain (lon, lat)?
fn geometry_contains(lon: f64, lat: f64, geometry: &Value) -> bool {
    let gtype = geometry.get("type").and_then(|t| t.as_str()).unwrap_or("");
    let coords = match geometry.get("coordinates") {
        Some(c) => c,
        None => return false,
    };
    match gtype {
        "Polygon" => {
            if let Value::Array(rings) = coords {
                let parsed: Vec<Vec<Vec<f64>>> = rings.iter().map(parse_ring).collect();
                point_in_polygon(lon, lat, &parsed)
            } else {
                false
            }
        }
        "MultiPolygon" => {
            if let Value::Array(polys) = coords {
                polys.iter().any(|poly| {
                    if let Value::Array(rings) = poly {
                        let parsed: Vec<Vec<Vec<f64>>> = rings.iter().map(parse_ring).collect();
                        point_in_polygon(lon, lat, &parsed)
                    } else {
                        false
                    }
                })
            } else {
                false
            }
        }
        _ => false,
    }
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ParcelImportResult {
    pub imported: usize,
    pub skipped: usize,
    pub total: i64,
}

/// Import a parcels GeoJSON file (FeatureCollection) from a local path. Each
/// feature's geometry must be WGS84 lon/lat (the default for ArcGIS/NJGIN GeoJSON
/// exports). Stores bbox + geometry + mapped MOD-IV attributes for later
/// point-in-polygon lookup. The file is read by the Rust backend (handles large
/// county files); parsing is done in one pass inside a transaction.
pub fn import_parcels(
    db: &Db,
    path: String,
    source: Option<String>,
) -> Result<ParcelImportResult, String> {
    let text = std::fs::read_to_string(&path)
        .map_err(|e| format!("could not read file {path}: {e}"))?;
    let root: Value = serde_json::from_str(&text)
        .map_err(|e| format!("could not parse GeoJSON: {e}"))?;

    let features = root
        .get("features")
        .and_then(|f| f.as_array())
        .ok_or_else(|| "not a GeoJSON FeatureCollection (no 'features' array)".to_string())?;

    let source = source.unwrap_or_else(|| {
        std::path::Path::new(&path)
            .file_name()
            .map(|n| n.to_string_lossy().to_string())
            .unwrap_or_else(|| "parcel import".to_string())
    });
    let now = Utc::now().to_rfc3339();

    let mut imported = 0usize;
    let mut skipped = 0usize;

    {
        let mut conn = db.0.lock().map_err(|e| e.to_string())?;
        let tx = conn.transaction().map_err(|e| e.to_string())?;
        {
            let mut stmt = tx
                .prepare(
                    "INSERT OR REPLACE INTO parcels (
                        id, source, municipality, county, block, lot, qualifier,
                        property_class, address, land_assessment, improvement_assessment,
                        total_assessment, annual_taxes, owner_name,
                        min_lon, min_lat, max_lon, max_lat, geometry_json, imported_at
                     ) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15,?16,?17,?18,?19,?20)",
                )
                .map_err(|e| e.to_string())?;

            for feat in features {
                let geometry = match feat.get("geometry") {
                    Some(g) if !g.is_null() => g,
                    _ => {
                        skipped += 1;
                        continue;
                    }
                };
                let coords = match geometry.get("coordinates") {
                    Some(c) => c,
                    None => {
                        skipped += 1;
                        continue;
                    }
                };
                let bb = match bbox(coords) {
                    Some(b) => b,
                    None => {
                        skipped += 1;
                        continue;
                    }
                };

                let empty = serde_json::Map::new();
                let props = feat
                    .get("properties")
                    .and_then(|p| p.as_object())
                    .unwrap_or(&empty);
                let a = map_attrs(props);
                let id = a
                    .id
                    .clone()
                    .filter(|s| !s.trim().is_empty())
                    .unwrap_or_else(|| Uuid::new_v4().to_string());

                stmt.execute(rusqlite::params![
                    id,
                    source,
                    a.municipality,
                    a.county,
                    a.block,
                    a.lot,
                    a.qualifier,
                    a.property_class,
                    a.address,
                    a.land,
                    a.improvement,
                    a.total,
                    a.taxes,
                    a.owner,
                    bb.0,
                    bb.1,
                    bb.2,
                    bb.3,
                    geometry.to_string(),
                    now,
                ])
                .map_err(|e| e.to_string())?;
                imported += 1;
            }
        }
        tx.commit().map_err(|e| e.to_string())?;
    }

    let total = parcels_count(db)?;
    Ok(ParcelImportResult {
        imported,
        skipped,
        total,
    })
}

/// How many parcels are currently installed locally.
pub fn parcels_count(db: &Db) -> Result<i64, String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    conn.query_row("SELECT COUNT(*) FROM parcels", [], |row| row.get(0))
        .map_err(|e| e.to_string())
}

/// Delete the entire installed parcel dataset (e.g. before installing another).
pub fn clear_parcels(db: &Db) -> Result<i64, String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    let deleted = conn
        .execute("DELETE FROM parcels", [])
        .map_err(|e| e.to_string())?;
    Ok(deleted as i64)
}

/// Read the stored matched parcel for a property (no lookup), if any.
pub fn get_parcel(db: &Db, property_id: String) -> Result<Option<ParcelResult>, String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    let sql = format!(
        "SELECT {PARCEL_COLUMNS} FROM parcel_results WHERE property_id = ?1 \
         ORDER BY fetched_at DESC LIMIT 1"
    );
    conn.query_row(&sql, [&property_id], ParcelResult::from_row)
        .map(Some)
        .or_else(|e| match e {
            rusqlite::Error::QueryReturnedNoRows => Ok(None),
            other => Err(other.to_string()),
        })
}

/// Match a geocoded property to a parcel polygon that contains its point, using a
/// bbox pre-filter then a ray-casting containment test. Stores the matched
/// attributes into `parcel_results` (replacing any prior auto/manual row).
pub fn lookup_parcel(db: &Db, property_id: String) -> Result<ParcelResult, String> {
    let (lon, lat) = {
        let conn = db.0.lock().map_err(|e| e.to_string())?;
        let coords: (Option<f64>, Option<f64>) = conn
            .query_row(
                "SELECT longitude, latitude FROM properties WHERE id = ?1",
                [&property_id],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .map_err(|e| match e {
                rusqlite::Error::QueryReturnedNoRows => "property not found".to_string(),
                other => other.to_string(),
            })?;
        match coords {
            (Some(lo), Some(la)) => (lo, la),
            _ => return Err("property has no coordinates yet (geocode it first)".into()),
        }
    };

    // Find the containing parcel (bbox pre-filter, then exact containment test).
    let matched = {
        let conn = db.0.lock().map_err(|e| e.to_string())?;
        let total: i64 = conn
            .query_row("SELECT COUNT(*) FROM parcels", [], |row| row.get(0))
            .map_err(|e| e.to_string())?;
        if total == 0 {
            return Err("no parcel dataset installed (import one in Settings)".into());
        }

        let mut stmt = conn
            .prepare(
                "SELECT id, source, municipality, county, block, lot, qualifier, property_class, \
                 land_assessment, improvement_assessment, total_assessment, annual_taxes, \
                 owner_name, geometry_json FROM parcels \
                 WHERE min_lon <= ?1 AND max_lon >= ?1 AND min_lat <= ?2 AND max_lat >= ?2",
            )
            .map_err(|e| e.to_string())?;
        let mut rows = stmt
            .query(rusqlite::params![lon, lat])
            .map_err(|e| e.to_string())?;

        let mut found: Option<ParcelAttrs> = None;
        while let Some(row) = rows.next().map_err(|e| e.to_string())? {
            let geometry_json: String = row.get(13).map_err(|e| e.to_string())?;
            let geometry: Value = match serde_json::from_str(&geometry_json) {
                Ok(g) => g,
                Err(_) => continue,
            };
            if geometry_contains(lon, lat, &geometry) {
                found = Some(ParcelAttrs {
                    id: row.get::<_, Option<String>>(0).map_err(|e| e.to_string())?,
                    municipality: row.get(2).map_err(|e| e.to_string())?,
                    county: row.get(3).map_err(|e| e.to_string())?,
                    block: row.get(4).map_err(|e| e.to_string())?,
                    lot: row.get(5).map_err(|e| e.to_string())?,
                    qualifier: row.get(6).map_err(|e| e.to_string())?,
                    property_class: row.get(7).map_err(|e| e.to_string())?,
                    address: None,
                    land: row.get(8).map_err(|e| e.to_string())?,
                    improvement: row.get(9).map_err(|e| e.to_string())?,
                    total: row.get(10).map_err(|e| e.to_string())?,
                    taxes: row.get(11).map_err(|e| e.to_string())?,
                    owner: row.get(12).map_err(|e| e.to_string())?,
                });
                break;
            }
        }
        found
    };

    let a = matched.ok_or_else(|| {
        "no parcel polygon contains this property's point (check the dataset covers this area)"
            .to_string()
    })?;

    write_parcel(db, &property_id, "njgin_parcel", &a)?;
    get_parcel(db, property_id)?
        .ok_or_else(|| "parcel disappeared after write".to_string())
}

/// Manual parcel-field input from the UI (brief: user can override parcel fields).
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ParcelInput {
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
}

/// Save manual parcel fields for a property (replaces any prior row, source `manual`).
pub fn set_parcel(
    db: &Db,
    property_id: String,
    parcel: ParcelInput,
) -> Result<ParcelResult, String> {
    let clean = |s: Option<String>| s.map(|v| v.trim().to_string()).filter(|v| !v.is_empty());
    let a = ParcelAttrs {
        id: None,
        municipality: clean(parcel.municipality),
        county: clean(parcel.county),
        block: clean(parcel.block),
        lot: clean(parcel.lot),
        qualifier: clean(parcel.qualifier),
        property_class: clean(parcel.property_class),
        address: None,
        land: parcel.land_assessment,
        improvement: parcel.improvement_assessment,
        total: parcel.total_assessment,
        taxes: parcel.annual_taxes,
        owner: clean(parcel.owner_name),
    };
    write_parcel(db, &property_id, "manual", &a)?;
    get_parcel(db, property_id)?
        .ok_or_else(|| "parcel disappeared after write".to_string())
}

/// Delete the stored parcel record for a property.
pub fn delete_parcel(db: &Db, property_id: String) -> Result<(), String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    conn.execute(
        "DELETE FROM parcel_results WHERE property_id = ?1",
        [&property_id],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

/// Replace the parcel_results row for a property with the given attributes.
fn write_parcel(
    db: &Db,
    property_id: &str,
    source: &str,
    a: &ParcelAttrs,
) -> Result<(), String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    let now = Utc::now().to_rfc3339();
    conn.execute(
        "DELETE FROM parcel_results WHERE property_id = ?1",
        [property_id],
    )
    .map_err(|e| e.to_string())?;
    conn.execute(
        "INSERT INTO parcel_results (
            id, property_id, source, municipality, county, block, lot, qualifier,
            property_class, land_assessment, improvement_assessment, total_assessment,
            annual_taxes, owner_name, raw_json, fetched_at
         ) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,NULL,?15)",
        rusqlite::params![
            Uuid::new_v4().to_string(),
            property_id,
            source,
            a.municipality,
            a.county,
            a.block,
            a.lot,
            a.qualifier,
            a.property_class,
            a.land,
            a.improvement,
            a.total,
            a.taxes,
            a.owner,
            now,
        ],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}
