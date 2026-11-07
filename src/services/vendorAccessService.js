import { BACKEND_API_URL } from "./backendApiUrl";

export async function getVerifiedVendorAccess(user, fetchImpl = fetch) {
  if (!user || typeof user.getIdToken !== "function") {
    throw new Error("A signed-in account is required to verify vendor access.");
  }
  const token = await user.getIdToken();
  const response = await fetchImpl(`${BACKEND_API_URL}/api/vendor/access`, {
    method: "GET",
    cache: "no-store",
    headers: { Authorization: `Bearer ${token}` },
  });
  const result = await response.json().catch(() => ({}));
  if (response.status === 403 && result.approvedVendor === false) return false;
  if (!response.ok) {
    throw new Error(result.message || "Vendor access could not be verified.");
  }
  if (result.approvedVendor !== true) {
    throw new Error("Vendor access response was invalid.");
  }
  return true;
}
