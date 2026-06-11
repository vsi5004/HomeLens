import { invoke } from "./ipc";

/** A family destination with optional cached coordinates + isochrone GeoJSON. */
export interface FamilyIsochrone {
  key: string;
  label: string;
  address: string;
  latitude: number | null;
  longitude: number | null;
  /** Raw openrouteservice GeoJSON FeatureCollection, or null if not computed. */
  geojson: unknown | null;
}

export interface FamilyError {
  key: string;
  label: string;
  message: string;
}

export interface FamilyIsochrones {
  rangeSeconds: number | null;
  /** Active provider: "traveltime", "ors", or "none". */
  provider: string;
  /** Maximum range (seconds) the active provider allows. */
  maxRangeSeconds: number;
  /** Ranges (seconds) already cached for both destinations. */
  availableRanges: number[];
  locations: FamilyIsochrone[];
  errors: FamilyError[];
}

/**
 * Load cached family isochrones. Pass `rangeSeconds` to load a specific
 * previously-computed range; omit to load the active range. No API calls.
 */
export async function getFamilyIsochrones(
  rangeSeconds?: number,
): Promise<FamilyIsochrones> {
  return invoke<FamilyIsochrones>("get_family_isochrones", {
    rangeSeconds: rangeSeconds ?? null,
  });
}

export async function computeFamilyIsochrones(
  rangeSeconds: number,
): Promise<FamilyIsochrones> {
  return invoke<FamilyIsochrones>("compute_family_isochrones", {
    rangeSeconds,
  });
}
