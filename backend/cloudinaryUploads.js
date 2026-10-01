// backend/cloudinaryUploads.js
// Signed Cloudinary upload parameters.
//
// The API secret never leaves the server. The browser receives a short-lived signature for a
// folder that is scoped to the caller, together with server-enforced image-only + size limits.

import { createHash } from "node:crypto";

export const CLOUDINARY_IMAGE_FORMATS = "jpg,jpeg,png,webp,avif,heic";
export const CLOUDINARY_MAX_FILE_BYTES = 8 * 1024 * 1024;
export const CLOUDINARY_SIGNATURE_TTL_SECONDS = 600;
export const CLOUDINARY_UPLOAD_LIMIT = { limit: 20, windowMs: 5 * 60 * 1000 };

export const CLOUDINARY_UPLOAD_PURPOSES = new Set(["general", "product", "profile", "submission", "return"]);
const ROLE_PATTERN = /^[a-z0-9_-]{1,24}$/;

export function cloudinaryCredentialsFromEnvironment(env = process.env) {
  return {
    cloudName: String(env.CLOUDINARY_CLOUD_NAME || "").trim(),
    apiKey: String(env.CLOUDINARY_API_KEY || "").trim(),
    apiSecret: String(env.CLOUDINARY_API_SECRET || "").trim(),
  };
}

export function cloudinaryCredentialPresence(credentials) {
  return {
    CLOUDINARY_CLOUD_NAME: credentials.cloudName ? "PRESENT" : "MISSING",
    CLOUDINARY_API_KEY: credentials.apiKey ? "PRESENT" : "MISSING",
    CLOUDINARY_API_SECRET: credentials.apiSecret ? "PRESENT" : "MISSING",
  };
}

export function normalizeUploadPurpose(value) {
  const purpose = String(value || "").trim().toLowerCase();
  return CLOUDINARY_UPLOAD_PURPOSES.has(purpose) ? purpose : "general";
}

/** Uploads are namespaced by purpose and by the signed-in account so one user cannot write into another's folder. */
export function cloudinaryUploadFolder({ uid, role = "customer", purpose } = {}) {
  const cleanUid = String(uid || "").replace(/[^A-Za-z0-9_-]/g, "").slice(0, 64);
  const cleanRole = ROLE_PATTERN.test(String(role || "")) ? String(role) : "customer";
  return ["partswala", normalizeUploadPurpose(purpose), cleanRole, cleanUid || "unknown"].join("/");
}

/** Cloudinary's documented signature: alphabetically sorted `key=value` pairs, then the API secret, hashed with SHA-1. */
export function cloudinarySignature(params, apiSecret) {
  if (!apiSecret) throw new Error("A Cloudinary API secret is required to sign an upload.");
  const toSign = Object.keys(params)
    .filter((key) => params[key] !== undefined && params[key] !== null && params[key] !== "")
    .sort()
    .map((key) => `${key}=${params[key]}`)
    .join("&");
  return createHash("sha1").update(`${toSign}${apiSecret}`).digest("hex");
}

/**
 * Builds the exact parameters the browser may use. Everything that constrains the upload is
 * part of the signature, so it cannot be widened by the client.
 */
export function signedCloudinaryUpload({ cloudName, apiKey, apiSecret, uid, role = "customer", purpose, timestamp = Math.floor(Date.now() / 1000), uploadPreset = "" }) {
  const missingVariables = [
    !cloudName && "CLOUDINARY_CLOUD_NAME",
    !apiKey && "CLOUDINARY_API_KEY",
    !apiSecret && "CLOUDINARY_API_SECRET",
  ].filter(Boolean);
  if (missingVariables.length) {
    return { status: 503, code: "MEDIA_UPLOAD_NOT_CONFIGURED", message: "Image uploads are not configured on the server yet.", missingVariables };
  }
  const params = {
    folder: cloudinaryUploadFolder({ uid, role, purpose }),
    timestamp,
    allowed_formats: CLOUDINARY_IMAGE_FORMATS,
  };
  if (uploadPreset) params.upload_preset = uploadPreset;
  return {
    cloudName,
    apiKey,
    uploadUrl: `https://api.cloudinary.com/v1_1/${encodeURIComponent(cloudName)}/image/upload`,
    params: { ...params, api_key: apiKey, signature: cloudinarySignature(params, apiSecret) },
    maxFileBytes: CLOUDINARY_MAX_FILE_BYTES,
    allowedFormats: CLOUDINARY_IMAGE_FORMATS.split(","),
  };
}
