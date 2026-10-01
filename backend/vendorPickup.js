export function hasValidVendorPickupLocation(pickupLocation) {
  const source = pickupLocation && typeof pickupLocation === "object" ? pickupLocation : {};
  const name = String(source.name || "").trim();
  const contactPerson = String(source.contactPerson || "").trim();
  const phone = String(source.phone || "").trim();
  const addressLine1 = String(source.addressLine1 || "").trim();
  const city = String(source.city || "").trim();
  const state = String(source.state || "").trim();
  const pincode = String(source.pincode || "").trim();
  return Boolean(name && contactPerson && phone && addressLine1 && city && state && /^\d{6}$/.test(pincode) && source.isActive !== false);
}

export function normalizeVendorPickupLocation(payload, existing = null, vendorId = "") {
  const source = payload || {};
  const pickup = {
    pickupLocationId: existing?.pickupLocationId || `pickup_${vendorId}`,
    vendorId: String(vendorId || source.vendorId || existing?.vendorId || "").trim(),
    name: String(source.name ?? existing?.name ?? "").trim(),
    contactPerson: String(source.contactPerson ?? existing?.contactPerson ?? "").trim(),
    phone: String(source.phone ?? existing?.phone ?? "").trim(),
    addressLine1: String(source.addressLine1 ?? existing?.addressLine1 ?? "").trim(),
    addressLine2: String(source.addressLine2 ?? existing?.addressLine2 ?? "").trim(),
    city: String(source.city ?? existing?.city ?? "").trim(),
    state: String(source.state ?? existing?.state ?? "").trim(),
    pincode: String(source.pincode ?? existing?.pincode ?? "").trim(),
    country: String(source.country ?? existing?.country ?? "India").trim() || "India",
    shiprocketPickupLocationId: existing?.shiprocketPickupLocationId || null,
    isActive: existing?.isActive !== false,
    createdAt: existing?.createdAt || new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  if (!hasValidVendorPickupLocation(pickup)) {
    throw new Error("Complete the pickup location name, contact, phone, address, city, state, and valid 6-digit pincode.");
  }
  return pickup;
}
