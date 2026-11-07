import { getApp } from "firebase/app";
import { deleteToken, getMessaging, getToken, isSupported, onMessage } from "firebase/messaging";
import { collection, limit, onSnapshot, orderBy, query, where } from "firebase/firestore";
import { auth, db, firebaseConfig } from "../firebase";
import { backendRequest } from "./orderService";

const MESSAGING_WORKER_PATH = "/firebase-messaging/firebase-messaging-sw.js";
const VAPID_KEY = import.meta.env.VITE_FIREBASE_VAPID_KEY || "";

function isIosHomeScreenApp() {
  return /iPhone|iPad|iPod/i.test(navigator.userAgent)
    && (navigator.standalone === true || window.matchMedia("(display-mode: standalone)").matches);
}

async function messagingIfSupported() {
  if (!("Notification" in window) || !("serviceWorker" in navigator)) return null;
  return await isSupported() ? getMessaging(getApp()) : null;
}

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
  const unsubscribeNotifications = onSnapshot(notifications, onNotifications, onError);
  const unsubscribeUnread = onSnapshot(unread, (snapshot) => onUnreadCount(snapshot.size), onError);
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

async function getPushToken(messaging) {
  const workerUrl = new URL(MESSAGING_WORKER_PATH, window.location.origin);
  Object.entries(firebaseConfig).forEach(([key, value]) => workerUrl.searchParams.set(key, String(value)));
  const registration = await navigator.serviceWorker.register(workerUrl.href, { scope: "/firebase-messaging/" });
  const token = await getToken(messaging, {
    vapidKey: VAPID_KEY,
    serviceWorkerRegistration: registration,
  });
  if (!token) throw new Error("Firebase did not return a notification token.");
  return token;
}

export async function enableBrowserNotifications() {
  if (!VAPID_KEY) return { enabled: false, reason: "missing-vapid" };
  if (/iPhone|iPad|iPod/i.test(navigator.userAgent) && !isIosHomeScreenApp()) {
    return { enabled: false, reason: "ios-install" };
  }
  const messaging = await messagingIfSupported();
  if (!messaging) return { enabled: false, reason: "unsupported" };
  const permission = Notification.permission === "default"
    ? await Notification.requestPermission()
    : Notification.permission;
  if (permission !== "granted") return { enabled: false, reason: permission === "denied" ? "denied" : "dismissed" };
  const token = await getPushToken(messaging);
  await backendRequest("/api/notifications/fcm-token", { token });
  return { enabled: true };
}

export async function syncPreviouslyEnabledBrowserNotifications() {
  if (!VAPID_KEY || !("Notification" in window) || Notification.permission !== "granted") return false;
  if (/iPhone|iPad|iPod/i.test(navigator.userAgent) && !isIosHomeScreenApp()) return false;
  const messaging = await messagingIfSupported();
  if (!messaging) return false;
  const token = await getPushToken(messaging);
  await backendRequest("/api/notifications/fcm-token", { token });
  return true;
}

export async function listenForForegroundPush(onForegroundPush) {
  const messaging = await messagingIfSupported();
  return messaging ? onMessage(messaging, onForegroundPush) : () => {};
}

export async function disableBrowserNotifications() {
  if (!("Notification" in window) || Notification.permission !== "granted" || !VAPID_KEY) {
    return { disabled: true };
  }
  const messaging = await messagingIfSupported();
  if (!messaging) return { disabled: true };
  const token = await getPushToken(messaging);
  await backendRequest("/api/notifications/fcm-token", { token }, "DELETE");
  await deleteToken(messaging);
  return { disabled: true };
}

export async function unregisterBrowserNotifications() {
  if (!auth.currentUser) return;
  return disableBrowserNotifications();
}
