import { FieldPath } from "firebase-admin/firestore";
import { createRateLimiter } from "./rateLimiter.js";
import { resolveLegacySellerOwnership } from "./sellerOwnership.js";
import { isEligibleVendorEnquiryProduct, isValidSupplierDocumentId } from "./vendorEnquiries.js";
import { sanitizePublicProduct } from "./productPrivacy.js";
import { normalizePublicProductForEligibility } from "./publicProductEligibility.js";

const publicProductCatalogLimiter = createRateLimiter({
  limit: 120,
  windowMs: 60 * 1000,
  maxKeys: 10000,
});

function eligiblePublicProductDocuments(database, documents) {
  const legacyProductIds = documents
    .filter((document) => document.exists && !document.data()?.sellerType)
    .map((document) => document.id);
  const legacyOwnershipPromise = legacyProductIds.length
    ? resolveLegacySellerOwnership(legacyProductIds, async (productIds) => {
      const linkQueries = [];
      for (let index = 0; index < productIds.length; index += 30) {
        linkQueries.push(database.collection("vendorProductLinks")
          .where("productId", "in", productIds.slice(index, index + 30))
          .get());
      }
      const linkSnapshots = await Promise.all(linkQueries);
      return linkSnapshots.flatMap((snapshot) => snapshot.docs.map((link) => ({ id: link.id, ...link.data() })));
    })
    : Promise.resolve(new Map());
  return legacyOwnershipPromise.then((legacyOwnership) => {
    const eligible = documents
      .filter((document) => document.exists)
      .map((document) => ({
        document,
        product: normalizePublicProductForEligibility(document.id, {
          ...document.data(),
          ...(legacyOwnership.get(document.id) || {}),
        }),
      }))
      .filter(({ product }) => product !== null);
    const vendorIds = [...new Set(eligible
      .filter(({ product }) => product.sellerType.toLowerCase() === "vendor")
      .map(({ product }) => product.sellerId)
      .filter(Boolean))];
    const vendorSnapshotsPromise = vendorIds.length
      ? database.getAll(...vendorIds.map((vendorId) => database.collection("users").doc(vendorId)))
      : Promise.resolve([]);
    return vendorSnapshotsPromise.then((vendorSnapshots) => {
      const vendorsById = new Map(vendorSnapshots.map((snapshot) => [snapshot.id, snapshot.exists ? snapshot.data() : null]));
      return eligible
        .filter(({ product }) => product.sellerType.toLowerCase() !== "vendor"
          || isEligibleVendorEnquiryProduct(product, vendorsById.get(product.sellerId)))
        .map(({ document, product }) => ({
          document,
          vendorBusinessName: product.sellerType.toLowerCase() === "vendor"
            ? String(vendorsById.get(product.sellerId)?.vendorProfile?.businessName || "").trim()
            : "",
        }));
    });
  });
}

function publicProductRecord({ document, vendorBusinessName }) {
  const rawProduct = { ...document.data() };
  delete rawProduct.vendorBusinessName;
  delete rawProduct.vendorName;
  delete rawProduct.soldBy;
  return sanitizePublicProduct({
    id: document.id,
    ...rawProduct,
    ...(vendorBusinessName ? { vendorBusinessName } : {}),
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
    const after = String(request.query.after || "").trim();
    const category = String(request.query.category || "").trim();
    const requestedLimit = request.query.limit === undefined ? 100 : Number(request.query.limit);
    const scanLimit = Number.isInteger(requestedLimit) && requestedLimit >= 1 && requestedLimit <= 100
      ? requestedLimit
      : null;
    if (after && !isValidSupplierDocumentId(after)) {
      return response.status(400).json({ message: "The product catalogue cursor is invalid." });
    }
    if (scanLimit === null) {
      return response.status(400).json({ message: "The product catalogue page size must be between 1 and 100." });
    }
    if (category.length > 120) {
      return response.status(400).json({ message: "The product catalogue category is invalid." });
    }
    try {
      const database = getDb();
      let productsQuery = database.collection("products");
      productsQuery = category
        ? productsQuery.where("category", "==", category).orderBy(FieldPath.documentId(), "asc")
        : productsQuery.orderBy("createdAt", "desc").orderBy(FieldPath.documentId(), "desc");
      if (after) {
        const cursorSnapshot = await database.collection("products").doc(after).get();
        if (!cursorSnapshot.exists) {
          return response.status(400).json({ message: "The product catalogue cursor is invalid." });
        }
        productsQuery = productsQuery.startAfter(cursorSnapshot);
      }
      const snapshot = await productsQuery.limit(scanLimit).get();
      const documents = await eligiblePublicProductDocuments(database, snapshot.docs);
      return response.json({
        products: documents.map(publicProductRecord),
        scanCursor: snapshot.docs.at(-1)?.id || after,
        hasMore: snapshot.size === scanLimit,
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
      const eligibleDocuments = await eligiblePublicProductDocuments(database, documents);
      return response.json({
        products: eligibleDocuments.map(publicProductRecord),
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
      if (!document.exists) {
        return response.status(404).json({ message: "Product not found." });
      }
      const [eligibleDocument] = await eligiblePublicProductDocuments(database, [document]);
      if (!eligibleDocument) return response.status(404).json({ message: "Product not found." });
      return response.json({ product: publicProductRecord(eligibleDocument) });
    } catch (error) {
      console.error("Public product could not be loaded:", error?.code || "firestore_error");
      return response.status(500).json({ message: "The product could not be loaded." });
    }
  });
}
