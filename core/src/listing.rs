//! Best-effort "autofill from listing link" support.
//!
//! Given a listing URL (brokerage / IDX / MLS-syndicated site), fetch the page
//! once with a normal browser-like request and extract whatever structured data
//! the page already exposes to the open web:
//!   - JSON-LD (`schema.org` `RealEstateListing` / `SingleFamilyResidence` / …)
//!   - Open Graph + standard `<meta>` tags (`og:*`, `geo.position`, `keywords`)
//!   - a best-effort scan of the title/description for beds/baths/sqft.
//!
//! This is intentionally a *convenience prefill* for the Add-Property form, not a
//! scraper: it does a single plain GET (redirects followed — which transparently
//! unwraps Mimecast/`?domain=` wrapper links), never evades bot protection, and
//! does NOT keep listing photos or marketing descriptions (brief §4). Big portals
//! (Zillow, Realtor.com, RE/MAX, …) block automated requests; for those the
//! "Send to HomeLens" bookmarklet reads the page in the user's own browser session
//! and posts the same field shape back, so no evasion is ever required here.

use std::collections::HashMap;

use scraper::{Html, Selector};
use serde::Serialize;
use serde_json::Value;

/// Browser-like UA so ordinary IDX/brokerage sites serve their normal HTML (many
/// reject the default reqwest UA). This is not anti-bot evasion — no proxies,
/// cookies, CAPTCHA solving, or header spoofing beyond a standard UA.
const USER_AGENT: &str =
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

#[derive(Debug, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ListingMetadata {
    /// The final URL after following redirects (unwraps Mimecast/`?domain=` links).
    pub resolved_url: String,
    /// Host of the resolved URL (e.g. `katlin.mylinkrealty.com`).
    pub source: Option<String>,
    pub address: Option<String>,
    pub list_price: Option<i64>,
    pub beds: Option<f64>,
    pub baths: Option<f64>,
    pub sqft: Option<i64>,
    pub year_built: Option<i64>,
    pub property_type: Option<String>,
    pub latitude: Option<f64>,
    pub longitude: Option<f64>,
    /// Listing preview photo (JSON-LD `image` / `og:image`) — a URL only.
    pub photo_url: Option<String>,
    /// Human-readable notes (e.g. "nothing parseable found").
    pub warnings: Vec<String>,
}

/// Fetch a listing page and extract best-effort metadata. Returns `Err` only on a
/// network/HTTP failure (including a bot block); a successful fetch that yields no
/// usable fields returns `Ok` with a warning so the UI can fall back to manual entry.
pub async fn fetch_listing_metadata(url: String) -> Result<ListingMetadata, String> {
    let url = url.trim().to_string();
    if url.is_empty() {
        return Err("a listing URL is required".into());
    }
    if !(url.starts_with("http://") || url.starts_with("https://")) {
        return Err("listing URL must start with http:// or https://".into());
    }

    let client = reqwest::Client::builder()
        .user_agent(USER_AGENT)
        .timeout(std::time::Duration::from_secs(20))
        .build()
        .map_err(|e| format!("could not build HTTP client: {e}"))?;

    let resp = client
        .get(&url)
        .header("Accept", "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8")
        .header("Accept-Language", "en-US,en;q=0.9")
        .send()
        .await
        .map_err(|e| format!("could not fetch the listing page: {e}"))?;

    let status = resp.status();
    let final_url = resp.url().clone();

    if !status.is_success() {
        let code = status.as_u16();
        if code == 401 || code == 403 || code == 429 {
            return Err(format!(
                "the listing site blocked automated access (HTTP {code}). Big portals (Zillow, \
                 Realtor.com, RE/MAX, …) block bots — open the listing in your browser and use the \
                 \"Send to HomeLens\" bookmarklet (Settings) instead."
            ));
        }
        return Err(format!("the listing site returned HTTP {status}"));
    }

    let html = resp
        .text()
        .await
        .map_err(|e| format!("could not read the listing page: {e}"))?;

    let mut meta = parse_listing_html(&html);
    meta.resolved_url = final_url.to_string();
    meta.source = final_url
        .host_str()
        .map(|h| h.trim_start_matches("www.").to_string());

    if meta.address.is_none()
        && meta.list_price.is_none()
        && meta.beds.is_none()
        && meta.sqft.is_none()
    {
        meta.warnings.push(
            "Couldn't read structured listing data from this page. Enter the details manually, \
             or try the \"Send to HomeLens\" bookmarklet."
                .into(),
        );
    }

    Ok(meta)
}

/// Parse already-fetched HTML. Pure + synchronous so it's unit-testable and keeps
/// the async fetch future `Send` (no non-`Send` `Html` held across an `.await`).
fn parse_listing_html(html: &str) -> ListingMetadata {
    let mut m = ListingMetadata::default();
    let doc = Html::parse_document(html);

    // 1. JSON-LD structured data (richest source).
    if let Ok(sel) = Selector::parse(r#"script[type="application/ld+json"]"#) {
        for el in doc.select(&sel) {
            let text = el.text().collect::<String>();
            if let Ok(v) = serde_json::from_str::<Value>(&text) {
                walk_jsonld(&v, &mut m);
            }
        }
    }

    // 2. Open Graph / standard meta tags.
    let metas = collect_meta(&doc);
    apply_meta(&metas, &mut m);

    // 3. <title> fallback for address.
    if m.address.is_none() {
        if let Ok(sel) = Selector::parse("title") {
            if let Some(t) = doc.select(&sel).next() {
                let title = t.text().collect::<String>();
                let title = title.trim();
                if looks_like_address(title) {
                    m.address = Some(title.to_string());
                }
            }
        }
    }

    m
}

// ---------- JSON-LD ----------

const LISTING_TYPES: &[&str] = &[
    "singlefamilyresidence",
    "realestatelisting",
    "residence",
    "house",
    "apartment",
    "apartmentcomplex",
    "accommodation",
    "place",
    "product",
    "offer",
];

fn types_of(v: &Value) -> Vec<String> {
    match v.get("@type") {
        Some(Value::String(s)) => vec![s.to_lowercase()],
        Some(Value::Array(a)) => a
            .iter()
            .filter_map(|x| x.as_str())
            .map(|s| s.to_lowercase())
            .collect(),
        _ => vec![],
    }
}

fn is_listing(v: &Value) -> bool {
    types_of(v)
        .iter()
        .any(|t| LISTING_TYPES.iter().any(|w| t.contains(w)))
}

fn walk_jsonld(v: &Value, m: &mut ListingMetadata) {
    match v {
        Value::Array(a) => {
            for x in a {
                walk_jsonld(x, m);
            }
        }
        Value::Object(o) => {
            if let Some(g) = o.get("@graph") {
                walk_jsonld(g, m);
            }
            if is_listing(v) {
                extract_listing_obj(v, m);
            }
            for (k, val) in o {
                if k == "@graph" {
                    continue;
                }
                if val.is_object() || val.is_array() {
                    walk_jsonld(val, m);
                }
            }
        }
        _ => {}
    }
}

fn extract_listing_obj(v: &Value, m: &mut ListingMetadata) {
    if m.address.is_none() {
        m.address = extract_address(v.get("address"));
    }
    if m.list_price.is_none() {
        m.list_price = extract_price(v);
    }
    if m.beds.is_none() {
        m.beds = num_f64(v.get("numberOfBedrooms")).or_else(|| num_f64(v.get("numberOfRooms")));
    }
    if m.baths.is_none() {
        m.baths = num_f64(v.get("numberOfBathroomsTotal"))
            .or_else(|| num_f64(v.get("numberOfBathrooms")));
    }
    if m.sqft.is_none() {
        if let Some(fs) = v.get("floorSize") {
            m.sqft = num_i64(fs.get("value")).or_else(|| num_i64(Some(fs)));
        }
    }
    if m.year_built.is_none() {
        m.year_built = num_i64(v.get("yearBuilt"));
    }
    if m.latitude.is_none() || m.longitude.is_none() {
        if let Some(geo) = v.get("geo") {
            if let (Some(la), Some(lo)) =
                (num_f64(geo.get("latitude")), num_f64(geo.get("longitude")))
            {
                m.latitude = Some(la);
                m.longitude = Some(lo);
            }
        }
    }
    if m.property_type.is_none() {
        m.property_type = property_type_from_types(&types_of(v));
    }
    if m.photo_url.is_none() {
        m.photo_url = extract_image(v.get("image"));
    }
}

/// Extract an image URL from a JSON-LD `image` value (string, array, or
/// `ImageObject` with `url`/`contentUrl`).
fn extract_image(v: Option<&Value>) -> Option<String> {
    match v? {
        Value::String(s) => non_empty(s),
        Value::Array(a) => a.iter().find_map(|x| extract_image(Some(x))),
        Value::Object(o) => o
            .get("url")
            .and_then(Value::as_str)
            .and_then(non_empty)
            .or_else(|| o.get("contentUrl").and_then(Value::as_str).and_then(non_empty)),
        _ => None,
    }
}

fn non_empty(s: &str) -> Option<String> {
    let t = s.trim();
    if t.is_empty() {
        None
    } else {
        Some(t.to_string())
    }
}

fn property_type_from_types(types: &[String]) -> Option<String> {
    for t in types {
        if t.contains("singlefamily") {
            return Some("Single Family".into());
        }
        if t.contains("townhouse") {
            return Some("Townhouse".into());
        }
        if t.contains("apartment") || t.contains("condominium") {
            return Some("Condo/Apartment".into());
        }
        if t.contains("house") {
            return Some("House".into());
        }
    }
    None
}

fn extract_address(v: Option<&Value>) -> Option<String> {
    match v? {
        Value::String(s) => {
            let s = s.trim();
            if s.is_empty() {
                None
            } else {
                Some(s.to_string())
            }
        }
        Value::Array(a) => a.iter().find_map(|x| extract_address(Some(x))),
        obj @ Value::Object(_) => {
            let g = |k: &str| {
                obj.get(k)
                    .and_then(|x| x.as_str())
                    .map(str::trim)
                    .filter(|s| !s.is_empty())
            };
            let street = g("streetAddress");
            let locality = g("addressLocality");
            let region = g("addressRegion");
            let postal = g("postalCode");
            let mut parts: Vec<String> = Vec::new();
            if let Some(s) = street {
                parts.push(s.to_string());
            }
            if let Some(c) = locality {
                parts.push(c.to_string());
            }
            let region_zip = match (region, postal) {
                (Some(r), Some(z)) => Some(format!("{r} {z}")),
                (Some(r), None) => Some(r.to_string()),
                (None, Some(z)) => Some(z.to_string()),
                (None, None) => None,
            };
            if let Some(rz) = region_zip {
                parts.push(rz);
            }
            if parts.is_empty() {
                None
            } else {
                Some(parts.join(", "))
            }
        }
        _ => None,
    }
}

fn extract_price(v: &Value) -> Option<i64> {
    if let Some(off) = v.get("offers") {
        if let Some(p) = price_from_offer(off) {
            return Some(p);
        }
    }
    num_i64(v.get("price"))
}

fn price_from_offer(off: &Value) -> Option<i64> {
    match off {
        Value::Array(a) => a.iter().find_map(price_from_offer),
        Value::Object(o) => num_i64(o.get("price")).or_else(|| {
            o.get("priceSpecification")
                .and_then(|ps| num_i64(ps.get("price")))
        }),
        _ => None,
    }
}

// ---------- meta tags ----------

fn collect_meta(doc: &Html) -> HashMap<String, String> {
    let mut map = HashMap::new();
    if let Ok(sel) = Selector::parse("meta") {
        for el in doc.select(&sel) {
            let v = el.value();
            let key = v
                .attr("property")
                .or_else(|| v.attr("name"))
                .or_else(|| v.attr("itemprop"));
            if let (Some(k), Some(c)) = (key, v.attr("content")) {
                let c = c.trim();
                if !c.is_empty() {
                    map.entry(k.to_lowercase()).or_insert_with(|| c.to_string());
                }
            }
        }
    }
    map
}

fn apply_meta(meta: &HashMap<String, String>, m: &mut ListingMetadata) {
    let get = |k: &str| meta.get(k).map(String::as_str);

    if m.list_price.is_none() {
        if let Some(p) = get("og:price:amount").or_else(|| get("product:price:amount")) {
            m.list_price = parse_i64_str(p);
        }
    }

    if m.latitude.is_none() || m.longitude.is_none() {
        if let Some(pos) = get("geo.position") {
            // "lat;lon"
            let parts: Vec<&str> = pos.split(';').collect();
            if parts.len() == 2 {
                if let (Ok(la), Ok(lo)) =
                    (parts[0].trim().parse::<f64>(), parts[1].trim().parse::<f64>())
                {
                    m.latitude = Some(la);
                    m.longitude = Some(lo);
                }
            }
        }
        if m.latitude.is_none() {
            if let Some(icbm) = get("icbm") {
                // "lat, lon"
                let parts: Vec<&str> = icbm.split(',').collect();
                if parts.len() == 2 {
                    if let (Ok(la), Ok(lo)) =
                        (parts[0].trim().parse::<f64>(), parts[1].trim().parse::<f64>())
                    {
                        m.latitude = Some(la);
                        m.longitude = Some(lo);
                    }
                }
            }
        }
        if m.latitude.is_none() {
            if let (Some(la), Some(lo)) = (
                get("place:location:latitude"),
                get("place:location:longitude"),
            ) {
                if let (Ok(a), Ok(o)) = (la.trim().parse::<f64>(), lo.trim().parse::<f64>()) {
                    m.latitude = Some(a);
                    m.longitude = Some(o);
                }
            }
        }
    }

    if m.address.is_none() {
        let street = get("og:street-address").or_else(|| get("place:location:street_address"));
        let locality = get("og:locality").or_else(|| get("place:location:locality"));
        let region = get("og:region").or_else(|| get("place:location:region"));
        let postal = get("og:postal-code").or_else(|| get("place:location:postal_code"));
        let mut parts: Vec<String> = Vec::new();
        if let Some(s) = street {
            parts.push(s.to_string());
        }
        if let Some(c) = locality {
            parts.push(c.to_string());
        }
        match (region, postal) {
            (Some(r), Some(z)) => parts.push(format!("{r} {z}")),
            (Some(r), None) => parts.push(r.to_string()),
            (None, Some(z)) => parts.push(z.to_string()),
            (None, None) => {}
        }
        if !parts.is_empty() {
            m.address = Some(parts.join(", "));
        }
    }

    if m.address.is_none() {
        if let Some(t) = get("og:title") {
            if looks_like_address(t) {
                m.address = Some(t.trim().to_string());
            }
        }
    }

    if m.photo_url.is_none() {
        m.photo_url = get("og:image")
            .or_else(|| get("og:image:secure_url"))
            .or_else(|| get("twitter:image"))
            .and_then(non_empty);
    }

    // Best-effort beds/baths/sqft from free text when not already structured.
    if m.beds.is_none() || m.baths.is_none() || m.sqft.is_none() {
        let mut text = String::new();
        for k in ["og:description", "description", "keywords"] {
            if let Some(s) = get(k) {
                text.push(' ');
                text.push_str(s);
            }
        }
        let text = text.to_lowercase();
        if m.beds.is_none() {
            m.beds = spec_before(&text, &["bedroom", "beds", "bed", " bd"]);
        }
        if m.baths.is_none() {
            m.baths = spec_before(&text, &["bathroom", "baths", "bath", " ba"]);
        }
        if m.sqft.is_none() {
            m.sqft =
                spec_before(&text, &["sqft", "sq ft", "sq. ft", "square feet"]).map(|n| n as i64);
        }
    }
}

/// Find the number immediately preceding one of `keywords` (e.g. "3 beds" -> 3).
fn spec_before(text: &str, keywords: &[&str]) -> Option<f64> {
    for kw in keywords {
        if let Some(idx) = text.find(kw) {
            let pre = &text[..idx];
            let mut digits: Vec<char> = pre
                .chars()
                .rev()
                .skip_while(|c| c.is_whitespace())
                .take_while(|c| c.is_ascii_digit() || *c == '.')
                .collect();
            digits.reverse();
            let s: String = digits.into_iter().collect();
            if let Ok(n) = s.parse::<f64>() {
                if n > 0.0 && n < 100000.0 {
                    return Some(n);
                }
            }
        }
    }
    None
}

// ---------- small parse helpers ----------

fn num_f64(v: Option<&Value>) -> Option<f64> {
    match v? {
        Value::Number(n) => n.as_f64(),
        Value::String(s) => parse_f64_str(s),
        _ => None,
    }
}

fn num_i64(v: Option<&Value>) -> Option<i64> {
    num_f64(v).map(|f| f.round() as i64)
}

fn parse_f64_str(s: &str) -> Option<f64> {
    let cleaned: String = s
        .chars()
        .filter(|c| c.is_ascii_digit() || *c == '.')
        .collect();
    cleaned.parse::<f64>().ok()
}

fn parse_i64_str(s: &str) -> Option<i64> {
    parse_f64_str(s).map(|f| f.round() as i64)
}

/// Heuristic: a string is "address-like" if it leads with a number and contains a
/// comma, or contains a 5-digit ZIP somewhere.
fn looks_like_address(s: &str) -> bool {
    let s = s.trim();
    if s.is_empty() {
        return false;
    }
    let leading_num = s.chars().next().map(|c| c.is_ascii_digit()).unwrap_or(false);
    let has_comma = s.contains(',');
    if leading_num && has_comma {
        return true;
    }
    // any run of exactly-or-more 5 consecutive digits (ZIP)
    let mut run = 0;
    for c in s.chars() {
        if c.is_ascii_digit() {
            run += 1;
            if run >= 5 {
                return true;
            }
        } else {
            run = 0;
        }
    }
    false
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn jsonld_listing() {
        let html = r#"<html><head>
          <script type="application/ld+json">
          {"@context":"https://schema.org","@type":"SingleFamilyResidence",
           "address":{"@type":"PostalAddress","streetAddress":"20 Kenwood Ter",
             "addressLocality":"Hamilton","addressRegion":"NJ","postalCode":"08610"},
           "numberOfBedrooms":6,"numberOfBathroomsTotal":4,
           "floorSize":{"value":"3089"},"yearBuilt":1998,
           "geo":{"latitude":40.2627967,"longitude":-74.81723194},
           "image":["https://example.com/photo1.jpg","https://example.com/photo2.jpg"],
           "offers":{"@type":"Offer","price":"595000"}}
          </script></head><body></body></html>"#;
        let m = parse_listing_html(html);
        assert_eq!(m.address.as_deref(), Some("20 Kenwood Ter, Hamilton, NJ 08610"));
        assert_eq!(m.list_price, Some(595000));
        assert_eq!(m.beds, Some(6.0));
        assert_eq!(m.baths, Some(4.0));
        assert_eq!(m.sqft, Some(3089));
        assert_eq!(m.year_built, Some(1998));
        assert_eq!(m.property_type.as_deref(), Some("Single Family"));
        assert_eq!(m.latitude, Some(40.2627967));
        assert_eq!(m.photo_url.as_deref(), Some("https://example.com/photo1.jpg"));
    }

    #[test]
    fn og_fallback() {
        let html = r#"<html><head>
          <meta property="og:title" content="123 Main St, Hamilton, NJ 08610">
          <meta property="og:description" content="Charming 4 bed, 2.5 bath home with 2100 sqft.">
          <meta name="geo.position" content="40.21;-74.69">
          <meta property="og:price:amount" content="450000">
          <meta property="og:image" content="https://cdn.example.com/listing.jpg">
        </head><body></body></html>"#;
        let m = parse_listing_html(html);
        assert_eq!(m.address.as_deref(), Some("123 Main St, Hamilton, NJ 08610"));
        assert_eq!(m.list_price, Some(450000));
        assert_eq!(m.beds, Some(4.0));
        assert_eq!(m.baths, Some(2.5));
        assert_eq!(m.sqft, Some(2100));
        assert_eq!(m.latitude, Some(40.21));
        assert_eq!(m.photo_url.as_deref(), Some("https://cdn.example.com/listing.jpg"));
    }
}
