//! HomeLens LAN web server.
//!
//! A thin HTTP shell over `homelens_core`, mirroring the Tauri command surface so
//! the same React frontend works unchanged (the frontend's transport shim points
//! at `/api/<command>` when not running inside Tauri). Designed for single-user /
//! low-concurrency use on a trusted home network.
//!
//! Config via environment variables:
//!   HOMELENS_DB     path to the SQLite file        (default: ./homelens.db)
//!   HOMELENS_BIND   address:port to bind           (default: 0.0.0.0:8080)
//!   HOMELENS_STATIC directory of built frontend    (default: ./dist)
//!   HOMELENS_MAX_UPLOAD_MB  max parcel-upload size in MB  (default: 512)

use std::net::SocketAddr;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};

use axum::{
    extract::{DefaultBodyLimit, Multipart, Path, State},
    http::StatusCode,
    response::IntoResponse,
    routing::{get, post},
    Json, Router,
};
use serde::de::DeserializeOwned;
use serde_json::Value;
use tower_http::cors::CorsLayer;
use tower_http::services::ServeDir;

use homelens_core as core;
use homelens_core::Db;

#[derive(Clone)]
struct AppState {
    db: Arc<Db>,
}

type ApiError = (StatusCode, String);

/// Pull a (possibly optional) named field out of the JSON body, mirroring the
/// argument object that Tauri's `invoke` sends. Missing keys deserialize as the
/// type's representation of `null` (so `Option<_>` fields become `None`).
fn field<T: DeserializeOwned>(body: &Value, key: &str) -> Result<T, ApiError> {
    let raw = body.get(key).cloned().unwrap_or(Value::Null);
    serde_json::from_value(raw).map_err(|e| (StatusCode::BAD_REQUEST, format!("field '{key}': {e}")))
}

/// Wrap a `core` result (`Result<T, String>`) into an HTTP-friendly JSON result.
fn ok<T: serde::Serialize>(r: Result<T, String>) -> Result<Json<Value>, ApiError> {
    match r {
        Ok(v) => serde_json::to_value(v)
            .map(Json)
            .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string())),
        Err(e) => Err((StatusCode::BAD_REQUEST, e)),
    }
}

/// Single dispatch endpoint: `POST /api/:cmd` with a JSON body of named args,
/// exactly matching what the desktop app passes to `invoke(cmd, args)`.
async fn dispatch(
    State(st): State<AppState>,
    Path(cmd): Path<String>,
    body: Option<Json<Value>>,
) -> Result<Json<Value>, ApiError> {
    let b = body.map(|Json(v)| v).unwrap_or(Value::Null);
    let db = st.db.as_ref();

    match cmd.as_str() {
        // ----- settings -----
        "get_setting" => ok(core::commands::get_setting(db, field(&b, "key")?)),
        "get_all_settings" => ok(core::commands::get_all_settings(db)),
        "set_setting" => ok(core::commands::set_setting(
            db,
            field(&b, "key")?,
            field(&b, "value")?,
        )),
        "set_settings" => ok(core::commands::set_settings(db, field(&b, "values")?)),

        // ----- properties -----
        "create_property" => ok(core::properties::create_property(db, field(&b, "property")?).await),
        "list_properties" => ok(core::properties::list_properties(db)),
        "get_property" => ok(core::properties::get_property(db, field(&b, "id")?)),
        "delete_property" => ok(core::properties::delete_property(db, field(&b, "id")?)),
        "update_property" => ok(core::properties::update_property(
            db,
            field(&b, "id")?,
            field(&b, "update")?,
        )),
        "list_external_links" => {
            ok(core::properties::list_external_links(db, field(&b, "propertyId")?))
        }
        "add_external_link" => ok(core::properties::add_external_link(
            db,
            field(&b, "propertyId")?,
            field(&b, "label")?,
            field(&b, "url")?,
        )),
        "delete_external_link" => ok(core::properties::delete_external_link(db, field(&b, "id")?)),

        // ----- listing autofill -----
        "fetch_listing_metadata" => {
            ok(core::listing::fetch_listing_metadata(field(&b, "url")?).await)
        }

        // ----- family / routes / isochrones -----
        "compute_routes" => ok(core::family::compute_routes(db, field(&b, "propertyId")?).await),
        "get_routes" => ok(core::family::get_routes(db, field(&b, "propertyId")?)),
        "list_all_routes" => ok(core::family::list_all_routes(db)),
        "geocode_family" => ok(core::family::geocode_family(db).await),
        "get_family_locations" => ok(core::family::get_family_locations(db)),
        "compute_family_isochrones" => ok(core::family::compute_family_isochrones(
            db,
            field(&b, "rangeSeconds")?,
        )
        .await),
        "get_family_isochrones" => ok(core::family::get_family_isochrones(
            db,
            field(&b, "rangeSeconds")?,
        )),

        // ----- amenities -----
        "get_amenity_categories" => serde_json::to_value(core::amenities::get_amenity_categories())
            .map(Json)
            .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string())),
        "get_amenities" => ok(core::amenities::get_amenities(db, field(&b, "propertyId")?)),
        "list_all_amenities" => ok(core::amenities::list_all_amenities(db)),
        "compute_amenities" => ok(core::amenities::compute_amenities(
            db,
            field(&b, "propertyId")?,
            field(&b, "categories")?,
        )
        .await),

        // ----- schools -----
        "get_schools" => ok(core::schools::get_schools(db, field(&b, "propertyId")?)),
        "list_all_school_results" => ok(core::schools::list_all_school_results(db)),
        "compute_schools" => ok(core::schools::compute_schools(db, field(&b, "propertyId")?).await),
        "import_njdoe_schools" => ok(core::schools::import_njdoe_schools(
            db,
            field(&b, "records")?,
            field(&b, "source")?,
        )),
        "njdoe_count" => ok(core::schools::njdoe_count(db)),
        "clear_njdoe_schools" => ok(core::schools::clear_njdoe_schools(db)),
        "list_njdoe_schools" => ok(core::schools::list_njdoe_schools(
            db,
            field(&b, "search")?,
            field(&b, "limit")?,
        )),
        "match_school_to_njdoe" => ok(core::schools::match_school_to_njdoe(
            db,
            field(&b, "schoolResultId")?,
            field(&b, "njdoeId")?,
        )),
        "set_assigned_schools" => ok(core::schools::set_assigned_schools(
            db,
            field(&b, "propertyId")?,
            field(&b, "elementary")?,
            field(&b, "middle")?,
            field(&b, "high")?,
        )),

        // ----- parcels (import handled by the dedicated upload route) -----
        "parcels_count" => ok(core::parcels::parcels_count(db)),
        "clear_parcels" => ok(core::parcels::clear_parcels(db)),
        "get_parcel" => ok(core::parcels::get_parcel(db, field(&b, "propertyId")?)),
        "lookup_parcel" => ok(core::parcels::lookup_parcel(db, field(&b, "propertyId")?)),
        "set_parcel" => ok(core::parcels::set_parcel(
            db,
            field(&b, "propertyId")?,
            field(&b, "parcel")?,
        )),
        "delete_parcel" => ok(core::parcels::delete_parcel(db, field(&b, "propertyId")?)),

        "import_parcels" => Err((
            StatusCode::BAD_REQUEST,
            "use POST /api/import_parcels (multipart upload) in web mode".to_string(),
        )),

        other => Err((StatusCode::NOT_FOUND, format!("unknown command '{other}'"))),
    }
}

/// Parcel dataset upload (web equivalent of the desktop native file picker).
/// Accepts a multipart form with a `file` part (the GeoJSON) and an optional
/// `source` text part. The bytes are written to a temp file so the existing
/// `core::parcels::import_parcels` (which reads from a path) works unchanged.
async fn import_parcels_upload(
    State(st): State<AppState>,
    mut multipart: Multipart,
) -> Result<Json<Value>, ApiError> {
    let mut source: Option<String> = None;
    let mut bytes: Option<Vec<u8>> = None;
    let mut filename: Option<String> = None;

    while let Some(part) = multipart
        .next_field()
        .await
        .map_err(|e| (StatusCode::BAD_REQUEST, format!("multipart error: {e}")))?
    {
        match part.name() {
            Some("source") => {
                source = Some(
                    part.text()
                        .await
                        .map_err(|e| (StatusCode::BAD_REQUEST, e.to_string()))?,
                );
            }
            Some("file") => {
                filename = part.file_name().map(|s| s.to_string());
                bytes = Some(
                    part.bytes()
                        .await
                        .map_err(|e| (StatusCode::BAD_REQUEST, e.to_string()))?
                        .to_vec(),
                );
            }
            _ => {}
        }
    }

    let bytes = bytes.ok_or((StatusCode::BAD_REQUEST, "missing 'file' part".to_string()))?;
    if source.as_deref().map(str::trim).unwrap_or("").is_empty() {
        source = filename;
    }

    let tmp = tempfile::Builder::new()
        .prefix("homelens-parcels-")
        .suffix(".geojson")
        .tempfile()
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    std::fs::write(tmp.path(), &bytes)
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    let path = tmp.path().to_string_lossy().to_string();

    ok(core::parcels::import_parcels(st.db.as_ref(), path, source))
}

async fn healthz() -> impl IntoResponse {
    (StatusCode::OK, "ok")
}

#[tokio::main]
async fn main() {
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "homelens_server=info,tower_http=info".into()),
        )
        .init();

    let db_path =
        PathBuf::from(std::env::var("HOMELENS_DB").unwrap_or_else(|_| "homelens.db".to_string()));
    let static_dir =
        std::env::var("HOMELENS_STATIC").unwrap_or_else(|_| "dist".to_string());
    let bind: SocketAddr = std::env::var("HOMELENS_BIND")
        .unwrap_or_else(|_| "0.0.0.0:8080".to_string())
        .parse()
        .expect("HOMELENS_BIND must be a valid address:port");
    // Max multipart upload size (parcel GeoJSON). A whole NJ county joined to
    // MOD-IV can exceed the old 256 MB cap; the upload is buffered in memory and
    // the JSON parse multiplies that, so keep this sane for the host's RAM.
    let max_upload_mb: usize = std::env::var("HOMELENS_MAX_UPLOAD_MB")
        .ok()
        .and_then(|v| v.parse().ok())
        .filter(|&mb| mb > 0)
        .unwrap_or(512);

    let conn = core::db::open_at(&db_path).expect("failed to open database");
    let state = AppState {
        db: Arc::new(Db(Mutex::new(conn))),
    };

    tracing::info!("database: {}", db_path.display());
    tracing::info!("serving static files from: {static_dir}");

    // SPA fallback: unknown non-API GET paths serve index.html for client routing.
    let index = PathBuf::from(&static_dir).join("index.html");
    let static_service = ServeDir::new(&static_dir).fallback(tower_http::services::ServeFile::new(index));

    let app = Router::new()
        .route("/healthz", get(healthz))
        .route("/api/import_parcels", post(import_parcels_upload))
        .route("/api/:cmd", post(dispatch))
        .fallback_service(static_service)
        .layer(DefaultBodyLimit::max(max_upload_mb * 1024 * 1024))
        .layer(CorsLayer::permissive())
        .with_state(state);

    let listener = tokio::net::TcpListener::bind(bind)
        .await
        .unwrap_or_else(|e| panic!("could not bind {bind}: {e}"));
    tracing::info!("HomeLens server listening on http://{bind}");

    axum::serve(listener, app)
        .with_graceful_shutdown(shutdown_signal())
        .await
        .expect("server error");
}

async fn shutdown_signal() {
    let _ = tokio::signal::ctrl_c().await;
    tracing::info!("shutting down");
}
