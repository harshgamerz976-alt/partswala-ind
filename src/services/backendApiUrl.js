export function resolveBackendApiUrl({ configuredUrl = "", isProduction = false } = {}) {
  const fallback = isProduction ? "https://partswala-ind.onrender.com" : "http://localhost:8787";
  const configured = String(configuredUrl || "").trim();
  const localAddress = /^https?:\/\/(?:localhost|127(?:\.\d{1,3}){3}|0\.0\.0\.0|\[::1\])(?::|\/|$)/i;
  const baseUrl = isProduction && localAddress.test(configured) ? fallback : configured || fallback;
  return baseUrl.replace(/\/$/, "");
}

const environment = import.meta.env || {};
export const BACKEND_API_URL = resolveBackendApiUrl({
  configuredUrl: environment.VITE_API_URL || environment.VITE_BACKEND_API_URL,
  isProduction: environment.PROD,
});
