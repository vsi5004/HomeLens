# Deploying HomeLens to a Debian server (home LAN)

This runs HomeLens as a small web app on your home network instead of (or in
addition to) the desktop app. The same React frontend is served by
`homelens-server`, a thin HTTP wrapper around the shared `homelens-core` logic.

> **Security note:** there is **no authentication**. Only expose this on a
> trusted home LAN, never directly to the internet. If you need remote access,
> put it behind a VPN (e.g. Tailscale/WireGuard) or an authenticating reverse
> proxy.

## Architecture

```
homelens-core   (Rust lib: DB, geocoding, routing, amenities, schools, parcels)
├── src-tauri        → desktop app  (Tauri IPC shell)
└── homelens-server  → web server   (axum HTTP shell)  ←── this deployment

frontend (React/TS) → detects environment at runtime:
    in Tauri  → calls window IPC
    in browser→ calls /api/<command> on homelens-server
```

## 1. Prerequisites on the Debian server

```bash
sudo apt update
sudo apt install -y build-essential curl pkg-config
# Rust (stable) via rustup:
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y
. "$HOME/.cargo/env"
# Node.js 20+ (e.g. via NodeSource) for the frontend build:
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs
```

`rusqlite` is built with the `bundled` feature, so **no system SQLite is
required**. `reqwest` uses `rustls`, so **no OpenSSL dev packages are required**.

## 2. Build

Copy the repository to the server (git clone, scp, rsync…), then:

```bash
cd house-mapper
./deploy/build.sh
```

This produces `target/release/homelens-server` and `dist/`.

> Building on the server is the simplest path. Cross-compiling from Windows/macOS
> to Linux is possible but out of scope here.

## 3. Install

```bash
# Dedicated user + data dir
sudo useradd --system --home /var/lib/homelens --shell /usr/sbin/nologin homelens || true
sudo mkdir -p /opt/homelens /var/lib/homelens /etc/homelens
sudo chown homelens:homelens /var/lib/homelens

# Binary + frontend
sudo cp target/release/homelens-server /opt/homelens/
sudo cp -r dist /opt/homelens/dist

# Config
sudo cp deploy/homelens.env.example /etc/homelens/homelens.env
sudo "$EDITOR" /etc/homelens/homelens.env     # review HOMELENS_BIND etc.

# systemd service
sudo cp deploy/homelens-server.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now homelens-server
sudo systemctl status homelens-server
```

Visit `http://<server-ip>:8080/` from any device on your LAN.

## 4. First-run configuration

Open the app → **Settings** and set:

- **Google web-service API key** — used for geocoding, routing (Routes API),
  Places, and Street View Static. Stored locally in the server's SQLite DB.
- **Google Maps JavaScript API key** — used by the in-page map.
- **Family addresses** — geocode them so the drive-time map works.

### Google Maps key referrer allowlist (important)

The Maps **JavaScript** API key is restricted by HTTP referrer. Because the app
is now served from your server's origin (not `tauri://localhost`), add your LAN
origin(s) to the key's allowed referrers in the Google Cloud console, e.g.:

```
http://192.168.1.50:8080/*
http://homelens.local:8080/*
```

The web-**service** key (geocoding/routes/places) is called from the Rust
backend (server-side), so it should be restricted by **IP** (your server's
public egress IP) or left unrestricted on a trusted network — *not* by referrer.

## 5. Updating

```bash
cd house-mapper && git pull
./deploy/build.sh
sudo cp target/release/homelens-server /opt/homelens/
sudo rm -rf /opt/homelens/dist && sudo cp -r dist /opt/homelens/dist
sudo systemctl restart homelens-server
```

Schema migrations run automatically on startup.

## 6. Backups

Everything lives in one SQLite file: `HOMELENS_DB` (default
`/var/lib/homelens/homelens.db`). Stop the service (or use the SQLite backup
API) and copy it:

```bash
sudo systemctl stop homelens-server
sudo cp /var/lib/homelens/homelens.db ~/homelens-backup-$(date +%F).db
sudo systemctl start homelens-server
```

## Configuration reference

| Variable          | Default            | Purpose                                  |
|-------------------|--------------------|------------------------------------------|
| `HOMELENS_DB`     | `homelens.db`      | SQLite database path                     |
| `HOMELENS_BIND`   | `0.0.0.0:8080`     | Listen address:port                      |
| `HOMELENS_STATIC` | `dist`             | Directory of the built frontend          |
| `HOMELENS_MAX_UPLOAD_MB` | `512`       | Max parcel-upload (GeoJSON) size in MB    |
| `RUST_LOG`        | `homelens_server=info` | Log filter (tracing/env-filter)      |

## Troubleshooting

- **Map shows but tiles are blank / "referer" errors:** add the server origin to
  the Maps JS key referrer allowlist (section 4).
- **Geocoding/routing fail with key errors:** the web-service key is missing or
  IP-restricted to the wrong address; check Settings and the key's restrictions.
- **Parcel import:** in the browser you pick a local file and it uploads to the
  server (the body limit is 256 MB). Start with a single county — statewide
  GeoJSON is multi-GB. The desktop app instead reads the file path directly.
- **Logs:** `journalctl -u homelens-server -f`.
