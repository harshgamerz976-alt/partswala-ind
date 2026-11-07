import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createServer } from "vite";

function response(status, body) {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}

test("public product service uses sanitized catalogue routes for listing, details, and related products", async (t) => {
  const vite = await createServer({
    appType: "custom",
    optimizeDeps: { noDiscovery: true, include: [] },
    server: { middlewareMode: true },
  });
  const originalFetch = globalThis.fetch;
  let handler = async () => response(500, { message: "No test handler configured." });
  const requests = [];
  globalThis.fetch = async (input, options) => {
    const url = new URL(String(input));
    requests.push({ url, options });
    return handler(url, options);
  };

  try {
    const {
      getProductById,
      getProductsPage,
      getPublicVendorWhatsAppNumber,
      getRelatedProducts,
    } = await vite.ssrLoadModule("/src/services/productService.js");

    await t.test("listing preserves newest-first order, page shape, and cursor pagination", async () => {
      const records = [
        { id: "newest", name: "Newest", category: "Engine", price: 30, createdAt: "2026-01-03T00:00:00.000Z" },
        { id: "middle", name: "Middle", category: "Engine", price: 20, createdAt: "2026-01-02T00:00:00.000Z" },
        { id: "older", name: "Older", category: "Body", price: 10, createdAt: "2026-01-01T00:00:00.000Z" },
        { id: "oldest", name: "Oldest", category: "Body", price: 5, createdAt: "2025-12-31T00:00:00.000Z" },
      ];
      handler = async (url) => {
        assert.equal(url.pathname, "/api/public-products");
        const after = url.searchParams.get("after");
        const limit = Number(url.searchParams.get("limit"));
        const startIndex = after ? records.findIndex(({ id }) => id === after) + 1 : 0;
        const products = records.slice(startIndex, startIndex + limit);
        return response(200, {
          products,
          scanCursor: products.at(-1)?.id || after,
          hasMore: startIndex + products.length < records.length,
        });
      };
      requests.length = 0;

      const first = await getProductsPage(null, 2);
      assert.deepEqual(first.products.map(({ id }) => id), ["newest", "middle"]);
      assert.equal(first.cursor, "middle");
      assert.equal(first.hasMore, true);
      assert.deepEqual(Object.keys(first).sort(), ["cursor", "hasMore", "products"]);
      assert.deepEqual(requests.map(({ url }) => url.searchParams.get("after")), [null, "middle"]);
      assert.equal(requests.every(({ options }) => options.cache === "no-store"), true);

      const second = await getProductsPage(first.cursor, 2);
      assert.deepEqual(second.products.map(({ id }) => id), ["older", "oldest"]);
      assert.equal(second.cursor, null);
      assert.equal(second.hasMore, false);
    });

    await t.test("empty catalogue pages keep the existing return shape", async () => {
      handler = async () => response(200, { products: [], scanCursor: "", hasMore: false });
      assert.deepEqual(await getProductsPage(), { products: [], cursor: null, hasMore: false });
    });

    await t.test("details return sanitized public data and missing products as null", async () => {
      const publicProduct = { id: "part-1", name: "Public part", price: 25, sellerType: "vendor", vendorBusinessName: "Approved Parts" };
      handler = async (url) => url.pathname.endsWith("/missing")
        ? response(404, { message: "Product not found." })
        : response(200, { product: publicProduct });
      assert.deepEqual(await getProductById("part-1"), publicProduct);
      assert.equal(publicProduct.vendorBusinessName, "Approved Parts");
      assert.equal(await getProductById("missing"), null);
      assert.equal(requests.some(({ url }) => url.pathname === "/api/public-products/part-1"), true);
      assert.equal(requests.every(({ options }) => options.cache === "no-store"), true);
    });

    await t.test("related products are selected from public API pages only", async () => {
      const records = [
        { id: "current", category: "Engine" },
        { id: "a", category: "Engine" },
        { id: "b", category: "Engine" },
        { id: "other", category: "Body" },
        { id: "c", category: "Engine" },
        { id: "d", category: "Engine" },
        { id: "e", category: "Engine" },
      ];
      handler = async (url) => {
        const after = url.searchParams.get("after");
        const category = url.searchParams.get("category");
        assert.equal(category, "Engine");
        const matchingRecords = records.filter((record) => record.category === category);
        const startIndex = after ? matchingRecords.findIndex(({ id }) => id === after) + 1 : 0;
        const products = matchingRecords.slice(startIndex, startIndex + Number(url.searchParams.get("limit")));
        return response(200, {
          products,
          scanCursor: products.at(-1)?.id || after,
          hasMore: startIndex + products.length < matchingRecords.length,
        });
      };
      const related = await getRelatedProducts("Engine", "current");
      assert.deepEqual(related.map(({ id }) => id), ["a", "b", "c", "d"]);
    });

    await t.test("vendor WhatsApp contacts come only from the public contact API", async () => {
      requests.length = 0;
      handler = async (url) => {
        assert.equal(url.pathname, "/api/products/part-1/vendor-contact");
        return response(200, { whatsAppNumber: "919876543210" });
      };
      assert.equal(await getPublicVendorWhatsAppNumber("part-1"), "919876543210");
      assert.equal(requests[0].options.cache, "no-store");

      handler = async () => response(200, { whatsAppNumber: null });
      assert.equal(await getPublicVendorWhatsAppNumber("part-1"), null);
      handler = async () => response(200, { whatsAppNumber: "private-number-marker" });
      await assert.rejects(getPublicVendorWhatsAppNumber("part-1"), /contact response was invalid/i);
      handler = async () => response(503, { message: "Supplier contact information is unavailable." });
      await assert.rejects(getPublicVendorWhatsAppNumber("part-1"), /contact information is unavailable/i);
    });

    await t.test("WhatsApp links target only the listing seller and hide missing vendor contacts", async () => {
      const { default: WhatsAppButton } = await vite.ssrLoadModule("/src/components/WhatsAppButton.jsx");
      const render = (props) => renderToStaticMarkup(createElement(WhatsAppButton, props));
      const vendorLink = render({
        sellerType: "vendor",
        whatsAppNumber: "919876543210",
        productName: "Clutch",
        partNumber: "CL-1",
      });
      assert.match(vendorLink, /href="https:\/\/wa\.me\/919876543210\?/);
      assert.doesNotMatch(vendorLink, /Hi PARTSWALA IND/);
      assert.equal(render({ sellerType: "vendor", productName: "Clutch" }), "");
      assert.equal(render({ sellerType: "vendor", whatsAppNumber: "not-a-number" }), "");
      assert.match(render({ sellerType: "partswala", productName: "Clutch" }), /href="https:\/\/wa\.me\/\d{10}\?/);
      assert.equal(render({ sellerType: "unknown", productName: "Clutch" }), "");
    });

    await t.test("HTTP and network errors surface without direct Firestore fallback", async () => {
      handler = async () => response(503, { message: "Catalogue temporarily unavailable." });
      await assert.rejects(getProductsPage(), /Catalogue temporarily unavailable/);
      await assert.rejects(getRelatedProducts("Engine", "current"), /Catalogue temporarily unavailable/);
      await assert.rejects(getProductById("part-1"), /Catalogue temporarily unavailable/);
      handler = async () => response(403, { message: "The PartsWalaIND marketplace is not open yet." });
      await assert.rejects(getProductsPage(), /The PartsWalaIND marketplace is not open yet/);
      assert.equal(requests.at(-1).options.cache, "no-store");

      handler = async () => { throw new Error("offline"); };
      await assert.rejects(getProductsPage(), /Product catalogue request failed: offline/);
    });

    await t.test("malformed API pagination is rejected explicitly", async () => {
      handler = async () => response(200, { products: [{ id: "a" }], hasMore: true });
      await assert.rejects(getProductsPage(), /invalid pagination cursor/);
    });
  } finally {
    globalThis.fetch = originalFetch;
    await vite.close();
  }
});
