import { auth } from "../firebase";
import { requestVendorBulkImport } from "../../shared/vendorBulkImportApi.js";

const API_URL = (import.meta.env.VITE_API_URL || import.meta.env.VITE_BACKEND_API_URL || "http://localhost:8787").replace(/\/$/, "");

export function downloadVendorImportTemplate() {
  return requestVendorBulkImport({
    user: auth.currentUser,
    baseUrl: API_URL,
    path: "/api/vendor/import-template",
    responseType: "blob",
    expectedContentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
}

export function previewVendorProductImport(file) {
  return requestVendorBulkImport({
    user: auth.currentUser,
    baseUrl: API_URL,
    path: "/api/vendor/import-products",
    file,
  });
}

export function confirmVendorProductImport(file) {
  return requestVendorBulkImport({
    user: auth.currentUser,
    baseUrl: API_URL,
    path: "/api/vendor/import-products",
    file,
    confirm: true,
  });
}
