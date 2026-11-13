import { FieldPath } from "firebase-admin/firestore";
import {
  filterProducts,
  isEligibleProduct,
  normalizeCatalogFilters,
  normalizeProduct,
  parseCatalogFilters,
  serializeCatalogFilters,
} from "../src/services/productCatalog.js";
import { createRateLimiter } from "./rateLimiter.js";
import { isEligibleVendorEnquiryProduct, isValidSupplierDocumentId } from "./vendorEnquiries.js";
import { serializePublicProduct } from "./productPrivacy.js";
import { normalizePublicProductForEligibility } from "./publicProductEligibility.js";
import {
  approvedVendorBusinessName,
  catalogCandidateSearch,
  searchCandidateNgram,
} from "./publicProductCatalogIndex.js";

const publicProductCatalogLimiter = createRateLimiter({
  limit: 120,
  windowMs: 60 * 1000,
  maxKeys: 10000,
});
const LIST_FIELDS = new Set([
  "id",
  "name",
  "title",
  "partNumber",
  "brand",
  "category",
  "price",
  "mrp",
  "stock",
  "imageUrl",
  "compatibility",
  "vehicleMake",
  "vehicleModel",
  "vehicleYear",
  "sellerType",
  "sellerId",
  "vendorBusinessName",
  "enabled",
  "status",
  "createdAt",
  "updatedAt",
]);

function getCatalogFilters(request) {
  const params = new URLSearchParams();
  for (const key of [
    "search",
    "category",
    "compatibility",
    "brand",
    "vehicleMake",
    "vehicleModel",
    "minPrice",
    "maxPrice",
    "minDiscount",
    "stockStatus",
    "sortBy",
  ]) {
    const value = request.query[key];
    if (typeof value === "string") params.set(key, value);
  }
  return normalizeCatalogFilters(parseCatalogFilters(params));
}

function cursorFilterKey(filters) {
  return serializeCatalogFilters({ ...filters, sortBy: "newest" });
}

function encodeCatalogCursor(after, filters) {
  return Buffer.from(JSON.stringify({ version: 1, after, filters: cursorFilterKey(filters) })).toString("base64url");
}

function decodeCatalogCursor(value, filters) {
  if (typeof value !== "string" || value.length > 1024) return null;
  try {
    const cursor = JSON.parse(Buffer.from(value, "base64url").toString("utf8"));
    if (cursor?.version !== 1
      || typeof cursor.after !== "string"
      || !isValidSupplierDocumentId(cursor.after)
      || cursor.filters !== cursorFilterKey(filters)) return null;
    return cursor.after;
  } catch {
    return null;
  }
}

function serializeCatalogListing(product) {
  const full = serializePublicProduct(product);
  full.imageUrl = full.imageUrl || full.images?.[0] || "";
  return Object.fromEntries(Object.entries(full).filter(([field]) => LIST_FIELDS.has(field)));
}

async function eligiblePublicProductRecords(database, documents) {
  const candidates = documents
    .filter((document) => document.exists)
    .map((document) => ({
      document,
      rawProduct: document.data(),
      product: normalizePublicProductForEligibility(document.id, document.data()),
    }))
    .filter(({ product }) => product !== null && isEligibleProduct(product));
  const vendorIds = [...new Set(candidates
    .filter(({ product }) => product.sellerType.toLowerCase() === "vendor")
    .map(({ product }) => product.sellerId)
    .filter(Boolean))];
  const vendorSnapshots = vendorIds.length
    ? await database.getAll(...vendorIds.map((vendorId) => database.collection("users").doc(vendorId)))
    : [];
  const vendorsById = new Map(vendorSnapshots.map((snapshot) => [snapshot.id, snapshot.exists ? snapshot.data() : null]));

  return candidates
    .filter(({ product }) => product.sellerType.toLowerCase() !== "vendor"
      || isEligibleVendorEnquiryProduct(product, vendorsById.get(product.sellerId)))
    .map(({ document, rawProduct, product }) => {
      const vendor = product.sellerType.toLowerCase() === "vendor" ? vendorsById.get(product.sellerId) : null;
      const businessName = approvedVendorBusinessName(vendor);
      return {
        document,
        product,
        publicProduct: {
          ...rawProduct,
          id: document.id,
          ...(product.sellerType.toLowerCase() === "vendor" ? { vendorBusinessName: businessName } : {}),
        },
      };
    });
}

export function registerPublicProductCatalogRoutes(app, { getDb, resolveClientIp }) {
  function allowPublicProductCatalogRead(request, response) {
    const limit = publicProductCatalogLimiter.check(`ip:${resolveClientIp(request)}`);
    if (limit.allowed) return true;
    response.status(429).json({ message: "Too many product catalogue requests. Try again shortly." });
    return false;
  }

  app.get("/api/public-products", async (request, response) => {
    if (!allowPublicProductCatalogRead(request, response)) return;
    const pageSize = request.query.limit === undefined ? 20 : Number(request.query.limit);
    if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > 100) {
      return response.status(400).json({ message: "The product catalogue page size is invalid." });
    }

    const filters = getCatalogFilters(request);
    let after = null;
    if (request.query.cursor !== undefined) {
      after = decodeCatalogCursor(String(request.query.cursor), filters);
      if (!after) return response.status(400).json({ message: "The product catalogue cursor is invalid." });
    } else if (request.query.after !== undefined) {
      after = String(request.query.after || "").trim();
      if (!isValidSupplierDocumentId(after)) {
        return response.status(400).json({ message: "The product catalogue cursor is invalid." });
      }
    }

    try {
      const database = getDb();
      const batchSize = Math.min(100, pageSize + 1);
      const matchingProducts = [];
      let scanCursor = after;
      let hasMore = false;
      const indexedSearch = catalogCandidateSearch(filters);

      while (matchingProducts.length <= pageSize) {
        let productsQuery = database.collection("products").orderBy(FieldPath.documentId());
        if (indexedSearch) {
          productsQuery = productsQuery
            .where("catalogSearchNgrams", "array-contains", searchCandidateNgram(indexedSearch));
        } else {
          productsQuery = productsQuery.where("catalogEligible", "==", true);
        }
        if (filters.category) productsQuery = productsQuery.where("catalogCategory", "==", filters.category.toLowerCase());
        if (filters.stockStatus !== "all") {
          productsQuery = productsQuery.where("catalogAvailability", "==", filters.stockStatus);
        }
        if (scanCursor) productsQuery = productsQuery.startAfter(scanCursor);
        const snapshot = await productsQuery.limit(batchSize).get();
        if (!snapshot.docs.length) break;

        const approvedRecords = await eligiblePublicProductRecords(database, snapshot.docs);
        const approvedById = new Map(approvedRecords.map((record) => [record.document.id, record]));
        for (const document of snapshot.docs) {
          const record = approvedById.get(document.id);
          if (record && filterProducts([record.publicProduct], filters).length > 0) {
            if (matchingProducts.length === pageSize) {
              hasMore = true;
              break;
            }
            matchingProducts.push(record.publicProduct);
          }
          scanCursor = document.id;
        }

        if (hasMore || snapshot.size < batchSize) break;
      }

      const products = filterProducts(matchingProducts.map(normalizeProduct), filters)
        .map((product) => serializeCatalogListing(matchingProducts.find(({ id }) => id === product.id)));
      const nextCursor = hasMore && scanCursor
        ? encodeCatalogCursor(scanCursor, filters)
        : null;
      return response.json({
        products,
        hasMore,
        nextCursor,
        scanCursor,
      });
    } catch (error) {
      console.error("Public product catalogue could not be loaded:", error?.code || "firestore_error");
      return response.status(500).json({ message: "The product catalogue could not be loaded." });
    }
  });

  app.post("/api/public-products/by-ids", async (request, response) => {
    if (!allowPublicProductCatalogRead(request, response)) return;
    const productIds = request.body?.productIds;
    if (!Array.isArray(productIds) || productIds.length < 1 || productIds.length > 100
      || productIds.some((productId) => !isValidSupplierDocumentId(productId))) {
      return response.status(400).json({ message: "Provide between 1 and 100 valid product IDs." });
    }
    try {
      const database = getDb();
      const uniqueProductIds = [...new Set(productIds)];
      const documents = await database.getAll(...uniqueProductIds.map((productId) => database.collection("products").doc(productId)));
      const eligibleRecords = await eligiblePublicProductRecords(database, documents);
      return response.json({
        products: eligibleRecords.map(({ publicProduct }) => serializePublicProduct(publicProduct)),
      });
    } catch (error) {
      console.error("Public product records could not be loaded:", error?.code || "firestore_error");
      return response.status(500).json({ message: "The requested products could not be loaded." });
    }
  });

  app.get("/api/public-products/:productId", async (request, response) => {
    if (!allowPublicProductCatalogRead(request, response)) return;
    const productId = String(request.params.productId || "").trim();
    if (!isValidSupplierDocumentId(productId)) {
      return response.status(400).json({ message: "A valid product ID is required." });
    }
    try {
      const database = getDb();
      const document = await database.collection("products").doc(productId).get();
      const [record] = await eligiblePublicProductRecords(database, [document]);
      if (!record) return response.status(404).json({ message: "Product not found." });
      return response.json({ product: serializePublicProduct(record.publicProduct) });
    } catch (error) {
      console.error("Public product could not be loaded:", error?.code || "firestore_error");
      return response.status(500).json({ message: "The product could not be loaded." });
    }
  });
}
