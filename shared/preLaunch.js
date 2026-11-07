export const PARTSWALA_LAUNCH_IST = "2026-11-08T00:00:00+05:30";
export const PARTSWALA_LAUNCH_UTC = "2026-11-07T18:30:00.000Z";
export const LAUNCH_STATUS_REFRESH_INTERVAL_MS = 30000;
const PRELAUNCH_VENDOR_ROUTES = new Set([
  "/profile",
  "/vendor",
  "/vendor/dashboard",
  "/vendor/enquiries",
  "/vendor/import",
]);

export function getLaunchTargetMs() {
  return Date.parse(PARTSWALA_LAUNCH_UTC);
}

export function isValidServerTimestamp(timestamp) {
  return Number.isSafeInteger(timestamp) && Number.isFinite(new Date(timestamp).getTime());
}

export function scheduleLaunchStatusRefresh(onRefresh, {
  setTimeoutFn = setTimeout,
  clearTimeoutFn = clearTimeout,
} = {}) {
  let cancelled = false;
  const timeoutId = setTimeoutFn(() => {
    if (!cancelled) onRefresh();
  }, LAUNCH_STATUS_REFRESH_INTERVAL_MS);
  return () => {
    cancelled = true;
    clearTimeoutFn(timeoutId);
  };
}

export function isLaunchWindowOpen(...clock) {
  const now = clock.length ? clock[0] : Date.now();
  return isValidServerTimestamp(now) && now >= getLaunchTargetMs();
}

export function shouldShowComingSoon(preLaunchEnabled, isAdmin, isDevelopment = false) {
  if (isDevelopment) return false;
  if (isAdmin === true) return false;
  return preLaunchEnabled !== false;
}

export function getPreLaunchRouteSurface(pathname, isApprovedVendor) {
  if (pathname === "/vendor/login") return "vendor-login";
  if (isApprovedVendor === true && PRELAUNCH_VENDOR_ROUTES.has(pathname)) return "vendor";
  return "coming-soon";
}
