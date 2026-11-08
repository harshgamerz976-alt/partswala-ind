import assert from "node:assert/strict";
import test from "node:test";
import {
  buildFcmPayload,
  fcmTokenDocumentId,
  isValidNotificationRequestId,
  persistSupplierNotification,
  sendNotificationPush,
  sendNotificationPushSafely,
  supplierNotification,
  supplierNotificationId,
  validateFcmToken,
} from "./notifications.js";

const notification = supplierNotification({
  id: "enquiry-test-1",
  type: "vendor-enquiry",
  productName: "Clutch assembly",
  enquiryId: "enquiry-1",
  createdAt: "2026-10-20T10:00:00.000Z",
});

test("supplier notifications use fixed safe routes and trusted event copy", () => {
  assert.equal(notification.title, "New customer enquiry received");
  assert.equal(notification.message, "A customer sent an enquiry for Clutch assembly.");
  assert.equal(notification.read, false);
  assert.match(notification.link, /^\/vendor\/enquiries\?enquiryId=enquiry-1&notificationId=enquiry-test-1$/);
  assert.throws(() => supplierNotification({
    id: "bad",
    type: "arbitrary",
    productName: "Clutch",
    enquiryId: "enquiry-1",
    createdAt: "",
  }), /Unsupported/);
  assert.throws(() => buildFcmPayload("token", { ...notification, link: "https://attacker.example/" }), /not allowed/i);
});

test("FCM payload contains only safe notification data and a same-origin click route", () => {
  const payload = buildFcmPayload("synthetic-token", notification);
  assert.equal(payload.token, "synthetic-token");
  assert.deepEqual(payload.data, {
    notificationId: "enquiry-test-1",
    title: "New customer enquiry received",
    body: "A customer sent an enquiry for Clutch assembly.",
    link: notification.link,
  });
  assert.deepEqual(payload.webpush, { headers: { TTL: "60" } });
  assert.equal(Object.hasOwn(payload.data, "buyerEmail"), false);
});

test("FCM tokens are validated and stored under stable non-reversible IDs", () => {
  assert.equal(validateFcmToken(" synthetic-token "), "synthetic-token");
  assert.equal(fcmTokenDocumentId("synthetic-token"), fcmTokenDocumentId("synthetic-token"));
  assert.notEqual(fcmTokenDocumentId("synthetic-token"), "synthetic-token");
  assert.throws(() => validateFcmToken("bad token"));
  assert.throws(() => validateFcmToken(""));
  assert.throws(() => validateFcmToken("x".repeat(4097)));
});

test("notification request IDs accept UUIDs for retry idempotency only", () => {
  assert.equal(isValidNotificationRequestId("7e4e2be8-fc4d-4b73-99d6-f642f85ec051"), true);
  assert.equal(isValidNotificationRequestId("recipient-vendor-1"), false);
});

test("in-site supplier notifications persist once per account and event", async () => {
  const records = new Map();
  const writes = [];
  const database = {
    collection: (collectionName) => ({
      doc: (recipientId) => ({
        collection: (subcollectionName) => ({
          doc: (notificationId) => ({
            path: `${collectionName}/${recipientId}/${subcollectionName}/${notificationId}`,
            id: notificationId,
          }),
        }),
      }),
    }),
    runTransaction: async (callback) => callback({
      get: async (reference) => ({ exists: records.has(reference.path) }),
      create: (reference, value) => {
        records.set(reference.path, value);
        writes.push(reference.path);
      },
    }),
  };
  const eventNotification = supplierNotification({
    ...notification,
    id: supplierNotificationId("vendor-enquiry", "enquiry-1"),
  });
  const first = await persistSupplierNotification({
    database,
    recipientId: "vendor-1",
    notification: eventNotification,
  });
  const duplicate = await persistSupplierNotification({
    database,
    recipientId: "vendor-1",
    notification: eventNotification,
    messaging: { sendEach: async () => { throw new Error("duplicate events must not send"); } },
  });

  assert.equal(first.created, true);
  assert.equal(duplicate.created, false);
  assert.equal(records.size, 1);
  assert.deepEqual(writes, [`users/vendor-1/notifications/${eventNotification.id}`]);
  assert.equal(records.get(writes[0]).read, false);
  assert.equal(supplierNotificationId("vendor-enquiry", "enquiry-1"), eventNotification.id);
  assert.throws(() => supplierNotificationId("unsupported", "enquiry-1"), /Unsupported/);
});

test("in-site notifications persist when the recipient has no registered push tokens", async () => {
  const records = new Map();
  let pushCalls = 0;
  const database = {
    collection: (collectionName) => ({
      doc: (recipientId) => ({
        collection: (subcollectionName) => (subcollectionName === "notifications" ? {
          doc: (notificationId) => ({
            path: `${collectionName}/${recipientId}/${subcollectionName}/${notificationId}`,
            id: notificationId,
          }),
        } : {
          get: async () => ({ docs: [] }),
        }),
      }),
    }),
    runTransaction: async (callback) => callback({
      get: async (reference) => ({ exists: records.has(reference.path) }),
      create: (reference, value) => records.set(reference.path, value),
    }),
  };
  const eventNotification = supplierNotification({
    ...notification,
    id: supplierNotificationId("customer-reply", "enquiry-2:request-1"),
    type: "customer-reply",
  });
  const result = await persistSupplierNotification({
    database,
    recipientId: "buyer-1",
    notification: eventNotification,
    messaging: {
      sendEach: async () => {
        pushCalls++;
        return { responses: [] };
      },
    },
  });

  assert.equal(result.created, true);
  assert.equal(records.size, 1);
  assert.equal(pushCalls, 0);
});

test("push delivery removes expired tokens without failing other recipients", async () => {
  const deletedTokens = [];
  const deletedOwners = [];
  const tokenCollectionOwners = [];
  const tokens = [
    { id: "valid-id", token: "valid-token" },
    { id: "moved-id", token: "expired-token" },
    { id: "expired-id", token: "expired-token-2" },
    { id: "transient-id", token: "transient-token" },
  ];
  const owners = new Map([
    ["moved-id", { userId: "another-user" }],
    ["expired-id", { userId: "vendor-1" }],
  ]);
  const database = {
    collection: (collectionName) => ({
      doc: (documentId) => ({
        id: documentId,
        collection: (subcollectionName) => {
          tokenCollectionOwners.push(`${collectionName}/${documentId}/${subcollectionName}`);
          return {
            doc: (tokenId) => ({ id: tokenId, kind: `${collectionName}/${documentId}/${subcollectionName}` }),
            get: async () => ({
              docs: tokens.map((entry) => ({
                id: entry.id,
                data: () => ({ token: entry.token }),
                ref: { id: entry.id, kind: "token" },
              })),
            }),
          };
        },
        kind: collectionName,
      }),
    }),
    runTransaction: async (callback) => callback({
      get: async (reference) => ({
        exists: owners.has(reference.id),
        data: () => owners.get(reference.id),
      }),
      delete: (reference) => {
        if (reference.kind === "token") deletedTokens.push(reference.id);
        if (reference.kind === "fcmTokenOwners") {
          deletedOwners.push(reference.id);
          owners.delete(reference.id);
        }
      },
    }),
  };
  const messaging = {
    sendEach: async (messages) => ({
      responses: messages.map((message) => message.token === "valid-token"
        ? { success: true }
        : {
          success: false,
          error: {
            code: message.token.startsWith("expired-token")
              ? "messaging/registration-token-not-registered"
              : "messaging/server-unavailable",
          },
        }),
    }),
  };
  const result = await sendNotificationPush({ database, messaging, recipientId: "vendor-1", notification });
  assert.deepEqual(tokenCollectionOwners, ["users/vendor-1/fcmTokens"]);
  assert.deepEqual(result.sent, ["valid-id"]);
  assert.deepEqual(result.removed, ["moved-id", "expired-id"]);
  assert.deepEqual(deletedTokens, ["moved-id", "expired-id"]);
  assert.deepEqual(deletedOwners, ["expired-id"]);
  assert.equal(owners.get("moved-id").userId, "another-user");
  assert.deepEqual(result.failed.map(({ code }) => code), [
    "messaging/registration-token-not-registered",
    "messaging/registration-token-not-registered",
    "messaging/server-unavailable",
  ]);
});

test("push delivery failures are converted to a safe best-effort result", async () => {
  const database = {
    collection: () => ({
      doc: () => ({
        collection: () => ({
          get: async () => { throw Object.assign(new Error("sensitive token details"), { code: "firestore/unavailable" }); },
        }),
      }),
    }),
  };
  const result = await sendNotificationPushSafely({
    database,
    messaging: { sendEach: async () => { throw new Error("must not send"); } },
    recipientId: "buyer-1",
    notification,
  });
  assert.deepEqual(result, { sent: [], failed: [{ code: "firestore/unavailable" }], removed: [] });
  assert.doesNotMatch(JSON.stringify(result), /sensitive token details/);
});
