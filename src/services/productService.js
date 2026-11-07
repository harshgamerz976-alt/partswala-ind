import { BACKEND_API_URL } from "./backendApiUrl";

const API_URL = BACKEND_API_URL;
const MAX_PAGE_SIZE = 100;

async function requestPublicCatalog(path, { allowNotFound = false } = {}) {
  let response;
  try {
    response = await fetch(`${API_URL}${path}`, { cache: "no-store" });
  } catch (error) {
    throw new Error(`Product catalogue request failed: ${error?.message || "Network error."}`);
  }

  if (allowNotFound && response.status === 404) return null;
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result.message || "Product catalogue data could not be loaded.");
  return result;
}

function cursorId(cursor) {
  if (typeof cursor === "string") return cursor;
  if (cursor && typeof cursor.id === "string") return cursor.id;
  return "";
}

function validatePage(result, previousCursor) {
  if (!result || !Array.isArray(result.products) || typeof result.hasMore !== "boolean") {
    throw new Error("The product catalogue returned an invalid page.");
  }
  for (const product of result.products) {
    if (!product || typeof product !== "object" || typeof product.id !== "string" || !product.id) {
      throw new Error("The product catalogue returned an invalid product.");
    }
  }
  if (result.hasMore && (typeof result.scanCursor !== "string" || !result.scanCursor || result.scanCursor === previousCursor)) {
    throw new Error("The product catalogue returned an invalid pagination cursor.");
  }
}

async function getCatalogPage(cursor = null, pageSize = 50, category = "") {
  const safePageSize = Number.isInteger(pageSize) ? Math.min(MAX_PAGE_SIZE, Math.max(1, pageSize)) : 50;
  const products = [];
  let scanCursor = cursorId(cursor);
  let continuationCursor = scanCursor;
  let hasMore = false;

  while (products.length <= safePageSize) {
    const query = new URLSearchParams({ limit: String(safePageSize) });
    if (scanCursor) query.set("after", scanCursor);
    if (category) query.set("category", category);
    const result = await requestPublicCatalog(`/api/public-products?${query}`);
    validatePage(result, scanCursor);

    for (const product of result.products) {
      if (products.length === safePageSize) {
        hasMore = true;
        break;
      }
      products.push(product);
      continuationCursor = product.id;
    }
    if (hasMore || !result.hasMore) break;
    scanCursor = result.scanCursor;
  }

  return {
    products,
    cursor: hasMore ? continuationCursor : null,
    hasMore,
  };
}

export async function getProductsPage(cursor = null, pageSize = 50) {
  return getCatalogPage(cursor, pageSize);
}

export async function getProductById(productId) {
  if (typeof productId !== "string" || !productId.trim()) return null;
  const result = await requestPublicCatalog(`/api/public-products/${encodeURIComponent(productId.trim())}`, { allowNotFound: true });
  if (result === null) return null;
  if (!result.product || typeof result.product !== "object" || typeof result.product.id !== "string") {
    throw new Error("The product catalogue returned an invalid product.");
  }
  return result.product;
}

export async function getPublicVendorWhatsAppNumber(productId) {
  if (typeof productId !== "string" || !productId.trim()) return null;
  const path = `/api/products/${encodeURIComponent(productId.trim())}/vendor-contact`;
  let response;
  try {
    response = await fetch(`${API_URL}${path}`, { cache: "no-store" });
  } catch (error) {
    throw new Error(`Supplier contact request failed: ${error?.message || "Network error."}`);
  }
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result.message || "Supplier contact information is unavailable.");
  if (result.whatsAppNumber === null || result.whatsAppNumber === "") return null;
  if (typeof result.whatsAppNumber !== "string" || !/^\d{8,15}$/.test(result.whatsAppNumber)) {
    throw new Error("The supplier contact response was invalid.");
  }
  return result.whatsAppNumber;
}

export async function getRelatedProducts(category, productId) {
  if (typeof category !== "string" || !category.trim()) return [];
  const page = await getCatalogPage(null, 6, category.trim());
  return page.products.filter((product) => product.id !== productId).slice(0, 4);
}