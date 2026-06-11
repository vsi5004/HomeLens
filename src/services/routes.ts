import { invoke } from "./ipc";

/** A cached drive-time/distance result to a family destination. */
export interface RouteResult {
  id: string;
  propertyId: string;
  destinationKey: string;
  destinationLabel: string;
  destinationAddress: string;
  mode: string;
  distanceMeters: number | null;
  durationSeconds: number | null;
  provider: string;
  fetchedAt: string;
}

export interface RouteError {
  destinationKey: string;
  destinationLabel: string;
  message: string;
}

export interface ComputeRoutesResult {
  routes: RouteResult[];
  errors: RouteError[];
}

/** A family destination with optional cached coordinates. */
export interface FamilyLocation {
  key: string;
  label: string;
  address: string;
  latitude: number | null;
  longitude: number | null;
}

export async function getRoutes(propertyId: string): Promise<RouteResult[]> {
  return invoke<RouteResult[]>("get_routes", { propertyId });
}

/** All cached routes across every property (for the comparison dashboard). */
export async function getAllRoutes(): Promise<RouteResult[]> {
  return invoke<RouteResult[]>("list_all_routes");
}

export async function computeRoutes(
  propertyId: string,
): Promise<ComputeRoutesResult> {
  return invoke<ComputeRoutesResult>("compute_routes", { propertyId });
}

export async function getFamilyLocations(): Promise<FamilyLocation[]> {
  return invoke<FamilyLocation[]>("get_family_locations");
}

export async function geocodeFamily(): Promise<FamilyLocation[]> {
  return invoke<FamilyLocation[]>("geocode_family");
}

/** Format a duration in seconds as e.g. "1 hr 5 min" or "42 min". */
export function formatDuration(seconds: number | null): string {
  if (seconds == null) return "—";
  const mins = Math.round(seconds / 60);
  if (mins < 60) return `${mins} min`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m === 0 ? `${h} hr` : `${h} hr ${m} min`;
}

/** Format a distance in meters as miles, e.g. "12.3 mi". */
export function formatDistance(meters: number | null): string {
  if (meters == null) return "—";
  const miles = meters / 1609.344;
  return `${miles.toFixed(1)} mi`;
}
