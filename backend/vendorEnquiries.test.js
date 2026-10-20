import assert from "node:assert/strict";
import test from "node:test";
import {
  isEligibleVendorEnquiryProduct,
  canCreateSupplierEnquiry,
  canQuoteSupplierEnquiry,
  isValidSupplierDocumentId,
  serializeSupplierEnquiry,
  validateSupplierEnquiryInput,
  validateSupplierQuoteInput,
} from "./vendorEnquiries.js";

const approvedVendor = { role: "vendor", vendorStatus: "approved" };
const visibleProduct = {
  name: "Clutch assembly",
  price: 12500,
  sellerId: "vendor-1",
  sellerType: "vendor",
  enabled: true,
  status: "Available",
};

test("supplier enquiries accept valid quantity, message, and explicit email consent", () => {
  assert.deepEqual(validateSupplierEnquiryInput({
    productId: "product-1",
    quantity: 12,
    message: "Please quote the lead time and price.",
    shareEmail: true,
  }), {
    productId: "product-1",
    quantity: 12,
    message: "Please quote the lead time and price.",
    shareEmail: true,
  });
});

test("supplier enquiries reject invalid IDs, quantities, messages, and consent values", () => {
  for (const payload of [
    null,
    [],
    { productId: "", quantity: 1, message: "Quote" },
    { productId: "products/other", quantity: 1, message: "Quote" },
    { productId: "p", quantity: 0, message: "Quote" },
    { productId: "p", quantity: 1.5, message: "Quote" },
    { productId: "p", quantity: 1, message: " \n " },
    { productId: "p", quantity: 1, message: "Quote", shareEmail: "yes" },
    { productId: "p", quantity: 1, message: `bad${String.fromCharCode(1)}text` },
  ]) assert.throws(() => validateSupplierEnquiryInput(payload));
});

test("only approved, published vendor products with real prices qualify for enquiries", () => {
  assert.equal(isEligibleVendorEnquiryProduct(visibleProduct, approvedVendor), true);
  assert.equal(isEligibleVendorEnquiryProduct({ ...visibleProduct, status: "pending" }, approvedVendor), false);
  assert.equal(isEligibleVendorEnquiryProduct({ ...visibleProduct, enabled: false }, approvedVendor), false);
  assert.equal(isEligibleVendorEnquiryProduct({ ...visibleProduct, enabled: "false" }, approvedVendor), false);
  assert.equal(isEligibleVendorEnquiryProduct({ ...visibleProduct, sellerType: " Vendor " }, approvedVendor), true);
  assert.equal(isEligibleVendorEnquiryProduct({ ...visibleProduct, sellerType: "partswala" }, approvedVendor), false);
  assert.equal(isEligibleVendorEnquiryProduct({ ...visibleProduct, price: null }, approvedVendor), false);
  assert.equal(isEligibleVendorEnquiryProduct({ ...visibleProduct, price: true }, approvedVendor), false);
  assert.equal(isEligibleVendorEnquiryProduct({ ...visibleProduct, price: [12500] }, approvedVendor), false);
  assert.equal(isEligibleVendorEnquiryProduct({ ...visibleProduct, price: "12,500" }, approvedVendor), false);
  assert.equal(isEligibleVendorEnquiryProduct(visibleProduct, { ...approvedVendor, vendorStatus: "pending" }), false);
});

test("supplier document IDs reject Firestore path separators", () => {
  assert.equal(isValidSupplierDocumentId("product-1"), true);
  assert.equal(isValidSupplierDocumentId("products/product-1"), false);
  assert.equal(isValidSupplierDocumentId(""), false);
});

test("conflicting approval fields fail closed while published schema statuses remain eligible", () => {
  assert.equal(isEligibleVendorEnquiryProduct({ ...visibleProduct, status: "Available", approvalStatus: "pending" }, approvedVendor), false);
  assert.equal(isEligibleVendorEnquiryProduct({ ...visibleProduct, status: "Available", publishStatus: "rejected" }, approvedVendor), false);
  assert.equal(isEligibleVendorEnquiryProduct({ ...visibleProduct, status: "pending", approvalStatus: "Available" }, approvedVendor), false);
  assert.equal(isEligibleVendorEnquiryProduct({ ...visibleProduct, approvalStatus: "unpublished" }, approvedVendor), false);
  assert.equal(isEligibleVendorEnquiryProduct({ ...visibleProduct, publishStatus: "disabled" }, approvedVendor), false);
  assert.equal(isEligibleVendorEnquiryProduct({ ...visibleProduct, status: "Available" }, approvedVendor), true);
  assert.equal(isEligibleVendorEnquiryProduct({ ...visibleProduct, status: "approved" }, approvedVendor), true);
});

test("supplier quotes require a finite positive amount and message", () => {
  assert.deepEqual(validateSupplierQuoteInput({ amount: 1234.567, message: "Available from stock." }), {
    amount: 1234.57,
    message: "Available from stock.",
  });
  for (const payload of [
    null,
    [],
    { amount: true, message: "Quote" },
    { amount: 0, message: "Quote" },
    { amount: Infinity, message: "Quote" },
    { amount: 100, message: " " },
  ]) assert.throws(() => validateSupplierQuoteInput(payload));
});

test("only customers and approved vendors may create enquiries; admins and pending vendors may not", () => {
  assert.equal(canCreateSupplierEnquiry({ role: "customer" }, false), true);
  assert.equal(canCreateSupplierEnquiry(approvedVendor, false), true);
  assert.equal(canCreateSupplierEnquiry({ role: "vendor", vendorStatus: "pending" }, false), false);
  assert.equal(canCreateSupplierEnquiry({ role: "admin" }, true), false);
});

test("only the approved owner vendor may quote an open enquiry", () => {
  const enquiry = { vendorId: "vendor-1", status: "new" };
  assert.equal(canQuoteSupplierEnquiry(enquiry, "vendor-1", approvedVendor), true);
  assert.equal(canQuoteSupplierEnquiry(enquiry, "vendor-2", approvedVendor), false);
  assert.equal(canQuoteSupplierEnquiry(enquiry, "vendor-1", { ...approvedVendor, vendorStatus: "pending" }), false);
  assert.equal(canQuoteSupplierEnquiry({ ...enquiry, status: "closed" }, "vendor-1", approvedVendor), false);
});

test("enquiry responses expose only the fields intended for each side", () => {
  const privateRecord = {
    buyerId: "buyer-1",
    vendorId: "vendor-1",
    buyerEmail: "buyer@example.com",
    vendorBusinessName: "North Parts",
    vendorProfile: { phone: "private" },
    pickupLocation: { addressLine1: "private" },
    productId: "product-1",
    productName: "Clutch assembly",
    quantity: 2,
    buyerMessage: "Please quote.",
    status: "new",
    quoteAmount: null,
    quoteMessage: "",
    createdAt: "2025-01-01T00:00:00.000Z",
  };
  const vendorView = serializeSupplierEnquiry("enquiry-1", privateRecord, "vendor");
  const buyerView = serializeSupplierEnquiry("enquiry-1", privateRecord, "buyer");
  assert.equal(vendorView.buyerEmail, "buyer@example.com");
  assert.equal("buyerEmail" in buyerView, false);
  for (const response of [vendorView, buyerView]) {
    assert.equal("buyerId" in response, false);
    assert.equal("vendorId" in response, false);
    assert.equal("vendorProfile" in response, false);
    assert.equal("pickupLocation" in response, false);
  }
  assert.equal(buyerView.vendorBusinessName, "North Parts");
  assert.equal(buyerView.quoteAmount, null);
});
