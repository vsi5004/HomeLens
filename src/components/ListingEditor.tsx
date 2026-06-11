import { useState } from "react";

import {
  updateProperty,
  type Property,
  type PropertyUpdate,
} from "../services/properties";

const STATUSES = [
  "new",
  "interested",
  "visited",
  "offer",
  "rejected",
  "archived",
];

/** Parse a form string to an integer, or null when blank/invalid. */
function toInt(v: string): number | null {
  const s = v.trim();
  if (!s) return null;
  const n = Number(s.replace(/[^0-9.-]/g, ""));
  return Number.isFinite(n) ? Math.round(n) : null;
}

function toFloat(v: string): number | null {
  const s = v.trim();
  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

function str(v: string): string | null {
  const s = v.trim();
  return s ? s : null;
}

interface Props {
  property: Property;
  onSaved: (p: Property) => void;
}

/** Editable listing details + notes form for a property (Phase 5). */
export default function ListingEditor({ property, onSaved }: Props) {
  const num = (v: number | null) => (v == null ? "" : String(v));
  const [status, setStatus] = useState(property.status ?? "new");
  const [listingUrl, setListingUrl] = useState(property.listingUrl ?? "");
  const [listingSource, setListingSource] = useState(
    property.listingSource ?? "",
  );
  const [listPrice, setListPrice] = useState(num(property.listPrice));
  const [estValue, setEstValue] = useState(num(property.manualEstimatedValue));
  const [taxes, setTaxes] = useState(num(property.annualTaxes));
  const [hoa, setHoa] = useState(num(property.hoaMonthly));
  const [beds, setBeds] = useState(num(property.beds));
  const [baths, setBaths] = useState(num(property.baths));
  const [sqft, setSqft] = useState(num(property.sqft));
  const [lotSize, setLotSize] = useState(property.lotSize ?? "");
  const [yearBuilt, setYearBuilt] = useState(num(property.yearBuilt));
  const [propertyType, setPropertyType] = useState(property.propertyType ?? "");
  const [photoUrl, setPhotoUrl] = useState(property.photoUrl ?? "");
  const [schoolScore, setSchoolScore] = useState(num(property.manualSchoolScore));
  const [valueScore, setValueScore] = useState(
    num(property.manualPropertyValueScore),
  );
  const [subjScore, setSubjScore] = useState(num(property.subjectiveScore));
  const [notes, setNotes] = useState(property.notes ?? "");

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<number | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    const update: PropertyUpdate = {
      status,
      listingUrl: str(listingUrl),
      listingSource: str(listingSource),
      listPrice: toInt(listPrice),
      manualEstimatedValue: toInt(estValue),
      annualTaxes: toInt(taxes),
      hoaMonthly: toInt(hoa),
      beds: toFloat(beds),
      baths: toFloat(baths),
      sqft: toInt(sqft),
      lotSize: str(lotSize),
      yearBuilt: toInt(yearBuilt),
      propertyType: str(propertyType),
      subjectiveScore: toInt(subjScore),
      manualSchoolScore: toInt(schoolScore),
      manualPropertyValueScore: toInt(valueScore),
      notes: str(notes),
      photoUrl: str(photoUrl),
    };
    try {
      const saved = await updateProperty(property.id, update);
      onSaved(saved);
      setSavedAt(Date.now());
    } catch (err) {
      setError(String(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <form className="listing-form" onSubmit={onSubmit}>
      <div className="form-grid">
        <label className="field">
          <span>Status</span>
          <select value={status} onChange={(e) => setStatus(e.target.value)}>
            {STATUSES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>Property type</span>
          <input
            type="text"
            value={propertyType}
            placeholder="Single family, Condo…"
            onChange={(e) => setPropertyType(e.target.value)}
          />
        </label>
        <label className="field">
          <span>List price ($)</span>
          <input
            type="number"
            value={listPrice}
            onChange={(e) => setListPrice(e.target.value)}
          />
        </label>
        <label className="field">
          <span>Est. value ($)</span>
          <input
            type="number"
            value={estValue}
            onChange={(e) => setEstValue(e.target.value)}
          />
        </label>
        <label className="field">
          <span>Annual taxes ($)</span>
          <input
            type="number"
            value={taxes}
            onChange={(e) => setTaxes(e.target.value)}
          />
        </label>
        <label className="field">
          <span>HOA / month ($)</span>
          <input
            type="number"
            value={hoa}
            onChange={(e) => setHoa(e.target.value)}
          />
        </label>
        <label className="field">
          <span>Beds</span>
          <input
            type="number"
            step="0.5"
            value={beds}
            onChange={(e) => setBeds(e.target.value)}
          />
        </label>
        <label className="field">
          <span>Baths</span>
          <input
            type="number"
            step="0.5"
            value={baths}
            onChange={(e) => setBaths(e.target.value)}
          />
        </label>
        <label className="field">
          <span>Sqft</span>
          <input
            type="number"
            value={sqft}
            onChange={(e) => setSqft(e.target.value)}
          />
        </label>
        <label className="field">
          <span>Lot size</span>
          <input
            type="text"
            value={lotSize}
            placeholder="0.25 ac, 7500 sqft…"
            onChange={(e) => setLotSize(e.target.value)}
          />
        </label>
        <label className="field">
          <span>Year built</span>
          <input
            type="number"
            value={yearBuilt}
            onChange={(e) => setYearBuilt(e.target.value)}
          />
        </label>
        <label className="field">
          <span>Listing source</span>
          <input
            type="text"
            value={listingSource}
            placeholder="Zillow, MLS, agent…"
            onChange={(e) => setListingSource(e.target.value)}
          />
        </label>
        <label className="field field--wide">
          <span>Listing URL</span>
          <input
            type="url"
            value={listingUrl}
            placeholder="https://…"
            onChange={(e) => setListingUrl(e.target.value)}
          />
        </label>
        <label className="field field--wide">
          <span>Photo URL</span>
          <input
            type="url"
            value={photoUrl}
            placeholder="https://… (listing preview image)"
            onChange={(e) => setPhotoUrl(e.target.value)}
          />
        </label>
        {photoUrl.trim() && (
          <div className="field field--wide listing-photo-preview">
            <img
              src={photoUrl.trim()}
              alt="Listing preview"
              onError={(e) => {
                (e.currentTarget as HTMLImageElement).style.display = "none";
              }}
            />
          </div>
        )}
      </div>

      <p className="muted manual-scores-note">
        Manual 0–100 ratings (used by the comparison score). These are your own
        judgments — computed school/value sub-scores arrive in later phases.
      </p>
      <div className="form-grid">
        <label className="field">
          <span>School score (0–100)</span>
          <input
            type="number"
            min={0}
            max={100}
            value={schoolScore}
            onChange={(e) => setSchoolScore(e.target.value)}
          />
        </label>
        <label className="field">
          <span>Property value score (0–100)</span>
          <input
            type="number"
            min={0}
            max={100}
            value={valueScore}
            onChange={(e) => setValueScore(e.target.value)}
          />
        </label>
        <label className="field">
          <span>Subjective score (0–100)</span>
          <input
            type="number"
            min={0}
            max={100}
            value={subjScore}
            onChange={(e) => setSubjScore(e.target.value)}
          />
        </label>
      </div>

      <label className="field field--wide">
        <span>Notes</span>
        <textarea
          rows={4}
          value={notes}
          placeholder="Impressions, to-dos, questions for the agent…"
          onChange={(e) => setNotes(e.target.value)}
        />
      </label>

      {error && <p className="status status--err">{error}</p>}

      <div className="form-actions form-actions--left">
        <button type="submit" className="btn btn--primary" disabled={saving}>
          {saving ? "Saving…" : "Save listing details"}
        </button>
        {savedAt && !saving && <span className="muted">Saved ✓</span>}
      </div>
    </form>
  );
}
