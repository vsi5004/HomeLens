import { invoke } from "./ipc";

export interface ListingMetadata {
  resolvedUrl: string;
  source: string | null;
  address: string | null;
  listPrice: number | null;
  beds: number | null;
  baths: number | null;
  sqft: number | null;
  yearBuilt: number | null;
  propertyType: string | null;
  latitude: number | null;
  longitude: number | null;
  warnings: string[];
}

/**
 * Best-effort autofill: fetch a listing page (server-side, in Rust) and extract
 * whatever structured data it publicly exposes. Works for brokerage/IDX sites;
 * big portals block bots — use the "Send to HomeLens" bookmarklet for those.
 */
export function fetchListingMetadata(url: string) {
  return invoke<ListingMetadata>("fetch_listing_metadata", { url });
}

/** Decode the base64url `import` payload produced by the bookmarklet. */
export function decodeImportParam(raw: string): Partial<ListingMetadata> | null {
  try {
    let b = raw.replace(/-/g, "+").replace(/_/g, "/");
    while (b.length % 4) b += "=";
    const json = decodeURIComponent(escape(atob(b)));
    const parsed = JSON.parse(json);
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}
