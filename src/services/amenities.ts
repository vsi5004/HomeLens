import { invoke } from "./ipc";

/** A cached nearby amenity for a property. */
export interface AmenityResult {
  id: string;
  propertyId: string;
  category: string;
  name: string;
  address: string | null;
  latitude: number | null;
  longitude: number | null;
  distanceMeters: number | null;
  durationSeconds: number | null;
  rating: number | null;
  userRatingsTotal: number | null;
  provider: string;
  placeId: string | null;
  fetchedAt: string;
}

export interface AmenityCategoryInfo {
  key: string;
  label: string;
}

export interface AmenityError {
  category: string;
  label: string;
  message: string;
}

export interface ComputeAmenitiesResult {
  amenities: AmenityResult[];
  errors: AmenityError[];
}

export async function getAmenityCategories(): Promise<AmenityCategoryInfo[]> {
  return invoke<AmenityCategoryInfo[]>("get_amenity_categories");
}

export async function getAmenities(
  propertyId: string,
): Promise<AmenityResult[]> {
  return invoke<AmenityResult[]>("get_amenities", { propertyId });
}

/** All cached amenities across every property (for the comparison dashboard). */
export async function getAllAmenities(): Promise<AmenityResult[]> {
  return invoke<AmenityResult[]>("list_all_amenities");
}

/**
 * Recompute nearby amenities. Pass `categories` (category keys) to fetch only
 * specific categories, or omit to fetch all (a confirmed fan-out — one billed
 * Places call per category).
 */
export async function computeAmenities(
  propertyId: string,
  categories?: string[],
): Promise<ComputeAmenitiesResult> {
  return invoke<ComputeAmenitiesResult>("compute_amenities", {
    propertyId,
    categories: categories ?? null,
  });
}
