# HomeLens NJ

A local-first app for personal house-hunting. Save the homes you're considering and
build a repeatable scorecard for each one: an interactive map and Street View, drive
times to family, nearby amenities, school data, property/tax context, and your own
notes — all stored **on your own machine** and compared side-by-side in a dashboard.

You can run it two ways:

- **Desktop app** (Windows/macOS/Linux) — a normal installable application.
- **Home web server** — run it on a box on your LAN (e.g. a Debian server) and open it
  from any browser in the house. Same app, same data model.

> Personal-use tool, not a public real-estate service. It does not scrape listing
> portals — see [Listing data & fair use](#listing-data--fair-use).

---

## Contents

- [What you can do](#what-you-can-do)
- [Quick start (desktop app)](#quick-start-desktop-app)
- [Setting up API keys](#setting-up-api-keys)
  - [Google Maps (required)](#1-google-maps-required)
  - [Drive-time areas (optional)](#2-drive-time-areas-optional)
- [Running as a home web server](#running-as-a-home-web-server)
- [Adding properties & autofill from a link](#adding-properties--autofill-from-a-link)
- [Where your data lives](#where-your-data-lives)
- [Listing data & fair use](#listing-data--fair-use)
- [For developers](#for-developers)

---

## What you can do

- **Save properties** by address; each is geocoded and pinned on a map with Street View.
- **Autofill from a listing link** — paste an agent/brokerage URL and HomeLens pulls in
  the address, price, beds/baths, square footage, year built, etc. for you to review. A
  bookmarklet handles big portals that block automated requests.
- **See drive times to family** — set two family addresses and get cached driving
  distances/times to each, on every property.
- **Map the family "overlap zone"** — draw each family's N-minute driving area and
  highlight where you could live within N minutes of *both*.
- **Find nearby amenities** — nearest grocery, pharmacy, post office, park, school,
  daycare, and train station for each home.
- **Bring in school & parcel data** — import NJ DOE school performance reports and NJ
  county parcel/MOD-IV data, then attach them to properties.
- **Score and compare** — a weighted 0–100 score per home across family access, schools,
  amenities, value, taxes, and your own subjective rating, in a sortable dashboard with
  CSV export.

---

## Quick start (desktop app)

**Prerequisites**

- [Node.js](https://nodejs.org/) LTS (tested with Node 24) + npm
- [Rust](https://rustup.rs/) (stable toolchain)
- Tauri OS prerequisites — see <https://tauri.app/start/prerequisites/>
  - **Windows:** Microsoft C++ Build Tools + WebView2 runtime (preinstalled on Win 10/11)
  - **macOS:** Xcode command line tools (`xcode-select --install`)
  - **Linux:** `webkit2gtk` and related packages (see the Tauri page)

**Run it**

```bash
npm install
cp .env.example .env        # optional: add your Maps JS key here (or enter it in Settings later)
npm run tauri dev           # launches the desktop app
```

To produce an installable build:

```bash
npm run tauri build
```

On first launch, open **Settings** and add your API keys (next section). The app works
with no keys, but the map, geocoding, drive times, and amenities need them.

---

## Setting up API keys

All keys are entered on the **Settings** page and stored **locally** in your own
database — nothing is sent anywhere except the corresponding Google/provider API. You
never have to put keys in source files.

HomeLens uses a deliberate **two-key split** for Google so your billed key is never
exposed to the browser:

| Key | Used by | Used for | Where it can be exposed |
| --- | --- | --- | --- |
| **Maps JS key** | the browser/webview | the interactive map + Street View embeds | front end (restricted by referrer) |
| **Web-service key** | the Rust backend only | geocoding, routing, Places, Street View Static | never sent to the front end |

### 1. Google Maps (required)

1. In the [Google Cloud Console](https://console.cloud.google.com/), create a project and
   enable these APIs: **Maps JavaScript**, **Street View**, **Geocoding**,
   **Routes** (and/or Distance Matrix), and **Places API (New)**.
2. Create **two** API keys:
   - **Maps JS key** — restrict it to the *Maps JavaScript* + *Street View* APIs, and
     restrict by HTTP referrer. Enter it in **Settings**, or set
     `VITE_GOOGLE_MAPS_JS_KEY` in `.env` as a fallback. This is the *only* Google key the
     front end ever sees.
   - **Web-service key** — used for Geocoding / Routes / Places. Enter it in **Settings**;
     it stays on the Rust side and is never bundled into the front end. Restrict it by
     **IP**, not referrer.
3. **"Places API (New)" gotcha:** it's a *separate product* from the legacy "Places API".
   If you restrict the web-service key by API, you must add **"Places API (New)"** to its
   allow-list specifically, or amenity lookups fail with `403 API_KEY_SERVICE_BLOCKED`.
   Restriction changes can take a few minutes to take effect.
4. **Watch billing.** Enrichment is on-demand and cached to keep call volume low.
   Amenities make one Places call per category; "Fetch all" (7 categories) asks for
   confirmation first.

### 2. Drive-time areas (optional)

The Map View can draw each family's N-minute driving area and highlight the overlap. This
needs **one** of the following providers (TravelTime is recommended):

**TravelTime (recommended — up to 4-hour ranges)**

1. Register for a free key at <https://account.traveltime.com/registration>. You get an
   **Application ID** and an **API Key**.
2. Enter both in **Settings → TravelTime**.
3. Open **Map View**, set the driving time (up to 240 min), and click **Compute areas**.
   Each range is cached separately, so switching between previously computed ranges (the
   **Cached:** chips) is instant and makes no API call.

**openrouteservice (fallback — capped at 60 min)**

Used automatically only if TravelTime isn't configured.

1. Sign up for a free key at <https://openrouteservice.org/dev/#/signup>.
2. Enter it in **Settings → openrouteservice**.
3. Open **Map View**, set the driving time (≤ 60 min), and click **Compute areas**.

---

## Running as a home web server

Instead of (or in addition to) the desktop app, you can run HomeLens as a small web app
on your home network and use it from any browser. The same front end is served by
`homelens-server`, a lightweight HTTP server.

> **No authentication.** Only expose this on a trusted home LAN — never directly to the
> internet. For remote access, put it behind a VPN (Tailscale/WireGuard) or an
> authenticating reverse proxy.

**Build and run locally (quick test):**

```bash
npm install
npm run build                       # builds the front end into dist/
cargo run -p homelens-server        # serves on http://0.0.0.0:8080 by default
```

Then open `http://localhost:8080`. Configure it with environment variables:

| Variable | Default | Purpose |
| --- | --- | --- |
| `HOMELENS_DB` | `homelens.db` | SQLite database path |
| `HOMELENS_BIND` | `0.0.0.0:8080` | Listen address:port |
| `HOMELENS_STATIC` | `dist` | Directory of the built front end |
| `RUST_LOG` | `homelens_server=info` | Log verbosity |

**Deploy to a Debian server** (dedicated user, systemd service, backups, and the Maps
referrer-allowlist caveat for the server's origin): see **[`deploy/README.md`](deploy/README.md)**.

Keys and family addresses are configured the same way — open the served app and use the
**Settings** page. One note: because the web app is served from your server's origin (not
`tauri://localhost`), add that origin to the Maps **JS** key's referrer allowlist, e.g.
`http://homelens.local:8080/*`. Full details are in the deploy guide.

---

## Adding properties & autofill from a link

On **Add Property** you can just type an address, or paste a **listing URL** and click
**Autofill from link**. HomeLens fetches the page once and reads the structured data the
site already publishes (address, price, beds/baths, square footage, year built, and
coordinates when available), then fills the form for you to review before saving. It only
fills fields you haven't already typed, and it never stores listing photos or marketing
copy.

Most agent/brokerage/IDX sites work directly. **Big portals (Zillow, Realtor.com, RE/MAX,
…) block automated requests.** For those, use the **"Send to HomeLens" bookmarklet** from
the **Settings** page: open the listing in your own browser, click the bookmarklet, and it
reads the page in your session and opens HomeLens with the details prefilled. This keeps
everything within the listing site's normal terms — no bot evasion on our side.

---

## Where your data lives

Everything is stored in a single local SQLite file — your properties, scores, notes,
imported school/parcel data, and your API keys.

- **Desktop app:** in your OS app-data directory as `homelens.db` (e.g. on Windows,
  `%APPDATA%\com.homelens.nj\homelens.db`).
- **Web server:** wherever `HOMELENS_DB` points (default `homelens.db` next to the binary;
  `/var/lib/homelens/homelens.db` in the recommended Debian setup).

To back up, just copy that file (stop the server first if it's running). This file
contains your API keys and family addresses, so keep it private — it is **not** committed
to git (the repo's `.gitignore` excludes `*.db` and `.env`).

---

## Listing data & fair use

HomeLens does **not** scrape Zillow, Redfin, or Realtor.com, and it does not perform any
anti-bot evasion (no CAPTCHA bypass, proxy rotation, or login scraping), nor does it
store or redistribute third-party listing photos or descriptions.

The "Autofill from link" feature does a single, ordinary page request and reads only the
structured metadata a site already publishes to the open web; the bookmarklet reads a page
in *your own* browser session. Both are conveniences for personal data entry — manual
entry is always available. Please respect each site's Terms of Use.

---

## For developers

**Stack**

- **Desktop shell:** Tauri 2.x (Rust backend + OS webview)
- **Web shell:** `homelens-server`, an [axum](https://github.com/tokio-rs/axum) HTTP server
- **Front end:** React + TypeScript + Vite, React Router
- **Persistence:** SQLite via a thin Rust layer over `rusqlite` (bundled — no system
  SQLite needed), with ordered `.sql` migrations tracked by `PRAGMA user_version`

**Cargo workspace** — all business logic lives in one shared crate so both shells stay thin:

```
core/        homelens-core   — DB, geocoding, routing, amenities, schools, parcels, listing
src-tauri/   tauri-app       — desktop shell (Tauri IPC wrappers over core)
server/      homelens-server — LAN web shell (axum HTTP routes over core)
```

The front-end transport shim (`src/services/ipc.ts`) detects its environment at runtime:
Tauri IPC inside the desktop app, or `fetch('/api/<command>')` against `homelens-server`
in a browser. No call site needs to know which mode it's in.

**Architecture decisions**

1. **Two-key Google boundary** (see [API keys](#setting-up-api-keys)) — the billed
   web-service key is used only by Rust and never bundled into front-end JS.
2. **One DB strategy** — `rusqlite` only; no `sqlx`/`tauri-plugin-sql` mixing.
3. **On-demand, cache-first enrichment** — geocode on save; routes/amenities fetched
   explicitly and cached, to keep API costs low.

**Scripts**

| Command | What it does |
| --- | --- |
| `npm run dev` | Vite dev server only (no desktop shell) |
| `npm run build` | Type-check + build the front end into `dist/` |
| `npm run tauri dev` | Build + launch the desktop app (dev) |
| `npm run tauri build` | Produce a packaged desktop build |
| `cargo build` | Build the whole Rust workspace |
| `cargo test -p homelens-core` | Run core unit tests |
| `cargo run -p homelens-server` | Run the LAN web server |

**Dev tooling (Tauri MCP).** This repo is wired for the
[Tauri MCP server](https://github.com/hypothesi/mcp-server-tauri), which lets an AI
assistant inspect and drive the running app during development. The bridge plugin
(`tauri-plugin-mcp-bridge`) is compiled **only under `#[cfg(debug_assertions)]`** and binds
to `127.0.0.1` — it is never in release builds or exposed to the network. `withGlobalTauri`
is enabled in `tauri.conf.json` because the bridge's injected script needs
`window.__TAURI__`. Generic Playwright/Puppeteer MCPs do not attach cleanly to WebView2.
