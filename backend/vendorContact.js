function normalizePublicWhatsAppNumber(value) {
  let digits = String(value || "").replace(/\D/g, "");
  if (digits.length === 10) digits = `91${digits}`;
  else if (digits.length === 11 && digits.startsWith("0")) digits = `91${digits.slice(1)}`;
  const isValidIndianNumber = digits.length === 12 && digits.startsWith("91");
  const isValidInternationalNumber = digits.length >= 8 && digits.length <= 15;
  return isValidIndianNumber || isValidInternationalNumber ? digits : null;
}

export function getExplicitPublicVendorWhatsAppNumber(product, vendorProfile) {
  return normalizePublicWhatsAppNumber(
    product?.publicWhatsAppNumber || vendorProfile?.publicWhatsAppNumber || "",
  );
}
