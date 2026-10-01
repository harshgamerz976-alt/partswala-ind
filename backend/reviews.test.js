import test from "node:test";
import assert from "node:assert/strict";
import { isDeliveredPurchaseFor, publicReview, validateReviewInput } from "./reviews.js";

test("review input accepts only integer ratings and bounded plain text", () => {
  assert.deepEqual(validateReviewInput({ productId: "part-1", rating: "5", text: " Fits the truck well. " }), {
    productId: "part-1",
    rating: 5,
    text: "Fits the truck well.",
  });
  for (const rating of [0, 6, 2.5, "five"]) {
    assert.throws(() => validateReviewInput({ productId: "part-1", rating, text: "A review" }));
  }
  assert.throws(() => validateReviewInput({ productId: "part-1", rating: 5, text: "" }));
  assert.throws(() => validateReviewInput({ productId: "part-1", rating: 5, text: "x".repeat(1201) }));
  assert.throws(() => validateReviewInput({ productId: "part-1", rating: 5, text: "bad\u0000text" }));
});
test("a review requires a matching paid and delivered customer order", () => {
  const order = {
    userId: "customer-1",
    status: "delivered",
    paymentStatus: "Paid",
    items: [{ productId: "part-1", quantity: 1 }],
  };
  assert.equal(isDeliveredPurchaseFor(order, "customer-1", "part-1"), true);
  assert.equal(isDeliveredPurchaseFor(order, "someone-else", "part-1"), false);
  assert.equal(isDeliveredPurchaseFor({ ...order, status: "confirmed" }, "customer-1", "part-1"), false);
  assert.equal(isDeliveredPurchaseFor({ ...order, paymentStatus: "Pending" }, "customer-1", "part-1"), false);
  assert.equal(isDeliveredPurchaseFor(order, "customer-1", "part-2"), false);
});

test("public review projection never returns legacy email, identity, or arbitrary fields", () => {
  assert.deepEqual(publicReview({
    productId: "part-1",
    userId: "private-user-id",
    userEmail: "private@example.com",
    userName: "Buyer",
    rating: 5,
    comment: "Good part",
    otp: "123456",
    createdAt: "2026-09-29T00:00:00.000Z",
  }, "review-1"), {
    id: "review-1",
    productId: "part-1",
    userName: "Buyer",
    rating: 5,
    text: "Good part",
    createdAt: "2026-09-29T00:00:00.000Z",
    verifiedPurchase: false,
  });
});