const REGISTERED_INDIAN_STATES = [
  "Andhra Pradesh", "Arunachal Pradesh", "Assam", "Bihar", "Chhattisgarh", "Goa", "Gujarat", "Haryana",
  "Himachal Pradesh", "Jharkhand", "Karnataka", "Kerala", "Madhya Pradesh", "Maharashtra", "Manipur",
  "Meghalaya", "Mizoram", "Nagaland", "Odisha", "Punjab", "Rajasthan", "Sikkim", "Tamil Nadu",
  "Telangana", "Tripura", "Uttar Pradesh", "Uttarakhand", "West Bengal", "Andaman and Nicobar Islands",
  "Chandigarh", "Dadra and Nagar Haveli and Daman and Diu", "Delhi", "Jammu and Kashmir", "Ladakh",
  "Lakshadweep", "Puducherry",
];

function stateKey(value) {
  return String(value || "").trim().toLowerCase().replace(/[^a-z0-9]/g, "");
}

const stateByKey = new Map(REGISTERED_INDIAN_STATES.map((state) => [stateKey(state), state]));
stateByKey.set("nctofdelhi", "Delhi");
stateByKey.set("orissa", "Odisha");
stateByKey.set("uttaranchal", "Uttarakhand");
stateByKey.set("pondicherry", "Puducherry");
stateByKey.set("dnhdd", "Dadra and Nagar Haveli and Daman and Diu");

export function normalizeIndianState(value) {
  return stateByKey.get(stateKey(value)) || null;
}

export function validatedDeliveryState(value) {
  const state = normalizeIndianState(value);
  if (!state) throw new Error("Enter a valid Indian delivery state to calculate GST.");
  return state;
}

export function resolveSellerTaxState({ product, vendorProfile, partswalaState }) {
  const sellerType = product?.sellerType === "vendor" && product?.sellerId ? "vendor" : "partswala";
  const sellerId = String(product?.sellerId || "partswala");
  if (sellerType === "vendor") {
    const registeredState = normalizeIndianState(vendorProfile?.state);
    if (!registeredState) {
      throw new Error(`${product.vendorName || `Vendor ${sellerId}`} is missing a registered business/GST state. Checkout is unavailable until the seller profile is corrected.`);
    }
    return registeredState;
  }

  const registeredState = normalizeIndianState(partswalaState);
  if (!registeredState) {
    throw new Error("PARTSWALA's registered business/GST state is missing. Checkout is unavailable until Admin settings are corrected.");
  }
  return registeredState;
}