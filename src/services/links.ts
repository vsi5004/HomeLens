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
    label: "Redfin",
    search: (q) => `https://www.redfin.com/city/1/search?q=${encodeURIComponent(q)}`,
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
