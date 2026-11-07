const UPLOAD_PATH = "/api/uploads/cloudinary";

export async function uploadAuthenticatedImageToBackend(
  file,
  purpose,
  { user, apiUrl, fetchImpl = fetch } = {},
) {
  if (!user || typeof user.getIdToken !== "function") {
    throw new Error("Sign in to upload images.");
  }
  if (typeof apiUrl !== "string" || !apiUrl.trim()) {
    throw new Error("The image service is not configured.");
  }
  const token = await user.getIdToken();
  const body = new FormData();
  body.append("file", file, file.name);
  body.append("purpose", purpose);

  let response;
  try {
    response = await fetchImpl(`${apiUrl}${UPLOAD_PATH}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
      body,
    });
  } catch {
    throw new Error("Could not reach the image service. Check your internet connection and try again.");
  }

  const result = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(result.message || `Image upload failed (${response.status}).`);
  }
  if (typeof result.imageUrl !== "string" || !result.imageUrl.startsWith("https://res.cloudinary.com/")) {
    throw new Error("The image service did not return a secure image URL.");
  }
  return result.imageUrl;
}
