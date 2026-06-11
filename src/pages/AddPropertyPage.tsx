import { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";

import { createProperty, updateProperty } from "../services/properties";
import {
  ListingMetadata,
  decodeImportParam,
  fetchListingMetadata,
} from "../services/listing";

/** Fields parsed from a listing that aren't part of the create call and are
 * applied via update_property after the property is created. */
type Extras = Pick<
  ListingMetadata,
  "beds" | "baths" | "sqft" | "yearBuilt" | "propertyType"
>;

const EMPTY_EXTRAS: Extras = {
  beds: null,
  baths: null,
  sqft: null,
  yearBuilt: null,
  propertyType: null,
};

function hasExtras(e: Extras): boolean {
  return (
    e.beds != null ||
    e.baths != null ||
    e.sqft != null ||
    e.yearBuilt != null ||
    (e.propertyType != null && e.propertyType !== "")
  );
}

export default function AddPropertyPage() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();

  const [address, setAddress] = useState("");
  const [listingUrl, setListingUrl] = useState("");
  const [listPrice, setListPrice] = useState("");
  const [extras, setExtras] = useState<Extras>(EMPTY_EXTRAS);

  const [saving, setSaving] = useState(false);
  const [fetching, setFetching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);
  const [autofillNote, setAutofillNote] = useState<string | null>(null);

  // Apply parsed listing metadata to the form (shared by manual autofill and the
  // bookmarklet `import` param). Only fills fields the user hasn't typed.
  function applyMetadata(meta: Partial<ListingMetadata>, sourceLabel: string) {
    if (meta.address) setAddress((cur) => cur || meta.address || "");
    if (meta.listPrice != null)
      setListPrice((cur) => cur || String(meta.listPrice));
    setExtras((cur) => ({
      beds: cur.beds ?? meta.beds ?? null,
      baths: cur.baths ?? meta.baths ?? null,
      sqft: cur.sqft ?? meta.sqft ?? null,
      yearBuilt: cur.yearBuilt ?? meta.yearBuilt ?? null,
      propertyType: cur.propertyType ?? meta.propertyType ?? null,
    }));
    if (meta.resolvedUrl) setListingUrl((cur) => cur || meta.resolvedUrl || "");

    const filled: string[] = [];
    if (meta.address) filled.push("address");
    if (meta.listPrice != null) filled.push("price");
    if (meta.beds != null) filled.push("beds");
    if (meta.baths != null) filled.push("baths");
    if (meta.sqft != null) filled.push("sq ft");
    if (meta.yearBuilt != null) filled.push("year built");

    const warns = (meta.warnings ?? []).join(" ");
    if (filled.length === 0) {
      setAutofillNote(
        warns ||
          `Couldn't read listing details from ${sourceLabel}. Enter them manually.`,
      );
    } else {
      setAutofillNote(
        `Filled ${filled.join(", ")} from ${sourceLabel}. Review, then save.` +
          (warns ? ` ${warns}` : ""),
      );
    }
  }

  // Bookmarklet entry point: /#/add?import=<base64url JSON>
  useEffect(() => {
    const raw = searchParams.get("import");
    if (!raw) return;
    const meta = decodeImportParam(raw);
    if (meta) {
      applyMetadata(meta, meta.source || "the saved page");
    } else {
      setAutofillNote("The imported listing data couldn't be read.");
    }
    // Clear the param so a refresh/edit doesn't re-apply it.
    searchParams.delete("import");
    setSearchParams(searchParams, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function onAutofill() {
    const url = listingUrl.trim();
    if (!url) {
      setError("Paste a listing URL first.");
      return;
    }
    setFetching(true);
    setError(null);
    setAutofillNote(null);
    try {
      const meta = await fetchListingMetadata(url);
      applyMetadata(meta, meta.source || "the listing");
    } catch (e) {
      setAutofillNote(String(e));
    } finally {
      setFetching(false);
    }
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = address.trim();
    if (!trimmed) {
      setError("Address is required.");
      return;
    }

    setSaving(true);
    setError(null);
    setWarning(null);

    let parsedPrice: number | null = null;
    const priceText = listPrice.trim();
    if (priceText) {
      const n = Number(priceText.replace(/[,$\s]/g, ""));
      if (Number.isFinite(n)) parsedPrice = Math.round(n);
    }

    try {
      const result = await createProperty({
        addressInput: trimmed,
        listingUrl: listingUrl.trim() || null,
        listPrice: parsedPrice,
      });

      // Persist any extra listing details captured by autofill.
      if (hasExtras(extras)) {
        try {
          await updateProperty(result.property.id, {
            beds: extras.beds,
            baths: extras.baths,
            sqft: extras.sqft,
            yearBuilt: extras.yearBuilt,
            propertyType: extras.propertyType,
          });
        } catch {
          // Non-fatal: the property is saved; details can be edited later.
        }
      }

      if (result.geocodeError) {
        setWarning(result.geocodeError);
        setSaving(false);
        return;
      }

      navigate(`/property/${result.property.id}`);
    } catch (e) {
      setError(String(e));
      setSaving(false);
    }
  }

  return (
    <div className="page">
      <h1 className="page-title">Add Property</h1>
      <p className="muted">
        Enter an address; it's geocoded on save using your private Google
        web-service key. Or paste a listing link and let HomeLens fill in the
        details for you to review.
      </p>

      <form className="form" onSubmit={onSubmit}>
        <section className="card">
          <label className="field">
            <span className="field-label">Listing URL (optional)</span>
            <div className="autofill-row">
              <input
                type="url"
                value={listingUrl}
                onChange={(e) => setListingUrl(e.target.value)}
                placeholder="https://agent.example.com/listing/…"
              />
              <button
                type="button"
                className="btn btn--ghost"
                onClick={onAutofill}
                disabled={fetching || !listingUrl.trim()}
              >
                {fetching ? "Reading…" : "Autofill from link"}
              </button>
            </div>
            <span className="field-hint">
              Works for most brokerage/agent sites. Big portals (Zillow,
              Realtor.com) block this — use the bookmarklet in Settings.
            </span>
          </label>

          {autofillNote && <p className="muted autofill-note">{autofillNote}</p>}

          <label className="field">
            <span className="field-label">Address</span>
            <input
              type="text"
              value={address}
              onChange={(e) => {
                setAddress(e.target.value);
                setError(null);
                setWarning(null);
              }}
              placeholder="123 Main St, Hamilton, NJ 08610"
              autoFocus
            />
            <span className="field-hint">
              Full street address gives the most reliable geocoding.
            </span>
          </label>

          <label className="field">
            <span className="field-label">List price (optional)</span>
            <input
              type="text"
              inputMode="numeric"
              value={listPrice}
              onChange={(e) => setListPrice(e.target.value)}
              placeholder="450000"
            />
          </label>

          {hasExtras(extras) && (
            <div className="autofill-extras">
              <span className="field-label">From the listing</span>
              <ul className="autofill-extras-list">
                {extras.beds != null && <li>{extras.beds} beds</li>}
                {extras.baths != null && <li>{extras.baths} baths</li>}
                {extras.sqft != null && (
                  <li>{extras.sqft.toLocaleString()} sq ft</li>
                )}
                {extras.yearBuilt != null && <li>built {extras.yearBuilt}</li>}
                {extras.propertyType && <li>{extras.propertyType}</li>}
              </ul>
              <span className="field-hint">
                These are saved with the property after you click Save.
              </span>
            </div>
          )}
        </section>

        <div className="form-actions">
          <button type="submit" className="btn btn--primary" disabled={saving}>
            {saving ? "Saving…" : "Save property"}
          </button>
          {warning && (
            <span className="status status--err">
              Saved without coordinates.
            </span>
          )}
          {error && <span className="status status--err">{error}</span>}
        </div>

        {warning && (
          <p className="muted">
            The property was saved, but geocoding failed: {warning} You can fix
            the address or add a Google web-service key in Settings, then
            re-geocode later. <a href="#/dashboard">Go to dashboard →</a>
          </p>
        )}
      </form>
    </div>
  );
}
