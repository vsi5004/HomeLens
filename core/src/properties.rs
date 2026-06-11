use chrono::Utc;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::db::Db;
use crate::geocoding;
use crate::models::{ExternalLink, Property, EXTERNAL_LINK_COLUMNS, PROPERTY_COLUMNS};
use crate::settings_store::read_setting;

/// Input for creating a property. Everything beyond the address is optional at
/// creation time; richer listing fields are edited later.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NewProperty {
    pub address_input: String,
    pub listing_url: Option<String>,
    pub list_price: Option<i64>,
    pub photo_url: Option<String>,
}

/// Result of creating a property. `geocode_error` is populated (and the property
/// still saved) when geocoding could not run or returned nothing — partial
/// results instead of a hard failure (brief §16).
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CreatePropertyResult {
    pub property: Property,
    pub geocode_error: Option<String>,
}
pub async fn create_property(
    db: &Db,
    property: NewProperty,
) -> Result<CreatePropertyResult, String> {
    let address = property.address_input.trim().to_string();
    if address.is_empty() {
        return Err("address is required".into());
    }

    // Read the private web-service key (no await while the lock is held).
    let api_key = {
        let conn = db.0.lock().map_err(|e| e.to_string())?;
        read_setting(&conn, "google_webservice_key")?.unwrap_or_default()
    };

    // Geocode on save (Decision 3). Best-effort: capture the error but continue.
    let geocode = geocoding::geocode(&address, &api_key).await;
    let (geo, geocode_error) = match geocode {
        Ok(g) => (Some(g), None),
        Err(e) => (None, Some(e)),
    };

    let id = Uuid::new_v4().to_string();
    let now = Utc::now().to_rfc3339();

    {
        let conn = db.0.lock().map_err(|e| e.to_string())?;
        conn.execute(
            "INSERT INTO properties (
                id, created_at, updated_at, status,
                address_input, address_normalized, street, city, state, zip, county,
                latitude, longitude, listing_url, list_price, photo_url
            ) VALUES (
                ?1, ?2, ?3, 'new',
                ?4, ?5, ?6, ?7, ?8, ?9, ?10,
                ?11, ?12, ?13, ?14, ?15
            )",
            rusqlite::params![
                id,
                now,
                now,
                address,
                geo.as_ref().map(|g| g.normalized_address.clone()),
                geo.as_ref().and_then(|g| g.street.clone()),
                geo.as_ref().and_then(|g| g.city.clone()),
                geo.as_ref().and_then(|g| g.state.clone()),
                geo.as_ref().and_then(|g| g.zip.clone()),
                geo.as_ref().and_then(|g| g.county.clone()),
                geo.as_ref().map(|g| g.latitude),
                geo.as_ref().map(|g| g.longitude),
                property.listing_url,
                property.list_price,
                property.photo_url,
            ],
        )
        .map_err(|e| e.to_string())?;
    }

    let created = get_property(db, id)?
        .ok_or_else(|| "property disappeared immediately after insert".to_string())?;

    Ok(CreatePropertyResult {
        property: created,
        geocode_error,
    })
}
pub fn list_properties(db: &Db) -> Result<Vec<Property>, String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    let sql = format!("SELECT {PROPERTY_COLUMNS} FROM properties ORDER BY created_at DESC");
    let mut stmt = conn.prepare(&sql).map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([], Property::from_row)
        .map_err(|e| e.to_string())?;

    let mut out = Vec::new();
    for r in rows {
        out.push(r.map_err(|e| e.to_string())?);
    }
    Ok(out)
}
pub fn get_property(db: &Db, id: String) -> Result<Option<Property>, String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    let sql = format!("SELECT {PROPERTY_COLUMNS} FROM properties WHERE id = ?1");
    conn.query_row(&sql, [&id], Property::from_row)
        .map(Some)
        .or_else(|e| match e {
            rusqlite::Error::QueryReturnedNoRows => Ok(None),
            other => Err(other.to_string()),
        })
}
pub fn delete_property(db: &Db, id: String) -> Result<(), String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    conn.execute("DELETE FROM properties WHERE id = ?1", [&id])
        .map_err(|e| e.to_string())?;
    Ok(())
}

/// Editable listing/manual fields for a property. Every field is overwritten
/// (a `null` clears the column), so the frontend sends the full current form.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PropertyUpdate {
    pub status: Option<String>,
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
    pub subjective_score: Option<i64>,
    pub manual_school_score: Option<i64>,
    pub manual_property_value_score: Option<i64>,
    pub notes: Option<String>,
    pub photo_url: Option<String>,
}
pub fn update_property(
    db: &Db,
    id: String,
    update: PropertyUpdate,
) -> Result<Property, String> {
    {
        let conn = db.0.lock().map_err(|e| e.to_string())?;
        let now = Utc::now().to_rfc3339();
        let status = update.status.unwrap_or_else(|| "new".to_string());
        let affected = conn
            .execute(
                "UPDATE properties SET
                    status = ?2, listing_url = ?3, listing_source = ?4, list_price = ?5,
                    manual_estimated_value = ?6, annual_taxes = ?7, hoa_monthly = ?8,
                    beds = ?9, baths = ?10, sqft = ?11, lot_size = ?12, year_built = ?13,
                    property_type = ?14, subjective_score = ?15, manual_school_score = ?16,
                    manual_property_value_score = ?17, notes = ?18, photo_url = ?19,
                    updated_at = ?20
                 WHERE id = ?1",
                rusqlite::params![
                    id,
                    status,
                    update.listing_url,
                    update.listing_source,
                    update.list_price,
                    update.manual_estimated_value,
                    update.annual_taxes,
                    update.hoa_monthly,
                    update.beds,
                    update.baths,
                    update.sqft,
                    update.lot_size,
                    update.year_built,
                    update.property_type,
                    update.subjective_score,
                    update.manual_school_score,
                    update.manual_property_value_score,
                    update.notes,
                    update.photo_url,
                    now,
                ],
            )
            .map_err(|e| e.to_string())?;
        if affected == 0 {
            return Err("property not found".into());
        }
    }

    get_property(db, id)?.ok_or_else(|| "property disappeared after update".to_string())
}
pub fn list_external_links(
    db: &Db,
    property_id: String,
) -> Result<Vec<ExternalLink>, String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    let sql = format!(
        "SELECT {EXTERNAL_LINK_COLUMNS} FROM external_links \
         WHERE property_id = ?1 ORDER BY created_at ASC"
    );
    let mut stmt = conn.prepare(&sql).map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([&property_id], ExternalLink::from_row)
        .map_err(|e| e.to_string())?;
    let mut out = Vec::new();
    for r in rows {
        out.push(r.map_err(|e| e.to_string())?);
    }
    Ok(out)
}
pub fn add_external_link(
    db: &Db,
    property_id: String,
    label: String,
    url: String,
) -> Result<ExternalLink, String> {
    let label = label.trim().to_string();
    let url = url.trim().to_string();
    if url.is_empty() {
        return Err("url is required".into());
    }
    let id = Uuid::new_v4().to_string();
    let now = Utc::now().to_rfc3339();
    {
        let conn = db.0.lock().map_err(|e| e.to_string())?;
        conn.execute(
            "INSERT INTO external_links (id, property_id, label, url, created_at) \
             VALUES (?1, ?2, ?3, ?4, ?5)",
            rusqlite::params![id, property_id, label, url, now],
        )
        .map_err(|e| e.to_string())?;
    }
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    let sql = format!("SELECT {EXTERNAL_LINK_COLUMNS} FROM external_links WHERE id = ?1");
    conn.query_row(&sql, [&id], ExternalLink::from_row)
        .map_err(|e| e.to_string())
}
pub fn delete_external_link(db: &Db, id: String) -> Result<(), String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    conn.execute("DELETE FROM external_links WHERE id = ?1", [&id])
        .map_err(|e| e.to_string())?;
    Ok(())
}
