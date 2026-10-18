export const SETTINGS_REQUEST_TIMEOUT_MS = 60000;

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
  return {
    preLaunchEnabled: result.preLaunchEnabled,
    comingSoonVideoUrl: typeof result.comingSoonVideoUrl === "string" ? result.comingSoonVideoUrl : "",
  };
}
