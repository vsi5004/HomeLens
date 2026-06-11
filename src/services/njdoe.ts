import type { NjdoeSchoolInput } from "./schools";

/**
 * Minimal RFC-4180-ish CSV parser: handles quoted fields, escaped quotes (""),
 * commas and newlines inside quotes, and CRLF. Returns rows of string cells.
 */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  // Strip a UTF-8 BOM if present.
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);

  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += c;
      }
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(field);
      field = "";
      rows.push(row);
      row = [];
    } else {
      field += c;
    }
  }
  // Flush the trailing field/row if the file doesn't end with a newline.
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  // Drop fully-empty rows.
  return rows.filter((r) => r.some((cell) => cell.trim() !== ""));
}

/** Normalize a header cell for fuzzy matching. */
function norm(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

interface FieldSpec {
  /** Output key. */
  key: string;
  /** Normalized substrings; first matching header wins. */
  aliases: string[];
}

const IDENTITY_FIELDS: FieldSpec[] = [
  { key: "schoolName", aliases: ["school name", "schoolname", "school"] },
  { key: "districtName", aliases: ["district name", "districtname", "district", "lea name"] },
  { key: "countyName", aliases: ["county name", "countyname", "county"] },
  { key: "gradeSpan", aliases: ["grade span", "gradespan", "grades", "grade level"] },
  { key: "enrollment", aliases: ["enrollment", "total enrollment", "students enrolled"] },
];

const CODE_FIELDS: FieldSpec[] = [
  { key: "countyCode", aliases: ["county code", "countycode", "co code"] },
  { key: "districtCode", aliases: ["district code", "districtcode", "lea code", "dist code"] },
  { key: "schoolCode", aliases: ["school code", "schoolcode", "sch code"] },
];

/** Known NJDOE metrics (brief §5.3). Each captured into `metrics` under `label`. */
const METRIC_FIELDS: { label: string; aliases: string[] }[] = [
  { label: "ELA proficiency", aliases: ["ela proficiency", "ela ", "english language arts proficiency", "ela percent meeting exceeding"] },
  { label: "Math proficiency", aliases: ["math proficiency", "math ", "mathematics proficiency", "math percent meeting exceeding"] },
  { label: "Chronic absenteeism", aliases: ["chronic absenteeism", "chronically absent"] },
  { label: "Graduation rate", aliases: ["graduation rate", "grad rate", "4 year graduation"] },
  { label: "Student/teacher ratio", aliases: ["student to teacher ratio", "student teacher ratio", "student faculty ratio"] },
  { label: "Summative score", aliases: ["summative score", "summative rating", "accountability summative"] },
];

function findIndex(headers: string[], aliases: string[]): number {
  const normalized = headers.map(norm);
  for (const alias of aliases) {
    const a = alias.trim();
    // Prefer an exact normalized match first, then a substring match.
    const exact = normalized.indexOf(a);
    if (exact !== -1) return exact;
  }
  for (const alias of aliases) {
    const a = alias.trim();
    const idx = normalized.findIndex((h) => h.includes(a));
    if (idx !== -1) return idx;
  }
  return -1;
}

export interface MappedNjdoe {
  records: NjdoeSchoolInput[];
  /** Which output fields were detected, mapped to the source header. */
  detected: Record<string, string>;
  /** Metric labels detected, mapped to the source header. */
  detectedMetrics: Record<string, string>;
  skipped: number;
}

/**
 * Map parsed CSV rows to NJDOE import records using fuzzy header matching.
 * Unrecognized but data-like columns are ignored; the known metric columns are
 * folded into each row's `metrics` object. The CDS code (county+district+school)
 * is used as a stable id when present so re-imports update in place.
 */
export function mapNjdoeRows(rows: string[][]): MappedNjdoe {
  if (rows.length < 2) {
    return { records: [], detected: {}, detectedMetrics: {}, skipped: 0 };
  }
  const headers = rows[0];

  const detected: Record<string, string> = {};
  const idx: Record<string, number> = {};
  for (const f of [...IDENTITY_FIELDS, ...CODE_FIELDS]) {
    const i = findIndex(headers, f.aliases);
    idx[f.key] = i;
    if (i !== -1) detected[f.key] = headers[i];
  }

  const detectedMetrics: Record<string, string> = {};
  const metricIdx: { label: string; i: number }[] = [];
  for (const m of METRIC_FIELDS) {
    const i = findIndex(headers, m.aliases);
    if (i !== -1) {
      metricIdx.push({ label: m.label, i });
      detectedMetrics[m.label] = headers[i];
    }
  }

  const cell = (r: string[], i: number): string =>
    i >= 0 && i < r.length ? r[i].trim() : "";

  const records: NjdoeSchoolInput[] = [];
  let skipped = 0;

  for (let r = 1; r < rows.length; r++) {
    const row = rows[r];
    const schoolName = cell(row, idx.schoolName);
    if (!schoolName) {
      skipped++;
      continue;
    }

    const countyCode = cell(row, idx.countyCode);
    const districtCode = cell(row, idx.districtCode);
    const schoolCode = cell(row, idx.schoolCode);
    const id =
      countyCode && districtCode && schoolCode
        ? `${countyCode}-${districtCode}-${schoolCode}`
        : undefined;

    const enrollmentRaw = cell(row, idx.enrollment).replace(/[, ]/g, "");
    const enrollment = enrollmentRaw && !Number.isNaN(Number(enrollmentRaw))
      ? Number(enrollmentRaw)
      : undefined;

    const metrics: Record<string, string | number> = {};
    for (const { label, i } of metricIdx) {
      const v = cell(row, i);
      if (v) metrics[label] = v;
    }

    records.push({
      id,
      schoolName,
      districtName: cell(row, idx.districtName) || undefined,
      countyName: cell(row, idx.countyName) || undefined,
      gradeSpan: cell(row, idx.gradeSpan) || undefined,
      enrollment,
      metrics,
    });
  }

  return { records, detected, detectedMetrics, skipped };
}
