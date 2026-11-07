import { auth } from "../firebase";
import { BACKEND_API_URL } from "./backendApiUrl";
import { uploadAuthenticatedImageToBackend } from "./authenticatedImageUpload";
import { validateVendorProductImageFile } from "./vendorProductImageValidation";

/**
 * Files are validated and uploaded by the backend so byte limits and image signatures cannot be
 * bypassed by calling Cloudinary directly with a reused signed request.
 */

const MAX_FILE_BYTES = 8 * 1024 * 1024;

function uploadVendorProductImage(file, productId, onProgress) {
  return auth.currentUser.getIdToken().then((token) => new Promise((resolve, reject) => {
    const request = new XMLHttpRequest();
    const body = new FormData();
    body.append("file", file);
    if (productId) body.append("productId", productId);
    request.open("POST", `${BACKEND_API_URL}/api/vendor/product-images`);
    request.setRequestHeader("Authorization", `Bearer ${token}`);
    request.timeout = 30000;
    request.upload.addEventListener("progress", (event) => {
      if (event.lengthComputable && typeof onProgress === "function") {
        onProgress(Math.min(100, Math.round((event.loaded / event.total) * 100)));
      }
    });
    request.addEventListener("load", () => {
      let result = {};
      try {
        result = JSON.parse(request.responseText || "{}");
      } catch {
        return reject(new Error("The image service returned an unreadable response."));
      }
      if (request.status < 200 || request.status >= 300) {
        return reject(new Error(result.message || "The product image could not be uploaded."));
      }
      if (typeof result.imageUrl !== "string" || !result.imageUrl.startsWith("https://res.cloudinary.com/")) {
        return reject(new Error("The image service did not return a secure product image."));
      }
      return resolve(result.imageUrl);
    });
    request.addEventListener("error", () => reject(new Error("Could not reach the image service. Check your connection and try again.")));
    request.addEventListener("timeout", () => reject(new Error("The image upload took too long. Try again.")));
    request.send(body);
  }));
}

export async function uploadImageToCloudinary(file, purpose = "general", options = {}) {
  if (!(file instanceof File) || !file.type.startsWith("image/")) {
    throw new Error("Choose a valid image file.");
  }
  if (purpose === "submission") {
    validateVendorProductImageFile(file);
    if (!auth.currentUser) throw new Error("Sign in to upload images.");
    return uploadVendorProductImage(file, options.productId || "", options.onProgress);
  }
  if (file.size > MAX_FILE_BYTES) {
    throw new Error("Choose an image no larger than 8 MB.");
  }
  if (!auth.currentUser) {
    throw new Error("Sign in to upload images.");
  }

  return uploadAuthenticatedImageToBackend(file, purpose, { user: auth.currentUser, apiUrl: BACKEND_API_URL });
}
