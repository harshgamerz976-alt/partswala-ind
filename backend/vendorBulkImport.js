import XLSX from "xlsx";

export const BULK_IMPORT_LIMITS = {
  maxFileSize: 5 * 1024 * 1024,
  maxRows: 250,
  maxColumns: 30,
};

export const REQUIRED_IMPORT_COLUMNS = [
  "partNumber",
  "brand",
  "description",
  "mrp",
  "price",
  "stock",
  "compatibility",
];

const HEADER_ALIASES = {
  "part name": "name",
  "product name": "name",
  "item name": "name",
  "part number": "partNumber",
  "product number": "partNumber",
  "sku": "partNumber",
  "brand": "brand",
  "category": "category",
  "description": "description",
  "price in inr": "price",
  "selling price": "price",
  "mrp": "mrp",
  "minimum order quantity": "moq",
  "moq": "moq",
  "qty": "stock",
  "quantity": "stock",
  "availability": "stock",
  "availability stock": "stock",
  "stock": "stock",
  "make": "vehicleMake",
  "manufacturer": "vehicleMake",
  "model": "vehicleModel",
  "year": "vehicleYear",
  "compatible vehicle": "compatibility",
  "compatibility": "compatibility",
  "vehicle compatibility": "compatibility",
};

const IMPORT_TEMPLATE_COLUMNS = [
  "Part Number",
  "Brand",
  "Description",
  "MRP",
  "Selling Price",
  "Availability/Stock",
  "Compatible Vehicle",
];

function normalizeHeader(rawHeader) {
  const key = String(rawHeader ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
  if (!key) return "";
  if (HEADER_ALIASES[key]) return HEADER_ALIASES[key];
  return key.replace(/\s+/g, "_");
}

export function isFormulaInjectionCandidate(value) {
  if (value === null || value === undefined) return false;
  const text = String(value).trim();
  if (!text) return false;
  return /^\s*(?:=|\+|-|@)/.test(text)
    || /(?:^|[\s(])(?:javascript:|vbscript:|data:text\/html|on\w+\s*=)/i.test(text)
    || /(?:cmd\s*\(|powershell\s*-c|eval\s*\(|alert\s*\()/i.test(text);
}

export function sanitizeCellValue(rawValue) {
  if (rawValue === null || rawValue === undefined) return "";
  if (rawValue instanceof Date) return rawValue.toISOString();
  const text = String(rawValue).trim();
  if (!text) return "";
  if (isFormulaInjectionCandidate(text)) {
    throw new Error("Malicious spreadsheet content detected in a product import row.");
  }
  return text.replace(/\r?\n+/g, " ").replace(/\s+/g, " ").trim();
}

function pickValue(row, keys) {
  for (const key of keys) {
    if (row[key] !== undefined && row[key] !== null && String(row[key]).trim() !== "") return row[key];
  }
  return "";
}

function parseImportNumber(value) {
  const normalized = String(value ?? "").trim().replace(/^(?:₹|INR|Rs\.?)/i, "").replace(/[,\s]/g, "");
  return /^[-+]?\d+(?:\.\d+)?$/.test(normalized) ? Number(normalized) : Number.NaN;
}

export function generateVendorBulkImportTemplate() {
  return [IMPORT_TEMPLATE_COLUMNS.join(",")].join("\n");
}

export function generateVendorBulkImportWorkbook() {
  const workbook = XLSX.utils.book_new();
  const worksheet = XLSX.utils.aoa_to_sheet([IMPORT_TEMPLATE_COLUMNS]);
  XLSX.utils.book_append_sheet(workbook, worksheet, "Products");
  return XLSX.write(workbook, { type: "buffer", bookType: "xlsx" });
}

export function parseBulkImportFile(buffer, fileName) {
  const extension = String(fileName || "").split(".").pop()?.toLowerCase() || "";
  if (!/[a-z0-9]+/.test(extension) || !["csv", "xlsx", "xls"].includes(extension)) {
    throw new Error("Unsupported file type. Upload a CSV or Excel workbook (.csv, .xlsx, .xls). ");
  }
  if (!buffer || !buffer.length) {
    throw new Error("The uploaded file is empty.");
  }
  if (buffer.length > BULK_IMPORT_LIMITS.maxFileSize) {
    throw new Error(`Uploaded file is too large. Maximum size is ${Math.round(BULK_IMPORT_LIMITS.maxFileSize / (1024 * 1024))} MB.`);
  }
  if (extension === "xlsx" && buffer.subarray(0, 4).toString("hex") !== "504b0304") {
    throw new Error("The spreadsheet could not be read as a valid CSV or Excel workbook.");
  }
  if (extension === "xls" && buffer.subarray(0, 8).toString("hex") !== "d0cf11e0a1b11ae1") {
    throw new Error("The spreadsheet could not be read as a valid CSV or Excel workbook.");
  }

  let workbook;
  try {
    workbook = extension === "csv"
      ? XLSX.read(buffer.toString("utf8"), {
        type: "string",
        raw: false,
        cellDates: true,
        WTF: false,
        sheetRows: BULK_IMPORT_LIMITS.maxRows + 1,
      })
      : XLSX.read(buffer, {
        type: "buffer",
        raw: false,
        cellDates: true,
        WTF: false,
        sheetRows: BULK_IMPORT_LIMITS.maxRows + 1,
      });
  } catch {
    throw new Error("The spreadsheet could not be read as a valid CSV or Excel workbook.");
  }
  const firstSheetName = workbook.SheetNames[0];
  if (!firstSheetName) {
    throw new Error("The spreadsheet does not contain any worksheet data.");
  }
  const sheet = workbook.Sheets[firstSheetName];
  let range;
  let fullRange;
  try {
    range = sheet && sheet["!ref"] ? XLSX.utils.decode_range(sheet["!ref"]) : null;
    fullRange = sheet && sheet["!fullref"]
      ? XLSX.utils.decode_range(sheet["!fullref"])
      : range;
  } catch {
    throw new Error("The spreadsheet could not be read as a valid CSV or Excel workbook.");
  }
  if (!range) {
    throw new Error("The spreadsheet does not contain any worksheet data.");
  }
  if (fullRange && fullRange.e.c - fullRange.s.c + 1 > BULK_IMPORT_LIMITS.maxColumns) {
    throw new Error(`The spreadsheet exceeds the supported column count (${BULK_IMPORT_LIMITS.maxColumns}).`);
  }
  if (fullRange && fullRange.e.r - fullRange.s.r + 1 > BULK_IMPORT_LIMITS.maxRows + 1) {
    throw new Error(`Import exceeds the row limit (${BULK_IMPORT_LIMITS.maxRows}).`);
  }
  if (range) {
    for (let rowIndex = range.s.r; rowIndex <= range.e.r; rowIndex += 1) {
      for (let colIndex = range.s.c; colIndex <= range.e.c; colIndex += 1) {
        const cellAddress = XLSX.utils.encode_cell({ r: rowIndex, c: colIndex });
        const cell = sheet[cellAddress];
        if (!cell) continue;
        const rawValue = typeof cell.v === "string" ? cell.v.trim() : "";
        const formulaValue = typeof cell.f === "string" ? cell.f.trim() : "";
        if (cell.f || cell.t === "e" || rawValue.startsWith("=") || formulaValue.startsWith("=")) {
          throw new Error("Malicious spreadsheet content detected in a product import row.");
        }
      }
    }
  }
  const rows = XLSX.utils.sheet_to_json(sheet, {
    defval: "",
    raw: false,
    blankrows: false,
    header: 1,
  });
  if (!Array.isArray(rows) || rows.length === 0) {
    throw new Error("The spreadsheet is empty or does not contain any rows.");
  }
  const headerRow = Array.isArray(rows[0]) ? rows[0] : [];
  if (headerRow.length === 0 || headerRow.every((cell) => String(cell ?? "").trim() === "")) {
    throw new Error("The spreadsheet is missing a header row.");
  }
  if (headerRow.length > BULK_IMPORT_LIMITS.maxColumns) {
    throw new Error(`The spreadsheet exceeds the supported column count (${BULK_IMPORT_LIMITS.maxColumns}).`);
  }
  const normalizedHeaders = new Set(headerRow.map(normalizeHeader));
  const missingColumns = REQUIRED_IMPORT_COLUMNS.filter((column) => !normalizedHeaders.has(column));
  if (missingColumns.length) {
    throw new Error(`The spreadsheet is missing required columns: ${missingColumns.join(", ")}.`);
  }

  const dataRows = rows.slice(1).filter((row) => Array.isArray(row) && row.some((cell) => String(cell ?? "").trim() !== ""));
  if (dataRows.length === 0) {
    throw new Error("The spreadsheet contains no valid product rows.");
  }
  if (dataRows.length > BULK_IMPORT_LIMITS.maxRows) {
    throw new Error(`Import exceeds the row limit (${BULK_IMPORT_LIMITS.maxRows}).`);
  }

  return dataRows.map((row, index) => {
    const normalizedRow = {};
    headerRow.forEach((header, headerIndex) => {
      const key = normalizeHeader(header);
      const value = Array.isArray(row) ? row[headerIndex] : undefined;
      if (!key) return;
      try {
        normalizedRow[key] = sanitizeCellValue(value);
      } catch (error) {
        throw new Error(`${error.message} (row ${index + 2})`);
      }
    });
    return { rowNumber: index + 2, values: normalizedRow };
  });
}

export function buildVendorImportProduct(row, vendorId) {
  const values = row && typeof row === "object" ? row : {};
  const description = sanitizeCellValue(pickValue(values, ["description", "product_description", "summary"]));
  const name = sanitizeCellValue(pickValue(values, ["name", "product_name", "part_name"])) || description;
  const partNumber = sanitizeCellValue(pickValue(values, ["partNumber", "part_number", "sku"]));
  const brand = sanitizeCellValue(pickValue(values, ["brand", "manufacturer"]));
  const price = parseImportNumber(pickValue(values, ["price", "selling_price", "price_in_inr"]));
  const mrp = parseImportNumber(pickValue(values, ["mrp", "listed_mrp", "maximum_retail_price"]));
  const stockValue = parseImportNumber(pickValue(values, ["stock", "availability", "quantity"]));
  const moqValue = parseImportNumber(pickValue(values, ["moq", "minimum_order_quantity"]) || "1");
  const vehicleMake = sanitizeCellValue(pickValue(values, ["vehicleMake", "make", "manufacturer_name"])) || "";
  const vehicleModel = sanitizeCellValue(pickValue(values, ["vehicleModel", "model"])) || "";
  const vehicleYear = sanitizeCellValue(pickValue(values, ["vehicleYear", "year"])) || "";
  const compatibility = sanitizeCellValue(pickValue(values, ["compatibility", "vehicle_compatibility"])) || [vehicleMake, vehicleModel, vehicleYear].filter(Boolean).join(" ").trim();

  const errors = [];
  if (!name) errors.push("Missing part name.");
  if (!partNumber) errors.push("Missing part number.");
  if (!brand) errors.push("Missing brand.");
  if (!Number.isFinite(mrp) || mrp <= 0) errors.push("Invalid MRP in INR.");
  if (!Number.isFinite(price) || price <= 0) errors.push("Invalid selling price in INR.");
  if (!Number.isSafeInteger(moqValue) || moqValue <= 0) errors.push("Invalid MOQ.");
  if (!Number.isSafeInteger(stockValue) || stockValue < 0) errors.push("Invalid availability.");
  if (!compatibility) errors.push("Missing compatible vehicle.");

  if (errors.length) {
    return { valid: false, errors };
  }

  const productKey = buildVendorImportKey(vendorId, partNumber, brand);
  const product = {
    name,
    partNumber,
    brand,
    description,
    price: Number(price.toFixed(2)),
    mrp: Number(mrp.toFixed(2)),
    stock: Math.max(0, Math.round(stockValue)),
    moq: Math.max(1, Math.round(moqValue)),
    compatibility,
    sellerType: "vendor",
    sellerId: String(vendorId || "").trim(),
    vendorSource: "bulk_import",
    enabled: false,
    status: "pending",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    vendorImportKey: productKey,
  };
  const category = sanitizeCellValue(pickValue(values, ["category", "product_category", "category_name"]));
  if (category) product.category = category;

  return { valid: true, product, productKey };
}

export function buildVendorImportKey(vendorId, partNumber, brand) {
  return `${String(vendorId || "").trim().toLowerCase()}|${String(partNumber || "").trim().toLowerCase()}|${String(brand || "").trim().toLowerCase()}`;
}

export function buildVendorImportUpdate(existingProduct = {}, incomingProduct = {}, vendorId) {
  const existingRecord = existingProduct && typeof existingProduct === "object" ? existingProduct : {};
  const incomingRecord = incomingProduct && typeof incomingProduct === "object" ? incomingProduct : {};
  const timestamp = new Date().toISOString();

  const basePayload = { ...incomingRecord };
  delete basePayload.createdAt;
  delete basePayload.updatedAt;
  delete basePayload.enabled;
  delete basePayload.status;
  delete basePayload.sellerId;
  delete basePayload.sellerType;
  delete basePayload.vendorImportKey;
  delete basePayload.vendorSource;
  delete basePayload.rowNumber;
  delete basePayload.updateExisting;

  const finalPayload = {
    ...existingRecord,
    ...basePayload,
    updatedAt: timestamp,
    sellerType: existingRecord.sellerType || "vendor",
    sellerId: existingRecord.sellerId || String(vendorId || "").trim() || incomingRecord.sellerId || "",
    vendorImportKey: incomingRecord.vendorImportKey || existingRecord.vendorImportKey,
    vendorSource: incomingRecord.vendorSource || existingRecord.vendorSource || "bulk_import",
  };

  if (Object.keys(existingRecord).length === 0) {
    finalPayload.createdAt = timestamp;
    finalPayload.enabled = false;
    finalPayload.status = "pending";
    return finalPayload;
  }

  finalPayload.createdAt = existingRecord.createdAt || timestamp;
  finalPayload.enabled = Object.prototype.hasOwnProperty.call(existingRecord, "enabled") ? existingRecord.enabled : false;
  finalPayload.status = Object.prototype.hasOwnProperty.call(existingRecord, "status") ? existingRecord.status : "pending";
  return finalPayload;
}

export function previewVendorBulkImport(rows, vendorId, existingKeys = []) {
  const seen = new Set();
  const existing = new Set((existingKeys || []).map((key) => String(key).trim().toLowerCase()));
  const validRows = [];
  const invalidRows = [];
  let duplicates = 0;

  for (const row of rows) {
    const asRow = row && typeof row === "object" && row.values ? row.values : row;
    const rowNumber = row && row.rowNumber ? row.rowNumber : 2;
    try {
      const result = buildVendorImportProduct(asRow, vendorId);
      if (!result.valid) {
        invalidRows.push({ rowNumber, errors: result.errors });
        continue;
      }
      if (seen.has(result.productKey)) {
        invalidRows.push({ rowNumber, errors: ["Duplicate row within the same import file."] });
        continue;
      }
      seen.add(result.productKey);

      if (existing.has(result.productKey)) {
        duplicates += 1;
        validRows.push({ rowNumber, ...result.product, updateExisting: true });
        continue;
      }

      validRows.push({ rowNumber, ...result.product, updateExisting: false });
    } catch (error) {
      invalidRows.push({ rowNumber, errors: [error.message || "Row is invalid."] });
    }
  }

  return {
    totalRows: rows.length,
    validRows: validRows.length,
    invalidRows: invalidRows.length,
    duplicates,
    rows: validRows,
    errors: invalidRows,
  };
}
