const TOOL_PERMISSIONS = {
  customer: new Set(["answer", "getStoreInfo", "searchProducts", "getProduct", "compareProducts", "checkCompatibility", "getOrders", "getShippingEstimate", "getCart", "addToCart", "removeFromCart"]),
  vendor: new Set(["answer", "getStoreInfo", "searchProducts", "getProduct", "compareProducts", "checkCompatibility", "getOrders", "getShippingEstimate", "getCart", "addToCart", "removeFromCart", "getVendorSales", "getVendorPayout", "getLowStockProducts"]),
  admin: new Set(["answer", "getStoreInfo", "searchProducts", "getProduct", "compareProducts", "checkCompatibility", "getOrders", "getShippingEstimate", "getCart", "addToCart", "removeFromCart", "getVendorSales", "getVendorPayout", "getLowStockProducts", "getAdminFinance"]),
};

export function assistantRoleFor({ user, profile, isAdmin = false }) {
  if (!user) return "customer";
  if (isAdmin) return "admin";
  if (profile?.role === "vendor" && profile?.vendorStatus === "approved") return "vendor";
  return "customer";
}

export function canUseAssistantTool(role, toolName) {
  return TOOL_PERMISSIONS[role]?.has(toolName) === true;
}

export function allowedAssistantTools(role) {
  return [...(TOOL_PERMISSIONS[role] || TOOL_PERMISSIONS.customer)];
}