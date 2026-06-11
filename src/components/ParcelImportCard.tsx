import { useEffect, useRef, useState } from "react";

import {
  clearParcels,
  importParcels,
  parcelImportIsNative,
  parcelsCount,
  pickParcelFile,
  uploadParcels,
} from "../services/parcels";

/**
 * NJGIN / MOD-IV parcel dataset importer (Phase 8). Picks a local GeoJSON file
 * (read by the Rust backend, which handles large county files) and stores parcel
 * polygons + assessment attributes for point-in-polygon lookup on each property.
 */
export default function ParcelImportCard() {
  const [count, setCount] = useState<number | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const native = parcelImportIsNative();
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    parcelsCount().then(setCount).catch(() => setCount(null));
  }, []);

  function reportResult(result: { imported: number; skipped: number; total: number }) {
    setCount(result.total);
    setStatus(
      `Imported ${result.imported.toLocaleString()} parcel${
        result.imported === 1 ? "" : "s"
      }` +
        (result.skipped
          ? `, skipped ${result.skipped.toLocaleString()} (no geometry)`
          : "") +
        `. Total installed: ${result.total.toLocaleString()}.`,
    );
  }

  // Desktop: native file picker → Rust reads the path directly.
  async function onImportNative() {
    setError(null);
    setStatus(null);
    let path: string | null;
    try {
      path = await pickParcelFile();
    } catch (e) {
      setError(String(e));
      return;
    }
    if (!path) return;
    setBusy(true);
    try {
      reportResult(await importParcels(path));
    } catch (err) {
      setError(String(err instanceof Error ? err.message : err));
    } finally {
      setBusy(false);
    }
  }

  // Web: upload the chosen File to the server.
  async function onFileChosen(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setError(null);
    setStatus(null);
    setBusy(true);
    try {
      reportResult(await uploadParcels(file, file.name));
    } catch (err) {
      setError(String(err instanceof Error ? err.message : err));
    } finally {
      setBusy(false);
    }
  }

  async function onClear() {
    if (!window.confirm("Delete the installed parcel dataset?")) return;
    setBusy(true);
    setError(null);
    setStatus(null);
    try {
      const deleted = await clearParcels();
      setCount(0);
      setStatus(`Cleared ${deleted.toLocaleString()} parcels.`);
    } catch (err) {
      setError(String(err instanceof Error ? err.message : err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card">
      <h2 className="card-title">NJ parcel / MOD-IV data</h2>
      <p className="muted">
        Install a county parcels GeoJSON (with MOD-IV assessment attributes) to
        enable automatic block/lot and tax-assessment lookup per property. Download
        from{" "}
        <a
          href="https://njogis-newjersey.opendata.arcgis.com/search?q=parcels"
          target="_blank"
          rel="noreferrer"
        >
          NJGIN Open Data
        </a>{" "}
        and export as GeoJSON in WGS84 (lon/lat). Start with a single county (e.g.
        Mercer) — statewide is multi-GB and not recommended here.
      </p>

      <p className="muted">
        Currently installed:{" "}
        <strong>
          {count === null ? "—" : count.toLocaleString()} parcel
          {count === 1 ? "" : "s"}
        </strong>
        .
      </p>

      <div className="form-actions form-actions--left">
        <button
          type="button"
          className="btn btn--sm btn--primary"
          onClick={native ? onImportNative : () => fileInputRef.current?.click()}
          disabled={busy}
        >
          {busy ? "Importing…" : "Choose GeoJSON file…"}
        </button>
        {!native && (
          <input
            ref={fileInputRef}
            type="file"
            accept=".geojson,.json,application/geo+json,application/json"
            style={{ display: "none" }}
            onChange={onFileChosen}
          />
        )}
        {count != null && count > 0 && (
          <button
            type="button"
            className="btn btn--sm btn--ghost"
            onClick={onClear}
            disabled={busy}
          >
            Clear dataset
          </button>
        )}
      </div>

      {busy && <p className="muted">Reading and indexing parcels — this can take a moment for large files…</p>}
      {status && <p className="status status--ok">{status}</p>}
      {error && <p className="status status--err">{error}</p>}
    </section>
  );
}
