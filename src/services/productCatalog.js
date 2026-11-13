const excludedStatuses = new Set([
  "draft",
  "deleted",
  "disabled",
  "inactive",
  "pending",
  "pending review",
  "pending_review",
  "pending approval",
  "pending_approval",
  "rejected",
  "archived",
  "unpublished",
  "blocked",
  "submitted",
]);

export const DEFAULT_CATALOG_FILTERS = Object.freeze({
  search: "",
  category: "",
  compatibility: "",
  brand: "",
  vehicleMake: "",
  vehicleModel: "",
  minPrice: "",
  maxPrice: "",
  minDiscount: "",
  stockStatus: "all",
  sortBy: "newest",
});

const allowedSorts = new Set(["newest", "oldest", "price-low", "price-high", "discount"]);
const allowedStockStatuses = new Set(["all", "in-stock", "out-of-stock", "unknown"]);
const filterKeys = Object.keys(DEFAULT_CATALOG_FILTERS);

function readText(value) {
  return typeof value === "string" || typeof value === "number" ? String(value).trim() : "";
}

function readNumber(value) {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value !== "string" || !value.trim()) return null;
  const normalized = value.trim();
  if (!/^-?\d+(?:\.\d+)?$/.test(normalized)) return null;
  const number = Number(normalized);
  return Number.isFinite(number) ? number : null;
}

function readDate(value) {
  if (!value) return 0;
  if (value instanceof Date) return Number.isFinite(value.getTime()) ? value.getTime() : 0;
  if (typeof value?.toDate === "function") {
    const date = value.toDate();
    return date instanceof Date && Number.isFinite(date.getTime()) ? date.getTime() : 0;
  }
  if (typeof value === "object" && Number.isFinite(value.seconds)) return value.seconds * 1000;
  if (typeof value === "object" && Number.isFinite(value._seconds)) return value._seconds * 1000;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.getTime() : 0;
}

function compatibilityText(value) {
  if (typeof value === "string") return value.trim();
  if (Array.isArray(value)) return value.filter((item) => typeof item === "string").map((item) => item.trim()).filter(Boolean).join(", ");
  if (!value || typeof value !== "object") return "";
  return ["vehicleMake", "vehicleModel", "vehicleYear", "make", "model", "year"]
    .map((key) => readText(value[key]))
    .filter(Boolean)
    .join(", ");
}

export function normalizeProduct(product = {}) {
  const raw = product && typeof product === "object" && !Array.isArray(product) ? product : {};
  const name = readText(raw.name || raw.title);
  const title = readText(raw.title || raw.name);
  const price = readNumber(raw.price);
  const listedMrp = readNumber(raw.mrp);
  const mrp = listedMrp !== null && listedMrp > 0 ? listedMrp : null;
  const rawStock = readNumber(raw.stock) ?? readNumber(raw.stockCount);
  const stock = rawStock !== null && Number.isInteger(rawStock) && rawStock >= 0 ? rawStock : null;
  const compatibility = compatibilityText(raw.compatibility ?? raw.compatibleWith);
  const compatibilityRecord = raw.compatibility && typeof raw.compatibility === "object" && !Array.isArray(raw.compatibility)
    ? raw.compatibility
    : {};
  const images = Array.isArray(raw.images) ? raw.images.filter((image) => typeof image === "string" && image.trim()) : [];
  const imageUrl = readText(raw.imageUrl) || images[0] || "";
  const status = (readText(raw.status) || readText(raw.publishStatus) || readText(raw.approvalStatus)).toLowerCase();
  const vehicleMake = readText(raw.vehicleMake || raw.make || compatibilityRecord.vehicleMake || compatibilityRecord.make);
  const vehicleModel = readText(raw.vehicleModel || raw.model || compatibilityRecord.vehicleModel || compatibilityRecord.model);
  const vehicleYear = readText(raw.vehicleYear || raw.year || compatibilityRecord.vehicleYear || compatibilityRecord.year);
  const vendorBusinessName = readText(
    raw.vendorBusinessName
    || raw.vendorName
    || raw.sellerName
    || raw.businessName
    || raw.vendorProfile?.businessName
    || raw.vendorProfile?.name
    || raw.sellerProfile?.businessName
    || raw.sellerProfile?.name
    || raw.vendor?.businessName
    || raw.vendor?.name
    || raw.seller?.name
  );
  const enabledValue = typeof raw.enabled === "string" ? raw.enabled.trim().toLowerCase() : raw.enabled;
  const sellerId = readText(raw.sellerId || raw.vendorId || raw.vendorID || raw.seller?.id || raw.vendor?.id);
  const sellerType = readText(raw.sellerType || raw.vendorType || raw.seller?.type || raw.vendor?.type || "");
  const normalized = {
    ...raw,
    id: readText(raw.id || raw._id),
    name,
    title,
    brand: readText(raw.brand),
    category: readText(raw.category),
    partNumber: readText(raw.partNumber || raw.sku),
    imageUrl,
    images,
    price,
    mrp,
    stock,
    vehicleMake,
    vehicleModel,
    vehicleYear,
    compatibility,
    sellerId,
    sellerType,
    vendorBusinessName,
    vendorName: vendorBusinessName,
    soldBy: vendorBusinessName || (sellerType.toLowerCase() === "vendor" ? "Vendor" : "PARTSWALA IND"),
    enabled: enabledValue !== false && enabledValue !== "false" && enabledValue !== "0" && enabledValue !== 0,
    status,
    discountPercent: price !== null && mrp !== null && price > 0 && mrp > price
      ? ((mrp - price) / mrp) * 100
      : 0,
    updatedAt: raw.updatedAt ?? raw.createdAt ?? null,
    featuredRank: readNumber(raw.featuredRank ?? raw.popularityScore ?? raw.rank) ?? 0,
  };
  normalized.searchText = [
    normalized.name,
    normalized.title,
    normalized.brand,
    normalized.partNumber,
    normalized.category,
    normalized.vendorBusinessName,
    normalized.vehicleMake,
    normalized.vehicleModel,
    normalized.vehicleYear,
    normalized.compatibility,
    readText(raw.description),
  ].filter(Boolean).join(" ").toLowerCase();
  return normalized;
}

export function isEligibleProduct(product = {}) {
  const normalized = normalizeProduct(product);
  if (!normalized.enabled || rawIsUnpublished(product)) return false;
  return Boolean(normalized.id && normalized.name && normalized.price !== null && normalized.price > 0);
}

function rawIsUnpublished(product) {
  return ["status", "publishStatus", "approvalStatus"].some((field) => {
    const value = product?.[field];
    if (value === undefined || value === null) return false;
    if (typeof value !== "string") return true;
    return excludedStatuses.has(value.trim().toLowerCase());
  })
    || product?.published === false
    || product?.isPublished === false
    || product?.deleted === true
    || product?.isDeleted === true;
}

function numericFilter(value, minimum, maximum = Number.POSITIVE_INFINITY) {
  if (value === "" || value === null || value === undefined) return null;
  const parsed = readNumber(String(value));
  return parsed !== null && parsed >= minimum && parsed <= maximum ? parsed : null;
}

export function normalizeCatalogFilters(filters = {}) {
  const next = { ...DEFAULT_CATALOG_FILTERS };
  for (const key of ["search", "category", "compatibility", "brand", "vehicleMake", "vehicleModel"]) {
    next[key] = readText(filters[key]).slice(0, 120);
  }
  next.minPrice = numericFilter(filters.minPrice, 0)?.toString() || "";
  next.maxPrice = numericFilter(filters.maxPrice, 0)?.toString() || "";
  next.minDiscount = numericFilter(filters.minDiscount, 0, 100)?.toString() || "";
  next.stockStatus = allowedStockStatuses.has(filters.stockStatus) ? filters.stockStatus : "all";
  next.sortBy = allowedSorts.has(filters.sortBy) ? filters.sortBy : "newest";
  const minimum = next.minPrice === "" ? null : Number(next.minPrice);
  const maximum = next.maxPrice === "" ? null : Number(next.maxPrice);
  if (minimum !== null && maximum !== null && minimum > maximum) {
    next.minPrice = "";
    next.maxPrice = "";
  }
  if (!next.vehicleMake) next.vehicleModel = "";
  return next;
}

export function validateCatalogFilterInput(filters = {}) {
  const minPriceText = filters.minPrice ?? "";
  const maxPriceText = filters.maxPrice ?? "";
  const minDiscountText = filters.minDiscount ?? "";
  const minPrice = minPriceText === "" ? null : readNumber(String(minPriceText));
  const maxPrice = maxPriceText === "" ? null : readNumber(String(maxPriceText));
  const minDiscount = minDiscountText === "" ? null : readNumber(String(minDiscountText));
  if (minPriceText !== "" && (minPrice === null || minPrice < 0)) return "Enter a valid minimum price.";
  if (maxPriceText !== "" && (maxPrice === null || maxPrice < 0)) return "Enter a valid maximum price.";
  if (minPrice !== null && maxPrice !== null && minPrice > maxPrice) return "Minimum price cannot exceed maximum price.";
  if (minDiscountText !== "" && (minDiscount === null || minDiscount < 0 || minDiscount > 100)) return "Minimum discount must be between 0 and 100.";
  return "";
}

export function parseCatalogFilters(searchParams) {
  const params = searchParams instanceof URLSearchParams ? searchParams : new URLSearchParams(String(searchParams || "").replace(/^\?/, ""));
  const filters = Object.fromEntries(filterKeys.map((key) => [key, params.get(key) || ""]));
  filters.stockStatus = params.get("stockStatus") || "all";
  filters.sortBy = params.get("sortBy") || "newest";
  return normalizeCatalogFilters(filters);
}

export function serializeCatalogFilters(filters) {
  const normalized = normalizeCatalogFilters(filters);
  const params = new URLSearchParams();
  for (const key of filterKeys) {
    const value = normalized[key];
    if (value && value !== DEFAULT_CATALOG_FILTERS[key]) params.set(key, value);
  }
  return params.toString();
}

function sortProducts(products, sortBy) {
  return [...products].sort((left, right) => {
    if (sortBy === "price-low") return (left.price ?? Number.POSITIVE_INFINITY) - (right.price ?? Number.POSITIVE_INFINITY);
    if (sortBy === "price-high") return (right.price ?? Number.NEGATIVE_INFINITY) - (left.price ?? Number.NEGATIVE_INFINITY);
    if (sortBy === "discount") return right.discountPercent - left.discountPercent;
    const dateDifference = readDate(right.updatedAt) - readDate(left.updatedAt);
    return sortBy === "oldest" ? -dateDifference : dateDifference;
  });
}

export function filterProducts(products, filters = {}) {
  const normalizedFilters = normalizeCatalogFilters(filters);
  const searchTerm = normalizedFilters.search.toLowerCase();
  const minimum = normalizedFilters.minPrice === "" ? null : Number(normalizedFilters.minPrice);
  const maximum = normalizedFilters.maxPrice === "" ? null : Number(normalizedFilters.maxPrice);
  const minimumDiscount = normalizedFilters.minDiscount === "" ? null : Number(normalizedFilters.minDiscount);
  const matches = products.map(normalizeProduct).filter((product) => {
    if (!isEligibleProduct(product)) return false;
    if (searchTerm && !product.searchText.includes(searchTerm)) return false;
    if (normalizedFilters.category && product.category.toLowerCase() !== normalizedFilters.category.toLowerCase()) return false;
    if (normalizedFilters.compatibility && !product.compatibility.toLowerCase().includes(normalizedFilters.compatibility.toLowerCase())) return false;
    if (normalizedFilters.brand && product.brand.toLowerCase() !== normalizedFilters.brand.toLowerCase()) return false;
    if (normalizedFilters.vehicleMake && product.vehicleMake.toLowerCase() !== normalizedFilters.vehicleMake.toLowerCase()) return false;
    if (normalizedFilters.vehicleModel && product.vehicleModel.toLowerCase() !== normalizedFilters.vehicleModel.toLowerCase()) return false;
    if (minimum !== null && (product.price === null || product.price < minimum)) return false;
    if (maximum !== null && (product.price === null || product.price > maximum)) return false;
    if (minimumDiscount !== null && product.discountPercent < minimumDiscount) return false;
    if (normalizedFilters.stockStatus === "in-stock" && (product.stock === null || product.stock <= 0)) return false;
    if (normalizedFilters.stockStatus === "out-of-stock" && product.stock !== 0) return false;
    if (normalizedFilters.stockStatus === "unknown" && product.stock !== null) return false;
    return true;
  });
  return sortProducts(matches, normalizedFilters.sortBy);
}

export function buildCatalogPage(documents, pageSize, filters = {}) {
  const safePageSize = Number.isInteger(pageSize) ? Math.min(100, Math.max(1, pageSize)) : 20;
  const pageDocuments = documents.slice(0, safePageSize);
  const products = pageDocuments
    .map((document) => normalizeProduct({ id: document.id, ...document.data() }))
    .filter(isEligibleProduct);
  return {
    products: filterProducts(products, filters),
    cursor: documents.length > safePageSize ? pageDocuments.at(-1) || null : null,
    hasMore: documents.length > safePageSize,
  };
}

export function normalizeFeaturedLimit(limitCount = 6) {
  const requestedLimit = Number(limitCount);
  return Number.isFinite(requestedLimit) ? Math.min(6, Math.max(0, Math.floor(requestedLimit))) : 6;
}

export function buildFeaturedProductList(documents, limitCount = 6) {
  const cappedLimit = normalizeFeaturedLimit(limitCount);
  if (cappedLimit === 0) return [];
  return documents
    .map((document) => normalizeProduct({ id: document.id, ...document.data() }))
    .filter(isEligibleProduct)
    .slice(0, cappedLimit);
}
