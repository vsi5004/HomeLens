import { useEffect, useRef, useState } from "react";

import { loadGoogleMaps, streetViewLink } from "../services/googleMaps";

interface Props {
  apiKey: string;
  lat: number;
  lng: number;
}

type Availability = "checking" | "available" | "unavailable" | "error";

/**
 * Street-level preview. Uses StreetViewService to check for nearby imagery; if
 * found, embeds an interactive panorama, otherwise falls back to an external
 * Street View link (brief Phase 2 acceptance: preview OR link).
 */
export default function StreetViewCard({ apiKey, lat, lng }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const [state, setState] = useState<Availability>("checking");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    loadGoogleMaps(apiKey)
      .then((g) => {
        if (cancelled) return;
        const service = new g.maps.StreetViewService();
        service.getPanorama(
          { location: { lat, lng }, radius: 80 },
          (_data, status) => {
            if (cancelled) return;
            // The canvas div is always mounted, so ref.current is available here.
            if (status === g.maps.StreetViewStatus.OK && ref.current) {
              new g.maps.StreetViewPanorama(ref.current, {
                position: { lat, lng },
                pov: { heading: 0, pitch: 0 },
                addressControl: false,
                fullscreenControl: false,
                motionTracking: false,
                motionTrackingControl: false,
              });
              setState("available");
            } else {
              setState("unavailable");
            }
          },
        );
      })
      .catch((e) => {
        if (cancelled) return;
        setError(String(e instanceof Error ? e.message : e));
        setState("error");
      });

    return () => {
      cancelled = true;
    };
  }, [apiKey, lat, lng]);

  return (
    <>
      {/* Always mounted so the panorama has a container to attach to. Hidden
          until imagery is confirmed available. */}
      <div
        ref={ref}
        className="sv-canvas"
        style={{ display: state === "available" ? "block" : "none" }}
      />
      {state === "checking" && <p className="muted">Checking Street View…</p>}
      {state === "unavailable" && (
        <p className="muted">
          No Street View imagery near this location.{" "}
          <a href={streetViewLink(lat, lng)} target="_blank" rel="noreferrer">
            Open in Google Maps →
          </a>
        </p>
      )}
      {state === "error" && (
        <div className="placeholder">Street View unavailable: {error}</div>
      )}
    </>
  );
}
