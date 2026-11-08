importScripts("https://www.gstatic.com/firebasejs/12.15.0/firebase-app-compat.js");
importScripts("https://www.gstatic.com/firebasejs/12.15.0/firebase-messaging-compat.js");

firebase.initializeApp({
  apiKey: "AIzaSyDupGOm4Ubay7wKIoRVMYpp0UUyBEZme1g",
  authDomain: "partswalaflutter.firebaseapp.com",
  projectId: "partswalaflutter",
  storageBucket: "partswalaflutter.firebasestorage.app",
  messagingSenderId: "125136160557",
  appId: "1:125136160557:web:b494fc2e2aa796958b35a4",
});

const messaging = firebase.messaging();

messaging.onBackgroundMessage(({ data = {} }) => {
  self.registration.showNotification(data.title || "PARTSWALA IND", {
    body: data.body || "You have a new supplier enquiry update.",
    icon: "/favicon.svg",
    badge: "/favicon.svg",
    tag: `partswala-${data.notificationId || "notification"}`,
    renotify: false,
    data: { link: data.link || "/my-enquiries" },
  });
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil((async () => {
    let target;
    try {
      target = new URL(event.notification.data?.link || "/my-enquiries", self.location.origin);
    } catch {
      target = new URL("/my-enquiries", self.location.origin);
    }
    if (target.origin !== self.location.origin
      || !["/my-enquiries", "/vendor/enquiries"].includes(target.pathname)) {
      target = new URL("/my-enquiries", self.location.origin);
    }
    const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    const existing = windows.find((client) => new URL(client.url).origin === self.location.origin);
    if (existing) {
      await existing.navigate(target.href);
      return existing.focus();
    }
    return self.clients.openWindow(target.href);
  })());
});
