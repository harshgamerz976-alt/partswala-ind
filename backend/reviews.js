export function validateReviewInput(payload = {}) {
  const productId = String(payload.productId || "").trim();
  const rating = Number(payload.rating);
  const text = String(payload.text || "").trim();
  if (!productId || productId.length > 200) throw new Error("Choose a valid product to review.");
  if (!Number.isInteger(rating) || rating < 1 || rating > 5) throw new Error("Rating must be a whole number from 1 to 5.");
  const hasControlCharacter = [...text].some((character) => {
    const code = character.codePointAt(0);
    return code <= 8 || code === 11 || code === 12 || (code >= 14 && code <= 31) || code === 127;
  });
  if (!text || text.length > 1200 || hasControlCharacter) {
    throw new Error("Write a review of 1 to 1,200 characters using normal text.");
  }
  return { productId, rating, text };
}

export function isDeliveredPurchaseFor(order, userId, productId) {
  if (String(order?.userId || "") !== String(userId || "")) return false;
  const status = String(order.status || order.orderStatus || "").toLowerCase();
  if (!['delivered', 'completed'].includes(status)) return false;
  if (!['Paid', 'COD collected'].includes(String(order.paymentStatus || ""))) return false;
  return (order.items || []).some((item) => String(item.productId || "") === String(productId));
}

export function publicReview(review, id = "") {
  return {
    id,
    productId: String(review.productId || ""),
    userName: String(review.userName || "PARTSWALA customer").slice(0, 80),
    rating: Number(review.rating),
    text: String(review.text || review.comment || "").slice(0, 1200),
    createdAt: String(review.createdAt || ""),
    verifiedPurchase: review.verifiedPurchase === true,
  };
}