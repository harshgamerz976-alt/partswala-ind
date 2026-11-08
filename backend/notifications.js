import { createHash } from "node:crypto";
import { isValidRequestId } from "../shared/requestIds.js";

const TOKEN_LIMIT = 4096;
const ALLOWED_LINKS = new Set(["/my-enquiries", "/vendor/enquiries"]);

function cleanText(value, maxLength) {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

export const isValidNotificationRequestId = isValidRequestId;

export function supplierNotificationId(eventType, eventId) {
  if (!["vendor-enquiry", "customer-reply"].includes(eventType)) {
    throw new Error("Unsupported supplier notification type.");
  }
  if (typeof eventId !== "string" || !eventId.trim()) throw new Error("A notification event ID is required.");
  return createHash("sha256").update(`supplier-notification:${eventType}:${eventId}`).digest("hex");
}

export function validateFcmToken(value) {
  if (typeof value !== "string") throw new Error("A valid notification token is required.");
  const token = value.trim();
  if (!token || token.length > TOKEN_LIMIT || /[\u0000-\u0020]/.test(token)) {
    throw new Error("A valid notification token is required.");
  }
  return token;
}

export function fcmTokenDocumentId(token) {
  return createHash("sha256").update(validateFcmToken(token)).digest("hex");
}

export function supplierNotification({ id, type, productName, enquiryId, createdAt }) {
  if (!["vendor-enquiry", "customer-reply"].includes(type)) {
    throw new Error("Unsupported supplier notification type.");
  }
  const name = cleanText(productName, 120) || "your product";
  const linkPath = type === "vendor-enquiry" ? "/vendor/enquiries" : "/my-enquiries";
  const title = type === "vendor-enquiry" ? "New customer enquiry received" : "New reply received";
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
  const pushMessaging = typeof messaging === "function" ? messaging() : messaging;
  if (!pushMessaging) return { created: true, sent: [], failed: [], removed: [] };
  const delivery = await sendNotificationPushSafely({ database, messaging: pushMessaging, recipientId, notification });
  return { created: true, ...delivery };
}

export function buildFcmPayload(token, notification) {
  const safeToken = validateFcmToken(token);
  const link = new URL(notification.link, "https://partswalaind.web.app");
  if (!ALLOWED_LINKS.has(link.pathname) || link.origin !== "https://partswalaind.web.app") {
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

export async function sendNotificationPushSafely(options) {
  try {
    return await sendNotificationPush(options);
  } catch (error) {
    return {
      sent: [],
      failed: [{ code: error?.code || "messaging/unknown" }],
      removed: [],
    };
  }
}
