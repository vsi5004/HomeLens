import { useEffect, useState } from "react";

import {
  computeRoutes,
  formatDistance,
  formatDuration,
  getRoutes,
  type RouteError,
  type RouteResult,
} from "../services/routes";

interface Props {
  propertyId: string;
  /** Whether the property has coordinates; routing needs them. */
  geocoded: boolean;
}

/**
 * Shows cached drive time/distance from this property to both family
 * destinations, with a manual refresh that recomputes via the Routes API.
 */
export default function FamilyDriveCard({ propertyId, geocoded }: Props) {
  const [routes, setRoutes] = useState<RouteResult[]>([]);
  const [errors, setErrors] = useState<RouteError[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        setRoutes(await getRoutes(propertyId));
      } catch (e) {
        setError(String(e));
      } finally {
        setLoading(false);
      }
    })();
  }, [propertyId]);

  async function onRefresh() {
    setRefreshing(true);
    setError(null);
    try {
      const result = await computeRoutes(propertyId);
      setRoutes(result.routes);
      setErrors(result.errors);
    } catch (e) {
      setError(String(e));
    } finally {
      setRefreshing(false);
    }
  }

  return (
    <section className="card">
      <div className="card-head">
        <h2 className="card-title">Family drive times</h2>
        {geocoded && (
          <button
            type="button"
            className="btn btn--sm"
            onClick={onRefresh}
            disabled={refreshing}
          >
            {refreshing ? "Computing…" : "Refresh"}
          </button>
        )}
      </div>

      {!geocoded && (
        <p className="muted">Geocode this property to compute drive times.</p>
      )}

      {geocoded && loading && <p className="muted">Loading…</p>}

      {geocoded && !loading && routes.length === 0 && errors.length === 0 && (
        <p className="muted">
          No drive times yet. Click <strong>Refresh</strong> to compute them.
        </p>
      )}

      {routes.length > 0 && (
        <table className="table">
          <thead>
            <tr>
              <th>Destination</th>
              <th>Drive time</th>
              <th>Distance</th>
            </tr>
          </thead>
          <tbody>
            {routes.map((r) => (
              <tr key={r.id}>
                <td>{r.destinationLabel}</td>
                <td>{formatDuration(r.durationSeconds)}</td>
                <td>{formatDistance(r.distanceMeters)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {errors.length > 0 && (
        <ul className="route-errors">
          {errors.map((e) => (
            <li key={e.destinationKey} className="status status--err">
              {e.destinationLabel}: {e.message}
            </li>
          ))}
        </ul>
      )}

      {error && <p className="status status--err">{error}</p>}
    </section>
  );
}
