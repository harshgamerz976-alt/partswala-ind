import test from "node:test";
import assert from "node:assert/strict";
import XLSX from "xlsx";
import {
  BULK_IMPORT_LIMITS,
  buildVendorImportUpdate,
  parseBulkImportFile,
  previewVendorBulkImport,
  REQUIRED_IMPORT_COLUMNS,
  generateVendorBulkImportTemplate,
  generateVendorBulkImportWorkbook,
} from "./vendorBulkImport.js";

test("vendor bulk import preview accepts valid rows and counts duplicates", () => {
  const payload = [
    { rowNumber: 2, values: { partNumber: "OF-100", brand: "Bosch", description: "Oil Filter", mrp: "2499", price: "1999", stock: "12", compatibility: "Mahindra Bolero" } },
    { rowNumber: 3, values: { partNumber: "OF-100", brand: "Bosch", description: "Oil Filter", mrp: "2499", price: "1999", stock: "12", compatibility: "Mahindra Bolero" } },
  ];

  const result = previewVendorBulkImport(payload, "vendor-1", []);
  assert.equal(result.totalRows, 2);
  assert.equal(result.validRows, 1);
  assert.equal(result.invalidRows, 1);
  assert.equal(result.errors[0].errors[0].includes("Duplicate"), true);
  assert.deepEqual(result.rows[0].partNumber, "OF-100");

  const reimport = previewVendorBulkImport([
    { rowNumber: 2, values: { partNumber: "OF-100", brand: "Bosch", description: "Updated Oil Filter", mrp: "2699", price: "2199", stock: "18", compatibility: "Mahindra Bolero" } },
  ], "vendor-1", ["vendor-1|of-100|bosch"]);
  assert.equal(reimport.validRows, 1);
  assert.equal(reimport.duplicates, 1);
  assert.equal(reimport.rows[0].updateExisting, true);
});

test("bulk upload parser rejects malformed, empty, and malicious spreadsheet content", () => {
  assert.throws(() => parseBulkImportFile(Buffer.from(""), "file.csv"), /empty/i);
  assert.throws(() => parseBulkImportFile(Buffer.from("Part Number,Brand,Description,MRP,Selling Price,Availability/Stock,Compatible Vehicle\n,\n"), "file.csv"), /missing|empty|no valid product rows/i);
  assert.throws(() => parseBulkImportFile(Buffer.from("Part Number,Brand,Description,MRP,Selling Price,Availability/Stock,Compatible Vehicle\nX-2,Bosch,=cmd|powershell,5000,4000,5,Volvo FM\n"), "file.csv"), /Malicious/i);
  assert.throws(() => parseBulkImportFile(Buffer.from("not an Excel workbook"), "file.xlsx"), /could not be read/i);
});

function workbookBuffer(rows, bookType = "xlsx") {
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(rows), "Products");
  return XLSX.write(workbook, { type: "buffer", bookType });
}

test("bulk import maps the required Excel and legacy XLS columns to product fields", () => {
  const rows = [
    ["Part Number", "Brand", "Description", "MRP", "Selling Price", "Availability/Stock", "Compatible Vehicle"],
    ["CP-440", "Valeo", "Clutch Plate", 5000, 4250, 8, "Volvo FM"],
  ];

  for (const [fileName, bookType] of [["parts.xlsx", "xlsx"], ["parts.xls", "biff8"]]) {
    const parsed = parseBulkImportFile(workbookBuffer(rows, bookType), fileName);
    assert.equal(parsed.length, 1);
    assert.equal(parsed[0].rowNumber, 2);
    const preview = previewVendorBulkImport(parsed, "vendor-1", []);
    assert.equal(preview.validRows, 1);
    assert.deepEqual(
      {
        name: preview.rows[0].name,
        description: preview.rows[0].description,
        partNumber: preview.rows[0].partNumber,
        brand: preview.rows[0].brand,
        mrp: preview.rows[0].mrp,
        price: preview.rows[0].price,
        stock: preview.rows[0].stock,
        compatibility: preview.rows[0].compatibility,
      },
      {
        name: "Clutch Plate",
        description: "Clutch Plate",
        partNumber: "CP-440",
        brand: "Valeo",
        mrp: 5000,
        price: 4250,
        stock: 8,
        compatibility: "Volvo FM",
      },
    );
    assert.equal(Object.prototype.hasOwnProperty.call(preview.rows[0], "category"), false);
  }
});

test("bulk import rejects missing required headers and values instead of inventing product data", () => {
  assert.throws(
    () => parseBulkImportFile(Buffer.from("Part Number,Brand,Description,Selling Price,Availability/Stock,Compatible Vehicle\nPN-1,Brand,Part,100,2,Vehicle\n"), "missing-mrp.csv"),
    /missing required columns: mrp/i,
  );

  const result = previewVendorBulkImport([
    { rowNumber: 2, values: { partNumber: "PN-1", brand: "Brand", description: "Part", price: "100", mrp: "", stock: "", compatibility: "" } },
  ], "vendor-1");
  assert.equal(result.validRows, 0);
  assert.match(result.errors[0].errors.join(" "), /MRP/i);
  assert.match(result.errors[0].errors.join(" "), /availability/i);
});

test("bulk import enforces file, row, and column limits before cell scanning", () => {
  assert.throws(
    () => parseBulkImportFile(Buffer.alloc(BULK_IMPORT_LIMITS.maxFileSize + 1), "large.csv"),
    /too large/i,
  );

  const header = ["Part Number", "Brand", "Description", "MRP", "Selling Price", "Availability/Stock", "Compatible Vehicle"];
  const tooManyRows = workbookBuffer([
    header,
    ...Array.from({ length: BULK_IMPORT_LIMITS.maxRows + 1 }, (_, index) => [
      `PN-${index}`,
      "Brand",
      `Part ${index}`,
      200,
      100,
      1,
      "Vehicle",
    ]),
  ]);
  assert.throws(() => parseBulkImportFile(tooManyRows, "too-many-rows.xlsx"), /row limit/i);

  const tooManyColumns = workbookBuffer([
    [...header, ...Array.from({ length: BULK_IMPORT_LIMITS.maxColumns - header.length + 1 }, (_, index) => `Extra ${index}`)],
    ["PN-1", "Brand", "Part", 200, 100, 1, "Vehicle"],
  ]);
  assert.throws(() => parseBulkImportFile(tooManyColumns, "too-many-columns.xlsx"), /column count/i);
});

test("bulk import rejects spreadsheet formulas", () => {
  const rows = [
    ["Part Number", "Brand", "Description", "MRP", "Selling Price", "Availability/Stock", "Compatible Vehicle"],
    ["CP-440", "Valeo", "Clutch Plate", 5000, 4250, 8, "Volvo FM"],
  ];
  const workbook = XLSX.utils.book_new();
  const sheet = XLSX.utils.aoa_to_sheet(rows);
  sheet.A2 = { t: "n", f: "1+1", v: 2 };
  XLSX.utils.book_append_sheet(workbook, sheet, "Products");
  const buffer = XLSX.write(workbook, { type: "buffer", bookType: "xlsx" });
  assert.throws(() => parseBulkImportFile(buffer, "formula.xlsx"), /Malicious/i);
});

test("bulk imports reject invalid prices and missing required fields", () => {
  const result = previewVendorBulkImport([
    { rowNumber: 2, values: { description: "Bad Part", partNumber: "BAD-1", brand: "Bosch", mrp: "5", price: "-5", stock: "2", compatibility: "" } },
    { rowNumber: 3, values: { description: "", partNumber: "", brand: "", mrp: "100", price: "100", stock: "2", compatibility: "" } },
  ], "vendor-2", []);
  assert.equal(result.validRows, 0);
  assert.equal(result.invalidRows, 2);
});

test("bulk imports require an explicit compatible vehicle value", () => {
  const result = previewVendorBulkImport([
    { rowNumber: 2, values: { description: "Universal Part", partNumber: "U-1", brand: "Brand", mrp: "1000", price: "900", stock: "12", compatibility: "" } },
    { rowNumber: 3, values: { description: "Vehicle Part", partNumber: "V-1", brand: "Brand", mrp: "1000", price: "900", stock: "12", compatibility: "Universal fit" } },
  ], "vendor-1");

  assert.equal(result.validRows, 1);
  assert.equal(result.invalidRows, 1);
  assert.match(result.errors[0].errors.join(" "), /compatible vehicle/i);
});

test("bulk imports reject malformed numeric strings and fractional stock instead of coercing them", () => {
  const result = previewVendorBulkImport([
    { rowNumber: 2, values: { description: "Part A", partNumber: "A-1", brand: "Brand", mrp: "1000", price: "900abc", stock: "12", compatibility: "Universal fit" } },
    { rowNumber: 3, values: { description: "Part B", partNumber: "B-1", brand: "Brand", mrp: "1,000", price: "Rs. 900", stock: "1.5", compatibility: "Universal fit" } },
    { rowNumber: 4, values: { description: "Part C", partNumber: "C-1", brand: "Brand", mrp: "1,000", price: "Rs. 900", stock: "0", compatibility: "Universal fit" } },
  ], "vendor-1");

  assert.equal(result.validRows, 1);
  assert.equal(result.invalidRows, 2);
  assert.match(result.errors[0].errors.join(" "), /selling price/i);
  assert.match(result.errors[1].errors.join(" "), /availability/i);
  assert.equal(result.rows[0].price, 900);
  assert.equal(result.rows[0].mrp, 1000);
  assert.equal(result.rows[0].stock, 0);
});

test("cross-vendor matches remain valid creates and do not count as duplicates", () => {
  const result = previewVendorBulkImport([
    { rowNumber: 2, values: { description: "Air Filter", partNumber: "AF-210", brand: "Mann", mrp: "1599", price: "1299", stock: "8", compatibility: "Volvo FM" } },
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
  assert.deepEqual(REQUIRED_IMPORT_COLUMNS, ["partNumber", "brand", "description", "mrp", "price", "stock", "compatibility"]);
  assert.doesNotMatch(template, /Category|MOQ|Part Name/);
  const workbook = XLSX.read(generateVendorBulkImportWorkbook(), { type: "buffer" });
  const headers = XLSX.utils.sheet_to_json(workbook.Sheets.Products, { header: 1 })[0];
  assert.deepEqual(headers, ["Part Number", "Brand", "Description", "MRP", "Selling Price", "Availability/Stock", "Compatible Vehicle"]);
  assert.ok(BULK_IMPORT_LIMITS.maxRows > 10);
});
