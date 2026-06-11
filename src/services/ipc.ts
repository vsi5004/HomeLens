/**
 * Transport shim. The app runs in two environments from the *same* frontend code:
 *
 *  - **Desktop (Tauri):** calls go over Tauri IPC via `@tauri-apps/api`.
 *  - **Web (LAN server):** calls go over HTTP to `homelens-server` at `/api/<cmd>`,
 *    sending the same named-argument object the desktop passes to `invoke`.
 *
 * Everything else in `services/` imports `invoke` from here instead of directly
 * from `@tauri-apps/api/core`, so no call site needs to know which mode it's in.
 */

export function isTauri(): boolean {
  return (
    typeof window !== "undefined" &&
    ("__TAURI_INTERNALS__" in window || "__TAURI__" in window)
  );
}

type Args = Record<string, unknown> | undefined;

/** Invoke a backend command in either environment. */
export async function invoke<T>(cmd: string, args?: Args): Promise<T> {
  if (isTauri()) {
    const { invoke: tauriInvoke } = await import("@tauri-apps/api/core");
    return tauriInvoke<T>(cmd, args as Record<string, unknown>);
  }
  const res = await fetch(`/api/${cmd}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(args ?? {}),
  });
  if (!res.ok) {
    // The server returns a plain-text error body; mirror Tauri's thrown error.
    const text = await res.text().catch(() => "");
    throw new Error(text || `${res.status} ${res.statusText}`);
  }
  const text = await res.text();
  return (text ? JSON.parse(text) : undefined) as T;
}

/** Open a URL in the system browser (desktop) or a new tab (web). */
export async function openExternalUrl(url: string): Promise<void> {
  if (isTauri()) {
    const { openUrl } = await import("@tauri-apps/plugin-opener");
    await openUrl(url);
    return;
  }
  window.open(url, "_blank", "noopener,noreferrer");
}

/**
 * Upload a parcel GeoJSON dataset (web mode). The desktop app instead reads a
 * locally-picked file path directly in Rust; on the web there is no server-side
 * path, so we stream the file to the server's multipart upload endpoint.
 */
export async function uploadParcelDataset(
  file: File,
  source?: string,
): Promise<{ imported: number; skipped: number; total: number }> {
  const form = new FormData();
  form.append("file", file, file.name);
  if (source) form.append("source", source);
  const res = await fetch("/api/import_parcels", { method: "POST", body: form });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(text || `${res.status} ${res.statusText}`);
  }
  return res.json();
}
