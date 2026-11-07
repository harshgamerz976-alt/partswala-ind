export const MAX_VENDOR_PRODUCT_IMAGES = 5;

export function getVendorProductSubmissionError(form, imageCount) {
  const numericFields = ["price", "mrp", "stock", "weight", "length", "width", "height"];
  if (numericFields.some((field) => form[field] !== "" && (!Number.isFinite(Number(form[field])) || Number(form[field]) < 0))) {
    return "Enter valid non-negative numbers for price, stock, weight, and dimensions.";
  }
  if (!form.partNumber.trim() || form.weight === "" || Number(form.weight) <= 0) {
    return "Part number and a positive product weight are required.";
  }
  if (imageCount === 0) {
    return "Add at least one product image before submitting.";
  }
  if (imageCount > MAX_VENDOR_PRODUCT_IMAGES) {
    return `A product submission can include at most ${MAX_VENDOR_PRODUCT_IMAGES} images.`;
  }
  return "";
}
