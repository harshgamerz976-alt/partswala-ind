const PRIVATE_PRICING_FIELDS = new Set([
  "finance",
  "sellerSuborders",
  "sellerFinancials",
  "vendorSales",
  "partswalaSales",
  "partswalaProductCost",
  "partswalaProductMargin",
  "platformCommission",
  "platformRevenue",
  "vendorPayables",
  "tcsAmount",
  "tdsAmount",
]);

const PRIVATE_ITEM_FIELDS = new Set([
  "sellerId",
  "sellerType",
  "sellerName",
  "sellerAddress",
  "sellerGstin",
  "sellerState",
  "sellerSubtotal",
  "commissionRate",
  "commissionAmount",
  "vendorPayout",
  "platformRevenue",
  "platformServiceRevenue",
  "originalSellerSubtotal",
  "originalCommissionAmount",
  "originalVendorPayout",
  "originalPlatformRevenue",
  "originalPlatformServiceRevenue",
  "settlementStatus",
  "settlementId",
  "productCost",
  "tcsAmount",
  "tdsAmount",
]);

export function customerFacingPricing(pricing) {
  const publicPricing = Object.fromEntries(Object.entries(pricing).filter(([key]) => !PRIVATE_PRICING_FIELDS.has(key)));
  return {
    ...publicPricing,
    items: (pricing.items || []).map((item) => Object.fromEntries(Object.entries(item).filter(([key]) => !PRIVATE_ITEM_FIELDS.has(key)))),
  };
}
