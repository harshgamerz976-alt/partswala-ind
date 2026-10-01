import test from "node:test";
import assert from "node:assert/strict";
import { AI_PRODUCT_CACHE_MAX, compatibilityStatus, executeAssistantTool, searchCatalogProducts } from "./tools.js";
import { calculateLineFinance } from "../finance.js";

const products = [
  { id: "brake-a", name: "Front Brake Pad", brand: "RoadPro", category: "Brake System", partNumber: "BP-1612", price: 4200, stock: 7, compatibility: "Tata 1612 front axle", enabled: true },
  { id: "brake-b", name: "Rear Brake Pad", brand: "RoadPro", category: "Brake System", partNumber: "BP-1613", price: 5300, stock: 0, compatibility: "Tata 1613", enabled: true },
  { id: "disabled", name: "Brake Pad", category: "Brake System", price: 1000, enabled: false },
];

test("catalog search returns only matching real products and respects a price ceiling", () => {
  assert.deepEqual(searchCatalogProducts(products, "brake pad Tata", { maxPrice: 5000 }).map((item) => item.id), ["brake-a"]);
});

test("compatibility is verified only when every supplied vehicle field is listed", () => {
  assert.equal(compatibilityStatus(products[0], { manufacturer: "Tata", model: "1612" }), "verified");
  assert.equal(compatibilityStatus(products[0], { manufacturer: "Tata", model: "1612", variant: "BS6" }), "unconfirmed");
  assert.equal(compatibilityStatus(products[2], { manufacturer: "Tata", model: "1612" }), "unknown");
});

test("customer order lookup is scoped to the verified user's ID and omits private addresses", async () => {
  let requestedUserId = "";
  const db = {
    collection: (name) => {
      assert.equal(name, "orders");
      return {
        where: (field, operator, value) => {
          assert.equal(field, "userId");
          assert.equal(operator, "==");
          requestedUserId = value;
          return { get: async () => ({ docs: [{ id: "own-order", data: () => ({ userId: value, address: "private address", paymentStatus: "Paid", items: [] }) }] }) };
        },
      };
    },
  };
  const result = await executeAssistantTool({ db, actor: { role: "customer", user: { uid: "customer-1" } }, tool: "getOrders" });
  assert.equal(requestedUserId, "customer-1");
  assert.equal(result.orders[0].id, "own-order");
  assert.equal("address" in result.orders[0], false);
});

test("customer cannot reach admin finance tools", async () => {
  let databaseRead = false;
  const db = { collection: () => { databaseRead = true; return null; } };
  await assert.rejects(executeAssistantTool({ db, actor: { role: "customer", user: { uid: "customer-1" } }, tool: "getAdminFinance" }), /not available/);
  assert.equal(databaseRead, false);
});

test("store policy replies come from the public assistant settings", async () => {
  const db = { doc: (path) => ({ get: async () => ({ exists: true, data: () => path === "settings/assistant" ? { returnPolicy: "Returns are reviewed within seven days." } : {} }) }) };
  const result = await executeAssistantTool({ db, actor: { role: "customer", user: null }, tool: "getStoreInfo", args: { query: "return policy" } });
  assert.equal(result.reply, "Returns are reviewed within seven days.");
});

test("cart values are refreshed from Firestore rather than browser-supplied prices", async () => {
  let productLimit = 0;
  const db = {
    collection: (name) => {
      if (name === "products") {
        const productCollection = { get: async () => ({ docs: [{ id: "cart-part", data: () => ({ name: "Clutch Plate", price: 125, stock: 3, weight: 0.8, sellerType: "partswala" }) }] }) };
        productCollection.limit = (count) => { productLimit = count; return productCollection; };
        return productCollection;
      }
      throw new Error(`Unexpected collection ${name}`);
    },
    doc: (path) => ({ get: async () => ({ exists: true, data: () => path === "settings/store" ? { pickupPincode: "400001" } : {} }) }),
  };
  const actor = { role: "customer", user: null };
  const cart = await executeAssistantTool({ db, actor, tool: "getCart", context: { cart: [{ id: "cart-part", quantity: 2, price: 1 }] } });
  assert.equal(cart.items[0].price, 125);
  assert.equal(cart.subtotal, 250);
  assert.equal(productLimit, AI_PRODUCT_CACHE_MAX);
  const shipping = await executeAssistantTool({ db, actor, tool: "getShippingEstimate", args: { productIds: ["cart-part"], deliveryPincode: "400002" } });
  assert.equal(shipping.available, false);
  assert.equal(shipping.amount, null);
  assert.equal(shipping.actualWeight, 0.8);
  assert.equal(shipping.message, "Final courier pricing is calculated at checkout.");
});

test("vendor order lookup reads only that vendor's settlement records", async () => {
  let queriedVendor = "";
  const db = {
    collection: (name) => {
      assert.equal(name, "vendorSettlements");
      return { where: (field, operator, value) => {
        assert.equal(field, "vendorId");
        assert.equal(operator, "==");
        queriedVendor = value;
        return { get: async () => ({ docs: [{ id: "settlement-1", data: () => ({ vendorId: value, orderId: "order-1", productName: "Brake Pad", orderStatus: "shipped" }) }] }) };
      } };
    },
  };
  const result = await executeAssistantTool({ db, actor: { role: "vendor", user: { uid: "vendor-1" } }, tool: "getOrders" });
  assert.equal(queriedVendor, "vendor-1");
  assert.deepEqual(result.orders[0].items, [{ name: "Brake Pad" }]);
  assert.equal("customer" in result.orders[0], false);
});

test("vendor payout reasons follow backend delivery and payment eligibility", async () => {
  const db = {
    collection: () => ({ where: (_field, _operator, vendorId) => ({ get: async () => ({ docs: [{
      id: "settlement-1",
      data: () => ({ vendorId, orderId: "order-1", productName: "Brake Pad", vendorPayout: 900, commissionAmount: 100, orderStatus: "shipped", paymentStatus: "Paid", settlementStatus: "pending", createdAt: "2026-01-01" }),
    }] }) }) }),
  };
  const result = await executeAssistantTool({ db, actor: { role: "vendor", user: { uid: "vendor-1" } }, tool: "getVendorPayout" });
  assert.match(result.settlements[0].statusReason, /Awaiting order delivery/);
});

test("admin finance keeps collections, GST, commission, and vendor payout separate", async () => {
  const line = { ...calculateLineFinance({ sellerId: "vendor-1", sellerType: "vendor", unitPrice: 10000, quantity: 1, gstRate: 18, commissionRate: 10 }), taxAmount: 1800, customerLineTotal: 11800 };
  const order = { status: "confirmed", createdAt: new Date().toISOString(), grandTotal: 11800, items: [line], finance: { shippingDifferencePolicy: "absorb" } };
  const db = {
    collection: (name) => ({ get: async () => ({ docs: (name === "orders" ? [order] : []).map((data, index) => ({ id: `record-${index}`, data: () => data })) }) }),
  };
  const result = await executeAssistantTool({ db, actor: { role: "admin", user: { uid: "admin-1" } }, tool: "getAdminFinance" });
  assert.equal(result.grossCustomerCollections, 11800);
  assert.equal(result.taxesCollected, 1800);
  assert.equal(result.vendorSales, 10000);
  assert.equal(result.platformCommission, 1000);
  assert.equal(result.pendingVendorPayouts, 0);
  assert.equal(result.platformRevenue, 1000);
  assert.equal(result.refundsToday, 0);
});