importScripts("https://www.gstatic.com/firebasejs/12.15.0/firebase-app-compat.js");
importScripts("https://www.gstatic.com/firebasejs/12.15.0/firebase-messaging-compat.js");

const config = new URL(self.location.href).searchParams;
const firebaseConfig = Object.fromEntries(
  ["apiKey", "authDomain", "projectId", "storageBucket", "messagingSenderId", "appId"]
    .map((key) => [key, config.get(key) || ""]),
);

if (Object.values(firebaseConfig).every(Boolean)) {
  firebase.initializeApp(firebaseConfig);
  const messaging = firebase.messaging();

  messaging.onBackgroundMessage(({ data = {} }) => {
    if (!data.notificationId) return;
    self.registration.showNotification(data.title || "PARTSWALA IND", {
      body: data.body || "You have a supplier enquiry update.",
      icon: "/favicon.svg",
      badge: "/favicon.svg",
      tag: `partswala-${data.notificationId}`,
      renotify: false,
      data: { link: data.link || "/my-enquiries" },
    });
  });
}

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
