import { isLaunchWindowOpen } from "../shared/preLaunch.js";
import { MARKETPLACE_CLOSED_MESSAGE } from "./marketplaceLaunch.js";

function normalizedPath(path) {
  const lowerCasePath = String(path || "/").toLowerCase();
  return lowerCasePath.replace(/\/+$/, "") || "/";
}

export function isPreLaunchRestrictedPath(path) {
  const normalized = normalizedPath(path);
  return normalized === "/api/public-products"
    || normalized.startsWith("/api/public-products/")
    || normalized === "/api/products/vendor-names"
    || /^\/api\/products\/[^/]+\/vendor-contact$/.test(normalized)
    || normalized === "/api/reviews"
    || normalized === "/api/settings/assistant/public";
}

export function createPreLaunchAccessPolicy({ now = Date.now } = {}) {
  return function preLaunchAccessPolicy(request, response, next) {
    if (request.method === "OPTIONS" || !isPreLaunchRestrictedPath(request.path)) {
      return next();
    }

    const currentTime = now();
    if (isLaunchWindowOpen(currentTime)) {
      return next();
    }

    response.set("Cache-Control", "no-store");
    return response.status(403).json({ message: MARKETPLACE_CLOSED_MESSAGE });
  };
}
