import type { Property } from "./properties";
import type { RouteResult } from "./routes";
import type { AmenityResult } from "./amenities";
import { getSetting, setSetting, SETTING_KEYS } from "./settings";

/**
 * Scoring weights for the overall property score. Defaults come from the brief
 * (§6.5). Weights are normalized over the sub-scores actually available for a
 * given property, so a missing component (e.g. no drive times yet) doesn't drag
 * the score toward zero — it's simply excluded and the rest are renormalized.
 *
 * HONESTY NOTE (brief §6.5): school, propertyValue, and subjective are
 * *manually entered* 0–100 fields in the MVP, so the overall score is largely a
 * weighted blend of hand-entered numbers, not computed analysis.
 */
export interface ScoringWeights {
  familyAccess: number;
  school: number;
  amenity: number;
  propertyValue: number;
  tax: number;
  subjective: number;
}

export const DEFAULT_WEIGHTS: ScoringWeights = {
  familyAccess: 0.2,
  school: 0.25,
  amenity: 0.15,
  propertyValue: 0.15,
  tax: 0.15,
  subjective: 0.1,
};

export const WEIGHT_LABELS: Record<keyof ScoringWeights, string> = {
  familyAccess: "Family access",
  school: "School (manual)",
  amenity: "Amenities",
  propertyValue: "Property value (manual)",
  tax: "Tax burden",
  subjective: "Subjective (manual)",
};

export async function loadWeights(): Promise<ScoringWeights> {
  const raw = await getSetting(SETTING_KEYS.scoringWeights);
  if (!raw) return { ...DEFAULT_WEIGHTS };
  try {
    const parsed = JSON.parse(raw) as Partial<ScoringWeights>;
    return { ...DEFAULT_WEIGHTS, ...parsed };
  } catch {
    return { ...DEFAULT_WEIGHTS };
  }
}

export async function saveWeights(weights: ScoringWeights): Promise<void> {
  await setSetting(SETTING_KEYS.scoringWeights, JSON.stringify(weights));
}

/** Linear interpolation across an ascending list of (input, score) breakpoints. */
function interpolate(
  value: number,
  points: Array<[number, number]>,
): number {
  if (value <= points[0][0]) return points[0][1];
  const last = points[points.length - 1];
  if (value >= last[0]) return last[1];
  for (let i = 0; i < points.length - 1; i++) {
    const [x0, y0] = points[i];
    const [x1, y1] = points[i + 1];
    if (value >= x0 && value <= x1) {
      const t = (value - x0) / (x1 - x0);
      return y0 + t * (y1 - y0);
    }
  }
  return last[1];
}

const clamp100 = (n: number) => Math.max(0, Math.min(100, n));

/**
 * Family access score (brief §6.5). Per destination, interpolate minutes →
 * score, then average the destinations we have a drive time for.
 */
export function familyAccessScore(minutesByDest: number[]): number | null {
  const points: Array<[number, number]> = [
    [15, 100],
    [20, 85],
    [30, 65],
    [45, 35],
    [60, 0],
  ];
  const valid = minutesByDest.filter((m) => Number.isFinite(m));
  if (valid.length === 0) return null;
  const sum = valid.reduce((acc, m) => acc + interpolate(m, points), 0);
  return clamp100(sum / valid.length);
}

/**
 * Amenity score from straight-line distances (miles). The brief's model uses
 * travel time, but we only store haversine distance (cost control — no
 * per-amenity Routes calls), so we score on distance and label it as such.
 */
export function amenityScore(milesByCategory: number[]): number | null {
  const points: Array<[number, number]> = [
    [0.5, 100],
    [1, 85],
    [2, 60],
    [4, 30],
    [6, 0],
  ];
  const valid = milesByCategory.filter((m) => Number.isFinite(m));
  if (valid.length === 0) return null;
  const sum = valid.reduce((acc, m) => acc + interpolate(m, points), 0);
  return clamp100(sum / valid.length);
}

/**
 * Tax score (brief §6.5) from the effective tax rate against a FIXED NJ band
 * (stable from the first property — no tiny-sample percentile ranking).
 */
export function taxScore(
  annualTaxes: number | null,
  basis: number | null,
): number | null {
  if (annualTaxes == null || basis == null || basis <= 0) return null;
  const ratePct = (annualTaxes / basis) * 100;
  const points: Array<[number, number]> = [
    [1.5, 100],
    [2.0, 80],
    [2.5, 55],
    [3.0, 30],
    [3.5, 0],
  ];
  return clamp100(interpolate(ratePct, points));
}

export interface SubScores {
  familyAccess: number | null;
  school: number | null;
  amenity: number | null;
  propertyValue: number | null;
  tax: number | null;
  subjective: number | null;
}

/**
 * Weighted overall score, renormalized over the sub-scores that are present.
 * Returns null when no sub-score is available.
 */
export function overallScore(
  sub: SubScores,
  weights: ScoringWeights,
): number | null {
  let weighted = 0;
  let totalWeight = 0;
  (Object.keys(weights) as Array<keyof ScoringWeights>).forEach((k) => {
    const s = sub[k];
    if (s != null && Number.isFinite(s)) {
      weighted += s * weights[k];
      totalWeight += weights[k];
    }
  });
  if (totalWeight === 0) return null;
  return clamp100(weighted / totalWeight);
}

const METERS_PER_MILE = 1609.344;

/** A fully-assembled comparison row: property facts + sub-scores + overall. */
export interface ComparisonRow {
  property: Property;
  town: string;
  pricePerSqft: number | null;
  effectiveTaxRate: number | null;
  parentsMinutes: number | null;
  inlawsMinutes: number | null;
  groceryMiles: number | null;
  postOfficeMiles: number | null;
  sub: SubScores;
  overall: number | null;
}

function town(p: Property): string {
  return p.city ?? "—";
}

/** Nearest (smallest-distance) amenity miles for a category, or null. */
function nearestMiles(amenities: AmenityResult[], category: string): number | null {
  const inCat = amenities.filter(
    (a) => a.category === category && a.distanceMeters != null,
  );
  if (inCat.length === 0) return null;
  const min = Math.min(...inCat.map((a) => a.distanceMeters as number));
  return min / METERS_PER_MILE;
}

/**
 * Assemble a comparison row for one property from its cached routes/amenities
 * and the current scoring weights.
 */
export function buildRow(
  property: Property,
  routes: RouteResult[],
  amenities: AmenityResult[],
  weights: ScoringWeights,
): ComparisonRow {
  const durMin = (key: string): number | null => {
    const r = routes.find(
      (x) => x.destinationKey === key && x.durationSeconds != null,
    );
    return r ? (r.durationSeconds as number) / 60 : null;
  };

  const parentsMinutes = durMin("parents");
  const inlawsMinutes = durMin("inlaws");

  const allCategoryMiles = [...new Set(amenities.map((a) => a.category))]
    .map((c) => nearestMiles(amenities, c))
    .filter((m): m is number => m != null);

  const groceryMiles = nearestMiles(amenities, "grocery");
  const postOfficeMiles = nearestMiles(amenities, "post_office");

  const basis = property.listPrice ?? property.manualEstimatedValue;
  const pricePerSqft =
    property.listPrice != null && property.sqft && property.sqft > 0
      ? property.listPrice / property.sqft
      : null;
  const effectiveTaxRate =
    property.annualTaxes != null && basis != null && basis > 0
      ? (property.annualTaxes / basis) * 100
      : null;

  const sub: SubScores = {
    familyAccess: familyAccessScore(
      [parentsMinutes, inlawsMinutes].filter((m): m is number => m != null),
    ),
    school: property.manualSchoolScore,
    amenity: amenityScore(allCategoryMiles),
    propertyValue: property.manualPropertyValueScore,
    tax: taxScore(property.annualTaxes, basis),
    subjective: property.subjectiveScore,
  };

  return {
    property,
    town: town(property),
    pricePerSqft,
    effectiveTaxRate,
    parentsMinutes,
    inlawsMinutes,
    groceryMiles,
    postOfficeMiles,
    sub,
    overall: overallScore(sub, weights),
  };
}
