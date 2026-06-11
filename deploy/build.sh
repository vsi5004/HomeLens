#!/usr/bin/env bash
# Build the HomeLens web server + frontend on the target (Debian) machine.
# Run from the repository root:  ./deploy/build.sh
set -euo pipefail

cd "$(dirname "$0")/.."

echo "==> Building frontend (npm)"
npm ci
npm run build            # emits ./dist

echo "==> Building server (cargo, release)"
cargo build --release -p homelens-server

echo
echo "Built:"
echo "  server binary : target/release/homelens-server"
echo "  frontend      : dist/"
echo
echo "Next: see deploy/README.md to install as a systemd service."
