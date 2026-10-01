export const RETURN_STATUS_TRANSITIONS = Object.freeze({
  submitted: ["under_review", "rejected"],
  under_review: ["pickup_pending", "rejected", "closed"],
  pickup_pending: ["received", "rejected"],
  received: ["approved", "rejected", "closed"],
  approved: ["closed"],
  rejected: [],
  closed: [],
});

export const RETURN_CONDITIONS = new Set([
  "RESELLABLE",
  "DAMAGED",
  "USED/INSTALLED",
  "WRONG_PART",
  "MISSING_PARTS",
  "TAMPERED",
  "OTHER",
]);

export function validateReturnInspection(returnItems, inspections) {
  if (!Array.isArray(inspections) || inspections.length !== returnItems.length) throw new Error("Inspect every returned product before approving the return.");
  const expectedByProduct = new Map(returnItems.map((item) => [String(item.productId), Number(item.quantity)]));
  const inspected = new Set();
  return inspections.map((entry) => {
    const productId = String(entry?.productId || "").trim();
    const quantity = Number(entry?.quantity);
    const condition = String(entry?.condition || "").trim().toUpperCase();
    if (!expectedByProduct.has(productId) || inspected.has(productId) || quantity !== expectedByProduct.get(productId) || !RETURN_CONDITIONS.has(condition)) {
      throw new Error("Return inspection must match each returned product, quantity, and supported condition.");
    }
    inspected.add(productId);
    const inspectionPhotos = Array.isArray(entry.photos) ? entry.photos.map(String) : [];
    if (inspectionPhotos.length > 8 || inspectionPhotos.some((photo) => {
      try {
        const url = new URL(photo);
        return url.protocol !== "https:" || url.hostname !== "res.cloudinary.com";
      } catch {
        return true;
      }
    })) throw new Error("Inspection photos must be secure Cloudinary image URLs.");
    return {
      productId,
      quantity,
      condition,
      notes: String(entry.notes || "").trim().slice(0, 1000),
      expectedCondition: String(entry.expectedCondition || "").trim().slice(0, 120),
      receivedCondition: String(entry.receivedCondition || condition).trim().slice(0, 120),
      expectedPartNumber: String(entry.expectedPartNumber || "").trim().slice(0, 120),
      receivedPartNumber: String(entry.receivedPartNumber || "").trim().slice(0, 120),
      photos: inspectionPhotos,
    };
  });
}

export function canTransitionReturnStatus(currentStatus, nextStatus) {
  return (RETURN_STATUS_TRANSITIONS[String(currentStatus || "").toLowerCase()] || []).includes(String(nextStatus || "").toLowerCase());
}
