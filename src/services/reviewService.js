import { auth } from "../firebase";

const API_URL = (import.meta.env.VITE_API_URL || import.meta.env.VITE_BACKEND_API_URL || "http://localhost:8787").replace(/\/$/, "");

export async function getProductReviews(productId) {
  try {
    const response = await fetch(`${API_URL}/api/reviews?productId=${encodeURIComponent(productId)}`);
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result.message || "Review query failed.");
    return Array.isArray(result.reviews) ? result.reviews : [];
  } catch (err) {
    console.error("Reviews query failed (may need Firestore index):", err.message);
    return [];
  }
}

export async function addReview(productId, rating, text) {
  const user = auth.currentUser;
  if (!user) throw new Error("Login required");
  const token = await user.getIdToken();
  const response = await fetch(`${API_URL}/api/reviews`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ productId, rating, text }),
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result.message || "Review could not be submitted.");
}