import test from "node:test";
import assert from "node:assert/strict";
import {
  buildFcmPayload,
  canUseUserNotifications,
  fcmTokenDocumentId,
  persistSupplierNotification,
  supplierNotification,
  supplierNotificationId,
  validateFcmToken,
} from "./notifications.js";

test("notification access is limited to customers and approved vendors, never admins", () => {
  assert.equal(canUseUserNotifications({ role: "customer" }), true);
  assert.equal(canUseUserNotifications({ role: "vendor", vendorStatus: "approved" }), true);
  assert.equal(canUseUserNotifications({ role: "vendor", vendorStatus: "pending" }), false);
  assert.equal(canUseUserNotifications({ role: "admin" }), false);
  assert.equal(canUseUserNotifications({ role: "customer" }, true), false);
});

test("FCM tokens are validated and stored by one-way document IDs", () => {
  assert.throws(() => validateFcmToken("token with spaces"), /valid notification token/i);
  assert.throws(() => validateFcmToken(""), /valid notification token/i);
  assert.equal(fcmTokenDocumentId("test-token").length, 64);
  assert.notEqual(fcmTokenDocumentId("test-token"), "test-token");
});

test("supplier notification payloads contain only safe copy and authorized relative links", () => {
  const id = supplierNotificationId("vendor-enquiry", "enquiry-1");
  const notification = supplierNotification({
    id,
    type: "vendor-enquiry",
    productName: "Clutch plate",
    enquiryId: "enquiry-1",
    createdAt: "2026-10-21T12:00:00.000Z",
  });
  const payload = buildFcmPayload("valid-fcm-token", notification);
  assert.equal(payload.data.link.startsWith("/vendor/enquiries?"), true);
  assert.equal(JSON.stringify(payload).includes("buyerMessage"), false);
  assert.equal(JSON.stringify(payload).includes("buyerEmail"), false);
  assert.throws(() => buildFcmPayload("valid-fcm-token", {
    ...notification,
    link: "https://attacker.example/",
  }), /link is not allowed/i);
});

test("notification persistence deduplicates the same business event before sending", async () => {
  let stored;
  let sends = 0;
  const notification = supplierNotification({
    id: supplierNotificationId("customer-reply", "quote-1"),
    type: "customer-reply",
    productName: "Brake shoe",
    enquiryId: "enquiry-2",
    createdAt: "2026-10-21T12:00:00.000Z",
  });
  const reference = {
    async get() {
      return { exists: Boolean(stored) };
    },
  };
  const database = {
    collection(path) {
      assert.equal(path, "users");
      return {
        doc(userId) {
          assert.equal(userId, "buyer-1");
          return {
            collection(name) {
              if (name === "fcmTokens") return {
                get: async () => ({
                  docs: [{
                    id: "device-token",
                    data: () => ({ token: "valid-fcm-token" }),
                    ref: {},
                  }],
                }),
              };
              assert.equal(name, "notifications");
              return { doc: () => reference };
            },
          };
        },
      };
    },
    async runTransaction(callback) {
      return callback({
        get: (ref) => ref.get(),
        create: (_ref, value) => { stored = value; },
      });
    },
  };
  const messaging = {
    async sendEach() {
      sends += 1;
      return { responses: [{ success: true }] };
    },
  };
  const first = await persistSupplierNotification({
    database,
    messaging,
    recipientId: "buyer-1",
    notification,
  });
  const second = await persistSupplierNotification({
    database,
    messaging,
    recipientId: "buyer-1",
    notification,
  });
  assert.equal(first.created, true);
  assert.equal(second.created, false);
  assert.equal(sends, 1);
  assert.equal(stored.read, false);
  assert.equal(Object.hasOwn(stored, "buyerMessage"), false);
});
