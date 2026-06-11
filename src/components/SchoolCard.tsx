import { useEffect, useState } from "react";

import {
  computeSchools,
  getSchools,
  listNjdoeSchools,
  matchSchoolToNjdoe,
  parseMetrics,
  schoolLevels,
  setAssignedSchools,
  type NjdoeSchool,
  type SchoolLevel,
  type SchoolResult,
} from "../services/schools";
import { schoolScoreFromMetrics } from "../services/scoring";
import { formatDistance } from "../services/routes";
import type { Property } from "../services/properties";

const LEVELS: SchoolLevel[] = ["Elementary", "Middle", "High"];

interface Props {
  property: Property;
  geocoded: boolean;
}

/**
 * Nearby schools (Google Places) with optional manual binding to imported NJDOE
 * records, plus manually-assigned elementary/middle/high fields. Per the brief,
 * "nearby" ≠ "assigned": matching to NJDOE is a manual, user-confirmed action and
 * the assigned schools are free-text fields (§5.3).
 */
export default function SchoolCard({ property, geocoded }: Props) {
  const [schools, setSchools] = useState<SchoolResult[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Which school's NJDOE picker is open, plus its search state.
  const [pickerFor, setPickerFor] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [results, setResults] = useState<NjdoeSchool[]>([]);
  const [searching, setSearching] = useState(false);

  // Assigned schools form.
  const [elementary, setElementary] = useState(property.assignedElementarySchool ?? "");
  const [middle, setMiddle] = useState(property.assignedMiddleSchool ?? "");
  const [high, setHigh] = useState(property.assignedHighSchool ?? "");
  const [assignedStatus, setAssignedStatus] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        setSchools(await getSchools(property.id));
      } catch (e) {
        setError(String(e));
      } finally {
        setLoading(false);
      }
    })();
  }, [property.id]);

  // Debounced NJDOE search when a picker is open.
  useEffect(() => {
    if (pickerFor === null) return;
    let cancelled = false;
    setSearching(true);
    const t = setTimeout(async () => {
      try {
        const list = await listNjdoeSchools(search, 25);
        if (!cancelled) setResults(list);
      } catch {
        if (!cancelled) setResults([]);
      } finally {
        if (!cancelled) setSearching(false);
      }
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [pickerFor, search]);

  async function onFetch() {
    setBusy(true);
    setError(null);
    try {
      setSchools(await computeSchools(property.id));
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }

  function openPicker(schoolId: string) {
    setPickerFor(schoolId);
    setSearch("");
    setResults([]);
  }

  async function bind(schoolId: string, njdoeId: string | null) {
    try {
      const updated = await matchSchoolToNjdoe(schoolId, njdoeId);
      setSchools((prev) => prev.map((s) => (s.id === schoolId ? updated : s)));
      setPickerFor(null);
    } catch (e) {
      setError(String(e));
    }
  }

  async function onSaveAssigned() {
    setAssignedStatus(null);
    try {
      await setAssignedSchools(
        property.id,
        elementary.trim() || null,
        middle.trim() || null,
        high.trim() || null,
      );
      setAssignedStatus("Saved ✓");
    } catch (e) {
      setError(String(e));
    }
  }

  // Nearest matched school per level (classified by NJDOE grade span).
  const matched = schools.filter((s) => s.matchedNjdoeId);
  const nearestByLevel = LEVELS.map((level) => ({
    level,
    school:
      matched
        .filter((s) => schoolLevels(s.gradeSpan).includes(level))
        .sort(
          (a, b) =>
            (a.distanceMeters ?? Infinity) - (b.distanceMeters ?? Infinity),
        )[0] ?? null,
  }));

  return (
    <section className="card">
      <div className="card-head">
        <h2 className="card-title">Schools</h2>
        {geocoded && (
          <button
            type="button"
            className="btn btn--sm"
            onClick={onFetch}
            disabled={busy}
          >
            {busy ? "Fetching…" : schools.length ? "Refresh nearby" : "Fetch nearby"}
          </button>
        )}
      </div>

      <p className="muted">
        Nearest elementary, middle, and high schools from Google Places (one
        focused search per level). “Nearby” is not the same as “assigned” — confirm
        boundaries with the district and match a school to imported NJDOE data to
        see its metrics.
      </p>

      {!geocoded && (
        <p className="muted">Geocode this property to find nearby schools.</p>
      )}

      {geocoded && loading && <p className="muted">Loading…</p>}

      {geocoded && !loading && schools.length === 0 && (
        <p className="muted">No schools fetched yet.</p>
      )}

      {geocoded && schools.length > 0 && (
        <table className="table">
          <thead>
            <tr>
              <th>School</th>
              <th>Level</th>
              <th>Distance</th>
              <th>NJDOE metrics</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {schools.map((s) => {
              const metrics = parseMetrics(s.metricsJson);
              const metricEntries = Object.entries(metrics);
              const matched = s.matchedNjdoeId != null;
              return (
                <tr key={s.id}>
                  <td>
                    {s.name}
                    {s.address && <span className="muted"> · {s.address}</span>}
                    {s.district && (
                      <div className="muted">
                        {s.district}
                        {s.gradeSpan ? ` · grades ${s.gradeSpan}` : ""}
                      </div>
                    )}
                  </td>
                  <td>{s.schoolType ?? "—"}</td>
                  <td>{formatDistance(s.distanceMeters)}</td>
                  <td>
                    {matched && metricEntries.length > 0 ? (
                      <ul className="metric-list">
                        {metricEntries.map(([k, v]) => (
                          <li key={k}>
                            <span className="muted">{k}:</span> {String(v)}
                          </li>
                        ))}
                      </ul>
                    ) : matched ? (
                      <span className="muted">matched (no metrics)</span>
                    ) : (
                      <span className="muted">—</span>
                    )}
                  </td>
                  <td>
                    {matched ? (
                      <button
                        type="button"
                        className="btn btn--sm btn--ghost"
                        onClick={() => bind(s.id, null)}
                      >
                        Unmatch
                      </button>
                    ) : (
                      <button
                        type="button"
                        className="btn btn--sm"
                        onClick={() => openPicker(s.id)}
                      >
                        Match NJDOE
                      </button>
                    )}
                    {pickerFor === s.id && (
                      <div className="njdoe-picker">
                        <input
                          type="text"
                          autoFocus
                          placeholder="Search NJDOE schools…"
                          value={search}
                          onChange={(e) => setSearch(e.target.value)}
                        />
                        <div className="njdoe-results">
                          {searching && <p className="muted">Searching…</p>}
                          {!searching && results.length === 0 && (
                            <p className="muted">
                              No matches. Import NJDOE data in Settings.
                            </p>
                          )}
                          {results.map((n) => (
                            <button
                              type="button"
                              key={n.id}
                              className="njdoe-option"
                              onClick={() => bind(s.id, n.id)}
                            >
                              <strong>{n.schoolName}</strong>
                              {n.districtName && (
                                <span className="muted"> · {n.districtName}</span>
                              )}
                            </button>
                          ))}
                        </div>
                        <button
                          type="button"
                          className="btn btn--sm btn--ghost"
                          onClick={() => setPickerFor(null)}
                        >
                          Cancel
                        </button>
                      </div>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}

      {matched.length > 0 && (
        <>
          <h3 className="subhead">By level (nearest matched)</h3>
          <p className="muted">
            Nearest school you’ve matched to NJDOE for each level, classified by
            grade span. The score is the average of ELA %, Math %, graduation %, and
            (100 − chronic absenteeism %).
          </p>
          <div className="level-grid">
            {nearestByLevel.map(({ level, school }) => {
              const metrics = school ? parseMetrics(school.metricsJson) : {};
              const score = school ? schoolScoreFromMetrics(metrics) : null;
              return (
                <div key={level} className="level-card">
                  <div className="level-head">
                    <span className="level-name">{level}</span>
                    {score != null && (
                      <span className="level-score">{Math.round(score)}</span>
                    )}
                  </div>
                  {school ? (
                    <>
                      <div className="level-school">{school.name}</div>
                      <div className="muted">
                        {school.gradeSpan ? `grades ${school.gradeSpan} · ` : ""}
                        {formatDistance(school.distanceMeters)}
                      </div>
                      <ul className="metric-list">
                        {Object.entries(metrics).map(([k, v]) => (
                          <li key={k}>
                            <span className="muted">{k}:</span> {String(v)}
                          </li>
                        ))}
                      </ul>
                    </>
                  ) : (
                    <div className="muted">
                      No matched {level.toLowerCase()} school.
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </>
      )}

      <h3 className="subhead">Assigned schools (manual)</h3>
      <div className="form-grid">
        <label className="field">
          <span className="field-label">Elementary</span>
          <input
            type="text"
            value={elementary}
            onChange={(e) => {
              setElementary(e.target.value);
              setAssignedStatus(null);
            }}
          />
        </label>
        <label className="field">
          <span className="field-label">Middle</span>
          <input
            type="text"
            value={middle}
            onChange={(e) => {
              setMiddle(e.target.value);
              setAssignedStatus(null);
            }}
          />
        </label>
        <label className="field">
          <span className="field-label">High</span>
          <input
            type="text"
            value={high}
            onChange={(e) => {
              setHigh(e.target.value);
              setAssignedStatus(null);
            }}
          />
        </label>
      </div>
      <div className="form-actions">
        <button type="button" className="btn btn--sm btn--primary" onClick={onSaveAssigned}>
          Save assigned
        </button>
        {assignedStatus && <span className="status status--ok">{assignedStatus}</span>}
      </div>

      {error && <p className="status status--err">{error}</p>}
    </section>
  );
}
