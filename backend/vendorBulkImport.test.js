import test from "node:test";
import assert from "node:assert/strict";
import XLSX from "xlsx";
import {
  BULK_IMPORT_LIMITS,
  buildVendorImportUpdate,
  parseBulkImportFile,
  previewVendorBulkImport,
  generateVendorBulkImportTemplate,
  generateVendorBulkImportWorkbook,
} from "./vendorBulkImport.js";

test("vendor bulk import preview accepts valid rows and counts duplicates", () => {
  const payload = [
    { rowNumber: 2, values: { name: "Oil Filter", partNumber: "OF-100", brand: "Bosch", category: "Filters", price: "1999", moq: "10", stock: "12", compatibility: "Mahindra Bolero" } },
    { rowNumber: 3, values: { name: "Oil Filter", partNumber: "OF-100", brand: "Bosch", category: "Filters", price: "1999", moq: "10", stock: "12", compatibility: "Mahindra Bolero" } },
  ];

  const result = previewVendorBulkImport(payload, "vendor-1", []);
  assert.equal(result.totalRows, 2);
  assert.equal(result.validRows, 1);
  assert.equal(result.invalidRows, 1);
  assert.equal(result.errors[0].errors[0].includes("Duplicate"), true);
  assert.deepEqual(result.rows[0].partNumber, "OF-100");

  const reimport = previewVendorBulkImport([
    { rowNumber: 2, values: { name: "Updated Oil Filter", partNumber: "OF-100", brand: "Bosch", category: "Filters", price: "2199", moq: "12", stock: "18", compatibility: "Mahindra Bolero" } },
  ], "vendor-1", ["vendor-1|of-100|bosch"]);
  assert.equal(reimport.validRows, 1);
  assert.equal(reimport.duplicates, 1);
  assert.equal(reimport.rows[0].updateExisting, true);
});

test("bulk upload parser rejects malformed, empty, and malicious spreadsheet content", () => {
  assert.throws(() => parseBulkImportFile(Buffer.from(""), "file.csv"), /empty/i);
  assert.throws(() => parseBulkImportFile(Buffer.from("Part Name,Part Number\n,\n"), "file.csv"), /missing|empty|no valid product rows/i);
  assert.throws(() => parseBulkImportFile(Buffer.from("Part Name,Part Number,Brand,Category,Price in INR,MOQ,Availability\n=cmd|powershell,X-2,Bosch,Filters,5000,1,5\n"), "file.csv"), /Malicious/i);
});

test("bulk imports reject invalid prices and missing required fields", () => {
  const result = previewVendorBulkImport([
    { rowNumber: 2, values: { name: "Bad Part", partNumber: "BAD-1", brand: "Bosch", category: "Filters", price: "-5", moq: "0", stock: "2" } },
    { rowNumber: 3, values: { name: "", partNumber: "", brand: "", category: "", price: "100", moq: "1", stock: "2" } },
  ], "vendor-2", []);
  assert.equal(result.validRows, 0);
  assert.equal(result.invalidRows, 2);
});

test("cross-vendor matches remain valid creates and do not count as duplicates", () => {
  const result = previewVendorBulkImport([
    { rowNumber: 2, values: { name: "Air Filter", partNumber: "AF-210", brand: "Mann", category: "Filters", price: "1299", moq: "5", stock: "8", compatibility: "Volvo FM" } },
  ], "vendor-1", ["vendor-2|af-210|mann"]);
  assert.equal(result.validRows, 1);
  assert.equal(result.duplicates, 0);
  assert.equal(result.rows[0].updateExisting, false);
  assert.equal(result.rows[0].sellerId, "vendor-1");
});

test("bulk import update builder preserves protected fields on vendor-owned updates", () => {
  const existing = {
    sellerId: "vendor-1",
    sellerType: "vendor",
    status: "approved",
    enabled: true,
    createdAt: "2024-01-01T00:00:00.000Z",
    vendorImportKey: "vendor-1|of-100|bosch",
    vendorStatus: "approved",
    adminReviewedBy: "admin-9",
  };
  const incoming = {
    name: "Updated Oil Filter",
    partNumber: "OF-100",
    brand: "Bosch",
    category: "Filters",
    price: 2199,
    mrp: 2499,
    stock: 18,
    moq: 12,
    compatibility: "Mahindra Bolero",
    vendorImportKey: "vendor-1|of-100|bosch",
  };

  const merged = buildVendorImportUpdate(existing, incoming, "vendor-1");
  assert.equal(merged.sellerId, "vendor-1");
  assert.equal(merged.sellerType, "vendor");
  assert.equal(merged.status, "approved");
  assert.equal(merged.enabled, true);
  assert.equal(merged.vendorStatus, "approved");
  assert.equal(merged.adminReviewedBy, "admin-9");
  assert.equal(merged.partNumber, "OF-100");
  assert.equal(merged.name, "Updated Oil Filter");
  assert.equal(Object.prototype.hasOwnProperty.call(merged, "rowNumber"), false);
  assert.equal(Object.prototype.hasOwnProperty.call(merged, "updateExisting"), false);

  const newProduct = buildVendorImportUpdate({}, incoming, "vendor-1");
  assert.equal(newProduct.status, "pending");
  assert.equal(newProduct.enabled, false);
  assert.equal(newProduct.createdAt.length > 0, true);
});

test("template includes required product columns and max rows remains configurable", () => {
  const template = generateVendorBulkImportTemplate();
  assert.match(template, /Part Name/);
  assert.match(template, /Price in INR/);
  const workbook = XLSX.read(generateVendorBulkImportWorkbook(), { type: "buffer" });
  const headers = XLSX.utils.sheet_to_json(workbook.Sheets.Products, { header: 1 })[0];
  assert.deepEqual(headers.slice(0, 7), ["Part Name", "Part Number", "Brand", "Category", "Description", "Price in INR", "MOQ"]);
  assert.ok(BULK_IMPORT_LIMITS.maxRows > 10);
});
