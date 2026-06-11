//! HomeLens core: all business logic (DB, geocoding, routing, amenities,
//! schools, parcels, scoring inputs) with no UI/transport coupling.
//!
//! This crate is shared by two thin shells:
//! - `tauri-app` (the desktop app), which wraps these functions as Tauri commands.
//! - `homelens-server` (the LAN web server), which exposes them over HTTP.
//!
//! Every former Tauri command takes `db: &Db` instead of `State<Db>`, so either
//! shell can call it directly.

pub mod amenities;
pub mod commands;
pub mod db;
pub mod family;
pub mod geocoding;
pub mod isochrones;
pub mod listing;
pub mod models;
pub mod parcels;
pub mod places;
pub mod properties;
pub mod routes;
pub mod schools;
pub mod settings_store;
pub mod traveltime;

pub use db::Db;
