import test from "node:test";
import assert from "node:assert/strict";
import { normalizeFinanceDateRange } from "./financeDateRange.js";

test("finance date range defaults to the current UTC calendar year", () => {
  assert.deepEqual(normalizeFinanceDateRange({}, new Date("2026-09-29T12:00:00.000Z")), {
    startDate: "2026-01-01",
    endDate: "2026-09-29",
    startAt: "2026-01-01T00:00:00.000Z",
    endAt: "2026-09-29T23:59:59.999Z",
  });
});

test("finance date range rejects invalid, impossible, and reversed dates", () => {
  assert.throws(() => normalizeFinanceDateRange({ startDate: "2026-02-30", endDate: "2026-03-01" }));
  assert.throws(() => normalizeFinanceDateRange({ startDate: "2026-04-01", endDate: "2026-03-01" }));
});