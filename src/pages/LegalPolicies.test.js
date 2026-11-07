import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createServer } from "vite";
import { MemoryRouter, Route, Routes } from "react-router-dom";

test("legal policy routes render all seven drafts with owner-review notice and cross-links", async () => {
  const vite = await createServer({
    appType: "custom",
    optimizeDeps: { noDiscovery: true, include: [] },
    server: { middlewareMode: true },
  });
  try {
    const { default: LegalPolicies } = await vite.ssrLoadModule("/src/pages/LegalPolicies.jsx");
    const slugs = [
      ["privacy", "Privacy Policy"],
      ["terms", "General Terms & Conditions"],
      ["vendor-terms", "Vendor Terms & Conditions"],
      ["disclaimer", "Disclaimer"],
      ["contact", "Contact & Grievance Policy"],
      ["cookies", "Cookie & Browser Storage Policy"],
      ["enquiries", "Enquiry & Quotation Policy"],
    ];
    for (const [slug, title] of slugs) {
      const markup = renderToStaticMarkup(createElement(
        MemoryRouter,
        { initialEntries: [`/legal/${slug}`] },
        createElement(Routes, null, createElement(Route, { path: "/legal/:slug", element: createElement(LegalPolicies) })),
      ));
      const escapedTitle = title.replaceAll("&", "&amp;").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      assert.match(markup, new RegExp(`<h1>${escapedTitle}</h1>`));
      assert.match(markup, /Draft for owner confirmation and qualified Indian legal review/i);
      assert.match(markup, /support@partswalaind\.com/);
      assert.match(markup, /\/legal\/privacy/);
    }

    const privacyMarkup = renderToStaticMarkup(createElement(
      MemoryRouter,
      { initialEntries: ["/legal/privacy"] },
      createElement(Routes, null, createElement(Route, { path: "/legal/:slug", element: createElement(LegalPolicies) })),
    ));
    assert.match(privacyMarkup, /retention periods by record type/i);
    assert.match(privacyMarkup, /Digital Personal Data Protection Act, 2023/i);
    assert.match(privacyMarkup, /does not itself demonstrate deletion of every associated/i);

    const cookiesMarkup = renderToStaticMarkup(createElement(
      MemoryRouter,
      { initialEntries: ["/legal/cookies"] },
      createElement(Routes, null, createElement(Route, { path: "/legal/:slug", element: createElement(LegalPolicies) })),
    ));
    assert.match(cookiesMarkup, /localStorage/i);
    assert.match(cookiesMarkup, /IndexedDB/i);
    assert.match(cookiesMarkup, /does not include an analytics or advertising SDK/i);
  } finally {
    await vite.close();
  }
});

test("customer and vendor registration link applicable drafts and keep optional marketing unselected", async () => {
  const projectRoot = new URL("../../", import.meta.url);
  const [customerForm, vendorForm, footer] = await Promise.all([
    readFile(new URL("src/pages/Register.jsx", projectRoot), "utf8"),
    readFile(new URL("src/pages/VendorLogin.jsx", projectRoot), "utf8"),
    readFile(new URL("src/components/Footer.jsx", projectRoot), "utf8"),
  ]);
  assert.match(customerForm, /LEGAL_POLICY_PATHS\.privacy/);
  assert.match(customerForm, /LEGAL_POLICY_PATHS\.terms/);
  assert.match(customerForm, /type="checkbox" required checked=\{acceptedPolicies\}/);
  assert.match(customerForm, /const \[marketingConsent, setMarketingConsent\] = useState\(false\)/);
  assert.match(customerForm, /<input type="checkbox" checked=\{marketingConsent\}/);
  assert.match(vendorForm, /LEGAL_POLICY_PATHS\.vendorTerms/);
  assert.match(vendorForm, /type="checkbox" required checked=\{acceptedVendorPolicies\}/);
  assert.match(vendorForm, /const \[marketingConsent, setMarketingConsent\] = useState\(false\)/);
  assert.match(vendorForm, /<input type="checkbox" checked=\{marketingConsent\}/);
  assert.match(footer, /LegalPolicyLinks/);
});
