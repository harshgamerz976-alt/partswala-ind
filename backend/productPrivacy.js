export const VENDOR_PRIVATE_PRODUCT_FIELDS = Object.freeze([
  "vendorAddress",
  "vendorGstin",
  "vendorState",
]);

const PUBLIC_PRODUCT_FIELDS = Object.freeze([
  "name",
  "title",
  "partNumber",
  "brand",
  "category",
  "description",
  "price",
  "mrp",
  "stock",
  "imageUrl",
  "images",
  "compatibility",
  "vehicleMake",
  "vehicleModel",
  "vehicleYear",
  "weight",
  "dimensions",
  "sellerType",
  "sellerId",
  "vendorBusinessName",
  "enabled",
  "status",
  "createdAt",
  "updatedAt",
]);

export function sanitizePublicProduct(product) {
  const sanitized = { ...product };
  for (const field of VENDOR_PRIVATE_PRODUCT_FIELDS) delete sanitized[field];
  return sanitized;
}

export function serializePublicProduct(product) {
  const result = { id: product.id };
  for (const field of PUBLIC_PRODUCT_FIELDS) {
    if (!Object.hasOwn(product, field)) continue;
    if (field === "images") {
      result.images = Array.isArray(product.images)
        ? product.images.filter((image) => typeof image === "string")
        : [];
    } else if (field === "dimensions") {
      const dimensions = product.dimensions;
      if (dimensions && typeof dimensions === "object" && !Array.isArray(dimensions)) {
        result.dimensions = Object.fromEntries(
          ["length", "width", "height"]
            .filter((key) => Object.hasOwn(dimensions, key))
            .map((key) => [key, dimensions[key]]),
        );
      }
    } else {
      result[field] = product[field];
    }
  }
  return result;
}

export function productUpdateWithoutPrivateFields(product, deleteFieldValue) {
  return {
    ...sanitizePublicProduct(product),
    ...Object.fromEntries(VENDOR_PRIVATE_PRODUCT_FIELDS.map((field) => [field, deleteFieldValue])),
  };
}
