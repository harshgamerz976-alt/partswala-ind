import test from "node:test";
import assert from "node:assert/strict";
import { allowedAssistantTools, canUseAssistantTool } from "./authorization.js";
import { ASSISTANT_RATE_LIMITS, assistantLimiterKey, assistantRateLimitDecision, createAssistantLimiters, resolveClientIp } from "./access.js";

test("guest AI stays available but is limited per client IP", () => {
  const limiters = createAssistantLimiters();
  const decision = assistantRateLimitDecision({ user: null, ip: "203.0.113.9", limiters, now: 1000 });
  assert.equal(decision.allowed, true);
  assert.equal(decision.authenticated, false);
  assert.equal(decision.key, "ip:203.0.113.9");
  assert.equal(decision.remaining, ASSISTANT_RATE_LIMITS.anonymous.limit - 1);
});

test("a caller without a trusted IP cannot share one unbounded anonymous bucket", () => {
  assert.equal(assistantLimiterKey({ user: null, ip: "" }), "ip:unknown");
  assert.equal(resolveClientIp({ ip: "198.51.100.7" }), "198.51.100.7");
  assert.equal(resolveClientIp({ ips: ["198.51.100.7", "10.0.0.1"], ip: "10.0.0.1" }), "198.51.100.7");
});

test("authenticated callers are limited by UID, not by IP", () => {
  const limiters = createAssistantLimiters();
  const decision = assistantRateLimitDecision({ user: { uid: "user-1" }, ip: "203.0.113.9", limiters, now: 1000 });
  assert.equal(decision.authenticated, true);
  assert.equal(decision.key, "uid:user-1");
  // A second account behind the same IP is unaffected by the first account's usage.
  for (let index = 0; index < ASSISTANT_RATE_LIMITS.authenticated.limit + 5; index += 1) {
    assistantRateLimitDecision({ user: { uid: "user-1" }, ip: "203.0.113.9", limiters, now: 1000 + index });
  }
  assert.equal(assistantRateLimitDecision({ user: { uid: "user-2" }, ip: "203.0.113.9", limiters, now: 1001 }).allowed, true);
});

test("anonymous AI requests are refused once the IP budget is spent", () => {
  const limiters = createAssistantLimiters();
  const results = [];
  for (let index = 0; index <= ASSISTANT_RATE_LIMITS.anonymous.limit; index += 1) {
    results.push(assistantRateLimitDecision({ user: null, ip: "203.0.113.44", limiters, now: 5000 + index }));
  }
  assert.equal(results.at(-1).allowed, false);
  assert.ok(results.at(-1).retryAfterSeconds >= 1);
});

test("anonymous limiter memory is bounded", () => {
  const limiters = createAssistantLimiters();
  for (let index = 0; index < 5000; index += 1) {
    assistantRateLimitDecision({ user: null, ip: `203.0.113.${index}`, limiters, now: 1000 + index });
  }
  assert.ok(limiters.anonymous.size() <= ASSISTANT_RATE_LIMITS.anonymous.maxKeys);
  assert.ok(limiters.authenticated.limit === ASSISTANT_RATE_LIMITS.authenticated.limit);
});

test("assistant authorization scopes remain enforced for every role", () => {
  assert.equal(canUseAssistantTool("customer", "getVendorPayout"), false);
  assert.equal(canUseAssistantTool("customer", "getAdminFinance"), false);
  assert.equal(canUseAssistantTool("vendor", "getLowStockProducts"), true);
  assert.equal(canUseAssistantTool("vendor", "getAdminFinance"), false);
  assert.equal(canUseAssistantTool("admin", "getAdminFinance"), true);
  assert.deepEqual(allowedAssistantTools("guest"), allowedAssistantTools("customer"));
});
