// backend/ai/access.js
// Access policy for POST /api/ai/chat.
//
// The assistant stays available to signed-out visitors for product discovery (it must never
// become a login wall for browsing), but they are limited separately by client IP, while
// signed-in callers are limited by Firebase UID. Both limiters are bounded in memory.

import { createRateLimiter } from "../rateLimiter.js";

export const ASSISTANT_RATE_LIMITS = {
  authenticated: { limit: 24, windowMs: 60000, maxKeys: 20000 },
  anonymous: { limit: 8, windowMs: 60000, maxKeys: 2000 },
};

export function createAssistantLimiters() {
  return {
    authenticated: createRateLimiter(ASSISTANT_RATE_LIMITS.authenticated),
    anonymous: createRateLimiter(ASSISTANT_RATE_LIMITS.anonymous),
  };
}

/**
 * Express resolves `request.ip` only as far as `trust proxy` allows. When the app runs behind
 * a proxy, the first entry of `request.ips` is the closest client address Express trusts.
 */
export function resolveClientIp(request = {}) {
  const forwarded = Array.isArray(request.ips) ? request.ips[0] : "";
  return String(forwarded || request.ip || "").trim() || "unknown";
}

export function assistantLimiterKey({ user, ip } = {}) {
  return user?.uid ? `uid:${user.uid}` : `ip:${resolveClientIp({ ip })}`;
}

export function assistantRateLimitDecision({ user, ip, limiters, now = Date.now() }) {
  const authenticated = Boolean(user?.uid);
  const limiter = authenticated ? limiters.authenticated : limiters.anonymous;
  const key = assistantLimiterKey({ user, ip });
  const result = limiter.check(key, now);
  if (!result.allowed) {
    return {
      allowed: false,
      key,
      authenticated,
      retryAfterSeconds: Math.max(1, Math.ceil(result.retryAfterMs / 1000)),
      message: "Please wait a moment before sending another message.",
    };
  }
  return { allowed: true, key, authenticated, remaining: result.remaining };
}
