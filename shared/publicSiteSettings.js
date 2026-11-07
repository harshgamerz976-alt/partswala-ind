import { PARTSWALA_LAUNCH_UTC } from "./preLaunch.js";

export const SETTINGS_REQUEST_TIMEOUT_MS = 60000;

export async function fetchPublicAssistantSettings(baseUrl, {
  fetchImpl = fetch,
  timeoutMs = SETTINGS_REQUEST_TIMEOUT_MS,
} = {}) {
  const endpoint = `${baseUrl.replace(/\/$/, "")}/api/settings/assistant/public`;
  let response;
  try {
    response = await fetchImpl(endpoint, {
      cache: "no-store",
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (error) {
    throw new Error(`Public assistant settings request failed: ${error?.message || "No response was received."}`);
  }
  const result = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}${response.statusText ? ` ${response.statusText}` : ""} for /api/settings/assistant/public. ${result.message || "Public assistant settings could not be loaded."}`);
  }
  if (typeof result.enabled !== "boolean") {
    throw new Error("Public assistant settings returned an invalid enabled value.");
  }
  return { enabled: result.enabled };
}

export async function fetchPublicSiteSettings(baseUrl, {
  fetchImpl = fetch,
  timeoutMs = SETTINGS_REQUEST_TIMEOUT_MS,
} = {}) {
  const endpoint = `${baseUrl.replace(/\/$/, "")}/api/settings/public`;
  let response;
  try {
    response = await fetchImpl(endpoint, {
      cache: "no-store",
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (error) {
    if (error?.name === "TimeoutError" || error?.name === "AbortError") {
      throw new Error(`Public site settings request timed out after ${timeoutMs / 1000} seconds.`);
    }
    throw new Error(`Public site settings request failed: ${error?.message || "No response was received."}`);
  }

  const result = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}${response.statusText ? ` ${response.statusText}` : ""} for /api/settings/public. ${result.message || "Public site settings could not be loaded."}`);
  }
  if (typeof result.preLaunchEnabled !== "boolean") {
    throw new Error("Public site settings returned an invalid pre-launch value.");
  }
  const launchTimeMs = Date.parse(PARTSWALA_LAUNCH_UTC);
  const serverTimeMs = typeof result.serverTimeUtc === "string" ? Date.parse(result.serverTimeUtc) : Number.NaN;
  const expectedMillisecondsUntilLaunch = Math.max(0, launchTimeMs - serverTimeMs);
  if (result.launchTime !== PARTSWALA_LAUNCH_UTC
    || !Number.isSafeInteger(serverTimeMs)
    || new Date(serverTimeMs).toISOString() !== result.serverTimeUtc
    || !Number.isSafeInteger(result.millisecondsUntilLaunch)
    || result.millisecondsUntilLaunch !== expectedMillisecondsUntilLaunch
    || result.preLaunchEnabled !== (serverTimeMs < launchTimeMs)) {
    throw new Error("Public site settings returned an invalid authoritative launch status.");
  }
  return {
    preLaunchEnabled: result.preLaunchEnabled,
    launchTime: result.launchTime,
    serverTimeUtc: result.serverTimeUtc,
    millisecondsUntilLaunch: result.millisecondsUntilLaunch,
  };
}
