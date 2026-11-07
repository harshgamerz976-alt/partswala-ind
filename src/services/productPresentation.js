export function getKnownProductStock(product) {
  const value = product?.stock ?? product?.stockCount;
  if (typeof value !== "number" && typeof value !== "string") return null;
  if (typeof value === "string" && !value.trim()) return null;
  const stock = Number(value);
  return Number.isFinite(stock) && stock >= 0 ? stock : null;
}

export function getProductTaxLabel(priceIncludesGst) {
  if (priceIncludesGst === true) return "Inclusive of applicable taxes";
  if (priceIncludesGst === false) return "Before applicable GST";
  return "Tax treatment to confirm with supplier";
}
