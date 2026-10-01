export async function resolveLegacySellerOwnership(productIds, loadCurrentLinks) {
  const currentLinks = await loadCurrentLinks(productIds);
  const requestedIds = new Set(productIds);
  const ownership = new Map();
  for (const link of currentLinks) {
    const productId = String(link.productId || link.id || "");
    const vendorId = String(link.vendorId || "");
    if (requestedIds.has(productId) && vendorId) {
      ownership.set(productId, { sellerId: vendorId, sellerType: "vendor" });
    }
  }
  return ownership;
}