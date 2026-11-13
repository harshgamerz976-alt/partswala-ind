import { isCompletedVendorApplicationDecision } from "./vendorProductSearchIndex.js";

export function registerVendorApplicationDecisionRoute(app, {
  getDb,
  authenticatedUser,
  isAdminUser,
  stageAdminAudit,
  refreshVendorProductSearchIndex,
}) {
  app.patch("/api/admin/vendor-applications/:vendorId", async (request, response) => {
    const user = await authenticatedUser(request, response);
    if (!user) return;
    if (!isAdminUser(user)) return response.status(403).json({ message: "Admin access required." });
    const status = String(request.body?.status || "").toLowerCase();
    const reason = String(request.body?.reason || "").trim().slice(0, 1000);
    if (!["approved", "rejected"].includes(status) || (status === "rejected" && !reason)) {
      return response.status(400).json({ message: "Choose a valid decision and provide a rejection reason." });
    }

    try {
      const database = getDb();
      const vendorId = String(request.params.vendorId);
      const applicationRef = database.collection("vendorApplications").doc(vendorId);
      const userRef = database.collection("users").doc(vendorId);
      const timestamp = new Date().toISOString();
      const updatedVendor = await database.runTransaction(async (transaction) => {
        const [applicationSnapshot, userSnapshot] = await Promise.all([
          transaction.get(applicationRef),
          transaction.get(userRef),
        ]);
        if (!applicationSnapshot.exists) throw new Error("APPLICATION_NOT_PENDING");
        const application = applicationSnapshot.data();
        const oldUser = userSnapshot.exists ? userSnapshot.data() : {};
        if (isCompletedVendorApplicationDecision(status, application, oldUser)) return oldUser;
        if (application.status !== "pending") throw new Error("APPLICATION_NOT_PENDING");

        transaction.update(applicationRef, {
          status,
          reviewedAt: timestamp,
          reviewedBy: user.uid,
          rejectionReason: status === "rejected" ? reason : "",
        });
        let nextVendor;
        if (status === "approved") {
          const vendorProfile = {
            businessName: application.businessName,
            ownerName: application.ownerName,
            email: application.email,
            phone: application.phone,
            businessAddress: application.businessAddress,
            city: application.city,
            state: application.state,
            pincode: application.pincode,
            gstin: application.gstin || "",
            pan: application.pan || "",
          };
          transaction.set(userRef, {
            role: "vendor",
            vendorStatus: "approved",
            vendorApprovedAt: timestamp,
            vendorApprovedBy: user.uid,
            vendorProfile,
          }, { merge: true });
          nextVendor = { ...oldUser, role: "vendor", vendorStatus: "approved", vendorProfile };
        } else {
          transaction.set(userRef, { vendorStatus: "rejected" }, { merge: true });
          nextVendor = { ...oldUser, vendorStatus: "rejected" };
        }
        stageAdminAudit(transaction, database, user, {
          action: status === "approved" ? "vendor_enabled" : "vendor_disabled",
          entityType: "vendor",
          entityId: vendorId,
          oldValue: { role: oldUser.role || null, vendorStatus: oldUser.vendorStatus || null },
          newValue: { role: status === "approved" ? "vendor" : oldUser.role || null, vendorStatus: status },
          reason,
          timestamp,
        });
        return nextVendor;
      });

      await refreshVendorProductSearchIndex(database, vendorId, updatedVendor);
      return response.json({ ok: true, status });
    } catch (error) {
      return response.status(error.message === "APPLICATION_NOT_PENDING" ? 409 : 500)
        .json({ message: error.message || "Vendor application review failed." });
    }
  });
}
