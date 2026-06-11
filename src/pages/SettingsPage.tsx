import { useEffect, useState } from "react";

import {
  SETTING_KEYS,
  getAllSettings,
  setSettings,
} from "../services/settings";
import NjdoeImportCard from "../components/NjdoeImportCard";
import ParcelImportCard from "../components/ParcelImportCard";
import BookmarkletCard from "../components/BookmarkletCard";

type FormState = {
  googleWebserviceKey: string;
  mapsJsKey: string;
  orsApiKey: string;
  travelTimeAppId: string;
  travelTimeApiKey: string;
  parentsAddress: string;
  inlawsAddress: string;
  searchRadiusMeters: string;
  commuteMode: string;
};

const EMPTY: FormState = {
  googleWebserviceKey: "",
  mapsJsKey: "",
  orsApiKey: "",
  travelTimeAppId: "",
  travelTimeApiKey: "",
  parentsAddress: "",
  inlawsAddress: "",
  searchRadiusMeters: "8000",
  commuteMode: "driving",
};

export default function SettingsPage() {
  const [form, setForm] = useState<FormState>(EMPTY);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const all = await getAllSettings();
        setForm({
          googleWebserviceKey: all[SETTING_KEYS.googleWebserviceKey] ?? "",
          mapsJsKey: all[SETTING_KEYS.mapsJsKey] ?? "",
          orsApiKey: all[SETTING_KEYS.orsApiKey] ?? "",
          travelTimeAppId: all[SETTING_KEYS.travelTimeAppId] ?? "",
          travelTimeApiKey: all[SETTING_KEYS.travelTimeApiKey] ?? "",
          parentsAddress: all[SETTING_KEYS.parentsAddress] ?? "",
          inlawsAddress: all[SETTING_KEYS.inlawsAddress] ?? "",
          searchRadiusMeters: all[SETTING_KEYS.searchRadiusMeters] ?? "8000",
          commuteMode: all[SETTING_KEYS.commuteMode] ?? "driving",
        });
      } catch (e) {
        setError(String(e));
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  function update<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
    setStatus(null);
  }

  async function onSave(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    setStatus(null);
    try {
      await setSettings({
        [SETTING_KEYS.googleWebserviceKey]: form.googleWebserviceKey.trim(),
        [SETTING_KEYS.mapsJsKey]: form.mapsJsKey.trim(),
        [SETTING_KEYS.orsApiKey]: form.orsApiKey.trim(),
        [SETTING_KEYS.travelTimeAppId]: form.travelTimeAppId.trim(),
        [SETTING_KEYS.travelTimeApiKey]: form.travelTimeApiKey.trim(),
        [SETTING_KEYS.parentsAddress]: form.parentsAddress.trim(),
        [SETTING_KEYS.inlawsAddress]: form.inlawsAddress.trim(),
        [SETTING_KEYS.searchRadiusMeters]: form.searchRadiusMeters.trim(),
        [SETTING_KEYS.commuteMode]: form.commuteMode,
      });
      setStatus("Settings saved.");
    } catch (e) {
      setError(String(e));
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <div className="page">
        <h1 className="page-title">Settings</h1>
        <p className="muted">Loading…</p>
      </div>
    );
  }

  return (
    <div className="page">
      <h1 className="page-title">Settings</h1>
      <p className="muted">
        Stored locally on this machine. API keys and family addresses are never
        committed to source control or sent anywhere except the Google APIs you
        invoke.
      </p>

      <form className="form" onSubmit={onSave}>
        <section className="card">
          <h2 className="card-title">Google APIs</h2>
          <label className="field">
            <span className="field-label">
              Web-service key (Geocoding · Routes · Places)
            </span>
            <input
              type="password"
              autoComplete="off"
              value={form.googleWebserviceKey}
              onChange={(e) => update("googleWebserviceKey", e.target.value)}
              placeholder="AIza…"
            />
            <span className="field-hint">
              Private, billed key. Used by the Rust backend only — never exposed
              to the page.
            </span>
          </label>

          <label className="field">
            <span className="field-label">
              Maps JS key (Maps JavaScript · Street View)
            </span>
            <input
              type="password"
              autoComplete="off"
              value={form.mapsJsKey}
              onChange={(e) => update("mapsJsKey", e.target.value)}
              placeholder="AIza…"
            />
            <span className="field-hint">
              Browser-visible key for the map and Street View. This is the only
              Google key exposed to the page — restrict it in Google Cloud to the
              Maps JavaScript and Street View APIs. Falls back to{" "}
              <code>VITE_GOOGLE_MAPS_JS_KEY</code> if left blank.
            </span>
          </label>
        </section>

        <section className="card">
          <h2 className="card-title">TravelTime (drive-time areas)</h2>
          <p className="muted">
            Preferred provider for the Map View driving areas — supports up to 4
            hours. When set, it's used instead of openrouteservice.
          </p>
          <label className="field">
            <span className="field-label">Application ID</span>
            <input
              type="text"
              autoComplete="off"
              value={form.travelTimeAppId}
              onChange={(e) => update("travelTimeAppId", e.target.value)}
              placeholder="abcd1234"
            />
          </label>
          <label className="field">
            <span className="field-label">API key</span>
            <input
              type="password"
              autoComplete="off"
              value={form.travelTimeApiKey}
              onChange={(e) => update("travelTimeApiKey", e.target.value)}
              placeholder="…"
            />
            <span className="field-hint">
              Free key from{" "}
              <a
                href="https://account.traveltime.com/registration"
                target="_blank"
                rel="noreferrer"
              >
                traveltime.com
              </a>{" "}
              — both the Application ID and API key are read by the Rust backend
              only.
            </span>
          </label>
        </section>

        <section className="card">
          <h2 className="card-title">openrouteservice (fallback)</h2>
          <label className="field">
            <span className="field-label">API key (drive-time areas)</span>
            <input
              type="password"
              autoComplete="off"
              value={form.orsApiKey}
              onChange={(e) => update("orsApiKey", e.target.value)}
              placeholder="eyJ…"
            />
            <span className="field-hint">
              Free key from{" "}
              <a
                href="https://openrouteservice.org/dev/#/signup"
                target="_blank"
                rel="noreferrer"
              >
                openrouteservice.org
              </a>{" "}
              — used to draw the family driving-time areas when TravelTime isn't
              configured (capped at 60 minutes). Read by the Rust backend only.
            </span>
          </label>
        </section>

        <section className="card">
          <h2 className="card-title">Family destinations</h2>
          <label className="field">
            <span className="field-label">Parents' address</span>
            <input
              type="text"
              value={form.parentsAddress}
              onChange={(e) => update("parentsAddress", e.target.value)}
              placeholder="123 Main St, Hamilton, NJ"
            />
          </label>
          <label className="field">
            <span className="field-label">In-laws' address</span>
            <input
              type="text"
              value={form.inlawsAddress}
              onChange={(e) => update("inlawsAddress", e.target.value)}
              placeholder="456 Oak Ave, Trenton, NJ"
            />
          </label>
        </section>

        <section className="card">
          <h2 className="card-title">Search preferences</h2>
          <label className="field">
            <span className="field-label">Amenity search radius (meters)</span>
            <input
              type="number"
              min={500}
              step={500}
              value={form.searchRadiusMeters}
              onChange={(e) => update("searchRadiusMeters", e.target.value)}
            />
          </label>
          <label className="field">
            <span className="field-label">Commute mode</span>
            <select
              value={form.commuteMode}
              onChange={(e) => update("commuteMode", e.target.value)}
            >
              <option value="driving">Driving</option>
              <option value="transit">Transit</option>
              <option value="walking">Walking</option>
              <option value="bicycling">Bicycling</option>
            </select>
          </label>
        </section>

        <div className="form-actions">
          <button type="submit" className="btn btn--primary" disabled={saving}>
            {saving ? "Saving…" : "Save settings"}
          </button>
          {status && <span className="status status--ok">{status}</span>}
          {error && <span className="status status--err">{error}</span>}
        </div>
      </form>

      <NjdoeImportCard />

      <ParcelImportCard />

      <BookmarkletCard />
    </div>
  );
}
