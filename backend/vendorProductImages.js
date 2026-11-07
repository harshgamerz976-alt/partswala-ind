import { CLOUDINARY_MAX_FILE_BYTES, signedCloudinaryUpload } from "./cloudinaryUploads.js";

export const VENDOR_PRODUCT_IMAGE_MAX_BYTES = 5 * 1024 * 1024;

const imageTypes = new Map([
  ["image/jpeg", "jpg"],
  ["image/png", "png"],
  ["image/webp", "webp"],
  ["image/avif", "avif"],
  ["image/heic", "heic"],
]);

export function validateCloudinaryImage(file, maxFileBytes = CLOUDINARY_MAX_FILE_BYTES) {
  if (!file || !Buffer.isBuffer(file.buffer) || file.size !== file.buffer.length || file.size <= 0) {
    throw new Error("Choose a valid image file.");
  }
  if (!Number.isSafeInteger(maxFileBytes) || maxFileBytes <= 0) {
    throw new Error("The image size limit is invalid.");
  }
  if (file.size > maxFileBytes) {
    const megabytes = Math.floor(maxFileBytes / (1024 * 1024));
    throw new Error(`Images must be no larger than ${megabytes} MB.`);
  }
  const expectedExtension = imageTypes.get(String(file.mimetype || "").toLowerCase());
  const extension = String(file.originalname || "").split(".").pop()?.toLowerCase() || "";
  if (!expectedExtension || (extension !== expectedExtension && !(expectedExtension === "jpg" && extension === "jpeg"))) {
    throw new Error("Choose a supported JPG, PNG, WebP, AVIF, or HEIC image.");
  }

  const bytes = file.buffer;
  const validSignature = expectedExtension === "jpg"
    ? bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff
    : expectedExtension === "png"
      ? bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
      : expectedExtension === "webp"
        ? bytes.length >= 12 && bytes.toString("ascii", 0, 4) === "RIFF" && bytes.toString("ascii", 8, 12) === "WEBP"
        : bytes.length >= 12 && bytes.toString("ascii", 4, 8) === "ftyp"
          && bytes.toString("ascii", 8, 12).startsWith(expectedExtension === "avif" ? "avi" : "hei");
  if (!validSignature) throw new Error("The image contents do not match the selected file type.");
  return { extension, maxFileBytes };
}

export function validateVendorProductImage(file) {
  return validateCloudinaryImage(file, VENDOR_PRODUCT_IMAGE_MAX_BYTES);
}

export function canUploadVendorProductImage(profile, user, product = undefined) {
  if (!user?.uid || user.isAdmin === true
    || profile?.role !== "vendor" || profile?.vendorStatus !== "approved") return false;
  if (product !== undefined && (!product || product.sellerId !== user.uid)) return false;
  return true;
}

export function isSecureCloudinaryProductImageUrl(value, cloudName) {
  try {
    const url = new URL(value);
    const expectedCloud = String(cloudName || "").trim();
    return url.protocol === "https:"
      && url.hostname === "res.cloudinary.com"
      && expectedCloud.length > 0
      && url.pathname.startsWith(`/${expectedCloud}/image/upload/`);
  } catch {
    return false;
  }
}

export async function uploadValidatedImageToCloudinary({
  file,
  uid,
  role,
  purpose,
  maxFileBytes = CLOUDINARY_MAX_FILE_BYTES,
  cloudinaryCredentials,
  fetchImpl = fetch,
}) {
  const validation = validateCloudinaryImage(file, maxFileBytes);
  const signed = signedCloudinaryUpload({
    ...cloudinaryCredentials,
    uid,
    role,
    purpose,
  });
  if (signed.status) {
    const error = new Error(signed.message);
    error.status = signed.status;
    error.code = signed.code;
    error.missingVariables = signed.missingVariables;
    throw error;
  }

  const body = new FormData();
  Object.entries(signed.params).forEach(([key, value]) => body.append(key, String(value)));
  body.append("file", new Blob([file.buffer], { type: file.mimetype }), `upload.${validation.extension}`);
  const response = await fetchImpl(signed.uploadUrl, {
    method: "POST",
    body,
    signal: AbortSignal.timeout(20000),
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error("The image service could not save this image. Please try again.");
    error.status = 502;
    error.code = "CLOUDINARY_UPLOAD_FAILED";
    throw error;
  }
  if (!isSecureCloudinaryProductImageUrl(result.secure_url, cloudinaryCredentials.cloudName)) {
    const error = new Error("The image service returned an invalid image URL.");
    error.status = 502;
    error.code = "CLOUDINARY_IMAGE_URL_INVALID";
    throw error;
  }
  return { imageUrl: result.secure_url };
}

export async function uploadVendorProductImageToCloudinary(options) {
  return uploadValidatedImageToCloudinary({
    ...options,
    role: "vendor",
    purpose: "product",
    maxFileBytes: VENDOR_PRODUCT_IMAGE_MAX_BYTES,
  });
}
