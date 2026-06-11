import { invoke } from "./ipc";

/**
 * A saved property. Mirrors the Rust `Property` struct (serde camelCase),
 * which in turn maps to the `properties` table (brief §7).
 */
export interface Property {
  id: string;
  createdAt: string;
  updatedAt: string;
  status: string;

  addressInput: string;
  addressNormalized: string | null;
  street: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  county: string | null;
  latitude: number | null;
  longitude: number | null;

  listingUrl: string | null;
  listingSource: string | null;
  listPrice: number | null;
  manualEstimatedValue: number | null;
  annualTaxes: number | null;
  hoaMonthly: number | null;
  beds: number | null;
  baths: number | null;
  sqft: number | null;
  lotSize: string | null;
  yearBuilt: number | null;
  propertyType: string | null;

  assignedElementarySchool: string | null;
  assignedMiddleSchool: string | null;
  assignedHighSchool: string | null;

  subjectiveScore: number | null;
  manualSchoolScore: number | null;
  manualPropertyValueScore: number | null;
  notes: string | null;
  photoUrl: string | null;
}

export interface NewProperty {
  addressInput: string;
  listingUrl?: string | null;
  listPrice?: number | null;
  photoUrl?: string | null;
}

/** Editable listing/manual fields. Sent in full; a `null` clears the column. */
export interface PropertyUpdate {
  status?: string | null;
  listingUrl?: string | null;
  listingSource?: string | null;
  listPrice?: number | null;
  manualEstimatedValue?: number | null;
  annualTaxes?: number | null;
  hoaMonthly?: number | null;
  beds?: number | null;
  baths?: number | null;
  sqft?: number | null;
  lotSize?: string | null;
  yearBuilt?: number | null;
  propertyType?: string | null;
  subjectiveScore?: number | null;
  manualSchoolScore?: number | null;
  manualPropertyValueScore?: number | null;
  notes?: string | null;
  photoUrl?: string | null;
}

/** Property plus a best-effort geocoding warning (null when geocoding worked). */
export interface CreatePropertyResult {
  property: Property;
  geocodeError: string | null;
}

export async function createProperty(
  property: NewProperty,
): Promise<CreatePropertyResult> {
  return invoke<CreatePropertyResult>("create_property", { property });
}

export async function listProperties(): Promise<Property[]> {
  return invoke<Property[]>("list_properties");
}

export async function getProperty(id: string): Promise<Property | null> {
  return invoke<Property | null>("get_property", { id });
}

export async function deleteProperty(id: string): Promise<void> {
  return invoke("delete_property", { id });
}

export async function updateProperty(
  id: string,
  update: PropertyUpdate,
): Promise<Property> {
  return invoke<Property>("update_property", { id, update });
}
