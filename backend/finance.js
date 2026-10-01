function money(value) {
  const amount = Number(value);
  if (!Number.isFinite(amount)) throw new Error("Finance values must be finite numbers.");
  return Number(amount.toFixed(2));
}

function paise(value) {
  const amount = Number(value);
  if (!Number.isFinite(amount)) throw new Error("Finance values must be finite numbers.");
  return Math.round(amount * 100);
}

function rupees(value) {
  return value / 100;
}

export function calculateLineFinance({
  sellerId = "partswala",
  sellerType = "partswala",
  unitPrice,
  quantity,
  discount = 0,
  gstRate = 18,
  pricesIncludeGst = false,
  commissionRate = 10,
  platformServiceFeeRate = 0,
}) {
  const count = Number(quantity);
  const rate = Number(gstRate);
  const commissionPercent = sellerType === "vendor" ? Number(commissionRate) : 0;
  const servicePercent = Number(platformServiceFeeRate);
  if (!Number.isInteger(count) || count <= 0 || Number(unitPrice) < 0 || rate < 0 || rate > 100 || commissionPercent < 0 || commissionPercent > 100 || servicePercent < 0 || servicePercent > 100) {
    throw new Error("Invalid line-item finance inputs.");
  }

  const rateBasisPoints = Math.round(rate * 100);
  const commissionBasisPoints = Math.round(commissionPercent * 100);
  const serviceBasisPoints = Math.round(servicePercent * 100);
  const grossPaise = paise(unitPrice) * count;
  const discountPaise = Math.min(grossPaise, Math.max(0, paise(discount)));
  const customerAmountPaise = grossPaise - discountPaise;
  const taxablePaise = pricesIncludeGst && rateBasisPoints > 0
    ? Math.round(customerAmountPaise * 10000 / (10000 + rateBasisPoints))
    : customerAmountPaise;
  const taxPaise = pricesIncludeGst
    ? customerAmountPaise - taxablePaise
    : Math.round(taxablePaise * rateBasisPoints / 10000);
  const commissionPaise = sellerType === "vendor" ? Math.round(taxablePaise * commissionBasisPoints / 10000) : 0;
  const servicePaise = Math.round(taxablePaise * serviceBasisPoints / 10000);
  const payoutPaise = sellerType === "vendor" ? Math.max(0, taxablePaise - commissionPaise - servicePaise) : 0;
  const platformRevenuePaise = (sellerType === "vendor" ? commissionPaise : 0) + servicePaise;
  const sellerSubtotal = money(rupees(taxablePaise));
  const taxAmount = money(rupees(taxPaise));
  const commissionAmount = money(rupees(commissionPaise));
  const platformServiceRevenue = money(rupees(servicePaise));
  const vendorPayout = money(rupees(payoutPaise));
  const platformRevenue = money(rupees(platformRevenuePaise));
  const productDiscount = money(rupees(discountPaise));

  return {
    sellerId: String(sellerId),
    sellerType: sellerType === "vendor" ? "vendor" : "partswala",
    unitPrice: money(unitPrice),
    quantity: count,
    gstRate: rate,
    discount: productDiscount,
    sellerSubtotal,
    taxableProductValue: sellerSubtotal,
    taxAmount,
    commissionRate: commissionPercent,
    commissionAmount,
    vendorPayout,
    platformServiceRevenue,
    platformRevenue,
    shippingAmount: 0,
    shippingChargedToCustomer: 0,
    actualShippingCost: null,
    shippingDifference: null,
    paymentGatewayFee: 0,
    paymentGatewayTax: 0,
    netPaymentReceived: null,
    refundAmount: 0,
    tcsAmount: 0,
    tdsAmount: 0,
    settlementStatus: sellerType === "vendor" ? "pending" : "not_applicable",
    pricesIncludeGst: Boolean(pricesIncludeGst),
  };
}

export function buildFinanceTotals(items, { shippingChargedToCustomer = 0, shippingRefundAmount = 0, codFeeAmount = 0, codFeeRefundAmount = 0, actualShippingCost = null, paymentGatewayFee = null, paymentGatewayTax = null, refundAmount = 0, tcsAmount, tdsAmount, vendorGatewayFeeShareRate = 0, shippingDifferencePolicy = "absorb" } = {}) {
  const productValue = (item) => Number(item.sellerSubtotal ?? item.taxableValue ?? Math.max(0, Number(item.grossAmount || 0) - Number(item.discount || 0)));
  const taxValue = (item) => Number(item.taxAmount ?? item.gstTotal ?? 0);
  const vendorSales = money(items.filter((item) => item.sellerType === "vendor").reduce((sum, item) => sum + productValue(item), 0));
  const partswalaSales = money(items.filter((item) => item.sellerType !== "vendor").reduce((sum, item) => sum + productValue(item), 0));
  const partswalaItems = items.filter((item) => item.sellerType !== "vendor");
  const hasCompletePartswalaCosts = partswalaItems.every((item) => item.productCost != null && Number.isFinite(Number(item.productCost)) && Number(item.productCost) >= 0);
  const partswalaProductCost = hasCompletePartswalaCosts
    ? money(partswalaItems.reduce((sum, item) => sum + Number(item.productCost || 0) * Number(item.quantity || 0), 0))
    : null;
  const partswalaProductMargin = partswalaProductCost == null ? null : money(partswalaSales - partswalaProductCost);
  const platformCommission = money(items.reduce((sum, item) => sum + Number(item.commissionAmount || 0), 0));
  const platformServiceRevenue = money(items.reduce((sum, item) => sum + (item.platformServiceRevenue || 0), 0));
  const shippingCharged = money(shippingChargedToCustomer);
  const shippingRefund = money(shippingRefundAmount);
  const shippingCollectedNet = money(Math.max(0, shippingCharged - shippingRefund));
  const shippingCost = actualShippingCost == null ? null : money(actualShippingCost);
  const shippingDifference = shippingCost == null ? null : money(shippingCollectedNet - shippingCost);
  const shippingRevenue = shippingDifferencePolicy === "retain" && shippingDifference > 0 ? shippingDifference : 0;
  const shippingDifferenceAbsorbed = shippingDifferencePolicy === "absorb" ? shippingDifference : 0;
  const shippingDifferencePassThrough = shippingDifferencePolicy === "pass_through" ? shippingDifference : 0;
  const gatewayFee = paymentGatewayFee == null ? null : money(paymentGatewayFee);
  const gatewayTax = paymentGatewayTax == null ? null : money(paymentGatewayTax);
  const refunds = money(refundAmount);
  const taxesCollected = money(items.reduce((sum, item) => sum + taxValue(item) - Number(item.taxRefundAmount || 0), 0));
  const vendorPayables = money(items.reduce((sum, item) => sum + Number(item.vendorPayout || 0), 0));
  return {
    vendorSales,
    partswalaSales,
    partswalaProductCost,
    partswalaProductMargin,
    platformCommission,
    platformServiceRevenue,
    shippingChargedToCustomer: shippingCharged,
    shippingRefundAmount: shippingRefund,
    shippingCollectedNet,
    actualShippingCost: shippingCost,
    shippingDifference,
    shippingRevenue,
    shippingDifferenceAbsorbed,
    shippingDifferencePassThrough,
    paymentGatewayFee: gatewayFee,
    paymentGatewayTax: gatewayTax,
    netPaymentReceived: gatewayFee == null || gatewayTax == null ? null : money(items.reduce((sum, item) => sum + productValue(item) + taxValue(item), 0) + shippingCollectedNet + Math.max(0, money(codFeeAmount) - money(codFeeRefundAmount)) - gatewayFee - gatewayTax),
    taxesCollected,
    vendorPayables,
    refundAmount: refunds,
    codFeeRefundAmount: money(codFeeRefundAmount),
    platformRevenue: money(platformCommission + platformServiceRevenue + shippingRevenue),
    tcsAmount: money(tcsAmount ?? items.reduce((sum, item) => sum + (item.tcsAmount || 0), 0)),
    tdsAmount: money(tdsAmount ?? items.reduce((sum, item) => sum + (item.tdsAmount || 0), 0)),
    vendorGatewayFeeShareRate: Math.max(0, Math.min(100, Number(vendorGatewayFeeShareRate) || 0)),
    shippingDifferencePolicy: ["absorb", "pass_through", "retain"].includes(shippingDifferencePolicy) ? shippingDifferencePolicy : "absorb",
  };
}

export function settlementStatusFor({ orderStatus, paymentStatus, eligibleAt, now = new Date(), currentStatus = "pending" }) {
  if (currentStatus === "paid" || currentStatus === "refunded" || currentStatus === "held") return currentStatus;
  if (currentStatus === "refunded") return "refunded";
  if (orderStatus === "cancelled" || paymentStatus === "Refunded") return "refunded";
  if (!(["delivered", "completed"].includes(orderStatus)) || (paymentStatus !== "Paid" && paymentStatus !== "COD collected")) return "pending";
  return new Date(eligibleAt).getTime() <= new Date(now).getTime() ? "payable" : "pending";
}

export function calculateRefundReversal(item, refundAmount, fullRefund = false) {
  const refund = Math.min(Number(item.customerLineTotal || 0), Math.max(0, money(refundAmount)));
  const ratio = item.customerLineTotal > 0 ? refund / item.customerLineTotal : 0;
  const originalCommission = Number(item.originalCommissionAmount ?? item.commissionAmount ?? 0);
  const originalPayout = Math.max(0, Number(item.originalVendorPayout ?? item.vendorPayout ?? 0) - Number(item.vendorGatewayFeeDeduction || 0));
  const originalPlatformRevenue = Number(item.originalPlatformRevenue ?? item.platformRevenue ?? 0);
  const commissionAmount = fullRefund ? 0 : money(originalCommission * (1 - ratio));
  const vendorPayout = fullRefund ? 0 : money(originalPayout * (1 - ratio));
  const platformRevenue = fullRefund ? 0 : money(originalPlatformRevenue * (1 - ratio));
  return {
    refundAmount: refund,
    commissionAmount,
    commissionAdjustment: money(originalCommission - commissionAmount),
    vendorPayout,
    vendorPayoutAdjustment: money(originalPayout - vendorPayout),
    platformRevenue,
    platformRevenueAdjustment: money(originalPlatformRevenue - platformRevenue),
    settlementStatus: fullRefund ? "refunded" : "held",
  };
}

export function groupSellerSuborders(items) {
  const groups = new Map();
  for (const item of items) {
    const sellerId = String(item.sellerId || "partswala");
    const sellerType = item.sellerType === "vendor" ? "vendor" : "partswala";
    const key = `${sellerType}:${sellerId}`;
    const group = groups.get(key) || {
      sellerId,
      sellerType,
      items: [],
      sellerSubtotal: 0,
      taxAmount: 0,
      cgst: 0,
      sgst: 0,
      igst: 0,
      taxModes: new Set(),
      sellerStates: new Set(),
      customerStates: new Set(),
      gstRates: new Set(),
      commissionAmount: 0,
      vendorPayout: 0,
      shippingAmount: 0,
      actualShippingCost: 0,
      shippingDifference: 0,
      hasActualShippingCost: false,
      refundAmount: 0,
      settlementStatus: sellerType === "vendor" ? "pending" : "not_applicable",
      settlementStatuses: new Set(),
    };
    group.items.push(item.productId);
    group.sellerSubtotal += Number(item.sellerSubtotal || 0);
    group.taxAmount += Number(item.taxAmount ?? item.gstTotal ?? 0);
    group.cgst += Number(item.cgst || 0);
    group.sgst += Number(item.sgst || 0);
    group.igst += Number(item.igst || 0);
    if (item.taxMode) group.taxModes.add(item.taxMode);
    if (item.sellerState) group.sellerStates.add(String(item.sellerState));
    if (item.customerState) group.customerStates.add(String(item.customerState));
    if (item.gstRate != null && Number.isFinite(Number(item.gstRate))) group.gstRates.add(Number(item.gstRate));
    group.commissionAmount += Number(item.commissionAmount || 0);
    group.vendorPayout += Number(item.vendorPayout || 0);
    group.shippingAmount += Number(item.shippingChargedToCustomer || item.shippingAmount || 0);
    if (item.actualShippingCost != null) {
      group.actualShippingCost += Number(item.actualShippingCost || 0);
      group.hasActualShippingCost = true;
    }
    if (item.shippingDifference != null) group.shippingDifference += Number(item.shippingDifference || 0);
    group.refundAmount += Number(item.refundAmount || 0);
    if (item.settlementStatus) group.settlementStatuses.add(item.settlementStatus);
    groups.set(key, group);
  }
  return [...groups.values()].map((group) => {
    const { settlementStatuses, taxModes, sellerStates, customerStates, gstRates, ...summary } = group;
    return {
      ...summary,
      cgst: money(group.cgst),
      sgst: money(group.sgst),
      igst: money(group.igst),
      taxMode: taxModes.size === 1 ? [...taxModes][0] : taxModes.size ? "mixed" : null,
      sellerState: sellerStates.size === 1 ? [...sellerStates][0] : null,
      customerState: customerStates.size === 1 ? [...customerStates][0] : null,
      gstRate: gstRates.size === 1 ? [...gstRates][0] : null,
      settlementStatus: group.sellerType !== "vendor"
        ? "not_applicable"
        : settlementStatuses.size === 1
          ? [...settlementStatuses][0]
          : settlementStatuses.has("held") ? "held" : "pending",
      sellerSubtotal: money(group.sellerSubtotal),
      taxAmount: money(group.taxAmount),
      commissionAmount: money(group.commissionAmount),
      vendorPayout: money(group.vendorPayout),
      shippingAmount: money(group.shippingAmount),
      actualShippingCost: group.hasActualShippingCost ? money(group.actualShippingCost) : null,
      shippingDifference: group.hasActualShippingCost ? money(group.shippingDifference) : null,
      refundAmount: money(group.refundAmount),
    };
  });
}

export function allocateMoney(amount, rows, weightKey = "customerLineTotal") {
  if (!rows.length) return [];
  const totalCents = Math.round(money(amount) * 100);
  const weights = rows.map((row) => Math.max(0, Number(row[weightKey]) || 0));
  const weightTotal = weights.reduce((sum, weight) => sum + weight, 0);
  const usableWeights = weightTotal > 0 ? weights : weights.map(() => 1);
  const usableTotal = usableWeights.reduce((sum, weight) => sum + weight, 0);
  const allocations = usableWeights.map((weight) => Math.floor(totalCents * weight / usableTotal));
  let remainder = totalCents - allocations.reduce((sum, value) => sum + value, 0);
  for (let index = 0; remainder > 0; index = (index + 1) % allocations.length) {
    allocations[index] += 1;
    remainder -= 1;
  }
  return allocations.map((value) => money(value / 100));
}

export function planSelectedRefund(items, selectedItems) {
  if (!Array.isArray(selectedItems) || selectedItems.length === 0) throw new Error("Select at least one item to refund.");
  const selected = new Map();
  for (const entry of selectedItems) {
    const productId = String(entry?.productId || "").trim();
    const quantity = Number(entry?.quantity);
    if (!productId || !Number.isInteger(quantity) || quantity <= 0 || selected.has(productId)) throw new Error("Refund selections must contain unique products and positive whole-number quantities.");
    selected.set(productId, quantity);
  }

  let total = 0;
  const allocations = items.map((item) => {
    const quantity = selected.get(String(item.productId));
    if (quantity == null) return 0;
    const originalQuantity = Number(item.orderedQuantity ?? item.quantity);
    const activeQuantity = Number(item.remainingQuantity ?? Math.max(0, originalQuantity - Number(item.cancelledQuantity || 0)));
    const alreadyRefundedQuantity = Number(item.refundedQuantity || 0);
    if (!Number.isInteger(originalQuantity) || originalQuantity <= 0 || !Number.isInteger(activeQuantity) || activeQuantity < 0 || alreadyRefundedQuantity < 0 || alreadyRefundedQuantity + quantity > activeQuantity) {
      throw new Error(`Refund quantity exceeds the remaining quantity for ${item.productId}.`);
    }
    const lineTotal = Number(item.originalCustomerLineTotal ?? item.customerLineTotal);
    const originalShipping = Number(item.originalShippingChargedToCustomer ?? item.shippingChargedToCustomer ?? 0);
    const originalCodFee = Number(item.originalCodFee ?? item.codFee ?? 0);
    if (!Number.isFinite(lineTotal) || lineTotal < 0 || !Number.isFinite(originalShipping) || originalShipping < 0 || !Number.isFinite(originalCodFee) || originalCodFee < 0) throw new Error(`The saved refund snapshot for ${item.productId} is invalid.`);
    const refundableLineValue = Math.max(0, lineTotal - originalShipping - originalCodFee);
    const alreadyRefundedAmount = Number(item.refundAmount || 0) + Number(item.refundRequestedAmount || 0);
    const remainingLineValue = Math.max(0, refundableLineValue - alreadyRefundedAmount);
    const refundableUnitAmount = Math.round(refundableLineValue * 100 / originalQuantity);
    const refund = Number((Math.min(refundableUnitAmount * quantity, Math.round(remainingLineValue * 100)) / 100).toFixed(2));
    total += refund;
    return refund;
  });
  if ([...selected.keys()].some((productId) => !items.some((item) => String(item.productId) === productId))) throw new Error("A selected product is not part of this order.");
  return { amount: money(total), allocations };
}

export function planItemCancellation(item, quantity, previouslyCancelled = 0, shippingRefundAmount = 0) {
  const orderedQuantity = Number(item?.orderedQuantity ?? item?.quantity);
  const cancelledQuantity = Number(previouslyCancelled);
  const requestedQuantity = Number(quantity);
  if (!Number.isInteger(orderedQuantity) || orderedQuantity <= 0 || !Number.isInteger(cancelledQuantity) || cancelledQuantity < 0 || !Number.isInteger(requestedQuantity) || requestedQuantity <= 0 || cancelledQuantity + requestedQuantity > orderedQuantity) {
    throw new Error("Cancellation quantity exceeds the remaining ordered quantity.");
  }
  const ratio = requestedQuantity / orderedQuantity;
  const scale = (value) => money(Math.max(0, Number(value || 0)) * ratio);
  const customerLineTotal = Number(item.originalCustomerLineTotal ?? item.customerLineTotal);
  if (!Number.isFinite(customerLineTotal) || customerLineTotal < 0) throw new Error("The finalized order line has no valid refundable amount.");
  const lineShipping = Number(item.originalShippingChargedToCustomer ?? item.shippingChargedToCustomer ?? 0);
  const refundableNonShipping = Math.max(0, customerLineTotal - lineShipping);
  const refundAmount = money((Math.round(refundableNonShipping * 100 * ratio) + Math.round(Number(shippingRefundAmount || 0) * 100)) / 100);
  const commissionReversal = scale(item.originalCommissionAmount ?? item.commissionAmount);
  const payoutReversal = scale(item.originalVendorPayout ?? item.vendorPayout);
  const taxReversal = scale(item.taxAmount ?? item.gstTotal);
  if (commissionReversal > scale(item.originalSellerSubtotal ?? item.sellerSubtotal)) throw new Error("Commission reversal exceeds commissionable seller value.");
  return {
    productId: String(item.productId),
    quantity: requestedQuantity,
    remainingQuantity: orderedQuantity - cancelledQuantity - requestedQuantity,
    refundAmount,
    shippingRefundAmount: money(shippingRefundAmount),
    taxableValueReversal: scale(item.originalSellerSubtotal ?? item.sellerSubtotal),
    gstReversal: taxReversal,
    commissionReversal,
    vendorPayoutReversal: payoutReversal,
    discountReversal: scale(item.discount),
  };
}
