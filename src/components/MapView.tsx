import { useEffect, useRef, useState } from "react";

import { loadGoogleMaps } from "../services/googleMaps";

interface MapMarker {
  lat: number;
  lng: number;
  title?: string;
  /** Optional marker label glyph (e.g. "P" for parents). */
  label?: string;
  /** Optional click handler (used by the multi-property Map View). */
  onClick?: () => void;
}

/** A GeoJSON polygon overlay (e.g. a drive-time isochrone or its overlap). */
export interface PolygonLayer {
  id: string;
  /** GeoJSON FeatureCollection, Feature, or geometry ([lng, lat] order). */
  geojson: unknown;
  fillColor: string;
  strokeColor: string;
  fillOpacity?: number;
}

interface Props {
  apiKey: string;
  markers: MapMarker[];
  polygons?: PolygonLayer[];
  /** Center; defaults to the first marker. */
  center?: { lat: number; lng: number };
  zoom?: number;
  className?: string;
}

/**
 * Interactive Google map. Renders markers and optional GeoJSON polygon overlays
 * (via per-layer Data layers) and fits bounds to everything shown. Loads the
 * Maps JS API lazily via the shared loader.
 */
export default function MapView({
  apiKey,
  markers,
  polygons = [],
  center,
  zoom = 15,
  className = "map-canvas",
}: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const dataLayers: google.maps.Data[] = [];

    loadGoogleMaps(apiKey)
      .then((g) => {
        if (cancelled || !ref.current) return;

        const fallback = { lat: 40.2206, lng: -74.7597 }; // Hamilton, NJ
        const initial =
          center ??
          (markers.length > 0
            ? { lat: markers[0].lat, lng: markers[0].lng }
            : fallback);

        const map = new g.maps.Map(ref.current, {
          center: initial,
          zoom,
          mapTypeControl: false,
          streetViewControl: true,
          fullscreenControl: false,
        });

        const bounds = new g.maps.LatLngBounds();
        let hasBounds = false;

        for (const layer of polygons) {
          const data = new g.maps.Data({ map });
          try {
            data.addGeoJson(layer.geojson as object);
          } catch {
            continue;
          }
          data.setStyle({
            fillColor: layer.fillColor,
            fillOpacity: layer.fillOpacity ?? 0.25,
            strokeColor: layer.strokeColor,
            strokeWeight: 2,
            clickable: false,
          });
          data.forEach((feature) => {
            feature.getGeometry()?.forEachLatLng((latLng) => {
              bounds.extend(latLng);
              hasBounds = true;
            });
          });
          dataLayers.push(data);
        }

        for (const m of markers) {
          const marker = new g.maps.Marker({
            position: { lat: m.lat, lng: m.lng },
            map,
            title: m.title,
            label: m.label,
          });
          if (m.onClick) marker.addListener("click", m.onClick);
          bounds.extend({ lat: m.lat, lng: m.lng });
          hasBounds = true;
        }

        if (hasBounds && (markers.length > 1 || polygons.length > 0)) {
          map.fitBounds(bounds);
        }
      })
      .catch((e) => {
        if (!cancelled) setError(String(e instanceof Error ? e.message : e));
      });

    return () => {
      cancelled = true;
      for (const d of dataLayers) d.setMap(null);
    };
  }, [apiKey, markers, polygons, center, zoom]);

  if (error) {
    return <div className="placeholder">Map unavailable: {error}</div>;
  }

  return <div ref={ref} className={className} />;
}
