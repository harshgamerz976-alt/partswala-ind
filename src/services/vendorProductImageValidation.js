export const VENDOR_PRODUCT_IMAGE_MAX_BYTES = 5 * 1024 * 1024;

const supportedTypes = new Map([
  ["image/jpeg", ["jpg", "jpeg"]],
  ["image/png", ["png"]],
  ["image/webp", ["webp"]],
  ["image/avif", ["avif"]],
  ["image/heic", ["heic"]],
]);

export function validateVendorProductImageFile(file) {
  if (!file || typeof file.name !== "string" || !Number.isFinite(file.size) || file.size <= 0) {
    throw new Error("Choose a valid image file.");
  }
  const extensions = supportedTypes.get(String(file.type || "").toLowerCase());
  const extension = file.name.split(".").pop()?.toLowerCase() || "";
  if (!extensions || !extensions.includes(extension)) {
    throw new Error("Choose a supported JPG, PNG, WebP, AVIF, or HEIC image.");
  }
  if (file.size > VENDOR_PRODUCT_IMAGE_MAX_BYTES) {
    throw new Error("Images must be no larger than 5 MB.");
  }
}
