import test from "node:test";
import assert from "node:assert/strict";
import {
  VENDOR_PRODUCT_IMAGE_MAX_BYTES,
  canUploadVendorProductImage,
  isSecureCloudinaryProductImageUrl,
  uploadValidatedImageToCloudinary,
  uploadVendorProductImageToCloudinary,
  validateCloudinaryImage,
  validateVendorProductImage,
} from "./vendorProductImages.js";

const jpeg = {
  originalname: "part.jpg",
  mimetype: "image/jpeg",
  buffer: Buffer.from([0xff, 0xd8, 0xff, 0x00]),
  size: 4,
};

test("vendor product image validation checks MIME, extension, content, and byte limit", () => {
  assert.equal(validateVendorProductImage(jpeg).maxFileBytes, VENDOR_PRODUCT_IMAGE_MAX_BYTES);
  assert.throws(() => validateVendorProductImage({ ...jpeg, mimetype: "text/plain" }), /supported JPG/i);
  assert.throws(() => validateVendorProductImage({ ...jpeg, originalname: "part.png" }), /supported JPG/i);
  assert.throws(() => validateVendorProductImage({ ...jpeg, buffer: Buffer.from("not an image"), size: 12 }), /contents do not match/i);
  const oversized = Buffer.alloc(VENDOR_PRODUCT_IMAGE_MAX_BYTES + 1);
  oversized.set([0xff, 0xd8, 0xff]);
  assert.throws(() => validateVendorProductImage({
    ...jpeg,
    buffer: oversized,
    size: oversized.length,
  }), /5 MB/i);
});

test("general media uploads enforce server-side size, extension, MIME, and file signature checks", () => {
  const png = {
    originalname: "part.png",
    mimetype: "image/png",
    buffer: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    size: 8,
  };
  assert.equal(validateCloudinaryImage(png).extension, "png");
  assert.throws(() => validateCloudinaryImage({ ...png, originalname: "part.jpg" }), /supported JPG/i);
  assert.throws(() => validateCloudinaryImage({
    ...png,
    buffer: Buffer.from("not png"),
    size: 7,
  }), /contents do not match/i);

  const oversized = Buffer.alloc(8 * 1024 * 1024 + 1);
  oversized.set(png.buffer);
  assert.throws(() => validateCloudinaryImage({
    ...png,
    buffer: oversized,
    size: oversized.length,
  }), /8 MB/i);
});

test("only an approved non-admin vendor can upload and product edits require ownership", () => {
  const vendor = { uid: "vendor-1" };
  const profile = { role: "vendor", vendorStatus: "approved" };
  assert.equal(canUploadVendorProductImage(profile, vendor), true);
  assert.equal(canUploadVendorProductImage({ ...profile, vendorStatus: "pending" }, vendor), false);
  assert.equal(canUploadVendorProductImage(profile, { ...vendor, isAdmin: true }), false);
  assert.equal(canUploadVendorProductImage(profile, vendor, { sellerId: "vendor-2" }), false);
  assert.equal(canUploadVendorProductImage(profile, vendor, { sellerId: "vendor-1" }), true);
});

test("Cloudinary response validation accepts only the configured secure image host and folder", () => {
  assert.equal(isSecureCloudinaryProductImageUrl(
    "https://res.cloudinary.com/sample/image/upload/v1/part.jpg",
    "sample",
  ), true);
  assert.equal(isSecureCloudinaryProductImageUrl("http://res.cloudinary.com/sample/image/upload/part.jpg", "sample"), false);
  assert.equal(isSecureCloudinaryProductImageUrl("https://attacker.example/sample/image/upload/part.jpg", "sample"), false);
  assert.equal(isSecureCloudinaryProductImageUrl("https://res.cloudinary.com/other/image/upload/part.jpg", "sample"), false);
});

test("approved product image upload uses a server signature and returns only a secure URL", async () => {
  let requestBody;
  const result = await uploadVendorProductImageToCloudinary({
    file: jpeg,
    uid: "vendor-1",
    cloudinaryCredentials: {
      cloudName: "sample",
      apiKey: "test-api-key",
      apiSecret: "test-api-secret",
    },
    fetchImpl: async (_url, options) => {
      requestBody = options.body;
      return {
        ok: true,
        async json() {
          return { secure_url: "https://res.cloudinary.com/sample/image/upload/v1/part.jpg" };
        },
      };
    },
  });
  assert.equal(result.imageUrl, "https://res.cloudinary.com/sample/image/upload/v1/part.jpg");
  assert.equal(requestBody.has("api_secret"), false);
  assert.equal(requestBody.has("signature"), true);
});

test("generic media upload signs a validated file for its authenticated account folder", async () => {
  let requestBody;
  const result = await uploadValidatedImageToCloudinary({
    file: jpeg,
    uid: "customer-1",
    role: "customer",
    purpose: "profile",
    cloudinaryCredentials: {
      cloudName: "sample",
      apiKey: "test-api-key",
      apiSecret: "test-api-secret",
    },
    fetchImpl: async (_url, options) => {
      requestBody = options.body;
      return {
        ok: true,
        async json() {
          return { secure_url: "https://res.cloudinary.com/sample/image/upload/v1/profile.jpg" };
        },
      };
    },
  });
  assert.equal(result.imageUrl, "https://res.cloudinary.com/sample/image/upload/v1/profile.jpg");
  assert.equal(requestBody.get("folder"), "partswala/profile/customer/customer-1");
  assert.equal(requestBody.has("api_secret"), false);
  assert.equal(requestBody.has("signature"), true);
});

test("product image upload surfaces provider failures without returning arbitrary URLs", async () => {
  await assert.rejects(uploadVendorProductImageToCloudinary({
    file: jpeg,
    uid: "vendor-1",
    cloudinaryCredentials: {
      cloudName: "sample",
      apiKey: "test-api-key",
      apiSecret: "test-api-secret",
    },
    fetchImpl: async () => ({
      ok: false,
      status: 500,
      async json() { return {}; },
    }),
  }), /image service could not save/i);
});
