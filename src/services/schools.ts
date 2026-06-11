import { invoke } from "./ipc";

/** A nearby school for a property, optionally matched to an NJDOE record. */
export interface SchoolResult {
  id: string;
  propertyId: string;
  name: string;
  district: string | null;
  gradeSpan: string | null;
  schoolType: string | null;
  address: string | null;
  latitude: number | null;
  longitude: number | null;
  distanceMeters: number | null;
  source: string | null;
  matchedNjdoeId: string | null;
  metricsJson: string | null;
  fetchedAt: string;
}

/** An imported NJDOE school performance row. */
export interface NjdoeSchool {
  id: string;
  countyName: string | null;
  districtName: string | null;
  schoolName: string;
  gradeSpan: string | null;
  enrollment: number | null;
  metricsJson: string;
  source: string | null;
  importedAt: string;
}

/** One row to import (parsed/mapped on the frontend). */
export interface NjdoeSchoolInput {
  id?: string;
  countyName?: string;
  districtName?: string;
  schoolName: string;
  gradeSpan?: string;
  enrollment?: number;
  metrics: Record<string, string | number>;
}

export interface ImportResult {
  imported: number;
  skipped: number;
  total: number;
}

export async function getSchools(propertyId: string): Promise<SchoolResult[]> {
  return invoke<SchoolResult[]>("get_schools", { propertyId });
}

/** All cached school results across every property (for dashboard scoring). */
export async function getAllSchools(): Promise<SchoolResult[]> {
  return invoke<SchoolResult[]>("list_all_school_results");
}

export async function computeSchools(propertyId: string): Promise<SchoolResult[]> {
  return invoke<SchoolResult[]>("compute_schools", { propertyId });
}

export async function importNjdoeSchools(
  records: NjdoeSchoolInput[],
  source?: string,
): Promise<ImportResult> {
  return invoke<ImportResult>("import_njdoe_schools", {
    records,
    source: source ?? null,
  });
}

export async function njdoeCount(): Promise<number> {
  return invoke<number>("njdoe_count");
}

export async function clearNjdoeSchools(): Promise<number> {
  return invoke<number>("clear_njdoe_schools");
}

export async function listNjdoeSchools(
  search?: string,
  limit?: number,
): Promise<NjdoeSchool[]> {
  return invoke<NjdoeSchool[]>("list_njdoe_schools", {
    search: search ?? null,
    limit: limit ?? null,
  });
}

export async function matchSchoolToNjdoe(
  schoolResultId: string,
  njdoeId: string | null,
): Promise<SchoolResult> {
  return invoke<SchoolResult>("match_school_to_njdoe", {
    schoolResultId,
    njdoeId,
  });
}

export async function setAssignedSchools(
  propertyId: string,
  elementary: string | null,
  middle: string | null,
  high: string | null,
): Promise<void> {
  await invoke("set_assigned_schools", { propertyId, elementary, middle, high });
}

export type SchoolLevel = "Elementary" | "Middle" | "High";

const GRADE_ORD: Record<string, number> = { PK: -1, K: 0 };
function gradeOrd(token: string): number | null {
  const t = token.trim().toUpperCase();
  if (t in GRADE_ORD) return GRADE_ORD[t];
  const n = parseInt(t, 10);
  return Number.isFinite(n) ? n : null;
}

/**
 * Map an NJDOE grade span ("PK-5", "6-8", "8-12", "K") to the level(s) it serves.
 * A school can serve more than one (e.g. K-8 → Elementary + Middle).
 */
export function schoolLevels(gradeSpan: string | null): SchoolLevel[] {
  if (!gradeSpan) return [];
  const parts = gradeSpan.split("-");
  const lo = gradeOrd(parts[0]);
  const hi = gradeOrd(parts[parts.length - 1]);
  if (lo == null || hi == null) return [];
  const ranges: [SchoolLevel, number, number][] = [
    ["Elementary", -1, 5],
    ["Middle", 6, 8],
    ["High", 9, 12],
  ];
  return ranges
    .filter(([, rlo, rhi]) => lo <= rhi && hi >= rlo)
    .map(([level]) => level);
}

/** Parse a metrics JSON blob into a label→value record (tolerant of nulls). */
export function parseMetrics(
  json: string | null,
): Record<string, string | number> {
  if (!json) return {};
  try {
    const obj = JSON.parse(json);
    return obj && typeof obj === "object" ? obj : {};
  } catch {
    return {};
  }
}
