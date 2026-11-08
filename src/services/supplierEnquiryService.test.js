import test from "node:test";
import assert from "node:assert/strict";
import {
  createSupplierEnquiry,
  getSubmissionRequest,
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

test("customer enquiry creation sends a request ID and retries can reuse it", async () => {
  const payload = { productId: "product-1", quantity: 3, message: "Please quote.", shareEmail: false };
  const requestBodies = [];
  const fetchImpl = async (_url, options) => {
    requestBodies.push(JSON.parse(options.body));
    return response(201, { enquiryId: "enquiry-1", status: "new" });
  };
  const result = await createSupplierEnquiry(user, payload, fetchImpl);
  const requestId = requestBodies[0].requestId;
  assert.match(requestId, /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
  assert.deepEqual(requestBodies[0], { ...payload, requestId });
  const retryResult = await createSupplierEnquiry(user, { ...payload, requestId }, fetchImpl);
  assert.equal(retryResult.status, "new");
  assert.equal(requestBodies[1].requestId, requestId);
  assert.deepEqual(result, { enquiryId: "enquiry-1", status: "new" });
});

test("a new enquiry submission receives a different request ID", async () => {
  const payload = { productId: "product-1", quantity: 3, message: "Please quote.", shareEmail: false };
  const ids = [];
  const fetchImpl = async (_url, options) => {
    ids.push(JSON.parse(options.body).requestId);
    return response(201, { enquiryId: `enquiry-${ids.length}`, status: "new" });
  };
  await createSupplierEnquiry(user, payload, fetchImpl);
  await createSupplierEnquiry(user, payload, fetchImpl);
  assert.notEqual(ids[0], ids[1]);
});

test("submission request identity is stable for retries and changes for a new payload", () => {
  const first = getSubmissionRequest(null, "same submission");
  const retry = getSubmissionRequest(first, "same submission");
  const next = getSubmissionRequest(first, "new submission");
  const laterSubmission = getSubmissionRequest(null, "same submission");
  assert.equal(retry, first);
  assert.equal(retry.requestId, first.requestId);
  assert.notEqual(next.requestId, first.requestId);
  assert.notEqual(laterSubmission.requestId, first.requestId);
});

test("vendor quote updates send a request ID that can be reused for retry", async () => {
  let requestUrl;
  const quote = { amount: 1250, message: "Available this week." };
  const requestIds = [];
  const result = await sendSupplierQuote(user, "enquiry 1", quote, async (url, options) => {
    requestUrl = url;
    assert.equal(options.method, "PATCH");
    assert.equal(options.cache, "no-store");
    const body = JSON.parse(options.body);
    requestIds.push(body.requestId);
    assert.deepEqual(body, { ...quote, requestId: body.requestId });
    return response(200, { enquiryId: "enquiry 1", status: "quoted", quoteAmount: 1250 });
  });
  assert.match(new URL(requestUrl).pathname, /enquiry%201\/quote$/);
  assert.equal(result.quoteAmount, 1250);
  assert.match(requestIds[0], /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
  await sendSupplierQuote(user, "enquiry 1", { ...quote, requestId: requestIds[0] }, async (_url, options) => {
    requestIds.push(JSON.parse(options.body).requestId);
    return response(200, { enquiryId: "enquiry 1", status: "quoted", quoteAmount: 1250 });
  });
  assert.equal(requestIds[1], requestIds[0]);

  await assert.rejects(
    sendSupplierQuote(user, "enquiry-1", quote, async () => response(403, { message: "Approved vendor access is required." })),
    /Approved vendor access is required/,
  );
});

test("separate vendor quote submissions receive different request IDs", async () => {
  const requestIds = [];
  const fetchImpl = async (_url, options) => {
    requestIds.push(JSON.parse(options.body).requestId);
    return response(200, { enquiryId: "enquiry-1", status: "quoted", quoteAmount: 1250 });
  };
  await sendSupplierQuote(user, "enquiry-1", { amount: 1250, message: "Available this week." }, fetchImpl);
  await sendSupplierQuote(user, "enquiry-1", { amount: 1250, message: "Available this week." }, fetchImpl);
  assert.notEqual(requestIds[0], requestIds[1]);
});

test("enquiry service requires authentication and a known audience", async () => {
  await assert.rejects(getSupplierEnquiries(null, "customer"), /Sign in/);
  await assert.rejects(getSupplierEnquiries(user, "admin"), /valid enquiry audience/);
});
