import assert from "node:assert/strict";
import test from "node:test";
import { buildSellerInvoiceSnapshots } from "./invoices.js";
import { canDownloadInvoice, needsAccountingReview } from "../src/services/invoicePolicy.js";

test("seller invoices have stable references and independent finalized totals", () => {
  const items = [
    { productId: "a", sellerId: "vendor-a", sellerType: "vendor", sellerName: "A", unitPrice: 1000, quantity: 1, taxableValue: 1000, cgst: 90, sgst: 90, taxAmount: 180, customerLineTotal: 1180 },
    { productId: "b", sellerId: "partswala", sellerType: "partswala", unitPrice: 500, quantity: 1, taxableValue: 500, igst: 90, taxAmount: 90, customerLineTotal: 590 },
  ];
  const first = buildSellerInvoiceSnapshots("order-1", "2026-09-28", { storeName: "PARTSWALA" }, items);
  const second = buildSellerInvoiceSnapshots("order-1", "2026-09-28", { storeName: "PARTSWALA" }, items);
  assert.equal(first.length, 2);
  assert.deepEqual(first.map((invoice) => invoice.invoiceNumber), second.map((invoice) => invoice.invoiceNumber));
  assert.equal(first.find((invoice) => invoice.seller.sellerId === "vendor-a").totals.grandTotal, 1180);
  assert.equal(first.find((invoice) => invoice.seller.sellerId === "partswala").totals.grandTotal, 590);
  assert.equal(needsAccountingReview(first[0]), true);
  assert.equal(canDownloadInvoice(first[0]), false);
  assert.equal(canDownloadInvoice({ ...first[0], accountingReviewStatus: "reviewed" }), true);
  assert.equal(canDownloadInvoice({ invoiceNumber: "legacy-summary" }), true);
});