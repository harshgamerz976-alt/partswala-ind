function cents(value) {
  const amount = Number(value);
  if (!Number.isFinite(amount) || amount < 0) throw new Error("Coupon order values must be finite and non-negative.");
  return Math.round(amount * 100);
}

export function normalizeCoupon(code, campaign, legacyValue) {
  const normalizedCode = String(code || "").trim().toUpperCase();
  if (!normalizedCode) return null;
  if (campaign && typeof campaign === "object") {
    return {
      code: normalizedCode,
      active: campaign.active !== false && campaign.enabled !== false,
      type: String(campaign.type || campaign.discountType || "percentage").toLowerCase(),
      value: Number(campaign.value ?? campaign.discountValue),
      startsAt: campaign.startsAt || null,
      expiresAt: campaign.expiresAt || null,
      minimumOrderAmount: Number(campaign.minimumOrderAmount || campaign.minOrderAmount || 0),
      maximumDiscount: campaign.maximumDiscount == null && campaign.maxDiscount == null ? null : Number(campaign.maximumDiscount ?? campaign.maxDiscount),
      globalUsageLimit: campaign.globalUsageLimit == null ? null : Number(campaign.globalUsageLimit),
      perUserUsageLimit: campaign.perUserUsageLimit == null ? null : Number(campaign.perUserUsageLimit),
      eligibleProductIds: Array.isArray(campaign.eligibleProductIds) ? campaign.eligibleProductIds.map(String) : [],
      eligibleCategories: Array.isArray(campaign.eligibleCategories) ? campaign.eligibleCategories.map((value) => String(value).toLowerCase()) : [],
      sellerIds: Array.isArray(campaign.sellerIds) ? campaign.sellerIds.map(String) : [],
    };
  }
  const rate = Number(legacyValue);
  if (!Number.isFinite(rate) || rate <= 0 || rate > 1) return null;
  return { code: normalizedCode, active: true, type: "percentage", value: rate * 100, startsAt: null, expiresAt: null, minimumOrderAmount: 0, maximumDiscount: null, globalUsageLimit: null, perUserUsageLimit: null, eligibleProductIds: [], eligibleCategories: [], sellerIds: [] };
}

export function calculateCouponApplication({ coupon, items, now = new Date(), globalUsageCount = 0, userUsageCount = 0 }) {
  if (!coupon || !coupon.active) throw new Error("That coupon code is invalid or inactive.");
  const currentTime = new Date(now).getTime();
  if (coupon.startsAt && currentTime < new Date(coupon.startsAt).getTime()) throw new Error("That coupon is not active yet.");
  if (coupon.expiresAt && currentTime > new Date(coupon.expiresAt).getTime()) throw new Error("That coupon has expired.");
  const minimum = cents(coupon.minimumOrderAmount || 0);
  const orderCents = items.reduce((sum, item) => sum + cents(item.discountedValue), 0);
  if (orderCents < minimum) throw new Error("The order does not meet this coupon's minimum amount.");
  if (coupon.globalUsageLimit != null && globalUsageCount >= coupon.globalUsageLimit) throw new Error("This coupon has reached its usage limit.");
  if (coupon.perUserUsageLimit != null && userUsageCount >= coupon.perUserUsageLimit) throw new Error("You have already used this coupon the maximum number of times.");

  const productIds = new Set(coupon.eligibleProductIds);
  const categories = new Set(coupon.eligibleCategories);
  const sellers = new Set(coupon.sellerIds);
  const eligible = items.filter((item) =>
    (!productIds.size || productIds.has(String(item.productId)))
    && (!categories.size || categories.has(String(item.category || "").toLowerCase()))
    && (!sellers.size || sellers.has(String(item.sellerId || "partswala"))));
  if (!eligible.length) throw new Error("No items in this order are eligible for the coupon.");
  const eligibleCents = eligible.reduce((sum, item) => sum + cents(item.discountedValue), 0);
  const value = Number(coupon.value);
  if (!Number.isFinite(value) || value <= 0 || (coupon.type === "percentage" && value > 100) || !["percentage", "fixed"].includes(coupon.type)) throw new Error("The coupon is not configured correctly.");
  const rawDiscount = coupon.type === "percentage" ? Math.round(eligibleCents * value / 100) : cents(value);
  const cap = coupon.maximumDiscount == null ? eligibleCents : cents(coupon.maximumDiscount);
  const discountCents = Math.min(eligibleCents, cap, rawDiscount);
  return {
    code: coupon.code,
    type: coupon.type,
    value,
    discountAmount: Number((discountCents / 100).toFixed(2)),
    eligibleProductIds: eligible.map((item) => String(item.productId)),
    minimumOrderAmount: coupon.minimumOrderAmount,
    maximumDiscount: coupon.maximumDiscount,
    startsAt: coupon.startsAt,
    expiresAt: coupon.expiresAt,
  };
}