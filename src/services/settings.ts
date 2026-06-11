import { invoke } from "./ipc";

/**
 * Canonical setting keys. Centralized so the Settings UI and any future
 * enrichment code agree on the same strings.
 *
 * NOTE (brief §2.1): `googleWebserviceKey` is the private, billed key. It is
 * stored locally and is intended to be read by the Rust side when making
 * Geocoding/Routes/Places calls — it must never be embedded in frontend bundles
 * or logged. The Maps JS key (browser-visible) is configured separately via env.
 */
export const SETTING_KEYS = {
  googleWebserviceKey: "google_webservice_key",
  mapsJsKey: "google_maps_js_key",
  orsApiKey: "ors_api_key",
  travelTimeAppId: "traveltime_app_id",
  travelTimeApiKey: "traveltime_api_key",
  parentsAddress: "family_parents_address",
  inlawsAddress: "family_inlaws_address",
  searchRadiusMeters: "default_search_radius_meters",
  commuteMode: "commute_mode",
  scoringWeights: "scoring_weights",
} as const;

export type SettingKey = (typeof SETTING_KEYS)[keyof typeof SETTING_KEYS];

export async function getAllSettings(): Promise<Record<string, string>> {
  return invoke<Record<string, string>>("get_all_settings");
}

export async function getSetting(key: SettingKey): Promise<string | null> {
  return invoke<string | null>("get_setting", { key });
}

export async function setSetting(key: SettingKey, value: string): Promise<void> {
  return invoke("set_setting", { key, value });
}

export async function setSettings(values: Record<string, string>): Promise<void> {
  return invoke("set_settings", { values });
}
