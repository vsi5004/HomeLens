import { useEffect, useRef, useState } from "react";

import { importNjdoeSchools, njdoeCount, clearNjdoeSchools } from "../services/schools";
import { mapNjdoeRows, parseCsv } from "../services/njdoe";

/**
 * NJDOE school performance CSV importer. Parsing/column-mapping happens here in
 * the browser (fuzzy header detection); the backend just stores the rows. The
 * matched metrics later surface on each property's Schools card.
 */
export default function NjdoeImportCard() {
  const [count, setCount] = useState<number | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState<string[] | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    njdoeCount().then(setCount).catch(() => setCount(null));
  }, []);

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setBusy(true);
    setError(null);
    setStatus(null);
    setPreview(null);
    try {
      const text = await file.text();
      const rows = parseCsv(text);
      const mapped = mapNjdoeRows(rows);
      if (!mapped.detected.schoolName) {
        throw new Error(
          "Could not find a 'School Name' column in this CSV. Check the file headers.",
        );
      }
      if (mapped.records.length === 0) {
        throw new Error("No data rows with a school name were found.");
      }
      const result = await importNjdoeSchools(mapped.records, file.name);
      setCount(result.total);
      const metricLabels = Object.keys(mapped.detectedMetrics);
      setPreview([
        `Detected fields: ${Object.values(mapped.detected).join(", ")}`,
        metricLabels.length
          ? `Metrics: ${metricLabels.join(", ")}`
          : "Metrics: none detected (only identity columns imported)",
      ]);
      setStatus(
        `Imported ${result.imported} school${result.imported === 1 ? "" : "s"}` +
          (result.skipped ? `, skipped ${result.skipped}` : "") +
          ". Total stored: " +
          result.total +
          ".",
      );
    } catch (err) {
      setError(String(err instanceof Error ? err.message : err));
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  async function onClear() {
    if (
      !window.confirm(
        "Delete all imported NJDOE rows? You can re-import at any time.",
      )
    )
      return;
    setBusy(true);
    setError(null);
    setStatus(null);
    setPreview(null);
    try {
      const deleted = await clearNjdoeSchools();
      setCount(0);
      setStatus(`Cleared ${deleted} imported school${deleted === 1 ? "" : "s"}.`);
    } catch (err) {
      setError(String(err instanceof Error ? err.message : err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card">
      <h2 className="card-title">NJDOE school data</h2>
      <p className="muted">
        Import a school performance CSV downloaded from the{" "}
        <a
          href="https://www.nj.gov/education/spr/download/"
          target="_blank"
          rel="noreferrer"
        >
          NJ School Performance Reports
        </a>
        . Headers are matched automatically (School Name, District, County, grade
        span, enrollment, plus ELA/Math proficiency, chronic absenteeism,
        graduation rate, student/teacher ratio when present). Re-importing updates
        rows in place by CDS code.
      </p>

      <p className="muted">
        Currently stored:{" "}
        <strong>{count === null ? "—" : count} school{count === 1 ? "" : "s"}</strong>.
      </p>

      <label className="field">
        <span className="field-label">Import CSV</span>
        <input
          ref={fileRef}
          type="file"
          accept=".csv,text/csv"
          onChange={onFile}
          disabled={busy}
        />
      </label>

      {count != null && count > 0 && (
        <div className="form-actions form-actions--left">
          <button
            type="button"
            className="btn btn--sm btn--ghost"
            onClick={onClear}
            disabled={busy}
          >
            Clear all imported rows
          </button>
        </div>
      )}

      {busy && <p className="muted">Importing…</p>}
      {preview?.map((line) => (
        <p key={line} className="muted">
          {line}
        </p>
      ))}
      {status && <p className="status status--ok">{status}</p>}
      {error && <p className="status status--err">{error}</p>}
    </section>
  );
}
