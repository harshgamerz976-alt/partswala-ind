import { backendRequest } from "./orderService";

export function createSupplierEnquiry(input) {
  return backendRequest("/api/vendor/enquiries", input);
}

export function getMySupplierEnquiries(cursor = "") {
  const query = cursor ? `?cursor=${encodeURIComponent(cursor)}` : "";
  return backendRequest(`/api/enquiries${query}`, undefined, "GET");
}

export function getVendorSupplierEnquiries(cursor = "") {
  const query = cursor ? `?cursor=${encodeURIComponent(cursor)}` : "";
  return backendRequest(`/api/vendor/enquiries${query}`, undefined, "GET");
}

export async function getMySupplierEnquiry(enquiryId) {
  const result = await backendRequest(`/api/enquiries/${encodeURIComponent(enquiryId)}`, undefined, "GET");
  return result.enquiry;
}

export async function getVendorSupplierEnquiry(enquiryId) {
  const result = await backendRequest(`/api/vendor/enquiries/${encodeURIComponent(enquiryId)}`, undefined, "GET");
  return result.enquiry;
}

export function saveSupplierQuote(enquiryId, input) {
  return backendRequest(`/api/vendor/enquiries/${encodeURIComponent(enquiryId)}/quote`, input, "PATCH");
}
