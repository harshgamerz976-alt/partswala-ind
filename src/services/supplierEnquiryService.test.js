import test from "node:test";
import assert from "node:assert/strict";
import {
  createSupplierEnquiry,
  getSupplierEnquiries,
  sendSupplierQuote,
} from "./supplierEnquiryService.js";

const user = { getIdToken: async () => "test-id-token" };

function response(status, data) {
  return { ok: status >= 200 && status < 300, status, json: async () => data };
}

test("customer enquiry list uses authenticated no-store fetch and encodes its cursor", async () => {
  let request;
  const result = await getSupplierEnquiries(user, "customer", "page/2 &", async (url, options) => {
    request = { url, options };
    return response(200, { enquiries: [], cursor: null, hasMore: false });
  });

  assert.equal(new URL(request.url).pathname, "/api/enquiries");
  assert.equal(new URL(request.url).searchParams.get("cursor"), "page/2 &");
  assert.equal(request.options.method, "GET");
  assert.equal(request.options.cache, "no-store");
  assert.equal(request.options.headers.Authorization, "Bearer test-id-token");
  assert.deepEqual(result.enquiries, []);
});

test("vendor enquiry list uses the vendor-only API and rejects a malformed response", async () => {
  let requestUrl;
  await assert.rejects(
    getSupplierEnquiries(user, "vendor", null, async (url) => {
      requestUrl = url;
      return response(200, { enquiries: [], cursor: 9, hasMore: false });
    }),
    /response was invalid/,
  );
  assert.equal(new URL(requestUrl).pathname, "/api/vendor/enquiries");
});

test("customer enquiry creation sends only the supplied request to the authenticated API", async () => {
  const payload = { productId: "product-1", quantity: 3, message: "Please quote.", shareEmail: false };
  let options;
  const result = await createSupplierEnquiry(user, payload, async (_url, requestOptions) => {
    options = requestOptions;
    return response(201, { enquiryId: "enquiry-1", status: "new" });
  });
  assert.equal(options.method, "POST");
  assert.equal(options.cache, "no-store");
  assert.deepEqual(JSON.parse(options.body), payload);
  assert.deepEqual(result, { enquiryId: "enquiry-1", status: "new" });
});

test("vendor quote updates use the owned-enquiry route and surface authorization errors", async () => {
  let requestUrl;
  const quote = { amount: 1250, message: "Available this week." };
  const result = await sendSupplierQuote(user, "enquiry 1", quote, async (url, options) => {
    requestUrl = url;
    assert.equal(options.method, "PATCH");
    assert.equal(options.cache, "no-store");
    assert.deepEqual(JSON.parse(options.body), quote);
    return response(200, { enquiryId: "enquiry 1", status: "quoted", quoteAmount: 1250 });
  });
  assert.match(new URL(requestUrl).pathname, /enquiry%201\/quote$/);
  assert.equal(result.quoteAmount, 1250);

  await assert.rejects(
    sendSupplierQuote(user, "enquiry-1", quote, async () => response(403, { message: "Approved vendor access is required." })),
    /Approved vendor access is required/,
  );
});

test("enquiry service requires authentication and a known audience", async () => {
  await assert.rejects(getSupplierEnquiries(null, "customer"), /Sign in/);
  await assert.rejects(getSupplierEnquiries(user, "admin"), /valid enquiry audience/);
});
