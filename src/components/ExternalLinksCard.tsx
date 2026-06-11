import { useEffect, useState } from "react";

import type { Property } from "../services/properties";
import {
  addExternalLink,
  addressQuery,
  deleteExternalLink,
  listExternalLinks,
  LISTING_SITES,
  openExternal,
  type ExternalLink,
} from "../services/links";

interface Props {
  property: Property;
}

/** Saved external links + quick search-link generators for a property (Phase 5). */
export default function ExternalLinksCard({ property }: Props) {
  const [links, setLinks] = useState<ExternalLink[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [label, setLabel] = useState("");
  const [url, setUrl] = useState("");
  const [adding, setAdding] = useState(false);

  const query = addressQuery(property);

  useEffect(() => {
    listExternalLinks(property.id)
      .then(setLinks)
      .catch((e) => setError(String(e)))
      .finally(() => setLoading(false));
  }, [property.id]);

  async function refresh() {
    setLinks(await listExternalLinks(property.id));
  }

  async function onAdd(e: React.FormEvent) {
    e.preventDefault();
    if (!url.trim()) return;
    setAdding(true);
    setError(null);
    try {
      await addExternalLink(property.id, label.trim() || "Link", url.trim());
      setLabel("");
      setUrl("");
      await refresh();
    } catch (err) {
      setError(String(err));
    } finally {
      setAdding(false);
    }
  }

  async function onDelete(id: string) {
    setError(null);
    try {
      await deleteExternalLink(id);
      await refresh();
    } catch (err) {
      setError(String(err));
    }
  }

  async function open(target: string) {
    setError(null);
    try {
      await openExternal(target);
    } catch (err) {
      setError(String(err));
    }
  }

  /** Save a generated search link, then open it. */
  async function generateAndOpen(siteLabel: string, target: string) {
    setError(null);
    try {
      await addExternalLink(property.id, siteLabel, target);
      await refresh();
      await openExternal(target);
    } catch (err) {
      setError(String(err));
    }
  }

  return (
    <section className="card">
      <h2 className="card-title">External links</h2>

      {query && (
        <div className="links-generators">
          <span className="muted">Search this address on:</span>
          {LISTING_SITES.map((site) => {
            const target = site.search(query);
            return (
              <span key={site.key} className="link-gen">
                <button
                  type="button"
                  className="btn btn--sm"
                  onClick={() => open(target)}
                  title={`Open ${site.label} search in browser`}
                >
                  {site.label}
                </button>
                <button
                  type="button"
                  className="btn btn--sm btn--ghost"
                  onClick={() => generateAndOpen(site.label, target)}
                  title="Save this search link and open it"
                >
                  + save
                </button>
              </span>
            );
          })}
        </div>
      )}

      {loading && <p className="muted">Loading…</p>}

      {!loading && links.length === 0 && (
        <p className="muted">No saved links yet.</p>
      )}

      {links.length > 0 && (
        <ul className="links-list">
          {links.map((l) => (
            <li key={l.id} className="links-list__item">
              <button
                type="button"
                className="link-btn"
                onClick={() => open(l.url)}
                title={l.url}
              >
                {l.label || l.url}
              </button>
              <button
                type="button"
                className="btn btn--sm btn--ghost"
                onClick={() => onDelete(l.id)}
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
      )}

      <form className="links-add" onSubmit={onAdd}>
        <input
          type="text"
          value={label}
          placeholder="Label"
          onChange={(e) => setLabel(e.target.value)}
        />
        <input
          type="url"
          value={url}
          placeholder="https://…"
          onChange={(e) => setUrl(e.target.value)}
        />
        <button type="submit" className="btn btn--sm" disabled={adding}>
          {adding ? "Adding…" : "Add link"}
        </button>
      </form>

      {error && <p className="status status--err">{error}</p>}
    </section>
  );
}
