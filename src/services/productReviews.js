export async function parseProductReviewsResponse(response) {
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result.message || "Product reviews could not be loaded.");
  if (!Array.isArray(result.reviews)) throw new Error("The product reviews response was invalid.");
  return result.reviews;
}
