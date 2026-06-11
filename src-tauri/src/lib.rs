//! Tauri desktop shell. This is intentionally thin: every command delegates to
//! `homelens_core`, which holds all business logic and is also used by the
//! `homelens-server` web shell. The only desktop-specific concerns here are the
//! Tauri plugins (opener, dialog), the MCP dev bridge, and resolving the
//! per-user app-data directory for the SQLite database.

use std::sync::Mutex;

use tauri::{Manager, State};

use homelens_core as core;
use homelens_core::Db;

// ----- settings -----

#[tauri::command]
fn get_setting(db: State<'_, Db>, key: String) -> Result<Option<String>, String> {
    core::commands::get_setting(db.inner(), key)
}

#[tauri::command]
fn get_all_settings(db: State<'_, Db>) -> Result<std::collections::HashMap<String, String>, String> {
    core::commands::get_all_settings(db.inner())
}

#[tauri::command]
fn set_setting(db: State<'_, Db>, key: String, value: String) -> Result<(), String> {
    core::commands::set_setting(db.inner(), key, value)
}

#[tauri::command]
fn set_settings(db: State<'_, Db>, values: std::collections::HashMap<String, String>) -> Result<(), String> {
    core::commands::set_settings(db.inner(), values)
}

// ----- properties -----

#[tauri::command]
async fn create_property(
    db: State<'_, Db>,
    property: core::properties::NewProperty,
) -> Result<core::properties::CreatePropertyResult, String> {
    core::properties::create_property(db.inner(), property).await
}

#[tauri::command]
fn list_properties(db: State<'_, Db>) -> Result<Vec<core::models::Property>, String> {
    core::properties::list_properties(db.inner())
}

#[tauri::command]
fn get_property(db: State<'_, Db>, id: String) -> Result<Option<core::models::Property>, String> {
    core::properties::get_property(db.inner(), id)
}

#[tauri::command]
fn delete_property(db: State<'_, Db>, id: String) -> Result<(), String> {
    core::properties::delete_property(db.inner(), id)
}

#[tauri::command]
fn update_property(
    db: State<'_, Db>,
    id: String,
    update: core::properties::PropertyUpdate,
) -> Result<core::models::Property, String> {
    core::properties::update_property(db.inner(), id, update)
}

#[tauri::command]
fn list_external_links(
    db: State<'_, Db>,
    property_id: String,
) -> Result<Vec<core::models::ExternalLink>, String> {
    core::properties::list_external_links(db.inner(), property_id)
}

#[tauri::command]
fn add_external_link(
    db: State<'_, Db>,
    property_id: String,
    label: String,
    url: String,
) -> Result<core::models::ExternalLink, String> {
    core::properties::add_external_link(db.inner(), property_id, label, url)
}

#[tauri::command]
fn delete_external_link(db: State<'_, Db>, id: String) -> Result<(), String> {
    core::properties::delete_external_link(db.inner(), id)
}

// ----- listing autofill -----

#[tauri::command]
async fn fetch_listing_metadata(url: String) -> Result<core::listing::ListingMetadata, String> {
    core::listing::fetch_listing_metadata(url).await
}

// ----- family / routes / isochrones -----

#[tauri::command]
async fn compute_routes(
    db: State<'_, Db>,
    property_id: String,
) -> Result<core::family::ComputeRoutesResult, String> {
    core::family::compute_routes(db.inner(), property_id).await
}

#[tauri::command]
fn get_routes(db: State<'_, Db>, property_id: String) -> Result<Vec<core::models::RouteResult>, String> {
    core::family::get_routes(db.inner(), property_id)
}

#[tauri::command]
fn list_all_routes(db: State<'_, Db>) -> Result<Vec<core::models::RouteResult>, String> {
    core::family::list_all_routes(db.inner())
}

#[tauri::command]
async fn geocode_family(db: State<'_, Db>) -> Result<Vec<core::family::FamilyLocation>, String> {
    core::family::geocode_family(db.inner()).await
}

#[tauri::command]
fn get_family_locations(db: State<'_, Db>) -> Result<Vec<core::family::FamilyLocation>, String> {
    core::family::get_family_locations(db.inner())
}

#[tauri::command]
async fn compute_family_isochrones(
    db: State<'_, Db>,
    range_seconds: i64,
) -> Result<core::family::FamilyIsochrones, String> {
    core::family::compute_family_isochrones(db.inner(), range_seconds).await
}

#[tauri::command]
fn get_family_isochrones(
    db: State<'_, Db>,
    range_seconds: Option<i64>,
) -> Result<core::family::FamilyIsochrones, String> {
    core::family::get_family_isochrones(db.inner(), range_seconds)
}

// ----- amenities -----

#[tauri::command]
fn get_amenity_categories() -> Vec<core::amenities::AmenityCategoryInfo> {
    core::amenities::get_amenity_categories()
}

#[tauri::command]
fn get_amenities(db: State<'_, Db>, property_id: String) -> Result<Vec<core::models::AmenityResult>, String> {
    core::amenities::get_amenities(db.inner(), property_id)
}

#[tauri::command]
fn list_all_amenities(db: State<'_, Db>) -> Result<Vec<core::models::AmenityResult>, String> {
    core::amenities::list_all_amenities(db.inner())
}

#[tauri::command]
async fn compute_amenities(
    db: State<'_, Db>,
    property_id: String,
    categories: Option<Vec<String>>,
) -> Result<core::amenities::ComputeAmenitiesResult, String> {
    core::amenities::compute_amenities(db.inner(), property_id, categories).await
}

// ----- schools -----

#[tauri::command]
fn get_schools(db: State<'_, Db>, property_id: String) -> Result<Vec<core::models::SchoolResult>, String> {
    core::schools::get_schools(db.inner(), property_id)
}

#[tauri::command]
async fn compute_schools(
    db: State<'_, Db>,
    property_id: String,
) -> Result<Vec<core::models::SchoolResult>, String> {
    core::schools::compute_schools(db.inner(), property_id).await
}

#[tauri::command]
fn import_njdoe_schools(
    db: State<'_, Db>,
    records: Vec<core::schools::NjdoeSchoolInput>,
    source: Option<String>,
) -> Result<core::schools::ImportResult, String> {
    core::schools::import_njdoe_schools(db.inner(), records, source)
}

#[tauri::command]
fn njdoe_count(db: State<'_, Db>) -> Result<i64, String> {
    core::schools::njdoe_count(db.inner())
}

#[tauri::command]
fn clear_njdoe_schools(db: State<'_, Db>) -> Result<i64, String> {
    core::schools::clear_njdoe_schools(db.inner())
}

#[tauri::command]
fn list_njdoe_schools(
    db: State<'_, Db>,
    search: Option<String>,
    limit: Option<i64>,
) -> Result<Vec<core::models::NjdoeSchool>, String> {
    core::schools::list_njdoe_schools(db.inner(), search, limit)
}

#[tauri::command]
fn match_school_to_njdoe(
    db: State<'_, Db>,
    school_result_id: String,
    njdoe_id: Option<String>,
) -> Result<core::models::SchoolResult, String> {
    core::schools::match_school_to_njdoe(db.inner(), school_result_id, njdoe_id)
}

#[tauri::command]
fn set_assigned_schools(
    db: State<'_, Db>,
    property_id: String,
    elementary: Option<String>,
    middle: Option<String>,
    high: Option<String>,
) -> Result<(), String> {
    core::schools::set_assigned_schools(db.inner(), property_id, elementary, middle, high)
}

// ----- parcels -----

#[tauri::command]
fn import_parcels(
    db: State<'_, Db>,
    path: String,
    source: Option<String>,
) -> Result<core::parcels::ParcelImportResult, String> {
    core::parcels::import_parcels(db.inner(), path, source)
}

#[tauri::command]
fn parcels_count(db: State<'_, Db>) -> Result<i64, String> {
    core::parcels::parcels_count(db.inner())
}

#[tauri::command]
fn clear_parcels(db: State<'_, Db>) -> Result<i64, String> {
    core::parcels::clear_parcels(db.inner())
}

#[tauri::command]
fn get_parcel(db: State<'_, Db>, property_id: String) -> Result<Option<core::models::ParcelResult>, String> {
    core::parcels::get_parcel(db.inner(), property_id)
}

#[tauri::command]
fn lookup_parcel(db: State<'_, Db>, property_id: String) -> Result<core::models::ParcelResult, String> {
    core::parcels::lookup_parcel(db.inner(), property_id)
}

#[tauri::command]
fn set_parcel(
    db: State<'_, Db>,
    property_id: String,
    parcel: core::parcels::ParcelInput,
) -> Result<core::models::ParcelResult, String> {
    core::parcels::set_parcel(db.inner(), property_id, parcel)
}

#[tauri::command]
fn delete_parcel(db: State<'_, Db>, property_id: String) -> Result<(), String> {
    core::parcels::delete_parcel(db.inner(), property_id)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let mut builder = tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init());

    // Dev-only MCP bridge so the Tauri MCP server can inspect/drive the running app.
    // Bound to localhost; never enabled in release builds.
    #[cfg(debug_assertions)]
    {
        builder = builder.plugin(tauri_plugin_mcp_bridge::init_with_config(
            tauri_plugin_mcp_bridge::Config::localhost_only(),
        ));
    }

    builder
        .setup(|app| {
            let dir = app
                .path()
                .app_data_dir()
                .map_err(|e| format!("could not resolve app data dir: {e}"))?;
            let db_path = dir.join("homelens.db");
            let conn = core::db::open_at(&db_path).map_err(|e| {
                eprintln!("database initialization failed: {e}");
                std::io::Error::new(std::io::ErrorKind::Other, e)
            })?;
            app.manage(Db(Mutex::new(conn)));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_setting,
            get_all_settings,
            set_setting,
            set_settings,
            create_property,
            list_properties,
            get_property,
            delete_property,
            update_property,
            list_external_links,
            add_external_link,
            delete_external_link,
            fetch_listing_metadata,
            compute_routes,
            get_routes,
            list_all_routes,
            geocode_family,
            get_family_locations,
            compute_family_isochrones,
            get_family_isochrones,
            get_amenity_categories,
            get_amenities,
            list_all_amenities,
            compute_amenities,
            get_schools,
            compute_schools,
            import_njdoe_schools,
            njdoe_count,
            clear_njdoe_schools,
            list_njdoe_schools,
            match_school_to_njdoe,
            set_assigned_schools,
            import_parcels,
            parcels_count,
            clear_parcels,
            get_parcel,
            lookup_parcel,
            set_parcel,
            delete_parcel,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
