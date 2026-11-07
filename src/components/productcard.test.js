import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { createServer } from "vite";

test("product cards do not invent product names, part numbers, popularity, or features", async () => {
  const vite = await createServer({
    appType: "custom",
    optimizeDeps: { noDiscovery: true, include: [] },
    server: { middlewareMode: true },
  });
  try {
    const { default: ProductCard } = await vite.ssrLoadModule("/src/components/productcard.jsx");
    const markup = renderToStaticMarkup(createElement(
      MemoryRouter,
      null,
      createElement(ProductCard, {
        product: { id: "part-1", price: 250 },
      }),
    ));

    assert.match(markup, /Unnamed part/);
    assert.match(markup, /Part number not listed/);
    assert.match(markup, /Request pricing/);
    assert.match(markup, /Confirm compatibility/);
    assert.doesNotMatch(markup, /Clutch Plate|CP-1234|POPULAR|Premium|Durable &amp; Reliable|Perfect Fit|Long Lasting/);
    assert.match(markup, /Tax treatment to confirm with supplier/);
  } finally {
    await vite.close();
  }
});
