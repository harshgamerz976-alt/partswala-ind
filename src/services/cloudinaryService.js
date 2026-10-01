import { auth } from "../firebase";
import { backendRequest } from "./orderService";

/**
 * Uploads go through the backend: it signs a short-lived Cloudinary request that is scoped to the
 * signed-in account, restricts the upload to images and to a maximum size, and rate-limits callers.
 * The Cloudinary API secret never reaches the browser.
 */

const SIGNATURE_PATH = "/api/uploads/cloudinary/signature";
const MAX_FILE_BYTES = 8 * 1024 * 1024;

export async function uploadImageToCloudinary(file, purpose = "general") {
  if (!(file instanceof File) || !file.type.startsWith("image/")) {
    throw new Error("Choose a valid image file.");
  }
  if (file.size > MAX_FILE_BYTES) {
    throw new Error("Choose an image smaller than 8 MB.");
  }
  if (!auth.currentUser) {
    throw new Error("Sign in to upload images.");
  }

  const signature = await backendRequest(SIGNATURE_PATH, { purpose });
  if (!signature?.uploadUrl || !signature.params) throw new Error("Image uploads are unavailable right now.");

  const body = new FormData();
  body.append("file", file);
  Object.entries(signature.params).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== "") body.append(key, String(value));
  });

  let response;
  try {
    response = await fetch(signature.uploadUrl, { method: "POST", body });
  } catch {
    throw new Error("Could not reach the image service. Check your internet connection and try again.");
  }

  const result = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(result.error?.message || `Image upload failed (${response.status}).`);
  }
  if (!result.secure_url) throw new Error("The image service did not return a secure image URL.");

  return result.secure_url;
}
