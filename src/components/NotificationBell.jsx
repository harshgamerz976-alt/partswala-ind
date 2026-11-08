import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Bell, CheckCheck } from "lucide-react";
import { useAuth } from "../context/useAuth";
import {
  disableBrowserNotifications,
  enableBrowserNotifications,
  listenForForegroundPush,
  markAllNotificationsRead,
  markNotificationRead,
  subscribeToUserNotifications,
  syncPreviouslyEnabledBrowserNotifications,
} from "../services/notificationService";
import "./NotificationBell.css";

function formatNotificationTime(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? "Time unavailable"
    : date.toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" });
}

function safeNotificationPath(value) {
  try {
    const target = new URL(value, window.location.origin);
    if (target.origin === window.location.origin
      && ["/my-enquiries", "/vendor/enquiries"].includes(target.pathname)) {
      return `${target.pathname}${target.search}`;
    }
  } catch {
    return "/my-enquiries";
  }
  return "/my-enquiries";
}

export default function NotificationBell() {
  const { currentUser, userProfile, isAdmin, isVendor } = useAuth();
  const navigate = useNavigate();
  const panelRef = useRef(null);
  const seenIdsRef = useRef(new Set());
  const [notifications, setNotifications] = useState([]);
  const [notificationsUserId, setNotificationsUserId] = useState("");
  const [unreadCount, setUnreadCount] = useState(0);
  const [open, setOpen] = useState(false);
  const [toast, setToast] = useState(null);
  const [error, setError] = useState("");
  const [pushState, setPushState] = useState("idle");

  const eligible = Boolean(
    currentUser
    && !isAdmin
    && (userProfile?.role === "customer" || isVendor),
  );

  useEffect(() => {
    if (!eligible || !currentUser?.uid) {
      setNotifications([]);
      setNotificationsUserId("");
      setUnreadCount(0);
      setOpen(false);
      setToast(null);
      seenIdsRef.current = new Set();
      return undefined;
    }

    const userId = currentUser.uid;
    setNotifications([]);
    setNotificationsUserId("");
    setUnreadCount(0);
    setToast(null);
    setError("");
    setPushState("idle");
    seenIdsRef.current = new Set();
    const mountedAt = Date.now();
    let initialSnapshot = true;
    let active = true;
    let toastTimer;
    const unsubscribeNotifications = subscribeToUserNotifications(userId, {
      onNotifications(snapshot) {
        const items = snapshot.docs.map((document) => ({ id: document.id, ...document.data() }));
        setNotifications(items);
        setNotificationsUserId(userId);
        if (initialSnapshot) {
          items.forEach(({ id }) => seenIdsRef.current.add(id));
          initialSnapshot = false;
          const newest = items
            .filter((item) => new Date(item.createdAt).getTime() >= mountedAt)
            .sort((left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime())[0];
          if (newest) {
            setToast(newest);
            toastTimer = window.setTimeout(() => setToast(null), 4500);
          }
          return;
        }
        for (const change of snapshot.docChanges()) {
          if (change.type !== "added" || seenIdsRef.current.has(change.doc.id)) continue;
          seenIdsRef.current.add(change.doc.id);
          const item = { id: change.doc.id, ...change.doc.data() };
          if (new Date(item.createdAt).getTime() < mountedAt) continue;
          setToast(item);
          window.clearTimeout(toastTimer);
          toastTimer = window.setTimeout(() => setToast(null), 4500);
        }
      },
      onUnreadCount: setUnreadCount,
      onError(listenerError) {
        if (active) setError(listenerError.message || "Notifications could not be loaded.");
      },
    });
    let unsubscribeForeground = () => {};
    listenForForegroundPush((payload) => {
      const data = payload?.data || {};
      const notificationId = typeof data.notificationId === "string" ? data.notificationId : "";
      if (!notificationId || seenIdsRef.current.has(notificationId)) return;
      seenIdsRef.current.add(notificationId);
      setToast({
        id: notificationId,
        title: typeof data.title === "string" ? data.title : "PARTSWALA IND",
        message: typeof data.body === "string" ? data.body : "You have a new supplier update.",
        link: safeNotificationPath(data.link),
        createdAt: new Date().toISOString(),
        read: false,
      });
      window.clearTimeout(toastTimer);
      toastTimer = window.setTimeout(() => setToast(null), 4500);
    }).then((unsubscribe) => {
      if (active) unsubscribeForeground = unsubscribe;
      else unsubscribe();
    }).catch((pushError) => {
      console.warn("Foreground push listener could not be started.", pushError?.code || pushError?.message);
    });
    syncPreviouslyEnabledBrowserNotifications(userId).then((result) => {
      if (active) setPushState(result.enabled ? "enabled" : result.reason || "idle");
    }).catch((pushError) => {
      if (active) {
        setPushState("error");
        setError(pushError.message || "Browser notifications could not be synchronized.");
      }
    });

    return () => {
      active = false;
      unsubscribeNotifications();
      unsubscribeForeground();
      window.clearTimeout(toastTimer);
    };
  }, [currentUser?.uid, eligible]);

  useEffect(() => {
    if (!open) return undefined;
    function closeOutside(event) {
      if (panelRef.current && !panelRef.current.contains(event.target)) setOpen(false);
    }
    function closeOnEscape(event) {
      if (event.key === "Escape") setOpen(false);
    }
    document.addEventListener("pointerdown", closeOutside);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOutside);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [open]);

  async function openNotification(item) {
    setOpen(false);
    setToast(null);
    setError("");
    try {
      await markNotificationRead(item.id);
    } catch (requestError) {
      setError(requestError.message || "This notification could not be marked as read.");
    }
    navigate(safeNotificationPath(item.link));
  }

  async function markAllRead() {
    setError("");
    try {
      await markAllNotificationsRead();
    } catch (requestError) {
      setError(requestError.message || "Notifications could not be marked as read.");
    }
  }

  async function enablePush() {
    setPushState("loading");
    setError("");
    try {
      const result = await enableBrowserNotifications(currentUser.uid);
      setPushState(result.enabled ? "enabled" : result.reason);
    } catch (requestError) {
      setPushState("error");
      setError(requestError.message || "Browser notifications could not be enabled.");
    }
  }

  async function disablePush() {
    setPushState("loading");
    setError("");
    try {
      const result = await disableBrowserNotifications(currentUser.uid);
      setPushState(result.cleanupPending ? "cleanup-pending" : "disabled");
    } catch (requestError) {
      setPushState("cleanup-pending");
      setError(requestError.message || "Browser notifications could not be disabled.");
    }
  }

  if (!eligible) return null;
  const userNotifications = notificationsUserId === currentUser.uid ? notifications : [];
  const userUnreadCount = notificationsUserId === currentUser.uid ? unreadCount : 0;

  const pushMessage = {
    enabled: "Browser notifications are enabled on this device.",
    disabled: "Browser notifications are off for this account on this device. In-site notifications remain available.",
    "cleanup-pending": "Browser push is off locally, but the server could not confirm token removal. Re-enable the VAPID configuration and retry disabling.",
    "missing-vapid": "Browser push is not configured yet. In-site notifications are still available.",
    unsupported: "This browser or device does not support web push. In-site notifications are still available.",
    denied: "Notifications are blocked in browser settings. Change the site permission there to enable push.",
    dismissed: "Permission was not granted. You can enable notifications here when ready.",
    error: "",
  }[pushState];

  return (
    <div className="notification-bell-wrap" ref={panelRef}>
      <button
        type="button"
        className="notification-bell-button"
        aria-label={`Notifications${userUnreadCount ? `, ${userUnreadCount} unread` : ""}`}
        aria-expanded={open}
        aria-controls="notification-panel"
        onClick={() => { setOpen((value) => !value); setToast(null); }}
      >
        <Bell size={20} />
        {userUnreadCount > 0 && <span className="notification-count">{userUnreadCount > 9 ? "9+" : userUnreadCount}</span>}
      </button>

      {toast && (
        <button type="button" className="notification-toast" onClick={() => openNotification(toast)} role="status">
          <strong>{toast.title}</strong>
          <span>{toast.message}</span>
        </button>
      )}

      {open && (
        <section id="notification-panel" className="notification-panel" aria-label="Notifications">
          <header className="notification-panel-header">
            <div><h2>Notifications</h2><span>{userUnreadCount ? `${userUnreadCount > 9 ? "9+" : userUnreadCount} unread` : "All caught up"}</span></div>
            {userUnreadCount > 0 && (
              <button type="button" onClick={markAllRead} aria-label="Mark all notifications as read">
                <CheckCheck size={16} /> Mark all read
              </button>
            )}
          </header>
          {error && <p className="notification-error" role="alert">{error}</p>}
          <div className="notification-list">
            {userNotifications.length === 0
              ? <p className="notification-empty">No notifications yet. New enquiries and supplier replies will appear here.</p>
              : userNotifications.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  className={`notification-item${item.read ? "" : " is-unread"}`}
                  onClick={() => openNotification(item)}
                >
                  <span className="notification-item-heading"><strong>{item.title}</strong>{!item.read && <i aria-label="Unread" />}</span>
                  <span className="notification-item-message">{item.message}</span>
                  <time dateTime={item.createdAt}>{formatNotificationTime(item.createdAt)}</time>
                </button>
              ))}
          </div>
          <footer className="notification-push-settings">
            <p>Browser push is optional. When enabled, this device can receive account-specific supplier updates outside the page; the browser will ask for your permission.</p>
            <button
              type="button"
              disabled={pushState === "loading"}
              onClick={pushState === "enabled" || pushState === "cleanup-pending" ? disablePush : enablePush}
            >
              {pushState === "loading"
                ? "Updating…"
                : pushState === "enabled" || pushState === "cleanup-pending"
                  ? "Disable browser notifications"
                  : "Enable browser notifications"}
            </button>
            <p>{pushMessage || "Push is opt-in and permission is requested only when you choose Enable notifications."}</p>
            <p>You can turn browser push off here at any time; in-site notifications remain available.</p>
            <p>On iPhone, web push generally requires iOS 16.4+, adding this site to your Home Screen, and granting permission. Android and browser support varies by device and browser.</p>
          </footer>
        </section>
      )}
    </div>
  );
}
