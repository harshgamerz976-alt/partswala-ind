import assert from "node:assert/strict";
import test from "node:test";
import { buildSellerInvoiceSnapshots } from "./invoices.js";
import { planInventoryReservation, webhookEventId } from "./lifecycle.js";
import { planSelectedRefund, settlementStatusFor } from "./finance.js";

test("concurrent final-unit reservation attempts allow one winner", async () => {
  let stock = 1;
  const reserve = async () => {
    const plan = planInventoryReservation([{ productId: "last", quantity: 1 }], { last: stock });
    await Promise.resolve();
    if (stock < 1) throw new Error("out of stock");
    stock = plan[0].stock;
    return true;
  };
  const outcomes = await Promise.allSettled([reserve(), reserve()]);
  assert.equal(outcomes.filter((result) => result.status === "fulfilled").length, 1);
  assert.equal(stock, 0);
});

test("duplicate payment webhook IDs resolve to one logical event", () => {
  const payload = { event_id: "captured-1", paymentId: "pay-1", orderId: "order-1" };
  assert.equal(webhookEventId("razorpay", null, payload), webhookEventId("razorpay", null, payload));
});

test("concurrent refund plans cannot consume the same saved quantity when reservations are serialized", async () => {
  const snapshot = [{ productId: "p", quantity: 1, customerLineTotal: 1000 }];
  let reservedQuantity = 0;
  const request = async () => {
    const currentReserved = reservedQuantity;
    const plan = planSelectedRefund(snapshot.map((item) => ({ ...item, refundedQuantity: currentReserved })), [{ productId: "p", quantity: 1 }]);
    await Promise.resolve();
    if (reservedQuantity !== currentReserved) throw new Error("concurrent refund reservation");
    reservedQuantity += 1;
    return plan.amount;
  };
  const outcomes = await Promise.allSettled([request(), request()]);
  assert.equal(outcomes.filter((result) => result.status === "fulfilled").length, 1);
  assert.equal(reservedQuantity, 1);
});

test("concurrent settlement attempts cannot transition a paid settlement again", async () => {
  let status = "payable";
  const settle = async () => {
    if (status !== "payable") throw new Error("not payable");
    await Promise.resolve();
    if (status !== "payable") throw new Error("already settled");
    status = "paid";
    return true;
  };
  const outcomes = await Promise.allSettled([settle(), settle()]);
  assert.equal(outcomes.filter((result) => result.status === "fulfilled").length, 1);
  assert.equal(settlementStatusFor({ orderStatus: "delivered", paymentStatus: "Paid", currentStatus: status }), "paid");
});

test("concurrent invoice snapshots have stable seller invoice references", () => {
  const args = ["order-1", "2026-09-28", {}, [{ productId: "p", sellerId: "vendor-1", sellerType: "vendor", quantity: 1, customerLineTotal: 1 }]];
  assert.equal(buildSellerInvoiceSnapshots(...args)[0].invoiceNumber, buildSellerInvoiceSnapshots(...args)[0].invoiceNumber);
});