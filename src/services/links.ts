import { invoke, openExternalUrl } from "./ipc";

import type { Property } from "./properties";

/** A user-saved external link. Mirrors the Rust `ExternalLink` struct. */
export interface ExternalLink {
  id: string;
  propertyId: string;
  label: string;
  url: string;
  createdAt: string;
}

export async function listExternalLinks(
  propertyId: string,
): Promise<ExternalLink[]> {
  return invoke<ExternalLink[]>("list_external_links", { propertyId });
}

export async function addExternalLink(
  propertyId: string,
  label: string,
  url: string,
): Promise<ExternalLink> {
  return invoke<ExternalLink>("add_external_link", { propertyId, label, url });
}

export async function deleteExternalLink(id: string): Promise<void> {
  return invoke("delete_external_link", { id });
}

/** Open a URL in the user's default system browser (desktop) or a new tab (web). */
export async function openExternal(url: string): Promise<void> {
  return openExternalUrl(url);
}

/** A real-estate site we can deep-link a search to. */
export interface ListingSite {
  key: string;
  label: string;
  search: (query: string) => string;
}

/** Build the best address query we have for a property. */
export function addressQuery(p: Property): string {
  return (p.addressNormalized ?? p.addressInput ?? "").trim();
}

/**
 * Search-URL generators for the major listing portals. These open a search for
 * the property's address rather than a specific listing (which we can't know),
 * so the user lands on the right house and can grab the canonical listing URL.
 */
export const LISTING_SITES: ListingSite[] = [
  {
    key: "zillow",
    label: "Zillow",
    search: (q) =>
      `https://www.zillow.com/homes/${encodeURIComponent(q)}_rb/`,
  },
  {
    key: "redfin",
    // Redfin has no reliable public "search any address" URL (its endpoint is
    // city-scoped) and blocks automated requests, so deep-linking a search comes
    // up empty. Instead, scope a Google search to redfin.com: the canonical
    // listing is the top result. We also strip the Google-geocoder noise
    // ("Township", trailing ", USA") that Redfin doesn't match on.
    label: "Redfin",
    search: (q) => {
      const clean = q
        .replace(/,?\s*USA\s*$/i, "")
        .replace(/\b(?:Township|Twp\.?)\b/gi, "")
        .replace(/\s+,/g, ",")
        .replace(/\s{2,}/g, " ")
        .trim();
      return `https://www.google.com/search?q=${encodeURIComponent(
        `site:redfin.com ${clean}`,
      )}`;
    },
  },
  {
    key: "realtor",
    label: "Realtor.com",
    search: (q) =>
      `https://www.realtor.com/realestateandhomes-search/${encodeURIComponent(
        q.replace(/,/g, "").replace(/\s+/g, "-"),
      )}`,
  },
  {
    key: "google",
    label: "Google",
    search: (q) =>
      `https://www.google.com/search?q=${encodeURIComponent(`${q} for sale`)}`,
  },
];
