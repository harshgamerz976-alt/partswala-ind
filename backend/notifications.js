import { createHash } from "node:crypto";
import { canCreateSupplierEnquiry } from "./vendorEnquiries.js";

const TOKEN_LIMIT = 4096;
const ALLOWED_LINKS = new Set(["/my-enquiries", "/vendor/enquiries"]);
const SUPPLIER_NOTIFICATION_TYPES = new Set(["vendor-enquiry", "customer-reply"]);

function cleanText(value, maxLength) {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

export function isFcmPushEnabled(environment = process.env) {
  return environment.FCM_PUSH_ENABLED === "true"
    && environment.NODE_ENV !== "test"
    && !environment.FIRESTORE_EMULATOR_HOST
    && !environment.FIREBASE_AUTH_EMULATOR_HOST;
}

export function canUseUserNotifications(profile, isAdmin = false) {
  return !isAdmin && canCreateSupplierEnquiry(profile, false);
}

export function validateFcmToken(value) {
  if (typeof value !== "string") throw new Error("A valid notification token is required.");
  const token = value.trim();
  const hasControlCharacters = [...token].some((character) => {
    const code = character.codePointAt(0);
    return code <= 0x20 || (code >= 0x7f && code <= 0x9f);
  });
  if (!token || token.length > TOKEN_LIMIT || hasControlCharacters) {
    throw new Error("A valid notification token is required.");
  }
  return token;
}

export function fcmTokenDocumentId(token) {
  return createHash("sha256").update(validateFcmToken(token)).digest("hex");
}

export async function registerFcmToken(database, userId, token, updatedAt = new Date().toISOString()) {
  const tokenId = fcmTokenDocumentId(token);
  const ownerRef = database.collection("fcmTokenOwners").doc(tokenId);
  const tokenRef = database.collection("users").doc(userId).collection("fcmTokens").doc(tokenId);
  await database.runTransaction(async (transaction) => {
    const ownerSnapshot = await transaction.get(ownerRef);
    const previousOwnerId = ownerSnapshot.exists ? ownerSnapshot.data()?.userId : "";
    if (previousOwnerId && previousOwnerId !== userId) {
      transaction.delete(database.collection("users").doc(previousOwnerId).collection("fcmTokens").doc(tokenId));
    }
    transaction.set(ownerRef, { userId, updatedAt });
    transaction.set(tokenRef, { token, createdAt: updatedAt, updatedAt });
  });
  return { registered: true };
}

export async function revokeFcmToken(database, userId, token) {
  const tokenId = fcmTokenDocumentId(token);
  const ownerRef = database.collection("fcmTokenOwners").doc(tokenId);
  const tokenRef = database.collection("users").doc(userId).collection("fcmTokens").doc(tokenId);
  await database.runTransaction(async (transaction) => {
    const ownerSnapshot = await transaction.get(ownerRef);
    transaction.delete(tokenRef);
    if (ownerSnapshot.exists && ownerSnapshot.data()?.userId === userId) transaction.delete(ownerRef);
  });
  return { removed: true };
}

export async function markUserNotificationRead(database, userId, notificationId, readAt = new Date().toISOString()) {
  if (typeof notificationId !== "string" || !/^[a-f0-9]{64}$/i.test(notificationId)) {
    throw new Error("A valid notification ID is required.");
  }
  const reference = database.collection("users").doc(userId).collection("notifications").doc(notificationId);
  const snapshot = await reference.get();
  if (!snapshot.exists) return false;
  if (snapshot.data()?.read !== true) await reference.update({ read: true, readAt });
  return true;
}

export async function markAllUserNotificationsRead(database, userId, readAt = new Date().toISOString()) {
  const collection = database.collection("users").doc(userId).collection("notifications");
  let updated = 0;
  while (true) {
    const snapshot = await collection.where("read", "==", false).limit(400).get();
    if (snapshot.empty) break;
    const batch = database.batch();
    snapshot.docs.forEach((document) => batch.update(document.ref, { read: true, readAt }));
    await batch.commit();
    updated += snapshot.size;
  }
  return { updated };
}

export function supplierNotificationId(type, eventKey) {
  if (!SUPPLIER_NOTIFICATION_TYPES.has(type) || typeof eventKey !== "string" || !eventKey.trim()) {
    throw new Error("A valid supplier notification event is required.");
  }
  return createHash("sha256").update(`${type}:${eventKey}`).digest("hex");
}

export function supplierNotification({ id, type, productName, enquiryId, createdAt }) {
  if (!SUPPLIER_NOTIFICATION_TYPES.has(type)) {
    throw new Error("Unsupported supplier notification type.");
  }
  const name = cleanText(productName, 120) || "your product";
  const linkPath = type === "vendor-enquiry" ? "/vendor/enquiries" : "/my-enquiries";
  const title = type === "vendor-enquiry" ? "New customer enquiry received" : "New supplier reply";
  const message = type === "vendor-enquiry"
    ? `A customer sent an enquiry for ${name}.`
    : `A supplier replied to your enquiry for ${name}.`;
  const query = new URLSearchParams({ enquiryId, notificationId: id });
  return {
    id,
    type,
    title,
    message,
    productName: name,
    enquiryId,
    createdAt,
    read: false,
    link: `${linkPath}?${query.toString()}`,
  };
}

export function buildFcmPayload(token, notification) {
  const safeToken = validateFcmToken(token);
  const link = new URL(notification.link, "https://partswalaind.com");
  if (!ALLOWED_LINKS.has(link.pathname) || link.origin !== "https://partswalaind.com") {
    throw new Error("Notification link is not allowed.");
  }
  return {
    token: safeToken,
    data: {
      notificationId: String(notification.id),
      title: cleanText(notification.title, 120),
      body: cleanText(notification.message, 240),
      link: `${link.pathname}${link.search}`,
    },
    webpush: { headers: { TTL: "60" } },
  };
}

export async function sendNotificationPush({ database, messaging, recipientId, notification }) {
  const tokenCollection = database.collection("users").doc(recipientId).collection("fcmTokens");
  const snapshot = await tokenCollection.get();
  const sent = [];
  const failed = [];
  const removed = [];
  const tokens = snapshot.docs.map((document) => ({
    document,
    token: document.data()?.token,
  })).filter(({ token }) => typeof token === "string" && token);

  for (let index = 0; index < tokens.length; index += 500) {
    const chunk = tokens.slice(index, index + 500);
    const result = await messaging.sendEach(chunk.map(({ token }) => buildFcmPayload(token, notification)));
    await Promise.all(result.responses.map(async (response, responseIndex) => {
      const tokenRecord = chunk[responseIndex];
      if (response.success) {
        sent.push(tokenRecord.document.id);
        return;
      }
      const code = response.error?.code || "messaging/unknown";
      failed.push({ tokenId: tokenRecord.document.id, code });
      if (["messaging/registration-token-not-registered", "messaging/invalid-registration-token"].includes(code)) {
        const ownerRef = database.collection("fcmTokenOwners").doc(tokenRecord.document.id);
        await database.runTransaction(async (transaction) => {
          const ownerSnapshot = await transaction.get(ownerRef);
          transaction.delete(tokenRecord.document.ref);
          if (ownerSnapshot.exists && ownerSnapshot.data()?.userId === recipientId) transaction.delete(ownerRef);
        });
        removed.push(tokenRecord.document.id);
      }
    }));
  }
  return { sent, failed, removed };
}

export async function persistSupplierNotification({ database, messaging, recipientId, notification }) {
  if (!/^[a-f0-9]{64}$/i.test(notification.id)) throw new Error("A valid notification ID is required.");
  if (typeof recipientId !== "string" || !recipientId.trim()) throw new Error("A valid notification recipient is required.");
  const notificationRef = database.collection("users").doc(recipientId).collection("notifications").doc(notification.id);
  const created = await database.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(notificationRef);
    if (snapshot.exists) return false;
    transaction.create(notificationRef, notification);
    return true;
  });
  if (!created) return { created: false, sent: [], failed: [], removed: [] };
  if (!messaging) return { created: true, sent: [], failed: [], removed: [] };
  const delivery = await sendNotificationPush({ database, messaging, recipientId, notification });
  return { created: true, ...delivery };
}
