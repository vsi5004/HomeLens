use serde::Deserialize;

const ROUTES_ENDPOINT: &str = "https://routes.googleapis.com/directions/v2:computeRoutes";

/// A single computed route's distance/duration.
pub struct RouteLeg {
    pub distance_meters: i64,
    pub duration_seconds: i64,
}

#[derive(Deserialize)]
struct RoutesResponse {
    #[serde(default)]
    routes: Vec<RouteData>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct RouteData {
    #[serde(default)]
    distance_meters: Option<i64>,
    #[serde(default)]
    duration: Option<String>,
}

/// Map our stored commute mode to a Routes API `travelMode`.
pub fn travel_mode(mode: &str) -> &'static str {
    match mode {
        "walking" => "WALK",
        "bicycling" => "BICYCLE",
        "transit" => "TRANSIT",
        _ => "DRIVE",
    }
}

/// Parse a Routes API duration string like "1234s" into seconds.
fn parse_duration(d: &str) -> Option<i64> {
    d.trim_end_matches('s').parse::<i64>().ok()
}

/// Compute a route from an origin coordinate to a destination address using the
/// Google Routes API. Billed call — invoked only from Rust with the private
/// web-service key (brief §2.1).
pub async fn compute_route(
    origin_lat: f64,
    origin_lng: f64,
    destination_address: &str,
    mode: &str,
    api_key: &str,
) -> Result<RouteLeg, String> {
    if api_key.trim().is_empty() {
        return Err("missing Google web-service API key (set it in Settings)".into());
    }

    let tmode = travel_mode(mode);
    let mut body = serde_json::json!({
        "origin": { "location": { "latLng": { "latitude": origin_lat, "longitude": origin_lng } } },
        "destination": { "address": destination_address },
        "travelMode": tmode,
    });
    // Traffic-aware routing is only valid for driving / two-wheeler.
    if tmode == "DRIVE" {
        body["routingPreference"] = serde_json::json!("TRAFFIC_AWARE");
    }

    let client = reqwest::Client::new();
    let resp = client
        .post(ROUTES_ENDPOINT)
        .header("Content-Type", "application/json")
        .header("X-Goog-Api-Key", api_key)
        .header("X-Goog-FieldMask", "routes.duration,routes.distanceMeters")
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("routes request failed: {e}"))?;

    if !resp.status().is_success() {
        let status = resp.status();
        let text = resp.text().await.unwrap_or_default();
        return Err(format!("routes API error {status}: {text}").trim().to_string());
    }

    let parsed: RoutesResponse = resp
        .json()
        .await
        .map_err(|e| format!("could not parse routes response: {e}"))?;

    let route = parsed
        .routes
        .into_iter()
        .next()
        .ok_or_else(|| format!("no route found to \"{destination_address}\""))?;

    let distance_meters = route.distance_meters.unwrap_or_default();
    let duration_seconds = route
        .duration
        .as_deref()
        .and_then(parse_duration)
        .ok_or_else(|| "route response missing duration".to_string())?;

    Ok(RouteLeg {
        distance_meters,
        duration_seconds,
    })
}
