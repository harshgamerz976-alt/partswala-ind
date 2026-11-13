import { normalizeProduct } from "../src/services/productCatalog.js";
import { publicProductCatalogIndexFields } from "./publicProductCatalogIndex.js";

const PRODUCT_ID_FIELDS = ["sellerId", "vendorId", "vendorID", "seller.id", "vendor.id"];
const MAX_BATCH_WRITES = 20;
const MAX_REFRESH_ATTEMPTS = 3;
const RETRYABLE_CODES = new Set([
  "2",
  "4",
  "8",
  "10",
  "13",
  "14",
  "aborted",
  "deadline-exceeded",
  "internal",
  "resource-exhausted",
  "unavailable",
  "unknown",
]);

function isRetryable(error) {
  return RETRYABLE_CODES.has(String(error?.code || "").toLowerCase().replace(/^firestore\//, ""));
}

function waitBeforeRetry(attempt) {
  return new Promise((resolve) => setTimeout(resolve, 25 * (2 ** attempt)));
}

async function refreshOnce(database, vendorId, vendor) {
  const productsById = new Map();
  for (const field of PRODUCT_ID_FIELDS) {
    const snapshot = await database.collection("products").where(field, "==", vendorId).get();
    for (const product of snapshot.docs) productsById.set(product.id, product);
  }

  let batch = database.batch();
  let batchWrites = 0;
  let refreshed = 0;
  for (const product of productsById.values()) {
    const data = product.data();
    const normalized = normalizeProduct({ id: product.id, ...data });
    if (normalized.sellerType.toLowerCase() !== "vendor" || normalized.sellerId !== vendorId) continue;
    const fields = publicProductCatalogIndexFields(product.id, data, vendor);
    batch.update(product.ref, {
      catalogSearchNgrams: fields.catalogSearchNgrams,
      catalogVendorBusinessName: fields.catalogVendorBusinessName,
    });
    batchWrites += 1;
    refreshed += 1;
    if (batchWrites === MAX_BATCH_WRITES) {
      await batch.commit();
      batch = database.batch();
      batchWrites = 0;
    }
  }
  if (batchWrites) await batch.commit();
  return refreshed;
}

export async function refreshVendorProductSearchIndex(database, vendorId, vendor) {
  for (let attempt = 0; attempt < MAX_REFRESH_ATTEMPTS; attempt += 1) {
    try {
      return await refreshOnce(database, vendorId, vendor);
    } catch (error) {
      if (!isRetryable(error)) throw error;
      if (attempt === MAX_REFRESH_ATTEMPTS - 1) {
        const exhaustedError = new Error(
          `Vendor product search-index refresh failed after ${MAX_REFRESH_ATTEMPTS} attempts.`,
          { cause: error },
        );
        exhaustedError.code = "VENDOR_PRODUCT_SEARCH_INDEX_REFRESH_FAILED";
        exhaustedError.attempts = MAX_REFRESH_ATTEMPTS;
        throw exhaustedError;
      }
      await waitBeforeRetry(attempt);
    }
  }
  throw new Error("Vendor product search-index refresh stopped unexpectedly.");
}

export function isCompletedVendorApplicationDecision(status, application, vendor) {
  return application?.status === status
    && vendor?.vendorStatus === status
    && (status !== "approved" || vendor.role === "vendor");
}
