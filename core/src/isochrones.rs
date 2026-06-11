use serde_json::Value;

const ORS_ISOCHRONE_URL: &str = "https://api.openrouteservice.org/v2/isochrones/driving-car";

/// Fetch a drive-time isochrone (GeoJSON FeatureCollection) from openrouteservice
/// for a single origin. ORS uses [lng, lat] coordinate order. The returned value
/// is the raw GeoJSON, suitable for rendering on a map and for polygon math.
pub async fn fetch_isochrone(
    lat: f64,
    lng: f64,
    range_seconds: i64,
    api_key: &str,
) -> Result<Value, String> {
    if api_key.trim().is_empty() {
        return Err("missing openrouteservice API key (set it in Settings)".into());
    }

    let body = serde_json::json!({
        "locations": [[lng, lat]],
        "range": [range_seconds],
        "range_type": "time"
    });

    let client = reqwest::Client::new();
    let resp = client
        .post(ORS_ISOCHRONE_URL)
        .header("Authorization", api_key)
        .header("Content-Type", "application/json")
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("isochrone request failed: {e}"))?;

    if !resp.status().is_success() {
        let status = resp.status();
        let text = resp.text().await.unwrap_or_default();
        return Err(format!("openrouteservice error {status}: {text}")
            .trim()
            .to_string());
    }

    resp.json::<Value>()
        .await
        .map_err(|e| format!("could not parse isochrone response: {e}"))
}
