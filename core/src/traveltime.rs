use chrono::Utc;
use serde_json::Value;

const TRAVELTIME_TIMEMAP_URL: &str = "https://api.traveltimeapp.com/v4/time-map";

/// TravelTime's standard maximum travel time for isochrones is 4 hours.
pub const MAX_RANGE_SECONDS: i64 = 14_400;

/// Fetch a drive-time isochrone (GeoJSON FeatureCollection) from the TravelTime
/// Time Map API for a single origin. Requesting `application/geo+json` returns a
/// GeoJSON FeatureCollection ([lng, lat] order), matching the ORS pipeline.
pub async fn fetch_isochrone(
    lat: f64,
    lng: f64,
    range_seconds: i64,
    app_id: &str,
    api_key: &str,
) -> Result<Value, String> {
    if app_id.trim().is_empty() || api_key.trim().is_empty() {
        return Err("missing TravelTime credentials (set them in Settings)".into());
    }

    let travel_time = range_seconds.clamp(60, MAX_RANGE_SECONDS);
    let departure_time = Utc::now().to_rfc3339();

    let body = serde_json::json!({
        "departure_searches": [
            {
                "id": "iso",
                "coords": { "lat": lat, "lng": lng },
                "departure_time": departure_time,
                "travel_time": travel_time,
                "transportation": { "type": "driving" }
            }
        ]
    });

    let client = reqwest::Client::new();
    let resp = client
        .post(TRAVELTIME_TIMEMAP_URL)
        .header("X-Application-Id", app_id)
        .header("X-Api-Key", api_key)
        .header("Content-Type", "application/json")
        .header("Accept", "application/geo+json")
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("isochrone request failed: {e}"))?;

    if !resp.status().is_success() {
        let status = resp.status();
        let text = resp.text().await.unwrap_or_default();
        return Err(format!("TravelTime error {status}: {text}")
            .trim()
            .to_string());
    }

    resp.json::<Value>()
        .await
        .map_err(|e| format!("could not parse isochrone response: {e}"))
}
