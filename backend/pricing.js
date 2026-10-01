import { calculateCodFee, calculateShipmentEstimate } from "../src/services/shippingService.js";
import { buildFinanceTotals, calculateLineFinance, groupSellerSuborders } from "./finance.js";
import { normalizeIndianState } from "./sellerTaxContext.js";

function toCents(value, label) {
  const amount = Number(value);
  if (!Number.isFinite(amount) || amount < 0) throw new Error(`${label} must be a non-negative amount.`);
  return Math.round(amount * 100);
}

function fromCents(value) {
  return Number((value / 100).toFixed(2));
}

function allocateCents(totalCents, weights) {
  const weightTotal = weights.reduce((sum, weight) => sum + weight, 0);
  if (!totalCents || !weights.length) return weights.map(() => 0);
  const usableWeights = weightTotal > 0 ? weights : weights.map(() => 1);
  const usableTotal = usableWeights.reduce((sum, weight) => sum + weight, 0);
  const allocations = usableWeights.map((weight) => Math.floor(totalCents * weight / usableTotal));
  let remainder = totalCents - allocations.reduce((sum, amount) => sum + amount, 0);
  for (let index = 0; remainder > 0; index = (index + 1) % allocations.length) {
    allocations[index] += 1;
    remainder -= 1;
  }
  return allocations;
}

export function calculateOrderPricing({ items, productsById, settings = {}, couponRate = 0, couponApplication = null, customerState, pickupPincode = settings.pickupPincode, deliveryPincode, paymentMethod, shippingQuote }) {
  if (!Array.isArray(items) || items.length === 0) throw new Error("Your cart is empty.");
  const registeredCustomerState = normalizeIndianState(customerState);
  if (!registeredCustomerState) throw new Error("Enter a valid Indian delivery state to calculate GST.");
  if (!/^\d{6}$/.test(String(deliveryPincode || "").trim())) throw new Error("Enter a valid 6-digit delivery pincode to calculate shipping.");

  const couponPercent = Number(couponRate);
  if (!Number.isFinite(couponPercent) || couponPercent < 0 || couponPercent > 1) throw new Error("The selected coupon is not configured correctly.");
  const isCod = String(paymentMethod || "COD").toLowerCase() === "cod";
  const freeShippingThreshold = toCents(settings.freeShippingThreshold ?? 0, "Free-shipping threshold");
  const codFeeTaxTreatment = isCod ? settings.codFeeTaxTreatment : "none";

  const quantities = new Map();
  for (const entry of items) {
    const productId = String(entry?.productId || entry?.id || "").trim();
    const quantity = Number(entry?.quantity);
    if (!productId || !Number.isInteger(quantity) || quantity <= 0) throw new Error("Cart items must include a product and a positive whole-number quantity.");
    quantities.set(productId, (quantities.get(productId) || 0) + quantity);
  }

  const lines = [...quantities.entries()].map(([productId, quantity]) => {
    const product = productsById instanceof Map ? productsById.get(productId) : productsById?.[productId];
    if (!product) throw new Error("A product in your cart is no longer available. Refresh your cart and try again.");
    const name = product.name || product.title || "Product";
    if (product.enabled === false || String(product.status || "").toLowerCase() === "disabled") throw new Error(`${name} is not currently available.`);
    if (product.stock === undefined || product.stock === null || !Number.isFinite(Number(product.stock))) throw new Error(`${name} has no valid stock data. Contact support before ordering.`);
    if (quantity > Number(product.stock)) throw new Error(`Only ${Number(product.stock)} unit(s) of ${name} are currently in stock.`);
    const gstRate = Number(settings.productGstRate ?? 18);
    if (!Number.isFinite(gstRate) || gstRate < 0 || gstRate > 100) throw new Error(`${name} has an invalid GST rate in its product details.`);
    const weight = Number(product.weight);
    if (!Number.isFinite(weight) || weight <= 0) throw new Error(`${name} is missing a valid shipping weight. Ask the store to update its product details.`);
    const priceCents = toCents(product.price, `${name} selling price`);
    const mrpCents = Number(product.mrp) > 0 ? toCents(product.mrp, `${name} MRP`) : 0;
    if (mrpCents > 0 && priceCents > mrpCents) throw new Error(`${name} selling price cannot exceed its MRP.`);
    const grossCents = (mrpCents || priceCents) * quantity;
    const sellingCents = priceCents * quantity;
    const discountPercent = Number(product.discountPercent || 0);
    if (!Number.isFinite(discountPercent) || discountPercent < 0 || discountPercent > 100) throw new Error(`${name} has an invalid product discount.`);
    const productDiscountCents = mrpCents > 0
      ? grossCents - sellingCents
      : Math.round(grossCents * discountPercent / 100);
    const priceIncludesGst = product.priceIncludesGst ?? settings.pricesIncludeGst ?? true;
    const sellerType = product.sellerType === "vendor" && product.sellerId ? "vendor" : "partswala";
    const sellerState = normalizeIndianState(sellerType === "vendor" ? product.sellerState : settings.businessState);
    if (!sellerState) {
      throw new Error(sellerType === "vendor"
        ? `${product.vendorName || `Vendor ${product.sellerId}`} is missing a registered business/GST state. Checkout is unavailable until the seller profile is corrected.`
        : "PARTSWALA's registered business/GST state is missing. Checkout is unavailable until Admin settings are corrected.");
    }

    return {
      productId,
      name,
      category: product.category || "",
      brand: product.brand || "",
      partNumber: product.partNumber || "",
      priceCents,
      mrpCents: mrpCents || priceCents,
      quantity,
      grossCents,
      sellingCents,
      productDiscountCents,
      discountPercent,
      gstRate,
      priceIncludesGst: Boolean(priceIncludesGst),
      hsn: String(product.hsn || "").trim(),
      weight,
      dimensions: product.dimensions || {},
      sellerId: sellerType === "vendor" ? String(product.sellerId) : "partswala",
      sellerType,
      sellerName: sellerType === "vendor" ? product.vendorName || product.sellerName || "Vendor" : settings.storeName || "PARTSWALA IND",
      sellerAddress: sellerType === "vendor" ? product.vendorAddress || "" : settings.address || "",
      sellerGstin: sellerType === "vendor" ? product.vendorGstin || "" : settings.gst || "",
      sellerState,
      pickupLocation: product.pickupLocation || null,
      productCost: sellerType === "partswala" && product.costPrice != null ? Number(product.costPrice) : null,
    };
  });

  const mrpSubtotalCents = lines.reduce((sum, line) => sum + line.grossCents, 0);
  const subtotalCents = lines.reduce((sum, line) => sum + line.sellingCents, 0);
  const productDiscountCents = lines.reduce((sum, line) => sum + line.productDiscountCents, 0);
  const afterProductDiscountCents = mrpSubtotalCents - productDiscountCents;
  const eligibleCouponIds = new Set(couponApplication?.eligibleProductIds || lines.map((line) => line.productId));
  const couponWeights = lines.map((line) => eligibleCouponIds.has(line.productId) ? line.grossCents - line.productDiscountCents : 0);
  const couponDiscountCents = couponApplication
    ? Math.min(couponWeights.reduce((sum, weight) => sum + weight, 0), toCents(couponApplication.discountAmount, "Coupon discount"))
    : Math.round(afterProductDiscountCents * couponPercent);
  const couponAllocations = allocateCents(couponDiscountCents, couponApplication ? couponWeights : lines.map((line) => line.grossCents - line.productDiscountCents));
  if (couponAllocations.some((allocation, index) => allocation > Math.max(0, couponWeights[index]))) throw new Error("Coupon discount cannot exceed eligible product value.");

  lines.forEach((line, index) => {
    line.couponDiscountCents = couponAllocations[index];
    line.discountCents = line.productDiscountCents + line.couponDiscountCents;
    line.financeDiscountCents = (line.mrpCents === line.priceCents ? line.productDiscountCents : 0) + line.couponDiscountCents;
      const lineFinance = calculateLineFinance({
        sellerId: line.sellerId,
        sellerType: line.sellerType,
        unitPrice: fromCents(line.priceCents),
        quantity: line.quantity,
        discount: fromCents(line.financeDiscountCents),
        gstRate: line.gstRate,
        pricesIncludeGst: line.priceIncludesGst,
        commissionRate: settings.vendorCommissionRate ?? 10,
        platformServiceFeeRate: settings.platformServiceFeeRate ?? 0,
      });
      line.finance = lineFinance;
      line.taxableCents = toCents(lineFinance.sellerSubtotal, `${line.name} taxable value`);
      line.productGstCents = toCents(lineFinance.taxAmount, `${line.name} GST`);
  });

  const discountCents = productDiscountCents + couponDiscountCents;
  const merchandiseTaxableCents = afterProductDiscountCents - couponDiscountCents;
  const codFee = isCod ? toCents(calculateCodFee(fromCents(merchandiseTaxableCents), { ...settings, codFixedFee: settings.codFee }), "COD fee") : 0;
  const shippingEstimate = calculateShipmentEstimate(
    lines.map((line) => ({ quantity: line.quantity, product: { weight: line.weight, ...line.dimensions } })),
    { pickupPincode, deliveryPincode, paymentMethod, orderValue: fromCents(merchandiseTaxableCents) },
  );
  const shipping = shippingQuote || shippingEstimate;
  if (!shipping?.available || shipping.amount == null || !Number.isFinite(Number(shipping.amount)) || Number(shipping.amount) < 0) {
    throw new Error("Shipping is unavailable for this destination. Please try again later or contact support.");
  }
  const shippingIsFree = freeShippingThreshold > 0 && merchandiseTaxableCents >= freeShippingThreshold;
  const quotedShippingCents = toCents(shipping.amount, "Shipping charge");
  const shippingChargeCents = shippingIsFree ? 0 : quotedShippingCents;
  const shippingTaxTreatment = settings.shippingTaxTreatment;
  if (shippingChargeCents > 0 && !["taxable", "non_taxable"].includes(shippingTaxTreatment)) {
    throw new Error("Store shipping tax treatment is not configured. Set it in Admin > Settings before checkout.");
  }
  if (codFee > 0 && !["taxable", "non_taxable"].includes(codFeeTaxTreatment)) {
    throw new Error("Store COD-fee tax treatment is not configured. Set it in Admin > Settings before checkout.");
  }

  const shippingTaxableCents = shippingChargeCents > 0 && shippingTaxTreatment === "taxable" ? shippingChargeCents : 0;
  const codFeeTaxableCents = codFee > 0 && codFeeTaxTreatment === "taxable" ? codFee : 0;
  const shippingChargeAllocations = shipping.sellerQuotes?.length
    ? lines.map(() => 0)
    : allocateCents(shippingChargeCents, lines.map((line) => line.taxableCents));
  if (shipping.sellerQuotes?.length) {
    for (const sellerQuote of shipping.sellerQuotes) {
      const sellerLines = lines.map((line, index) => ({ line, index })).filter(({ line }) => line.sellerId === sellerQuote.sellerId && line.sellerType === sellerQuote.sellerType);
      const allocations = allocateCents(toCents(sellerQuote.amount, "Seller shipping charge"), sellerLines.map(({ line }) => line.taxableCents));
      sellerLines.forEach(({ index }, allocationIndex) => { shippingChargeAllocations[index] = allocations[allocationIndex]; });
    }
  }
  const codFeeAllocations = allocateCents(codFee, lines.map((line) => line.taxableCents));
  const shippingAllocations = shippingTaxableCents > 0 ? shippingChargeAllocations : lines.map(() => 0);
  const codFeeTaxAllocations = allocateCents(codFeeTaxableCents, lines.map((line) => line.taxableCents));
  const groups = new Map();
  let cgstCents = 0;
  let sgstCents = 0;
  let igstCents = 0;

  lines.forEach((line, index) => {
    line.shippingTaxableCents = shippingAllocations[index];
    line.shippingChargeCents = shippingChargeAllocations[index];
    const sellerQuote = shipping.sellerQuotes?.find((quote) => quote.sellerId === line.sellerId && quote.sellerType === line.sellerType);
    line.shippingQuote = sellerQuote || null;
    line.codFeeChargeCents = codFeeAllocations[index];
    line.codFeeTaxableCents = codFeeTaxAllocations[index];
    const additionalTaxBaseCents = line.shippingTaxableCents + line.codFeeTaxableCents;
    const additionalGstCents = Math.round(additionalTaxBaseCents * line.gstRate / 100);
    const lineGstCents = line.productGstCents + additionalGstCents;
    const isIntraState = line.sellerState === registeredCustomerState;
    line.taxMode = isIntraState ? "intra_state" : "inter_state";
    line.cgstCents = isIntraState ? Math.ceil(lineGstCents / 2) : 0;
    line.sgstCents = isIntraState ? lineGstCents - line.cgstCents : 0;
    line.igstCents = isIntraState ? 0 : lineGstCents;
    line.gstCents = lineGstCents;
    cgstCents += line.cgstCents;
    sgstCents += line.sgstCents;
    igstCents += line.igstCents;

    const groupKey = `${line.gstRate}:${line.taxMode}`;
    const group = groups.get(groupKey) || { gstRate: line.gstRate, taxMode: line.taxMode, taxableCents: 0, shippingTaxableCents: 0, cgstCents: 0, sgstCents: 0, igstCents: 0, gstCents: 0 };
    group.taxableCents += line.taxableCents;
    group.shippingTaxableCents += line.shippingTaxableCents;
    group.cgstCents += line.cgstCents;
    group.sgstCents += line.sgstCents;
    group.igstCents += line.igstCents;
    group.gstCents += lineGstCents;
    groups.set(groupKey, group);
  });

  const gstTotalCents = cgstCents + sgstCents + igstCents;
  const taxModes = new Set(lines.map((line) => line.taxMode));
  const taxMode = taxModes.size === 1 ? [...taxModes][0] : "mixed";
  const taxableProductValueCents = lines.reduce((sum, line) => sum + line.taxableCents, 0);
  const taxableAmountCents = taxableProductValueCents + shippingTaxableCents + codFeeTaxableCents;
  const grandTotalCents = lines.reduce((sum, line) => {
    const productCustomerCents = line.grossCents - line.discountCents;
    const productTaxCents = line.priceIncludesGst ? 0 : line.productGstCents;
    const addOnTaxCents = line.gstCents - line.productGstCents;
    return sum + productCustomerCents + line.shippingChargeCents + line.codFeeChargeCents + productTaxCents + addOnTaxCents;
  }, 0);

  const result = {
    subtotal: fromCents(subtotalCents),
    mrpTotal: fromCents(mrpSubtotalCents),
    productGross: fromCents(subtotalCents),
    productDiscount: fromCents(productDiscountCents),
    couponDiscount: fromCents(couponDiscountCents),
    couponSnapshot: couponApplication ? { ...couponApplication, discountAmount: fromCents(couponDiscountCents) } : null,
    discount: fromCents(discountCents),
    taxableAmount: fromCents(taxableAmountCents),
    taxableProductValue: fromCents(taxableProductValueCents),
    merchandiseTaxableAmount: fromCents(taxableProductValueCents),
    shippingCharge: fromCents(shippingChargeCents),
    shippingIsEstimate: shipping.isEstimate !== false,
    shippingIsFree,
    shippingPickupPincode: shipping.pickupPincode || pickupPincode,
    shippingDeliveryPincode: shipping.deliveryPincode || deliveryPincode,
    shippingActualWeight: shipping.actualWeight ?? shippingEstimate.actualWeight,
    shippingVolumetricWeight: shipping.volumetricWeight ?? shippingEstimate.volumetricWeight,
    shippingChargeableWeight: shipping.chargeableWeight ?? shippingEstimate.chargeableWeight,
    shippingQuote: shipping.provider ? { provider: shipping.provider, courierName: shipping.courierName || "", rateId: shipping.rateId || "", quotedAmount: Number(shipping.quotedAmount ?? shipping.amount), customerShippingFree: shipping.customerShippingFree === true, quotedAt: shipping.quotedAt || null } : null,
    shippingTaxableAmount: fromCents(shippingTaxableCents),
    codFee: fromCents(codFee),
    codFeeTaxableAmount: fromCents(codFeeTaxableCents),
    cgst: fromCents(cgstCents),
    sgst: fromCents(sgstCents),
    igst: fromCents(igstCents),
    gstTotal: fromCents(gstTotalCents),
    grandTotal: fromCents(grandTotalCents),
    total: fromCents(grandTotalCents),
    totalAmount: fromCents(grandTotalCents),
    taxMode,
    shippingTaxTreatment: shippingChargeCents > 0 ? shippingTaxTreatment : "none",
    codFeeTaxTreatment: codFee > 0 ? codFeeTaxTreatment : "none",
    gstGroups: [...groups.values()].map((group) => ({
      gstRate: group.gstRate,
      taxableAmount: fromCents(group.taxableCents),
      shippingTaxableAmount: fromCents(group.shippingTaxableCents),
      cgst: fromCents(group.cgstCents),
      sgst: fromCents(group.sgstCents),
      igst: fromCents(group.igstCents),
      gstTotal: fromCents(group.gstCents),
      taxMode: group.taxMode,
    })),
    items: lines.map((line) => ({
      productId: line.productId,
      name: line.name,
      productName: line.name,
      brand: line.brand,
      partNumber: line.partNumber,
      hsn: line.hsn,
      price: fromCents(line.priceCents),
      unitPrice: fromCents(line.priceCents),
      mrp: fromCents(line.mrpCents),
      mrpTotal: fromCents(line.mrpCents * line.quantity),
      discountAmount: fromCents(line.productDiscountCents),
      quantity: line.quantity,
      weight: line.weight,
      totalWeight: Number((line.weight * line.quantity).toFixed(3)),
      dimensions: line.dimensions,
      discountPercent: line.discountPercent,
      grossAmount: fromCents(line.sellingCents),
      productDiscount: fromCents(line.productDiscountCents),
      couponDiscount: fromCents(line.couponDiscountCents),
      discount: fromCents(line.discountCents),
      sellerId: line.finance.sellerId,
      sellerType: line.finance.sellerType,
      sellerName: line.sellerName,
      sellerAddress: line.sellerAddress,
      sellerGstin: line.sellerGstin,
      sellerState: line.sellerState,
      customerState: registeredCustomerState,
      sellerSubtotal: line.finance.sellerSubtotal,
      taxableUnitPrice: fromCents(Math.round(line.taxableCents / line.quantity)),
      priceIncludesGst: line.priceIncludesGst,
      productCost: line.productCost,
      originalSellerSubtotal: line.finance.sellerSubtotal,
      commissionRate: line.finance.commissionRate,
      commissionAmount: line.finance.commissionAmount,
      originalCommissionAmount: line.finance.commissionAmount,
      vendorPayout: line.finance.vendorPayout,
      originalVendorPayout: line.finance.vendorPayout,
      platformRevenue: line.finance.platformRevenue,
      originalPlatformRevenue: line.finance.platformRevenue,
      platformServiceRevenue: line.finance.platformServiceRevenue,
      platformServiceFee: line.finance.platformServiceRevenue,
      vendorGatewayFeeDeduction: 0,
      originalPlatformServiceRevenue: line.finance.platformServiceRevenue,
      shippingAmount: fromCents(line.shippingChargeCents),
      shippingChargedToCustomer: fromCents(line.shippingChargeCents),
      shippingCalculationStatus: line.shippingQuote ? "quoted" : "unavailable",
      shippingProvider: line.shippingQuote?.provider || null,
      shippingQuoteId: line.shippingQuote?.rateId || null,
      shippingService: line.shippingQuote?.courierName || null,
      shippingWeight: line.shippingQuote?.shippingWeight ?? line.weight * line.quantity,
      pickupLocationId: line.pickupLocation?.pickupLocationId || line.shippingQuote?.pickupLocationId || null,
      pickupName: line.shippingQuote?.pickupName || line.pickupLocation?.name || null,
      shiprocketPickupLocationId: line.shippingQuote?.shiprocketPickupLocationId || line.pickupLocation?.shiprocketPickupLocationId || null,
      pickupPincode: line.pickupLocation?.pincode || line.shippingQuote?.pickupPincode || null,
      deliveryPincode: shipping.deliveryPincode || deliveryPincode,
      shippingRefundAmount: 0,
      actualShippingCost: null,
      shippingDifference: null,
      paymentGatewayFee: line.finance.paymentGatewayFee,
      paymentGatewayTax: line.finance.paymentGatewayTax,
      netPaymentReceived: line.finance.netPaymentReceived,
      refundAmount: line.finance.refundAmount,
      tcsAmount: line.finance.tcsAmount,
      tdsAmount: line.finance.tdsAmount,
      settlementStatus: line.finance.settlementStatus,
      taxableValue: fromCents(line.taxableCents),
      shippingTaxableValue: fromCents(line.shippingTaxableCents),
      codFeeTaxableValue: fromCents(line.codFeeTaxableCents),
      taxableWithShipping: fromCents(line.taxableCents + line.shippingTaxableCents),
      gstRate: line.gstRate,
      taxMode: line.taxMode,
      pricesIncludeGst: line.finance.pricesIncludeGst,
      cgst: fromCents(line.cgstCents),
      sgst: fromCents(line.sgstCents),
      igst: fromCents(line.igstCents),
      gstTotal: fromCents(line.gstCents),
      taxAmount: fromCents(line.gstCents),
      taxRefundAmount: 0,
      codFee: fromCents(line.codFeeChargeCents),
      codFeeRefundAmount: 0,
      gstAmount: fromCents(line.productGstCents),
      cgstAmount: fromCents(line.cgstCents),
      sgstAmount: fromCents(line.sgstCents),
      igstAmount: fromCents(line.igstCents),
      customerLineTotal: fromCents((line.grossCents - line.discountCents) + line.shippingChargeCents + line.codFeeChargeCents + (line.priceIncludesGst ? 0 : line.productGstCents) + line.gstCents - line.productGstCents),
    })),
  };
  const financeItems = result.items.map((item) => ({ ...item, taxAmount: item.gstTotal }));
  result.finance = buildFinanceTotals(financeItems, {
    shippingChargedToCustomer: result.shippingCharge,
    codFeeAmount: result.codFee,
    vendorGatewayFeeShareRate: settings.vendorGatewayFeeShareRate ?? 0,
    shippingDifferencePolicy: settings.shippingDifferencePolicy || "absorb",
  });
  result.sellerSuborders = groupSellerSuborders(financeItems).map((suborder) => {
    const quote = shipping.sellerQuotes?.find((entry) => entry.sellerId === suborder.sellerId && entry.sellerType === suborder.sellerType);
    return {
      ...suborder,
      customerState: registeredCustomerState,
      shippingCalculationStatus: quote ? "quoted" : "unavailable",
      shippingProvider: quote?.provider || null,
      shippingQuoteId: quote?.rateId || null,
      shippingService: quote?.courierName || null,
      shippingWeight: quote?.shippingWeight || null,
      pickupLocationId: quote?.pickupLocationId || null,
      pickupName: quote?.pickupName || null,
      shiprocketPickupLocationId: quote?.shiprocketPickupLocationId || null,
      pickupPincode: quote?.pickupPincode || null,
      deliveryPincode: shipping.deliveryPincode || deliveryPincode,
      actualShippingCost: null,
      shippingDifference: null,
    };
  });
  result.vendorSales = result.finance.vendorSales;
  result.partswalaSales = result.finance.partswalaSales;
  result.platformCommission = result.finance.platformCommission;
  result.platformRevenue = result.finance.platformRevenue;
  result.vendorPayables = result.finance.vendorPayables;
  result.tcsAmount = result.finance.tcsAmount;
  result.tdsAmount = result.finance.tdsAmount;
  return result;
}
