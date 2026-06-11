import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";

import { listProperties, type Property } from "../services/properties";
import { getAllRoutes, type RouteResult } from "../services/routes";
import { getAllAmenities, type AmenityResult } from "../services/amenities";
import {
  buildRow,
  loadWeights,
  saveWeights,
  DEFAULT_WEIGHTS,
  WEIGHT_LABELS,
  type ComparisonRow,
  type ScoringWeights,
} from "../services/scoring";

function fmtPrice(value: number | null): string {
  if (value == null) return "—";
  return value.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  });
}

function fmtNum(value: number | null, digits = 0, suffix = ""): string {
  if (value == null || !Number.isFinite(value)) return "—";
  return `${value.toFixed(digits)}${suffix}`;
}

function fmtScore(value: number | null): string {
  if (value == null) return "—";
  return String(Math.round(value));
}

function fmtDate(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleDateString("en-US");
}

type SortKey =
  | "photo"
  | "address"
  | "town"
  | "status"
  | "price"
  | "ppsf"
  | "taxes"
  | "beds"
  | "baths"
  | "sqft"
  | "parents"
  | "inlaws"
  | "grocery"
  | "postOffice"
  | "school"
  | "taxScore"
  | "overall"
  | "updated";

interface Column {
  key: SortKey;
  label: string;
  numeric: boolean;
  value: (r: ComparisonRow) => number | string | null;
  render: (r: ComparisonRow) => React.ReactNode;
  csv: (r: ComparisonRow) => string;
}

function locationLabel(p: Property): string {
  if (p.addressNormalized) return p.addressNormalized;
  const parts = [p.city, p.state].filter(Boolean);
  return parts.length ? parts.join(", ") : p.addressInput;
}

const COLUMNS: Column[] = [
  {
    key: "photo",
    label: "",
    numeric: false,
    value: (r) => r.property.photoUrl ?? "",
    render: (r) =>
      r.property.photoUrl ? (
        <Link to={`/property/${r.property.id}`}>
          <img
            className="dash-thumb"
            src={r.property.photoUrl}
            alt=""
            loading="lazy"
            onError={(e) => {
              (e.currentTarget as HTMLImageElement).style.visibility = "hidden";
            }}
          />
        </Link>
      ) : (
        <span className="dash-thumb dash-thumb--empty" aria-hidden />
      ),
    csv: (r) => r.property.photoUrl ?? "",
  },
  {
    key: "address",
    label: "Address",
    numeric: false,
    value: (r) => locationLabel(r.property),
    render: (r) => (
      <Link to={`/property/${r.property.id}`}>{locationLabel(r.property)}</Link>
    ),
    csv: (r) => locationLabel(r.property),
  },
  {
    key: "town",
    label: "Town",
    numeric: false,
    value: (r) => r.town,
    render: (r) => r.town,
    csv: (r) => r.town,
  },
  {
    key: "status",
    label: "Status",
    numeric: false,
    value: (r) => r.property.status,
    render: (r) => r.property.status,
    csv: (r) => r.property.status,
  },
  {
    key: "price",
    label: "Price",
    numeric: true,
    value: (r) => r.property.listPrice,
    render: (r) => fmtPrice(r.property.listPrice),
    csv: (r) => (r.property.listPrice == null ? "" : String(r.property.listPrice)),
  },
  {
    key: "ppsf",
    label: "$/sqft",
    numeric: true,
    value: (r) => r.pricePerSqft,
    render: (r) => fmtNum(r.pricePerSqft, 0, ""),
    csv: (r) => (r.pricePerSqft == null ? "" : r.pricePerSqft.toFixed(0)),
  },
  {
    key: "taxes",
    label: "Taxes",
    numeric: true,
    value: (r) => r.property.annualTaxes,
    render: (r) => fmtPrice(r.property.annualTaxes),
    csv: (r) =>
      r.property.annualTaxes == null ? "" : String(r.property.annualTaxes),
  },
  {
    key: "beds",
    label: "Beds",
    numeric: true,
    value: (r) => r.property.beds,
    render: (r) => fmtNum(r.property.beds, 0),
    csv: (r) => (r.property.beds == null ? "" : String(r.property.beds)),
  },
  {
    key: "baths",
    label: "Baths",
    numeric: true,
    value: (r) => r.property.baths,
    render: (r) => fmtNum(r.property.baths, 1),
    csv: (r) => (r.property.baths == null ? "" : String(r.property.baths)),
  },
  {
    key: "sqft",
    label: "Sqft",
    numeric: true,
    value: (r) => r.property.sqft,
    render: (r) => fmtNum(r.property.sqft, 0),
    csv: (r) => (r.property.sqft == null ? "" : String(r.property.sqft)),
  },
  {
    key: "parents",
    label: "Parents",
    numeric: true,
    value: (r) => r.parentsMinutes,
    render: (r) => fmtNum(r.parentsMinutes, 0, " min"),
    csv: (r) => (r.parentsMinutes == null ? "" : r.parentsMinutes.toFixed(0)),
  },
  {
    key: "inlaws",
    label: "In-laws",
    numeric: true,
    value: (r) => r.inlawsMinutes,
    render: (r) => fmtNum(r.inlawsMinutes, 0, " min"),
    csv: (r) => (r.inlawsMinutes == null ? "" : r.inlawsMinutes.toFixed(0)),
  },
  {
    key: "grocery",
    label: "Grocery",
    numeric: true,
    value: (r) => r.groceryMiles,
    render: (r) => fmtNum(r.groceryMiles, 1, " mi"),
    csv: (r) => (r.groceryMiles == null ? "" : r.groceryMiles.toFixed(2)),
  },
  {
    key: "postOffice",
    label: "Post office",
    numeric: true,
    value: (r) => r.postOfficeMiles,
    render: (r) => fmtNum(r.postOfficeMiles, 1, " mi"),
    csv: (r) => (r.postOfficeMiles == null ? "" : r.postOfficeMiles.toFixed(2)),
  },
  {
    key: "school",
    label: "School",
    numeric: true,
    value: (r) => r.sub.school,
    render: (r) => fmtScore(r.sub.school),
    csv: (r) => (r.sub.school == null ? "" : String(Math.round(r.sub.school))),
  },
  {
    key: "taxScore",
    label: "Tax score",
    numeric: true,
    value: (r) => r.sub.tax,
    render: (r) => fmtScore(r.sub.tax),
    csv: (r) => (r.sub.tax == null ? "" : String(Math.round(r.sub.tax))),
  },
  {
    key: "overall",
    label: "Overall",
    numeric: true,
    value: (r) => r.overall,
    render: (r) => <strong>{fmtScore(r.overall)}</strong>,
    csv: (r) => (r.overall == null ? "" : String(Math.round(r.overall))),
  },
  {
    key: "updated",
    label: "Updated",
    numeric: false,
    value: (r) => r.property.updatedAt,
    render: (r) => fmtDate(r.property.updatedAt),
    csv: (r) => r.property.updatedAt,
  },
];

function csvCell(s: string): string {
  if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function downloadCsv(rows: ComparisonRow[]): void {
  const header = COLUMNS.map((c) => csvCell(c.label)).join(",");
  const lines = rows.map((r) =>
    COLUMNS.map((c) => csvCell(c.csv(r))).join(","),
  );
  const blob = new Blob([[header, ...lines].join("\n")], {
    type: "text/csv;charset=utf-8;",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `homelens-comparison-${new Date()
    .toISOString()
    .slice(0, 10)}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export default function DashboardPage() {
  const [properties, setProperties] = useState<Property[]>([]);
  const [routes, setRoutes] = useState<RouteResult[]>([]);
  const [amenities, setAmenities] = useState<AmenityResult[]>([]);
  const [weights, setWeights] = useState<ScoringWeights>(DEFAULT_WEIGHTS);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [sortKey, setSortKey] = useState<SortKey>("overall");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [townFilter, setTownFilter] = useState<string>("all");
  const [hideRejected, setHideRejected] = useState(true);
  const [showWeights, setShowWeights] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const [props, allRoutes, allAmenities, w] = await Promise.all([
          listProperties(),
          getAllRoutes(),
          getAllAmenities(),
          loadWeights(),
        ]);
        setProperties(props);
        setRoutes(allRoutes);
        setAmenities(allAmenities);
        setWeights(w);
      } catch (e) {
        setError(String(e));
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const rows = useMemo<ComparisonRow[]>(
    () =>
      properties.map((p) =>
        buildRow(
          p,
          routes.filter((r) => r.propertyId === p.id),
          amenities.filter((a) => a.propertyId === p.id),
          weights,
        ),
      ),
    [properties, routes, amenities, weights],
  );

  const towns = useMemo(
    () => [...new Set(rows.map((r) => r.town))].sort(),
    [rows],
  );
  const statuses = useMemo(
    () => [...new Set(rows.map((r) => r.property.status))].sort(),
    [rows],
  );

  const visibleRows = useMemo(() => {
    let out = rows;
    if (hideRejected) {
      out = out.filter((r) => r.property.status !== "rejected");
    }
    if (statusFilter !== "all") {
      out = out.filter((r) => r.property.status === statusFilter);
    }
    if (townFilter !== "all") {
      out = out.filter((r) => r.town === townFilter);
    }
    const col = COLUMNS.find((c) => c.key === sortKey)!;
    const dir = sortDir === "asc" ? 1 : -1;
    return [...out].sort((a, b) => {
      const av = col.value(a);
      const bv = col.value(b);
      // Nulls always sort to the bottom regardless of direction.
      const aNull = av == null || av === "";
      const bNull = bv == null || bv === "";
      if (aNull && bNull) return 0;
      if (aNull) return 1;
      if (bNull) return -1;
      if (col.numeric) return ((av as number) - (bv as number)) * dir;
      return String(av).localeCompare(String(bv)) * dir;
    });
  }, [rows, hideRejected, statusFilter, townFilter, sortKey, sortDir]);

  function onSort(key: SortKey) {
    if (key === sortKey) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      // Text columns default to ascending; numeric to descending (best first).
      const col = COLUMNS.find((c) => c.key === key)!;
      setSortDir(col.numeric ? "desc" : "asc");
    }
  }

  async function onWeightChange(key: keyof ScoringWeights, value: number) {
    const next = { ...weights, [key]: value };
    setWeights(next);
    await saveWeights(next);
  }

  async function onResetWeights() {
    setWeights(DEFAULT_WEIGHTS);
    await saveWeights(DEFAULT_WEIGHTS);
  }

  const weightSum = Object.values(weights).reduce((a, b) => a + b, 0);

  return (
    <div className="page page--map">
      <div className="dashboard-head">
        <div>
          <h1 className="page-title">Comparison</h1>
          <p className="muted">
            Weighted scores blend drive times, amenities, taxes, and your manual
            school/value/gut-feel ratings. School, property-value, and subjective
            sub-scores are <em>hand-entered</em>, so treat “Overall” as a guided
            opinion, not data-derived truth.
          </p>
        </div>
        <button
          type="button"
          className="btn"
          onClick={() => downloadCsv(visibleRows)}
          disabled={visibleRows.length === 0}
        >
          Export CSV
        </button>
      </div>

      {loading && <p className="muted">Loading…</p>}
      {error && <p className="status status--err">{error}</p>}

      {!loading && !error && properties.length === 0 && (
        <div className="placeholder">
          No properties yet. <Link to="/add">Add your first one →</Link>
        </div>
      )}

      {!loading && !error && properties.length > 0 && (
        <>
          <div className="dashboard-controls">
            <label className="control">
              <span>Status</span>
              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
              >
                <option value="all">All</option>
                {statuses.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </label>
            <label className="control">
              <span>Town</span>
              <select
                value={townFilter}
                onChange={(e) => setTownFilter(e.target.value)}
              >
                <option value="all">All</option>
                {towns.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            </label>
            <label className="control control--check">
              <input
                type="checkbox"
                checked={hideRejected}
                onChange={(e) => setHideRejected(e.target.checked)}
              />
              <span>Hide rejected</span>
            </label>
            <button
              type="button"
              className="btn btn--sm"
              onClick={() => setShowWeights((v) => !v)}
            >
              {showWeights ? "Hide weights" : "Edit weights"}
            </button>
            <span className="muted">
              {visibleRows.length} of {rows.length} shown
            </span>
          </div>

          {showWeights && (
            <div className="weights-editor">
              <p className="muted">
                Weights are normalized per property over the sub-scores that
                exist. Current sum: {weightSum.toFixed(2)}.
              </p>
              <div className="weights-grid">
                {(Object.keys(weights) as Array<keyof ScoringWeights>).map(
                  (k) => (
                    <label key={k} className="weight-field">
                      <span>
                        {WEIGHT_LABELS[k]} — {weights[k].toFixed(2)}
                      </span>
                      <input
                        type="range"
                        min={0}
                        max={1}
                        step={0.05}
                        value={weights[k]}
                        onChange={(e) =>
                          onWeightChange(k, Number(e.target.value))
                        }
                      />
                    </label>
                  ),
                )}
              </div>
              <button
                type="button"
                className="btn btn--sm"
                onClick={onResetWeights}
              >
                Reset to defaults
              </button>
            </div>
          )}

          <div className="table-scroll">
            <table className="table table--compare">
              <thead>
                <tr>
                  {COLUMNS.map((c) => (
                    <th
                      key={c.key}
                      className={`sortable${c.numeric ? " num" : ""}`}
                      onClick={() => onSort(c.key)}
                    >
                      {c.label}
                      {sortKey === c.key && (
                        <span className="sort-arrow">
                          {sortDir === "asc" ? " ▲" : " ▼"}
                        </span>
                      )}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {visibleRows.map((r) => (
                  <tr key={r.property.id}>
                    {COLUMNS.map((c) => (
                      <td key={c.key} className={c.numeric ? "num" : ""}>
                        {c.render(r)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
