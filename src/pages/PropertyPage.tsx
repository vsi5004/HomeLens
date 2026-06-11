import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";

import MapView from "../components/MapView";
import StreetViewCard from "../components/StreetViewCard";
import FamilyDriveCard from "../components/FamilyDriveCard";
import AmenityCard from "../components/AmenityCard";
import SchoolCard from "../components/SchoolCard";
import ParcelCard from "../components/ParcelCard";
import ListingEditor from "../components/ListingEditor";
import ExternalLinksCard from "../components/ExternalLinksCard";
import { getMapsJsKey, googleMapsLink } from "../services/googleMaps";
import {
  deleteProperty,
  getProperty,
  type Property,
} from "../services/properties";

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="detail-row">
      <span className="detail-label">{label}</span>
      <span className="detail-value">{value ?? "—"}</span>
    </div>
  );
}

export default function PropertyPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [property, setProperty] = useState<Property | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [mapsKey, setMapsKey] = useState<string>("");

  useEffect(() => {
    if (!id) return;
    (async () => {
      try {
        setProperty(await getProperty(id));
      } catch (e) {
        setError(String(e));
      } finally {
        setLoading(false);
      }
    })();
  }, [id]);

  useEffect(() => {
    getMapsJsKey().then(setMapsKey).catch(() => setMapsKey(""));
  }, []);

  async function onDelete() {
    if (!id) return;
    if (!confirm("Delete this property? This cannot be undone.")) return;
    setDeleting(true);
    try {
      await deleteProperty(id);
      navigate("/dashboard");
    } catch (e) {
      setError(String(e));
      setDeleting(false);
    }
  }

  if (loading) {
    return (
      <div className="page">
        <h1 className="page-title">Property</h1>
        <p className="muted">Loading…</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="page">
        <h1 className="page-title">Property</h1>
        <p className="status status--err">{error}</p>
        <p>
          <Link to="/dashboard">← Back to dashboard</Link>
        </p>
      </div>
    );
  }

  if (!property) {
    return (
      <div className="page">
        <h1 className="page-title">Property not found</h1>
        <p>
          <Link to="/dashboard">← Back to dashboard</Link>
        </p>
      </div>
    );
  }

  const p = property;
  const geocoded = p.latitude != null && p.longitude != null;

  return (
    <div className="page">
      <h1 className="page-title">
        {p.addressNormalized ?? p.addressInput}
      </h1>
      <p className="muted">
        Entered as “{p.addressInput}”. Status: {p.status}.
      </p>

      {p.photoUrl &&
        (() => {
          const hero = (
            <img
              className="property-hero"
              src={p.photoUrl}
              alt="Listing"
              onError={(e) => {
                (e.currentTarget as HTMLImageElement).style.display = "none";
              }}
            />
          );
          return p.listingUrl ? (
            <a
              href={p.listingUrl}
              target="_blank"
              rel="noreferrer"
              className="property-hero-link"
              title="Open listing"
            >
              {hero}
            </a>
          ) : (
            hero
          );
        })()}

      <section className="card">
        <h2 className="card-title">Location</h2>
        <Row label="Street" value={p.street} />
        <Row label="City" value={p.city} />
        <Row label="State" value={p.state} />
        <Row label="ZIP" value={p.zip} />
        <Row label="County" value={p.county} />
        <Row
          label="Coordinates"
          value={
            geocoded ? (
              <span className="mono">
                {p.latitude!.toFixed(6)}, {p.longitude!.toFixed(6)}
              </span>
            ) : (
              <span className="status status--err">not geocoded</span>
            )
          }
        />
      </section>

      {geocoded && (
        <section className="card">
          <div className="card-head">
            <h2 className="card-title">Map</h2>
            <a
              href={googleMapsLink(p.latitude!, p.longitude!)}
              target="_blank"
              rel="noreferrer"
              className="card-link"
            >
              Open in Google Maps →
            </a>
          </div>
          {mapsKey ? (
            <MapView
              apiKey={mapsKey}
              markers={[
                {
                  lat: p.latitude!,
                  lng: p.longitude!,
                  title: p.addressNormalized ?? p.addressInput,
                  imageUrl: p.photoUrl,
                },
              ]}
            />
          ) : (
            <p className="muted">
              Add a Google Maps JS key in <Link to="/settings">Settings</Link> to
              show the map.
            </p>
          )}
        </section>
      )}

      {geocoded && mapsKey && (
        <section className="card">
          <h2 className="card-title">Street View</h2>
          <StreetViewCard
            apiKey={mapsKey}
            lat={p.latitude!}
            lng={p.longitude!}
          />
        </section>
      )}

      <section className="card">
        <h2 className="card-title">Listing details</h2>
        <ListingEditor property={p} onSaved={setProperty} />
      </section>

      <FamilyDriveCard propertyId={p.id} geocoded={geocoded} />

      <AmenityCard propertyId={p.id} geocoded={geocoded} />

      <SchoolCard property={p} geocoded={geocoded} />

      <ParcelCard propertyId={p.id} geocoded={geocoded} />

      <ExternalLinksCard property={p} />

      <div className="form-actions">
        <Link to="/dashboard" className="btn">
          ← Back
        </Link>
        <button
          type="button"
          className="btn"
          onClick={onDelete}
          disabled={deleting}
        >
          {deleting ? "Deleting…" : "Delete"}
        </button>
      </div>
    </div>
  );
}
