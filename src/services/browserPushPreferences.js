const PUSH_PREFERENCE_PREFIX = "partswala-browser-push:";

export function browserPushPreferenceKey(userId) {
  if (typeof userId !== "string" || !userId.trim()) throw new Error("A signed-in user is required.");
  return `${PUSH_PREFERENCE_PREFIX}${encodeURIComponent(userId)}`;
}

export function getBrowserPushPreference(userId, storage) {
  const preference = storage.getItem(browserPushPreferenceKey(userId));
  return preference === "enabled" || preference === "disabled" ? preference : "unset";
}

export function setBrowserPushPreference(userId, preference, storage) {
  if (!["enabled", "disabled"].includes(preference)) throw new Error("A valid browser notification preference is required.");
  storage.setItem(browserPushPreferenceKey(userId), preference);
}
