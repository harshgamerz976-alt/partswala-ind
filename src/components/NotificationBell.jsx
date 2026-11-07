import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
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
  const [notifications, setNotifications] = useState([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [open, setOpen] = useState(false);
  const [toast, setToast] = useState(null);
  const [error, setError] = useState("");
  const [pushState, setPushState] = useState("idle");
  const eligible = Boolean(currentUser && !isAdmin
    && (userProfile?.role === "customer" || isVendor));

  useEffect(() => {
    if (!eligible || !currentUser?.uid) {
      setNotifications([]);
      setUnreadCount(0);
      setOpen(false);
      setToast(null);
      return undefined;
    }
    setNotifications([]);
    setUnreadCount(0);
    setError("");
    setPushState("idle");
    let active = true;
    let unsubscribeForeground = () => {};
    const unsubscribe = subscribeToUserNotifications(currentUser.uid, {
      onNotifications(snapshot) {
        if (active) setNotifications(snapshot.docs.map((document) => ({ id: document.id, ...document.data() })));
      },
      onUnreadCount(count) {
        if (active) setUnreadCount(count);
      },
      onError(listenerError) {
        if (active) setError(listenerError.message || "Notifications could not be loaded.");
      },
    });
    listenForForegroundPush(({ data = {} }) => {
      if (active && data.notificationId) {
        setToast({ id: data.notificationId, title: data.title, message: data.body, link: data.link });
        window.setTimeout(() => setToast(null), 4500);
      }
    }).then((cleanup) => {
      if (active) unsubscribeForeground = cleanup;
      else cleanup();
    }).catch((pushError) => {
      if (active) setError(pushError.message || "Foreground notifications could not be started.");
    });
    syncPreviouslyEnabledBrowserNotifications().then((enabled) => {
      if (active && enabled) setPushState("enabled");
    }).catch((pushError) => {
      if (active) {
        setPushState("error");
        setError(pushError.message || "Browser notification status could not be checked.");
      }
    });
    return () => {
      active = false;
      unsubscribe();
      unsubscribeForeground();
    };
  }, [currentUser?.uid, eligible]);

  useEffect(() => {
    if (!open) return undefined;
    const closeOutside = (event) => {
      if (panelRef.current && !panelRef.current.contains(event.target)) setOpen(false);
    };
    const closeOnEscape = (event) => {
      if (event.key === "Escape") setOpen(false);
    };
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
      const result = await enableBrowserNotifications();
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
      await disableBrowserNotifications();
      setPushState("disabled");
    } catch (requestError) {
      setPushState("error");
      setError(requestError.message || "Browser notifications could not be disabled.");
    }
  }

  if (!eligible) return null;
  const pushMessage = {
    enabled: "Browser notifications are enabled on this device.",
    disabled: "Push notifications are disabled on this device. In-site history remains available.",
    "missing-vapid": "Browser push is not configured yet. In-site notifications are still available.",
    unsupported: "This browser or device does not support web push. In-site notifications are still available.",
    "ios-install": "On iPhone or iPad, add this site to the Home Screen and open it there to enable web push.",
    denied: "Notifications are blocked in browser settings. Change the site permission there to enable push.",
    dismissed: "Permission was not granted. You can enable notifications here when ready.",
    error: "Push settings could not be updated.",
  }[pushState];

  return (
    <div className="notification-bell-wrap" ref={panelRef}>
      <button
        type="button"
        className="notification-bell-button"
        aria-label={`Notifications${unreadCount ? `, ${unreadCount > 9 ? "9+" : unreadCount} unread` : ""}`}
        aria-expanded={open}
        aria-controls="notification-panel"
        onClick={() => { setOpen((value) => !value); setToast(null); }}
      >
        <svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
          <path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4" />
        </svg>
        {unreadCount > 0 && <span className="notification-count">{unreadCount > 9 ? "9+" : unreadCount}</span>}
      </button>
      {toast && <button type="button" className="notification-toast" onClick={() => openNotification(toast)} role="status">
        <strong>{toast.title || "Supplier update"}</strong><span>{toast.message || "You have a new update."}</span>
      </button>}
      {open && <section id="notification-panel" className="notification-panel" aria-label="Notifications">
        <header className="notification-panel-header">
          <div><h2>Notifications</h2><span>{unreadCount ? `${unreadCount > 9 ? "9+" : unreadCount} unread` : "All caught up"}</span></div>
          {unreadCount > 0 && <button type="button" onClick={markAllRead}>Mark all read</button>}
        </header>
        {error && <p className="notification-error" role="alert">{error}</p>}
        <div className="notification-list">
          {notifications.length === 0
            ? <p className="notification-empty">No notifications yet. New enquiries and supplier replies will appear here.</p>
            : notifications.map((item) => <button
              key={item.id}
              type="button"
              className={`notification-item${item.read ? "" : " is-unread"}`}
              onClick={() => openNotification(item)}
            >
              <span className="notification-item-heading"><strong>{item.title}</strong>{!item.read && <i aria-label="Unread" />}</span>
              <span className="notification-item-message">{item.message}</span>
              <time dateTime={item.createdAt}>{item.createdAt ? new Date(item.createdAt).toLocaleString("en-IN") : "Time unavailable"}</time>
            </button>)}
        </div>
        <footer className="notification-push-settings">
          {pushState === "enabled"
            ? <button type="button" onClick={disablePush}>Disable push on this device</button>
            : <button type="button" disabled={pushState === "loading"} onClick={enablePush}>{pushState === "loading" ? "Updating…" : "Enable notifications"}</button>}
          <p>{pushMessage || "Push is opt-in. Permission is requested only when you choose Enable notifications."}</p>
          <p>On iPhone and iPad, web push requires iOS/iPadOS 16.4+, adding this site to the Home Screen, and granting permission. Other browser support varies.</p>
        </footer>
      </section>}
    </div>
  );
}
