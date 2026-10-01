import assert from "node:assert/strict";
import test from "node:test";
import { calculateCouponApplication, normalizeCoupon } from "./coupons.js";

const items = [
  { productId: "a", category: "brakes", sellerId: "vendor-a", discountedValue: 8000 },
  { productId: "b", category: "engine", sellerId: "partswala", discountedValue: 2000 },
];

test("legacy percent coupon remains compatible", () => {
  const coupon = normalizeCoupon("old10", null, 0.1);
  const result = calculateCouponApplication({ coupon, items });
  assert.equal(result.discountAmount, 1000);
});

test("fixed coupon applies only to eligible products and respects maximum discount", () => {
  const coupon = normalizeCoupon("FIXED", { type: "fixed", value: 5000, maximumDiscount: 1000, eligibleCategories: ["brakes"] });
  const result = calculateCouponApplication({ coupon, items });
  assert.equal(result.discountAmount, 1000);
  assert.deepEqual(result.eligibleProductIds, ["a"]);
});

test("coupon validation rejects inactive, early, expired, minimum and usage-limit cases", () => {
  const now = new Date("2026-09-28T00:00:00Z");
  assert.throws(() => calculateCouponApplication({ coupon: normalizeCoupon("X", { active: false, type: "fixed", value: 10 }), items, now }), /invalid or inactive/);
  assert.throws(() => calculateCouponApplication({ coupon: normalizeCoupon("X", { type: "fixed", value: 10, startsAt: "2026-09-29" }), items, now }), /not active yet/);
  assert.throws(() => calculateCouponApplication({ coupon: normalizeCoupon("X", { type: "fixed", value: 10, expiresAt: "2026-09-27" }), items, now }), /expired/);
  assert.throws(() => calculateCouponApplication({ coupon: normalizeCoupon("X", { type: "fixed", value: 10, minimumOrderAmount: 20000 }), items, now }), /minimum amount/);
  assert.throws(() => calculateCouponApplication({ coupon: normalizeCoupon("X", { type: "fixed", value: 10, globalUsageLimit: 1 }), items, globalUsageCount: 1 }), /usage limit/);
  assert.throws(() => calculateCouponApplication({ coupon: normalizeCoupon("X", { type: "fixed", value: 10, perUserUsageLimit: 1 }), items, userUsageCount: 1 }), /maximum number of times/);
});

test("discount cannot exceed eligible order value", () => {
  const coupon = normalizeCoupon("TOOBIG", { type: "fixed", value: 20000 });
  assert.equal(calculateCouponApplication({ coupon, items }).discountAmount, 10000);
});