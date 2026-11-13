import test from "node:test";
import assert from "node:assert/strict";
import {
  buildCatalogPage,
  buildFeaturedProductList,
  filterProducts,
  isEligibleProduct,
  normalizeCatalogFilters,
  normalizeProduct,
  parseCatalogFilters,
  serializeCatalogFilters,
  validateCatalogFilterInput,
} from "./productCatalog.js";

const sampleProducts = [
  {
    id: "p1",
    name: "Front brake pad",
    brand: "RoadPro",
    category: "Brakes",
    partNumber: "BP-1612",
    price: 100,
    mrp: 200,
    stock: "5",
    vehicleMake: "Tata",
    vehicleModel: "1612",
    compatibility: "Tata 1612 front axle",
    createdAt: "2026-01-01T00:00:00.000Z",
  },
  {
    id: "p2",
    name: "Rear brake shoe",
    brand: "RoadPro",
    category: "Brakes",
    partNumber: "BS-1612",
    price: "80",
    mrp: "100",
    stock: 0,
    vehicleMake: "Tata",
    vehicleModel: "1612",
    compatibility: "Tata 1612 rear axle",
    createdAt: { seconds: 1767225600 },
  },
  {
    id: "p3",
    name: "Clutch kit",
    brand: "GearWorks",
    category: "Clutch",
    partNumber: "CK-01",
    price: 300,
    mrp: 300,
    vehicleMake: "Ashok Leyland",
    vehicleModel: "Ecomet",
    compatibility: "Ecomet",
    createdAt: new Date("2026-03-01T00:00:00.000Z"),
  },
];

test("product normalization preserves unknown stock and does not infer compatibility or discounts", () => {
  const product = normalizeProduct({
    id: "no-stock",
    name: "Part",
    price: "120",
    compatibility: "Tata 1612",
    images: "not-an-image-array",
  });

  assert.equal(product.price, 120);
  assert.equal(product.mrp, null);
  assert.equal(product.stock, null);
  assert.equal(product.discountPercent, 0);
  assert.equal(product.vehicleMake, "");
  assert.equal(product.vehicleModel, "");
  assert.deepEqual(product.images, []);
  assert.equal(product.compatibility, "Tata 1612");
});

test("vendor products without a stored business name use a non-misleading seller label", () => {
  const product = normalizeProduct({
    id: "vendor-part",
    name: "Vendor part",
    price: 120,
    sellerId: "vendor-1",
    sellerType: "vendor",
  });

  assert.equal(product.vendorBusinessName, "");
  assert.equal(product.soldBy, "Vendor");
});

test("eligibility rejects unpublished, pending, deleted, and malformed price records", () => {
  const eligible = { id: "ok", name: "Part", price: 100, enabled: true };
  assert.equal(isEligibleProduct(eligible), true);
  assert.equal(isEligibleProduct({ ...eligible, status: "pending" }), false);
  assert.equal(isEligibleProduct({ ...eligible, status: "Available", approvalStatus: "pending" }), false);
  assert.equal(isEligibleProduct({ ...eligible, status: "Available", publishStatus: "rejected" }), false);
  assert.equal(isEligibleProduct({ ...eligible, status: "Available", approvalStatus: 12 }), false);
  assert.equal(isEligibleProduct({ ...eligible, status: "approved" }), true);
  assert.equal(isEligibleProduct({ ...eligible, enabled: false }), false);
  assert.equal(isEligibleProduct({ ...eligible, published: false }), false);
  assert.equal(isEligibleProduct({ ...eligible, enabled: "FALSE" }), false);
  assert.equal(isEligibleProduct({ ...eligible, deleted: true }), false);
  assert.equal(isEligibleProduct({ ...eligible, price: "₹100" }), false);
});

test("enabled products without legacy timestamps remain eligible for catalogue pages", () => {
  const legacyProduct = { id: "legacy", name: "Older filter", price: "125", enabled: true, status: "Available" };
  assert.equal(isEligibleProduct(legacyProduct), true);
  assert.deepEqual(buildCatalogPage([
    { id: "legacy", data: () => legacyProduct },
  ], 20).products.map((product) => product.id), ["legacy"]);
});

test("featured selections return at most six real eligible records", () => {
  const documents = Array.from({ length: 9 }, (_, index) => ({
    id: `featured-${index}`,
    data: () => ({
      name: `Part ${index}`,
      price: 100 + index,
      status: index === 1 ? "pending" : "Available",
      enabled: index !== 1,
    }),
  }));
  const featured = buildFeaturedProductList(documents, 20);
  assert.equal(featured.length, 6);
  assert.ok(featured.every((product) => product.id !== "featured-1" && isEligibleProduct(product)));
  assert.deepEqual(buildFeaturedProductList(documents, 0), []);
});

test("combined catalogue filters require actual structured values and verified price, discount, and stock", () => {
  const result = filterProducts(sampleProducts, {
    search: "Tata",
    category: "brakes",
    brand: "ROADPRO",
    vehicleMake: "tata",
    vehicleModel: "1612",
    minPrice: "80",
    maxPrice: "100",
    minDiscount: "40",
    stockStatus: "in-stock",
  });
  assert.deepEqual(result.map((product) => product.id), ["p1"]);

  assert.deepEqual(
    filterProducts(sampleProducts, { search: "Tata", stockStatus: "out-of-stock" }).map((product) => product.id),
    ["p2"],
  );
  assert.deepEqual(
    filterProducts(sampleProducts, { stockStatus: "unknown" }).map((product) => product.id),
    ["p3"],
  );
  assert.deepEqual(
    filterProducts(sampleProducts, { vehicleMake: "Tata", vehicleModel: "1612" }).map((product) => product.id),
    ["p1", "p2"],
  );
  assert.deepEqual(
    filterProducts(sampleProducts, { compatibility: "rear axle" }).map((product) => product.id),
    ["p2"],
  );
});

test("sorting handles numeric strings, ISO dates, Date objects, and Firestore timestamp shapes", () => {
  assert.deepEqual(filterProducts([
    { id: "serialized-timestamp", name: "New", price: 100, createdAt: { _seconds: 1772323200 } },
    { id: "older-iso", name: "Old", price: 100, createdAt: "2026-01-01T00:00:00.000Z" },
  ]).map((product) => product.id), ["serialized-timestamp", "older-iso"]);
  assert.deepEqual(filterProducts(sampleProducts, { sortBy: "price-low" }).map((product) => product.id), ["p2", "p1", "p3"]);
  assert.deepEqual(filterProducts(sampleProducts, { sortBy: "price-high" }).map((product) => product.id), ["p3", "p1", "p2"]);
  assert.deepEqual(filterProducts(sampleProducts, { sortBy: "oldest" }).map((product) => product.id), ["p1", "p2", "p3"]);
  assert.deepEqual(filterProducts(sampleProducts, { sortBy: "newest" }).map((product) => product.id), ["p3", "p1", "p2"]);
});

test("cursor pages advance by consumed Firestore documents even when filters omit records", () => {
  const documents = [
    { id: "pending", data: () => ({ name: "Pending part", price: 50, status: "pending", enabled: false }) },
    { id: "first", data: () => ({ name: "Visible one", price: 100, createdAt: "2026-01-01" }) },
    { id: "second", data: () => ({ name: "Visible two", price: 200, createdAt: "2026-01-02" }) },
  ];
  const firstPage = buildCatalogPage(documents, 2);
  assert.deepEqual(firstPage.products.map((product) => product.id), ["first"]);
  assert.equal(firstPage.cursor, documents[1]);
  assert.equal(firstPage.hasMore, true);

  const finalPage = buildCatalogPage(documents.slice(2), 2);
  assert.deepEqual(finalPage.products.map((product) => product.id), ["second"]);
  assert.equal(finalPage.cursor, null);
  assert.equal(finalPage.hasMore, false);
});

test("URL filter parsing drops invalid values, rejects invalid ranges, and clears a model without a make", () => {
  const filters = parseCatalogFilters("?search=Tata&minPrice=100&maxPrice=10&minDiscount=101&stockStatus=low-stock&sortBy=invalid&vehicleModel=1612&compatibility=rear");
  assert.equal(filters.search, "Tata");
  assert.equal(filters.compatibility, "rear");
  assert.equal(filters.minPrice, "");
  assert.equal(filters.maxPrice, "");
  assert.equal(filters.minDiscount, "");
  assert.equal(filters.stockStatus, "all");
  assert.equal(filters.sortBy, "newest");
  assert.equal(filters.vehicleModel, "");
  assert.equal(serializeCatalogFilters(filters), "search=Tata&compatibility=rear");
});

test("catalogue page controls keep search and sorting while dropping removed filters", () => {
  const parsed = parseCatalogFilters("?search=filter&category=Brakes&brand=RoadPro&minPrice=10&stockStatus=in-stock&sortBy=price-low");
  const visibleControls = normalizeCatalogFilters({ search: parsed.search, sortBy: parsed.sortBy });
  assert.deepEqual(visibleControls, {
    search: "filter",
    category: "",
    compatibility: "",
    brand: "",
    vehicleMake: "",
    vehicleModel: "",
    minPrice: "",
    maxPrice: "",
    minDiscount: "",
    stockStatus: "all",
    sortBy: "price-low",
  });
  assert.equal(serializeCatalogFilters(visibleControls), "search=filter&sortBy=price-low");
});

test("filter validation rejects nonnumeric and inverted ranges without mutating valid values", () => {
  assert.match(validateCatalogFilterInput({ minPrice: "wat", maxPrice: "" }), /minimum price/i);
  assert.match(validateCatalogFilterInput({ minPrice: "20", maxPrice: "10" }), /cannot exceed/i);
  assert.match(validateCatalogFilterInput({ minDiscount: "101" }), /between 0 and 100/i);
  assert.equal(validateCatalogFilterInput({ minPrice: "0", maxPrice: "100", minDiscount: "25" }), "");
  assert.deepEqual(normalizeCatalogFilters({ vehicleMake: "", vehicleModel: "1612" }).vehicleModel, "");
});
