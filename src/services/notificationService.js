import { getApp } from "firebase/app";
import { getMessaging, getToken, isSupported, onMessage, deleteToken } from "firebase/messaging";
import { collection, limit, onSnapshot, orderBy, query, where } from "firebase/firestore";
import { db } from "../firebase";
import { backendRequest } from "./orderService";
import { getBrowserPushPreference, setBrowserPushPreference } from "./browserPushPreferences";

const MESSAGING_WORKER_PATH = "/firebase-messaging/firebase-messaging-sw.js";
const VAPID_KEY = import.meta.env.VITE_FIREBASE_VAPID_KEY || "";

export function subscribeToUserNotifications(userId, { onNotifications, onUnreadCount, onError }) {
  const notifications = query(
    collection(db, "users", userId, "notifications"),
    orderBy("createdAt", "desc"),
    limit(50),
  );
  const unread = query(
    collection(db, "users", userId, "notifications"),
    where("read", "==", false),
    limit(10),
  );
  const unsubscribeNotifications = onSnapshot(notifications, (snapshot) => {
    onNotifications(snapshot);
  }, onError);
  const unsubscribeUnread = onSnapshot(unread, (snapshot) => {
    onUnreadCount(snapshot.size);
  }, onError);
  return () => {
    unsubscribeNotifications();
    unsubscribeUnread();
  };
}

export function markNotificationRead(notificationId) {
  return backendRequest(`/api/notifications/${encodeURIComponent(notificationId)}/read`, {}, "PATCH");
}

export function markAllNotificationsRead() {
  return backendRequest("/api/notifications/read-all", {}, "PATCH");
}

async function messagingIfSupported() {
  if (!("Notification" in window) || !("serviceWorker" in navigator)) return null;
  return await isSupported() ? getMessaging(getApp()) : null;
}

async function getPushToken(messaging) {
  const registration = await navigator.serviceWorker.register(MESSAGING_WORKER_PATH, { scope: "/firebase-messaging/" });
  if (!registration.active) {
    await new Promise((resolve, reject) => {
      const worker = registration.installing || registration.waiting;
      if (!worker) return reject(new Error("The notification worker could not be started."));
      if (worker.state === "activated") return resolve();
      if (worker.state === "redundant") return reject(new Error("The notification worker could not be started."));
      const handleStateChange = () => {
        if (worker.state === "activated") {
          worker.removeEventListener("statechange", handleStateChange);
          resolve();
        } else if (worker.state === "redundant") {
          worker.removeEventListener("statechange", handleStateChange);
          reject(new Error("The notification worker could not be started."));
        }
      };
      worker.addEventListener("statechange", handleStateChange);
      handleStateChange();
    });
  }
  const token = await getToken(messaging, {
    vapidKey: VAPID_KEY,
    serviceWorkerRegistration: registration,
  });
  if (!token) throw new Error("Firebase did not return a notification token.");
  return token;
}

export async function enableBrowserNotifications(userId) {
  if (!userId) throw new Error("Sign in to enable browser notifications.");
  if (!VAPID_KEY) return { enabled: false, reason: "missing-vapid" };
  if (!("Notification" in window) || !("serviceWorker" in navigator)) {
    return { enabled: false, reason: "unsupported" };
  }
  const permission = Notification.permission === "default"
    ? await Notification.requestPermission()
    : Notification.permission;
  if (permission !== "granted") return { enabled: false, reason: permission === "denied" ? "denied" : "dismissed" };
  const messaging = await messagingIfSupported();
  if (!messaging) return { enabled: false, reason: "unsupported" };
  const token = await getPushToken(messaging);
  await backendRequest("/api/notifications/fcm-token", { token });
  setBrowserPushPreference(userId, "enabled", window.localStorage);
  return { enabled: true, messaging };
}

export async function syncPreviouslyEnabledBrowserNotifications(userId) {
  if (!userId) return { enabled: false, reason: "signed-out" };
  const preference = getBrowserPushPreference(userId, window.localStorage);
  if (preference === "disabled") return { enabled: false, reason: "disabled" };
  if (preference === "unset" && "Notification" in window && Notification.permission === "granted") {
    setBrowserPushPreference(userId, "enabled", window.localStorage);
  } else if (preference !== "enabled") {
    return { enabled: false, reason: "idle" };
  }
  if (!VAPID_KEY) return { enabled: false, reason: "missing-vapid" };
  if (!("Notification" in window) || !("serviceWorker" in navigator)) {
    return { enabled: false, reason: "unsupported" };
  }
  if (Notification.permission === "denied") return { enabled: false, reason: "denied" };
  if (Notification.permission !== "granted") return { enabled: false, reason: "idle" };
  const messaging = await messagingIfSupported();
  if (!messaging) return { enabled: false, reason: "unsupported" };
  const token = await getPushToken(messaging);
  await backendRequest("/api/notifications/fcm-token", { token });
  return { enabled: true };
}

export async function listenForForegroundPush(onForegroundPush) {
  const messaging = await messagingIfSupported();
  return messaging ? onMessage(messaging, onForegroundPush) : () => {};
}

export async function disableBrowserNotifications(userId) {
  if (!userId) throw new Error("Sign in to manage browser notifications.");
  setBrowserPushPreference(userId, "disabled", window.localStorage);
  if (!("Notification" in window) || !("serviceWorker" in navigator)
    || Notification.permission !== "granted" || !VAPID_KEY) {
    return { disabled: true, cleanupPending: true };
  }
  const messaging = await messagingIfSupported();
  if (!messaging) return { disabled: true, cleanupPending: true };
  const token = await getPushToken(messaging);
  await backendRequest("/api/notifications/fcm-token", { token }, "DELETE");
  if (!await deleteToken(messaging)) {
    throw new Error("The server token was removed, but this browser could not clear its local notification token.");
  }
  return { disabled: true };
}

export async function unregisterBrowserNotifications() {
  if (!("Notification" in window) || Notification.permission !== "granted" || !VAPID_KEY) return;
  const messaging = await messagingIfSupported();
  if (!messaging) return;
  const token = await getPushToken(messaging);
  await backendRequest("/api/notifications/fcm-token", { token }, "DELETE");
  await deleteToken(messaging);
}
