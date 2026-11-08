import { BACKEND_API_URL } from "./backendApiUrl.js";

export function getSubmissionRequest(current, signature) {
  if (current?.signature === signature) return current;
  return { signature, requestId: crypto.randomUUID() };
}

async function request(user, path, { method = "GET", body } = {}, fetchImpl = fetch) {
  if (!user || typeof user.getIdToken !== "function") {
    throw new Error("Sign in to access supplier enquiries.");
  }
  const token = await user.getIdToken();
  const response = await fetchImpl(`${BACKEND_API_URL}${path}`, {
    method,
    cache: "no-store",
    headers: {
      Authorization: ["Bearer", token].join(" "),
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result.message || "Supplier enquiries could not be loaded.");
  return result;
}

export async function getSupplierEnquiries(user, audience, cursor = null, fetchImpl = fetch) {
  if (audience !== "customer" && audience !== "vendor") {
    throw new Error("A valid enquiry audience is required.");
  }
  const path = audience === "vendor" ? "/api/vendor/enquiries" : "/api/enquiries";
  const query = cursor ? `?cursor=${encodeURIComponent(cursor)}` : "";
  const result = await request(user, `${path}${query}`, {}, fetchImpl);
  if (!Array.isArray(result.enquiries)
    || typeof result.hasMore !== "boolean"
    || (result.cursor !== null && typeof result.cursor !== "string")) {
    throw new Error("The supplier enquiry response was invalid.");
  }
  return result;
}

export async function createSupplierEnquiry(user, payload, fetchImpl = fetch) {
  const requestId = payload.requestId || crypto.randomUUID();
  const result = await request(user, "/api/vendor/enquiries", {
    method: "POST",
    body: { ...payload, requestId },
  }, fetchImpl);
  if (typeof result.enquiryId !== "string" || result.status !== "new") {
    throw new Error("The supplier enquiry response was invalid.");
  }
  return result;
}

export async function sendSupplierQuote(user, enquiryId, payload, fetchImpl = fetch) {
  if (typeof enquiryId !== "string" || !enquiryId.trim() || enquiryId.includes("/")) {
    throw new Error("A valid enquiry ID is required.");
  }
  const requestId = payload.requestId || crypto.randomUUID();
  const result = await request(user, `/api/vendor/enquiries/${encodeURIComponent(enquiryId)}/quote`, {
    method: "PATCH",
    body: { ...payload, requestId },
  }, fetchImpl);
  if (result.enquiryId !== enquiryId || result.status !== "quoted") {
    throw new Error("The supplier quote response was invalid.");
  }
  return result;
}
