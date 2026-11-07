import { isLaunchWindowOpen, isValidServerTimestamp } from "../shared/preLaunch.js";

export const MARKETPLACE_CLOSED_MESSAGE = "The PartsWalaIND marketplace is not open yet.";

export function isMarketplaceAvailable(options = {}) {
  const now = Object.hasOwn(options, "now") ? options.now : Date.now();
  const { isAdmin = false, allowAdmin = false } = options;
  if (!isValidServerTimestamp(now)) return false;
  return isLaunchWindowOpen(now) || (allowAdmin === true && isAdmin === true);
}

export function rejectMarketplaceBeforeLaunch(response, options = {}) {
  if (isMarketplaceAvailable(options)) return false;
  response.status(403).json({ message: MARKETPLACE_CLOSED_MESSAGE });
  return true;
}
