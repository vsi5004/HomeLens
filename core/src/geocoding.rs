use serde::Deserialize;

use crate::models::GeocodeResult;

const GEOCODE_ENDPOINT: &str = "https://maps.googleapis.com/maps/api/geocode/json";

#[derive(Deserialize)]
struct GoogleGeocodeResponse {
    status: String,
    #[serde(default)]
    results: Vec<GoogleResult>,
    #[serde(default)]
    error_message: Option<String>,
}

#[derive(Deserialize)]
struct GoogleResult {
    formatted_address: String,
    geometry: Geometry,
    #[serde(default)]
    address_components: Vec<AddressComponent>,
}

#[derive(Deserialize)]
struct Geometry {
    location: Location,
}

#[derive(Deserialize)]
struct Location {
    lat: f64,
    lng: f64,
}

#[derive(Deserialize)]
struct AddressComponent {
    long_name: String,
    short_name: String,
    types: Vec<String>,
}

fn component<'a>(components: &'a [AddressComponent], wanted: &str) -> Option<&'a AddressComponent> {
    components.iter().find(|c| c.types.iter().any(|t| t == wanted))
}

/// Geocode an address with the Google Geocoding API. Billed call — invoked only
/// from the Rust side using the private web-service key (brief §2.1).
pub async fn geocode(address: &str, api_key: &str) -> Result<GeocodeResult, String> {
    if api_key.trim().is_empty() {
        return Err("missing Google web-service API key (set it in Settings)".into());
    }

    let client = reqwest::Client::new();
    let resp = client
        .get(GEOCODE_ENDPOINT)
        .query(&[("address", address), ("key", api_key)])
        .send()
        .await
        .map_err(|e| format!("geocoding request failed: {e}"))?;

    let body: GoogleGeocodeResponse = resp
        .json()
        .await
        .map_err(|e| format!("could not parse geocoding response: {e}"))?;

    match body.status.as_str() {
        "OK" => {}
        "ZERO_RESULTS" => return Err(format!("no geocoding results for \"{address}\"")),
        other => {
            let detail = body.error_message.unwrap_or_default();
            return Err(format!("geocoding failed: {other} {detail}").trim().to_string());
        }
    }

    let result = body
        .results
        .into_iter()
        .next()
        .ok_or_else(|| "geocoding returned no results".to_string())?;

    let components = &result.address_components;

    // Compose street from street_number + route when available.
    let street_number = component(components, "street_number").map(|c| c.long_name.clone());
    let route = component(components, "route").map(|c| c.long_name.clone());
    let street = match (street_number, route) {
        (Some(n), Some(r)) => Some(format!("{n} {r}")),
        (None, Some(r)) => Some(r),
        _ => None,
    };

    let city = component(components, "locality")
        .or_else(|| component(components, "sublocality"))
        .or_else(|| component(components, "postal_town"))
        .map(|c| c.long_name.clone());
    let state = component(components, "administrative_area_level_1").map(|c| c.short_name.clone());
    let zip = component(components, "postal_code").map(|c| c.long_name.clone());
    let county = component(components, "administrative_area_level_2").map(|c| c.long_name.clone());

    Ok(GeocodeResult {
        normalized_address: result.formatted_address,
        street,
        city,
        state,
        zip,
        county,
        latitude: result.geometry.location.lat,
        longitude: result.geometry.location.lng,
        provider: "google".to_string(),
    })
}
