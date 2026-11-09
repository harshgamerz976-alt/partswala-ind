import test from "node:test";
import assert from "node:assert/strict";
import XLSX from "xlsx";
import {
  BULK_IMPORT_LIMITS,
  buildVendorImportCreate,
  parseBulkImportFile,
  previewVendorBulkImport,
  REQUIRED_IMPORT_COLUMNS,
  generateVendorBulkImportTemplate,
  generateVendorBulkImportWorkbook,
  isVendorBulkImportInputError,
  OPTIONAL_IMPORT_COLUMNS,
} from "./vendorBulkImport.js";

test("vendor bulk import preview accepts valid rows and counts duplicates", () => {
  const payload = [
    { rowNumber: 2, values: { partNumber: "OF-100", brand: "Bosch", description: "Oil Filter", mrp: "2499", price: "1999", stock: "12", compatibility: "Mahindra Bolero" } },
    { rowNumber: 3, values: { partNumber: "OF-100", brand: "Bosch", description: "Oil Filter", mrp: "2499", price: "1999", stock: "12", compatibility: "Mahindra Bolero" } },
  ];

  const result = previewVendorBulkImport(payload, "vendor-1", []);
  assert.equal(result.totalRows, 2);
  assert.equal(result.validRows, 1);
  assert.equal(result.invalidRows, 0);
  assert.equal(result.duplicates, 1);
  assert.deepEqual(result.rows[0].partNumber, "OF-100");

  const sameProduct = { partNumber: "OF-100", brand: "Bosch", description: "Oil Filter", mrp: "2499", price: "1999", stock: "12", compatibility: "Mahindra Bolero" };
  const existingKey = previewVendorBulkImport([sameProduct], "vendor-1").rows[0].vendorImportKey;
  const reimport = previewVendorBulkImport([sameProduct], "vendor-1", [existingKey]);
  assert.equal(reimport.validRows, 1);
  assert.equal(reimport.duplicates, 1);
  assert.equal(reimport.rows[0].alreadyExists, true);
});

test("duplicate identity includes each required field and supplied category and compatibility", () => {
  const base = {
    partNumber: "PN-100",
    brand: "Acme",
    description: "Original description",
    mrp: "1500",
    price: "1250",
    stock: "5",
    category: "Filters",
    compatibility: "Volvo FM",
  };
  const changedFields = [
    { partNumber: "PN-101" },
    { brand: "Other brand" },
    { description: "Different description" },
    { mrp: "1501" },
    { price: "1251" },
    { stock: "6" },
    { category: "Brakes" },
    { compatibility: "Mahindra Bolero" },
  ];

  for (const change of changedFields) {
    const result = previewVendorBulkImport([base, { ...base, ...change }], "vendor-1");
    assert.equal(result.validRows, 2, `field change ${JSON.stringify(change)} should create a distinct product`);
    assert.equal(result.duplicates, 0);
    assert.equal(result.invalidRows, 0);
  }
});

test("quantity is optional, excluded from duplicate identity, and never summed", () => {
  const csv = [
    "Part Number,Brand,Description,Selling Price,MRP,Availability / Stock,Quantity",
    "PN-200,Acme,Clutch assembly,1250,1500,5,3",
    "PN-200,Acme,Clutch assembly,1250,1500,5,9",
  ].join("\n");
  const parsed = parseBulkImportFile(Buffer.from(csv), "quantity.csv");
  const result = previewVendorBulkImport(parsed, "vendor-1");

  assert.equal(result.validRows, 1);
  assert.equal(result.duplicates, 1);
  assert.equal(result.invalidRows, 0);
  assert.equal(result.rows[0].stock, 5);
  assert.equal(result.rows[0].quantity, 3);
});

test("blank optional category and compatible vehicle cells are accepted", () => {
  const csv = [
    "Part Number,Brand,Description,Selling Price,MRP,Availability / Stock,Category,Compatible Vehicle",
    "PN-300,Acme,Clutch assembly,1250,1500,5,,",
  ].join("\n");
  const parsed = parseBulkImportFile(Buffer.from(csv), "blank-optionals.csv");
  const result = previewVendorBulkImport(parsed, "vendor-1");

  assert.equal(result.validRows, 1);
  assert.equal(result.invalidRows, 0);
  assert.equal(Object.hasOwn(result.rows[0], "category"), false);
  assert.equal(Object.hasOwn(result.rows[0], "compatibility"), false);
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
    ["Part Number", "Brand", "Description", "Selling Price", "MRP", "Availability / Stock", "Compatible Vehicle", "Category"],
    ["CP-440", "Valeo", "Clutch Plate", 4250, 5000, 8, "Volvo FM", "Clutch"],
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
        category: preview.rows[0].category,
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
        category: "Clutch",
      },
    );
  }
});

test("bulk import parses valid CSV headers and maps the required product fields", () => {
  const csv = [
    "Part Number,Brand,Description,Selling Price,MRP,Availability / Stock",
    "CSV-100,Acme,Clutch assembly,1250,1500,4",
    "CSV-100,Acme,Clutch assembly,1250,1500,4",
  ].join("\n");
  const parsed = parseBulkImportFile(Buffer.from(csv), "parts.csv");
  const preview = previewVendorBulkImport(parsed, "vendor-1");

  assert.equal(preview.validRows, 1);
  assert.equal(preview.duplicates, 1);
  assert.deepEqual(
    {
      partNumber: preview.rows[0].partNumber,
      brand: preview.rows[0].brand,
      description: preview.rows[0].description,
      mrp: preview.rows[0].mrp,
      price: preview.rows[0].price,
      stock: preview.rows[0].stock,
    },
    {
      partNumber: "CSV-100",
      brand: "Acme",
      description: "Clutch assembly",
      mrp: 1500,
      price: 1250,
      stock: 4,
    },
  );
});

test("bulk import accepts CSV with optional columns omitted", () => {
  const csv = [
    "Part Number,Brand,Description,Selling Price,MRP,Availability / Stock",
    "CSV-101,Acme,Clutch assembly,1250,1500,4",
  ].join("\n");
  const parsed = parseBulkImportFile(Buffer.from(csv), "parts-minimal.csv");
  const preview = previewVendorBulkImport(parsed, "vendor-1");

  assert.equal(preview.validRows, 1);
  assert.equal(preview.rows[0].name, "Clutch assembly");
  assert.equal(preview.rows[0].description, "Clutch assembly");
  assert.equal(preview.rows[0].mrp, 1500);
  assert.equal(preview.rows[0].stock, 4);
  for (const field of ["compatibility", "category"]) {
    assert.equal(Object.hasOwn(preview.rows[0], field), false);
  }
});

test("bulk import maps all optional CSV columns when supplied", () => {
  const csv = [
    "Part Number,Brand,Description,Selling Price,MRP,Availability / Stock,Category,Compatible Vehicle",
    "CSV-102,Acme,Clutch assembly,1250,1500,4,Clutch,Volvo FM",
  ].join("\n");
  const parsed = parseBulkImportFile(Buffer.from(csv), "parts-with-optionals.csv");
  const preview = previewVendorBulkImport(parsed, "vendor-1");

  assert.equal(preview.validRows, 1);
  assert.deepEqual(
    {
      name: preview.rows[0].name,
      description: preview.rows[0].description,
      price: preview.rows[0].price,
      category: preview.rows[0].category,
      compatibility: preview.rows[0].compatibility,
      stock: preview.rows[0].stock,
      mrp: preview.rows[0].mrp,
    },
    {
      name: "Clutch assembly",
      description: "Clutch assembly",
      price: 1250,
      category: "Clutch",
      compatibility: "Volvo FM",
      stock: 4,
      mrp: 1500,
    },
  );
});

test("bulk import accepts XLSX with optional columns omitted", () => {
  const workbook = workbookBuffer([
    ["Part Number", "Brand", "Description", "Selling Price", "MRP", "Availability / Stock"],
    ["XLSX-101", "Acme", "Clutch assembly", 1250, 1500, 4],
  ]);
  const parsed = parseBulkImportFile(workbook, "parts-minimal.xlsx");
  const preview = previewVendorBulkImport(parsed, "vendor-1");

  assert.equal(preview.validRows, 1);
  assert.equal(preview.rows[0].name, "Clutch assembly");
  assert.equal(preview.rows[0].description, "Clutch assembly");
  assert.equal(preview.rows[0].price, 1250);
  assert.equal(preview.rows[0].mrp, 1500);
  assert.equal(preview.rows[0].stock, 4);
  for (const field of ["compatibility", "category"]) {
    assert.equal(Object.hasOwn(preview.rows[0], field), false);
  }
});

test("bulk import maps all optional XLSX columns when supplied", () => {
  const workbook = workbookBuffer([
    ["Part Number", "Brand", "Description", "Selling Price", "MRP", "Availability / Stock", "Category", "Compatible Vehicle"],
    ["XLSX-102", "Acme", "Clutch assembly", 1250, 1500, 4, "Clutch", "Volvo FM"],
  ]);
  const parsed = parseBulkImportFile(workbook, "parts-with-optionals.xlsx");
  const preview = previewVendorBulkImport(parsed, "vendor-1");

  assert.equal(preview.validRows, 1);
  assert.deepEqual(
    {
      name: preview.rows[0].name,
      description: preview.rows[0].description,
      price: preview.rows[0].price,
      category: preview.rows[0].category,
      compatibility: preview.rows[0].compatibility,
      stock: preview.rows[0].stock,
      mrp: preview.rows[0].mrp,
    },
    {
      name: "Clutch assembly",
      description: "Clutch assembly",
      price: 1250,
      category: "Clutch",
      compatibility: "Volvo FM",
      stock: 4,
      mrp: 1500,
    },
  );
});

test("bulk import rejects missing required headers and values instead of inventing product data", () => {
  const requiredHeaders = ["Part Number", "Brand", "Description", "Selling Price", "MRP", "Availability / Stock"];
  for (const [missingHeaderIndex, missingHeader] of requiredHeaders.entries()) {
    let parseError;
    const headers = requiredHeaders.filter((header) => header !== missingHeader);
    const csv = `${headers.join(",")}\n${headers.map(() => "value").join(",")}\n`;
    assert.throws(
      () => parseBulkImportFile(Buffer.from(csv), `missing-required-${missingHeaderIndex}.csv`),
      (error) => {
        parseError = error;
        return /missing required columns:/i.test(error.message);
      },
    );
    assert.equal(isVendorBulkImportInputError(parseError), true);
  }
  assert.equal(isVendorBulkImportInputError(new Error("Firestore unavailable")), false);

  const result = previewVendorBulkImport([
    { rowNumber: 2, values: { partNumber: "PN-1", brand: "Brand", description: "Part", price: "", mrp: "100", stock: "2" } },
  ], "vendor-1");
  assert.equal(result.validRows, 0);
  assert.match(result.errors[0].errors.join(" "), /selling price/i);
});

test("bulk import enforces file, row, and column limits before cell scanning", () => {
  assert.throws(
    () => parseBulkImportFile(Buffer.alloc(BULK_IMPORT_LIMITS.maxFileSize + 1), "large.csv"),
    /too large/i,
  );

  const header = ["Part Number", "Brand", "Description", "MRP", "Selling Price", "Availability/Stock", "Compatible Vehicle", "Category"];
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
    ["Part Number", "Brand", "Description", "MRP", "Selling Price", "Availability/Stock", "Compatible Vehicle", "Category"],
    ["CP-440", "Valeo", "Clutch Plate", 5000, 4250, 8, "Volvo FM", "Clutch"],
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

test("bulk imports accept omitted optional values and preserve validation for supplied values", () => {
  const result = previewVendorBulkImport([
    { rowNumber: 2, values: { description: "Universal Part", partNumber: "U-1", brand: "Brand", price: "900", mrp: "1000", stock: "2" } },
    { rowNumber: 3, values: { description: "Invalid MRP", partNumber: "V-1", brand: "Brand", price: "900", mrp: "not-a-price", stock: "2" } },
    { rowNumber: 4, values: { description: "Invalid Stock", partNumber: "W-1", brand: "Brand", price: "900", mrp: "1000", stock: "1.5" } },
    { rowNumber: 5, values: { description: "Invalid Quantity", partNumber: "Q-1", brand: "Brand", price: "900", mrp: "1000", stock: "2", quantity: "1.5" } },
  ], "vendor-1");

  assert.equal(result.validRows, 1);
  assert.equal(result.invalidRows, 3);
  assert.equal(result.rows[0].name, "Universal Part");
  assert.equal(result.rows[0].mrp, 1000);
  assert.equal(result.rows[0].stock, 2);
  assert.equal(Object.hasOwn(result.rows[0], "compatibility"), false);
  assert.match(result.errors[0].errors.join(" "), /MRP/i);
  assert.match(result.errors[1].errors.join(" "), /availability/i);
  assert.match(result.errors[2].errors.join(" "), /quantity/i);
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
  assert.equal(result.rows[0].alreadyExists, false);
  assert.equal(result.rows[0].sellerId, "vendor-1");
});

test("bulk import create builder sets new listings pending and strips preview metadata", () => {
  const product = {
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
    rowNumber: 4,
    alreadyExists: false,
  };

  const created = buildVendorImportCreate(product, "vendor-1");
  assert.equal(created.sellerId, "vendor-1");
  assert.equal(created.sellerType, "vendor");
  assert.equal(created.status, "pending");
  assert.equal(created.enabled, false);
  assert.equal(created.partNumber, "OF-100");
  assert.equal(created.name, "Updated Oil Filter");
  assert.equal(Object.prototype.hasOwnProperty.call(created, "rowNumber"), false);
  assert.equal(Object.prototype.hasOwnProperty.call(created, "alreadyExists"), false);
  assert.equal(created.createdAt.length > 0, true);
});

test("template includes required product columns and max rows remains configurable", () => {
  const template = generateVendorBulkImportTemplate();
  assert.deepEqual(REQUIRED_IMPORT_COLUMNS, ["partNumber", "brand", "description", "price", "mrp", "stock"]);
  assert.deepEqual(OPTIONAL_IMPORT_COLUMNS, ["category", "compatibility", "quantity"]);
  const expectedHeaders = ["Part Number", "Brand", "Description", "Selling Price", "MRP", "Availability / Stock", "Category", "Compatible Vehicle", "Quantity"];
  assert.deepEqual(template.split(","), expectedHeaders);
  assert.doesNotMatch(template, /MOQ|Part Name/);
  const workbook = XLSX.read(generateVendorBulkImportWorkbook(), { type: "buffer" });
  const headers = XLSX.utils.sheet_to_json(workbook.Sheets.Products, { header: 1 })[0];
  assert.deepEqual(headers, expectedHeaders);
  assert.ok(BULK_IMPORT_LIMITS.maxRows > 10);
});
