import { auth } from "../firebase";
import { requestVendorBulkImport } from "../../shared/vendorBulkImportApi.js";
import { BACKEND_API_URL } from "./backendApiUrl.js";

export function downloadVendorImportTemplate() {
  return requestVendorBulkImport({
    user: auth.currentUser,
    baseUrl: BACKEND_API_URL,
    path: "/api/vendor/import-template",
    responseType: "blob",
    expectedContentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
}

export function previewVendorProductImport(file) {
  return requestVendorBulkImport({
    user: auth.currentUser,
    baseUrl: BACKEND_API_URL,
    path: "/api/vendor/import-products",
    file,
  });
}

export function confirmVendorProductImport(file) {
  return requestVendorBulkImport({
    user: auth.currentUser,
    baseUrl: BACKEND_API_URL,
    path: "/api/vendor/import-products",
    file,
    confirm: true,
  });
}
