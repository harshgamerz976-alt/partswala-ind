import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { CLOUDINARY_IMAGE_FORMATS, CLOUDINARY_MAX_FILE_BYTES, cloudinaryCredentialPresence, cloudinaryCredentialsFromEnvironment, cloudinarySignature, cloudinaryUploadFolder, normalizeUploadPurpose, signedCloudinaryUpload } from "./cloudinaryUploads.js";

const config = { cloudName: "partswala-cloud", apiKey: "1234567890", apiSecret: "unit-test-secret" };

test("the signed payload matches Cloudinary's documented signature form", () => {
  const signed = signedCloudinaryUpload({ ...config, uid: "uid-1", role: "customer", purpose: "product", timestamp: 1700000000 });
  const toSign = `allowed_formats=${CLOUDINARY_IMAGE_FORMATS}&folder=partswala/product/customer/uid-1&timestamp=1700000000`;
  assert.equal(signed.params.signature, createHash("sha1").update(`${toSign}${config.apiSecret}`).digest("hex"));
  assert.equal(signed.params.timestamp, 1700000000);
  assert.equal(signed.params.folder, "partswala/product/customer/uid-1");
  assert.equal(signed.params.api_key, config.apiKey);
  assert.equal(Object.hasOwn(signed.params, "max_file_size"), false);
  assert.deepEqual(Object.keys(signed.params).sort(), ["allowed_formats", "api_key", "folder", "signature", "timestamp"]);
  assert.equal(signed.maxFileBytes, CLOUDINARY_MAX_FILE_BYTES);
  assert.equal(signed.uploadUrl, "https://api.cloudinary.com/v1_1/partswala-cloud/image/upload");
});

test("the API secret never reaches the browser payload", () => {
  const signed = signedCloudinaryUpload({ ...config, uid: "uid-1", purpose: "profile", timestamp: 1700000000 });
  assert.equal(JSON.stringify(signed).includes(config.apiSecret), false);
  assert.equal(Object.keys(signed.params).includes("api_secret"), false);
});

test("uploads are restricted to images and to a bounded size", () => {
  const signed = signedCloudinaryUpload({ ...config, uid: "uid-1", timestamp: 1700000000 });
  assert.equal(signed.params.allowed_formats, "jpg,jpeg,png,webp,avif,heic");
  assert.equal(signed.maxFileBytes, 8 * 1024 * 1024);
  assert.equal(signed.maxFileBytes, 8 * 1024 * 1024);
  assert.deepEqual(signed.allowedFormats, ["jpg", "jpeg", "png", "webp", "avif", "heic"]);
});

test("signature covers the folder, format list, size cap, and timestamp", () => {
  const base = signedCloudinaryUpload({ ...config, uid: "uid-1", purpose: "product", timestamp: 1700000000 });
  const otherFolder = signedCloudinaryUpload({ ...config, uid: "uid-2", purpose: "product", timestamp: 1700000000 });
  const otherTime = signedCloudinaryUpload({ ...config, uid: "uid-1", purpose: "product", timestamp: 1700000001 });
  assert.notEqual(base.params.signature, otherFolder.params.signature);
  assert.notEqual(base.params.signature, otherTime.params.signature);
  assert.notEqual(base.params.signature, cloudinarySignature({ folder: "partswala/product/customer/uid-1", timestamp: 1700000000 }, "different-secret"));
});

test("upload folders are scoped per account, supported purpose, and seller role", () => {
  assert.equal(cloudinaryUploadFolder({ uid: "uid 1/../etc", role: "vendor", purpose: "submission" }), "partswala/submission/vendor/uid1etc");
  assert.equal(cloudinaryUploadFolder({ uid: "uid-1", role: "weird role!", purpose: "product" }), "partswala/product/customer/uid-1");
  assert.equal(normalizeUploadPurpose("../../etc/passwd"), "general");
  assert.equal(normalizeUploadPurpose("admin"), "general");
  assert.equal(normalizeUploadPurpose("return"), "return");
});

test("uploads fail closed when the server has no Cloudinary credentials", () => {
  const signed = signedCloudinaryUpload({ cloudName: "", apiKey: "", apiSecret: "", uid: "uid-1" });
  assert.equal(signed.status, 503);
  assert.equal(signed.code, "MEDIA_UPLOAD_NOT_CONFIGURED");
  assert.deepEqual(signed.missingVariables, ["CLOUDINARY_CLOUD_NAME", "CLOUDINARY_API_KEY", "CLOUDINARY_API_SECRET"]);
  assert.throws(() => cloudinarySignature({ folder: "x" }, ""));
});

test("Cloudinary environment diagnostics report presence without returning credential values", () => {
  const credentials = cloudinaryCredentialsFromEnvironment({
    CLOUDINARY_CLOUD_NAME: " test-cloud ",
    CLOUDINARY_API_KEY: "test-key",
    CLOUDINARY_API_SECRET: "must-never-be-reported",
  });
  assert.deepEqual(cloudinaryCredentialPresence(credentials), {
    CLOUDINARY_CLOUD_NAME: "PRESENT",
    CLOUDINARY_API_KEY: "PRESENT",
    CLOUDINARY_API_SECRET: "PRESENT",
  });
  assert.equal(JSON.stringify(cloudinaryCredentialPresence(credentials)).includes("must-never-be-reported"), false);
  assert.deepEqual(cloudinaryCredentialPresence(cloudinaryCredentialsFromEnvironment({})), {
    CLOUDINARY_CLOUD_NAME: "MISSING",
    CLOUDINARY_API_KEY: "MISSING",
    CLOUDINARY_API_SECRET: "MISSING",
  });
});
