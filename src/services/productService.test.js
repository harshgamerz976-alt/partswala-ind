import assert from "node:assert/strict";
import test from "node:test";
import { createServer } from "vite";

test("catalogue service sends one indexed request per cursor page and preserves the stable page cursor", async () => {
  const vite = await createServer({
    appType: "custom",
    optimizeDeps: { noDiscovery: true, include: [] },
    server: { middlewareMode: true },
  });
  const originalFetch = globalThis.fetch;
  const requests = [];
  const pages = new Map([
    [null, {
      products: [
        { id: "product-a", name: "Older part", price: 100, updatedAt: "2026-01-01T00:00:00.000Z" },
        { id: "product-b", name: "Middle part", price: 100, updatedAt: "2026-01-02T00:00:00.000Z" },
      ],
      hasMore: true,
      nextCursor: "opaque-page-two",
    }],
    ["opaque-page-two", {
      products: [
        { id: "product-c", name: "Newer part", price: 100, updatedAt: "2026-01-03T00:00:00.000Z" },
        { id: "product-d", name: "Newest part", price: 100, updatedAt: "2026-01-04T00:00:00.000Z" },
      ],
      hasMore: false,
      nextCursor: null,
    }],
  ]);
  globalThis.fetch = async (input) => {
    const url = new URL(String(input));
    requests.push(url);
    const page = pages.get(url.searchParams.get("cursor"));
    return {
      ok: true,
      status: 200,
      json: async () => page,
    };
  };

  try {
    const { getProductsPage } = await vite.ssrLoadModule("/src/services/productService.js");
    const firstPage = await getProductsPage(null, 2, { search: "part", sortBy: "oldest" });
    assert.deepEqual(firstPage.products.map(({ id }) => id), ["product-a", "product-b"]);
    assert.equal(firstPage.cursor, "opaque-page-two");
    assert.equal(firstPage.hasMore, true);

    const secondPage = await getProductsPage(firstPage.cursor, 2, { search: "part", sortBy: "newest" });
    assert.deepEqual(secondPage.products.map(({ id }) => id), ["product-d", "product-c"]);
    assert.equal(secondPage.cursor, null);
    assert.equal(secondPage.hasMore, false);
    assert.equal(requests.length, 2);
    assert.deepEqual(requests.map((url) => url.searchParams.get("cursor")), [null, "opaque-page-two"]);
    assert.deepEqual(requests.map((url) => url.searchParams.get("search")), ["part", "part"]);
    assert.deepEqual(requests.map((url) => url.searchParams.get("sortBy")), [null, null]);
    assert.equal(new Set([...firstPage.products, ...secondPage.products].map(({ id }) => id)).size, 4);
  } finally {
    globalThis.fetch = originalFetch;
    await vite.close();
  }
});

test("catalogue service continues legacy scanCursor pages with the after parameter", async () => {
  const vite = await createServer({
    appType: "custom",
    optimizeDeps: { noDiscovery: true, include: [] },
    server: { middlewareMode: true },
  });
  const originalFetch = globalThis.fetch;
  const requests = [];
  globalThis.fetch = async (input) => {
    const url = new URL(String(input));
    requests.push(url);
    const page = url.searchParams.has("after")
      ? {
        products: [{ id: "product-c", name: "Third part", price: 100 }],
        hasMore: false,
        scanCursor: "product-c",
      }
      : {
        products: [
          { id: "product-a", name: "First part", price: 100 },
          { id: "product-b", name: "Second part", price: 100 },
        ],
        hasMore: true,
        scanCursor: "product-b",
      };
    return { ok: true, status: 200, json: async () => page };
  };

  try {
    const { getProductsPage } = await vite.ssrLoadModule("/src/services/productService.js");
    const firstPage = await getProductsPage(null, 2, {});
    assert.deepEqual(firstPage.products.map(({ id }) => id), ["product-a", "product-b"]);
    assert.equal(firstPage.cursor, "after:product-b");
    assert.equal(firstPage.hasMore, true);

    const secondPage = await getProductsPage(firstPage.cursor, 2, {});
    assert.deepEqual(secondPage.products.map(({ id }) => id), ["product-c"]);
    assert.equal(secondPage.cursor, null);
    assert.equal(secondPage.hasMore, false);
    assert.equal(requests.length, 2);
    assert.equal(requests[0].searchParams.has("after"), false);
    assert.equal(requests[1].searchParams.get("after"), "product-b");
    assert.equal(requests[1].searchParams.has("cursor"), false);
  } finally {
    globalThis.fetch = originalFetch;
    await vite.close();
  }
});

test("catalogue service propagates AbortController cancellation instead of returning an empty page", async () => {
  const vite = await createServer({
    appType: "custom",
    optimizeDeps: { noDiscovery: true, include: [] },
    server: { middlewareMode: true },
  });
  const originalFetch = globalThis.fetch;
  let observedSignal;
  globalThis.fetch = (_input, { signal }) => {
    observedSignal = signal;
    return new Promise((_resolve, reject) => {
      signal.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), { once: true });
    });
  };

  try {
    const { getProductsPage } = await vite.ssrLoadModule("/src/services/productService.js");
    const controller = new AbortController();
    const request = getProductsPage(null, 20, {}, { signal: controller.signal });
    controller.abort();
    await assert.rejects(request, { name: "AbortError" });
    assert.equal(observedSignal.aborted, true);
  } finally {
    globalThis.fetch = originalFetch;
    await vite.close();
  }
});
