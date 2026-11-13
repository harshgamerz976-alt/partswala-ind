import { filterProducts, isEligibleProduct, normalizeFeaturedLimit, normalizeProduct } from "./productCatalog";

export { filterProducts, isEligibleProduct, normalizeProduct } from "./productCatalog";

const API_URL = (import.meta.env.VITE_API_URL || import.meta.env.VITE_BACKEND_API_URL || "http://localhost:8787").replace(/\/$/, "");
const LEGACY_CURSOR_PREFIX = "after:";

async function publicCatalogRequest(path, options = {}, signal, allowNotFound = false) {
  let response;
  try {
    response = await fetch(`${API_URL}${path}`, { ...options, signal });
  } catch (error) {
    if (signal?.aborted) throw error;
    throw new Error(`Product catalogue request failed: ${error?.message || "Network error."}`);
  }
  if (allowNotFound && response.status === 404) return null;
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result.message || "Product catalogue data could not be loaded.");
  return result;
}

function catalogPageUrl(cursor, pageSize, filters) {
  const params = new URLSearchParams();
  params.set("limit", String(pageSize));
  if (typeof cursor === "string" && cursor) {
    if (cursor.startsWith(LEGACY_CURSOR_PREFIX)) params.set("after", cursor.slice(LEGACY_CURSOR_PREFIX.length));
    else params.set("cursor", cursor);
  }
  for (const [key, value] of Object.entries(filters)) {
    if (!value || key === "sortBy") continue;
    params.set(key, value);
  }
  return `/api/public-products?${params}`;
}

export async function getProductsPage(cursor = null, pageSize = 20, filters = {}, { signal } = {}) {
  const safePageSize = Number.isInteger(pageSize) ? Math.min(100, Math.max(1, pageSize)) : 20;
  const result = await publicCatalogRequest(catalogPageUrl(cursor, safePageSize, filters), {}, signal);
  if (signal?.aborted) throw new DOMException("The catalogue request was aborted.", "AbortError");
  const nextCursor = typeof result.nextCursor === "string" && result.nextCursor
    ? result.nextCursor
    : typeof result.scanCursor === "string" && result.scanCursor
      ? `${LEGACY_CURSOR_PREFIX}${result.scanCursor}`
      : null;
  if (!Array.isArray(result.products) || typeof result.hasMore !== "boolean"
    || (result.hasMore && !nextCursor)) {
    throw new Error("The product catalogue returned an invalid page.");
  }
  const products = result.products.map(normalizeProduct).filter(isEligibleProduct);
  return {
    products: filterProducts(products, filters),
    cursor: result.hasMore ? nextCursor : null,
    hasMore: result.hasMore,
  };
}

export async function getFeaturedProducts(limitCount = 6) {
  const cappedLimit = normalizeFeaturedLimit(limitCount);
  if (cappedLimit === 0) return [];
  const page = await getProductsPage(null, cappedLimit, {});
  return filterProducts(page.products, { sortBy: "newest" }).slice(0, cappedLimit);
}

export async function getProductById(productId) {
  const result = await publicCatalogRequest(`/api/public-products/${encodeURIComponent(productId)}`, {}, undefined, true);
  if (!result?.product) return null;
  const product = normalizeProduct(result.product);
  return isEligibleProduct(product) ? product : null;
}

export async function getProductsByIds(productIds) {
  const ids = [...new Set((Array.isArray(productIds) ? productIds : [])
    .filter((id) => typeof id === "string" && id.trim())
    .map((id) => id.trim()))].slice(0, 100);
  if (!ids.length) return [];
  const result = await publicCatalogRequest("/api/public-products/by-ids", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ productIds: ids }),
  });
  if (!Array.isArray(result?.products)) throw new Error("The requested products could not be loaded.");
  const productsById = new Map(result.products
    .map(normalizeProduct)
    .filter(isEligibleProduct)
    .map((product) => [product.id, product]));
  return ids.map((id) => productsById.get(id)).filter(Boolean);
}

export async function getVendorWhatsAppNumber(productId) {
  return (await getVendorContact(productId)).whatsAppNumber;
}

export async function getVendorContact(productId) {
  const response = await fetch(`${API_URL}/api/products/${encodeURIComponent(productId)}/vendor-contact`);
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result.message || "Seller contact information is unavailable.");
  return {
    whatsAppNumber: result.whatsAppNumber || null,
    businessName: typeof result.businessName === "string" ? result.businessName : "",
    location: typeof result.location === "string" ? result.location : "",
  };
}

export async function getRelatedProducts(category, productId) {
  if (!category) return [];
  const page = await getProductsPage(null, 5, { category });
  return page.products.filter((product) => product.id !== productId).slice(0, 4);
}
