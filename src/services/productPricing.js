function positivePrice(value) {
  const price = typeof value === "number"
    ? value
    : typeof value === "string" && value.trim()
      ? Number(value)
      : null;
  return Number.isFinite(price) && price > 0 ? price : null;
}

export function getProductPricing(product = {}) {
  const sellingPrice = positivePrice(product.price);
  const mrp = positivePrice(product.mrp);

  return {
    sellingPrice,
    mrp,
    discountAmount: sellingPrice !== null && mrp !== null && mrp > sellingPrice
      ? mrp - sellingPrice
      : 0,
  };
}
