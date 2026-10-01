const API_URL = (import.meta.env.VITE_AI_API_URL || import.meta.env.VITE_API_URL || import.meta.env.VITE_BACKEND_API_URL || "http://localhost:8787").replace(/\/$/, "");
const inFlight = new Map();

export async function sendAssistantMessage(user, payload) {
  const token = user ? await user.getIdToken() : "";
  const key = `${user?.uid || "guest"}:${JSON.stringify(payload)}`;
  if (inFlight.has(key)) return inFlight.get(key);

  const request = fetch(`${API_URL}/api/ai/chat`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(payload),
  }).then(async (response) => {
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || "PARTSWALA AI is unavailable right now.");
    return data;
  }).finally(() => inFlight.delete(key));

  inFlight.set(key, request);
  return request;
}