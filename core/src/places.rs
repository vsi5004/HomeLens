use serde::Deserialize;

const PLACES_NEARBY_URL: &str = "https://places.googleapis.com/v1/places:searchNearby";
const PLACES_TEXT_URL: &str = "https://places.googleapis.com/v1/places:searchText";

/// A single nearby place returned by the Places API, with a straight-line
/// distance from the search origin computed locally (no extra billed calls).
pub struct PlaceHit {
    pub name: String,
    pub address: Option<String>,
    pub latitude: Option<f64>,
    pub longitude: Option<f64>,
    pub rating: Option<f64>,
    pub user_ratings_total: Option<i64>,
    pub place_id: Option<String>,
    pub distance_meters: Option<i64>,
}

#[derive(Deserialize)]
struct NearbyResponse {
    #[serde(default)]
    places: Vec<PlaceData>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct PlaceData {
    #[serde(default)]
    id: Option<String>,
    #[serde(default)]
    formatted_address: Option<String>,
    #[serde(default)]
    location: Option<LatLng>,
    #[serde(default)]
    rating: Option<f64>,
    #[serde(default)]
    user_rating_count: Option<i64>,
    #[serde(default)]
    display_name: Option<DisplayName>,
}

#[derive(Deserialize)]
struct LatLng {
    latitude: f64,
    longitude: f64,
}

#[derive(Deserialize)]
struct DisplayName {
    #[serde(default)]
    text: String,
}

/// Great-circle distance between two coordinates, in meters.
fn haversine_meters(lat1: f64, lng1: f64, lat2: f64, lng2: f64) -> i64 {
    const R: f64 = 6_371_000.0; // Earth radius in meters
    let (p1, p2) = (lat1.to_radians(), lat2.to_radians());
    let dlat = (lat2 - lat1).to_radians();
    let dlng = (lng2 - lng1).to_radians();
    let a = (dlat / 2.0).sin().powi(2) + p1.cos() * p2.cos() * (dlng / 2.0).sin().powi(2);
    let c = 2.0 * a.sqrt().asin();
    (R * c).round() as i64
}

/// Find the nearest places of a given Google place type around an origin using
/// the Places API (New) `searchNearby`, ranked by distance. Billed call —
/// invoked only from Rust with the private web-service key (brief §2.1). Uses a
/// field mask so only the fields we store are requested (cost control §17.1).
pub async fn search_nearby(
    lat: f64,
    lng: f64,
    place_type: &str,
    radius_meters: f64,
    max_results: i64,
    api_key: &str,
) -> Result<Vec<PlaceHit>, String> {
    let body = serde_json::json!({
        "includedTypes": [place_type],
        "maxResultCount": max_results,
        "rankPreference": "DISTANCE",
        "locationRestriction": {
            "circle": {
                "center": { "latitude": lat, "longitude": lng },
                "radius": radius_meters,
            }
        }
    });
    places_query(PLACES_NEARBY_URL, body, lat, lng, api_key).await
}

/// Find the nearest places matching a free-text query (e.g. "high school")
/// around an origin using the Places API (New) `searchText`, ranked by distance.
/// More precise than a generic type filter for schools, where Google has no
/// "middle school" type and a type search pulls in daycares/tutors. Billed call.
pub async fn search_text(
    lat: f64,
    lng: f64,
    text_query: &str,
    radius_meters: f64,
    max_results: i64,
    api_key: &str,
) -> Result<Vec<PlaceHit>, String> {
    let body = serde_json::json!({
        "textQuery": text_query,
        "maxResultCount": max_results,
        "rankPreference": "DISTANCE",
        "locationBias": {
            "circle": {
                "center": { "latitude": lat, "longitude": lng },
                "radius": radius_meters,
            }
        }
    });
    places_query(PLACES_TEXT_URL, body, lat, lng, api_key).await
}

/// Shared POST + parse for the Places (New) search endpoints. Uses a field mask
/// so only the fields we store are requested (cost control §17.1) and computes a
/// local straight-line distance from the origin (no extra billed call).
async fn places_query(
    url: &str,
    body: serde_json::Value,
    lat: f64,
    lng: f64,
    api_key: &str,
) -> Result<Vec<PlaceHit>, String> {
    if api_key.trim().is_empty() {
        return Err("missing Google web-service API key (set it in Settings)".into());
    }

    let client = reqwest::Client::new();
    let resp = client
        .post(url)
        .header("Content-Type", "application/json")
        .header("X-Goog-Api-Key", api_key)
        .header(
            "X-Goog-FieldMask",
            "places.id,places.displayName,places.formattedAddress,\
             places.location,places.rating,places.userRatingCount",
        )
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("places request failed: {e}"))?;

    if !resp.status().is_success() {
        let status = resp.status();
        let text = resp.text().await.unwrap_or_default();
        return Err(format!("places API error {status}: {text}")
            .trim()
            .to_string());
    }

    let parsed: NearbyResponse = resp
        .json()
        .await
        .map_err(|e| format!("could not parse places response: {e}"))?;

    let hits = parsed
        .places
        .into_iter()
        .map(|p| {
            let (plat, plng) = match &p.location {
                Some(l) => (Some(l.latitude), Some(l.longitude)),
                None => (None, None),
            };
            let distance_meters = match (plat, plng) {
                (Some(la), Some(lo)) => Some(haversine_meters(lat, lng, la, lo)),
                _ => None,
            };
            PlaceHit {
                name: p
                    .display_name
                    .map(|d| d.text)
                    .filter(|t| !t.is_empty())
                    .unwrap_or_else(|| "(unnamed)".into()),
                address: p.formatted_address,
                latitude: plat,
                longitude: plng,
                rating: p.rating,
                user_ratings_total: p.user_rating_count,
                place_id: p.id,
                distance_meters,
            }
        })
        .collect();

    Ok(hits)
}
