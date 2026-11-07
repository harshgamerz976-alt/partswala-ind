import assert from "node:assert/strict";
import test from "node:test";
import { parseProductReviewsResponse } from "./productReviews.js";

test("product review responses validate the list and surface HTTP errors", async () => {
  assert.deepEqual(await parseProductReviewsResponse({
    ok: true,
    json: async () => ({ reviews: [{ id: "review-1", rating: 5 }] }),
  }), [{ id: "review-1", rating: 5 }]);
  await assert.rejects(parseProductReviewsResponse({
    ok: false,
    json: async () => ({ message: "Marketplace not open." }),
  }), /Marketplace not open/);
  await assert.rejects(parseProductReviewsResponse({
    ok: true,
    json: async () => ({ reviews: "not-an-array" }),
  }), /response was invalid/);
});
