import { getSetting, SETTING_KEYS } from "./settings";

/**
 * Resolve the browser-visible Google Maps JS key. Prefers the value saved on the
 * Settings page (stored locally in SQLite — no rebuild needed to change it) and
 * falls back to the `VITE_GOOGLE_MAPS_JS_KEY` env baked at build time (brief §13).
 *
 * This is the ONLY Google key allowed in the frontend (Decision 1, brief §2.1).
 * It must be restricted in Google Cloud to Maps JavaScript + Street View APIs.
 */
export async function getMapsJsKey(): Promise<string> {
  const fromSettings = await getSetting(SETTING_KEYS.mapsJsKey);
  if (fromSettings && fromSettings.trim()) return fromSettings.trim();
  const fromEnv = import.meta.env.VITE_GOOGLE_MAPS_JS_KEY as string | undefined;
  return fromEnv?.trim() ?? "";
}

const CALLBACK = "__homelensInitGoogleMaps";

let loaderPromise: Promise<typeof google> | null = null;

/** Ensure the core `maps` (+`marker`) libraries are imported, then resolve. */
async function ensureLibraries(): Promise<typeof google> {
  const maps = window.google?.maps as unknown as {
    Map?: unknown;
    importLibrary?: (name: string) => Promise<unknown>;
  };
  if (maps?.importLibrary) {
    // With loading=async the bootstrap exposes only importLibrary; the
    // constructors (google.maps.Map, Marker, …) must be imported first.
    await Promise.all([
      maps.importLibrary("maps"),
      maps.importLibrary("marker"),
    ]);
  }
  return window.google;
}

/**
 * Load the Google Maps JS API exactly once and resolve with the `google`
 * namespace (with the core libraries imported). The promise is cached for
 * subsequent callers; on failure the cache is cleared so a later call (e.g.
 * after the user fixes their key) can retry.
 */
export function loadGoogleMaps(apiKey: string): Promise<typeof google> {
  if (loaderPromise) return loaderPromise;

  // Already fully loaded (Map constructor present): resolve immediately.
  if (typeof window !== "undefined" && window.google?.maps?.Map) {
    return Promise.resolve(window.google);
  }

  loaderPromise = new Promise<typeof google>((resolve, reject) => {
    if (!apiKey) {
      reject(new Error("No Google Maps JS key set (add one in Settings)."));
      return;
    }

    // The bootstrap script is already present/loading (e.g. a prior mount):
    // don't inject a second one — just import the libraries and resolve.
    const maps = window.google?.maps as unknown as {
      importLibrary?: (name: string) => Promise<unknown>;
    };
    if (maps?.importLibrary) {
      ensureLibraries().then(resolve).catch(reject);
      return;
    }

    (window as unknown as Record<string, () => void>)[CALLBACK] = () => {
      ensureLibraries().then(resolve).catch(reject);
    };

    const script = document.createElement("script");
    const params = new URLSearchParams({
      key: apiKey,
      libraries: "marker",
      loading: "async",
      callback: CALLBACK,
    });
    script.src = `https://maps.googleapis.com/maps/api/js?${params.toString()}`;
    script.async = true;
    script.onerror = () => {
      reject(new Error("Failed to load Google Maps JS (check the key/network)."));
    };
    document.head.appendChild(script);
  }).catch((e) => {
    // Allow retries after a transient/configuration failure.
    loaderPromise = null;
    throw e;
  });

  return loaderPromise;
}

/** External Google Maps link centered on the coordinates. */
export function googleMapsLink(lat: number, lng: number): string {
  return `https://www.google.com/maps/search/?api=1&query=${lat},${lng}`;
}

/** External Google Street View link (panorama) at the coordinates. */
export function streetViewLink(lat: number, lng: number): string {
  return `https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=${lat},${lng}`;
}
