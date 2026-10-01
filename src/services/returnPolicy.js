export const DEFAULT_RETURN_WINDOW_DAYS = 7;

export function normalizeReturnWindowDays(value, fallback = DEFAULT_RETURN_WINDOW_DAYS) {
  const days = Number(value);
  if (!Number.isFinite(days)) return fallback;
  return Math.max(0, Math.min(365, Math.floor(days)));
}

export function isReturnWindowOpen(order, now = Date.now()) {
  const createdAt = Date.parse(order?.createdAt || "");
  if (!Number.isFinite(createdAt)) return false;
  const days = normalizeReturnWindowDays(order?.returnWindowDays);
  return now <= createdAt + days * 86400000;
}