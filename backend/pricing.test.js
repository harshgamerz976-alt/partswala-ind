import assert from "node:assert/strict";
import test from "node:test";
import { calculateOrderPricing } from "./pricing.js";
import { validatedDeliveryState } from "./sellerTaxContext.js";
import { buildFinanceTotals, calculateLineFinance, calculateRefundReversal, planItemCancellation, planSelectedRefund, settlementStatusFor } from "./finance.js";
import { canTransitionReturnStatus, validateReturnInspection } from "./returns.js";
import { clearShippingQuoteCache, getShiprocketShippingQuote } from "./shipping.js";
import { customerFacingPricing } from "./customerPricing.js";
import { calculateShippingEstimate } from "../src/services/shippingService.js";

const settings = {
  businessState: "Maharashtra",
  pickupPincode: "400001",
  shippingFee: 199,
  freeShippingThreshold: 4999,
  codFee: 30,
  codFeeTaxTreatment: "non_taxable",
  shippingTaxTreatment: "taxable",
  pricesIncludeGst: false,
};

const products = {
  part12: { name: "Part 12", price: 1000, stock: 10, hsn: "8708", gstRate: 12, weight: 1 },
  part5: { name: "Part 5", price: 1000, stock: 10, hsn: "8708", gstRate: 5, weight: 1 },
  part28: { name: "Part 28", price: 1000, stock: 10, hsn: "8708", gstRate: 28, weight: 1 },
};

function quote({ productIds = ["part12"], ...overrides } = {}) {
  return calculateOrderPricing({
    items: productIds.map((productId) => ({ productId, quantity: 1 })),
    productsById: products,
    settings,
    couponRate: 0,
    customerState: "Maharashtra",
    deliveryPincode: "400002",
    paymentMethod: "COD",
    shippingQuote: { available: true, amount: 70, isEstimate: false, provider: "test" },
    ...overrides,
  });
}

test("A. COD without discount includes configured COD fee", () => {
  const result = quote();
  assert.equal(result.subtotal, 1000);
  assert.equal(result.discount, 0);
  assert.equal(result.codFee, 30);
  assert.equal(result.grandTotal, 1292.6);
});

test("B. COD coupon discount is deducted before GST", () => {
  const result = quote({ couponRate: 0.1 });
  assert.equal(result.discount, 100);
  assert.equal(result.taxableAmount, 970);
  assert.equal(result.grandTotal, 1174.6);
});

test("C. prepaid without discount has no COD fee", () => {
  const result = quote({ paymentMethod: "Online" });
  assert.equal(result.codFee, 0);
  assert.equal(result.grandTotal, 1262.6);
});

test("D. prepaid coupon discount is applied before GST", () => {
  const result = quote({ paymentMethod: "Online", couponRate: 0.1 });
  assert.equal(result.discount, 100);
  assert.equal(result.codFee, 0);
  assert.equal(result.grandTotal, 1144.6);
});

test("E. checkout enforces the fixed 18 percent GST rate", () => {
  const result = quote({ productIds: ["part5"], paymentMethod: "Online" });
  assert.equal(result.gstTotal, 192.6);
  assert.equal(result.gstGroups[0].gstRate, 18);
});

test("F. intra-state order splits GST into CGST and SGST", () => {
  const result = quote({ paymentMethod: "Online" });
  assert.equal(result.taxMode, "intra_state");
  assert.equal(result.cgst, 96.3);
  assert.equal(result.sgst, 96.3);
  assert.equal(result.igst, 0);
});

test("G. inter-state order uses IGST only", () => {
  const result = quote({ customerState: "Gujarat", paymentMethod: "Online" });
  assert.equal(result.taxMode, "inter_state");
  assert.equal(result.cgst, 0);
  assert.equal(result.sgst, 0);
  assert.equal(result.igst, 192.6);
});

test("mixed-seller order derives GST mode from each supplier's state", () => {
  const result = quote({
    items: [{ productId: "local", quantity: 1 }, { productId: "remote-vendor", quantity: 1 }],
    productsById: {
      local: { name: "Local part", price: 1000, stock: 2, weight: 1, sellerId: "partswala", sellerType: "partswala", sellerState: "Maharashtra" },
      "remote-vendor": { name: "Vendor part", price: 1000, stock: 2, weight: 1, sellerId: "vendor-a", sellerType: "vendor", sellerState: "Gujarat" },
    },
    customerState: "Maharashtra",
    settings: { ...settings, shippingTaxTreatment: "non_taxable" },
    paymentMethod: "Online",
  });
  assert.equal(result.items[0].taxMode, "intra_state");
  assert.equal(result.items[0].cgst, 90);
  assert.equal(result.items[0].sgst, 90);
  assert.equal(result.items[0].igst, 0);
  assert.equal(result.items[1].taxMode, "inter_state");
  assert.equal(result.items[1].cgst, 0);
  assert.equal(result.items[1].sgst, 0);
  assert.equal(result.items[1].igst, 180);
  assert.equal(result.taxMode, "mixed");
  assert.equal(result.items[0].sellerState, "Maharashtra");
  assert.equal(result.items[1].sellerState, "Gujarat");
  const localSuborder = result.sellerSuborders.find((suborder) => suborder.sellerId === "partswala");
  const vendorSuborder = result.sellerSuborders.find((suborder) => suborder.sellerId === "vendor-a");
  assert.deepEqual([localSuborder.taxMode, localSuborder.cgst, localSuborder.sgst, localSuborder.igst], ["intra_state", 90, 90, 0]);
  assert.deepEqual([vendorSuborder.taxMode, vendorSuborder.cgst, vendorSuborder.sgst, vendorSuborder.igst], ["inter_state", 0, 0, 180]);
  assert.deepEqual([localSuborder.sellerState, localSuborder.customerState, localSuborder.gstRate], ["Maharashtra", "Maharashtra", 18]);
  assert.deepEqual([vendorSuborder.sellerState, vendorSuborder.customerState, vendorSuborder.gstRate], ["Gujarat", "Maharashtra", 18]);
});

test("same-state vendor GST does not require PARTSWALA business state", () => {
  const result = quote({
    items: [{ productId: "vendor", quantity: 1 }],
    productsById: { vendor: { name: "Vendor part", price: 1000, stock: 2, weight: 1, sellerId: "vendor-a", sellerType: "vendor", sellerState: "Maharashtra" } },
    settings: { ...settings, businessState: "", freeShippingThreshold: 0, shippingTaxTreatment: "non_taxable" },
    customerState: validatedDeliveryState(" Maharashtra "),
    paymentMethod: "Online",
  });
  assert.equal(result.items[0].taxMode, "intra_state");
  assert.equal(result.items[0].cgst, 90);
  assert.equal(result.items[0].sgst, 90);
  assert.equal(result.items[0].sellerState, "Maharashtra");
  assert.deepEqual([result.sellerSuborders[0].sellerState, result.sellerSuborders[0].customerState, result.sellerSuborders[0].gstRate], ["Maharashtra", "Maharashtra", 18]);
});

test("single interstate vendor order snapshots IGST and both registered states", () => {
  const result = quote({
    items: [{ productId: "vendor", quantity: 1 }],
    productsById: { vendor: { name: "Vendor part", price: 1000, stock: 2, weight: 1, sellerId: "vendor-a", sellerType: "vendor", sellerState: "Gujarat" } },
    settings: { ...settings, businessState: "", freeShippingThreshold: 0, shippingTaxTreatment: "non_taxable" },
    customerState: validatedDeliveryState("Maharashtra"),
    paymentMethod: "Online",
  });
  const [item] = result.items;
  const [suborder] = result.sellerSuborders;
  assert.deepEqual([item.taxMode, item.cgst, item.sgst, item.igst], ["inter_state", 0, 0, 180]);
  assert.deepEqual([suborder.sellerState, suborder.customerState, suborder.gstRate, suborder.taxMode, suborder.igst], ["Gujarat", "Maharashtra", 18, "inter_state", 180]);
});

test("two vendor sellers calculate tax independently and snapshot each seller suborder", () => {
  const result = quote({
    items: [{ productId: "seller-a", quantity: 1 }, { productId: "seller-b", quantity: 1 }],
    productsById: {
      "seller-a": { name: "Seller A part", price: 1000, stock: 2, weight: 1, sellerId: "seller-a", sellerType: "vendor", sellerState: "Maharashtra" },
      "seller-b": { name: "Seller B part", price: 1000, stock: 2, weight: 1, sellerId: "seller-b", sellerType: "vendor", sellerState: "Delhi" },
    },
    settings: { ...settings, businessState: "", freeShippingThreshold: 0, shippingTaxTreatment: "non_taxable" },
    customerState: validatedDeliveryState("Maharashtra"),
    paymentMethod: "Online",
  });
  const [local, interstate] = result.items;
  assert.deepEqual([local.taxMode, local.cgst, local.sgst, local.igst], ["intra_state", 90, 90, 0]);
  assert.deepEqual([interstate.taxMode, interstate.cgst, interstate.sgst, interstate.igst], ["inter_state", 0, 0, 180]);
  const sellerA = result.sellerSuborders.find((suborder) => suborder.sellerId === "seller-a");
  const sellerB = result.sellerSuborders.find((suborder) => suborder.sellerId === "seller-b");
  assert.deepEqual([sellerA.taxMode, sellerA.cgst, sellerA.sgst, sellerA.igst], ["intra_state", 90, 90, 0]);
  assert.deepEqual([sellerB.taxMode, sellerB.cgst, sellerB.sgst, sellerB.igst], ["inter_state", 0, 0, 180]);
});

test("PARTSWALA-owned products use PARTSWALA registration state and retain zero vendor commission", () => {
  const result = quote({
    items: [{ productId: "partswala-part", quantity: 1 }],
    productsById: { "partswala-part": { name: "PARTSWALA part", price: 1000, stock: 2, weight: 1, sellerId: "partswala", sellerType: "partswala", sellerState: "Gujarat", vendorState: "Gujarat" } },
    settings: { ...settings, businessState: "Maharashtra", freeShippingThreshold: 0, shippingTaxTreatment: "non_taxable" },
    customerState: "Maharashtra",
    paymentMethod: "Online",
  });
  assert.deepEqual([result.items[0].sellerState, result.items[0].taxMode, result.items[0].cgst, result.items[0].sgst, result.items[0].igst], ["Maharashtra", "intra_state", 90, 90, 0]);
  assert.equal(result.items[0].commissionRate, 0);
  assert.deepEqual([result.sellerSuborders[0].taxMode, result.sellerSuborders[0].cgst, result.sellerSuborders[0].sgst, result.sellerSuborders[0].igst], ["intra_state", 90, 90, 0]);
});

test("vendor checkout fails safely when registered tax state is missing", () => {
  assert.throws(() => quote({
    items: [{ productId: "vendor", quantity: 1 }],
    productsById: { vendor: { name: "Vendor A", vendorName: "Vendor A", price: 1000, stock: 2, weight: 1, sellerId: "vendor-a", sellerType: "vendor", pickupLocation: { state: "Gujarat" } } },
  }), /Vendor A is missing a registered business\/GST state/);
});

test("H. free-shipping threshold yields zero shipping", () => {
  const result = quote({
    items: [{ productId: "part12", quantity: 5 }],
    productsById: { part12: { ...products.part12, price: 1000, stock: 10 } },
    paymentMethod: "Online",
  });
  assert.equal(result.shippingCharge, 0);
  assert.equal(result.shippingTaxableAmount, 0);
  assert.equal(result.grandTotal, 5900);
});

test("I. paid shipping stays separate and can be configured non-taxable", () => {
  const result = quote({ paymentMethod: "Online", settings: { ...settings, shippingTaxTreatment: "non_taxable" } });
  assert.equal(result.shippingCharge, 70);
  assert.equal(result.shippingTaxableAmount, 0);
  assert.equal(result.grandTotal, 1250);
});

test("J. all seller lines use fixed 18 percent GST", () => {
  const result = quote({ productIds: ["part5", "part28"], paymentMethod: "Online", shippingQuote: { available: true, amount: 100, isEstimate: false, provider: "test" } });
  assert.equal(result.items[0].gstRate, 18);
  assert.equal(result.items[1].gstRate, 18);
  assert.equal(result.gstGroups.length, 1);
  assert.equal(result.gstTotal, 378);
  assert.equal(result.grandTotal, 2478);
});

test("missing GST rate defaults to 18 percent and missing HSN remains blank", () => {
  const result = quote({ productsById: { old: { name: "Old item", price: 20, stock: 2, weight: 1 } }, items: [{ productId: "old", quantity: 1 }] });
  assert.equal(result.items[0].gstRate, 18);
  assert.equal(result.items[0].hsn, "");
});

test("invalid delivery pincode prevents shipping calculation", () => {
  assert.throws(() => quote({ deliveryPincode: "123" }), /valid 6-digit delivery pincode/);
});

test("checkout no longer depends on the platform-wide pickup pincode when shipping is quoted", () => {
  const result = quote({ pickupPincode: "", settings: { ...settings, pickupPincode: "" } });
  assert.equal(result.shippingCharge, 70);
  assert.equal(result.grandTotal, 1292.6);
});

test("vendor pickup validation requires a complete address and valid 6-digit pincode", async () => {
  const { hasValidVendorPickupLocation, normalizeVendorPickupLocation } = await import("./vendorPickup.js");
  assert.equal(hasValidVendorPickupLocation({
    name: "Vendor A",
    contactPerson: "Rakesh",
    phone: "9999999999",
    addressLine1: "12 Main Road",
    city: "Pune",
    state: "Maharashtra",
    pincode: "411001",
  }), true);
  assert.equal(hasValidVendorPickupLocation({
    name: "Vendor A",
    contactPerson: "Rakesh",
    phone: "9999999999",
    addressLine1: "12 Main Road",
    city: "Pune",
    state: "Maharashtra",
    pincode: "41100",
  }), false);
  assert.throws(() => normalizeVendorPickupLocation({
    name: "Vendor A",
    contactPerson: "Rakesh",
    phone: "9999999999",
    addressLine1: "12 Main Road",
    city: "Pune",
    state: "Maharashtra",
    pincode: "41100",
  }), /valid 6-digit pincode/);
});

test("order totals reconcile to line totals and tax", () => {
  const result = quote({ productIds: ["part5", "part28"], paymentMethod: "Online" });
  const lineDiscountCents = result.items.reduce((sum, item) => sum + Math.round(item.discount * 100), 0);
  const lineTaxCents = result.items.reduce((sum, item) => sum + Math.round(item.gstTotal * 100), 0);
  assert.equal(lineDiscountCents, Math.round(result.discount * 100));
  assert.equal(lineTaxCents, Math.round(result.gstTotal * 100));
  assert.equal(result.grandTotal, result.subtotal - result.discount + result.shippingCharge + result.codFee + result.gstTotal);
});

test("product-level discount is applied before product GST", () => {
  const result = quote({
    paymentMethod: "Online",
    productsById: { part12: { ...products.part12, discountPercent: 10 } },
  });
  assert.equal(result.productDiscount, 100);
  assert.equal(result.couponDiscount, 0);
  assert.equal(result.items[0].taxableValue, 900);
  assert.equal(result.gstTotal, 174.6);
});

test("configured taxable COD fee is included in taxable value before GST", () => {
  const result = quote({ settings: { ...settings, codFeeTaxTreatment: "taxable" } });
  assert.equal(result.codFee, 30);
  assert.equal(result.codFeeTaxableAmount, 30);
  assert.equal(result.taxableAmount, 1100);
  assert.equal(result.gstTotal, 198);
  assert.equal(result.grandTotal, 1298);
});

test("ten units use total shipment weight and correct intra-state GST", () => {
  const result = quote({
    items: [{ productId: "heavy", quantity: 10 }],
    productsById: { heavy: { name: "Brake Pad", price: 40000, stock: 10, gstRate: 18, weight: 2 } },
    paymentMethod: "Online",
    settings: { ...settings, freeShippingThreshold: 0, shippingTaxTreatment: "non_taxable" },
    shippingQuote: { available: true, amount: 550, isEstimate: false, provider: "test" },
  });
  assert.equal(result.subtotal, 400000);
  assert.equal(result.shippingActualWeight, 20);
  assert.equal(result.shippingChargeableWeight, 20);
  assert.equal(result.shippingCharge, 550);
  assert.equal(result.cgst, 36000);
  assert.equal(result.sgst, 36000);
  assert.equal(result.igst, 0);
  assert.equal(result.grandTotal, 472550);
  assert.equal(result.items[0].totalWeight, 20);
});

test("mixed products sum actual and individual volumetric weights", () => {
  const result = quote({
    items: [{ productId: "a", quantity: 10 }, { productId: "b", quantity: 2 }],
    productsById: {
      a: { name: "A", price: 40000, stock: 10, gstRate: 18, weight: 2, dimensions: { length: 10, width: 10, height: 10 } },
      b: { name: "B", price: 1000, stock: 2, gstRate: 18, weight: 3 },
    },
    paymentMethod: "Online",
    settings: { ...settings, freeShippingThreshold: 0, shippingTaxTreatment: "non_taxable" },
  });
  assert.equal(result.shippingActualWeight, 26);
  assert.equal(result.shippingVolumetricWeight, 2);
  assert.equal(result.shippingChargeableWeight, 26);
});

test("inter-state 18 percent GST uses IGST only", () => {
  const result = quote({
    items: [{ productId: "heavy", quantity: 10 }],
    productsById: { heavy: { name: "Brake Pad", price: 40000, stock: 10, gstRate: 18, weight: 2 } },
    customerState: "Gujarat",
    paymentMethod: "Online",
    settings: { ...settings, freeShippingThreshold: 0, shippingTaxTreatment: "non_taxable" },
  });
  assert.equal(result.igst, 72000);
  assert.equal(result.cgst, 0);
  assert.equal(result.sgst, 0);
});

test("coupon discount reduces taxable value before GST", () => {
  const result = quote({
    items: [{ productId: "heavy", quantity: 10 }],
    productsById: { heavy: { name: "Brake Pad", price: 40000, stock: 10, gstRate: 18, weight: 2 } },
    couponRate: 0.1,
    paymentMethod: "Online",
    settings: { ...settings, freeShippingThreshold: 0, shippingTaxTreatment: "non_taxable" },
    shippingQuote: { available: true, amount: 550, isEstimate: false, provider: "test" },
  });
  assert.equal(result.couponDiscount, 40000);
  assert.equal(result.merchandiseTaxableAmount, 360000);
  assert.equal(result.gstTotal, 64800);
  assert.equal(result.grandTotal, 425350);
});

test("vendor commission is based on product value before GST", () => {
  const item = calculateLineFinance({ sellerId: "vendor-a", sellerType: "vendor", unitPrice: 10000, quantity: 1, gstRate: 18, commissionRate: 10 });
  assert.equal(item.sellerSubtotal, 10000);
  assert.equal(item.taxAmount, 1800);
  assert.equal(item.commissionAmount, 1000);
  assert.equal(item.vendorPayout, 9000);
  assert.equal(item.platformRevenue, 1000);
  assert.notEqual(item.platformRevenue, item.platformRevenue + item.taxAmount);
});

test("PARTSWALA-owned products pay no vendor commission", () => {
  const item = calculateLineFinance({ unitPrice: 10000, quantity: 1, gstRate: 18, commissionRate: 10 });
  assert.equal(item.sellerType, "partswala");
  assert.equal(item.commissionAmount, 0);
  assert.equal(item.vendorPayout, 0);
  assert.equal(item.platformRevenue, 0);
});

test("PARTSWALA product margin stays separate from platform revenue", () => {
  const totals = buildFinanceTotals([{
    sellerType: "partswala",
    sellerSubtotal: 9000,
    productCost: 7000,
    quantity: 1,
    commissionAmount: 0,
    vendorPayout: 0,
  }]);
  assert.equal(totals.partswalaSales, 9000);
  assert.equal(totals.partswalaProductCost, 7000);
  assert.equal(totals.partswalaProductMargin, 2000);
  assert.equal(totals.platformRevenue, 0);
});

test("GST-inclusive price extracts tax instead of adding it twice", () => {
  const item = calculateLineFinance({ sellerId: "vendor-a", sellerType: "vendor", unitPrice: 11800, quantity: 1, gstRate: 18, commissionRate: 10, pricesIncludeGst: true });
  assert.equal(item.sellerSubtotal, 10000);
  assert.equal(item.taxAmount, 1800);
  assert.equal(item.vendorPayout, 9000);
});

test("GST-inclusive MRP sale preserves the customer total and vendor taxable-value payout", () => {
  const result = quote({
    items: [{ productId: "vendor-part", quantity: 1 }],
    productsById: { "vendor-part": { name: "Vendor Part", brand: "Roadline", partNumber: "RL-10", mrp: 10000, price: 8500, stock: 2, weight: 1, sellerId: "vendor-a", sellerType: "vendor", sellerState: "Gujarat" } },
    settings: { ...settings, pricesIncludeGst: true, vendorCommissionRate: 10, freeShippingThreshold: 0, codFee: 0, shippingTaxTreatment: "non_taxable" },
    shippingQuote: { available: true, amount: 250, actualWeight: 1, volumetricWeight: 0, chargeableWeight: 1 },
    paymentMethod: "Online",
  });
  assert.equal(result.mrpTotal, 10000);
  assert.equal(result.productDiscount, 1500);
  assert.equal(result.taxableProductValue, 7203.39);
  assert.equal(result.taxableAmount, 7203.39);
  assert.equal(result.gstTotal, 1296.61);
  assert.equal(result.grandTotal, 8750);
  assert.equal(result.items[0].commissionAmount, 720.34);
  assert.equal(result.items[0].vendorPayout, 6483.05);
  assert.equal(result.finance.platformRevenue, 720.34);
});

test("multiple sellers retain independent commission and payouts", () => {
  const lines = [
    calculateLineFinance({ sellerId: "a", sellerType: "vendor", unitPrice: 5000, quantity: 1, commissionRate: 10 }),
    calculateLineFinance({ sellerId: "b", sellerType: "vendor", unitPrice: 8000, quantity: 1, commissionRate: 10 }),
    calculateLineFinance({ unitPrice: 3000, quantity: 1, commissionRate: 10 }),
  ];
  assert.deepEqual(lines.map((line) => [line.sellerId, line.commissionAmount, line.vendorPayout]), [["a", 500, 4500], ["b", 800, 7200], ["partswala", 0, 0]]);
  const totals = buildFinanceTotals(lines);
  assert.equal(totals.vendorSales, 13000);
  assert.equal(totals.partswalaSales, 3000);
  assert.equal(totals.platformCommission, 1300);
  assert.equal(totals.taxesCollected, 2880);
  assert.equal(totals.platformRevenue, 1300);
  assert.equal(totals.partswalaProductMargin, null);
});

test("full refunds reverse vendor payout and tax collection", () => {
  const item = { customerLineTotal: 11800, commissionAmount: 1000, originalCommissionAmount: 1000, vendorPayout: 9000, originalVendorPayout: 9000, platformRevenue: 1000, originalPlatformRevenue: 1000 };
  const reversal = calculateRefundReversal(item, 11800, true);
  assert.equal(reversal.commissionAmount, 0);
  assert.equal(reversal.vendorPayout, 0);
  assert.equal(reversal.platformRevenue, 0);
  assert.equal(reversal.settlementStatus, "refunded");
  const totals = buildFinanceTotals([{ sellerType: "vendor", sellerSubtotal: 0, commissionAmount: 0, vendorPayout: 0, platformServiceRevenue: 0, platformRevenue: 0, taxAmount: 1800, taxRefundAmount: 1800 }], { refundAmount: 11800 });
  assert.equal(totals.taxesCollected, 0);
  assert.equal(totals.vendorPayables, 0);
});

test("partial refunds preserve previously applied vendor gateway-fee deductions", () => {
  const item = {
    customerLineTotal: 10000,
    originalCommissionAmount: 1000,
    originalVendorPayout: 9000,
    vendorGatewayFeeDeduction: 200,
    vendorPayout: 8800,
    originalPlatformRevenue: 1000,
  };
  const reversal = calculateRefundReversal(item, 5000, false);
  assert.equal(reversal.commissionAmount, 500);
  assert.equal(reversal.vendorPayout, 4400);
  assert.equal(reversal.vendorPayoutAdjustment, 4400);
  assert.equal(reversal.platformRevenue, 500);
});

test("settlement remains pending until delivered and hold period expires", () => {
  const eligibleAt = "2026-09-10T00:00:00.000Z";
  assert.equal(settlementStatusFor({ orderStatus: "shipped", paymentStatus: "Paid", eligibleAt, now: "2026-09-20T00:00:00Z" }), "pending");
  assert.equal(settlementStatusFor({ orderStatus: "delivered", paymentStatus: "Paid", eligibleAt, now: "2026-09-20T00:00:00Z" }), "payable");
  assert.equal(settlementStatusFor({ orderStatus: "delivered", paymentStatus: "COD collected", eligibleAt, now: "2026-09-20T00:00:00Z" }), "payable");
});

test("checkout derives vendor ownership and configurable commission per seller line", () => {
  const result = quote({
    items: [{ productId: "vendor-part", quantity: 1 }],
    productsById: { "vendor-part": { name: "Vendor Brake", price: 10000, stock: 1, weight: 2, sellerId: "vendor-a", sellerType: "vendor", sellerState: "Gujarat" } },
    settings: { ...settings, vendorCommissionRate: 10, shippingTaxTreatment: "non_taxable" },
    paymentMethod: "Online",
  });
  assert.equal(result.items[0].sellerId, "vendor-a");
  assert.equal(result.items[0].sellerType, "vendor");
  assert.equal(result.items[0].sellerSubtotal, 10000);
  assert.equal(result.items[0].commissionAmount, 1000);
  assert.equal(result.items[0].vendorPayout, 9000);
  assert.equal(result.sellerSuborders[0].sellerId, "vendor-a");
  assert.equal(result.sellerSuborders[0].vendorPayout, 9000);
});

test("refunded shipping is netted from shipping collections and never becomes margin", () => {
  const totals = buildFinanceTotals([], {
    shippingChargedToCustomer: 250,
    shippingRefundAmount: 250,
    actualShippingCost: 186,
    shippingDifferencePolicy: "retain",
  });
  assert.equal(totals.shippingCollectedNet, 0);
  assert.equal(totals.shippingDifference, -186);
  assert.equal(totals.shippingRevenue, 0);
  assert.equal(totals.platformRevenue, 0);
});

test("TCS and TDS are tracked separately from platform revenue", () => {
  const item = calculateLineFinance({ sellerId: "vendor-a", sellerType: "vendor", unitPrice: 10000, quantity: 1, commissionRate: 10 });
  const totals = buildFinanceTotals([{ ...item, tcsAmount: 10, tdsAmount: 5 }]);
  assert.equal(totals.tcsAmount, 10);
  assert.equal(totals.tdsAmount, 5);
  assert.equal(totals.platformRevenue, 1000);
});

test("unreconciled gateway fees and net receipts remain unavailable", () => {
  const totals = buildFinanceTotals([{ sellerType: "vendor", sellerSubtotal: 100, taxAmount: 18, vendorPayout: 90 }]);
  assert.equal(totals.paymentGatewayFee, null);
  assert.equal(totals.paymentGatewayTax, null);
  assert.equal(totals.netPaymentReceived, null);
});

test("customer quote strips seller finance and confidential purchase costs", () => {
  const quote = customerFacingPricing({
    grandTotal: 8750,
    platformRevenue: 720.34,
    items: [{ productId: "p1", price: 8500, productCost: 7000, sellerId: "vendor-a", sellerType: "vendor", commissionAmount: 720.34, vendorPayout: 6483.05, sellerGstin: "GSTIN", quantity: 1 }],
  });
  assert.equal(quote.grandTotal, 8750);
  assert.equal(quote.platformRevenue, undefined);
  assert.deepEqual(quote.items[0], { productId: "p1", price: 8500, quantity: 1 });
});

test("shipping works from actual weight when all dimensions are optional", () => {
  const estimate = calculateShippingEstimate({ pickupPincode: "400001", deliveryPincode: "400002", totalWeight: 20, paymentMethod: "Online", orderValue: 400000 });
  assert.equal(estimate.actualWeight, 20);
  assert.equal(estimate.chargeableWeight, 20);
  assert.equal(estimate.amount, null);
  assert.equal(estimate.available, false);
  assert.equal(estimate.message, "Calculated at checkout");
});

test("checkout refuses to invent a shipping price when no courier quote is supplied", () => {
  assert.throws(() => calculateOrderPricing({
    items: [{ productId: "part12", quantity: 1 }],
    productsById: products,
    settings,
    customerState: "Maharashtra",
    pickupPincode: "400001",
    deliveryPincode: "400002",
    paymentMethod: "Online",
  }), /Shipping is unavailable/);
});

test("Shiprocket quotes use the cheapest real courier and deduplicate identical requests", async () => {
  clearShippingQuoteCache();
  let calls = 0;
  const request = () => getShiprocketShippingQuote({
    baseUrl: "https://shiprocket.example/api",
    token: "test-token",
    pickupPincode: "400001",
    deliveryPincode: "400002",
    chargeableWeight: 2.4,
    cod: false,
    orderValue: 8500,
    fetchImpl: async (url, options) => {
      calls += 1;
      assert.match(url, /weight=2.4/);
      assert.match(url, /cod=0/);
      assert.equal(options.headers.Authorization, "Bearer test-token");
      return { ok: true, json: async () => ({ data: { available_courier_companies: [
        { courier_name: "Slower", courier_company_id: 2, rate: 180 },
        { courier_name: "Faster", courier_company_id: 1, rate: 125 },
      ] } }) };
    },
  });
  const [first, second] = await Promise.all([request(), request()]);
  assert.equal(first.amount, 125);
  assert.equal(first.courierName, "Faster");
  assert.equal(second.amount, 125);
  assert.equal(calls, 1);
});

test("Shiprocket timeout and unavailable courier responses fail without a price", async () => {
  clearShippingQuoteCache();
  const options = { baseUrl: "https://shiprocket.example/api", token: "test-token", pickupPincode: "400001", deliveryPincode: "400002", chargeableWeight: 1, cod: true, orderValue: 1000 };
  await assert.rejects(() => getShiprocketShippingQuote({ ...options, fetchImpl: async () => { throw Object.assign(new Error("timeout"), { name: "TimeoutError" }); } }), /timed out/);
  await assert.rejects(() => getShiprocketShippingQuote({ ...options, fetchImpl: async () => ({ ok: true, json: async () => ({ data: { available_courier_companies: [] } }) }) }), /No courier service/);
});

test("configured platform service fee is a seller deduction, not tax", () => {
  const item = calculateLineFinance({ sellerId: "vendor-a", sellerType: "vendor", unitPrice: 10000, quantity: 1, commissionRate: 10, platformServiceFeeRate: 2 });
  assert.equal(item.commissionAmount, 1000);
  assert.equal(item.platformServiceRevenue, 200);
  assert.equal(item.vendorPayout, 8800);
  assert.equal(item.taxAmount, 1800);
});

test("cumulative partial refunds do not restore a previously reversed commission", () => {
  const item = { customerLineTotal: 11800, commissionAmount: 1000, originalCommissionAmount: 1000, vendorPayout: 9000, originalVendorPayout: 9000, platformRevenue: 1000, originalPlatformRevenue: 1000 };
  assert.equal(calculateRefundReversal(item, 5900).vendorPayout, 4500);
  assert.equal(calculateRefundReversal(item, 11800, true).vendorPayout, 0);
});

test("return lifecycle requires review, pickup, receipt, then decision", () => {
  assert.equal(canTransitionReturnStatus("submitted", "approved"), false);
  assert.equal(canTransitionReturnStatus("submitted", "under_review"), true);
  assert.equal(canTransitionReturnStatus("under_review", "pickup_pending"), true);
  assert.equal(canTransitionReturnStatus("pickup_pending", "received"), true);
  assert.equal(canTransitionReturnStatus("received", "approved"), true);
  assert.equal(canTransitionReturnStatus("received", "rejected"), true);
  assert.equal(canTransitionReturnStatus("rejected", "approved"), false);
});

test("seller-specific quotes allocate shipping across a multi-vendor order", () => {
  const result = quote({
    items: [{ productId: "vendor-a", quantity: 1 }, { productId: "vendor-b", quantity: 1 }],
    productsById: {
      "vendor-a": { name: "A", price: 5000, stock: 1, weight: 2, sellerId: "vendor-a", sellerType: "vendor", sellerState: "Maharashtra", pickupLocation: { pickupLocationId: "pickup-a", pincode: "486886" } },
      "vendor-b": { name: "B", price: 8000, stock: 1, weight: 3, sellerId: "vendor-b", sellerType: "vendor", sellerState: "Delhi", pickupLocation: { pickupLocationId: "pickup-b", pincode: "110001" } },
    },
    settings: { ...settings, shippingTaxTreatment: "non_taxable", freeShippingThreshold: 0 },
    shippingQuote: {
      available: true,
      amount: 311,
      provider: "shiprocket",
      deliveryPincode: "474011",
      sellerQuotes: [
        { sellerId: "vendor-a", sellerType: "vendor", amount: 125, rateId: "rate-a", pickupLocationId: "pickup-a", pickupPincode: "486886", shippingWeight: 2, provider: "shiprocket" },
        { sellerId: "vendor-b", sellerType: "vendor", amount: 186, rateId: "rate-b", pickupLocationId: "pickup-b", pickupPincode: "110001", shippingWeight: 3, provider: "shiprocket" },
      ],
    },
    paymentMethod: "Online",
  });
  assert.deepEqual(result.items.map((item) => [item.sellerId, item.shippingAmount, item.pickupLocationId]), [["vendor-a", 125, "pickup-a"], ["vendor-b", 186, "pickup-b"]]);
  assert.deepEqual(result.sellerSuborders.map((row) => [row.sellerId, row.shippingAmount, row.pickupLocationId]), [["vendor-a", 125, "pickup-a"], ["vendor-b", 186, "pickup-b"]]);
  assert.equal(result.shippingCharge, 311);
});

test("Shiprocket quote cache separates pickup locations", async () => {
  clearShippingQuoteCache();
  let calls = 0;
  const options = { baseUrl: "https://shiprocket.example/api", token: "test-token", pickupPincode: "400001", deliveryPincode: "400002", chargeableWeight: 1, cod: false, orderValue: 1000, fetchImpl: async () => { calls += 1; return { ok: true, json: async () => ({ data: { available_courier_companies: [{ courier_name: "Courier", courier_company_id: 1, rate: 100 }] } }) }; } };
  await getShiprocketShippingQuote({ ...options, pickupLocationId: "pickup-a" });
  await getShiprocketShippingQuote({ ...options, pickupLocationId: "pickup-b" });
  assert.equal(calls, 2);
});

test("selected-item refunds use the finalized line total and selected quantity", () => {
  const planned = planSelectedRefund([
    { productId: "part-a", quantity: 2, customerLineTotal: 2360 },
    { productId: "part-b", quantity: 1, customerLineTotal: 1180 },
  ], [{ productId: "part-a", quantity: 1 }]);
  assert.deepEqual(planned, { amount: 1180, allocations: [1180, 0] });
});

test("selected-item refunds cannot exceed unrefunded quantity", () => {
  assert.throws(() => planSelectedRefund([
    { productId: "part-a", quantity: 2, refundedQuantity: 1, customerLineTotal: 2360 },
  ], [{ productId: "part-a", quantity: 2 }]), /exceeds the remaining quantity/);
});

test("return inspection accepts resellable and quarantined conditions for exact quantities", () => {
  const inspections = validateReturnInspection([
    { productId: "part-a", quantity: 1 },
    { productId: "part-b", quantity: 2 },
  ], [
    { productId: "part-a", quantity: 1, condition: "RESELLABLE" },
    { productId: "part-b", quantity: 2, condition: "DAMAGED" },
  ]);
  assert.equal(inspections[0].condition, "RESELLABLE");
  assert.equal(inspections[1].condition, "DAMAGED");
});

test("return inspection rejects missing entries, mismatched quantities, and unknown conditions", () => {
  const items = [{ productId: "part-a", quantity: 1 }];
  assert.throws(() => validateReturnInspection(items, []), /Inspect every returned product/);
  assert.throws(() => validateReturnInspection(items, [{ productId: "part-a", quantity: 2, condition: "RESELLABLE" }]), /must match/);
  assert.throws(() => validateReturnInspection(items, [{ productId: "part-a", quantity: 1, condition: "OK" }]), /must match/);
});

test("item cancellation uses finalized line values and preserves the unaffected remainder", () => {
  const canceled = planItemCancellation({
    productId: "vendor-part",
    quantity: 2,
    customerLineTotal: 9440,
    discount: 1000,
    originalSellerSubtotal: 8000,
    originalCommissionAmount: 800,
    originalVendorPayout: 7200,
    taxAmount: 1440,
  }, 1, 0, 0);
  assert.deepEqual(canceled, {
    productId: "vendor-part",
    quantity: 1,
    remainingQuantity: 1,
    refundAmount: 4720,
    shippingRefundAmount: 0,
    taxableValueReversal: 4000,
    gstReversal: 720,
    commissionReversal: 400,
    vendorPayoutReversal: 3600,
    discountReversal: 500,
  });
});

test("item cancellation rejects excess quantity and impossible commission", () => {
  assert.throws(() => planItemCancellation({ productId: "part", quantity: 1, customerLineTotal: 100 }, 2), /exceeds the remaining/);
  assert.throws(() => planItemCancellation({ productId: "part", quantity: 1, customerLineTotal: 100, sellerSubtotal: 10, commissionAmount: 20 }, 1), /exceeds commissionable/);
});

test("selected refunds after partial cancellation use original unit value and remaining quantity", () => {
  const snapshot = [{ productId: "part-a", orderedQuantity: 3, quantity: 2, remainingQuantity: 2, cancelledQuantity: 1, originalCustomerLineTotal: 3540, originalShippingChargedToCustomer: 0, customerLineTotal: 2360 }];
  assert.deepEqual(planSelectedRefund(snapshot, [{ productId: "part-a", quantity: 1 }]), { amount: 1180, allocations: [1180] });
  assert.throws(() => planSelectedRefund(snapshot, [{ productId: "part-a", quantity: 3 }]), /exceeds the remaining quantity/);
});
