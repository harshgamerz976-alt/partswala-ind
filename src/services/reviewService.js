import { auth } from "../firebase";
import { BACKEND_API_URL } from "./backendApiUrl.js";
import { parseProductReviewsResponse } from "./productReviews.js";

export async function getProductReviews(productId) {
  let response;
  try {
    response = await fetch(`${BACKEND_API_URL}/api/reviews?productId=${encodeURIComponent(productId)}`, { cache: "no-store" });
  } catch (error) {
    throw new Error(`Product reviews request failed: ${error?.message || "Network error."}`);
  }
  return parseProductReviewsResponse(response);
}

export async function addReview(productId, rating, text) {
  const user = auth.currentUser;
  if (!user) throw new Error("Login required");
  const token = await user.getIdToken();
  const response = await fetch(`${BACKEND_API_URL}/api/reviews`, {
    method: "POST",
    cache: "no-store",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ productId, rating, text }),
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result.message || "Review could not be submitted.");
}