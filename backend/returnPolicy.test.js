import test from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_RETURN_WINDOW_DAYS, isReturnWindowOpen, normalizeReturnWindowDays } from "../src/services/returnPolicy.js";

test("return-window snapshots are clamped to valid whole days", () => {
  assert.equal(normalizeReturnWindowDays(14), 14);
  assert.equal(normalizeReturnWindowDays(-2), 0);
  assert.equal(normalizeReturnWindowDays(500), 365);
  assert.equal(normalizeReturnWindowDays("invalid"), DEFAULT_RETURN_WINDOW_DAYS);
});

test("return deadline uses the same inclusive boundary for saved orders", () => {
  const createdAt = "2026-09-01T00:00:00.000Z";
  const order = { createdAt, returnWindowDays: 10 };
  assert.equal(isReturnWindowOpen(order, Date.parse(createdAt) + 10 * 86400000), true);
  assert.equal(isReturnWindowOpen(order, Date.parse(createdAt) + 10 * 86400000 + 1), false);
});

test("historical orders without a snapshot retain the seven-day customer policy", () => {
  const createdAt = "2026-09-01T00:00:00.000Z";
  assert.equal(isReturnWindowOpen({ createdAt }, Date.parse(createdAt) + 7 * 86400000), true);
  assert.equal(isReturnWindowOpen({ createdAt }, Date.parse(createdAt) + 7 * 86400000 + 1), false);
  assert.equal(isReturnWindowOpen({ createdAt: "invalid" }), false);
});