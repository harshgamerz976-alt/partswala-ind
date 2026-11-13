import { filterProducts, isEligibleProduct, normalizeProduct } from "../src/services/productCatalog.js";

const MAX_SEARCH_NGRAMS = 6000;

export function searchIndexNgrams(value) {
  const text = String(value || "").toLowerCase();
  const grams = new Set();
  for (let size = 1; size <= Math.min(3, text.length); size += 1) {
    for (let index = 0; index <= text.length - size; index += 1) {
      grams.add(text.slice(index, index + size));
      if (grams.size >= MAX_SEARCH_NGRAMS) return [...grams];
    }
  }
  return [...grams];
}

export function approvedVendorBusinessName(vendor) {
  if (vendor?.role !== "vendor" || vendor.vendorStatus !== "approved") return "";
  return typeof vendor.vendorProfile?.businessName === "string"
    ? vendor.vendorProfile.businessName.trim()
    : "";
}

export function resolveCatalogVendorBusinessName(product, vendor) {
  const rawProduct = product && typeof product === "object" && !Array.isArray(product) ? product : {};
  const normalized = normalizeProduct(rawProduct);
  if (normalized.sellerType.toLowerCase() !== "vendor") return "";
  if (vendor !== undefined) return approvedVendorBusinessName(vendor);
  return typeof rawProduct.catalogVendorBusinessName === "string"
    ? rawProduct.catalogVendorBusinessName.trim()
    : "";
}

export function publicProductCatalogIndexFields(productId, rawProduct = {}, vendor) {
  const product = normalizeProduct({ ...rawProduct, id: productId });
  const isVendor = product.sellerType.toLowerCase() === "vendor";
  const catalogVendorBusinessName = isVendor
    ? resolveCatalogVendorBusinessName(rawProduct, vendor)
    : "";
  const searchableFields = { ...rawProduct, id: productId };
  if (isVendor) {
    Object.assign(searchableFields, {
      vendorBusinessName: catalogVendorBusinessName,
      vendorName: catalogVendorBusinessName,
      sellerName: catalogVendorBusinessName,
      businessName: catalogVendorBusinessName,
      vendorProfile: {},
      sellerProfile: {},
      vendor: { id: product.sellerId, type: "vendor", name: catalogVendorBusinessName },
      seller: { id: product.sellerId, type: "vendor", name: catalogVendorBusinessName },
    });
  }
  const searchableProduct = normalizeProduct(searchableFields);
  return {
    catalogEligible: isEligibleProduct(product),
    catalogCategory: product.category.toLowerCase(),
    catalogAvailability: product.stock === null ? "unknown" : product.stock === 0 ? "out-of-stock" : "in-stock",
    catalogSearchNgrams: searchIndexNgrams(searchableProduct.searchText),
    catalogVendorBusinessName,
  };
}

export function publicProductCatalogIndexUpdate(productId, currentProduct, changes, vendor) {
  const updatedProduct = { ...currentProduct, ...changes };
  return {
    ...changes,
    ...publicProductCatalogIndexFields(productId, updatedProduct, vendor),
  };
}

export function matchesPublicCatalogFilters(product, filters) {
  return filterProducts([product], filters).length > 0;
}

export function searchCandidateNgram(search) {
  const text = String(search || "").toLowerCase();
  return text.slice(0, Math.min(3, text.length));
}

export function catalogCandidateSearch(filters) {
  return [filters.search, filters.compatibility]
    .filter(Boolean)
    .sort((left, right) => right.length - left.length)[0] || "";
}
