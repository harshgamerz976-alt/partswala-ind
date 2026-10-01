// backend/rateLimiter.js
// Bounded, TTL-based in-memory rate limiter.
//
// Every bucket is dropped once it has been idle for `maxIdleMs`, and the map never grows
// past `maxKeys` (the oldest buckets are evicted first), so a hostile caller cannot grow
// the process memory without limit. No external infrastructure (Redis/Upstash) is required.

const DEFAULT_MAX_IDLE_MS = 10 * 60 * 1000;

export function createRateLimiter({ limit, windowMs, maxKeys = 5000, maxIdleMs = DEFAULT_MAX_IDLE_MS } = {}) {
  if (!Number.isInteger(limit) || limit <= 0) throw new Error("A positive integer rate limit is required.");
  if (!Number.isFinite(windowMs) || windowMs <= 0) throw new Error("A positive rate limit window is required.");
  if (!Number.isInteger(maxKeys) || maxKeys <= 0) throw new Error("A positive integer bucket cap is required.");

  const buckets = new Map();

  function evictOldest() {
    let oldestKey = null;
    let oldestSeen = Infinity;
    for (const [key, bucket] of buckets) {
      if (bucket.lastSeen < oldestSeen) {
        oldestSeen = bucket.lastSeen;
        oldestKey = key;
      }
    }
    if (oldestKey !== null) buckets.delete(oldestKey);
  }

  function sweep(now = Date.now()) {
    for (const [key, bucket] of buckets) {
      if (now - bucket.lastSeen > maxIdleMs) buckets.delete(key);
    }
    return buckets.size;
  }

  function check(key, now = Date.now()) {
    const bucketKey = String(key || "unknown");
    const existing = buckets.get(bucketKey);

    if (!existing) {
      if (buckets.size >= maxKeys) {
        sweep(now);
        while (buckets.size >= maxKeys) evictOldest();
      }
      buckets.set(bucketKey, { timestamps: [now], lastSeen: now });
      return { allowed: true, remaining: limit - 1, retryAfterMs: 0, size: buckets.size };
    }

    const recent = existing.timestamps.filter((timestamp) => now - timestamp < windowMs);
    existing.lastSeen = now;
    if (recent.length >= limit) {
      existing.timestamps = recent;
      const retryAfterMs = Math.max(0, windowMs - (now - recent[0]));
      return { allowed: false, remaining: 0, retryAfterMs, size: buckets.size };
    }

    recent.push(now);
    existing.timestamps = recent;
    return { allowed: true, remaining: limit - recent.length, retryAfterMs: 0, size: buckets.size };
  }

  return { check, sweep, size: () => buckets.size, limit, windowMs, maxKeys, maxIdleMs };
}
