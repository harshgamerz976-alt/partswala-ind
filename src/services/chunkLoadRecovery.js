const RETRIED_CHUNK_PREFIX = "partswala:chunk-load-retry:";

export function registerChunkLoadRecovery(targetWindow = window) {
  targetWindow.addEventListener("vite:preloadError", (event) => {
    const request = typeof event.payload?.request === "string" ? event.payload.request : "unknown";
    const retryKey = `${RETRIED_CHUNK_PREFIX}${request}`;
    if (targetWindow.sessionStorage.getItem(retryKey) === "1") return;

    targetWindow.sessionStorage.setItem(retryKey, "1");
    event.preventDefault();
    targetWindow.location.reload();
  });
}
