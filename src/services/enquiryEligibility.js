export function canSubmitSupplierEnquiry({ profile, isAdmin = false, loading = false } = {}) {
  if (loading || isAdmin) return false;
  return profile?.role === "customer"
    || (profile?.role === "vendor" && profile.vendorStatus === "approved");
}
