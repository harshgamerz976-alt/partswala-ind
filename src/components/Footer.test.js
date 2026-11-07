import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { createServer } from "vite";

test("footer links lead to enquiry and contact surfaces instead of unrelated profile or order pages", async () => {
  const vite = await createServer({
    appType: "custom",
    optimizeDeps: { noDiscovery: true, include: [] },
    server: { middlewareMode: true },
  });
  try {
    const { default: Footer } = await vite.ssrLoadModule("/src/components/Footer.jsx");
    const markup = renderToStaticMarkup(createElement(MemoryRouter, null, createElement(Footer)));
    assert.match(markup, /href="\/legal\/enquiries"[^>]*>Enquiry &amp; quotation policy/);
    assert.match(markup, /href="mailto:support@partswalaind\.com">Support/);
    assert.match(markup, /href="\/my-enquiries"[^>]*>My supplier enquiries/);
    assert.match(markup, /href="mailto:support@partswalaind\.com\?subject=Careers%20at%20PARTSWALA%20IND">Careers/);
    assert.doesNotMatch(markup, /Pan-India delivery|href="\/profile">(?:Careers|Support)/);
  } finally {
    await vite.close();
  }
});
