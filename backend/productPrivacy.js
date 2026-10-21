const PUBLIC_PRODUCT_FIELDS = new Set([
  "id",
  "name",
  "title",
  "description",
  "partNumber",
  "category",
  "brand",
  "price",
  "mrp",
  "priceIncludesGst",
  "stock",
  "stockCount",
  "imageUrl",
  "images",
  "icon",
  "badge",
  "tags",
  "compatibility",
  "weight",
  "dimensions",
  "createdAt",
  "sellerType",
  "vendorBusinessName",
]);

export function sanitizePublicProduct(product) {
  const sanitized = Object.fromEntries(Object.entries(product).filter(([field]) => PUBLIC_PRODUCT_FIELDS.has(field)));
  if (Array.isArray(sanitized.images)) {
    sanitized.images = sanitized.images.filter((image) => typeof image === "string").slice(0, 10);
  }
  if (Array.isArray(sanitized.tags)) {
    sanitized.tags = sanitized.tags.filter((tag) => typeof tag === "string").slice(0, 30);
  }
  if (Array.isArray(sanitized.compatibility)) {
    sanitized.compatibility = sanitized.compatibility.filter((item) => typeof item === "string").slice(0, 50);
  }
  if (sanitized.dimensions && typeof sanitized.dimensions === "object" && !Array.isArray(sanitized.dimensions)) {
    sanitized.dimensions = Object.fromEntries(
      ["length", "width", "height"]
        .filter((dimension) => ["string", "number"].includes(typeof sanitized.dimensions[dimension]))
        .map((dimension) => [dimension, sanitized.dimensions[dimension]]),
    );
  } else {
    delete sanitized.dimensions;
  }
  return sanitized;
}
