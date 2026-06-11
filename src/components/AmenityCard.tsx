import { useEffect, useMemo, useState } from "react";

import {
  computeAmenities,
  getAmenities,
  getAmenityCategories,
  type AmenityCategoryInfo,
  type AmenityError,
  type AmenityResult,
} from "../services/amenities";
import { formatDistance } from "../services/routes";

interface Props {
  propertyId: string;
  /** Whether the property has coordinates; Places search needs them. */
  geocoded: boolean;
}

/**
 * Shows nearby amenities by category, served from cache. Fetching is an explicit
 * user action (one billed Places call per category), with confirmation for the
 * full fan-out (brief §17.1 cost controls).
 */
export default function AmenityCard({ propertyId, geocoded }: Props) {
  const [categories, setCategories] = useState<AmenityCategoryInfo[]>([]);
  const [amenities, setAmenities] = useState<AmenityResult[]>([]);
  const [errors, setErrors] = useState<AmenityError[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const [cats, cached] = await Promise.all([
          getAmenityCategories(),
          getAmenities(propertyId),
        ]);
        setCategories(cats);
        setAmenities(cached);
      } catch (e) {
        setError(String(e));
      } finally {
        setLoading(false);
      }
    })();
  }, [propertyId]);

  /** Amenities grouped by category key, each sorted nearest-first. */
  const byCategory = useMemo(() => {
    const map = new Map<string, AmenityResult[]>();
    for (const a of amenities) {
      const list = map.get(a.category) ?? [];
      list.push(a);
      map.set(a.category, list);
    }
    for (const list of map.values()) {
      list.sort(
        (a, b) =>
          (a.distanceMeters ?? Infinity) - (b.distanceMeters ?? Infinity),
      );
    }
    return map;
  }, [amenities]);

  async function fetchCategories(keys?: string[]) {
    setBusy(keys && keys.length === 1 ? keys[0] : "all");
    setError(null);
    try {
      const result = await computeAmenities(propertyId, keys);
      setAmenities(result.amenities);
      setErrors(result.errors);
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(null);
    }
  }

  function onFetchAll() {
    const n = categories.length;
    if (
      window.confirm(
        `Fetch all ${n} amenity categories? This makes ${n} Google Places calls.`,
      )
    ) {
      void fetchCategories();
    }
  }

  return (
    <section className="card">
      <div className="card-head">
        <h2 className="card-title">Nearby amenities</h2>
        {geocoded && (
          <button
            type="button"
            className="btn btn--sm"
            onClick={onFetchAll}
            disabled={busy !== null}
          >
            {busy === "all" ? "Fetching…" : "Fetch all"}
          </button>
        )}
      </div>

      {!geocoded && (
        <p className="muted">Geocode this property to find nearby amenities.</p>
      )}

      {geocoded && loading && <p className="muted">Loading…</p>}

      {geocoded && !loading && (
        <table className="table">
          <thead>
            <tr>
              <th>Category</th>
              <th>Nearest</th>
              <th>Distance</th>
              <th>Rating</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {categories.map((c) => {
              const list = byCategory.get(c.key) ?? [];
              const nearest = list[0];
              const err = errors.find((e) => e.category === c.key);
              return (
                <tr key={c.key}>
                  <td>{c.label}</td>
                  <td>
                    {nearest ? (
                      <>
                        {nearest.name}
                        {nearest.address && (
                          <span className="muted"> · {nearest.address}</span>
                        )}
                      </>
                    ) : err ? (
                      <span className="status status--err">{err.message}</span>
                    ) : (
                      <span className="muted">—</span>
                    )}
                  </td>
                  <td>{nearest ? formatDistance(nearest.distanceMeters) : "—"}</td>
                  <td>
                    {nearest?.rating != null
                      ? `★ ${nearest.rating.toFixed(1)}${
                          nearest.userRatingsTotal != null
                            ? ` (${nearest.userRatingsTotal})`
                            : ""
                        }`
                      : "—"}
                  </td>
                  <td>
                    <button
                      type="button"
                      className="btn btn--sm"
                      onClick={() => fetchCategories([c.key])}
                      disabled={busy !== null}
                    >
                      {busy === c.key ? "…" : nearest ? "Refresh" : "Fetch"}
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}

      {error && <p className="status status--err">{error}</p>}
    </section>
  );
}
