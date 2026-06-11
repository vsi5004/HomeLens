import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import intersect from "@turf/intersect";
import { featureCollection } from "@turf/helpers";
import type { Feature, MultiPolygon, Polygon } from "geojson";

import MapView, { type PolygonLayer } from "../components/MapView";
import { getMapsJsKey } from "../services/googleMaps";
import {
  computeFamilyIsochrones,
  getFamilyIsochrones,
  type FamilyIsochrones,
} from "../services/isochrones";
import { listProperties, type Property } from "../services/properties";

const COLORS: Record<string, { fill: string; stroke: string }> = {
  parents: { fill: "#2f6feb", stroke: "#1b4fb0" },
  inlaws: { fill: "#1a7f4b", stroke: "#125c36" },
};
const OVERLAP = { fill: "#e67e22", stroke: "#b5651d" };

/** Pull the first Polygon/MultiPolygon feature out of an ORS FeatureCollection. */
function firstPolygon(
  geojson: unknown,
): Feature<Polygon | MultiPolygon> | null {
  const fc = geojson as { features?: Feature<Polygon | MultiPolygon>[] };
  return fc?.features?.[0] ?? null;
}

export default function MapPage() {
  const navigate = useNavigate();
  const [properties, setProperties] = useState<Property[]>([]);
  const [mapsKey, setMapsKey] = useState<string>("");
  const [iso, setIso] = useState<FamilyIsochrones | null>(null);
  const [minutes, setMinutes] = useState(60);
  const [loading, setLoading] = useState(true);
  const [computing, setComputing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [computeError, setComputeError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const [props, key, isochrones] = await Promise.all([
          listProperties(),
          getMapsJsKey(),
          getFamilyIsochrones(),
        ]);
        setProperties(props);
        setMapsKey(key);
        setIso(isochrones);
        if (isochrones.rangeSeconds) {
          setMinutes(Math.round(isochrones.rangeSeconds / 60));
        }
      } catch (e) {
        setError(String(e));
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const MIN_MINUTES = 5;
  // Provider-driven cap: TravelTime allows 4 h, openrouteservice only 1 h.
  const MAX_MINUTES = Math.floor((iso?.maxRangeSeconds ?? 3600) / 60);

  const clampMinutes = (m: number) =>
    Math.min(MAX_MINUTES, Math.max(MIN_MINUTES, m || MIN_MINUTES));

  /** Select a range; if it's already cached, load it instantly (no API call). */
  async function selectRange(mins: number) {
    const clamped = clampMinutes(mins);
    setMinutes(clamped);
    const seconds = clamped * 60;
    if (iso?.availableRanges.includes(seconds)) {
      try {
        const result = await getFamilyIsochrones(seconds);
        setIso(result);
        setComputeError(null);
      } catch (e) {
        setComputeError(String(e));
      }
    }
  }

  async function onCompute() {
    const clamped = clampMinutes(minutes);
    if (clamped !== minutes) setMinutes(clamped);
    setComputing(true);
    setComputeError(null);
    try {
      const result = await computeFamilyIsochrones(clamped * 60);
      setIso(result);
      if (result.errors.length > 0) {
        setComputeError(
          result.errors.map((e) => `${e.label}: ${e.message}`).join("; "),
        );
      }
    } catch (e) {
      setComputeError(String(e));
    } finally {
      setComputing(false);
    }
  }

  const markers = useMemo(() => {
    const propMarkers = properties
      .filter((p) => p.latitude != null && p.longitude != null)
      .map((p) => ({
        lat: p.latitude!,
        lng: p.longitude!,
        title: p.addressNormalized ?? p.addressInput,
        imageUrl: p.photoUrl,
        onClick: () => navigate(`/property/${p.id}`),
      }));

    const familyMarkers = (iso?.locations ?? [])
      .filter((l) => l.latitude != null && l.longitude != null)
      .map((l) => ({
        lat: l.latitude!,
        lng: l.longitude!,
        title: `${l.label} — ${l.address}`,
        label: l.label.charAt(0).toUpperCase(),
      }));

    return [...familyMarkers, ...propMarkers];
  }, [properties, iso, navigate]);

  const polygons = useMemo<PolygonLayer[]>(() => {
    const layers: PolygonLayer[] = [];
    const locs = (iso?.locations ?? []).filter((l) => l.geojson);

    for (const l of locs) {
      const c = COLORS[l.key] ?? { fill: "#666", stroke: "#444" };
      layers.push({
        id: `iso-${l.key}`,
        geojson: l.geojson,
        fillColor: c.fill,
        strokeColor: c.stroke,
        fillOpacity: 0.2,
      });
    }

    // Overlap: the area reachable within range of BOTH destinations.
    if (locs.length >= 2) {
      const a = firstPolygon(locs[0].geojson);
      const b = firstPolygon(locs[1].geojson);
      if (a && b) {
        try {
          const overlap = intersect(featureCollection([a, b]));
          if (overlap) {
            layers.push({
              id: "iso-overlap",
              geojson: overlap,
              fillColor: OVERLAP.fill,
              strokeColor: OVERLAP.stroke,
              fillOpacity: 0.5,
            });
          }
        } catch {
          // Non-overlapping or degenerate geometry — skip the overlap layer.
        }
      }
    }

    return layers;
  }, [iso]);

  const hasOverlap = polygons.some((p) => p.id === "iso-overlap");
  const isoCount = (iso?.locations ?? []).filter((l) => l.geojson).length;
  const cachedRanges = iso?.availableRanges ?? [];
  const currentCached = cachedRanges.includes(minutes * 60);

  const providerLabel =
    iso?.provider === "traveltime"
      ? "TravelTime (up to 4 h)"
      : iso?.provider === "ors"
        ? "openrouteservice (up to 1 h)"
        : null;

  return (
    <div className="page page--map">
      <h1 className="page-title">Map View</h1>
      <p className="muted">
        Family homes and their {minutes}-minute driving areas. The highlighted
        overlap is where you could live within {minutes} minutes of both.
        {providerLabel && <> Provider: {providerLabel}.</>}
      </p>

      {loading && <p className="muted">Loading…</p>}
      {error && <p className="status status--err">{error}</p>}

      {!loading && !error && !mapsKey && (
        <div className="placeholder">
          Add a Google Maps JS key in Settings to enable the map.
        </div>
      )}

      {!loading && !error && mapsKey && (
        <>
          <div className="map-controls">
            <label className="map-controls__field">
              <span>Driving time (minutes, max {MAX_MINUTES})</span>
              <input
                type="number"
                min={MIN_MINUTES}
                max={MAX_MINUTES}
                step={5}
                value={minutes}
                onChange={(e) => setMinutes(Number(e.target.value))}
                onBlur={(e) => void selectRange(Number(e.target.value))}
              />
            </label>
            <button
              type="button"
              className="btn btn--primary"
              onClick={onCompute}
              disabled={computing}
            >
              {computing
                ? "Computing…"
                : currentCached
                  ? "Recompute areas"
                  : "Compute areas"}
            </button>
            <span className="map-legend">
              <span className="swatch swatch--parents" /> Parents
              <span className="swatch swatch--inlaws" /> In-laws
              <span className="swatch swatch--overlap" /> Overlap
            </span>
          </div>

          {cachedRanges.length > 0 && (
            <p className="muted">
              Cached:{" "}
              {cachedRanges.map((sec) => {
                const mins = Math.round(sec / 60);
                const active = mins === minutes;
                return (
                  <button
                    key={sec}
                    type="button"
                    className={`chip${active ? " chip--active" : ""}`}
                    onClick={() => void selectRange(mins)}
                  >
                    {mins} min
                  </button>
                );
              })}
            </p>
          )}

          {computeError && <p className="status status--err">{computeError}</p>}

          {isoCount > 0 && !hasOverlap && (
            <p className="muted">
              The two driving areas don't overlap at {minutes} minutes — try a
              larger radius.
            </p>
          )}

          {isoCount === 0 && (
            <p className="muted">
              No driving areas yet. Set your family addresses and a TravelTime
              (or openrouteservice) key in Settings, then click{" "}
              <strong>Compute areas</strong>.
            </p>
          )}

          <MapView
            apiKey={mapsKey}
            markers={markers}
            polygons={polygons}
            className="map-canvas map-canvas--fill"
          />
        </>
      )}
    </div>
  );
}
