import test from "node:test";
import assert from "node:assert/strict";
import { createRateLimiter } from "./rateLimiter.js";

test("rate limiter allows requests up to the limit and then rejects", () => {
  const limiter = createRateLimiter({ limit: 3, windowMs: 60000 });
  const start = 1_000_000;
  assert.equal(limiter.check("a", start).allowed, true);
  assert.equal(limiter.check("a", start + 1).allowed, true);
  const third = limiter.check("a", start + 2);
  assert.equal(third.allowed, true);
  assert.equal(third.remaining, 0);
  const blocked = limiter.check("a", start + 3);
  assert.equal(blocked.allowed, false);
  assert.equal(blocked.retryAfterMs, 59997);
});

test("rate limiter windows expire and isolate separate keys", () => {
  const limiter = createRateLimiter({ limit: 2, windowMs: 1000 });
  assert.equal(limiter.check("uid:1", 0).allowed, true);
  assert.equal(limiter.check("uid:1", 1).allowed, true);
  assert.equal(limiter.check("uid:1", 2).allowed, false);
  assert.equal(limiter.check("uid:2", 2).allowed, true);
  assert.equal(limiter.check("uid:1", 1001).allowed, true);
});

test("rate limiter stays bounded and drops the oldest buckets first", () => {
  const limiter = createRateLimiter({ limit: 5, windowMs: 60000, maxKeys: 3, maxIdleMs: 60000 });
  limiter.check("a", 1000);
  limiter.check("b", 2000);
  limiter.check("c", 3000);
  assert.equal(limiter.size(), 3);
  limiter.check("d", 4000);
  assert.equal(limiter.size(), 3);
  // "a" was evicted, so it starts a fresh window instead of being remembered.
  assert.equal(limiter.check("a", 4001).remaining, 4);
});

test("rate limiter sweep releases idle buckets", () => {
  const limiter = createRateLimiter({ limit: 5, windowMs: 1000, maxKeys: 100, maxIdleMs: 5000 });
  limiter.check("stale", 1000);
  limiter.check("fresh", 10_000);
  assert.equal(limiter.size(), 2);
  assert.equal(limiter.sweep(10_000), 1);
  assert.equal(limiter.size(), 1);
});

test("rate limiter rejects invalid configuration instead of silently disabling limits", () => {
  assert.throws(() => createRateLimiter({ limit: 0, windowMs: 1000 }));
  assert.throws(() => createRateLimiter({ limit: 1, windowMs: 0 }));
  assert.throws(() => createRateLimiter({ limit: 1, windowMs: 1000, maxKeys: 0 }));
});
