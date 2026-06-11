import { useEffect, useState } from "react";

import {
  deleteParcel,
  getParcel,
  lookupParcel,
  parcelsCount,
  setParcel,
  type ParcelInput,
  type ParcelResult,
} from "../services/parcels";

interface Props {
  propertyId: string;
  geocoded: boolean;
}

function toInt(v: string): number | null {
  const s = v.trim();
  if (!s) return null;
  const n = Number(s.replace(/[^0-9.-]/g, ""));
  return Number.isFinite(n) ? Math.round(n) : null;
}

function str(v: string): string | null {
  const s = v.trim();
  return s ? s : null;
}

const fmtMoney = (v: number | null) =>
  v == null ? "—" : `$${v.toLocaleString()}`;

/**
 * Parcel / MOD-IV tax-assessment card (Phase 8). When a local parcel dataset is
 * installed, "Look up parcel" matches the property's point to a containing
 * polygon and stores the assessment fields. Fields are always manually editable
 * (brief: user can override parcel fields).
 */
export default function ParcelCard({ propertyId, geocoded }: Props) {
  const [parcel, setParcelState] = useState<ParcelResult | null>(null);
  const [datasetCount, setDatasetCount] = useState<number>(0);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [savedAt, setSavedAt] = useState<number | null>(null);

  // Manual edit form fields.
  const [form, setForm] = useState<ParcelInput>({});

  useEffect(() => {
    (async () => {
      try {
        const [p, count] = await Promise.all([
          getParcel(propertyId),
          parcelsCount(),
        ]);
        setParcelState(p);
        setDatasetCount(count);
      } catch (e) {
        setError(String(e));
      } finally {
        setLoading(false);
      }
    })();
  }, [propertyId]);

  async function onLookup() {
    setBusy(true);
    setError(null);
    try {
      setParcelState(await lookupParcel(propertyId));
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }

  function startEdit() {
    setForm({
      municipality: parcel?.municipality ?? "",
      county: parcel?.county ?? "",
      block: parcel?.block ?? "",
      lot: parcel?.lot ?? "",
      qualifier: parcel?.qualifier ?? "",
      propertyClass: parcel?.propertyClass ?? "",
      landAssessment: parcel?.landAssessment ?? null,
      improvementAssessment: parcel?.improvementAssessment ?? null,
      totalAssessment: parcel?.totalAssessment ?? null,
      annualTaxes: parcel?.annualTaxes ?? null,
      ownerName: parcel?.ownerName ?? "",
    });
    setSavedAt(null);
    setEditing(true);
  }

  async function onSaveManual(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const saved = await setParcel(propertyId, form);
      setParcelState(saved);
      setEditing(false);
      setSavedAt(Date.now());
    } catch (err) {
      setError(String(err));
    } finally {
      setBusy(false);
    }
  }

  async function onClear() {
    if (!window.confirm("Remove the parcel record for this property?")) return;
    setBusy(true);
    setError(null);
    try {
      await deleteParcel(propertyId);
      setParcelState(null);
      setEditing(false);
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }

  const field = (k: keyof ParcelInput) => (form[k] == null ? "" : String(form[k]));

  return (
    <section className="card">
      <div className="card-head">
        <h2 className="card-title">Parcel &amp; taxes</h2>
        <div className="card-head-actions">
          {geocoded && datasetCount > 0 && (
            <button
              type="button"
              className="btn btn--sm"
              onClick={onLookup}
              disabled={busy}
            >
              {busy ? "…" : parcel ? "Re-look up" : "Look up parcel"}
            </button>
          )}
          {!editing && (
            <button
              type="button"
              className="btn btn--sm btn--ghost"
              onClick={startEdit}
              disabled={busy}
            >
              {parcel ? "Edit" : "Add manually"}
            </button>
          )}
        </div>
      </div>

      {datasetCount === 0 && (
        <p className="muted">
          No parcel dataset installed — import NJGIN / MOD-IV parcels in{" "}
          Settings to enable automatic lookup, or enter fields manually.
        </p>
      )}

      {loading && <p className="muted">Loading…</p>}

      {!loading && !editing && parcel && (
        <>
          <div className="parcel-grid">
            <div>
              <span className="detail-label">Municipality</span>
              <span className="detail-value">{parcel.municipality ?? "—"}</span>
            </div>
            <div>
              <span className="detail-label">County</span>
              <span className="detail-value">{parcel.county ?? "—"}</span>
            </div>
            <div>
              <span className="detail-label">Block / Lot</span>
              <span className="detail-value">
                {parcel.block ?? "—"} / {parcel.lot ?? "—"}
                {parcel.qualifier ? ` (${parcel.qualifier})` : ""}
              </span>
            </div>
            <div>
              <span className="detail-label">Property class</span>
              <span className="detail-value">{parcel.propertyClass ?? "—"}</span>
            </div>
            <div>
              <span className="detail-label">Land assessment</span>
              <span className="detail-value">{fmtMoney(parcel.landAssessment)}</span>
            </div>
            <div>
              <span className="detail-label">Improvement</span>
              <span className="detail-value">
                {fmtMoney(parcel.improvementAssessment)}
              </span>
            </div>
            <div>
              <span className="detail-label">Total assessment</span>
              <span className="detail-value">{fmtMoney(parcel.totalAssessment)}</span>
            </div>
            <div>
              <span className="detail-label">Annual taxes</span>
              <span className="detail-value">{fmtMoney(parcel.annualTaxes)}</span>
            </div>
            <div>
              <span className="detail-label">Owner</span>
              <span className="detail-value">{parcel.ownerName ?? "—"}</span>
            </div>
          </div>
          <p className="muted">
            Source: {parcel.source === "manual" ? "manually entered" : parcel.source}.
            {savedAt && " Saved ✓"}
          </p>
          <div className="form-actions form-actions--left">
            <button
              type="button"
              className="btn btn--sm btn--ghost"
              onClick={onClear}
              disabled={busy}
            >
              Remove
            </button>
          </div>
        </>
      )}

      {!loading && !editing && !parcel && datasetCount > 0 && (
        <p className="muted">
          No parcel matched yet. Click “Look up parcel” to match by location.
        </p>
      )}

      {editing && (
        <form className="listing-form" onSubmit={onSaveManual}>
          <div className="form-grid">
            <label className="field">
              <span>Municipality</span>
              <input
                type="text"
                value={field("municipality")}
                onChange={(e) => setForm({ ...form, municipality: e.target.value })}
              />
            </label>
            <label className="field">
              <span>County</span>
              <input
                type="text"
                value={field("county")}
                onChange={(e) => setForm({ ...form, county: e.target.value })}
              />
            </label>
            <label className="field">
              <span>Block</span>
              <input
                type="text"
                value={field("block")}
                onChange={(e) => setForm({ ...form, block: e.target.value })}
              />
            </label>
            <label className="field">
              <span>Lot</span>
              <input
                type="text"
                value={field("lot")}
                onChange={(e) => setForm({ ...form, lot: e.target.value })}
              />
            </label>
            <label className="field">
              <span>Qualifier</span>
              <input
                type="text"
                value={field("qualifier")}
                onChange={(e) => setForm({ ...form, qualifier: e.target.value })}
              />
            </label>
            <label className="field">
              <span>Property class</span>
              <input
                type="text"
                value={field("propertyClass")}
                onChange={(e) =>
                  setForm({ ...form, propertyClass: e.target.value })
                }
              />
            </label>
            <label className="field">
              <span>Land assessment ($)</span>
              <input
                type="number"
                value={field("landAssessment")}
                onChange={(e) =>
                  setForm({ ...form, landAssessment: toInt(e.target.value) })
                }
              />
            </label>
            <label className="field">
              <span>Improvement ($)</span>
              <input
                type="number"
                value={field("improvementAssessment")}
                onChange={(e) =>
                  setForm({
                    ...form,
                    improvementAssessment: toInt(e.target.value),
                  })
                }
              />
            </label>
            <label className="field">
              <span>Total assessment ($)</span>
              <input
                type="number"
                value={field("totalAssessment")}
                onChange={(e) =>
                  setForm({ ...form, totalAssessment: toInt(e.target.value) })
                }
              />
            </label>
            <label className="field">
              <span>Annual taxes ($)</span>
              <input
                type="number"
                value={field("annualTaxes")}
                onChange={(e) =>
                  setForm({ ...form, annualTaxes: toInt(e.target.value) })
                }
              />
            </label>
            <label className="field field--wide">
              <span>Owner name</span>
              <input
                type="text"
                value={field("ownerName")}
                onChange={(e) =>
                  setForm({ ...form, ownerName: str(e.target.value) })
                }
              />
            </label>
          </div>
          <div className="form-actions form-actions--left">
            <button type="submit" className="btn btn--primary btn--sm" disabled={busy}>
              {busy ? "Saving…" : "Save parcel"}
            </button>
            <button
              type="button"
              className="btn btn--sm btn--ghost"
              onClick={() => setEditing(false)}
              disabled={busy}
            >
              Cancel
            </button>
          </div>
        </form>
      )}

      {error && <p className="status status--err">{error}</p>}
    </section>
  );
}
