import { invoke, isTauri, uploadParcelDataset } from "./ipc";

/** The matched parcel / MOD-IV record stored for a property. */
export interface ParcelResult {
  id: string;
  propertyId: string;
  source: string;
  municipality: string | null;
  county: string | null;
  block: string | null;
  lot: string | null;
  qualifier: string | null;
  propertyClass: string | null;
  landAssessment: number | null;
  improvementAssessment: number | null;
  totalAssessment: number | null;
  annualTaxes: number | null;
  ownerName: string | null;
  fetchedAt: string;
}

/** Manual parcel-field input. */
export interface ParcelInput {
  municipality?: string | null;
  county?: string | null;
  block?: string | null;
  lot?: string | null;
  qualifier?: string | null;
  propertyClass?: string | null;
  landAssessment?: number | null;
  improvementAssessment?: number | null;
  totalAssessment?: number | null;
  annualTaxes?: number | null;
  ownerName?: string | null;
}

export interface ParcelImportResult {
  imported: number;
  skipped: number;
  total: number;
}

/** Open a native file picker for a parcels GeoJSON file; returns the path or null.
 *  Desktop only — the web build uploads a File instead (see `uploadParcels`). */
export async function pickParcelFile(): Promise<string | null> {
  const { open } = await import("@tauri-apps/plugin-dialog");
  const selected = await open({
    multiple: false,
    directory: false,
    filters: [{ name: "GeoJSON", extensions: ["geojson", "json"] }],
  });
  return typeof selected === "string" ? selected : null;
}

/** True when parcel import goes through a native picker + Rust path read. */
export function parcelImportIsNative(): boolean {
  return isTauri();
}

/** Web-mode import: stream a chosen File to the server. */
export async function uploadParcels(
  file: File,
  source?: string,
): Promise<ParcelImportResult> {
  return uploadParcelDataset(file, source);
}

export async function importParcels(
  path: string,
  source?: string,
): Promise<ParcelImportResult> {
  return invoke<ParcelImportResult>("import_parcels", {
    path,
    source: source ?? null,
  });
}

export async function parcelsCount(): Promise<number> {
  return invoke<number>("parcels_count");
}

export async function clearParcels(): Promise<number> {
  return invoke<number>("clear_parcels");
}

export async function getParcel(
  propertyId: string,
): Promise<ParcelResult | null> {
  return invoke<ParcelResult | null>("get_parcel", { propertyId });
}

export async function lookupParcel(propertyId: string): Promise<ParcelResult> {
  return invoke<ParcelResult>("lookup_parcel", { propertyId });
}

export async function setParcel(
  propertyId: string,
  parcel: ParcelInput,
): Promise<ParcelResult> {
  return invoke<ParcelResult>("set_parcel", { propertyId, parcel });
}

export async function deleteParcel(propertyId: string): Promise<void> {
  await invoke("delete_parcel", { propertyId });
}
